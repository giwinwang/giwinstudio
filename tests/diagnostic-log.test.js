'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets, tailLines } = require('../diagnostic-log');

test('diagnostic logs redact common credentials', () => {
  const text = [
    'Authorization: Bearer abc.def.ghi',
    'apiKey=sk-1234567890abcdef',
    '{"access_token":"secret-token"}',
    'https://example.com/?api_key=hidden-value'
  ].join('\n');
  const redacted = redactSecrets(text);
  assert.doesNotMatch(redacted, /abc\.def\.ghi|1234567890abcdef|secret-token|hidden-value/);
  assert.match(redacted, /Authorization: \[已隐藏\]/);
});

test('diagnostic tail keeps the newest bounded content', () => {
  const text = Array.from({ length: 80 }, (_, index) => 'line-' + index).join('\n');
  const tail = tailLines(text, 20, 5000);
  assert.doesNotMatch(tail, /line-59\b/);
  assert.match(tail, /line-79$/);
});
