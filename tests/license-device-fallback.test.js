// 设备 ID 的候选集。
//
// 背景：设备 ID 由 MachineGuid 算出，但读它要调 reg.exe，被安全软件拦截或超时
// 就会掉到 hostname 兜底种子上，算出另一个 ID。用户在「读成功那一次」激活，
// 在「读失败那一次」校验，就永远 device_mismatch —— 表现就是每次打开都要激活。
//
// 所以校验不能只认一个 ID，要把两套种子算出来的都试一遍。这里用注入依赖的方式
// 把这段逻辑单独跑起来，不启动 Electron。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const licenseCore = require(path.join(root, 'license-core.js'));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > 0, 'main.js 缺少 ' + name);
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next > 0 ? next : src.length);
}

function loadHelpers(readMachineIdentifier, ensureInstallIdentifier) {
  const code = [
    extractFn(MAIN, 'fallbackMachineIdentifier'),
    extractFn(MAIN, 'machineIdentifierCandidates'),
    extractFn(MAIN, 'legacyInstallDeviceId'),
    extractFn(MAIN, 'deviceIdCandidates'),
    extractFn(MAIN, 'verifyWithDeviceCandidates')
  ].join('\n') + '\nreturn { fallbackMachineIdentifier, machineIdentifierCandidates, deviceIdCandidates, verifyWithDeviceCandidates };';
  const factory = new Function(
    'readMachineIdentifier', 'licenseCore', 'ensureInstallIdentifier',
    'LICENSE_PUBLIC_KEY_PEM', 'os', 'process',
    code
  );
  return factory(
    readMachineIdentifier,
    licenseCore,
    ensureInstallIdentifier,
    'PUBLIC-KEY',
    // 给 fallbackMachineIdentifier 用的最小 os
    { hostname: () => 'TEST-HOST', userInfo: () => ({ username: 'tester' }) },
    { platform: 'win32', arch: 'x64' }
  );
}

const REAL_GUID = 'a84ee2c2-36b5-4ba5-b2a8-473a98f06a5b';
const REAL_ID = licenseCore.createDeviceId(REAL_GUID);

test('读成功：候选里同时有真实机器码与兜底种子，去重后两个', () => {
  const h = loadHelpers(() => REAL_GUID, () => '0123456789abcdef0123456789abcdef');
  const seeds = h.machineIdentifierCandidates();
  assert.equal(seeds.length, 2, '真实机器码和兜底种子都要在候选里');
  assert.equal(seeds[0], REAL_GUID, '真实机器码排第一，展示给用户的仍是它');
  assert.ok(seeds.indexOf('TEST-HOST|tester|win32|x64') > 0, '兜底种子必须也在候选里');
});

test('读失败：机器码本身就是兜底种子，不要重复', () => {
  const h = loadHelpers(() => 'TEST-HOST|tester|win32|x64', () => '0123456789abcdef0123456789abcdef');
  assert.equal(h.machineIdentifierCandidates().length, 1, '同一个种子去重后只留一个');
});

test('设备 ID 候选包含真实 ID 与兜底 ID 两套', () => {
  // 磁盘缓存里已经存了真实机器码（第一次读成功时写的），这次开机 reg.exe 挂了
  // 也不影响：readMachineIdentifier 走缓存返回 GUID，候选里两套 ID 都在。
  const h = loadHelpers(() => REAL_GUID, () => '0123456789abcdef0123456789abcdef');
  const ids = h.deviceIdCandidates();
  assert.ok(ids.some(item => item.id === REAL_ID), '必须包含真实机器码算出的 ID，否则用户原授权会失效');
  const fallbackId = licenseCore.createDeviceId('TEST-HOST|tester|win32|x64');
  assert.ok(ids.some(item => item.id === fallbackId), '兜底种子算出的 ID 也要在，覆盖当初读失败时激活的那批用户');
  assert.equal(ids.filter(item => !item.legacy).length, 2, '两套种子各一个出厂绑定 ID');
  assert.ok(ids.some(item => item.legacy), '旧版按安装 ID 绑定的也要保留');
});

test('当初用兜底 ID 激活的，reg.exe 恢复后仍然认', () => {
  // 场景还原：首次激活时 reg.exe 被拦，用户拿兜底 ID 申请了码；
  // 后来 reg.exe 好了，缓存里有了真实机器码，校验会先试真实 ID（不匹配），
  // 必须继续试兜底 ID，否则用户会被要求重新激活。
  const h = loadHelpers(() => REAL_GUID, () => '0123456789abcdef0123456789abcdef');
  const fallbackId = licenseCore.createDeviceId('TEST-HOST|tester|win32|x64');
  const verify = (payload, options) => (options.deviceId === fallbackId
    ? { ok: true, code: 'ok' }
    : { ok: false, code: 'device_mismatch' });
  const out = h.verifyWithDeviceCandidates(verify, 'code', Date.now());
  assert.equal(out.result.ok, true, '换一套种子就认不出授权，等于每次都要重新激活');
  assert.equal(out.matchedDeviceId, fallbackId);
  assert.equal(out.legacyBinding, false);
});

test('过期这类问题不会被当作设备不匹配反复重试', () => {
  const h = loadHelpers(() => REAL_GUID, () => '0123456789abcdef0123456789abcdef');
  let calls = 0;
  const verify = () => { calls += 1; return { ok: false, code: 'expired' }; };
  const out = h.verifyWithDeviceCandidates(verify, 'code', Date.now());
  assert.equal(out.result.code, 'expired', '要把真实原因带回去，不能盖成 device_mismatch');
  assert.equal(calls, 1, '过期换 ID 也没用，试一次就够');
});

test('全都不匹配时才返回 device_mismatch', () => {
  const h = loadHelpers(() => REAL_GUID, () => '0123456789abcdef0123456789abcdef');
  const verify = () => ({ ok: false, code: 'device_mismatch' });
  const out = h.verifyWithDeviceCandidates(verify, 'code', Date.now());
  assert.equal(out.result.code, 'device_mismatch');
  assert.equal(out.matchedDeviceId, '');
});
