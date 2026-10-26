const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('activation screen accepts a pasted code while retaining legacy file import', () => {
  const html = read('index.html');
  const app = read('app.js');
  const main = read('main.js');
  assert.match(html, /id="license-gate-code"/);
  assert.match(html, /id="license-gate-activate"/);
  assert.match(html, /id="license-gate-inviter"/);
  assert.match(html, /id="license-gate-import"/);
  assert.match(app, /ipcRenderer\.invoke\('license:activate'/);
  assert.match(app, /id="set-license-code"/);
  assert.match(app, /id="set-invite-code"/);
  assert.match(app, /license:redeemInviteReward/);
  assert.match(main, /ipcMain\.handle\('license:activate'/);
  assert.match(main, /ipcMain\.handle\('license:redeemInviteReward'/);
  assert.match(main, /licenseCore\.parseActivationCode/);
  assert.match(main, /licenseCore\.verifyActivationCode/);
  assert.match(main, /activationCode: parsed\.compact/);
  assert.match(main, /summarizeInviteRewards/);
  assert.match(main, /installLicenseEnvelope/);
  assert.match(main, /legacyInstallDeviceId/);
});
