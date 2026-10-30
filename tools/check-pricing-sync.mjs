#!/usr/bin/env node
// 积分口径「五端一致性」核对：真源 → 主程序 → 发码器（Android）→ 发码后台（电脑端）。
// 以前改一次档位要靠人肉记着同步四份文件，漏一份就是「发码台发 230、客户端认 200」这类事故。
// 用法：node tools/check-pricing-sync.mjs        （不通过退出码 1）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');            // 01_LATEST_GIWIN-Studio-...
const PARENT = path.resolve(ROOT, '..');           // GIWINDESIGN（发码器与发码后台在这层）
const SPEC_JSON = path.join(ROOT, 'pricing-spec.json');

const problems = [];
const fail = msg => { problems.push(msg); console.log('  ✗ ' + msg); };
const ok = msg => console.log('  ✓ ' + msg);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// pricing-spec.js 是 IIFE 包装的：global.GW_PRICING = { ... };
// 用括号配对把整个对象抠出来，不能用正则（嵌套对象 + 结尾还有代码）。
function readPricingJs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const marker = src.search(/(?:global|window)\.GW_PRICING\s*=\s*\{/);
  if (marker < 0) return null;
  const start = src.indexOf('{', marker);
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(src.slice(start, i + 1)); }
  }
  return null;
}

console.log('== 积分口径五端一致性核对 ==');
const spec = readJson(SPEC_JSON);
if (!spec || !Array.isArray(spec.plans) || !spec.plans.length) {
  console.log('读不到真源 pricing-spec.json');
  process.exit(1);
}
console.log(`真源：${spec.plans.length} 个档位，内测截止 ${spec.giftPeriods?.beta?.endsAt || '?'}\n`);

// ---------- 0. 业务硬规则 ----------
console.log('[0] 业务硬规则');
// 加油包是纯算力包，不参与加赠，内测期与正式期必须是同一个分数（¥100 = 230 分）。
const boost = spec.plans.find(p => p.key === 'boost');
if (!boost) fail('真源里没有 boost（加油包）档位');
else if (boost.giftPoints.beta !== boost.giftPoints.standard) {
  fail(`加油包两期分数不同：内测 ${boost.giftPoints.beta} / 正式 ${boost.giftPoints.standard}，应为同一个数`);
} else ok(`加油包两期同额 ¥${boost.price} = ${boost.giftPoints.beta} 分（不参与加赠）`);
// 订阅档必须内测 = 正式 ×2（加赠一倍）
for (const p of spec.plans) {
  if (p.key === 'boost') continue;
  if (p.giftPoints.beta !== p.giftPoints.standard * 2) {
    fail(`${p.key} 内测赠分 ${p.giftPoints.beta} 不是正式期 ${p.giftPoints.standard} 的两倍`);
  }
}
if (!problems.length) ok('订阅档均为内测双倍 / 正式单倍');

// 逐项比对（不再只比 plans / modelCost）：2026-10-31 之前漏了 billing 和 unknownModelNote，
// 发码后台一直拿着老口径 —— 现在整份扫一遍，哪个键不一样就点名。
function diffKeys(live, spec) {
  const keys = Object.keys(spec);
  const bad = [];
  for (const k of keys) {
    if (JSON.stringify(live[k]) !== JSON.stringify(spec[k])) bad.push(k);
  }
  return bad;
}

// ---------- 1. pricing-spec.js（客户端运行时产物）----------
console.log('[1] 客户端 pricing-spec.js');
const specJsPath = path.join(ROOT, 'pricing-spec.js');
if (!fs.existsSync(specJsPath)) fail('缺 pricing-spec.js，跑 npm run pricing:sync 生成');
else {
  const live = readPricingJs(specJsPath);
  if (!live) fail('pricing-spec.js 里读不出 GW_PRICING');
  else {
    const bad = diffKeys(live, spec);
    if (bad.length) fail('与真源不一致的字段：' + bad.join('、') + ' —— 跑 npm run pricing:sync');
    else ok('整份一致（plans / modelCost / billing 等 ' + Object.keys(spec).length + ' 个字段）');
  }
}

// ---------- 2. 发码器（Android）----------
console.log('\n[2] 发码器 license-issuer-android');
const issuerDir = path.join(PARENT, 'license-issuer-android', 'app', 'src', 'main', 'assets');
if (!fs.existsSync(issuerDir)) fail('找不到发码器目录 ' + issuerDir);
else {
  const issuerSpec = path.join(issuerDir, 'pricing-spec.js');
  if (!fs.existsSync(issuerSpec)) fail('发码器缺 pricing-spec.js 副本');
  else {
    const issuer = readPricingJs(issuerSpec);
    if (!issuer) fail('发码器 pricing-spec.js 里读不出 GW_PRICING');
    else {
      const bad = diffKeys(issuer, spec);
      if (bad.length) fail('与真源不一致的字段：' + bad.join('、')
        + ' —— 客户拿到的赠分会和客户端对不上，跑 npm run pricing:sync 后把最新 pricing-spec.js 复制进 assets');
      else ok('整份与真源一致（含 modelCost ' + Object.keys(spec.modelCost).length + ' 个模型）');
    }
  }
  // 发码器不该再出现「积分换钱」的标价
  const appJs = path.join(issuerDir, 'issuer-app.js');
  if (fs.existsSync(appJs)) {
    const s = fs.readFileSync(appJs, 'utf8');
    if (/yuanForPoints/.test(s)) fail('发码器还在用 yuanForPoints 给积分标价（积分不是用钱买的）');
    else ok('已无「积分 = ¥XX」标价');
  }
  const coreJs = path.join(issuerDir, 'issuer-core.js');
  if (fs.existsSync(coreJs)) {
    const s = fs.readFileSync(coreJs, 'utf8');
    if (/POINTS_PER_YUAN/.test(s)) fail('issuer-core.js 仍定义 POINTS_PER_YUAN 兑换率');
    else ok('已无 POINTS_PER_YUAN 兑换率');
  }
}

// ---------- 3a. 发码后台自带的 pricing-spec.json 副本（整份比对）----------
console.log('\n[3] 发码后台自带副本 license-admin/pricing-spec.json');
const adminSpecPath = path.join(PARENT, 'license-admin', 'pricing-spec.json');
if (!fs.existsSync(adminSpecPath)) fail('找不到 ' + adminSpecPath);
else {
  const copy = readJson(adminSpecPath);
  if (!copy) fail('license-admin/pricing-spec.json 解析失败');
  else {
    const bad = diffKeys(copy, spec);
    if (bad.length) fail('副本与真源不一致的字段：' + bad.join('、')
      + ' —— 直接复制 pricing-spec.json 覆盖它');
    else ok('副本整份与真源一致（' + Object.keys(spec).length + ' 个字段）');
  }
}

// ---------- 4. 发码后台（电脑端）----------
console.log('\n[4] 发码后台 license-admin/points-admin.mjs');
const adminPath = path.join(PARENT, 'license-admin', 'points-admin.mjs');
if (!fs.existsSync(adminPath)) fail('找不到 ' + adminPath);
else {
  const s = fs.readFileSync(adminPath, 'utf8');
  const m = s.match(/const FALLBACK_PLANS = \[([\s\S]*?)\n\];/);
  if (!m) fail('points-admin.mjs 里找不到 FALLBACK_PLANS');
  else {
    const fb = eval('[' + m[1] + ']');
    let bad = 0;
    for (const p of spec.plans) {
      const f = fb.find(x => x.key === p.key);
      if (!f) { fail('兜底表缺档位 ' + p.key); bad++; continue; }
      if (f.price !== p.price) { fail(`${p.key} 价格 ${f.price} ≠ ${p.price}`); bad++; }
      if (f.giftPoints.beta !== p.giftPoints.beta) { fail(`${p.key} 内测赠分 ${f.giftPoints.beta} ≠ ${p.giftPoints.beta}`); bad++; }
      if (f.giftPoints.standard !== p.giftPoints.standard) { fail(`${p.key} 正式赠分 ${f.giftPoints.standard} ≠ ${p.giftPoints.standard}`); bad++; }
      if (f.redeemDays !== p.redeemDays) { fail(`${p.key} 兑换期 ${f.redeemDays} ≠ ${p.redeemDays}`); bad++; }
      if (f.pointsExpiryDays !== p.pointsExpiryDays) { fail(`${p.key} 积分有效期 ${f.pointsExpiryDays} ≠ ${p.pointsExpiryDays}`); bad++; }
    }
    if (!bad) ok(`兜底档位与真源逐项一致（${fb.length} 档）`);
    // 兜底比率不能写死 2（加油包实际 2.3，写死会少送）
    if (/const POINTS_PER_YUAN = 2;/.test(s)) fail('兜底比率写死 ¥1 = 2 分，加油包实际 2.3，大额会少送');
    else if (/fallbackPointsPerYuan/.test(s)) ok('兜底比率改为按加油包实算');
    else fail('找不到兜底比率逻辑');
  }
}

// ---------- 5. 客户端不许出现「元买积分」的对价话术 ----------
console.log('\n[5] 对价话术检查（金额是软件费，积分是赠送额度，两者没有对价）');
for (const f of ['app.js', 'canvas.js']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');
  const hits = s.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(x => /¥\s?1\s*=\s*\d|1\s*元\s*=\s*\d|元\s*=\s*\d+\s*积分/.test(x.line));
  if (hits.length) hits.forEach(h => fail(`${f}:${h.n} 出现元↔积分对价：${h.line.trim().slice(0, 80)}`));
  else ok(`${f} 无对价话术`);
}

console.log('\n== 结果 ==');
if (problems.length) {
  console.log(`${problems.length} 处不一致，客户拿到的分数可能和客户端对不上。`);
  process.exit(1);
}
console.log('五端口径一致 ✅');
