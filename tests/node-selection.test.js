const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('persistent feature panels preserve and extend canvas multi-selection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');

  assert.match(
    source,
    /if \(!event\.ctrlKey && !event\.metaKey && !selection\(\)\.includes\(k\)\) select\(k\);/
  );
  assert.match(
    source,
    /if \(event\.ctrlKey \|\| event\.metaKey\) toggleNodeSelection\(k\);\s*else if \(!selection\(\)\.includes\(k\)\) select\(k\);/
  );
  assert.match(
    source,
    /if \(event\.button !== 0\) return;\s*if \(event\.ctrlKey \|\| event\.metaKey\) return;\s*if \(event\.altKey\) \{/
  );
});

test('selection keeps ordinary node shadows and enables batch image resizing', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const glowStart = source.indexOf('function applyNodeGlowStyle');
  const glowEnd = source.indexOf('function updateImageSelectionGlow', glowStart);
  const glowSource = glowStart >= 0 && glowEnd > glowStart
    ? source.slice(glowStart, glowEnd)
    : '';

  assert.ok(glowSource);
  assert.doesNotMatch(glowSource, /shadowEnabled\(false\)/);
  assert.match(source, /function canResizeNodeSelection\(list, blocked = false\)/);
  assert.match(source, /tr\.resizeEnabled\(canResizeNodeSelection\(sel, onlyErrors\)\)/);
});
