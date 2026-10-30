#!/usr/bin/env node
/**
 * 阿波罗生图通道探针：真调一次，确认「能出图 / 出多大 / 花多久」
 *
 * 为什么需要它：tools/check-apollo-models.mjs 只能证明模型在售、价格对得上，
 * 证明不了它真能出图。默认模型换人之前，必须先用这个脚本打一发真图。
 *
 * 用法：
 *   APOLLO_KEY=sk-xxx node tools/probe-apollo-image.mjs                # 跑全部
 *   APOLLO_KEY=sk-xxx node tools/probe-apollo-image.mjs seedream-5-0   # 只跑 id 含该字串的
 *   APOLLO_KEY=sk-xxx node tools/probe-apollo-image.mjs --ref a.png    # 带参考图测图生图
 *
 * Key 只从环境变量读，绝不落盘、绝不写进日志。
 * 出图存到 artifacts/probe/<id>.png（b64 与 url 两种返回都兼容）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'artifacts', 'probe');
const KEY = process.env.APOLLO_KEY || '';
const BASE = (process.env.APOLLO_BASE || 'https://apilio.ai/v1').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 180000);

if (!KEY) {
  console.error('缺少 APOLLO_KEY 环境变量');
  process.exit(2);
}

const argv = process.argv.slice(2);
const refIdx = argv.indexOf('--ref');
const refPath = refIdx >= 0 ? argv[refIdx + 1] : '';
const sizeIdx = argv.indexOf('--size');
const sizeOverride = sizeIdx >= 0 ? argv[sizeIdx + 1] : '';
const routeIdx = argv.indexOf('--route');
// auto：有参考图就走 edits（和应用主链路一致），无参考图走 generations。
// 有些模型只挂 generations，带图时退回 generations 手工塞 image 字段。
const routeOpt = routeIdx >= 0 ? argv[routeIdx + 1] : 'auto';
const skip = new Set([refIdx + 1, sizeIdx + 1, routeIdx + 1].filter(i => i > 0));
const filter = argv.filter((a, i) => !a.startsWith('--') && !skip.has(i)).join(' ');

// 每项都是一条要验证的通道。size 用阿波罗认的像素值，不要用 1K/2K 这种档位词。
const TASKS = [
  { id: 'seedream-5-0-2k', model: 'doubao-seedream-5-0-260128', size: '2048x2048', expect: 0.15, note: '默认模型' },
  { id: 'nano-pro-2k', model: 'nano-banana-pro', size: '2048x2048', expect: 0.20, note: '现主力' },
  { id: 'nano-pro-4k', model: 'nano-banana-pro-4k', size: '4096x4096', expect: 0.275, note: '4K 别名' },
  { id: 'gemini-2.1-4k', model: 'gemini-nano-banana-2.1-4k', size: '4096x4096', expect: 0.10, note: '最便宜 4K 候选' },
  { id: 'gemini-3.1-flash-4k', model: 'gemini-3.1-flash-image-4k', size: '4096x4096', expect: 0.137, note: '3.1 flash' },
  { id: 'seedream-v5-pro', model: 'seedream-v5-pro', size: '2048x2048', expect: 0.90, note: '高价档，谨慎' }
];

const PROMPT = 'A minimalist living room with a light oak sofa, warm afternoon sunlight through floor-to-ceiling windows, photorealistic interior photography';
// 带参考图时换成编辑指令：主链路就是「保结构、只改光」，这也是最容易暴露图生图通不通的用法
const REF_PROMPT = 'Keep the room layout, furniture positions and camera angle exactly the same as the reference image. Only change the lighting to warm evening interior lighting with the ceiling lights on. Photorealistic interior photography.';

function imageSize(buf) {
  // 只读 PNG / JPEG 头，避免为了量尺寸引入依赖
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function runOne(task) {
  const model = task.model;
  const prompt = refPath ? REF_PROMPT : PROMPT;
  const size = sizeOverride || task.size;
  const useEdits = !!refPath && routeOpt !== 'generations' && (routeOpt === 'edits' || routeOpt === 'auto');
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let endpoint = useEdits ? `${BASE}/images/edits` : `${BASE}/images/generations`;
  let payload;
  try {
    if (useEdits) {
      // 应用主链路就是这条路：multipart/form-data 传参考图（不是 JSON 里塞 base64）
      const ext = (path.extname(refPath).slice(1).toLowerCase() || 'png');
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', size);
      form.append('response_format', 'b64_json');
      form.append('image', new Blob([fs.readFileSync(refPath)], { type: mime }), path.basename(refPath));
      payload = { headers: { Authorization: `Bearer ${KEY}` }, body: form };
    } else {
      const body = { model, prompt, n: 1, size, response_format: 'b64_json' };
      if (refPath) {
        const ext = path.extname(refPath).slice(1).toLowerCase() || 'png';
        const b64 = fs.readFileSync(refPath).toString('base64');
        body.image = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`;
      }
      payload = { headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }
    const res = await fetch(endpoint, { method: 'POST', ...payload, signal: ctrl.signal });
    const ms = Date.now() - started;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    if (!res.ok || !json || json.error) {
      const msg = (json && json.error && (json.error.message || json.error.code)) || text.slice(0, 160);
      return { ...task, ok: false, status: res.status, ms, error: msg };
    }

    const item = (json.data && json.data[0]) || {};
    let buffer = null;
    if (item.b64_json) {
      // 有的模型返回纯 base64，有的返回 data:image/jpeg;base64,xxx 整串。
      // 后者直接 Buffer.from(s,'base64') 不会报错，但会把 "dataimagejpegbase64" 当数据解成
      // 15 字节垃圾垫在文件头前面，图看着能存、其实打不开。必须先剥前缀。
      let b64 = String(item.b64_json);
      const m = b64.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]*)$/i);
      if (m) b64 = m[1];
      buffer = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    } else if (item.url) {
      const imgRes = await fetch(item.url);
      buffer = Buffer.from(await imgRes.arrayBuffer());
    }
    if (!buffer || !buffer.length) {
      return { ...task, ok: false, status: res.status, ms, error: '返回里没有图（无 b64_json / url）' };
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    // 扩展名按实际字节判断：上游 b64 常常是 jpeg，直接存 .png 会让图片查看器和尺寸解析都认错
    const ext = buffer[0] === 0x89 && buffer[1] === 0x50 ? 'png'
      : buffer[0] === 0xff && buffer[1] === 0xd8 ? 'jpg'
      : buffer.slice(0, 4).toString('ascii') === 'RIFF' ? 'webp' : 'png';
    const file = path.join(OUT_DIR, (refPath ? 'ref-' : '') + task.id + '-' + (useEdits ? 'edits' : 'gen') + '.' + ext);
    fs.writeFileSync(file, buffer);
    const dim = imageSize(buffer);
    return { ...task, ok: true, status: res.status, ms, file, bytes: buffer.length, dim, usage: json.usage || null };
  } catch (err) {
    return { ...task, ok: false, status: 0, ms: Date.now() - started, error: err.name === 'AbortError' ? `超时 ${TIMEOUT_MS / 1000}s` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const picked = TASKS.filter(t => !filter || t.id.includes(filter) || t.model.includes(filter));
console.log(`通道探针 · ${picked.length} 个任务 · 基准 ${BASE}${refPath ? ' · 带参考图 ' + path.basename(refPath) : ''}\n`);

const results = [];
for (const task of picked) {
  process.stdout.write(`… ${task.id.padEnd(22)} ${task.model.padEnd(32)} `);
  const r = await runOne(task);
  results.push(r);
  if (r.ok) {
    const dim = r.dim ? `${r.dim.w}×${r.dim.h}` : '尺寸未知';
    console.log(`✓ ${String(r.ms / 1000).padStart(5)}s  ${dim.padEnd(11)} ${(r.bytes / 1024 / 1024).toFixed(2)}MB  ¥${r.expect}`);
  } else {
    console.log(`✗ ${String(r.ms / 1000).padStart(5)}s  [${r.status}] ${r.error}`);
  }
}

const okCount = results.filter(r => r.ok).length;
console.log(`\n成功 ${okCount} / ${results.length}`);
const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.log('\n失败明细：');
  failed.forEach(r => console.log(`  · ${r.id} (${r.model}) → ${r.error}`));
  process.exitCode = 1;
}
