const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('quick start is a lightweight DOM guide with resumable local state', () => {
  const guide = read('onboarding.js');
  const index = read('index.html');

  assert.match(index, /<script src="onboarding\.js"><\/script>/);
  assert.match(index, /id="um-quickstart"/);
  assert.match(index, /#gw-quickstart/);
  assert.match(guide, /const STORAGE_KEY = 'gw_quickstart_v1'/);
  assert.match(guide, /localStorage\.setItem\(STORAGE_KEY/);
  assert.doesNotMatch(guide, /canvas\.json|nodes\s*:\s*steps|projectStore/);
  assert.doesNotMatch(guide, /全景修复|panorama|粒子魔方|copilot-launch/);
});

test('first-run guide teaches the toolbar and completes actions progressively', () => {
  const guide = read('onboarding.js');

  assert.match(guide, /id: 'toolbar'/);
  assert.match(guide, /id: 'import'/);
  assert.match(guide, /id: 'generator'/);
  assert.match(guide, /id: 'generate'/);
  assert.match(guide, /nodesOfType\('image'\)\.length > 0/);
  assert.match(guide, /nodesOfType\('generator'\)\.length > 0/);
  assert.match(guide, /nodesOfType\('variant'\)\.length > 0/);
  assert.match(guide, /这一步完成了，继续下一步/);
});
