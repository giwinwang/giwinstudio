const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('bundled commercial fonts and license are present', () => {
  for (const file of [
    'fonts/GIWIN-Sans-Regular.otf',
    'fonts/GIWIN-Sans-Medium.otf',
    'fonts/GIWIN-Sans-Bold.otf',
    'fonts/GIWIN-Serif-Bold.ttf',
    'fonts/OFL.txt'
  ]) {
    const stat = fs.statSync(path.join(root, file));
    assert.ok(stat.size > 1000, file);
  }
});

test('UI and canvas nodes use the bundled brand font', () => {
  const index = read('index.html');
  assert.match(index, /--font-ui:"GIWIN Sans"/);
  assert.match(index, /--node-font: "GIWIN Sans"/);
  assert.match(read('canvas.js'), /GIWIN Sans/);
  assert.match(read('studio-tools.js'), /GIWIN Sans/);
  assert.match(read('canvas.js'), /"GIWIN Serif"/);
});

test('splash logo and wordmark use separate subtle shadows in both themes', () => {
  const index = read('index.html');
  assert.match(index, /\.splash-logo img \{[^}]*filter:drop-shadow\(0 2px 3px rgba\(50,44,43,\.15\)\)/);
  assert.match(index, /\.splash-cn \{[^}]*text-shadow:0 1px 2px rgba\(50,44,43,\.11\)/);
  assert.match(index, /:root\[data-theme="dark"\] \.splash-logo img \{[^}]*drop-shadow\(0 2px 4px rgba\(0,0,0,\.48\)\)/);
  assert.match(index, /:root\[data-theme="dark"\] \.splash-cn \{[^}]*text-shadow:0 1px 2px rgba\(0,0,0,\.54\)/);
});
