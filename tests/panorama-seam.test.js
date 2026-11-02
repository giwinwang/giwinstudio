"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const seam = require("../panorama-seam");

function makeCanvas(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const rgb = paint(x, y);
      data[index] = rgb[0];
      data[index + 1] = rgb[1];
      data[index + 2] = rgb[2];
      data[index + 3] = 255;
    }
  }
  return {
    width,
    height,
    data,
    getContext() {
      return {
        getImageData: () => ({ width, height, data }),
        putImageData: () => {}
      };
    }
  };
}

function seamJump(canvas, y) {
  const width = canvas.width;
  const center = Math.floor(width / 2);
  const data = canvas.data;
  const row = y * width * 4;
  let sum = 0;
  for (let c = 0; c < 3; c++) {
    sum += Math.abs(data[row + center * 4 + c] - data[row + (center - 1) * 4 + c]);
  }
  return sum / 3;
}

function bandAcutance(canvas, y) {
  const width = canvas.width;
  const center = Math.floor(width / 2);
  const data = canvas.data;
  const row = y * width * 4;
  const diffs = [];
  for (let x = center - 40; x < center + 40; x++) {
    diffs.push(Math.abs(data[row + x * 4] - data[row + (x + 1) * 4]));
  }
  diffs.sort((a, b) => a - b);
  return diffs[diffs.length >> 1];
}

test("两侧亮度不同的接缝被抹平", () => {
  const canvas = makeCanvas(192, 200, x => (x < 96 ? [100, 100, 100] : [140, 140, 140]));
  const before = seamJump(canvas, 100);
  assert.ok(before > 35, "构造的接缝应在 40 级左右，实际 " + before);

  seam.correctSeam(canvas);

  const after = seamJump(canvas, 100);
  assert.ok(after < 2, "修正后中线跳变应接近 0，实际 " + after);
});

test("色差被两侧平摊而不是只压一侧", () => {
  const canvas = makeCanvas(192, 200, x => (x < 96 ? [100, 100, 100] : [140, 140, 140]));
  seam.correctSeam(canvas);

  const row = 100 * 192 * 4;
  const center = 96;
  const leftFar = canvas.data[row + 4 * 4];
  const rightFar = canvas.data[row + 188 * 4];
  const leftNear = canvas.data[row + (center - 1) * 4];
  const rightNear = canvas.data[row + center * 4];

  assert.ok(leftNear > 110 && leftNear < 130, "中线左侧应上移约 20 级，实际 " + leftNear);
  assert.ok(rightNear > 110 && rightNear < 130, "中线右侧应下移约 20 级，实际 " + rightNear);
  assert.equal(leftFar, 100, "过渡带外不应被改动");
  assert.equal(rightFar, 140, "过渡带外不应被改动");
});

test("沿高度不同的色差各修各的", () => {
  const canvas = makeCanvas(192, 200, (x, y) => {
    const base = x < 96 ? 100 : 100 + (y < 100 ? 60 : 20);
    return [base, base, base];
  });
  const topBefore = seamJump(canvas, 40);
  const bottomBefore = seamJump(canvas, 160);
  assert.ok(topBefore > 55 && bottomBefore > 15);

  seam.correctSeam(canvas);

  assert.ok(seamJump(canvas, 40) < 6, "上段应被修掉，实际 " + seamJump(canvas, 40));
  assert.ok(seamJump(canvas, 160) < 3, "下段应被修掉，实际 " + seamJump(canvas, 160));
});

test("全图同色时不产生任何改动", () => {
  const canvas = makeCanvas(192, 200, () => [133, 137, 141]);
  const before = canvas.data.slice();
  seam.correctSeam(canvas);
  assert.deepEqual(Array.from(canvas.data), Array.from(before));
});

test("纹理锐度不被削弱", () => {
  const paint = x => {
    const base = x < 96 ? 100 : 140;
    const texture = (x % 2 === 0) ? 6 : -6;
    return [base + texture, base + texture, base + texture];
  };
  const canvas = makeCanvas(192, 200, paint);
  const before = bandAcutance(canvas, 100);
  seam.correctSeam(canvas);
  const after = bandAcutance(canvas, 100);
  assert.ok(after >= before * 0.9, "纹理不应被削弱：前 " + before + " 后 " + after);
});

test("极亮极暗端点不溢出", () => {
  const canvas = makeCanvas(192, 200, x => (x < 96 ? [0, 0, 0] : [255, 255, 255]));
  seam.correctSeam(canvas);
  for (const value of canvas.data) {
    assert.ok(value >= 0 && value <= 255);
  }
});

test("过小的图直接返回", () => {
  const canvas = makeCanvas(16, 16, () => [10, 20, 30]);
  const returned = seam.correctSeam(canvas);
  assert.equal(returned, canvas);
  assert.equal(canvas.data[0], 10);
});

test("接缝压在深色结构上时不把结构抹平", () => {
  // 全图 40 级均匀偏色，但中间 40 行是一块跨过接缝的深色结构（跳变 −85）。
  // 按色差硬修会把这块结构的一半抬亮一半压暗，门面上出现一条糊状灰带。
  const canvas = makeCanvas(192, 200, (x, y) => {
    const cast = y < 100 ? 40 : 4;
    const value = x < 96 ? 100 : (y >= 120 && y < 160 ? 15 : 100 + cast);
    return [value, value, value];
  });

  const jumps = seam.jumpProfile(canvas.data, 192, 200, 96, 5);
  const robust = seam.robustJumps(jumps, 200);
  assert.ok(robust.structural >= 30, "应识别出结构行，实际 " + robust.structural);

  seam.correctSeam(canvas);

  assert.ok(seamJump(canvas, 40) < 6, "普通行的色差照常修掉，实际 " + seamJump(canvas, 40));

  const row = 140 * 192 * 4;
  const leftNear = canvas.data[row + 95 * 4];
  const rightNear = canvas.data[row + 96 * 4];
  assert.ok(leftNear > 95 && leftNear < 106, "结构行左侧不应被抬升，实际 " + leftNear);
  assert.ok(rightNear > 8 && rightNear < 30, "结构行右侧不应被抬到 40 以上，实际 " + rightNear);
  assert.ok(
    Math.abs(rightNear - 15) < 8,
    "结构行几乎不应被改动，原 15 现 " + rightNear
  );
});

test("画布侧已接入接缝模块且旧实现已移除", () => {
  const root = path.join(__dirname, "..");
  const canvasSource = fs.readFileSync(path.join(root, "canvas.js"), "utf8");
  assert.ok(canvasSource.includes("function panoramaSeamCorrect(canvas)"));
  assert.ok(canvasSource.includes("window.GWPanoramaSeam"));
  assert.ok(!canvasSource.includes("advancedPanoramaSeamBlend"));
  assert.ok(!canvasSource.includes("advancedLocalPanoramaRepair"));
  assert.ok(!canvasSource.includes("detail * 0.68"));

  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const seamIndex = html.indexOf('src="panorama-seam.js"');
  const canvasIndex = html.indexOf('src="canvas.js"');
  assert.ok(seamIndex > 0, "index.html 应引入 panorama-seam.js");
  assert.ok(seamIndex < canvasIndex, "panorama-seam.js 必须在 canvas.js 之前加载");
});
