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
import { spawnSync } from 'node:child_process';
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

// ---------- 阿里云 OSS（www.giwin.cn）----------
//
// 2026-10-31 踩坑：本脚本原来只刷 jsDelivr 缓存，从来没把 version.json 传到 OSS，
// 而客户端读的是 https://www.giwin.cn/update/version.json（见 update-config.json）。
// 结果发了 0.4.42，线上清单还停在 0.4.41，所有用户一个更新提示都收不到。
// 所以这一步不能省，也失败不得——缺 ossutil 必须报错而不是静默跳过。
const OSS_ENDPOINT = process.env.OSS_ENDPOINT || 'oss-cn-hongkong.aliyuncs.com';
const OSS_BUCKET = (process.env.OSS_BUCKET || 'oss://giwin-cn-web').replace(/\/+$/, '');

function findOssutil() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    process.env.OSSUTIL_PATH,
    path.join(home, '.ossutil-bin', 'ossutil-v1.7.19-windows-amd64', 'ossutil.exe'),
    'ossutil'
  ].filter(Boolean);
  for (const item of candidates) {
    try {
      if (item.includes(path.sep) || item.includes('/')) { if (fs.existsSync(item)) return item; }
      else { const probe = spawnSync(item, ['--version'], { stdio: 'ignore' }); if (probe.status === 0) return item; }
    } catch { /* 继续找下一个 */ }
  }
  return null;
}

// 本机代理会把 OSS 请求掐成 502，必须把 no_proxy 顶掉
function ossEnv() {
  return { ...process.env, no_proxy: '*', NO_PROXY: '*', HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' };
}

function ossPut(ossutil, localFile, remotePath) {
  const result = spawnSync(ossutil, ['-e', OSS_ENDPOINT, 'cp', localFile, remotePath, '-f'], {
    stdio: 'ignore', env: ossEnv(), timeout: 20 * 60 * 1000
  });
  if (result.status !== 0) throw new Error('上传失败 ' + remotePath + '（ossutil 退出码 ' + result.status + '）');
}

function uploadManifestToOss() {
  const ossutil = findOssutil();
  const manifest = path.join(root, 'update', 'version.json');
  if (!ossutil) {
    // 不静默跳过：这一步漏了等于这次发布对用户完全不发生
    console.error('\n✗ 没找到 ossutil，update/version.json 没能传到 www.giwin.cn。');
    console.error('  客户端读的就是这里，不传用户收不到任何更新提示。');
    console.error('  解决：装 ossutil 后用环境变量指定，例如 OSSUTIL_PATH=C:\\tools\\ossutil.exe');
    process.exitCode = 1;
    return false;
  }
  if (!fs.existsSync(manifest)) throw new Error('缺 update/version.json');
  try {
    ossPut(ossutil, manifest, OSS_BUCKET + '/update/version.json');
    // 页面/脚本一律禁用强缓存，否则浏览器按启发式缓存拿旧清单
    spawnSync(ossutil, ['-e', OSS_ENDPOINT, 'set-meta', OSS_BUCKET + '/update/version.json', 'Cache-Control:no-cache'], {
      stdio: 'ignore', env: ossEnv()
    });
    console.log('已上传清单到 OSS：' + OSS_BUCKET + '/update/version.json');
    return true;
  } catch (error) {
    console.error('\n✗ 清单上传 OSS 失败：' + error.message);
    process.exitCode = 1;
    return false;
  }
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

  // 4) 把清单传到 OSS：客户端读的就是这个地址，漏了等于这次发布没发生
  uploadManifestToOss();

  // 5) 逐个源校验。www.giwin.cn 是硬指标，其它源只作参考（CDN 最长滞后 12 小时）。
  const sources = [
    { name: 'www.giwin.cn（客户端实际读取）', url: 'https://www.giwin.cn/update/version.json', critical: true },
    { name: 'jsDelivr CDN', url: 'https://cdn.jsdelivr.net/gh/' + repo + '@main/update/version.json', critical: false },
    { name: 'GitHub raw', url: 'https://raw.githubusercontent.com/' + repo + '/main/update/version.json', critical: false }
  ];
  for (const source of sources) {
    try {
      const response = await fetch(source.url + '?t=' + Date.now(), { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const manifest = await response.json();
      const same = manifest.version === version;
      console.log((same ? '✓ ' : '✗ ') + source.name + '：' + manifest.version + '（本机 ' + version + '）');
      if (!same) {
        console.warn('  ⚠ 版本不一致' + (source.critical ? ' —— 这里不对，用户收不到更新' : '（CDN 缓存，可等或手动刷新）'));
        if (source.critical) process.exitCode = 1;
      }
      // 清单里的下载地址必须指向本次的安装包文件名，不能还留着上一版的路径
      if (manifest.url && !String(manifest.url).includes(fileName)) {
        console.warn('  ⚠ 清单下载地址与本版安装包不符：' + manifest.url);
        if (source.critical) process.exitCode = 1;
      }
    } catch (error) {
      console.warn('  ⚠ 读不到 ' + source.name + '：' + error.message);
      if (source.critical) process.exitCode = 1;
    }
  }

  console.log('');
  console.log(process.exitCode ? '✗ 有硬性校验没过，请修完再宣布发版' : '✓ 发布完成，客户端「用户菜单 → 检查更新」即可验证');
}

main().catch(error => {
  console.error('失败：' + error.message);
  process.exit(1);
});
