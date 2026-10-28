// 极物 GIWIN Studio · 自动更新服务
// 职责：检查更新清单 → 弹窗提示 → 下载安装包 → SHA256 校验 → 静默安装并自动重启。
// 设计约束：
//  - 不使用 electron-updater：安装器是自研 C# 品牌安装器（非 NSIS），静默参数为
//    `Setup.exe --silent <目录> --no-shortcuts --launch --wait-pid <pid>`，
//    安装器会先等本进程退出，再替换文件并启动新版本。
//  - 自动检查失败一律静默（不打扰用户）；手动检查才把错误返回给界面。
//  - 开发版（app.isPackaged === false）不参与自动更新。
//  - 更新源地址在项目根 update-config.json 配置，留空则完全不检查。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_STALL_TIMEOUT_MS = 60 * 1000;
const VALID_CHANNELS = new Set(['beta', 'stable']);

// ---------- 版本比较（支持 0.4.29 与 0.4.30-beta.1 这类 prerelease） ----------

function parseVersion(input) {
  const m = String(input == null ? '' : input).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

function comparePreSegment(a, b) {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na) return -1; // 数字段 < 字符串段（semver 规则）
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// 返回 -1 / 0 / 1；任一版本非法时返回 0（调用方须先校验）
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] < vb.core[i] ? -1 : 1;
  }
  if (!va.pre.length && !vb.pre.length) return 0;
  if (!va.pre.length) return 1;
  if (!vb.pre.length) return -1;
  const len = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < len; i++) {
    if (va.pre[i] === undefined) return -1;
    if (vb.pre[i] === undefined) return 1;
    const c = comparePreSegment(va.pre[i], vb.pre[i]);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

// beta 客户端可收 beta 与 stable；stable 客户端只收 stable
function channelAccepts(clientChannel, releaseChannel) {
  if (clientChannel === 'stable') return releaseChannel === 'stable';
  return releaseChannel === 'beta' || releaseChannel === 'stable';
}

// ---------- 清单校验 ----------

function validateImageUrl(value, allowInsecure) {
  if (typeof value !== 'string' || !value) return false;
  if (/^https:\/\//i.test(value)) return true;
  return allowInsecure === true && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(value);
}

function validateManifest(raw, options) {
  const allowInsecure = !!(options && options.allowInsecure === true);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '清单不是对象' };
  if (!parseVersion(raw.version)) return { ok: false, error: '清单缺少合法的 version' };
  if (!VALID_CHANNELS.has(raw.channel)) return { ok: false, error: '清单 channel 非法' };
  if (typeof raw.url !== 'string' || !(validateImageUrl(raw.url, allowInsecure))) return { ok: false, error: '清单下载地址必须是 https' };
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(raw.sha256)) return { ok: false, error: '清单 sha256 非法' };
  if (!Number.isInteger(raw.size) || raw.size <= 0) return { ok: false, error: '清单 size 非法' };
  if (raw.notes != null && !Array.isArray(raw.notes)) return { ok: false, error: '清单 notes 必须是数组' };
  if (raw.highlights != null && !Array.isArray(raw.highlights)) return { ok: false, error: '清单 highlights 必须是数组' };

  const highlights = Array.isArray(raw.highlights) ? raw.highlights.slice(0, 8).map((item, index) => {
    const entry = item && typeof item === 'object' ? item : {};
    const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 40) : '';
    const text = typeof entry.text === 'string' ? entry.text.trim().slice(0, 160) : '';
    const image = validateImageUrl(entry.image, allowInsecure) ? entry.image : '';
    return { title: title || ('更新 ' + (index + 1)), text, image };
  }).filter(item => item.title || item.text || item.image) : [];

  const banner = validateImageUrl(raw.banner, allowInsecure) ? raw.banner : '';
  // 备用下载（网盘页面等）：主下载失败或过慢时给用户的手动入口
  const manualUrl = typeof raw.manualUrl === 'string' && /^https:\/\//i.test(raw.manualUrl) ? raw.manualUrl : '';

  return {
    ok: true,
    manifest: {
      version: String(raw.version).trim(),
      channel: raw.channel,
      url: raw.url,
      sha256: raw.sha256.toLowerCase(),
      size: raw.size,
      notes: Array.isArray(raw.notes) ? raw.notes.map(String).slice(0, 20) : [],
      highlights,
      banner,
      manualUrl,
      releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate : '',
      minVersion: parseVersion(raw.minVersion) ? String(raw.minVersion).trim() : '',
      force: raw.force === true
    }
  };
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

// ---------- 服务主体 ----------

class UpdateService {
  constructor(options) {
    this.app = options.app;
    this.ipcMain = options.ipcMain;
    this.net = options.net;
    this.shell = options.shell;
    this.getWindow = options.getWindow || (() => null);
    this.configPath = options.configPath || path.join(this.app.getAppPath(), 'update-config.json');
    this.statePath = options.statePath || path.join(this.app.getPath('userData'), 'update-state.json');
    this.downloadRoot = options.downloadRoot || path.join(this.app.getPath('temp'), 'giwin-update');

    this.timer = null;
    this.intervalTimer = null;
    this.abort = null;
    this.devAllow = process.env.GW_UPDATE_DEV === '1';
    this.state = {
      phase: 'idle',            // idle | checking | available | downloading | ready | installing | error
      error: '',
      manualError: false,
      release: null,            // validateManifest 产物
      progress: { received: 0, total: 0, percent: 0 },
      lastCheck: 0
    };
  }

  // ---------- 状态与持久化 ----------

  readStateFile() {
    try { return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch (e) { return {}; }
  }

  writeStateFile(patch) {
    try {
      const next = Object.assign(this.readStateFile(), patch);
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(next, null, 2));
    } catch (e) { /* 状态文件写失败不影响主流程 */ }
  }

  skippedVersion() {
    return this.readStateFile().skippedVersion || '';
  }

  emit(extra) {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:event', Object.assign({}, this.snapshot(), extra || {}));
    }
  }

  snapshot() {
    return {
      phase: this.state.phase,
      error: this.state.error,
      manualError: this.state.manualError,
      release: this.state.release,
      progress: this.state.progress,
      lastCheck: this.state.lastCheck,
      skippedVersion: this.skippedVersion(),
      currentVersion: this.app.getVersion(),
      channel: this.config.channel,
      packaged: this.app.isPackaged
    };
  }

  // ---------- 配置与启动 ----------

  readConfig() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch (e) { /* 缺省配置 */ }

    // 更新源支持多地址：manifestUrl 为主源，manifestUrls 为备用源。
    // 客户端会并发请求所有源，谁先返回有效清单就用谁（国内 raw.githubusercontent 常超时）。
    const primary = process.env.GW_UPDATE_MANIFEST_URL || (typeof raw.manifestUrl === 'string' ? raw.manifestUrl.trim() : '');
    const urls = [];
    if (primary) urls.push(primary);
    if (Array.isArray(raw.manifestUrls)) {
      for (const item of raw.manifestUrls) {
        if (typeof item !== 'string') continue;
        const url = item.trim();
        if (url && !urls.includes(url)) urls.push(url);
      }
    }

    this.config = {
      manifestUrl: urls[0] || '',
      manifestUrls: urls,
      // 安装包下载镜像模板：{url} 替换为清单下载地址，{version} 替换为新版本号。
      // 主地址下载失败时依次尝试镜像（SHA256 校验兜底，换源不影响安全性）。
      assetMirrors: Array.isArray(raw.assetMirrors)
        ? raw.assetMirrors.filter((item) => typeof item === 'string' && (item.includes('{url}') || item.includes('{version}')))
        : [],
      channel: VALID_CHANNELS.has(raw.channel) ? raw.channel : 'beta',
      enabled: raw.enabled !== false,
      checkDelayMs: Number.isInteger(raw.checkDelayMs) ? raw.checkDelayMs : 8000,
      checkIntervalMs: Number.isInteger(raw.checkIntervalMs) ? raw.checkIntervalMs : 6 * 60 * 60 * 1000
    };
    return this.config;
  }

  start() {
    this.readConfig();
    this.cleanupOldDownloads();
    // 开发版默认不参与自动更新；GW_UPDATE_DEV=1 仅供联调时验证检查与下载（安装仍拒绝）
    this.devAllow = process.env.GW_UPDATE_DEV === '1';
    if (!this.config.enabled) return;
    if (!this.app.isPackaged && !this.devAllow) return;
    this.timer = setTimeout(() => { this.check({ manual: false }).catch(() => {}); }, Math.max(1000, this.config.checkDelayMs));
    this.intervalTimer = setInterval(() => { this.check({ manual: false }).catch(() => {}); }, Math.max(10 * 60 * 1000, this.config.checkIntervalMs));
    if (this.intervalTimer.unref) this.intervalTimer.unref();
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.cancelDownload();
  }

  cleanupOldDownloads() {
    try {
      const current = this.readStateFile().downloadedVersion;
      if (!fs.existsSync(this.downloadRoot)) return;
      for (const name of fs.readdirSync(this.downloadRoot)) {
        if (name === current) continue;
        fs.rmSync(path.join(this.downloadRoot, name), { recursive: true, force: true });
      }
    } catch (e) { /* 清理失败不影响启动 */ }
  }

  // ---------- 检查 ----------

  async check(options) {
    const opts = options || {};
    if (this.state.phase === 'downloading' || this.state.phase === 'installing') {
      return this.snapshot();
    }
    this.state.phase = 'checking';
    this.state.error = '';
    this.state.manualError = false;
    if (opts.manual) this.emit();

    try {
      if (!this.config.manifestUrl) {
        if (opts.manual) throw new Error('尚未配置更新源（update-config.json 的 manifestUrl 为空）');
        return this.snapshot();
      }
      const manifest = await this.fetchManifest();
      this.state.lastCheck = Date.now();
      this.writeStateFile({ lastCheck: this.state.lastCheck });

      const current = this.app.getVersion();
      const cmp = compareVersions(manifest.version, current);
      if (cmp <= 0 || !channelAccepts(this.config.channel, manifest.channel)) {
        this.state.phase = 'idle';
        this.state.release = null;
        if (opts.manual) this.emit({ upToDate: true });
        return this.snapshot();
      }
      if (manifest.minVersion && compareVersions(current, manifest.minVersion) < 0) {
        manifest.force = true; // 低于最低可用版本时强制更新
      }
      if (!manifest.force && manifest.version === this.skippedVersion()) {
        this.state.phase = 'idle';
        this.state.release = null;
        return this.snapshot();
      }
      this.state.release = manifest;
      this.state.phase = 'available';
      this.emit();
      return this.snapshot();
    } catch (error) {
      this.state.phase = 'idle';
      this.state.error = String((error && error.message) || error);
      this.state.manualError = opts.manual === true;
      if (opts.manual) this.emit();
      return this.snapshot();
    }
  }

  // 更新源策略：主源优先，备用源兜底。
  //  - 所有源并发发起，但只有主源成功时立即采用（主源内容始终最新）。
  //  - 备用源（CDN 镜像）可能比主源快，但缓存可能滞后，只在主源失败时才采用，
  //    否则会拿到旧清单里的旧 SHA256，导致下载后校验失败。
  async fetchManifest() {
    const urls = (this.config.manifestUrls || []).filter(Boolean);
    if (!urls.length) throw new Error('尚未配置更新源（update-config.json 的 manifestUrl 为空）');

    const controllers = urls.map(() => new AbortController());
    const timers = controllers.map((controller) =>
      setTimeout(() => { try { controller.abort(); } catch (error) {} }, MANIFEST_TIMEOUT_MS));

    const attempts = urls.map((url, index) => {
      const target = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
      return (async () => {
        const response = await this.net.fetch(target, {
          signal: controllers[index].signal,
          headers: { 'cache-control': 'no-cache' }
        });
        if (!response.ok) throw new Error(urls.length > 1 ? url + ' -> HTTP ' + response.status : '更新清单请求失败：HTTP ' + response.status);
        const raw = await response.json();
        const checked = validateManifest(raw, { allowInsecure: this.devAllow === true });
        if (!checked.ok) throw new Error(checked.error);
        return checked.manifest;
      })();
    });

    const summarize = (error) => {
      const reasons = (error && error.errors ? error.errors : [error])
        .map((item) => String((item && item.message) || item))
        .filter(Boolean);
      const unique = [...new Set(reasons)];
      return unique.length ? '更新清单获取失败：' + unique.join(' / ') : '更新清单获取失败';
    };

    try {
      if (attempts.length === 1) {
        try {
          return await attempts[0];
        } catch (error) {
          throw new Error(summarize(error));
        }
      }
      // 备用源提前启动（并发预热），但结果只在主源失败时采用
      const fallback = Promise.any(attempts.slice(1)).catch(() => null);
      try {
        return await attempts[0];
      } catch (primaryError) {
        const alt = await fallback;
        if (alt) return alt;
        throw new Error(summarize(primaryError));
      }
    } finally {
      timers.forEach((timer) => clearTimeout(timer));
      controllers.forEach((controller) => { try { controller.abort(); } catch (error) {} });
    }
  }

  // ---------- 下载 ----------

  async downloadFile(url, destPath, onProgress) {
    const controller = new AbortController();
    const handle = {
      aborted: false,
      abort: () => {
        handle.aborted = true;
        try { controller.abort(); } catch (error) {}
      }
    };
    this.abort = handle;

    let stallTimer = setTimeout(() => { if (!handle.aborted) handle.abort(); }, DOWNLOAD_STALL_TIMEOUT_MS);
    const resetStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { if (!handle.aborted) handle.abort(); }, DOWNLOAD_STALL_TIMEOUT_MS);
    };

    try {
      const response = await this.net.fetch(url, { signal: controller.signal });
      if (response.status !== 200) throw new Error('下载失败：HTTP ' + response.status);
      const total = Number(response.headers.get('content-length') || 0);
      const out = fs.createWriteStream(destPath);
      const reader = response.body.getReader();
      let received = 0;
      let lastEmit = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        received += value.length;
        resetStall();
        await new Promise((resolve, reject) => {
          if (out.write(value)) { resolve(); return; }
          out.once('drain', resolve);
          out.once('error', reject);
        });
        const now = Date.now();
        if (now - lastEmit > 150 || (total && received >= total)) {
          lastEmit = now;
          onProgress(received, total);
        }
        if (handle.aborted) throw new Error('下载已取消');
      }
      await new Promise((resolve, reject) => { out.end(resolve); out.once('error', reject); });
      return { received, total };
    } finally {
      clearTimeout(stallTimer);
    }
  }

  sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async download() {
    if (!this.state.release) throw new Error('没有待下载的更新');
    if (this.state.phase === 'downloading') return this.snapshot();
    const release = this.state.release;
    const dir = path.join(this.downloadRoot, release.version);
    fs.mkdirSync(dir, { recursive: true });
    const fileName = decodeURIComponent((release.url.split('?')[0].split('/').pop()) || ('giwin-setup-' + release.version + '.exe'));
    const destPath = path.join(dir, fileName);

    this.state.phase = 'downloading';
    this.state.error = '';
    this.state.progress = { received: 0, total: release.size, percent: 0 };
    this.emit();

    // 下载候选：任一源成功即停，最终 SHA256 校验保证完整性，换源不引入安全风险。
    // 清单主地址常在 GitHub，国内直连容易先卡 60 秒再换源；这种情况把镜像排在前面。
    const onGithub = /^https?:\/\/(objects\.)?githubusercontent\.com|^https?:\/\/github\.com/i.test(release.url);
    const mirrors = [];
    for (const tpl of (this.config.assetMirrors || [])) {
      const mirror = tpl.replace('{url}', release.url).replace('{version}', release.version);
      if (mirror && mirror !== release.url && !mirrors.includes(mirror)) mirrors.push(mirror);
    }
    const candidates = onGithub ? mirrors.concat([release.url]) : [release.url].concat(mirrors);

    try {
      let result = null;
      let lastError = null;
      for (let i = 0; i < candidates.length; i++) {
        const url = candidates[i];
        try {
          this.state.progress = { received: 0, total: release.size, percent: 0 };
          // 只在首次下发时把进度归零；换源时保持当前进度，避免看着像"又从头开始"
          if (i === 0) this.emit();
          result = await this.downloadFile(url, destPath, (received, total) => {
            this.state.progress = {
              received,
              total: total || release.size,
              percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0
            };
            this.emit();
          });
          break;
        } catch (err) {
          lastError = err;
          if (this.abort && this.abort.aborted) throw new Error('下载已取消');
          try { fs.rmSync(destPath, { force: true }); } catch (e) {}
          // 还有候选源时静默切换，不打扰用户
          if (i < candidates.length - 1) continue;
          throw lastError;
        }
      }
      if (!result) throw lastError || new Error('下载失败');
      if (this.abort && this.abort.aborted) throw new Error('下载已取消');
      const actual = await this.sha256File(destPath);
      if (actual !== release.sha256) {
        try { fs.rmSync(destPath, { force: true }); } catch (e) {}
        throw new Error('安装包校验失败（SHA256 不匹配），已删除下载文件');
      }
      this.state.progress = { received: result.received, total: result.received, percent: 100 };
      this.state.phase = 'ready';
      this.writeStateFile({ downloadedVersion: release.version, downloadedPath: destPath });
      this.emit();
      return this.snapshot();
    } catch (error) {
      this.abort = null;
      const message = String((error && error.message) || error);
      const canceled = message.indexOf('取消') >= 0;
      // 失败要落到 error 相位：界面才会显示原因与网盘入口，
      // 否则退回 available 会让弹窗伪装成"发现新版本"再弹一次，看着像在反复跳。
      this.state.phase = canceled ? (this.state.release ? 'available' : 'idle') : 'error';
      this.state.error = canceled ? '' : message;
      this.emit();
      return this.snapshot();
    } finally {
      this.abort = null;
    }
  }

  cancelDownload() {
    if (this.abort) {
      const a = this.abort;
      a.abort();
      this.abort = null;
    }
  }

  // ---------- 安装 ----------

  assertInstallable() {
    if (!this.app.isPackaged) throw new Error('开发版不支持自动更新');
    if (!this.state.release) throw new Error('没有待安装的更新');
    const installDir = path.dirname(this.app.getPath('exe'));
    fs.accessSync(installDir, fs.constants.W_OK); // 不可写会抛错
    return { installDir, exePath: this.app.getPath('exe') };
  }

  install() {
    if (this.state.phase !== 'ready') throw new Error('安装包尚未就绪');
    const release = this.state.release;
    let paths;
    try {
      paths = this.assertInstallable();
    } catch (error) {
      this.state.phase = 'error';
      this.state.error = '无法自动安装（' + String((error && error.message) || error) + '），请手动下载安装';
      this.state.manualError = true;
      this.emit();
      return this.snapshot();
    }

    const setupPath = this.readStateFile().downloadedPath;
    if (!setupPath || !fs.existsSync(setupPath)) {
      this.state.phase = 'available';
      this.state.error = '安装包丢失，请重新下载';
      this.emit();
      return this.snapshot();
    }

    this.state.phase = 'installing';
    this.emit();

    const { spawn } = require('child_process');
    const child = spawn(setupPath, [
      '--silent', paths.installDir,
      '--no-shortcuts',
      '--launch',
      '--wait-pid', String(process.pid)
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();

    this.writeStateFile({ installedVersion: release.version });
    setTimeout(() => this.app.quit(), 600); // 给 spawn 留启动时间；安装器 --wait-pid 会等本进程退出
    return this.snapshot();
  }

  skip() {
    if (this.state.release) {
      this.writeStateFile({ skippedVersion: this.state.release.version });
    }
    this.state.phase = 'idle';
    this.state.release = null;
    this.emit();
    return this.snapshot();
  }

  // ---------- IPC 接线 ----------

  attachIpc() {
    const handle = (name, fn) => this.ipcMain.handle(name, async (_event, payload) => {
      try { return { ok: true, state: await fn.call(this, payload) }; }
      catch (error) { return { ok: false, error: String((error && error.message) || error), state: this.snapshot() }; }
    });
    handle('update:state', () => this.snapshot());
    handle('update:check', (payload) => this.check({ manual: !!(payload && payload.manual) }));
    handle('update:download', () => this.download());
    handle('update:install', () => this.install());
    handle('update:skip', () => this.skip());
    handle('update:cancel', () => { this.cancelDownload(); if (this.state.phase === 'downloading') { this.state.phase = this.state.release ? 'available' : 'idle'; this.emit(); } return this.snapshot(); });
    handle('update:open-url', (payload) => {
      const release = this.state.release || {};
      const wantManual = !!(payload && payload.manual);
      const url = wantManual ? (release.manualUrl || release.url) : (release.url || release.manualUrl);
      if (url) this.shell.openExternal(url);
      return this.snapshot();
    });
  }
}

function createUpdateService(deps) {
  return new UpdateService(deps);
}

module.exports = {
  createUpdateService,
  compareVersions,
  parseVersion,
  channelAccepts,
  validateManifest,
  formatBytes
};
