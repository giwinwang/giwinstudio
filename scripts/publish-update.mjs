// 生成自动更新清单（version.json）
// 用法：
//   node scripts/publish-update.mjs --base-url https://download.example.com --notes "修复素材丢失|新增批量导出"
//   可选：--channel beta|stable  --force  --file <安装包路径>
// 产物：update/version.json（上传到 Cloudflare Pages 根目录）
// 安装包本体上传到 R2，文件名必须与 url 末段一致。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argOf(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1];
  return fallback;
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(version)) {
  console.error('package.json 的 version 不合法：' + version);
  process.exit(1);
}

const channel = argOf('--channel', version.includes('-') ? 'beta' : 'beta');
if (!['beta', 'stable'].includes(channel)) {
  console.error('--channel 只能是 beta 或 stable');
  process.exit(1);
}

function findInstaller() {
  const explicit = argOf('--file', '');
  if (explicit) {
    const full = path.resolve(root, explicit);
    if (!fs.existsSync(full)) throw new Error('指定的安装包不存在：' + full);
    return full;
  }
  const dir = path.join(root, 'release-branded');
  if (!fs.existsSync(dir)) throw new Error('找不到 release-branded 目录，请先执行打包');
  const candidates = fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.exe'))
    .filter(name => name.includes(version))
    .map(name => path.join(dir, name));
  if (!candidates.length) throw new Error('release-branded 下找不到版本 ' + version + ' 的安装包');
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

const installer = findInstaller();
const buffer = fs.readFileSync(installer);
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
const size = buffer.length;
const fileName = path.basename(installer);

const baseUrl = argOf('--base-url', '').replace(/\/+$/, '');
if (!baseUrl) {
  console.warn('⚠ 未提供 --base-url，清单里的下载地址会是占位符，客户端无法下载。');
}

const notes = argOf('--notes', '')
  .split('|')
  .map(item => item.trim())
  .filter(Boolean);

const manifest = {
  version,
  channel,
  releaseDate: new Date().toISOString().slice(0, 10),
  notes: notes.length ? notes : ['细节改进与问题修复'],
  url: (baseUrl || 'https://REPLACE-ME.example.com') + '/' + encodeURIComponent(fileName),
  sha256,
  size
};
if (process.argv.includes('--force')) manifest.force = true;

// ---------- 图文素材（update-assets/highlights.json，可选） ----------
// 结构：{ "banner": "banner.webp", "highlights": [{ "image": "x.webp", "title": "...", "text": "..." }] }
// 引用的图片会被复制到 update/images/，清单里写 <base-url>/images/<文件名>。
const assetsDir = path.join(root, 'update-assets');
const assetsMeta = path.join(assetsDir, 'highlights.json');
const effectiveBase = baseUrl || 'https://REPLACE-ME.example.com';
if (fs.existsSync(assetsMeta)) {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(assetsMeta, 'utf8'));
  } catch (error) {
    console.error('update-assets/highlights.json 解析失败：' + error.message);
    process.exit(1);
  }
  const imagesDir = path.join(root, 'update', 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const copyImage = (name) => {
    if (!name || typeof name !== 'string') return '';
    const src = path.join(assetsDir, path.basename(name));
    if (!fs.existsSync(src)) {
      console.error('update-assets 缺少图片：' + name);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(imagesDir, path.basename(name)));
    return effectiveBase + '/images/' + encodeURIComponent(path.basename(name));
  };
  if (meta.banner) manifest.banner = copyImage(meta.banner);
  if (Array.isArray(meta.highlights) && meta.highlights.length) {
    manifest.highlights = meta.highlights.slice(0, 8).map((item) => ({
      image: copyImage(item.image),
      title: String(item.title || '').slice(0, 40),
      text: String(item.text || '').slice(0, 160)
    })).filter((item) => item.image || item.title || item.text);
  }
  console.log('图文素材：已复制到 update/images/（共 ' + manifest.highlights.length + ' 条要点' + (manifest.banner ? ' + banner' : '') + '）');
}

const outDir = path.join(root, 'update');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'version.json');
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('安装包：' + installer);
console.log('版本：' + version + '（' + channel + '）');
console.log('大小：' + (size / 1024 / 1024).toFixed(1) + ' MB');
console.log('SHA256：' + sha256);
console.log('清单：' + outFile);
console.log('');
console.log(JSON.stringify(manifest, null, 2));
console.log('');
console.log('下一步：');
console.log('  1. 把 ' + fileName + ' 上传到 R2，保持文件名不变');
console.log('  2. 把 update/version.json 上传到 Pages 站点根目录');
console.log('  3. 确认 update-config.json 的 manifestUrl 指向该 version.json');
