'use strict';

// 授权档位（payload.e）在签发端的校验，以及客户端档位映射的一致性。
//
// 背景：客户端顶栏文案与功能闸门全靠 license.edition 判定，而它来自验签后的 payload。
// 早期版本把 e 写死成 beta，导致付了订阅的客户装上去仍显示"内测成员"。
// 这个文件锁三件事：① 只能签四个正名（含别名收敛、停用档拒签）
// ② 签出来的码解回来档位不变 ③ 客户端 app.js 认得这四个值，且历史 studio/team 仍认得。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const licenseCore = require('../license-core');

const DEVICE = 'GW-AAAA-BBBB-CCCC-DDDD';

function issue(edition) {
  const keys = crypto.generateKeyPairSync('ed25519');
  const options = { privateKey: keys.privateKey, deviceId: DEVICE, days: 30 };
  if (edition !== undefined) options.edition = edition;
  const code = licenseCore.issueActivationCode(options);
  // parseActivationCode 把签名负载解析在 data 里（payload 是 base64 串）
  return { code, payload: licenseCore.parseActivationCode(code).data };
}

test('四个正名都能签，签出来的 e 字段与解回来的档位一致', () => {
  licenseCore.EDITIONS.forEach(edition => {
    const { payload } = issue(edition);
    assert.equal(payload.e, edition, '签出来的码里档位必须是 ' + edition);
  });
  assert.deepEqual(licenseCore.EDITIONS, ['beta', 'trial', 'solo', 'pro']);
});

test('不传档位就是只激活，不能默认送订阅', () => {
  assert.equal(issue().payload.e, 'beta');
  assert.equal(issue('').payload.e, 'beta');
  assert.equal(issue('  ').payload.e, 'beta');
});

test('历史别名收敛到正名', () => {
  assert.equal(issue('Standard').payload.e, 'solo');
  assert.equal(issue(' BASIC ').payload.e, 'solo');
  assert.equal(issue('professional').payload.e, 'pro');
  assert.equal(issue('Premium').payload.e, 'pro');
  assert.equal(issue('first').payload.e, 'trial');
});

test('停用档位与乱填一律拒签，绝不出「看着像订阅其实只激活」的码', () => {
  // 工作室档已并入高级版：要提示改 pro，而不是悄悄降成 beta
  assert.throws(() => issue('studio'), /已取消/);
  assert.throws(() => issue('team'), /已取消/);
  assert.throws(() => issue('enterprise'), /已取消/);
  assert.throws(() => issue('enterprize'), /未知授权档位/);
  // 大小写与空格要先归一化，别把 " PRO " 当非法值拒掉
  assert.equal(issue(' PRO ').payload.e, 'pro');
});

test('许可证（.gwlic）与激活码用同一套档位校验', () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const envelope = licenseCore.issueLicense({
    privateKey: keys.privateKey,
    deviceId: DEVICE,
    edition: 'pro',
    days: 30
  });
  const decoded = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
  assert.equal(decoded.edition, 'pro');
  assert.throws(() => licenseCore.issueLicense({
    privateKey: keys.privateKey,
    deviceId: DEVICE,
    edition: 'studio',
    days: 30
  }), /已取消/);
});

test('客户端 app.js 的档位映射覆盖四个正名，并保留历史档识别', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
  const start = source.indexOf('function accountTierInfoFromState');
  assert.ok(start > 0, '找不到 accountTierInfoFromState()，客户端档位判定被改名了？');
  const body = source.slice(start, start + 2600);

  // 每个正名都必须出现在某条规则里，否则客户端会把订阅客户当 beta
  ['trial', 'solo', 'pro'].forEach(edition => {
    assert.ok(body.indexOf(edition) >= 0, '客户端缺少 ' + edition + ' 的判定');
  });
  // 历史 Key 仍要能识别（不再售卖，但老客户不能掉档）
  assert.ok(body.indexOf('studio') >= 0, '历史 studio 档必须仍被识别');
  assert.ok(body.indexOf('team') >= 0, '历史 team 档必须仍被识别');
  // 兜底必须是 beta（只激活），不能兜到付费档
  assert.match(body, /\|\|\s*'beta'|\?\s*'beta'|:\s*'beta'/, '缺省档位必须是 beta');
});
