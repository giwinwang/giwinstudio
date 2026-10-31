// 设备 ID 的稳定性。
//
// 事故：用户反馈"每次打开开发版都要重新激活"。
// 根因不是许可证过期，而是设备 ID 会漂移——正常路径读注册表 MachineGuid 算 ID，
// 但 reg.exe 会被安全软件拦截 / 超时，一失败就落到 hostname+username 那套兜底种子，
// 算出另一个 ID，已激活的许可证当场判定为"设备不匹配"。
// 同机上出现两个 ID：GW-5F67-91B4-1BCD-50B9（真实）与 GW-89BA-DBE5-0710-2384（兜底）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const licenseCore = require(path.join(root, 'license-core.js'));

const REAL_MACHINE_GUID = 'a84ee2c2-36b5-4ba5-b2a8-473a98f06a5b';
const FALLBACK_SEED = 'GIWINDESIGN|GIWIN DESIGN|win32|x64';

test('两套种子算出完全不同的设备 ID，所以读失败不能换种子', () => {
  const stable = licenseCore.createDeviceId(REAL_MACHINE_GUID);
  const fallback = licenseCore.createDeviceId(FALLBACK_SEED);
  assert.equal(stable, 'GW-5F67-91B4-1BCD-50B9');
  assert.equal(fallback, 'GW-89BA-DBE5-0710-2384');
  assert.notEqual(stable, fallback);
});

test('机器标识落盘缓存，reg.exe 偶发失败也不再漂移', () => {
  assert.match(MAIN, /machine-id\.json/);
  assert.match(MAIN, /function readCachedMachineIdentifier/);
  assert.match(MAIN, /function rememberMachineIdentifier/);
  assert.match(MAIN, /rememberMachineIdentifier\(cachedMachineIdentifier\)/);
});

test('读机器标识时磁盘缓存优先于 reg.exe', () => {
  const start = MAIN.indexOf('function readMachineIdentifier()');
  assert.ok(start > 0, 'main.js 缺少 readMachineIdentifier');
  const body = MAIN.slice(start, MAIN.indexOf('\nfunction ', start + 1));
  const persistedAt = body.indexOf('readCachedMachineIdentifier()');
  const regAt = body.indexOf("'reg.exe'");   // 带引号=真实调用，注释里的不算
  assert.ok(persistedAt > 0 && regAt > persistedAt, '磁盘缓存必须排在 reg.exe 之前');
});

test('兜底种子在磁盘上存下来就等于把错误的设备 ID 钉死，所以不写缓存', () => {
  const start = MAIN.indexOf('function readMachineIdentifier()');
  const body = MAIN.slice(start, MAIN.indexOf('\nfunction ', start + 1));
  const tail = body.slice(body.indexOf('os.hostname()'));
  assert.ok(tail.length > 0, '缺少 hostname 兜底');
  assert.doesNotMatch(tail, /rememberMachineIdentifier/, '兜底分支不能写缓存');
});
