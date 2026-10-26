const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');

test('safe render mode follows actual GPU failures rather than unclean exits', () => {
  assert.match(main, /const safeRenderMode = forcedSafeMode \|\| previousGpuFailureCount >= 3;/);
  assert.doesNotMatch(main, /safeRenderMode = forcedSafeMode \|\| uncleanStarts >= 3/);
  assert.match(main, /function recordGpuProcessFailure\(details\)/);
  assert.match(main, /details\.type.*gpu/i);
});

test('a clean exit clears the automatic software-rendering fallback', () => {
  assert.match(main, /const retainedGpuFailureCount = safeRenderMode[\s\S]*\? 0[\s\S]*safeRenderMode,/);
});
