const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const canvas = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const copilot = fs.readFileSync(path.join(root, 'copilot-cube.js'), 'utf8');

test('large projects warm only visible media thumbnails', () => {
  assert.match(canvas, /const LARGE_PROJECT_NODE_THRESHOLD = 80;/);
  assert.match(canvas, /const LARGE_PROJECT_VISIBLE_WARM_LIMIT = 24;/);
  assert.match(canvas, /if \(visibleOnly && !k\.visible\(\)\) return;/);
  assert.match(canvas, /visibleOnly: nodes\.length >= LARGE_PROJECT_NODE_THRESHOLD/);
  assert.match(canvas, /limit: nodes\.length >= LARGE_PROJECT_NODE_THRESHOLD \? LARGE_PROJECT_VISIBLE_WARM_LIMIT : Infinity/);
});

test('large projects defer offscreen layout previews until visible', () => {
  assert.match(canvas, /function shouldRenderLayoutPreview/);
  assert.match(canvas, /if \(nodes\.length < LARGE_PROJECT_NODE_THRESHOLD\) return true;/);
  assert.match(canvas, /if \(!options\.force && !shouldRenderLayoutPreview\(g\)\)/);
  assert.match(canvas, /g\.gwLayoutDirty = true;/);
  assert.match(canvas, /if \(visible && rec\.type === 'layout' && k\.gwLayoutDirty\)/);
  assert.match(canvas, /enqueueLod\(target, largeProject \? 512 : 1024, 8\)/);
});

test('large projects prioritize the canvas over sidebar thumbnail decoding', () => {
  assert.match(canvas, /pauseListThumbnailHydration\(\);/);
  assert.match(canvas, /scheduleListThumbnailHydration\(600\);/);
  assert.match(canvas, /if \(listThumbHydrationPaused\) return;/);
  assert.match(canvas, /if \(viewportGestureActive\(\)\) \{\s*scheduleListThumbnailHydration\(240\);/);
});

test('idle particle decoration runs below display refresh rate', () => {
  assert.match(copilot, /const interactive = this\.hovered \|\| this\.hold/);
  assert.match(copilot, /time - this\.lastPaint < 1000 \/ 30/);
});

test('thumbnail index keeps file URLs instead of preloading base64 payloads', () => {
  const start = main.indexOf('function buildThumbIndex(');
  const end = main.indexOf("ipcMain.handle('img:thumbRead'", start);
  const indexBuilder = main.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(indexBuilder, /tier <= 256/);
  assert.match(indexBuilder, /tier === 32[\s\S]*readFileSync\(imageFile\)\.toString\('base64'\)/);
  assert.match(indexBuilder, /url: pathToFileURL\(imageFile\)\.href/);
  assert.match(indexBuilder, /\(32\|256\|512\|768\|1024\)/);
  assert.match(indexBuilder, /const imageName = thumbFiles\.get/);
  assert.match(indexBuilder, /if \(!tiers\[512\] && tiers\[1024\]\) tiers\[512\] = tiers\[1024\]/);
  assert.match(indexBuilder, /if \(!tiers\[768\] && tiers\[1024\]\) tiers\[768\] = tiers\[1024\]/);
});
