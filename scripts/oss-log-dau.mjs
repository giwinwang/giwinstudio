#!/usr/bin/env node
/**
 * 极物活跃统计 · OSS 访问日志分析（cid 心跳）
 *
 * 背景：update-service.js 每次检查更新会在清单 URL 上附加匿名 cid（16 位 hex）
 * 和当前版本 v。OSS bucket `giwin-cn-web` 开启访问日志后，每天会落一个
 * oss://giwin-cn-web/logs/ 下的日志文件（下载回来是 .log / .csv.gz 文本）。
 *
 * 用法：
 *   node scripts/oss-log-dau.mjs <日志文件或目录>...        # 汇总日活
 *   node scripts/oss-log-dau.mjs <日志目录> --days 7        # 只看最近 7 天
 *   node scripts/oss-log-dau.mjs <日志目录> --json          # 输出 JSON
 *
 * 日志下载方法（ossutil）：
 *   ossutil cp -r oss://giwin-cn-web/logs/ ./oss-logs/ -f
 *
 * 日活口径：按自然日去重 cid 数 = 当天打开过（触发更新检查）的独立装机数。
 * 注意：cid 每 6 小时才上报一次，当天短暂数分钟的机器可能不计入。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const daysIdx = args.indexOf('--days');
const limitDays = daysIdx >= 0 ? Number(args[daysIdx + 1]) : Infinity;
const inputs = args.filter((a, i) => !a.startsWith('--') && i !== daysIdx + 1 && !(daysIdx >= 0 && i === daysIdx - 0 && false));
const paths = inputs.length ? inputs : ['.'];

// ---------- 收集文件（支持 .log / .csv / .gz） ----------
function collectFiles(p, out = []) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) collectFiles(path.join(p, name), out);
  } else if (/\.(log|csv|txt|gz)$/i.test(p)) {
    out.push(p);
  }
  return out;
}

function readLines(file) {
  if (/\.gz$/i.test(file)) {
    return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split(/\r?\n/);
  }
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

// ---------- 解析 ----------
// OSS 日志是空格分隔的固定字段表，其中：
//   字段 3 = "GET /update/version.json?...&cid=xxxx&v=0.4.35 HTTP/1.1"（带引号）
//   字段 4 = 时间，形如 28/Oct/2026:12:34:56 +0800
// 直接用正则从整行抓 cid / v / 时间，比数列号更抗字段变动。
const CID_RE = /\bcid=([0-9a-f]{16})\b/i;
const VER_RE = /\bv=([0-9A-Za-z.\-]+)/;
const TIME_RE = /\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):\d{2}:\d{2}\s*[+-]\d{4}\]/;
const MONTH = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

const daily = new Map();   // 'YYYY-MM-DD' -> Map(cid -> Set(version))
let totalPings = 0;
let filesRead = 0;

for (const p of paths.flatMap(x => collectFiles(x))) {
  let lines;
  try { lines = readLines(p); } catch (error) { console.error('跳过（读取失败）: ' + p + ' → ' + error.message); continue; }
  filesRead++;
  for (const line of lines) {
    if (!line || !line.includes('cid=')) continue;
    const cidMatch = line.match(CID_RE);
    if (!cidMatch) continue;
    const tMatch = line.match(TIME_RE);
    if (!tMatch) continue;
    const day = `${tMatch[3]}-${String(MONTH[tMatch[2]] || 0).padStart(2, '0')}-${tMatch[1]}`;
    if (!day || day.endsWith('-00')) continue;
    const vMatch = line.match(VER_RE);
    totalPings++;
    if (!daily.has(day)) daily.set(day, new Map());
    const cids = daily.get(day);
    if (!cids.has(cidMatch[1])) cids.set(cidMatch[1], new Set());
    if (vMatch) cids.get(cidMatch[1]).add(vMatch[1]);
  }
}

// ---------- 输出 ----------
const rows = [...daily.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .filter(([day]) => {
    if (!Number.isFinite(limitDays)) return true;
    const diff = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(day)) / 86400000);
    return diff >= 0 && diff < limitDays;
  })
  .map(([day, cids]) => {
    const verCount = {};
    for (const vs of cids.values()) {
      const v = [...vs].sort().pop() || 'unknown';
      verCount[v] = (verCount[v] || 0) + 1;
    }
    return { day, dau: cids.size, versions: verCount };
  });

if (jsonOut) {
  console.log(JSON.stringify({ totalPings, filesRead, days: rows }, null, 2));
} else {
  console.log('活跃装机心跳（按更新检查 cid 去重）\n');
  console.log('日期        日活   版本分布');
  for (const r of rows) {
    const vers = Object.entries(r.versions).map(([v, n]) => `${v}×${n}`).join('  ');
    console.log(`${r.day}  ${String(r.dau).padStart(4)}   ${vers}`);
  }
  console.log(`\n共 ${rows.length} 天 · 心跳请求 ${totalPings} 次 · 解析文件 ${filesRead} 个`);
  if (!rows.length) console.log('（没有匹配到 cid 数据——确认日志目录是从 oss://giwin-cn-web/logs/ 下载的，且新版本已发出）');
}
