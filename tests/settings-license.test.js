const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('license settings do not call the removed cycle helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.doesNotMatch(source, /\bapplyCycle\s*\(/);
  assert.doesNotMatch(source, /\binitialCycle\b/);
});
