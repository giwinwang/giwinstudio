'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const licenseCore = require('../license-core');

function keyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

test('stable device identifiers are deterministic and independent from install identifiers', () => {
  const first = licenseCore.createDeviceId('machine-guid');
  const reinstall = licenseCore.createDeviceId('machine-guid');
  const legacy = licenseCore.createDeviceId('machine-guid', 'install-id');
  assert.equal(first, reinstall);
  assert.notEqual(first, legacy);
  assert.match(first, /^GW-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
});

test('compact activation codes round-trip and verify after pasted whitespace is removed', () => {
  const keys = keyPair();
  const deviceId = 'GW-AAAA-BBBB-CCCC-DDDD';
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  const code = licenseCore.issueActivationCode({ privateKey: keys.privateKey, deviceId, holder: 'Beta Tester', days: 30, now });
  const parsed = licenseCore.parseActivationCode(code.slice(0, 120) + '\n  ' + code.slice(120));
  const verified = licenseCore.verifyActivationCode(code, {
    publicKey: keys.publicKey,
    deviceId,
    now
  });
  assert.equal(code.startsWith('GIWIN2.'), true);
  assert.equal(code.length < 320, true);
  assert.equal(parsed.version, 2);
  assert.equal(verified.ok, true);
  assert.equal(verified.license.holder, 'Beta Tester');
  assert.equal(licenseCore.verifyActivationCode(code, {
    publicKey: keys.publicKey,
    deviceId: 'GW-1111-2222-3333-4444',
    now
  }).code, 'device_mismatch');
  assert.throws(() => licenseCore.parseActivationCode('GIWIN1.invalid'), /格式不正确/);
});

test('activation codes default to a fifteen day term', () => {
  const keys = keyPair();
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  const code = licenseCore.issueActivationCode({
    privateKey: keys.privateKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    now
  });
  const verified = licenseCore.verifyActivationCode(code, {
    publicKey: keys.publicKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    now
  });
  assert.equal(Date.parse(verified.license.expiresAt) - Date.parse(verified.license.issuedAt), 15 * 24 * 60 * 60 * 1000);
});

test('invite codes map to devices and reward only the inviter', () => {
  const keys = keyPair();
  const inviter = 'GW-AAAA-BBBB-CCCC-DDDD';
  const invitee = 'GW-1111-2222-3333-4444';
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  const inviteCode = licenseCore.inviteCodeForDeviceId(inviter);
  assert.equal(inviteCode, 'INV-AAAA-BBBB-CCCC-DDDD');
  assert.equal(licenseCore.deviceIdFromInviteCode(inviteCode), inviter);
  const request = licenseCore.createActivationRequest({ deviceId: invitee, inviteCode, now });
  assert.equal(request.inviteCode, inviteCode);
  const rewardCode = licenseCore.issueInviteRewardCode({
    privateKey: keys.privateKey,
    deviceId: inviter,
    inviteeDeviceId: invitee,
    now
  });
  const verified = licenseCore.verifyInviteRewardCode(rewardCode, {
    publicKey: keys.publicKey,
    deviceId: inviter,
    now
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.reward.days, 7);
  assert.equal(licenseCore.verifyInviteRewardCode(rewardCode, {
    publicKey: keys.publicKey,
    deviceId: invitee,
    now
  }).code, 'device_mismatch');
});

test('legacy full activation envelope remains readable', () => {
  const keys = keyPair();
  const envelope = licenseCore.issueLicense({
    privateKey: keys.privateKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    days: 30
  });
  const parsed = licenseCore.parseActivationCode(licenseCore.encodeActivationCode(envelope));
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.envelope, envelope);
});

test('offline license verifies for the bound device and remaining term', () => {
  const keys = keyPair();
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  const envelope = licenseCore.issueLicense({
    privateKey: keys.privateKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    holder: 'Beta Tester',
    days: 30,
    now
  });
  const verified = licenseCore.verifyLicense(envelope, {
    publicKey: keys.publicKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    now: now + 24 * 60 * 60 * 1000
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.license.holder, 'Beta Tester');
  assert.equal(verified.license.product, 'giwin-studio');
});

test('offline license rejects another device', () => {
  const keys = keyPair();
  const envelope = licenseCore.issueLicense({
    privateKey: keys.privateKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    days: 30
  });
  const verified = licenseCore.verifyLicense(envelope, {
    publicKey: keys.publicKey,
    deviceId: 'GW-1111-2222-3333-4444'
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'device_mismatch');
});

test('offline license rejects tampering and expiration', () => {
  const keys = keyPair();
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  const envelope = licenseCore.issueLicense({
    privateKey: keys.privateKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    days: 1,
    now
  });
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
  payload.holder = 'Tampered';
  const tampered = {
    ...envelope,
    payload: Buffer.from(JSON.stringify(payload)).toString('base64url')
  };
  const badSignature = licenseCore.verifyLicense(tampered, {
    publicKey: keys.publicKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    now
  });
  assert.equal(badSignature.code, 'invalid_signature');

  const expired = licenseCore.verifyLicense(envelope, {
    publicKey: keys.publicKey,
    deviceId: 'GW-AAAA-BBBB-CCCC-DDDD',
    now: now + 2 * 24 * 60 * 60 * 1000
  });
  assert.equal(expired.code, 'expired');
});

test('多设备激活码在主电脑和第二台电脑上有效，陌生电脑仍被拒绝', () => {
  const keys = keyPair();
  const now = Date.parse('2026-10-31T00:00:00.000Z');
  const devices = ['GW-AAAA-BBBB-CCCC-DDDD', 'GW-1111-2222-3333-4444'];
  const code = licenseCore.issueActivationCode({
    privateKey: keys.privateKey,
    deviceId: devices[0],
    deviceIds: devices,
    edition: 'solo',
    days: 30,
    now
  });
  const parsed = licenseCore.parseActivationCode(code);
  assert.equal(parsed.data.d, devices[0], 'd 必须继续保存主电脑，兼容旧客户端与积分领取');
  assert.deepEqual(parsed.data.ds, devices);
  for (const deviceId of devices) {
    const verified = licenseCore.verifyActivationCode(code, { publicKey: keys.publicKey, deviceId, now });
    assert.equal(verified.ok, true, deviceId + ' 应该能激活');
    assert.deepEqual(verified.license.deviceIds, devices);
    assert.equal(verified.license.primaryDeviceId, devices[0]);
  }
  assert.equal(licenseCore.verifyActivationCode(code, {
    publicKey: keys.publicKey,
    deviceId: 'GW-5555-6666-7777-8888',
    now
  }).code, 'device_mismatch');
});

test('单设备旧格式保持原样，多设备列表拒绝重复与非法 ID', () => {
  const keys = keyPair();
  const deviceId = 'GW-AAAA-BBBB-CCCC-DDDD';
  const single = licenseCore.issueActivationCode({ privateKey: keys.privateKey, deviceId });
  assert.equal('ds' in licenseCore.parseActivationCode(single).data, false, '单设备码不应增加 ds 字段');
  assert.throws(() => licenseCore.issueActivationCode({
    privateKey: keys.privateKey,
    deviceId,
    deviceIds: [deviceId, deviceId]
  }), /重复/);
  assert.throws(() => licenseCore.issueActivationCode({
    privateKey: keys.privateKey,
    deviceId,
    deviceIds: [deviceId, 'GW-COF4-C254-6E51-EDEC']
  }), /格式无效/);
});

test('完整许可证文件也支持多设备，旧验证路径不会只认主电脑', () => {
  const keys = keyPair();
  const now = Date.parse('2026-10-31T00:00:00.000Z');
  const devices = ['GW-AAAA-BBBB-CCCC-DDDD', 'GW-1111-2222-3333-4444', 'GW-5555-6666-7777-8888'];
  const envelope = licenseCore.issueLicense({
    privateKey: keys.privateKey,
    deviceId: devices[0],
    deviceIds: devices,
    edition: 'pro',
    now
  });
  for (const deviceId of devices) {
    assert.equal(licenseCore.verifyLicense(envelope, { publicKey: keys.publicKey, deviceId, now }).ok, true);
  }
  assert.equal(licenseCore.verifyLicense(envelope, {
    publicKey: keys.publicKey,
    deviceId: 'GW-9999-8888-7777-6666',
    now
  }).code, 'device_mismatch');
});
