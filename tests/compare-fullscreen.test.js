const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('compare view exposes double-click fullscreen and Escape exits fullscreen first', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(html, /id="compare-fullscreen"/);
  assert.match(canvas, /addEventListener\('dblclick',\s*event\s*=>\s*\{[\s\S]*?toggleCompareFullscreen\(\)/);
  assert.match(canvas, /openCompareNodeFullscreen\(group\)/);
  assert.match(canvas, /k\.gwType === 'compare'\) openCompareNodeFullscreen\(k\)/);
  assert.match(canvas, /if \(compareFullscreenActive\(\)\)\s*\{[\s\S]*?setCompareFullscreen\(false\)/);
  assert.match(canvas, /function closeComparePanel\(\)/);
  assert.match(canvas, /window:set-fullscreen/);
  assert.match(main, /ipcMain\.handle\('window:set-fullscreen'/);
  assert.match(main, /win\.setFullScreen\(enabled === true\)/);
});
