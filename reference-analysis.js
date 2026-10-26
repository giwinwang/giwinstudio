(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GWReferenceAnalysis = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const hex = value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  const colorHex = color => "#" + hex(color.r) + hex(color.g) + hex(color.b);
  const linearize = value => {
    value /= 255;
    return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
  };
  const encode = value => 255 * (value <= .0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - .055);
  const labPivot = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const labPivotInverse = value => {
    const cube = value * value * value;
    return cube > .008856 ? cube : (value - 16 / 116) / 7.787;
  };

  function rgbToLab(r, g, b) {
    const lr = linearize(r), lg = linearize(g), lb = linearize(b);
    const x = (lr * .4124 + lg * .3576 + lb * .1805) / .95047;
    const y = lr * .2126 + lg * .7152 + lb * .0722;
    const z = (lr * .0193 + lg * .1192 + lb * .9505) / 1.08883;
    const fx = labPivot(x), fy = labPivot(y), fz = labPivot(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labToRgb(l, a, b) {
    const fy = (l + 16) / 116;
    const x = .95047 * labPivotInverse(fy + a / 500);
    const y = labPivotInverse(fy);
    const z = 1.08883 * labPivotInverse(fy - b / 200);
    let r = x * 3.2406 + y * -1.5372 + z * -.4986;
    let g = x * -.9689 + y * 1.8758 + z * .0415;
    let blue = x * .0557 + y * -.204 + z * 1.057;
    return [encode(r), encode(g), encode(blue)];
  }

  function labStats(data) {
    const count = Math.floor(data.length / 4);
    const sum = [0, 0, 0], squares = [0, 0, 0];
    let valid = 0;
    for (let index = 0; index < count; index++) {
      const offset = index * 4;
      if (data[offset + 3] < 32) continue;
      const lab = rgbToLab(data[offset], data[offset + 1], data[offset + 2]);
      for (let channel = 0; channel < 3; channel++) {
        sum[channel] += lab[channel];
        squares[channel] += lab[channel] * lab[channel];
      }
      valid++;
    }
    return sum.map((value, channel) => {
      const mean = value / Math.max(1, valid);
      const variance = squares[channel] / Math.max(1, valid) - mean * mean;
      return { mean, deviation: Math.sqrt(Math.max(0, variance)) };
    });
  }

  function matchPalettePixels(sourceData, sourceStats, referenceStats, strength = .68) {
    const out = new Uint8ClampedArray(sourceData);
    const amount = clamp(strength, 0, 1);
    for (let offset = 0; offset < out.length; offset += 4) {
      if (out[offset + 3] < 32) continue;
      const sourceLab = rgbToLab(out[offset], out[offset + 1], out[offset + 2]);
      const mapped = sourceLab.map((value, channel) => {
        const source = sourceStats[channel];
        const reference = referenceStats[channel];
        const scale = clamp(reference.deviation / Math.max(.5, source.deviation), .45, 1.8);
        const target = reference.mean + (value - source.mean) * scale;
        return value + (target - value) * amount;
      });
      const rgb = labToRgb(mapped[0], mapped[1], mapped[2]);
      out[offset] = rgb[0];
      out[offset + 1] = rgb[1];
      out[offset + 2] = rgb[2];
    }
    return out;
  }

  function parseHexColor(value) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value || "").trim());
    if (!match) return null;
    const number = parseInt(match[1], 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }

  function tintPixels(sourceData, targetColor, strength = .72, options = {}) {
    const target = parseHexColor(targetColor);
    if (!target) return new Uint8ClampedArray(sourceData);
    const out = new Uint8ClampedArray(sourceData);
    const sourceStats = options.sourceStats || labStats(sourceData);
    const targetLab = rgbToLab(target[0], target[1], target[2]);
    const amount = clamp(Number(strength) || .72, 0, 1);
    const lightnessAmount = clamp(
      options.lightnessStrength == null ? .55 : Number(options.lightnessStrength),
      0,
      1
    ) * amount;
    const hueShift = clamp(Number(options.hueShift) || 0, -180, 180) / 360;
    const saturationScale = clamp(
      options.saturation == null ? 1 : Number(options.saturation),
      0,
      2
    );
    const lightnessShift = clamp(
      options.lightnessOffset == null ? 0 : Number(options.lightnessOffset),
      -.5,
      .5
    );
    for (let offset = 0; offset < out.length; offset += 4) {
      if (out[offset + 3] < 16) continue;
      const lab = rgbToLab(out[offset], out[offset + 1], out[offset + 2]);
      lab[0] += (targetLab[0] - sourceStats[0].mean) * lightnessAmount;
      lab[1] += (targetLab[1] - sourceStats[1].mean) * amount;
      lab[2] += (targetLab[2] - sourceStats[2].mean) * amount;
      const rgb = labToRgb(lab[0], lab[1], lab[2]);
      let [r, g, b] = rgb.map(value => clamp(Math.round(value), 0, 255) / 255);
      let max = Math.max(r, g, b);
      let min = Math.min(r, g, b);
      let hue = 0;
      let saturation = 0;
      let lightness = (max + min) / 2;
      const delta = max - min;
      if (delta > 0) {
        saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min);
        if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue /= 6;
      }
      hue = ((hue + hueShift) % 1 + 1) % 1;
      saturation = clamp(saturation * saturationScale, 0, 1);
      lightness = clamp(lightness + lightnessShift, 0, 1);
      if (saturation === 0) {
        r = g = b = lightness;
      } else {
        const q = lightness < .5
          ? lightness * (1 + saturation)
          : lightness + saturation - lightness * saturation;
        const p = 2 * lightness - q;
        const hueToRgb = t => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        r = hueToRgb(hue + 1 / 3);
        g = hueToRgb(hue);
        b = hueToRgb(hue - 1 / 3);
      }
      out[offset] = Math.round(r * 255);
      out[offset + 1] = Math.round(g * 255);
      out[offset + 2] = Math.round(b * 255);
    }
    return out;
  }

  function summarizePixels(data, width, height) {
    if (!data || !width || !height || data.length < width * height * 4) {
      throw new Error("参考图像素数据不可用");
    }
    const total = { r: 0, g: 0, b: 0, count: 0 };
    const bands = {
      shadows: { r: 0, g: 0, b: 0, count: 0 },
      midtones: { r: 0, g: 0, b: 0, count: 0 },
      highlights: { r: 0, g: 0, b: 0, count: 0 }
    };
    const buckets = new Map();
    for (let index = 0; index < width * height; index++) {
      const offset = index * 4;
      const alpha = data[offset + 3];
      if (alpha < 32) continue;
      const r = data[offset], g = data[offset + 1], b = data[offset + 2];
      const luminance = r * .2126 + g * .7152 + b * .0722;
      const band = luminance < 72 ? bands.shadows : luminance < 178 ? bands.midtones : bands.highlights;
      total.r += r; total.g += g; total.b += b; total.count++;
      band.r += r; band.g += g; band.b += b; band.count++;
      const key = (r >> 5) + "," + (g >> 5) + "," + (b >> 5);
      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
      buckets.set(key, bucket);
    }
    if (!total.count) throw new Error("参考图没有有效像素");
    const average = color => ({
      r: color.r / Math.max(1, color.count),
      g: color.g / Math.max(1, color.count),
      b: color.b / Math.max(1, color.count)
    });
    const mean = average(total);
    const dominant = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map(item => colorHex(average(item)));
    const blueBias = mean.b - mean.r;
    const warmBias = mean.r - mean.b;
    const tone = blueBias > 10 ? "偏冷蓝" : warmBias > 18 ? "偏暖" : "中性";
    const cooling = blueBias > 7;
    const summary =
      "主色" + dominant.join("、") +
      "；平均色" + colorHex(mean) +
      "；阴影" + colorHex(average(bands.shadows)) +
      "；中间调" + colorHex(average(bands.midtones)) +
      "；高光" + colorHex(average(bands.highlights)) +
      "；整体" + tone;
    return {
      summary,
      average: colorHex(mean),
      shadows: colorHex(average(bands.shadows)),
      midtones: colorHex(average(bands.midtones)),
      highlights: colorHex(average(bands.highlights)),
      dominant,
      tone,
      cooling
    };
  }

  async function analyze(dataURL) {
    if (!dataURL) return null;
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = dataURL;
    });
    const edge = 64;
    const scale = Math.min(1, edge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const analysis = summarizePixels(context.getImageData(0, 0, width, height).data, width, height);
    analysis.prompt =
      "参考图外观量化（必须落实到当前机位的室内表面）：" + analysis.summary + "。" +
      "图1仅定义结构与几何，图1原有的色温、灯光、表面颜色和明暗关系不得作为外观基准，必须按参考图重新布光和着色。" +
      (analysis.cooling
        ? "参考图存在明显冷色环境光，应把冷色覆盖到墙面、顶面、家具暗面、地面反射和室内阴影，不能只让窗户或室外呈蓝色。"
        : "参考图的整体明暗、高光位置和色温关系必须进入室内表面，不能只作用于窗外背景。");
    analysis.atmospherePrompt =
      "参考图光影量化（只接管光影与氛围）：" + analysis.summary + "。" +
      "把参考图的色温、曝光、对比、环境色、阴影和高光关系应用到当前机位，但不得替换图1的材质种类、纹理和表面颜色。" +
      (analysis.cooling
        ? "冷色应作为环境光和阴影色进入室内，不能靠更换墙面或家具材质来伪装。"
        : "保留图1材质本色，只调整其受光后的明暗、反射和环境色关系。");
    return analysis;
  }

  async function conditionImage(sourceURL, referenceURL, options = {}) {
    if (!sourceURL || !referenceURL) return sourceURL || "";
    const [source, reference] = await Promise.all([
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = sourceURL;
      }),
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = referenceURL;
      })
    ]);
    const maxEdge = clamp(Math.round(Number(options.maxEdge) || 2048), 512, 3072);
    const scale = Math.min(1, maxEdge / Math.max(source.naturalWidth || 1, source.naturalHeight || 1));
    const width = Math.max(1, Math.round((source.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((source.naturalHeight || 1) * scale));
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceContext.drawImage(source, 0, 0, width, height);
    const sourceImage = sourceContext.getImageData(0, 0, width, height);

    const sampleEdge = 96;
    const sampleScale = Math.min(1, sampleEdge / Math.max(reference.naturalWidth || 1, reference.naturalHeight || 1));
    const sampleWidth = Math.max(1, Math.round((reference.naturalWidth || 1) * sampleScale));
    const sampleHeight = Math.max(1, Math.round((reference.naturalHeight || 1) * sampleScale));
    const referenceCanvas = document.createElement("canvas");
    referenceCanvas.width = sampleWidth;
    referenceCanvas.height = sampleHeight;
    const referenceContext = referenceCanvas.getContext("2d", { willReadFrequently: true });
    referenceContext.drawImage(reference, 0, 0, sampleWidth, sampleHeight);
    const referenceImage = referenceContext.getImageData(0, 0, sampleWidth, sampleHeight);

    sourceImage.data.set(matchPalettePixels(
      sourceImage.data,
      labStats(sourceImage.data),
      labStats(referenceImage.data),
      options.strength == null ? .68 : options.strength
    ));
    sourceContext.putImageData(sourceImage, 0, 0);
    return sourceCanvas.toDataURL("image/png");
  }

  return {
    summarizePixels,
    rgbToLab,
    labToRgb,
    labStats,
    matchPalettePixels,
    tintPixels,
    analyze,
    conditionImage
  };
});
