const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const canvas = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');

test('layout nodes can be created empty and inherit connected design mode', () => {
  assert.doesNotMatch(canvas, /if \(!items\.length && \(!sourceOverride \|\| sourceOverride\.gwType !== 'soft'\)\)/);
  assert.match(canvas, /const designMode = sources\.length \? designModeOfNode\(sources\[0\]\) : DESIGN_MODE_SPACE;/);
  assert.match(canvas, /layout: layoutConfigDefaults\(items, designMode\)/);
  assert.match(canvas, /designMode: planMode \? DESIGN_MODE_PLAN : DESIGN_MODE_SPACE/);
  assert.match(canvas, /if \(options\.openEditor !== false && sources\.length\) openLayoutEditor\(group\);/);
});
