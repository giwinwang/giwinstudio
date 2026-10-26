#!/usr/bin/env node
/**
 * 把 update/version.json 同步到官网的 site-config.js。
 *
 * 清单是唯一数据源：版本号、大小、SHA256、网盘链接都从清单里取，
 * 避免手工改官网时出现「官网写 0.4.31、实际包是 0.4.30」这类错位。
 *
 * 用法：
 *   npm run site:sync
 *   npm run site:sync -- --site-dir "G:/.../05_GIWIN-官网"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? (i += 1, next) : true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const siteDir = path.resolve(root, args['site-dir'] || '../05_GIWIN-官网');
const manifestPath = path.join(root, 'update', 'version.json');

if (!fs.existsSync(manifestPath)) {
  console.error('找不到更新清单：' + manifestPath);
  console.error('先运行 npm run publish:update 生成清单。');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const version = String(manifest.version || '').trim();
const sha256 = String(manifest.sha256 || '').trim().toUpperCase();
const sizeBytes = Number(manifest.size);
const downloadUrl = String(manifest.manualUrl || '').trim();

if (!version) { console.error('清单缺少 version'); process.exit(1); }
if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) { console.error('清单缺少有效的 size'); process.exit(1); }
if (!downloadUrl) {
  console.error('清单缺少 manualUrl（官网需要一个人人可下载的网盘地址）。');
  console.error('先用 --manual-url 重新生成清单，再跑这个脚本。');
  process.exit(1);
}

const sizeMb = (sizeBytes / 1024 / 1024).toFixed(2) + ' MB';
const releaseDate = String(manifest.releaseDate || '').trim() || new Date().toISOString().slice(0, 10);

let extractCode = '';
try {
  const parsed = new URL(downloadUrl);
  extractCode = (parsed.searchParams.get('pwd') || '').trim();
} catch (error) {
  console.error('网盘链接不是合法 URL：' + downloadUrl);
  process.exit(1);
}

// 保留站点原有的联系邮箱，避免每次同步都覆盖掉
const targets = [path.join(siteDir, 'site-config.js'), path.join(siteDir, 'dist', 'site-config.js')];
let contactEmail = 'giwinwang@gmail.com';
const existing = targets.find((file) => fs.existsSync(file));
if (existing) {
  const matched = fs.readFileSync(existing, 'utf8').match(/contactEmail:\s*"([^"]*)"/);
  if (matched) contactEmail = matched[1];
}

const content = `// 本文件由 npm run site:sync 从 update/version.json 生成，请勿手工编辑。
window.GIWIN_SITE_CONFIG = {
  version: ${JSON.stringify(version)},
  releaseDate: ${JSON.stringify(releaseDate)},
  installerSize: ${JSON.stringify(sizeMb)},
  downloadUrl: ${JSON.stringify(downloadUrl)},
  extractCode: ${JSON.stringify(extractCode)},
  sha256: ${JSON.stringify(sha256)},
  contactEmail: ${JSON.stringify(contactEmail)}
};
`;

let written = 0;
for (const file of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (before === content) continue;
  fs.writeFileSync(file, content, 'utf8');
  written += 1;
  console.log('已更新 ' + path.relative(root, file));
}

console.log('');
console.log('  版本      ' + version);
console.log('  发布日期  ' + releaseDate);
console.log('  安装包    ' + sizeMb);
console.log('  下载链接  ' + downloadUrl);
console.log('  提取码    ' + (extractCode || '（无）'));
console.log('  SHA-256   ' + sha256);
console.log('');
if (written === 0) {
  console.log('内容已是最新，未改动文件。');
} else {
  console.log('下一步：把 ' + path.join(siteDir, 'giwin-site-deploy.zip') + ' 重新打包并上传 Cloudflare Pages。');
}
