const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('no-project actions keep both labeled buttons on one line', () => {
  assert.match(html, /\.canvas-project-actions \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto auto;/);
  assert.match(html, /\.canvas-project-actions input \{ min-width:0; \}/);
  assert.match(html, /\.canvas-project-actions \.btn \{[^}]*white-space:nowrap;/);
  assert.match(html, /<div class="canvas-project-actions">/);
});
