"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const panorama = require("../panorama-runtime");

test("pole mask is circular and contained", () => {
  const size = 256;
  const mask = panorama.createPoleMask(size, 12, 70);
  assert.equal(mask.length, size * size);
  assert.equal(mask[(size / 2) * size + size / 2], 255);
  assert.equal(mask[0], 0);
  const count = mask.reduce((total, value) => total + (value ? 1 : 0), 0);
  assert.ok(count > 0);
  assert.ok(count < mask.length * 0.1);
});

test("pole coordinates use pixel centres and remain finite", () => {
  const result = panorama.poleCoordinates("bottom", 128, 70);
  assert.equal(result.xx.length, 128 * 128);
  assert.equal(result.yy.length, 128 * 128);
  assert.ok(result.xx.every(Number.isFinite));
  assert.ok(result.yy.every(Number.isFinite));
  assert.ok(result.angle.every(value => value >= 0));
  assert.ok(Math.abs(result.xx[64 * 128 + 64]) < 0.02);
  assert.ok(Math.abs(result.yy[64 * 128 + 64]) < 0.02);
});
