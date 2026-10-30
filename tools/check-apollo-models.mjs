#!/usr/bin/env node
/**
 * 阿波罗（apilio）模型可用性对账
 *
 * 为什么需要它：我们所有算力都从阿波罗分销，只要注册表里挂了一个阿波罗没有的模型，
 * 用户选中后点生成就是直接失败。价格也可能随时变，成本表必须跟得上。
 *
 * 数据源：https://apilio.ai/api/pricing（公开可读，无需 key，default 分组倍率 1）
 * 用法：node tools/check-apollo-models.mjs
 * 退出码：0 = 全部通过；1 = 有阿波罗不存在的模型，或成本表与实际不符
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRICING_API = 'https://apilio.ai/api/pricing';

function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8');
  const start = src.indexOf('const MODEL_REGISTRY = [');
  const body = src.slice(start, src.indexOf('\n  ];', start));
  // 按顶层对象切分：每条以 "{ engine:" 开头
  const parts = body.split(/\n\s{4}\{ engine:/).slice(1);
  return parts.map(chunk => {
    const engine = (chunk.match(/^\s*'([^']+)'/) || [])[1] || '';
    const id = (chunk.match(/id:\s*'([^']+)'/) || [])[1] || '';
    const type = (chunk.match(/type:\s*'([^']+)'/) || [])[1] || '';
    const def = /default:\s*true/.test(chunk);
    const restricted = /restricted:\s*true/.test(chunk);
    return { engine, id, type, def, restricted };
  }).filter(m => m.id && m.type);
}

// 从源码里读尺寸别名白名单：注册表只写了 sizes（可能引用常量），真正决定「会不会拼 -4k」的是这个 Set
function readSizeAliased() {
  const src = fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8');
  const start = src.indexOf('const APOLLO_SIZE_ALIASED = new Set([');
  if (start < 0) return new Set();
  const body = src.slice(start, src.indexOf(']);', start));
  return new Set([...body.matchAll(/'([^']+)'/g)].map(m => m[1]));
}

function readCostTable() {  const src = fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8');
  const start = src.indexOf('const MODEL_COST_YUAN = {');
  const body = src.slice(start, src.indexOf('\n  };', start));
  const out = {};
  const lineRe = /'([^']+)':\s*\{([^}]+)\}/g;
  let m;
  while ((m = lineRe.exec(body))) {
    const [, id, inner] = m;
    const perCall = inner.match(/price:\s*([\d.]+)/);
    if (/mode:\s*'per_call'/.test(inner) && perCall) {
      out[id] = { mode: 'per_call', price: Number(perCall[1]) };
      continue;
    }
    const tiers = {};
    for (const t of ['1K', '2K', '4K']) {
      const hit = inner.match(new RegExp(`'${t}':\\s*([\\d.]+)`));
      if (hit) tiers[t] = Number(hit[1]);
    }
    if (Object.keys(tiers).length) out[id] = { mode: 'per_size', tiers };
  }
  return out;
}

async function main() {
  const res = await fetch(PRICING_API);
  if (!res.ok) throw new Error(`价目接口返回 ${res.status}`);
  const payload = await res.json();
  const live = new Map((payload.data || []).map(m => [m.model_name, m]));
  if (!live.size) throw new Error('价目接口没有返回模型，检查返回结构是否变了');

  const registry = readRegistry();
  const cost = readCostTable();
  const problems = [];

  console.log(`阿波罗在售模型 ${live.size} 个；本地注册 ${registry.length} 个\n`);

  console.log('== 阿波罗通道（engine: apollo）必须全部存在 ==');
  for (const m of registry.filter(x => x.engine === 'apollo')) {
    const hit = live.get(m.id);
    if (!hit) {
      problems.push(`阿波罗没有模型 ${m.id}（注册表 engine=apollo）`);
      console.log(`  ✗ ${m.id}  —— 阿波罗无此模型，用户选中必失败`);
      continue;
    }
    const inDefault = (hit.enable_groups || []).includes('default');
    const pay = hit.quota_type === 1 ? `¥${hit.model_price}/次` : `x${hit.model_ratio}`;
    if (!inDefault) {
      if (m.restricted) {
        console.log(`  ~ ${m.id}  ${pay}  不在 default 分组（已标 restricted，不进生成面板）`);
        continue;
      }
      problems.push(`${m.id} 不在 default 分组，按默认分组计费会打不通`);
      console.log(`  ! ${m.id}  ${pay}  但不在 default 分组`);
      continue;
    }
    // 成本表比对
    const row = cost[m.id];
    if (!row) {
      console.log(`  ! ${m.id}  ${pay}  成本表未登记 → 扣分按未登记模型兜底`);
      continue;
    }
    if (row.mode === 'per_call' && hit.quota_type === 1) {
      const diff = Math.abs(row.price - hit.model_price) > 1e-9;
      console.log(`  ${diff ? '!' : '✓'} ${m.id}  ¥${hit.model_price}/次  成本表 ¥${row.price}`);
      if (diff) problems.push(`${m.id} 实际 ¥${hit.model_price}，成本表写 ¥${row.price}`);
    } else if (row.mode === 'per_size' && hit.quota_type === 1) {
      // 尺寸别名：xxx-2k / xxx-4k 分开定价
      const tiers = row.tiers;
      const priceAt = sub => {
        const rec = live.get(`${m.id}${sub}`);
        return rec && rec.quota_type === 1 ? rec.model_price : null;
      };
      const live2k = priceAt('-2k');
      const live4k = priceAt('-4k');
      const bad = [];
      if (live2k != null && Math.abs(live2k - (tiers['2K'] ?? 0)) > 1e-9) bad.push(`2K 实际 ¥${live2k} / 表 ¥${tiers['2K']}`);
      if (live4k != null && Math.abs(live4k - (tiers['4K'] ?? 0)) > 1e-9) bad.push(`4K 实际 ¥${live4k} / 表 ¥${tiers['4K']}`);
      console.log(`  ${bad.length ? '!' : '✓'} ${m.id}  1K ¥${hit.model_price}${live2k != null ? ` · 2K ¥${live2k}` : ''}${live4k != null ? ` · 4K ¥${live4k}` : ''}`);
      bad.forEach(b => problems.push(`${m.id} ${b}`));
    } else if (row.mode === 'per_call' && hit.quota_type === 0) {
      // 按倍率（token）计费，成本随出图尺寸浮动，表里只能是估值
      console.log(`  ~ ${m.id}  x${hit.model_ratio} 按倍率计费，成本表按 ¥${row.price}/张 估值`);
    } else {
      console.log(`  ! ${m.id}  ${pay}  计费方式与成本表不一致（表: ${row.mode}）`);
      problems.push(`${m.id} 计费方式不一致：上游 ${hit.quota_type === 1 ? '按次' : '按倍率'}，表 ${row.mode}`);
    }
  }

  console.log('\n== 其它引擎（阿波罗没有的算力，只能靠用户自备）==');
  for (const m of registry.filter(x => x.engine !== 'apollo')) {
    const hit = live.get(m.id);
    const tag = hit ? '阿波罗也有（可随时切回）' : '阿波罗无，走自有 Key';
    console.log(`  ${hit ? '·' : '-'} ${m.engine.padEnd(11)} ${m.id.padEnd(40)} ${tag}`);
  }

  console.log('\n== 阿波罗有、本地没接的便宜生图模型（可考虑补位）==');
  const offered = new Set(registry.map(x => x.id));
  // 阿波罗把尺寸做成独立模型名（xxx-2k / xxx-4k）。这类名字只要基座已注册、且基座在
  // APOLLO_SIZE_ALIASED 白名单里（代码会按尺寸自动拼后缀），就算已接上，不该反复报「没接」。
  const sizeAliased = readSizeAliased();
  const coveredAsSizeVariant = name => {
    const base = String(name).replace(/-(?:2k|4k)$/, '');
    if (base === name) return false;
    return offered.has(base) && sizeAliased.has(base);
  };
  const candidates = [...live.values()]
    .filter(m => String(m.categories || '').split(',').includes('image'))
    .filter(m => (m.enable_groups || []).includes('default'))
    .filter(m => m.quota_type === 1 && m.model_price <= 0.3)
    .filter(m => !offered.has(m.model_name))
    .filter(m => !coveredAsSizeVariant(m.model_name))
    .filter(m => !/video|voice|tts|list|elements|presets|identify|upscale/i.test(m.model_name))
    .sort((a, b) => a.model_price - b.model_price);
  candidates.forEach(m => console.log(`  + ${m.model_name.padEnd(42)} ¥${m.model_price}/次  ${String(m.description || '').replace(/\s+/g, ' ').slice(0, 40)}`));

  if (problems.length) {
    console.log('\n===== 需要处理 =====');
    problems.forEach(p => console.log(`  · ${p}`));
    process.exitCode = 1;
  } else {
    console.log('\n全部通过：注册表模型均可在阿波罗出图，成本表与实价一致。');
  }
}

main().catch(err => { console.error('对账失败：' + err.message); process.exit(1); });
