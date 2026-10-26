const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const icons = fs.readFileSync(path.resolve(__dirname, '..', 'icons.js'), 'utf8');

test('settings use full social brand icons without losing the book mark for Xiaohongshu', () => {
  assert.match(icons, /douyin: '<path fill="currentColor" stroke="none"/);
  assert.match(icons, /wechat: '<path fill="currentColor" stroke="none"/);
  assert.match(icons, /bilibili: '<path fill="currentColor" stroke="none"/);
  assert.match(icons, /xiaohongshuBook: '<rect[^']*<text[^']*>书<\/text>/);
});
