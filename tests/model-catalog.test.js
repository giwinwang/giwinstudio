const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('engine settings expose model catalog sync and availability checks', () => {
  const app = read('app.js');
  const providers = read('providers.js');
  const canvas = read('canvas.js');
  const index = read('index.html');

  assert.match(providers, /const MODEL_CATALOG_PREFIX = 'gw_models_'/);
  assert.match(providers, /async function syncModels/);
  assert.match(providers, /function modelAvailability/);
  assert.match(app, /id="eng-catalog-state"/);
  assert.match(app, /id="eng-sync-models"/);
  assert.match(app, /P\.syncModels\(cur\)/);
  assert.ok((canvas.match(/P\.modelsForEngine/g) || []).length >= 7);
  assert.match(index, /\.engine-catalog-row \{ display:flex;/);
  assert.doesNotMatch(app, /filter\(key => key\.startsWith\('gw_models_'\)\)\s*\.forEach\(key => localStorage\.removeItem\(key\)\)/);
});
