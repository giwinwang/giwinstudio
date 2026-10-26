"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { summarizePixels, labStats, matchPalettePixels, tintPixels } = require("../reference-analysis");

test("reference analysis detects cool ambient and extracts a palette", () => {
  const pixels = new Uint8ClampedArray([
    28, 48, 92, 255,
    34, 58, 104, 255,
    118, 136, 172, 255,
    82, 104, 146, 255
  ]);
  const result = summarizePixels(pixels, 2, 2);
  assert.equal(result.tone, "偏冷蓝");
  assert.equal(result.cooling, true);
  assert.match(result.summary, /主色/);
  assert.match(result.summary, /阴影/);
  assert.match(result.summary, /高光/);
  assert.ok(result.dominant.length > 0);
});

test("palette matching moves a neutral structure toward a cool reference", () => {
  const source = new Uint8ClampedArray(Array.from({ length: 16 }, (_, index) => 105 + index * 2).flatMap(value => [
    value, value + 1, value + 2, 255
  ]));
  const reference = new Uint8ClampedArray(Array.from({ length: 16 }, (_, index) => [
    42 + (index % 4) * 9, 72 + (index % 4) * 7, 128 + (index % 4) * 10, 255
  ]).flat());
  const mapped = matchPalettePixels(source, labStats(source), labStats(reference), .8);
  const sum = [0, 0, 0];
  for (let offset = 0; offset < mapped.length; offset += 4) {
    sum[0] += mapped[offset];
    sum[1] += mapped[offset + 1];
    sum[2] += mapped[offset + 2];
  }
  const mean = sum.map(value => value / 16);
  assert.ok(mean[2] > mean[0] + 20);
});

test("material tint follows the target color while preserving texture contrast", () => {
  const source = new Uint8ClampedArray(Array.from({ length: 64 }, (_, index) => {
    const value = 55 + (index % 8) * 22;
    return [value, value, value, 255];
  }).flat());
  const tinted = tintPixels(source, "#8a4b28", .8);
  const mean = [0, 0, 0];
  let min = 255;
  let max = 0;
  for (let offset = 0; offset < tinted.length; offset += 4) {
    mean[0] += tinted[offset];
    mean[1] += tinted[offset + 1];
    mean[2] += tinted[offset + 2];
    const luminance = tinted[offset] * .2126 + tinted[offset + 1] * .7152 + tinted[offset + 2] * .0722;
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }
  assert.ok(mean[0] > mean[1] && mean[1] > mean[2]);
  assert.ok(max - min > 20);
  assert.equal(tinted[3], 255);
});

test("material tint supports hue, saturation and lightness adjustments", () => {
  const source = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]);
  const shifted = tintPixels(source, "#8a4b28", 1, {
    hueShift: 120,
    saturation: 1.35,
    lightnessOffset: .08
  });
  const mean = [0, 1, 2].map(channel =>
    (shifted[channel] + shifted[channel + 4]) / 2
  );
  assert.ok(mean[1] > mean[0], JSON.stringify(mean));
  assert.ok(Math.max(...mean) - Math.min(...mean) > 10);
});
