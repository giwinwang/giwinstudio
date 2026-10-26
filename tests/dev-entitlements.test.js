const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const copilot = fs.readFileSync(path.join(root, 'copilot.js'), 'utf8');

test('development entitlement simulation is gated behind an explicit launch flag', () => {
  assert.match(main, /process\.argv\.includes\('--dev-entitlements'\)/);
  assert.match(main, /rendererArguments\.push\('--gw-dev-entitlements'\)/);
  assert.match(main, /additionalArguments: rendererArguments/);
  assert.match(main, /ipcMain\.handle\('dev:entitlement-mode'/);
  assert.match(main, /const devTeam = devEntitlementsEnabled && devEntitlementMode === 'team';/);
  assert.match(app, /process\.argv\.includes\('--gw-dev-entitlements'\)/);
  assert.match(app, /if \(!DEV_ENTITLEMENTS_ENABLED\) return source;/);
});

test('development entitlement simulation offers beta and full team modes', () => {
  assert.match(app, /beta: '内测未订阅'/);
  assert.match(app, /team: '团队全部功能'/);
  assert.match(app, /const edition = devEntitlementMode === 'team' \? 'team' : 'beta';/);
  assert.match(app, /return tier\.plan === 'pro' \|\| tier\.plan === 'team';/);
});

test('particle cube follows development entitlement and packaged release gates', () => {
  assert.match(app, /const PACKAGED_BUILD = process\.argv\.includes\('--gw-packaged'\);/);
  assert.match(app, /copilotButton\.dataset\.gwLocked = lockReason;/);
  assert.match(app, /devEntitlementMode !== 'team' \? 'beta' : ''/);
  assert.match(copilot, /const lockReason = \$\('copilot-launch'\)\.dataset\.gwLocked \|\| '';/);
  assert.match(copilot, /粒子魔方将在后续版本开放/);
});

test('development entitlement controls are hidden by default', () => {
  assert.match(html, /id="dev-entitlement-badge"[^>]*hidden/);
  assert.match(html, /id="um-dev-entitlement"[^>]*hidden/);
  assert.match(app, /data-dev-entitlement="beta"/);
  assert.match(app, /data-dev-entitlement="team"/);
});
