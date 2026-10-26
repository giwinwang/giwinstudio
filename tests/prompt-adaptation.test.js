const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = {};
global.localStorage = {
  _data: {},
  getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
  setItem(key, value) { this._data[key] = String(value); },
  removeItem(key) { delete this._data[key]; }
};
require('../model-tuning.js');
require('../providers.js');

const P = global.window.GWProviders;
const root = path.resolve(__dirname, '..');
const canvas = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');

test('shared prompt compiler formats the same structured fields for each model family', () => {
  const sections = [
    { title: '结构', value: '墙体、门窗和家具位置不变', priority: 100 },
    { title: '灯光', value: '关闭全部人工照明', priority: 110 }
  ];
  const natural = P.composePromptSections('apollo', 'nano-banana-2', 'render', sections);
  const keyword = P.composePromptSections('volc', 'doubao-seedream-5-0-pro-260628', 'render', sections);
  const structured = P.composePromptSections('apollo', 'gpt-image-2', 'render', sections);

  assert.match(natural, /灯光：关闭全部人工照明。/);
  assert.match(keyword, /【灯光】关闭全部人工照明；\n【结构】/);
  assert.match(structured, /【灯光】\n关闭全部人工照明/);
  assert.notEqual(natural, keyword);
  assert.notEqual(keyword, structured);
});

test('space, text-to-image, plan, material and reroll prompts use the shared adapter', () => {
  assert.match(canvas, /function planPromptText[\s\S]*composePromptSections\(params && params\.engineId/);
  assert.match(canvas, /function buildTextToImagePrompt[\s\S]*composePromptSections\(params\.engineId, params\.model/);
  assert.match(canvas, /function materialPromptText[\s\S]*composePromptSections\(engineId \|\| 'apollo'/);
  assert.match(canvas, /function lightPromptText[\s\S]*renderLightPrompt/);
  assert.match(canvas, /function curRecipeFrom\(R\)[\s\S]*engineId: R\.engineId,[\s\S]*model: R\.model/);
  assert.match(canvas, /function rerollConsistencyPrompt[\s\S]*renderLightPrompt/);
});

test('generation context persists lighting state for rerolls', () => {
  assert.match(canvas, /lightConfig: lightConfig \? clonePlain\(lightConfig\) : null/);
  assert.match(canvas, /const light = context\.lightConfig && window\.GWProviders/);
});
