const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const studioTools = read('studio-tools.js');
const canvas = read('canvas.js');
const html = read('index.html');

test('workflow assets share the same subscription rule as avatar customization', () => {
  assert.match(app, /function workflowAssetsUnlocked\(\) \{\s*const tier = accountTierInfo\(licenseState\);\s*return \(tier\.plan === 'pro' \|\| tier\.plan === 'studio' \|\| tier\.plan === 'dev'\);/);
  assert.match(app, /function notifyWorkflowAssetsRequired\(\)/);
  assert.match(app, /资产库工作流为订阅功能/);
  assert.match(app, /function requireWorkflowAssetsFeature\(\)/);
});

test('body gate flag has exactly one writer: app.js license sync', () => {
  const writers = [
    ['app.js', app],
    ['studio-tools.js', studioTools],
    ['canvas.js', canvas]
  ].filter(([, source]) => /dataset\.gwWorkflowAssets\s*=(?!=)/.test(source)).map(([file]) => file);
  assert.deepEqual(writers, ['app.js']);
  assert.match(app, /document\.body\.dataset\.gwWorkflowAssets = 'disabled'/);
  assert.match(app, /delete document\.body\.dataset\.gwWorkflowAssets/);
  assert.match(app, /syncDevEntitlementControls\(\);\s*syncWorkflowAssetsGate\(\);\s*\}/);
  assert.match(app, /\}\s*\/\/ 启动即锁[\s\S]{0,80}syncWorkflowAssetsGate\(\);/);
});

test('locked workflow tab is visibly marked and explains itself on click', () => {
  assert.match(app, /classList\.toggle\('is-locked', locked\)/);
  assert.match(app, /button\.setAttribute\('aria-disabled', locked \? 'true' : 'false'\)/);
  assert.match(html, /\.asset-scope-tabs button\.is-locked/);
  assert.match(studioTools, /if \(button\.dataset\.assetScope === 'workflow' && workflowAssetsDisabled\(\)\) \{\s*if \(window\.GW_requireWorkflowAssets\) window\.GW_requireWorkflowAssets\(\);/);
  assert.match(canvas, /dataset\.gwWorkflowAssets === 'disabled'\) \{\s*if \(window\.GW_requireWorkflowAssets\) window\.GW_requireWorkflowAssets\(\);/);
});

test('locked workflow view falls back to general assets and export skips workflow records', () => {
  assert.match(studioTools, /let assetView = workflowAssetsDisabled\(\) \? 'assets' : 'workflows';/);
  assert.match(studioTools, /if \(workflowAssetsDisabled\(\) && assetView === 'workflows'\) assetView = 'assets';/);
  assert.match(studioTools, /const exportable = locked \? list\.filter\(item => !item\.graph\) : list;/);
  assert.match(studioTools, /if \(workflowAssetsDisabled\(\) && item && item\.graph\) \{ skippedWorkflows\+\+; continue; \}/);
  assert.match(studioTools, /跳过 ' \+ skippedWorkflows \+ ' 个工作流（订阅功能）/);
});

test('development simulation still unlocks workflow assets through the team edition', () => {
  assert.match(app, /const edition = devEntitlementMode === 'team' \? 'team' : 'beta';/);
  assert.match(app, /if \(\/\^\(studio\|team\|enterprise\)\$\/\.test\(edition\)\) return \{ plan: 'studio'/);
  assert.match(app, /window\.GW_requireWorkflowAssets = requireWorkflowAssetsFeature;/);
});
