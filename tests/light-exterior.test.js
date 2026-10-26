const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('light panel exposes exterior presets, preview and shared upload paths', () => {
  const canvas = read('canvas.js');
  const providers = read('providers.js');
  const html = read('index.html');
  const studio = read('studio-tools.js');

  assert.match(canvas, /const LIGHT_EXTERIOR_PRESETS = Object\.freeze\(\[/);
  assert.match(canvas, /const LIGHT_PRESET_EXTERIOR_MAP = Object\.freeze\(/);
  assert.match(canvas, /city-dusk/);
  assert.match(canvas, /mountain-mist/);
  assert.match(canvas, /海洋|ocean-noon/);
  assert.match(canvas, /data-light-exterior-preview/);
  assert.match(canvas, /data-light-exterior-file/);
  assert.match(canvas, /data-light-exterior-drop/);
  assert.match(canvas, /data-light-exterior-affect/);
  assert.doesNotMatch(canvas, /data-light-exterior-upload/);
  assert.match(canvas, /function applyLightExteriorDataURL/);
  assert.match(canvas, /function applyLightExteriorPresetToLight/);
  assert.match(canvas, /function assignAssetImagesToLightExterior/);
  assert.match(canvas, /exteriorReferenceDataURL/);
  assert.match(canvas, /外景联动光影/);
  assert.match(providers, /外景色温、明暗和环境色只影响窗边自然光、室内阴影和环境反射/);
  assert.match(canvas, /lightPresetId: 'dusk'/);
  assert.match(studio, /data-light-exterior-drop/);
  assert.match(html, /\.light-exterior-preview/);
  assert.match(canvas, /data-light-mode/);
  assert.match(canvas, /data-light-fixture/);
  assert.match(canvas, /lightingMode: 'auto'/);
  assert.match(canvas, /headerSummary\.textContent = lightSummary\(k\)/);
  assert.match(providers, /function renderLightPrompt/);
});

test('rainy weather changes lighting without requesting rain particles or wet surfaces', () => {
  const canvas = read('canvas.js');
  const providers = read('providers.js');

  assert.match(providers, /不表现雨滴、水珠、雨丝、水幕、积水或湿面/);
  assert.match(providers, /全部室内区域必须干燥/);
  assert.doesNotMatch(providers, /窗外有雨幕/);
  assert.doesNotMatch(canvas, /雨幕与少量水珠只允许/);
  assert.doesNotMatch(canvas, /雨天氛围，窗外雨幕与水珠，室内暖光对比/);
});
