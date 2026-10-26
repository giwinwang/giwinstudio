'use strict';

function redactSecrets(value) {
  return String(value || '')
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Authorization: [已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[已隐藏]')
    .replace(/\bAIza[A-Za-z0-9_-]{16,}\b/g, 'AIza[已隐藏]')
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token)\s*["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[已隐藏]')
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&\s]+/gi, '$1[已隐藏]');
}

function tailLines(value, maxLines = 500, maxChars = 180000) {
  const text = redactSecrets(value);
  const clipped = text.length > maxChars ? text.slice(-maxChars) : text;
  const lines = clipped.split(/\r?\n/);
  return lines.slice(-Math.max(20, maxLines)).join('\n').trim();
}

module.exports = { redactSecrets, tailLines };
