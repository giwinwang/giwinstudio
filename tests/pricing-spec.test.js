// 计价真源（pricing-spec.json）与各端实现的绑定关系
// 目的：改价只改一处。以前同一批数字散在 app.js 文案、providers.js 成本表、发码台档位表、
// 手机端 HTML、license-core 白名单五个地方，任一处忘了改就出现「页面写 120、实际扣 60」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const specPath = path.join(root, 'pricing-spec.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

function read(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

test('浏览器产物 pricing-spec.js 与真源同步（改 json 后必须跑 npm run pricing:sync）', () => {
  const source = read('pricing-spec.js');
  assert.ok(source, '缺少 pricing-spec.js，先跑 node tools/gen-pricing-spec.mjs');
  const injected = new Function('window', source + '\nreturn window.GW_PRICING;')({});
  assert.deepEqual(injected, spec, 'pricing-spec.js 已过期，跑 npm run pricing:sync 重新生成');
});

test('index.html 在 app.js 之前引入 pricing-spec.js', () => {
  const html = read('index.html');
  assert.ok(html, '找不到 index.html');
  const specAt = html.indexOf('<script src="pricing-spec.js"></script>');
  const appAt = html.indexOf('<script src="app.js"></script>');
  assert.ok(specAt >= 0, 'index.html 没有引入 pricing-spec.js，客户端拿不到规格');
  assert.ok(specAt < appAt, 'pricing-spec.js 必须在 app.js 之前加载');
});

// 成本表比对已合并到下方「成本表与真源一致」，避免两张表各测一遍、改一处漏一处。

test('app.js 不再硬编码档位赠分，全部走 giftPointsOf()', () => {
  const source = read('app.js');
  assert.ok(source, '找不到 app.js');
  assert.match(source, /function giftPointsOf\(/, 'app.js 缺少 giftPointsOf，说明还在手写数字');
  ['120 积分 / 月', '340 积分 / 月', '36 积分 · 30 天', '1200 积分 / 365 天'].forEach(literal => {
    assert.equal(source.includes(literal), false, 'app.js 还写死了「' + literal + '」，内测结束后会变成假话');
  });
  // 内测截止日也必须来自 spec，不能各写一处
  assert.equal(/new Date\('2026-11-30T23:59:59'\)/.test(source), false, 'app.js 又写死了内测截止日');
});

test('设备上限只有一个真源，客户端与两种签发工具都按档位读取', () => {
  assert.deepEqual(spec.deviceLimits, { beta: 1, trial: 1, solo: 2, pro: 3 });
  const app = read('app.js');
  assert.match(app, /function deviceLimitForEdition\(/);
  assert.match(app, /set-solo-devices', deviceLimitForEdition\('solo'\)/);
  assert.match(app, /set-pro-devices', deviceLimitForEdition\('pro'\)/);
  const issuer = fs.readFileSync(path.resolve(root, '..', 'license-issuer-android', 'app', 'src', 'main', 'assets', 'issuer-app.js'), 'utf8');
  assert.match(issuer, /deviceLimitForEdition\(selectedEdition\)/);
  assert.match(issuer, /deviceIds\.length > deviceLimit/);
  const admin = fs.readFileSync(path.resolve(root, '..', 'license-admin', 'license-admin.mjs'), 'utf8');
  assert.match(admin, /pricing\.deviceLimits/);
  assert.match(admin, /deviceIds\.length > deviceLimit/);
});

test('license-core.js 的档位白名单与真源一致', () => {
  const source = read('license-core.js');
  assert.ok(source, '找不到 license-core.js');
  const block = source.match(/const EDITIONS = (\[[^\]]*\]);/);
  assert.ok(block, '找不到 EDITIONS');
  const editions = new Function('return ' + block[1])();
  assert.deepEqual(editions, spec.editions, '授权档位与 pricing-spec.json 的 editions 不一致');
});

test('发码台目录的 pricing-spec.json 副本与真源逐字段一致', () => {
  // 发码台经常被单独拷到 U 盘 / 另一台机器上用，所以它带一份同目录副本；
  // 副本过期会导致「电脑端发 120、画布显示 60」。2026-10-31 之前只比 plans，
  // 结果 billing / modelCost / unknownModelNote 三处悄悄过期没人发现，
  // 现在改成整份逐键比对。
  const copyPath = path.resolve(root, '..', 'license-admin', 'pricing-spec.json');
  if (!fs.existsSync(copyPath)) return; // 本机没有 license-admin 目录时跳过
  const copy = JSON.parse(fs.readFileSync(copyPath, 'utf8'));
  for (const key of Object.keys(spec)) {
    assert.deepEqual(copy[key], spec[key],
      `license-admin/pricing-spec.json 的 ${key} 与真源不一致，重新复制一份过去`);
  }
});

test('发码器 assets 里的 pricing-spec.js 与真源逐字段一致', () => {
  // 安卓发码器是离线签发用的，APK 里打的就是这份副本。它跟不上时，
  // 管理员手机上签出来的积分面额会和画布实际扣分对不上。
  const copyPath = path.resolve(root, '..', 'license-issuer-android', 'app', 'src', 'main', 'assets', 'pricing-spec.js');
  if (!fs.existsSync(copyPath)) return; // 本机没有发码器目录时跳过
  const live = new Function('globalThis', fs.readFileSync(copyPath, 'utf8') + '\nreturn globalThis.GW_PRICING;')({});
  assert.ok(live, '发码器 pricing-spec.js 里读不出 GW_PRICING');
  for (const key of Object.keys(spec)) {
    assert.deepEqual(live[key], spec[key],
      `发码器 assets/pricing-spec.js 的 ${key} 与真源不一致，跑 npm run pricing:sync 后重新复制过去`);
  }
});

test('定价口径说明必须写明「金额是软件费、积分是赠送」，不许出现对价表述', () => {
  assert.match(spec.billing.model, /软件使用费/, '真源没有写清计价口径');
  const adminSource = path.resolve(root, '..', 'license-admin', 'points-admin.mjs');
  if (!fs.existsSync(adminSource)) return;
  const admin = fs.readFileSync(adminSource, 'utf8');
  assert.match(admin, /积分是随订阅赠送的额度/, '发码台没有把「积分是赠送」写在说明里');
});

test('成本表与真源一致：按「模型 × 计费方式」登记，锚点 ¥0.20', () => {
  // 加油包是算力转售，扣分就是成本映射。两张表必须逐项相同，否则发码台算的毛利和客户端实际扣分对不上。
  assert.equal(spec.billing.pointCostYuan, 0.2, '锚点被改过：必须是 nano-banana-pro 的 ¥0.20');
  assert.equal(spec.modelCost['seedream-v5-pro'].price, 0.9, 'Seedream 5.0 Pro 是 ¥0.9/次，不是 ¥0.27/张');
  assert.equal(spec.modelCost['seedream-v5-pro'].mode, 'per_call', 'Seedream 按次计费，与尺寸无关');
  const source = read('providers.js');
  const match = source.match(/const MODEL_COST_YUAN = (\{[\s\S]*?\n  \});/);
  assert.ok(match, 'providers.js 里找不到 MODEL_COST_YUAN');
  assert.deepEqual(new Function('return ' + match[1])(), spec.modelCost,
    'providers.js 的 MODEL_COST_YUAN 与真源不一致');
  assert.ok(!/SIZE_POINTS/.test(source), '尺寸阶梯已废除：上游按模型计费，不按尺寸');
});

test('界面上不许把「次」当计费单位（只有积分）', () => {
  const app = read('app.js');
  // 「本次」「每次」这类叙述不算单位，要拦的是「N 次」「次数」「按次」
  const offenders = app.match(/[0-9]+\s*次(?!的)|次数|按次扣/g) || [];
  assert.deepEqual(offenders, [], '界面里还有次数口径：' + offenders.join('、'));
  assert.match(app, /1 积分 = 1 张标准图/, '价格页说明没写清「1 积分 = 1 张标准图」');
  assert.match(app, /Seedream 5\.0 Pro 按 5 分|Seedream 5\.0 Pro 5 分\/张/, '贵模型（¥0.9/次）必须在说明里单独标出来，否则客户看到 5 分会以为被宰');
});

test('订阅面板打开就要画出各档积分行（不能等点了周期才出现）', () => {
  const app = read('app.js');
  // 2026-10-31 用户实测：首次进面板三张档位卡的积分行是空的，点一下季付再点回来才出现，
  // 原因是初始化只调了 paintCycle() / paintPayPlan()，漏了填积分行的 applyCycleCopy()。
  assert.match(app, /paintCycle\(\);\s*\n\s*applyCycleCopy\(\);/,
    '订阅面板初始化没有调 applyCycleCopy()，首次打开积分行是空的');
});
