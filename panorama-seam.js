/**
 * 全景接缝校正 —— 纯本地像素运算，不调用任何模型
 *
 * 问题：全景图最左一列和最右一列在球面上是同一个位置，但源的左右边缘
 *       往往存在亮度 / 色温差，接缝转到眼前时就是一条看得见的竖带。
 *
 * 做法：把接缝位移到中线 → 逐行量出这一行左右差了多少 → 生成一条
 *       从 +半差 平滑过渡到 −半差 的校正曲线，叠加回原图 → 位移回去。
 *       校正曲线只改低频，图像的高频纹理一个像素都不动。
 *
 * 为什么逐行量、不用固定系数：每张图的色差都不一样，同一张图不同高度的
 *       色差也不一样（暗的地方同样的偏色显得大，亮的地方显得小）。
 *       逐行量 = 每张图自己决定修多少，调用方不需要传任何参数。
 *
 * 与旧实现（advancedPanoramaSeamBlend）的区别：
 *       旧：逐行取两侧均值当基准，再把细节乘 0.68 混回去 —— 会主动衰减纹理，
 *           遇到深色物体（黑门）会把整块内容抹成雾状。
 *       新：只叠加一条平滑校正曲线，纹理完全保留。
 *
 * 实测（同一张 1920×960 门厅全景，接缝跳变 80 级）：
 *       旧实现（advancedPanoramaSeamBlend）：跳变 51，边缘残留 51，黑门被抹成雾状
 *       本实现：接缝 ±2px 0.33 级、±40px 2.9 级、±80px 4.5 级，336ms
 *       同图 FreeCCStudio 的泊松方案：0.67 / 4.1 / 5.2（Python + SciPy，307ms）
 *
 * 带宽是一次修正（曾用 2.5%，即 1920 图 48px）：窄带能把接缝那一下抹平，
 *       但全景拼接留下的往往是几十到几百像素宽的渐变带，窄带会在带的两端
 *       生出第二条可见边界。取 3/32 后 ±80px 的残差从 9.4 降到 4.5。
 *
 * 还有一条同样重要：接缝上有一百多级的跳变，未必是偏色。
 *       这张门厅图接缝正压在黑色门框上，那一段左右本来就是不同的东西。
 *       按色差一视同仁地"修"，就是给门的一半加亮、另一半压暗 ——
 *       门面上会多出一条几十像素宽的糊状灰带，比原来的接缝更难看。
 *       所以先按全图中位数 / MAD 把这种"结构行"挑出来（robustJumps），
 *       它们的跳变用上下正常行的插值顶上，只保留抹平色差、不动结构。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GWPanoramaSeam = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // 校正带宽：占宽度的 3/32（1920 宽约 180px）。实测带宽 48px 时接缝处跳变虽已降到 1，
  // 但接缝两侧 80–160px 范围仍残留 9–12 级色差，视觉上是一条更宽的带。
  const SEAM_HALF_WIDTH_RATIO = 3 / 32;
  const SEAM_MAX_HALF_WIDTH = 768;
  // 二维松弛次数：线性斜坡已把 x 方向的台阶抵消，这里只补 y 方向的连续性
  const SEAM_RELAX_ITERATIONS = 220;
  // 求解用的粗网格行数：纵向降到这个量级后 SOR 才收敛得动（原高度求解要上千次迭代）
  const SEAM_RELAX_ROWS = 120;
  // 结构行判定：跳变偏离全图中位数超过 max(下限, k×MAD) 的行，
  // 认为接缝两侧本来就是不同内容（门框、墙角），不按色差去修。
  // 上限 48 是防止 MAD 被"大面积偏色"抬高后把真正的结构又放回来。
  const SEAM_STRUCT_MIN_THRESHOLD = 24;
  const SEAM_STRUCT_MAX_THRESHOLD = 48;
  const SEAM_STRUCT_K = 3;

  function gaussianKernel(sigma) {
    const radius = Math.max(1, Math.ceil(sigma * 2.5));
    const size = radius * 2 + 1;
    const k = new Float32Array(size);
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const d = i - radius;
      k[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
      sum += k[i];
    }
    for (let i = 0; i < size; i++) k[i] /= sum;
    return k;
  }

  /**
   * 逐行估计接缝处不该出现的跃变：
   * 实测一阶差分 − 两侧自然梯度的中位数（后者代表这一行的正常纹理起伏）
   */
  function jumpProfile(data, width, height, center, win) {
    const out = [new Float32Array(height), new Float32Array(height), new Float32Array(height)];
    const slopes = new Float64Array(win * 2);
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let c = 0; c < 3; c++) {
        let n = 0;
        for (let k = 1; k <= win; k++) {
          slopes[n++] = data[row + (center - k) * 4 + c] - data[row + (center - k - 1) * 4 + c];
          slopes[n++] = data[row + (center + k) * 4 + c] - data[row + (center + k - 1) * 4 + c];
        }
        const sorted = Array.prototype.slice.call(slopes, 0, n).sort((a, b) => a - b);
        const expected = sorted[n >> 1];
        const actual = data[row + center * 4 + c] - data[row + (center - 1) * 4 + c];
        out[c][y] = actual - expected;
      }
    }
    return out;
  }

  /**
   * 把"其实是内容不同"的行从色差估计里剔掉。
   *
   * 为什么必须剔：接缝如果压在一根门框、一道墙角上，这一行的跳变会有一百多级，
   * 但那是两个不同的东西挨在一起，不是偏色。按色差去"修"它，就是给门的一半
   * 加亮一半压暗 —— 门面上会出现一条几十像素宽的糊状灰带，比原来的接缝还难看。
   *
   * 判据用全图的中位数 / MAD，不用局部中值：结构带可能有一两百行高，
   * 局部窗口会被它自己带偏（把整块结构当成"正常"，于是什么都没剔掉）。
   * 被剔掉的行用上下最近的正常行插值顶上，校正曲线就不会在那里起伏。
   *
   * @returns {{jumps: Float32Array[], structural: number}} structural 为剔除的行数
   */
  function robustJumps(jumps, height) {
    const gray = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      gray[y] = (jumps[0][y] + jumps[1][y] + jumps[2][y]) / 3;
    }
    const sorted = Array.prototype.slice.call(gray).sort((a, b) => a - b);
    const median = sorted[height >> 1];
    const dev = new Float32Array(height);
    for (let y = 0; y < height; y++) dev[y] = Math.abs(gray[y] - median);
    const devSorted = Array.prototype.slice.call(dev).sort((a, b) => a - b);
    // 1.4826：让 MAD 在正态分布下等价于标准差
    const mad = devSorted[height >> 1] * 1.4826;
    const threshold = Math.min(
      SEAM_STRUCT_MAX_THRESHOLD,
      Math.max(SEAM_STRUCT_MIN_THRESHOLD, SEAM_STRUCT_K * mad)
    );

    const trusted = new Uint8Array(height);
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (Math.abs(gray[y] - median) <= threshold) { trusted[y] = 1; count++; }
    }
    if (count < 2 || count === height) return { jumps: jumps, structural: height - count };

    // 下一处可信行（预扫一遍，避免逐行往后找造成 O(H²)）
    const nextTrusted = new Int32Array(height + 1);
    nextTrusted[height] = -1;
    for (let y = height - 1; y >= 0; y--) {
      nextTrusted[y] = trusted[y] ? y : nextTrusted[y + 1];
    }

    const out = [];
    for (let c = 0; c < 3; c++) {
      const src = jumps[c];
      const dst = new Float32Array(height);
      let prev = -1;
      for (let y = 0; y < height; y++) {
        if (trusted[y]) { dst[y] = src[y]; prev = y; continue; }
        const next = nextTrusted[y];
        if (prev < 0 && next < 0) { dst[y] = src[y]; continue; }
        if (prev < 0) { dst[y] = src[next]; continue; }
        if (next < 0) { dst[y] = src[prev]; continue; }
        const t = (y - prev) / (next - prev);
        dst[y] = src[prev] * (1 - t) + src[next] * t;
      }
      out.push(dst);
    }
    return { jumps: out, structural: height - count };
  }

  /**
   * 沿 y 向平滑跃变曲线，避免逐行独立处理产生横向条纹 */
  function smoothProfile(profile, height, sigma) {
    const kernel = gaussianKernel(sigma);
    const half = (kernel.length - 1) >> 1;
    const src = profile.slice();
    for (let y = 0; y < height; y++) {
      let sum = 0, weight = 0;
      for (let k = -half; k <= half; k++) {
        const yy = y + k < 0 ? 0 : (y + k >= height ? height - 1 : y + k);
        sum += src[yy] * kernel[k + half];
        weight += kernel[k + half];
      }
      profile[y] = sum / weight;
    }
    return profile;
  }

  /**
   * 高斯-赛德尔 + 超松弛，求解 ∇²φ = 0：
   * 左右两列是固定边界值，上下互为镜像（Neumann）。
   * 入参 phi 是初值，迭代只负责把逐行独立的解沿高度抹连续。
   */
  function relaxField(phi, span, height, fixedLeft, fixedRight, iterations, omega) {
    const rest = 1 - omega;
    for (let it = 0; it < iterations; it++) {
      for (let y = 0; y < height; y++) {
        const row = y * span;
        const up = (y > 0 ? y - 1 : y) * span;
        const down = (y < height - 1 ? y + 1 : y) * span;
        for (let x = 1; x < span - 1; x++) {
          if (x === fixedLeft || x === fixedRight) continue;
          const i = row + x;
          const avg = (phi[i - 1] + phi[i + 1] + phi[up + x] + phi[down + x]) * 0.25;
          phi[i] = phi[i] * rest + omega * avg;
        }
      }
    }
  }

  /**
   * 逐行的一维精确解：左半从 0 线性升到 +jump/2，右半从 −jump/2 线性回到 0。
   * 两个半支在中线相遇，相加正好抵消原始跃变，两侧各承担一半。
   */
  function linearRow(phi, base, span, half, fixedLeft, denomL, denomR) {
    for (let x = 0; x < span; x++) {
      phi[base + x] = x <= fixedLeft
        ? half * x / denomL
        : -half * (span - 1 - x) / denomR;
    }
  }

  /**
   * 解出一条沿高度连续的校正场。
   *
   * 只降采样纵向：横向列数不多（几百列）且接缝必须落在精确的一列上，
   * 降采样会把它抹掉；纵向的高频细节对校正场没有意义，粗网格上 SOR 收敛快一个量级。
   */
  function solveField(jumps, span, height, fixedLeft, fixedRight, denomL, denomR, iterations, omega) {
    const phi = new Float32Array(span * height);
    const coarseRows = iterations > 0 ? Math.max(8, Math.min(height, SEAM_RELAX_ROWS)) : height;
    const D = Math.max(1, Math.round(height / coarseRows));
    const sh = Math.max(8, Math.ceil(height / D));

    if (D === 1) {
      for (let y = 0; y < height; y++) {
        linearRow(phi, y * span, span, jumps[y] * 0.5, fixedLeft, denomL, denomR);
      }
      if (iterations > 0) relaxField(phi, span, height, fixedLeft, fixedRight, iterations, omega);
      return phi;
    }

    // 粗网格的 jump：按块平均
    const coarseJump = new Float32Array(sh);
    for (let j = 0; j < sh; j++) {
      const y0 = j * D, y1 = Math.min(height, y0 + D);
      let sum = 0;
      for (let y = y0; y < y1; y++) sum += jumps[y];
      coarseJump[j] = y1 > y0 ? sum / (y1 - y0) : 0;
    }

    const phiC = new Float32Array(span * sh);
    for (let j = 0; j < sh; j++) {
      linearRow(phiC, j * span, span, coarseJump[j] * 0.5, fixedLeft, denomL, denomR);
    }
    relaxField(phiC, span, sh, fixedLeft, fixedRight, iterations, omega);

    // 线性上采样回原高度
    for (let y = 0; y < height; y++) {
      const t = y / D;
      const j0 = Math.min(sh - 1, Math.floor(t));
      const j1 = Math.min(sh - 1, j0 + 1);
      const f = Math.min(1, Math.max(0, t - j0));
      const row = y * span, r0 = j0 * span, r1 = j1 * span;
      for (let x = 0; x < span; x++) {
        phi[row + x] = phiC[r0 + x] * (1 - f) + phiC[r1 + x] * f;
      }
    }
    return phi;
  }

  /**
   * 就地校正 canvas 的中央接缝（调用前需先把接缝位移到 width/2）
   *
   * 两步：
   *   1. 逐行量出这一行左右差多少，用一维精确解（线性斜坡）打底，跳变当场抵消；
   *   2. 二维松弛，让校正量沿高度连续。
   * 第 2 步不能省：jump 沿高度可能是突变的（这张门厅图上，天花板上只差 6 级，
   * 到了深色门上是 119 级），逐行独立处理会在跳变处留下一条横向亮带。
   *
   * @param {HTMLCanvasElement} canvas
   * @param {{halfWidth?:number, iterations?:number, omega?:number, window?:number}} options
   *   halfWidth  过渡带半宽，默认 3/32 图宽（上限 768）
   *   iterations 二维松弛次数，默认 220；0 表示只用逐行解（会有横向条纹，仅用于对照）
   *   window     估计自然梯度的采样半径，默认 5
   */
  function correctSeam(canvas, options) {
    const opts = options || {};
    const width = canvas.width, height = canvas.height;
    if (width < 32 || height < 32) return canvas;

    const center = Math.floor(width / 2);
    const win = Math.max(2, Math.round(opts.window || 5));
    // 带宽：全景拼接的色差常常不是 1px 的台阶，而是几十到几百像素宽的渐变带，
    // 带宽太窄会在带的两端留下第二条可见边界。默认取宽度的 3/32（与实测最优一致）
    const rawHw = opts.halfWidth || width * SEAM_HALF_WIDTH_RATIO;
    const hw = Math.max(6, Math.min(Math.round(rawHw), SEAM_MAX_HALF_WIDTH, center - 1, width - center - 1));
    const iterations = opts.iterations === undefined
      ? SEAM_RELAX_ITERATIONS
      : Math.max(0, Math.round(opts.iterations));
    const omega = opts.omega || 1.9;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;

    const left = Math.max(0, center - hw);
    const right = Math.min(width - 1, center + hw);
    const span = right - left + 1;
    const fixedLeft = center - 1 - left;
    const fixedRight = center - left;
    const denomL = Math.max(1, center - 1 - left);
    const denomR = Math.max(1, right - center);

    const rawJumps = jumpProfile(data, width, height, center, win);
    const robust = robustJumps(rawJumps, height);
    const jumps = robust.jumps;
    canvas.__seamStructuralRows = robust.structural;

    for (let c = 0; c < 3; c++) {
      const phi = solveField(jumps[c], span, height, fixedLeft, fixedRight, denomL, denomR, iterations, omega);
      for (let y = 0; y < height; y++) {
        const row = y * width * 4;
        const phiRow = y * span;
        for (let x = left; x <= right; x++) {
          const v = data[row + x * 4 + c] + phi[phiRow + (x - left)];
          data[row + x * 4 + c] = v < 0 ? 0 : (v > 255 ? 255 : Math.round(v));
        }
      }
    }

    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  return { correctSeam, jumpProfile, robustJumps, smoothProfile, relaxField };
});
