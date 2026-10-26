// 把安装包推到 GitHub Releases，并校验线上清单可达
// 用法：
//   GITHUB_TOKEN=ghp_xxx node scripts/release-push.mjs
//   可选：--repo giwinwang/giwinstudio  --tag v0.4.31  --file release-branded/xxx.exe
//         --notes "要点一|要点二"       --draft（先建草稿，不公开）
//
// 前置：update/version.json 已经在仓库 main 分支（本脚本会检查 raw 地址是否可读）
// 说明：不写死任何密钥，token 只从环境变量或 --token 读取。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();

function argOf(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1];
  return fallback;
}

const token = argOf('--token', process.env.GITHUB_TOKEN || '').trim();
if (!token) {
  console.error('缺少 token：请设置环境变量 GITHUB_TOKEN，或用 --token 传入');
  process.exit(1);
}

const repo = argOf('--repo', 'giwinwang/giwinstudio').trim();
const tag = argOf('--tag', 'v' + version).trim();
const draft = process.argv.includes('--draft');

const notes = argOf('--notes', '')
  .split('|')
  .map(item => item.trim())
  .filter(Boolean);

function findInstaller() {
  const explicit = argOf('--file', '');
  if (explicit) {
    const full = path.resolve(root, explicit);
    if (!fs.existsSync(full)) throw new Error('指定的安装包不存在：' + full);
    return full;
  }
  const dir = path.join(root, 'release-branded');
  if (!fs.existsSync(dir)) throw new Error('找不到 release-branded 目录，请先打包');
  const candidates = fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.exe') && name.includes(version))
    .map(name => path.join(dir, name));
  if (!candidates.length) throw new Error('release-branded 下找不到版本 ' + version + ' 的安装包');
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

const api = 'https://api.github.com';
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'giwin-studio-release'
};

async function call(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`GitHub API ${response.status} ${url}\n${detail}`);
  }
  return body;
}

async function main() {
  const who = await call(api + '/user');
  console.log('已认证：' + who.login);

  const installer = findInstaller();
  const fileName = path.basename(installer);
  const size = fs.statSync(installer).size;
  console.log('安装包：' + fileName + '（' + (size / 1024 / 1024).toFixed(1) + ' MB）');

  // 1) 建或取 release
  let release = null;
  try {
    release = await call(`${api}/repos/${repo}/releases/tags/${tag}`);
    console.log('已存在 Release：' + tag);
  } catch (error) {
    if (!/ 404 /.test(String(error.message))) throw error;
  }
  if (!release) {
    release = await call(`${api}/repos/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: '极物 GIWIN Studio ' + version,
        body: notes.length ? notes.map(n => '- ' + n).join('\n') : '细节改进与问题修复',
        draft,
        prerelease: version.includes('-')
      })
    });
    console.log('已创建 Release：' + tag);
  }

  // 2) 上传安装包（已存在同名附件则先删）
  const existing = (release.assets || []).find(item => item.name === fileName);
  if (existing) {
    await call(`${api}/repos/${repo}/releases/assets/${existing.id}`, { method: 'DELETE' });
    console.log('已删除旧附件：' + fileName);
  }
  const uploadUrl = String(release.upload_url).split('{')[0];
  const buffer = fs.readFileSync(installer);
  const asset = await call(`${uploadUrl}?name=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buffer.length) },
    body: buffer
  });
  console.log('已上传附件：' + asset.name + '（' + (asset.size / 1024 / 1024).toFixed(1) + ' MB）');
  console.log('下载地址：' + asset.browser_download_url);

  // 3) 刷新 jsDelivr 缓存：客户端清单/配图走 CDN，不刷新最长可能滞后 12 小时
  const purgeTargets = ['version.json', 'images/banner.webp', 'images/hl-update.webp', 'images/hl-workflow.webp', 'images/hl-canvas.webp'];
  for (const item of purgeTargets) {
    const purgeUrl = `https://purge.jsdelivr.net/gh/${repo}@main/update/${item}`;
    try {
      const response = await fetch(purgeUrl, { signal: AbortSignal.timeout(15000) });
      console.log('缓存刷新 ' + item + '：HTTP ' + response.status);
    } catch (error) {
      console.warn('缓存刷新失败 ' + item + '：' + error.message);
    }
  }

  // 4) 校验线上清单
  const manifestUrl = 'https://cdn.jsdelivr.net/gh/' + repo + '@main/update/version.json';
  try {
    const response = await fetch(manifestUrl + '?t=' + Date.now());
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const manifest = await response.json();
    console.log('线上清单版本：' + manifest.version + '（本机 ' + version + '）');
    if (manifest.version !== version) {
      console.warn('⚠ 线上清单版本与本机不一致，请确认 update/version.json 已推送');
    }
    if (manifest.url !== asset.browser_download_url) {
      console.warn('⚠ 清单里的下载地址与刚上传的附件不一致：\n  ' + manifest.url);
    }
  } catch (error) {
    console.warn('⚠ 清单暂不可读（若刚推送需等缓存）：' + error.message);
  }

  console.log('');
  console.log('下一步：确认 version.json 已在 main 分支，客户端「用户菜单 → 检查更新」即可验证');
}

main().catch(error => {
  console.error('失败：' + error.message);
  process.exit(1);
});
