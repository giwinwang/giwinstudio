(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GWPanoramaRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULT_FOV = 70;
  const DEFAULT_RADIUS = 12;
  const MAX_PROJECTION_EDGE = 4096;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const radians = degrees => degrees * Math.PI / 180;
  const wrap = (value, size) => ((value % size) + size) % size;
  const smoothstep = value => value * value * (3 - 2 * value);

  function poleCoordinates(pole, size, fov = DEFAULT_FOV) {
    if (pole !== "top" && pole !== "bottom") throw new Error("未知极点");
    const extent = Math.tan(radians(fov) / 2);
    const xx = new Float32Array(size * size);
    const yy = new Float32Array(size * size);
    const angle = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const cy = (2 * (y + 0.5) / size - 1) * extent;
      for (let x = 0; x < size; x++) {
        const cx = (2 * (x + 0.5) / size - 1) * extent;
        const index = y * size + x;
        xx[index] = cx;
        yy[index] = cy;
        angle[index] = Math.atan(Math.hypot(cx, cy));
      }
    }
    return { xx, yy, angle, extent };
  }

  function createPoleMask(size, radius = DEFAULT_RADIUS, fov = DEFAULT_FOV) {
    const coordinates = poleCoordinates("top", size, fov);
    const mask = new Uint8Array(size * size);
    const limit = radians(radius);
    for (let index = 0; index < mask.length; index++) {
      mask[index] = coordinates.angle[index] < limit ? 255 : 0;
    }
    return mask;
  }

  function sampleBilinear(data, width, height, x, y, wrapX) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const left = wrapX ? wrap(x0, width) : clamp(x0, 0, width - 1);
    const right = wrapX ? wrap(x0 + 1, width) : clamp(x0 + 1, 0, width - 1);
    const top = clamp(y0, 0, height - 1);
    const bottom = clamp(y0 + 1, 0, height - 1);
    const i00 = (top * width + left) * 4;
    const i10 = (top * width + right) * 4;
    const i01 = (bottom * width + left) * 4;
    const i11 = (bottom * width + right) * 4;
    const oneX = 1 - tx;
    const oneY = 1 - ty;
    return [
      data[i00] * oneX * oneY + data[i10] * tx * oneY + data[i01] * oneX * ty + data[i11] * tx * ty,
      data[i00 + 1] * oneX * oneY + data[i10 + 1] * tx * oneY + data[i01 + 1] * oneX * ty + data[i11 + 1] * tx * ty,
      data[i00 + 2] * oneX * oneY + data[i10 + 2] * tx * oneY + data[i01 + 2] * oneX * ty + data[i11 + 2] * tx * ty,
      data[i00 + 3] * oneX * oneY + data[i10 + 3] * tx * oneY + data[i01 + 3] * oneX * ty + data[i11 + 3] * tx * ty
    ];
  }

  function projectionSource(source) {
    const width = source.width || source.naturalWidth || 0;
    const height = source.height || source.naturalHeight || 0;
    if (!width || !height) throw new Error("全景图片尺寸不可用");
    const scale = Math.min(1, MAX_PROJECTION_EDGE / Math.max(width, height));
    if (scale >= 0.999999) {
      const context = source.getContext("2d", { willReadFrequently: true });
      return { width, height, data: context.getImageData(0, 0, width, height).data };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return {
      width: canvas.width,
      height: canvas.height,
      data: context.getImageData(0, 0, canvas.width, canvas.height).data
    };
  }

  function projectPole(source, pole, options = {}) {
    const size = clamp(Math.round(Number(options.size) || 1024), 256, 2048);
    const fov = clamp(Number(options.fov) || DEFAULT_FOV, 40, 110);
    const image = projectionSource(source);
    const coordinates = poleCoordinates(pole, size, fov);
    const out = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = y * size + x;
        const longitude = Math.atan2(
          coordinates.xx[index],
          pole === "top" ? -coordinates.yy[index] : coordinates.yy[index]
        );
        const mapX = (longitude / (2 * Math.PI) + 0.5) * image.width - 0.5;
        let mapY = coordinates.angle[index] / Math.PI * image.height - 0.5;
        if (pole === "bottom") mapY = image.height - 1 - mapY;
        const sample = sampleBilinear(image.data, image.width, image.height, mapX, mapY, true);
        const offset = index * 4;
        out[offset] = Math.round(sample[0]);
        out[offset + 1] = Math.round(sample[1]);
        out[offset + 2] = Math.round(sample[2]);
        out[offset + 3] = Math.round(sample[3]);
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d").putImageData(new ImageData(out, size, size), 0, 0);
    return canvas;
  }

  function paintMask(mask, size, options = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);
    for (let index = 0; index < mask.length; index++) {
      const value = mask[index];
      image.data[index * 4] = value;
      image.data[index * 4 + 1] = value;
      image.data[index * 4 + 2] = value;
      image.data[index * 4 + 3] = options.transparentOutside ? value : 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  function createPoleRepairSheet(source, options = {}) {
    const size = clamp(Math.round(Number(options.size) || 1024), 256, 2048);
    const radius = clamp(Number(options.radius) || DEFAULT_RADIUS, 6, 24);
    const fov = clamp(Number(options.fov) || DEFAULT_FOV, 40, 110);
    const top = projectPole(source, "top", { size, fov });
    const bottom = projectPole(source, "bottom", { size, fov });
    const sheet = document.createElement("canvas");
    sheet.width = size * 2;
    sheet.height = size;
    const sheetContext = sheet.getContext("2d");
    sheetContext.drawImage(top, 0, 0);
    sheetContext.drawImage(bottom, size, 0);

    const maskTile = paintMask(createPoleMask(size, radius, fov), size);
    const mask = document.createElement("canvas");
    mask.width = size * 2;
    mask.height = size;
    const maskContext = mask.getContext("2d");
    maskContext.fillStyle = "#000";
    maskContext.fillRect(0, 0, mask.width, mask.height);
    maskContext.drawImage(maskTile, 0, 0);
    maskContext.drawImage(maskTile, size, 0);

    const overlay = document.createElement("canvas");
    overlay.width = size * 2;
    overlay.height = size;
    const overlayContext = overlay.getContext("2d");
    overlayContext.drawImage(sheet, 0, 0);
    const redMaskTile = paintMask(
      createPoleMask(size, radius, fov),
      size,
      { transparentOutside: true }
    );
    const redContext = redMaskTile.getContext("2d");
    redContext.globalCompositeOperation = "source-in";
    redContext.fillStyle = "#ff3b30";
    redContext.fillRect(0, 0, size, size);
    overlayContext.globalAlpha = 0.48;
    overlayContext.drawImage(redMaskTile, 0, 0);
    overlayContext.drawImage(redMaskTile, size, 0);
    overlayContext.globalAlpha = 1;

    return { sheet, mask, overlay, top, bottom, size, radius, fov };
  }

  function splitRepairSheet(result, size) {
    const source = document.createElement("canvas");
    source.width = size * 2;
    source.height = size;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = "high";
    sourceContext.drawImage(result, 0, 0, source.width, source.height);
    const top = document.createElement("canvas");
    const bottom = document.createElement("canvas");
    top.width = bottom.width = size;
    top.height = bottom.height = size;
    top.getContext("2d").drawImage(source, 0, 0, size, size, 0, 0, size, size);
    bottom.getContext("2d").drawImage(source, size, 0, size, size, 0, 0, size, size);
    return { top, bottom };
  }

  function compositePole(target, repaired, pole, options = {}) {
    if (pole !== "top" && pole !== "bottom") throw new Error("未知极点");
    const radius = clamp(Number(options.radius) || DEFAULT_RADIUS, 6, 24);
    const fov = clamp(Number(options.fov) || DEFAULT_FOV, 40, 110);
    const width = target.width;
    const height = target.height;
    const size = repaired.width;
    if (!size || repaired.height !== size) throw new Error("修复极点图必须为正方形");
    const targetContext = target.getContext("2d", { willReadFrequently: true });
    const repairedContext = repaired.getContext("2d", { willReadFrequently: true });
    const image = targetContext.getImageData(0, 0, width, height);
    const patch = repairedContext.getImageData(0, 0, size, size).data;
    const limit = radians(radius);
    const feather = radians(Math.max(2, radius / 6));
    const extent = Math.tan(radians(fov) / 2);
    const band = Math.min(height, Math.ceil(height * radius / 180));
    for (let row = 0; row < band; row++) {
      const y = pole === "top" ? row : height - 1 - row;
      const distance = (row + 0.5) * Math.PI / height;
      if (distance >= limit) continue;
      const radial = Math.tan(distance);
      const weight = smoothstep(clamp((limit - distance) / feather, 0, 1));
      for (let x = 0; x < width; x++) {
        const longitude = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
        const vertical = radial * Math.cos(longitude) * (pole === "top" ? -1 : 1);
        const horizontal = radial * Math.sin(longitude);
        const mapX = (horizontal / extent + 1) * size / 2 - 0.5;
        const mapY = (vertical / extent + 1) * size / 2 - 0.5;
        const sample = sampleBilinear(patch, size, size, mapX, mapY, false);
        const index = (y * width + x) * 4;
        image.data[index] = Math.round(image.data[index] * (1 - weight) + sample[0] * weight);
        image.data[index + 1] = Math.round(image.data[index + 1] * (1 - weight) + sample[1] * weight);
        image.data[index + 2] = Math.round(image.data[index + 2] * (1 - weight) + sample[2] * weight);
      }
    }
    targetContext.putImageData(image, 0, 0);
    return target;
  }

  function compositePoleSheet(target, resultSheet, options = {}) {
    const size = clamp(Math.round(Number(options.size) || 1024), 256, 2048);
    const radius = clamp(Number(options.radius) || DEFAULT_RADIUS, 6, 24);
    const fov = clamp(Number(options.fov) || DEFAULT_FOV, 40, 110);
    const patches = splitRepairSheet(resultSheet, size);
    compositePole(target, patches.top, "top", { radius, fov });
    compositePole(target, patches.bottom, "bottom", { radius, fov });
    return target;
  }

  return {
    DEFAULT_FOV,
    DEFAULT_RADIUS,
    poleCoordinates,
    createPoleMask,
    projectPole,
    createPoleRepairSheet,
    splitRepairSheet,
    compositePole,
    compositePoleSheet
  };
});
