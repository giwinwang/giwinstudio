const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop close flow protects dirty projects and running tasks', () => {
  const main = read('main.js');
  const app = read('app.js');
  const canvas = read('canvas.js');
  const index = read('index.html');

  assert.match(main, /win\.on\('close', event => \{[\s\S]*window:request-close/);
  assert.match(main, /ipcMain\.handle\('window:force-close'/);
  assert.match(main, /TAOBAO_QUIT_FLUSH_TIMEOUT_MS = 1500/);
  assert.match(main, /Promise\.race\(\[flushed, timeout\]\)/);
  assert.match(app, /ipcRenderer\.on\('window:request-close'/);
  assert.match(app, /getRuntimeStats/);
  assert.match(app, /saveForProjectSwitch/);
  assert.match(app, /data-exit="cancel"/);
  assert.match(app, /requestAnimationFrame\(\(\) => cancel\.focus\(\)\)/);
  assert.match(canvas, /pending: pendingVisuals\.length,\s+dirty: canvasDirty/);
  assert.match(index, /\.exit-confirm-actions/);
});

test('last project tab and settings polish stay local to the app window', () => {
  const app = read('app.js');
  const index = read('index.html');
  const icons = read('icons.js');
  const closeProjectTab = app.match(/async function closeProjectTab\(projectId\) \{[\s\S]*?\n\}/);

  assert.ok(closeProjectTab);
  assert.doesNotMatch(closeProjectTab[0], /location\.reload\(\)/);
  assert.match(closeProjectTab[0], /setCanvasProjectVisibility\(false\)/);
  assert.match(closeProjectTab[0], /openWelcome\(\)\.catch/);
  assert.match(index, /\.project-tab \+ \.project-tab::before \{ content:"";/);
  assert.match(app, /className = 'set-social-links'/);
  for (const icon of ['douyin', 'wechat', 'bilibili', 'xiaohongshuBook']) assert.match(icons, new RegExp(icon + ':'));
  assert.match(index, /\.set-social-links \{[^}]*margin-top:auto;/);
  assert.match(app, /function avatarFeatureUnlocked\(\)/);
  assert.match(app, /if \(!requireAvatarFeature\(\)\) return/);
  assert.match(index, /id="um-avatar-key">订阅/);
  assert.match(read('main.js'), /account:setAvatar[\s\S]*const entitled =[\s\S]*if \(!entitled\) return false/);
  const entries = [...app.matchAll(/\{ id: '([^']+)', label: '[^']+', options: \{([^}]+)\} \}/g)];
  assert.equal(entries.length, 40);
  assert.equal(new Set(entries.map(entry => entry[1])).size, 40);
});

test('release feature switches can hide workflow assets and particle cube', () => {
  const index = read('index.html');
  const canvas = read('canvas.js');
  const studioTools = read('studio-tools.js');
  const copilot = read('copilot.js');
  const copilotCube = read('copilot-cube.js');

  assert.match(index, /#copilot-launch\[hidden\], #copilot-panel\[hidden\]/);
  assert.match(canvas, /dataset\.gwWorkflowAssets === 'disabled'/);
  assert.match(studioTools, /workflowAssetsDisabled/);
  assert.match(copilot, /copilot-launch'\)\.hidden/);
  assert.match(copilotCube, /button\.hidden/);
});
