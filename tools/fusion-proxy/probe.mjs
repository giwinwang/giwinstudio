#!/usr/bin/env node
/**
 * 极物融合 · 反代链路验证
 *
 * 用途：服务器部署完、客户端 baseURL 还没切之前，先确认反代真的能用。
 *       不做「配置写对了」这种推断，全部打真实请求。
 *
 * 两种跑法：
 *   1) 独立直连（需要一把真实额度码）
 *        node tools/fusion-proxy/probe.mjs --key sk-xxxx
 *
 *   2) 借道调试实例（用 app 里已存的额度码，Key 不出应用）
 *        node tools/fusion-proxy/probe.mjs --via-cdp
 *      （前提：软件带 --remote-debugging-port=9222 启动，且 tools/bridge.js 在 19191 上活着）
 *
 * 常用参数：
 *   --base <url>     默认 https://api.giwin.cn
 *   --compare        同时打上游 api.apilio.ai，核对两边 /models 结果是否一致
 *   --image          额外跑一次真实的文生图（会扣费，默认关闭）
 */

import { argv, exit } from 'node:process';

const BRIDGE = 'http://127.0.0.1:19191';
const DEFAULT_BASE = 'https://api.giwin.cn';
const UPSTREAM = 'https://api.apilio.ai';
const PROBE_PATH = '/__health';
/** 白名单外的路径，应当被反代挡掉 */
const SHOULD_404 = '/admin/whatever';
/** 几乎零成本的对话模型，用来验证 POST 通路 */
const CHAT_MODEL = 'gpt-4o-mini';

function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, key: '', viaCdp: false, compare: false, image: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').replace(/\/+$/, '');
    else if (a === '--key') out.key = String(argv[++i] || '');
    else if (a === '--via-cdp') out.viaCdp = true;
    else if (a === '--compare') out.compare = true;
    else if (a === '--image') out.image = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const C = {
  g: s => `\x1b[32m${s}\x1b[0m`,
  r: s => `\x1b[31m${s}\x1b[0m`,
  y: s => `\x1b[33m${s}\x1b[0m`,
  d: s => `\x1b[90m${s}\x1b[0m`,
};

const rows = [];
function record(name, ok, detail, ms) {
  rows.push({ name, ok, detail, ms });
  const tag = ok === null ? C.y('SKIP') : ok ? C.g('PASS') : C.r('FAIL');
  console.log(`  ${tag}  ${name}${ms ? C.d(`  ${ms}ms`) : ''}`);
  if (detail) console.log(`        ${C.d(detail)}`);
}

/** 借道调试实例执行（Key 留在应用进程里，不出内存） */
async function evalInApp(expr) {
  const res = await fetch(`${BRIDGE}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expr, awaitPromise: true }),
  });
  if (!res.ok) throw new Error(`桥接 /eval 返回 ${res.status}`);
  const data = await res.json();
  if (data && data.ok === false) throw new Error(data.error || '应用内执行失败');
  return data && 'value' in data ? data.value : data;
}

/**
 * 在应用内跑一次 fetch，返回 { status, ms, body }
 * 通过 JSON.parse 后的对象判断，避免把大响应搬来搬去
 */
async function fetchInApp(url, init, bodyLimit = 4000) {
  const payload = JSON.stringify({ url, init: init || {} });
  const expr = `
    (async () => {
      const p = ${payload};
      const t0 = performance.now();
      try {
        const r = await fetch(p.url, Object.assign({ signal: AbortSignal.timeout(60000) }, p.init));
        const text = await r.text();
        return JSON.stringify({ status: r.status, ms: Math.round(performance.now() - t0), body: text.slice(0, ${bodyLimit}) });
      } catch (e) {
        return JSON.stringify({ status: 0, ms: Math.round(performance.now() - t0), body: '', error: String(e && e.message || e) });
      }
    })()
  `;
  const raw = await evalInApp(expr);
  try { return JSON.parse(raw); } catch { return { status: 0, body: String(raw), ms: 0, error: '返回不可解析' }; }
}

async function fetchNode(url, init) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, init || {}));
    const text = await r.text();
    return { status: r.status, ms: Date.now() - t0, body: text.slice(0, 4000) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: '', error: String(e && e.message || e) };
  }
}

/** 从 /models 响应里数出模型条数 */
function countModels(text) {
  try {
    const j = JSON.parse(text || '{}');
    const arr = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : null;
    return arr ? arr.length : 0;
  } catch { return 0; }
}

function authHeader(key) {
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

async function main() {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('用法：node tools/fusion-proxy/probe.mjs [--base url] [--key sk-x | --via-cdp] [--compare] [--image]');
    return 0;
  }

  const base = args.base || DEFAULT_BASE;
  const runner = args.viaCdp ? fetchInApp : fetchNode;
  const label = args.viaCdp ? '借道应用内 fetch' : 'Node 直连';

  console.log('');
  console.log(`极物融合 · 反代验证   ${C.d(label)}`);
  console.log(`  目标  ${base}`);
  if (args.compare) console.log(`  对照  ${UPSTREAM}`);
  console.log('');

  if (!args.viaCdp && !args.key) {
    console.log(C.r('  缺少 --key：独立直连必须提供一把真实额度码。'));
    console.log(C.d('  或者改用 --via-cdp，让应用自己发请求（推荐，Key 不出应用）。'));
    return 2;
  }
  if (args.viaCdp) {
    try {
      const h = await (await fetch(`${BRIDGE}/health`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).json();
      if (!h || h.ok === false) throw new Error('桥接未就绪');
    } catch (e) {
      console.log(C.r(`  连不上调试桥接 ${BRIDGE}：${e.message}`));
      console.log(C.d('  请确认软件带 --remote-debugging-port=9222 启动，且 tools/bridge.js 在跑。'));
      return 2;
    }
  }

  const h = authHeader(args.key);

  // --- 1. 健康检查：确认反代本身活着，且不触发上游 -------------------------
  {
    const r = await fetchNode(base + PROBE_PATH);
    const ok = r.status === 200 && /fusion-proxy ok/.test(r.body || '');
    record('反代存活（/__health）', ok, ok ? '反代进程正常' : `HTTP ${r.status} ${r.error || (r.body || '').slice(0, 120)}`, r.ms);
    if (!ok) {
      console.log('');
      console.log(C.r('  反代没起来，后面的上游测试没有意义，先修服务器。'));
      return 1;
    }
  }

  // --- 2. 路径白名单：白名单外必须 404 ------------------------------------
  {
    const r = await fetchNode(base + SHOULD_404);
    record('白名单外路径被拒', r.status === 404, `HTTP ${r.status}（期望 404）`, r.ms);
  }

  // --- 3. GET /v1/models：鉴权透传 + 通到上游 ------------------------------
  let proxyCount = 0;
  let proxyModels = '';
  {
    const r = await runner(base + '/v1/models', { headers: h });
    proxyCount = countModels(r.body);
    proxyModels = r.body || '';
    // 401 也可能是「通了但 key 无效」，所以单独区分
    if (r.status === 200 && proxyCount > 0) record('GET /v1/models', true, `返回 ${proxyCount} 个模型`, r.ms);
    else if (r.status === 401 || r.status === 403) record('GET /v1/models', false, `HTTP ${r.status}：链路通但额度码无效，换一把真 Key 再测`, r.ms);
    else record('GET /v1/models', false, `HTTP ${r.status} ${(r.error || r.body || '').slice(0, 160)}`, r.ms);
  }

  // --- 4. POST /v1/chat/completions：验证 POST 与大 body 通路 --------------
  {
    const r = await runner(base + '/v1/chat/completions', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, h),
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: '回复两个字：收到' }],
        max_tokens: 8,
        stream: false,
      }),
    });
    if (r.status === 200) {
      let reply = '';
      try { reply = JSON.parse(r.body).choices?.[0]?.message?.content || ''; } catch {}
      record('POST /v1/chat/completions', true, `上游正常应答：${String(reply).trim().slice(0, 30) || '(空)'}`, r.ms);
    } else {
      record('POST /v1/chat/completions', false, `HTTP ${r.status} ${(r.error || r.body || '').slice(0, 160)}`, r.ms);
    }
  }

  // --- 5. 域名是否仍在响应里泄露 ------------------------------------------
  {
    const leak = /api\.apilio\.ai/i.test(proxyModels);
    record('响应体不含上游域名', !leak, leak ? 'sub_filter 没生效，或上游在别处返回了完整域名' : '响应里找不到 api.apilio.ai');
  }

  // --- 6. 与上游一致性对照 ------------------------------------------------
  if (args.compare) {
    const r = await fetchNode(UPSTREAM + '/v1/models', { headers: h });
    const upCount = countModels(r.body);
    const same = upCount > 0 && upCount === proxyCount;
    record('与上游模型数一致', same, `反代 ${proxyCount} vs 上游 ${upCount}`, r.ms);
  }

  // --- 7. 真出图（可选，扣费）--------------------------------------------
  if (args.image) {
    console.log(C.y('  ！--image 会真实扣费，正在出图…'));
    const r = await runner(base + '/v1/images/generations', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, h),
      body: JSON.stringify({ model: 'seedream-5-0', prompt: '一张空白的米白色墙面', size: '1K', n: 1 }),
    }, 20000);
    const hasUrl = /"(url|b64_json)"\s*:/.test(r.body || '');
    record('POST /v1/images/generations', r.status === 200 && hasUrl, `HTTP ${r.status} ${r.status === 200 && hasUrl ? '拿到图片结果' : (r.error || '')}`, r.ms);
  }

  // --- 汇总 --------------------------------------------------------------
  const pass = rows.filter(x => x.ok === true).length;
  const fail = rows.filter(x => x.ok === false).length;
  console.log('');
  console.log(`  ${fail === 0 ? C.g('全部通过') : C.r(`${fail} 项失败`)}   通过 ${pass} / 共 ${rows.length}`);
  console.log('');
  if (fail === 0) {
    console.log(C.d('  可以切客户端 baseURL 了：providers.js → PROVIDERS.apollo.baseURL'));
  }
  return fail === 0 ? 0 : 1;
}

main().then(code => exit(code)).catch(e => {
  console.error(C.r('探测异常：' + (e && e.stack || e)));
  exit(3);
});
