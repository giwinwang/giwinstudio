/**
 * 极物融合反代 · 回归测试
 *
 * 守两件事：
 *   1. 主线切到自有反代 api.giwin.cn 之后，上游域名仍然作为兜底线路存在，
 *      且「网络失败才换线路」的保护不被破坏（防止重复下单扣费）。
 *   2. 老用户存档里的旧接口地址不会把极物融合拖回上游直连。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// 模拟一个「老用户」：配置里还存着上游地址
global.window = {};
global.localStorage = {
  _data: {
    gw_engines: JSON.stringify({
      apollo: { apiKey: 'sk-legacy', baseURL: 'https://api.apilio.ai', model: 'seedream-5-0' }
    })
  },
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
  },
  setItem(key, value) { this._data[key] = String(value); },
  removeItem(key) { delete this._data[key]; }
};

require('../model-tuning.js');
require('../providers.js');
const P = global.window.GWProviders;

const UPSTREAM = 'https://api.apilio.ai';
const PROXY = 'https://api.giwin.cn';

test('主线走反代时，候选里既有反代也有上游兜底', () => {
  const list = P.__test_candidatesWithMirror('apollo', PROXY);
  assert.ok(list.length >= 2, `候选数量 ${list.length}`);
  assert.ok(list.some(u => u.startsWith(PROXY)), '缺少主线路（反代）候选');
  assert.ok(list.some(u => u.startsWith('https://api.apilio.ai')), '缺少上游兜底候选');
});

test('主线走反代时，反代自己的候选不会被误判成备用线路', () => {
  const list = P.__test_candidatesWithMirror('apollo', PROXY);
  const primary = list.filter(u => u.startsWith(PROXY));
  assert.ok(primary.length > 0);
  for (const u of primary) {
    assert.equal(P.__test_isMirrorUrl(u, PROXY), false, `${u} 被误判成兜底，会被跳过`);
  }
});

test('主线走反代时，上游候选被判为备用线路', () => {
  assert.equal(P.__test_isMirrorUrl('https://api.apilio.ai', PROXY), true);
  assert.equal(P.__test_isMirrorUrl('https://apilio.ai/v1', PROXY), true);
  assert.equal(P.__test_isMirrorUrl('https://apilio.ai', PROXY), true);
});

test('主线仍在上游时，第一个候选必须算主线路', () => {
  // 关键回归：把 api.apilio.ai 也算进兜底域名后，如果 isMirrorUrl 不按 host 判断，
  // 第一个候选会被当成兜底 + lastError 为空 → 直接 continue，第一次请求就绕开主站。
  const list = P.__test_candidatesWithMirror('apollo', UPSTREAM);
  assert.equal(list[0], 'https://api.apilio.ai/v1');
  assert.equal(P.__test_isMirrorUrl(list[0], UPSTREAM), false, '主线路候选被判成兜底会导致首请求被跳过');
});

test('主线仍在上游时，官网主域才算兜底', () => {
  assert.equal(P.__test_isMirrorUrl('https://apilio.ai/v1', UPSTREAM), true);
  assert.equal(P.__test_isMirrorUrl('https://apilio.ai', UPSTREAM), true);
});

test('非 apollo 引擎不产生备用线路', () => {
  for (const id of ['volc', 'deepseek', 'openai', 'custom', 'runninghub']) {
    assert.deepEqual(P.__test_mirrorCandidates(id, PROXY), [], id);
    assert.deepEqual(P.__test_mirrorCandidates(id, UPSTREAM), [], id);
  }
});

test('空地址不产生备用线路', () => {
  assert.deepEqual(P.__test_mirrorCandidates('apollo', ''), []);
});

test('老用户存档里的上游地址会被覆盖成客户端内置地址', () => {
  // localStorage 里存的是 api.apilio.ai，读出来必须是 PROVIDERS 里的值
  const cfgs = P.loadConfigs();
  assert.ok(cfgs.apollo, '配置应当被读到');
  assert.equal(cfgs.apollo.apiKey, 'sk-legacy', '其他字段不能被吞掉');
  assert.equal(
    cfgs.apollo.baseURL,
    P.PROVIDERS.apollo.baseURL,
    '极物融合的接口地址必须跟随客户端版本，不能沿用存档'
  );
});
