const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('released 0.4.27 and the development branch use distinct versions', () => {
  assert.equal(packageJSON.version, '0.4.28-dev.5');
  assert.equal(packageLock.version, '0.4.28-dev.5');
  assert.equal(packageLock.packages[''].version, '0.4.28-dev.5');
  assert.notEqual(packageJSON.version, '0.4.27');
});

test('the removed workflow shortcut is not advertised in shortcut help', () => {
  assert.doesNotMatch(app, /Shift<\/kbd>\s*\+\s*<kbd>G/);
  assert.doesNotMatch(app, /建立工作流.*Shift/);
});
