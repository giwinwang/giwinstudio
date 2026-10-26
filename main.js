// 极物 GIWIN Studio · 主进程（M1：画布模块）
const { app, BrowserWindow, dialog, ipcMain, net, nativeImage, safeStorage, session, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFileSync, spawn } = require('child_process');
const licenseCore = require('./license-core');
const diagnosticLog = require('./diagnostic-log');
const projectBackup = require('./project-backup');
const updateService = require('./update-service');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const devEntitlementsEnabled = process.argv.includes('--dev-entitlements');
let devEntitlementMode = 'beta';
ipcMain.handle('dev:entitlement-mode', (_event, mode) => {
  if (!devEntitlementsEnabled) return { ok: false };
  devEntitlementMode = mode === 'team' ? 'team' : 'beta';
  return { ok: true, mode: devEntitlementMode };
});
if (process.env.GW_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.GW_CDP_PORT));
}

let win = null;
let forceWindowClose = false;
const taobaoSearchRequests = new Map();
const TAOBAO_PARTITION = 'persist:giwin-taobao-search';
const TAOBAO_QUIT_FLUSH_TIMEOUT_MS = 1500;
function flushTaobaoLogin() {
  try {
    const flushed = session.fromPartition(TAOBAO_PARTITION).cookies.flushStore().catch(() => {});
    const timeout = new Promise(resolve => setTimeout(resolve, TAOBAO_QUIT_FLUSH_TIMEOUT_MS));
    return Promise.race([flushed, timeout]);
  } catch (error) {
    return Promise.resolve();
  }
}
const file = (...p) => path.join(app.getPath('userData'), ...p);
const readJSON = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return fb; } };
const writeJSON = (p, d) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d, null, 2)); };
const licenseStatePath = () => file('license-state.json');
const licenseInstallPath = () => file('license-install.json');
const licenseRequiredFlagPath = () => path.join(__dirname, 'license-required.flag');
const LICENSE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAeoz1au6hByR4gmozZhRCZTGT1CtStMXTZ3R1B9xw9/E=
-----END PUBLIC KEY-----`;
let cachedMachineIdentifier = '';
let cachedInstallIdentifier = '';

function licenseEnforced() {
  return fs.existsSync(licenseRequiredFlagPath()) ||
    app.isPackaged ||
    process.env.GW_ENFORCE_LICENSE === '1' ||
    process.argv.includes('--enforce-license');
}

function readMachineIdentifier() {
  if (cachedMachineIdentifier) return cachedMachineIdentifier;
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', timeout: 2500, windowsHide: true }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (match && match[1].trim()) {
        cachedMachineIdentifier = match[1].trim();
        return cachedMachineIdentifier;
      }
    } else if (process.platform === 'darwin') {
      const output = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        timeout: 2500
      });
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match && match[1]) {
        cachedMachineIdentifier = match[1];
        return cachedMachineIdentifier;
      }
    } else {
      const machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      if (machineId) {
        cachedMachineIdentifier = machineId;
        return cachedMachineIdentifier;
      }
    }
  } catch (error) {}
  cachedMachineIdentifier = [os.hostname(), os.userInfo().username, process.platform, process.arch].join('|');
  return cachedMachineIdentifier;
}

function ensureInstallIdentifier() {
  if (cachedInstallIdentifier) return cachedInstallIdentifier;
  const current = readJSON(licenseInstallPath(), null);
  if (current && typeof current.installId === 'string' && current.installId.length >= 24) {
    cachedInstallIdentifier = current.installId;
    return cachedInstallIdentifier;
  }
  const installId = crypto.randomBytes(24).toString('hex');
  writeJSON(licenseInstallPath(), {
    version: 1,
    installId,
    createdAt: new Date().toISOString()
  });
  cachedInstallIdentifier = installId;
  return cachedInstallIdentifier;
}

function currentDeviceId() {
  return licenseCore.createDeviceId(readMachineIdentifier());
}

function legacyInstallDeviceId() {
  return licenseCore.createDeviceId(readMachineIdentifier(), ensureInstallIdentifier());
}

function verifyLicenseForCurrentDevice(envelope, now) {
  const stableDeviceId = currentDeviceId();
  const stable = licenseCore.verifyLicense(envelope, {
    publicKey: LICENSE_PUBLIC_KEY_PEM,
    deviceId: stableDeviceId,
    now
  });
  if (stable.ok || stable.code !== 'device_mismatch') {
    return { result: stable, matchedDeviceId: stable.ok ? stableDeviceId : '', legacyBinding: false };
  }
  const legacyDeviceId = legacyInstallDeviceId();
  if (legacyDeviceId !== stableDeviceId) {
    const legacy = licenseCore.verifyLicense(envelope, {
      publicKey: LICENSE_PUBLIC_KEY_PEM,
      deviceId: legacyDeviceId,
      now
    });
    if (legacy.ok) return { result: legacy, matchedDeviceId: legacyDeviceId, legacyBinding: true };
  }
  return { result: stable, matchedDeviceId: '', legacyBinding: false };
}

function verifyActivationForCurrentDevice(code, now) {
  const stableDeviceId = currentDeviceId();
  const stable = licenseCore.verifyActivationCode(code, {
    publicKey: LICENSE_PUBLIC_KEY_PEM,
    deviceId: stableDeviceId,
    now
  });
  if (stable.ok || stable.code !== 'device_mismatch') {
    return { result: stable, matchedDeviceId: stable.ok ? stableDeviceId : '', legacyBinding: false };
  }
  const legacyDeviceId = legacyInstallDeviceId();
  if (legacyDeviceId !== stableDeviceId) {
    const legacy = licenseCore.verifyActivationCode(code, {
      publicKey: LICENSE_PUBLIC_KEY_PEM,
      deviceId: legacyDeviceId,
      now
    });
    if (legacy.ok) return { result: legacy, matchedDeviceId: legacyDeviceId, legacyBinding: true };
  }
  return { result: stable, matchedDeviceId: '', legacyBinding: false };
}

function summarizeInviteRewards(state, deviceId, now) {
  const codes = state && Array.isArray(state.inviteRewardCodes) ? state.inviteRewardCodes : [];
  const ids = new Set();
  let days = 0;
  let count = 0;
  for (const code of codes) {
    const verification = licenseCore.verifyInviteRewardCode(code, {
      publicKey: LICENSE_PUBLIC_KEY_PEM,
      deviceId,
      now,
      allowExpired: true
    });
    if (!verification.ok || ids.has(verification.reward.id)) continue;
    ids.add(verification.reward.id);
    count += 1;
    days = Math.min(licenseCore.MAX_INVITE_REWARD_DAYS, days + verification.reward.days);
  }
  return { days, count, ids };
}

function readLicenseState() {
  try {
    const raw = JSON.parse(fs.readFileSync(licenseStatePath(), 'utf8'));
    if (raw && raw.encrypted && raw.data && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, 'base64')));
    }
    return raw && (raw.envelope || raw.activationCode) ? raw : null;
  } catch (error) {
    return null;
  }
}

function writeLicenseState(state) {
  fs.mkdirSync(path.dirname(licenseStatePath()), { recursive: true });
  const serialized = JSON.stringify(state || {});
  let content;
  if (safeStorage.isEncryptionAvailable()) {
    content = JSON.stringify({
      version: 1,
      encrypted: true,
      data: safeStorage.encryptString(serialized).toString('base64')
    });
  } else {
    content = JSON.stringify({
      version: 1,
      encrypted: false,
      envelope: state.envelope,
      activationCode: state.activationCode,
      inviteRewardCodes: Array.isArray(state.inviteRewardCodes) ? state.inviteRewardCodes : [],
      lastSeenAt: state.lastSeenAt
    });
  }
  const temp = licenseStatePath() + '.tmp';
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, licenseStatePath());
}

function licenseStatus() {
  const deviceId = currentDeviceId();
  const inviteCode = licenseCore.inviteCodeForDeviceId(deviceId);
  const enforced = licenseEnforced();
  const state = readLicenseState();
  if (!enforced) {
    return {
      ok: true,
      valid: true,
      enforced: false,
      development: true,
      deviceId,
      inviteCode,
      referralCount: 0,
      referralBonusDays: 0,
      maxReferralBonusDays: licenseCore.MAX_INVITE_REWARD_DAYS,
      status: 'development',
      message: '开发模式未强制授权'
    };
  }
  if (!state || (!state.envelope && !state.activationCode)) {
    return {
      ok: true, valid: false, enforced, deviceId, inviteCode,
      referralCount: 0, referralBonusDays: 0, maxReferralBonusDays: licenseCore.MAX_INVITE_REWARD_DAYS,
      status: 'unlicensed', message: '尚未激活软件'
    };
  }

  const now = Date.now();
  const lastSeenAt = Number(state.lastSeenAt) || 0;
  if (lastSeenAt && now + LICENSE_CLOCK_TOLERANCE_MS < lastSeenAt) {
    return {
      ok: true, valid: false, enforced, deviceId, inviteCode,
      referralCount: 0, referralBonusDays: 0, maxReferralBonusDays: licenseCore.MAX_INVITE_REWARD_DAYS,
      status: 'clock_rollback', message: '系统时间已回拨，请校正时间后重新检测'
    };
  }

  const verification = state.activationCode
    ? verifyActivationForCurrentDevice(state.activationCode, now)
    : verifyLicenseForCurrentDevice(state.envelope, now);
  const result = verification.result;
  if (!result.ok && !(result.code === 'expired' && result.license)) {
    return {
      ok: true,
      valid: false,
      enforced,
      deviceId,
      inviteCode,
      referralCount: 0,
      referralBonusDays: 0,
      maxReferralBonusDays: licenseCore.MAX_INVITE_REWARD_DAYS,
      status: result.code,
      message: result.message,
      license: result.license || null
    };
  }
  if (!lastSeenAt || now - lastSeenAt > LICENSE_CLOCK_TOLERANCE_MS) {
    writeLicenseState({ ...state, lastSeenAt: now });
  }
  const rewards = summarizeInviteRewards(state, deviceId, now);
  const baseExpiresAt = Date.parse(result.license.expiresAt);
  const expiresAt = baseExpiresAt + rewards.days * 24 * 60 * 60 * 1000;
  if (now >= expiresAt) {
    return {
      ok: true,
      valid: false,
      enforced,
      deviceId,
      inviteCode,
      referralCount: rewards.count,
      referralBonusDays: rewards.days,
      maxReferralBonusDays: licenseCore.MAX_INVITE_REWARD_DAYS,
      status: 'expired',
      message: '内测授权已到期',
      license: { ...result.license, baseExpiresAt: result.license.expiresAt }
    };
  }
  const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)));
  return {
    ok: true,
    valid: true,
    enforced,
    deviceId,
    inviteCode,
    referralCount: rewards.count,
    referralBonusDays: rewards.days,
    maxReferralBonusDays: licenseCore.MAX_INVITE_REWARD_DAYS,
    status: 'active',
    message: result.code === 'expired' ? '邀请奖励续期有效' : '内测授权有效',
    daysRemaining,
    binding: verification.legacyBinding ? 'legacy-install' : 'device',
    license: {
      ...result.license,
      baseExpiresAt: result.license.expiresAt,
      expiresAt: new Date(expiresAt).toISOString()
    }
  };
}

function installLicenseEnvelope(envelope) {
  const now = Date.now();
  const verification = verifyLicenseForCurrentDevice(envelope, now);
  if (!verification.result.ok) return { ok: false, msg: verification.result.message };
  const previous = readLicenseState();
  writeLicenseState({
    envelope,
    inviteRewardCodes: previous && Array.isArray(previous.inviteRewardCodes) ? previous.inviteRewardCodes : [],
    lastSeenAt: now
  });
  return { ok: true, ...licenseStatus() };
}

function installActivationCode(code) {
  const parsed = licenseCore.parseActivationCode(code);
  if (parsed.version === 1) return installLicenseEnvelope(parsed.envelope);
  const now = Date.now();
  const verification = verifyActivationForCurrentDevice(parsed.compact, now);
  if (!verification.result.ok) return { ok: false, msg: verification.result.message };
  const previous = readLicenseState();
  writeLicenseState({
    activationCode: parsed.compact,
    inviteRewardCodes: previous && Array.isArray(previous.inviteRewardCodes) ? previous.inviteRewardCodes : [],
    lastSeenAt: now
  });
  return { ok: true, ...licenseStatus() };
}

function redeemInviteRewardCode(code) {
  const current = licenseStatus();
  if (!current.valid) return { ok: false, msg: '请先激活软件，再兑换邀请奖励' };
  const verification = licenseCore.verifyInviteRewardCode(code, {
    publicKey: LICENSE_PUBLIC_KEY_PEM,
    deviceId: currentDeviceId(),
    now: Date.now()
  });
  if (!verification.ok) return { ok: false, msg: verification.message };
  const state = readLicenseState() || {};
  const rewards = summarizeInviteRewards(state, currentDeviceId(), Date.now());
  if (rewards.ids.has(verification.reward.id)) return { ok: false, msg: '这个邀请奖励已经兑换过' };
  if (rewards.days + verification.reward.days > licenseCore.MAX_INVITE_REWARD_DAYS) {
    return { ok: false, msg: '已达到 ' + licenseCore.MAX_INVITE_REWARD_DAYS + ' 天邀请奖励上限' };
  }
  writeLicenseState({
    ...state,
    inviteRewardCodes: [...(Array.isArray(state.inviteRewardCodes) ? state.inviteRewardCodes : []), verification.reward.code || String(code).replace(/\s+/g, '')],
    lastSeenAt: Date.now()
  });
  return { ok: true, rewardDays: verification.reward.days, ...licenseStatus() };
}
const runtimeHealthPath = file('runtime-health.json');
const runtimeCrashLogPath = file('runtime-crash.log');
const runtimeBootLogPath = file('gw-boot.log');
const previousRuntimeHealth = readJSON(runtimeHealthPath, null);
const currentRunStartedAt = Date.now();
const forcedSafeMode = process.argv.includes('--safe-mode');
// 强制结束进程、断电或系统重启都会留下 cleanExit=false，不能凭一次异常
// 退出就永久关闭 GPU。连续三次未正常退出，或用户显式 --safe-mode 时，
// 才启用软件渲染兜底。
const previousGpuFailureCount = previousRuntimeHealth && previousRuntimeHealth.gpuFailureCount
  ? Math.max(0, Number(previousRuntimeHealth.gpuFailureCount) || 0)
  : 0;
const previousUncleanStarts = previousRuntimeHealth && previousRuntimeHealth.cleanExit === false
  ? Math.max(1, Number(previousRuntimeHealth.uncleanStarts) || 1)
  : 0;
const uncleanStarts = previousUncleanStarts ? previousUncleanStarts + 1 : 0;
const safeRenderMode = forcedSafeMode || previousGpuFailureCount >= 3;
function appendRuntimeCrash(kind, detail) {
  try {
    fs.mkdirSync(path.dirname(runtimeCrashLogPath), { recursive: true });
    fs.appendFileSync(runtimeCrashLogPath, JSON.stringify({
      time: new Date().toISOString(),
      kind,
      detail,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      safeRenderMode
    }) + '\n');
  } catch (error) {}
}
function recordGpuProcessFailure(details) {
  if (!details || String(details.type || '').toLowerCase() !== 'gpu') return;
  if (['clean-exit', 'killed'].includes(String(details.reason || '').toLowerCase())) return;
  try {
    const health = readJSON(runtimeHealthPath, {}) || {};
    writeJSON(runtimeHealthPath, {
      ...health,
      gpuFailureCount: Math.max(0, Number(health.gpuFailureCount) || 0) + 1,
      lastGpuFailureAt: Date.now(),
      lastGpuFailureReason: String(details.reason || 'crashed')
    });
  } catch (error) {}
}
function readDiagnosticTail(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return '';
    const length = Math.min(stat.size, 512 * 1024);
    const handle = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, Math.max(0, stat.size - length));
      return diagnosticLog.tailLines(buffer.toString('utf8'));
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    return '';
  }
}
writeJSON(runtimeHealthPath, {
  startedAt: currentRunStartedAt,
  cleanExit: false,
  uncleanStarts,
  gpuFailureCount: safeRenderMode ? previousGpuFailureCount : 0,
  safeRenderMode,
  reason: forcedSafeMode ? 'forced-safe-mode' : (safeRenderMode ? 'repeated-gpu-failures' : 'normal'),
  electron: process.versions.electron
});
if (safeRenderMode) app.disableHardwareAcceleration();
app.on('child-process-gone', (_event, details) => {
  appendRuntimeCrash('child-process-gone', details);
  recordGpuProcessFailure(details);
});
app.on('render-process-gone', (_event, _contents, details) => appendRuntimeCrash('render-process-gone', details));
process.on('uncaughtException', error => appendRuntimeCrash('uncaughtException', { message: error.message, stack: error.stack }));
process.on('unhandledRejection', error => appendRuntimeCrash('unhandledRejection', {
  message: error && error.message ? error.message : String(error),
  stack: error && error.stack
}));
function isValidJSONFile(p) {
  try { JSON.parse(fs.readFileSync(p, 'utf8')); return true; } catch (error) { return false; }
}
async function writeJSONAtomic(p, d) {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const tempPath = p + '.tmp';
  const backupPath = p + '.bak';
  const text = JSON.stringify(d, null, 2);
  const handle = await fs.promises.open(tempPath, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const existing = await fs.promises.stat(p).catch(() => null);
    if (existing && isValidJSONFile(p)) {
      try { await fs.promises.copyFile(p, backupPath); } catch (error) { console.warn('[save] backup failed', error.message); }
    }
    await fs.promises.rename(tempPath, p);
  } catch (error) {
    try { await fs.promises.unlink(tempPath); } catch (e) {}
    throw error;
  }
  return Buffer.byteLength(text);
}
function validCanvasState(state) {
  return !!state && typeof state === 'object' && Array.isArray(state.nodes);
}
function engineSecretPath() {
  return file('engines.enc.json');
}
function loadEngineSecrets() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const record = readJSON(engineSecretPath(), null);
    if (!record || !record.data) return null;
    const text = safeStorage.decryptString(Buffer.from(record.data, 'base64'));
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.warn('[secrets] load failed', error.message);
    return null;
  }
}
function saveEngineSecrets(configs) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const target = engineSecretPath();
    const temp = target + '.tmp';
    const data = safeStorage.encryptString(JSON.stringify(configs || {})).toString('base64');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ version: 1, data }), 'utf8');
    fs.renameSync(temp, target);
    return true;
  } catch (error) {
    console.warn('[secrets] save failed', error.message);
    return false;
  }
}
ipcMain.on('engines:loadSync', event => { event.returnValue = loadEngineSecrets(); });
ipcMain.on('engines:saveSync', (event, configs) => {
  const ok = saveEngineSecrets(configs);
  event.returnValue = { ok, mode: ok ? 'encrypted' : 'unavailable' };
});
const canvasCache = new Map();
const thumbIndexCache = new Map();
const canvasLocks = new Map();
const canvasKey = projectPath => path.resolve(projectPath);
function withCanvasLock(key, task) {
  const previous = canvasLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  canvasLocks.set(key, run);
  run.finally(() => {
    if (canvasLocks.get(key) === run) canvasLocks.delete(key);
  }).catch(() => {});
  return run;
}
function canvasFilePaths(projectPath) {
  const base = path.join(projectPath, 'Config', 'canvas.json');
  return { base, backup: base + '.bak', temp: base + '.tmp', journal: path.join(projectPath, 'Config', 'canvas.journal.jsonl') };
}
function applyCanvasDiff(state, diff) {
  if (!state || !diff) return state;
  if (diff.meta) {
    if (Object.prototype.hasOwnProperty.call(diff.meta, 'stage')) state.stage = diff.meta.stage;
    if (Object.prototype.hasOwnProperty.call(diff.meta, 'rooms')) state.rooms = diff.meta.rooms;
    if (Object.prototype.hasOwnProperty.call(diff.meta, 'materials')) state.materials = diff.meta.materials;
    if (Object.prototype.hasOwnProperty.call(diff.meta, 'currentRoom')) state.currentRoom = diff.meta.currentRoom;
    if (Object.prototype.hasOwnProperty.call(diff.meta, 'anchor')) state.anchor = diff.meta.anchor;
    if (Object.prototype.hasOwnProperty.call(diff.meta, 'version')) state.version = diff.meta.version;
  }
  let nodes = Array.isArray(state.nodes) ? state.nodes : [];
  if (Array.isArray(diff.nodeDeletes) && diff.nodeDeletes.length) {
    const deleted = new Set(diff.nodeDeletes);
    nodes = nodes.filter(node => !deleted.has(node.id));
  }
  if (Array.isArray(diff.nodeUpserts) && diff.nodeUpserts.length) {
    const index = new Map(nodes.map((node, i) => [node.id, i]));
    diff.nodeUpserts.forEach(node => {
      const at = index.get(node.id);
      if (at == null) { index.set(node.id, nodes.length); nodes.push(node); }
      else nodes[at] = node;
    });
  }
  state.nodes = nodes;
  let edges = Array.isArray(state.edges) ? state.edges : [];
  if (Array.isArray(diff.edgeDeletes) && diff.edgeDeletes.length) {
    const deleted = new Set(diff.edgeDeletes);
    edges = edges.filter(edge => !deleted.has(edge.id));
  }
  if (Array.isArray(diff.edgeUpserts) && diff.edgeUpserts.length) {
    const index = new Map(edges.map((edge, i) => [edge.id, i]));
    diff.edgeUpserts.forEach(edge => {
      const at = index.get(edge.id);
      if (at == null) { index.set(edge.id, edges.length); edges.push(edge); }
      else edges[at] = edge;
    });
  }
  state.edges = edges;
  return state;
}
async function clearCanvasJournal(projectPath) {
  const { journal } = canvasFilePaths(projectPath);
  const temp = journal + '.tmp';
  await fs.promises.writeFile(temp, '', 'utf8');
  await fs.promises.rename(temp, journal);
}
async function canvasStateFingerprint(projectPath) {
  const paths = canvasFilePaths(projectPath);
  const statToken = file => fs.promises.stat(file)
    .then(stat => Math.round(stat.mtimeMs) + ':' + stat.size)
    .catch(() => '0:0');
  const [base, journal] = await Promise.all([
    statToken(paths.base),
    statToken(paths.journal)
  ]);
  return base + '|' + journal;
}
async function loadCanvasState(projectPath) {
  const paths = canvasFilePaths(projectPath);
  const key = canvasKey(projectPath);
  const fingerprint = await canvasStateFingerprint(projectPath);
  const cached = canvasCache.get(key);
  if (cached && cached.fingerprint === fingerprint && validCanvasState(cached.state)) {
    cached.lastSaveAt = Date.now();
    return {
      ok: true,
      state: cached.state,
      source: 'cache',
      journalOps: cached.journalOps || 0,
      journalWarning: cached.journalWarning || ''
    };
  }
  const candidates = [
    { file: paths.base, source: 'primary' },
    { file: paths.backup, source: 'backup' },
    { file: paths.temp, source: 'temp' }
  ];
  for (const candidate of candidates) {
    const state = readJSON(candidate.file, null);
    if (!validCanvasState(state)) continue;
    let journalOps = 0;
    let journalBytes = 0;
    let journalWarning = '';
    let needsFull = candidate.source !== 'primary';
    if (candidate.source === 'primary') {
      const text = await fs.promises.readFile(paths.journal, 'utf8').catch(() => '');
      journalBytes = Buffer.byteLength(text);
      const lines = text.split('\n').filter(line => line.trim());
      for (let i = 0; i < lines.length; i++) {
        try {
          applyCanvasDiff(state, JSON.parse(lines[i]));
          journalOps++;
        } catch (error) {
          journalWarning = i === lines.length - 1 ? 'trailing' : 'corrupt';
          needsFull = true;
          break;
        }
      }
    }
    const entry = {
      state,
      journalOps,
      journalBytes,
      needsFull,
      journalWarning,
      fingerprint,
      lastSaveAt: Date.now()
    };
    canvasCache.set(key, entry);
    return { ok: true, state, source: candidate.source, journalOps, journalWarning };
  }
  canvasCache.delete(key);
  return { ok: false, state: null, source: 'none' };
}
function versionsDir(projectPath) {
  return path.join(projectPath, 'Config', 'versions');
}
const VERSION_AUTO_KEEP = 30;
const VERSION_MANUAL_KEEP = 100;
const VERSION_AUTO_INTERVAL_MS = 10 * 60 * 1000;
const versionCheckCache = new Map();

function versionKind(record, label, auto) {
  const explicit = String(record && record.kind || '').toLowerCase();
  if (['auto', 'manual', 'restore'].includes(explicit)) return explicit;
  const text = String((record && record.label) || label || '');
  if (auto || /自动|恢复前/.test(text)) return /恢复前/.test(text) ? 'restore' : 'auto';
  return 'manual';
}

async function pruneVersions(projectPath) {
  const dir = versionsDir(projectPath);
  try {
    const names = (await fs.promises.readdir(dir)).filter(name => name.endsWith('.json'));
    const manual = [];
    const automatic = [];
    for (const name of names) {
      const record = readJSON(path.join(dir, name), null);
      const entry = { name, createdAt: Number(record && record.createdAt) || 0 };
      if (versionKind(record) === 'manual') manual.push(entry);
      else automatic.push(entry);
    }
    manual.sort((a, b) => (b.createdAt - a.createdAt) || b.name.localeCompare(a.name));
    automatic.sort((a, b) => (b.createdAt - a.createdAt) || b.name.localeCompare(a.name));
    const keep = new Set([
      ...manual.slice(0, VERSION_MANUAL_KEEP).map(item => item.name),
      ...automatic.slice(0, VERSION_AUTO_KEEP).map(item => item.name)
    ]);
    for (const name of names) {
      if (!keep.has(name)) await fs.promises.unlink(path.join(dir, name)).catch(() => {});
    }
  } catch (error) {}
}
async function createCanvasVersion(projectPath, state, label, kind) {
  if (!validCanvasState(state)) throw new Error('没有可保存的画布状态');
  const dir = versionsDir(projectPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const stateText = JSON.stringify(state);
  const hash = crypto.createHash('sha256').update(stateText).digest('hex');
  const names = (await fs.promises.readdir(dir)).filter(name => name.endsWith('.json')).sort().reverse();
  for (const name of names) {
    const record = readJSON(path.join(dir, name), null);
    if (!record || versionKind(record) !== kind) continue;
    let same = record.hash === hash;
    if (!record.hash) {
      try { same = JSON.stringify(record.state) === stateText; } catch (error) { same = false; }
    }
    if (same) {
      return {
        id: record.id,
        createdAt: record.createdAt || 0,
        label: record.label || label,
        kind,
        stats: record.stats || { nodes: state.nodes.length, edges: (state.edges || []).length },
        hash,
        bytes: await fs.promises.stat(path.join(dir, name)).then(stat => stat.size).catch(() => 0),
        unchanged: true
      };
    }
    break;
  }
  const createdAt = Date.now();
  const id = createdAt + '-' + Math.random().toString(36).slice(2, 6);
  const meta = {
    id,
    createdAt,
    label: label || (kind === 'manual' ? '手动版本' : '自动版本'),
    kind,
    hash,
    stats: { nodes: state.nodes.length, edges: (state.edges || []).length }
  };
  const file = path.join(dir, id + '.json');
  const temp = file + '.tmp';
  await fs.promises.writeFile(temp, JSON.stringify({ version: 1, ...meta, state }), 'utf8');
  await fs.promises.rename(temp, file);
  const bytes = await fs.promises.stat(file).then(stat => stat.size).catch(() => 0);
  await pruneVersions(projectPath);
  return Object.assign(meta, { bytes });
}
async function maybeAutoVersion(projectPath, state) {
  try {
    const cacheKey = canvasKey(projectPath);
    const now = Date.now();
    if (now - (versionCheckCache.get(cacheKey) || 0) < 30000) return null;
    versionCheckCache.set(cacheKey, now);
    const dir = versionsDir(projectPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const names = (await fs.promises.readdir(dir)).filter(name => name.endsWith('.json')).sort().reverse();
    let latestAt = 0;
    for (const name of names) {
      const record = readJSON(path.join(dir, name), null);
      if (!record || versionKind(record) === 'manual') continue;
      latestAt = Math.max(latestAt, Number(record.createdAt) || 0);
      break;
    }
    if (latestAt && Date.now() - latestAt < VERSION_AUTO_INTERVAL_MS) return null;
    return await createCanvasVersion(projectPath, state, '自动版本', 'auto');
  } catch (error) {
    return null;
  }
}
async function listCanvasVersions(projectPath) {
  const dir = versionsDir(projectPath);
  let names = [];
  try { names = (await fs.promises.readdir(dir)).filter(name => name.endsWith('.json')); } catch (error) { return []; }
  const out = [];
  for (const name of names) {
    const record = readJSON(path.join(dir, name), null);
    if (!record || !record.id) continue;
    const bytes = await fs.promises.stat(path.join(dir, name)).then(stat => stat.size).catch(() => 0);
    out.push({
      id: record.id,
      createdAt: record.createdAt || 0,
      label: record.label || '历史版本',
      kind: versionKind(record),
      stats: record.stats || { nodes: 0, edges: 0 },
      bytes
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
const sanitize = n => n.replace(/[\\/:*?"<>|]/g, '_');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const publicAcc = a => ({ id: a.id, email: a.email, name: a.name });

// RunningHub documents accountStatus as its API-key connectivity check.
// Use Electron's network stack in the main process to avoid renderer CORS failures.
ipcMain.handle('runninghub:check', async (_e, { baseURL, apiKey } = {}) => {
  if (!apiKey) return { ok: false, message: '请先填写 RunningHub API Key' };
  let parsed;
  try { parsed = new URL(baseURL); }
  catch (_) { return { ok: false, message: '接口地址格式不正确' }; }
  if (parsed.protocol !== 'https:') return { ok: false, message: 'RunningHub 地址必须使用 https://' };
  const hosts = {
    'api.runninghub.ai': 'www.runninghub.ai',
    'runninghub.ai': 'www.runninghub.ai',
    'www.runninghub.ai': 'www.runninghub.ai',
    'api.runninghub.cn': 'www.runninghub.cn',
    'runninghub.cn': 'www.runninghub.cn',
    'www.runninghub.cn': 'www.runninghub.cn'
  };
  const host = hosts[parsed.hostname.toLowerCase()];
  if (!host) return { ok: false, message: '请使用 RunningHub 官方地址：www.runninghub.ai 或 www.runninghub.cn' };
  const endpoint = 'https://' + host + '/uc/openapi/accountStatus';
  try {
    const response = await net.fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: apiKey }),
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (response.status === 401) return { ok: false, message: 'API Key 无效或已过期（401）' };
    if (response.status === 403) return { ok: false, message: '此 API Key 没有调用账户接口的权限（403）' };
    if (!response.ok) return { ok: false, message: 'RunningHub 返回 HTTP ' + response.status + (data && data.msg ? '：' + data.msg : '') };
    if (!data) return { ok: false, message: '已连到服务器，但服务器返回内容无法识别' };
    if (data.code !== undefined && Number(data.code) !== 0) {
      return { ok: false, message: data.msg || 'API Key 验证失败（代码 ' + data.code + '）' };
    }
    return { ok: true, account: data.data || {} };
  } catch (err) {
    const message = err && err.name === 'TimeoutError' ? '连接超时，请检查网络或代理' : (err && err.message || '网络连接失败');
    return { ok: false, message: '无法连接 RunningHub：' + message };
  }
});

// RunningHub Seedream uses the task based Model API, not an OpenAI-compatible endpoint.
ipcMain.handle('runninghub:generate', async (_e, { baseURL, apiKey, prompt, imageDataURL, size, aspect } = {}) => {
  if (!apiKey) throw new Error('请先在引擎设置中填写 RunningHub API Key');
  let parsed;
  try { parsed = new URL(baseURL); } catch (_) { throw new Error('RunningHub 地址格式不正确'); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !['www.runninghub.ai', 'www.runninghub.cn'].includes(host)) {
    throw new Error('请使用 https://www.runninghub.ai 或 https://www.runninghub.cn');
  }
  const root = 'https://' + host;
  const headers = { Authorization: 'Bearer ' + apiKey };
  const request = async (url, options = {}) => {
    const res = await net.fetch(root + url, { ...options, headers: { ...headers, ...(options.headers || {}) }, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = {}; }
    if (res.status === 401 || res.status === 403) {
      throw new Error('RunningHub 拒绝了模型调用（HTTP ' + res.status + '）。模型 API 需要“企业级-共享”API Key；请在 RunningHub 的 API Key 页面创建此类型的 Key 后，在软件设置中替换。');
    }
    if (!res.ok) throw new Error('RunningHub 返回 HTTP ' + res.status + '：' + String(data.message || data.msg || text).slice(0, 180));
    if (data.code !== undefined && ![0, 200].includes(Number(data.code))) throw new Error(data.message || data.msg || ('RunningHub 错误代码 ' + data.code));
    return data.data || data;
  };

  let imageUrl = null;
  if (imageDataURL) {
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(imageDataURL);
    if (!match) throw new Error('参考图片格式不支持，请使用 PNG、JPG 或 WEBP');
    const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(match[2], 'base64')], { type: 'image/' + match[1] }), 'reference.' + ext);
    const uploaded = await request('/openapi/v2/media/upload/binary', { method: 'POST', body: form });
    imageUrl = uploaded.download_url;
    if (!imageUrl) throw new Error('RunningHub 图片上传成功但没有返回图片地址');
  }

  let endpoint = '/openapi/v2/seedream-v5-pro/' + (imageUrl ? 'image-to-image' : 'text-to-image');
  const ratio = aspect && aspect !== 'auto' ? aspect.split(':').map(Number) : null;
  let width = size === '2K' ? 2048 : 1024;
  let height = width;
  if (ratio && ratio[0] && ratio[1]) {
    const scale = width / Math.max(ratio[0], ratio[1]);
    width = Math.round(ratio[0] * scale / 64) * 64;
    height = Math.round(ratio[1] * scale / 64) * 64;
  }
  const payload = { prompt: prompt || '', width, height, resolution: size === '2K' ? '2k' : '1k', outputFormat: 'png' };
  if (imageUrl) payload.imageUrls = [imageUrl];
  const submitted = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const taskId = submitted.taskId;
  if (!taskId) throw new Error('RunningHub 未返回任务编号');

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const state = await request('/openapi/v2/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId }) });
    const status = String(state.status || '').toUpperCase();
    if (status === 'FAILED' || status === 'FAILURE' || status === 'ERROR') throw new Error(state.errorMessage || state.failedReason || 'RunningHub 任务失败');
    if (status === 'SUCCESS' || status === 'SUCCEEDED' || state.results) {
      const findUrl = value => {
        if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : null;
        if (Array.isArray(value)) { for (const item of value) { const found = findUrl(item); if (found) return found; } }
        if (value && typeof value === 'object') {
          for (const key of ['url', 'imageUrl', 'fileUrl', 'download_url']) if (typeof value[key] === 'string') return value[key];
          for (const item of Object.values(value)) { const found = findUrl(item); if (found) return found; }
        }
        return null;
      };
      const resultUrl = findUrl(state.results || state);
      if (resultUrl) return resultUrl;
      if (status === 'SUCCESS') throw new Error('任务已完成，但 RunningHub 没有返回图片链接');
    }
  }
  throw new Error('RunningHub 等待超过 10 分钟，请稍后在生成历史中查看任务');
});

// RunningHub 高清放大：与画室使用同一个 AI App（1985986284411858946）。
// 上传图片 → 节点 15 输入图片、节点 106 输入目标像素 → 查询任务 → 返回结果链接。
ipcMain.handle('runninghub:upscale', async (_e, { baseURL, apiKey, imageDataURL, resolution } = {}) => {
  if (!apiKey) throw new Error('请先在引擎设置中填写 RunningHub API Key');
  let parsed;
  try { parsed = new URL(baseURL); } catch (_) { throw new Error('RunningHub 地址格式不正确'); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !['www.runninghub.ai', 'www.runninghub.cn'].includes(host)) {
    throw new Error('请使用 https://www.runninghub.ai 或 https://www.runninghub.cn');
  }
  const root = 'https://' + host;
  const headers = { Authorization: 'Bearer ' + apiKey };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const request = async (url, options = {}, timeout = 90000) => {
    const res = await net.fetch(root + url, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: AbortSignal.timeout(timeout)
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = {}; }
    if (res.status === 401 || res.status === 403) {
      throw new Error('RunningHub 拒绝了放大调用（HTTP ' + res.status + '）。AI App 需要“企业级-共享”API Key，请在 RunningHub 的 API Key 页面确认 Key 类型。');
    }
    if (!res.ok) throw new Error('RunningHub 返回 HTTP ' + res.status + '：' + String(data.message || data.msg || text).slice(0, 180));
    if (data.code !== undefined && ![0, 200].includes(Number(data.code))) {
      throw new Error(data.message || data.msg || ('RunningHub 错误代码 ' + data.code));
    }
    return data.data || data;
  };

  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(imageDataURL || '');
  if (!match) throw new Error('输入图片格式不支持，请使用 PNG、JPG 或 WEBP');
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(match[2], 'base64')], { type: 'image/' + match[1] }), 'upscale.' + ext);
  const uploaded = await request('/openapi/v2/media/upload/binary', { method: 'POST', body: form }, 120000);
  const fileName = uploaded.fileName || uploaded.file_name || (uploaded.data && uploaded.data.fileName);
  if (!fileName) throw new Error('RunningHub 上传成功但没有返回文件名');

  const pixels = { '1k': 1024, '2k': 2048, '4k': 4096 }[String(resolution || '2k').toLowerCase()];
  if (!pixels) throw new Error('不支持的分辨率：' + resolution);
  const payload = {
    nodeInfoList: [
      { nodeId: '15', fieldName: 'image', fieldValue: fileName },
      { nodeId: '106', fieldName: 'value', fieldValue: String(pixels) }
    ]
  };

  let taskId = '';
  for (let attempt = 0; attempt < 5 && !taskId; attempt++) {
    try {
      const submitted = await request('/openapi/v2/run/ai-app/1985986284411858946', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 120000);
      taskId = submitted.taskId || (submitted.data && submitted.data.taskId) || '';
      if (taskId) break;
      const code = String(submitted.errorCode || '');
      const message = String(submitted.errorMessage || '');
      if (['421', '429', '414'].includes(code) || /queue limit|并发/i.test(message)) {
        await sleep(6000 + attempt * 4000);
        continue;
      }
      throw new Error('RunningHub 提交失败：' + (message || JSON.stringify(submitted).slice(0, 180)));
    } catch (error) {
      if (attempt === 4 || /401|403|拒绝/.test(String(error.message))) throw error;
      if (!/421|429|414|queue|并发|timeout|超时/i.test(String(error.message))) throw error;
      await sleep(6000 + attempt * 4000);
    }
  }
  if (!taskId) throw new Error('RunningHub 未返回任务编号');

  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    let state;
    try {
      state = await request('/openapi/v2/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      }, 60000);
    } catch (error) {
      if (/401|403|拒绝/.test(String(error.message))) throw error;
      continue;
    }
    const status = String(state.status || '').toUpperCase();
    if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'TIMEOUT'].includes(status)) {
      const reason = state.failedReason || {};
      throw new Error('RunningHub 放大失败：' + String(reason.exception_message || state.errorMessage || status).slice(0, 220));
    }
    if (status === 'SUCCESS') {
      const urls = [];
      const collect = value => {
        if (!value) return;
        if (typeof value === 'string') { if (/^https?:\/\//i.test(value)) urls.push(value); return; }
        if (Array.isArray(value)) { value.forEach(collect); return; }
        if (typeof value === 'object') {
          if (typeof value.url === 'string') urls.push(value.url);
          else if (typeof value.imageUrl === 'string') urls.push(value.imageUrl);
          Object.values(value).forEach(collect);
        }
      };
      collect(state.results || state.outputs || state);
      const unique = [...new Set(urls)];
      if (!unique.length) throw new Error('RunningHub 任务完成但没有返回图片');
      return { ok: true, urls: unique, taskId, resolution: String(resolution || '2k').toLowerCase() };
    }
  }
  throw new Error('RunningHub 放大等待超过 15 分钟，请稍后在 RunningHub 任务列表查看');
});

const runninghubPanoramaRuns = new Map();
ipcMain.handle('runninghub:panorama-cancel', async (_e, { requestId } = {}) => {
  const record = runninghubPanoramaRuns.get(String(requestId || ''));
  if (!record) return { ok: false, message: '任务不存在或已经结束' };
  record.controller.abort();
  return { ok: true };
});

ipcMain.handle('runninghub:panorama-repair', async (event, options = {}) => {
  const {
    requestId,
    baseURL,
    apiKey,
    appId,
    imageDataURL,
    maskDataURL,
    prompt,
    imageNodeId,
    imageFieldName,
    maskNodeId,
    maskFieldName,
    promptNodeId,
    promptFieldName
  } = options;
  if (!apiKey) throw new Error('请先在引擎设置中填写 RunningHub API Key');
  if (!appId) throw new Error('请填写 RunningHub 全景修复工作流 / AI App ID');
  if (!imageDataURL) throw new Error('缺少全景原图');
  if (!imageNodeId) throw new Error('请填写工作流中的全景图片节点 ID');
  let parsed;
  try { parsed = new URL(baseURL); } catch (_) { throw new Error('RunningHub 地址格式不正确'); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !['www.runninghub.ai', 'www.runninghub.cn'].includes(host)) {
    throw new Error('请使用 https://www.runninghub.ai 或 https://www.runninghub.cn');
  }
  const root = 'https://' + host;
  const id = String(requestId || ('panorama-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)));
  const controller = new AbortController();
  runninghubPanoramaRuns.set(id, { controller, startedAt: Date.now() });
  const emit = (phase, data = {}) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('runninghub:panorama-progress', Object.assign({
      requestId: id,
      phase,
      elapsedMs: Date.now() - (runninghubPanoramaRuns.get(id)?.startedAt || Date.now())
    }, data));
  };
  const sleep = ms => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('全景 AI 修复已取消', 'AbortError'));
    }, { once: true });
  });
  const request = async (url, requestOptions = {}, timeout = 90000) => {
    const timeoutSignal = AbortSignal.timeout(timeout);
    const requestSignal = AbortSignal.any ? AbortSignal.any([controller.signal, timeoutSignal]) : controller.signal;
    const response = await net.fetch(root + url, {
      ...requestOptions,
      headers: { Authorization: 'Bearer ' + apiKey, ...(requestOptions.headers || {}) },
      signal: requestSignal
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_) {}
    if (response.status === 401 || response.status === 403) {
      throw new Error('RunningHub 拒绝了工作流调用（HTTP ' + response.status + '）。AI App 需要企业级共享 API Key。');
    }
    if (!response.ok) throw new Error('RunningHub 返回 HTTP ' + response.status + '：' + String(data.message || data.msg || text).slice(0, 220));
    if (data.code !== undefined && ![0, 200].includes(Number(data.code))) {
      throw new Error(data.message || data.msg || ('RunningHub 错误代码 ' + data.code));
    }
    return data.data || data;
  };
  const uploadImage = async (dataURL, prefix) => {
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataURL || '');
    if (!match) throw new Error(prefix + '格式不支持，请使用 PNG、JPG 或 WEBP');
    const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(match[2], 'base64')], { type: 'image/' + match[1] }), prefix + '.' + ext);
    const uploaded = await request('/openapi/v2/media/upload/binary', { method: 'POST', body: form }, 120000);
    const fileName = uploaded.fileName || uploaded.file_name || (uploaded.data && uploaded.data.fileName);
    if (!fileName) throw new Error(prefix + '上传成功但没有返回文件名');
    return fileName;
  };
  try {
    emit('upload', { message: '上传全景原图' });
    const imageFileName = await uploadImage(imageDataURL, 'panorama');
    let maskFileName = '';
    if (maskDataURL && maskNodeId) {
      emit('upload', { message: '上传修复遮罩' });
      maskFileName = await uploadImage(maskDataURL, 'panorama-mask');
    }
    const nodeInfoList = [
      {
        nodeId: String(imageNodeId),
        fieldName: imageFieldName || 'image',
        fieldValue: imageFileName,
        description: imageFieldName || 'image'
      }
    ];
    if (maskFileName && maskNodeId) {
      nodeInfoList.push({
        nodeId: String(maskNodeId),
        fieldName: maskFieldName || 'image',
        fieldValue: maskFileName,
        description: maskFieldName || 'image'
      });
    }
    if (prompt && promptNodeId) {
      nodeInfoList.push({
        nodeId: String(promptNodeId),
        fieldName: promptFieldName || 'text',
        fieldValue: String(prompt),
        description: promptFieldName || 'text'
      });
    }
    emit('submit', { message: '提交 RunningHub 工作流' });
    const submitted = await request('/openapi/v2/run/ai-app/' + encodeURIComponent(String(appId)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeInfoList,
        instanceType: options.instanceType || 'default',
        usePersonalQueue: String(options.usePersonalQueue == null ? false : options.usePersonalQueue)
      })
    }, 120000);
    const taskId = submitted.taskId || (submitted.data && submitted.data.taskId) || '';
    if (!taskId) throw new Error('RunningHub 未返回任务编号');
    emit('running', { message: '工作流运行中', taskId });
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      if (controller.signal.aborted) throw new DOMException('全景 AI 修复已取消', 'AbortError');
      await sleep(2500);
      const state = await request('/openapi/v2/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      }, 60000);
      const status = String(state.status || '').toUpperCase();
      emit('running', { message: status || '运行中', taskId });
      if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'TIMEOUT'].includes(status)) {
        const reason = state.failedReason || {};
        throw new Error(String(reason.exception_message || state.errorMessage || status).slice(0, 240));
      }
      if (status === 'SUCCESS') {
        const urls = [];
        const collectUrls = value => {
          if (!value) return;
          if (typeof value === 'string') {
            if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) urls.push(value);
            return;
          }
          if (Array.isArray(value)) { value.forEach(collectUrls); return; }
          if (typeof value === 'object') {
            if (typeof value.url === 'string') urls.push(value.url);
            else if (typeof value.imageUrl === 'string') urls.push(value.imageUrl);
            Object.values(value).forEach(collectUrls);
          }
        };
        collectUrls(state.results || state.outputs || state);
        const resultURL = [...new Set(urls)][0];
        if (!resultURL) throw new Error('RunningHub 工作流完成，但没有返回图片');
        emit('download', { message: '下载修复结果', taskId });
        if (/^data:image\//i.test(resultURL)) {
          return { ok: true, dataURL: resultURL, taskId, requestId: id };
        }
        const imageResponse = await net.fetch(resultURL, { signal: controller.signal });
        if (!imageResponse.ok) throw new Error('下载修复结果失败：HTTP ' + imageResponse.status);
        const contentType = (imageResponse.headers.get('content-type') || 'image/png').split(';')[0];
        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        return {
          ok: true,
          dataURL: 'data:' + contentType + ';base64,' + bytes.toString('base64'),
          taskId,
          requestId: id
        };
      }
    }
    throw new Error('RunningHub 全景修复超过 15 分钟，请稍后在 RunningHub 任务列表查看');
  } catch (error) {
    if (controller.signal.aborted) throw new DOMException('全景 AI 修复已取消', 'AbortError');
    throw error;
  } finally {
    runninghubPanoramaRuns.delete(id);
  }
});

const localLamaRuns = new Map();

function localLamaRuntime() {
  const roots = [
    process.env.GIWIN_LAMA_ROOT,
    'G:\\FreeCCStudio',
    'D:\\FreeCCStudio',
    path.join(app.getPath('userData'), 'lama-runtime'),
    path.join(__dirname, 'lama-runtime')
  ].filter(Boolean);
  for (const root of [...new Set(roots)]) {
    const python = path.join(root, 'runtime', 'python.exe');
    const iopaintPython = path.join(root, 'iopaint_runtime', 'python.exe');
    const script = path.join(root, 'engine', 'panorama_poles.py');
    const model = path.join(root, 'models', 'lama', 'lama_fp32.onnx');
    if (fs.existsSync(python) && fs.existsSync(script) && fs.existsSync(model)) {
      return {
        root,
        python,
        iopaintPython: fs.existsSync(iopaintPython) ? iopaintPython : '',
        script,
        model
      };
    }
  }
  return null;
}

ipcMain.handle('local-lama:status', async () => {
  const runtime = localLamaRuntime();
  return runtime
    ? { ok: true, label: '本地 LaMa', mode: runtime.iopaintPython ? 'refine' : 'fast', root: runtime.root }
    : { ok: false, message: '未找到本地 LaMa 修复组件' };
});

ipcMain.handle('local-lama:panorama-cancel', async (_event, { requestId } = {}) => {
  const record = localLamaRuns.get(String(requestId || ''));
  if (!record) return { ok: false, message: '任务不存在或已经结束' };
  record.canceled = true;
  try { record.process.kill(); } catch (error) {}
  return { ok: true };
});

ipcMain.handle('local-lama:panorama-repair', async (event, options = {}) => {
  const runtime = localLamaRuntime();
  if (!runtime) return { ok: false, message: '未找到本地 LaMa 修复组件' };
  const imageDataURL = String(options.imageDataURL || '');
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(imageDataURL);
  if (!match) return { ok: false, message: '本地 LaMa 图片必须是 PNG、JPEG 或 WebP data URL' };
  const requestId = String(options.requestId || ('local-lama-' + Date.now().toString(36)));
  if (localLamaRuns.has(requestId)) return { ok: false, message: '本地 LaMa 任务已经在运行' };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'giwin-lama-'));
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const inputPath = path.join(tempDir, 'panorama.' + ext);
  const seamPath = path.join(tempDir, 'panorama-seam.png');
  const outputPath = path.join(tempDir, 'panorama-repaired.png');
  fs.writeFileSync(inputPath, Buffer.from(match[2], 'base64'));
  const radius = String(Math.max(6, Math.min(24, Number(options.radius) || 12)));
  const record = { process: null, canceled: false, startedAt: Date.now() };
  localLamaRuns.set(requestId, record);
  const emit = (phase, message) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('local-lama:panorama-progress', {
      requestId,
      phase,
      message,
      elapsedMs: Date.now() - record.startedAt
    });
  };
  const runProcess = (command, args, phaseLabel) => new Promise(resolve => {
    let stderr = '';
    let stdout = '';
    const child = spawn(command, args, {
      cwd: runtime.root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    record.process = child;
    emit('running', phaseLabel);
    const capture = (chunk, stderrMode) => {
      const text = chunk.toString('utf8');
      if (stderrMode) stderr = (stderr + text).slice(-16000);
      else stdout = (stdout + text).slice(-16000);
      text.split(/\r?\n/).forEach(line => {
        if (/\[inpaint\].*loaded/i.test(line)) emit('running', 'LaMa 精修模型已加载');
        else if (/top repaired/i.test(line)) emit('running', '顶部极点已补全');
        else if (/bottom repaired/i.test(line)) emit('running', '底部极点已补全');
      });
    };
    child.stdout.on('data', chunk => capture(chunk, false));
    child.stderr.on('data', chunk => capture(chunk, true));
    const timer = setTimeout(() => {
      try { child.kill(); } catch (error) {}
      resolve('timeout');
    }, 5 * 60 * 1000);
    child.on('error', error => {
      clearTimeout(timer);
      emit('error', error.message || '本地 LaMa 启动失败');
      resolve({ code: 'error', stderr, stdout, error });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
  });
  try {
    emit('seam', '校正全景中心接缝');
    const seamCode = [
      'import sys',
      'sys.path.insert(0, sys.argv[3])',
      'from pathlib import Path',
      'from app import _correct_center_seam',
      '_correct_center_seam(Path(sys.argv[1]), Path(sys.argv[2]))'
    ].join('; ');
    const seamRun = await runProcess(
      runtime.python,
      ['-X', 'utf8', '-c', seamCode, inputPath, seamPath, runtime.root],
      '接缝梯度校正中'
    );
    if (record.canceled) {
      return { ok: false, canceled: true, message: '本地 LaMa 修复已取消', requestId };
    }
    if (seamRun === 'timeout') return { ok: false, message: '本地接缝校正超过 5 分钟', requestId };
    if (seamRun.code !== 0 || !fs.existsSync(seamPath)) {
      const detail = seamRun.stderr || seamRun.stdout || ('退出代码 ' + seamRun.code);
      return { ok: false, message: String(detail).slice(-1200), requestId };
    }
    emit('poles', '加载 IOPaint LaMa 1024 精修');
    const poleArgs = backend => [
      '-X', 'utf8', runtime.script,
      '--input', seamPath,
      '--output', outputPath,
      '--poles', 'both',
      '--radius', radius,
      '--backend', backend,
      '--strategy', 'structure'
    ];
    let usedBackend = runtime.iopaintPython ? 'torch' : 'onnx';
    let repairRun = runtime.iopaintPython
      ? await runProcess(runtime.iopaintPython, poleArgs('torch'), 'IOPaint LaMa 1024 精修中')
      : await runProcess(runtime.python, poleArgs('onnx'), 'ONNX LaMa 快速修复中');
    let warning = '';
    if (record.canceled) {
      return { ok: false, canceled: true, message: '本地 LaMa 修复已取消', requestId };
    }
    if (repairRun === 'timeout') return { ok: false, message: '本地 LaMa 修复超过 5 分钟', requestId };
    if (usedBackend === 'torch' && (repairRun.code !== 0 || !fs.existsSync(outputPath))) {
      try { fs.rmSync(outputPath, { force: true }); } catch (error) {}
      usedBackend = 'onnx';
      warning = 'IOPaint 精修未完成，已回退到 ONNX 快速模式';
      emit('fallback', warning);
      repairRun = await runProcess(runtime.python, poleArgs('onnx'), 'ONNX LaMa 快速修复中');
    }
    if (record.canceled) {
      return { ok: false, canceled: true, message: '本地 LaMa 修复已取消', requestId };
    }
    if (repairRun === 'timeout') return { ok: false, message: '本地 LaMa 修复超过 5 分钟', requestId };
    if (repairRun.code !== 0 || !fs.existsSync(outputPath)) {
      const detail = repairRun.stderr || repairRun.stdout || ('退出代码 ' + repairRun.code);
      return { ok: false, message: String(detail).slice(-1200), requestId };
    }
    const bytes = fs.readFileSync(outputPath);
    return {
      ok: true,
      dataURL: 'data:image/png;base64,' + bytes.toString('base64'),
      requestId,
      engine: 'local-lama-' + usedBackend,
      warning
    };
  } finally {
    localLamaRuns.delete(requestId);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (error) {}
  }
});

const topaz302Runs = new Map();

function topaz302ApiBase(baseURL) {
  const parsed = new URL(baseURL || 'https://api.302.ai');
  if (parsed.protocol !== 'https:') throw new Error('302.AI 必须使用 HTTPS 地址');
  const pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return parsed.origin + pathname;
}

async function topaz302Request(url, apiKey, options = {}, timeout = 120000) {
  const response = await net.fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + apiKey,
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (error) {}
  if (!response.ok) {
    const detail = data.message || data.error || data.msg || text;
    throw new Error('302.AI 返回 HTTP ' + response.status + '：' + String(detail).slice(0, 500));
  }
  return data;
}

ipcMain.handle('topaz302:check', async (_event, { baseURL, apiKey } = {}) => {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, message: '请填写 302.AI API Key' };
  try {
    const root = topaz302ApiBase(baseURL);
    const data = await topaz302Request(root + '/v1/models', key, { method: 'GET' }, 20000);
    const count = Array.isArray(data.data) ? data.data.length : 0;
    return { ok: true, models: count };
  } catch (error) {
    return { ok: false, message: error.message || '302.AI 连接失败' };
  }
});

ipcMain.handle('topaz302:cancel', async (_event, { requestId } = {}) => {
  const record = topaz302Runs.get(String(requestId || ''));
  if (!record) return { ok: false, message: '任务不存在或已经结束' };
  record.controller.abort();
  return { ok: true };
});

ipcMain.handle('topaz302:upscale', async (event, options = {}) => {
  const apiKey = String(options.apiKey || '').trim();
  const imageDataURL = String(options.imageDataURL || '');
  if (!apiKey) return { ok: false, message: '请先在设置中填写 302.AI API Key' };
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(imageDataURL);
  if (!match) return { ok: false, message: '302.AI 放大图片格式不受支持' };
  let root;
  try { root = topaz302ApiBase(options.baseURL); }
  catch (error) { return { ok: false, message: error.message }; }
  const requestId = String(options.requestId || ('topaz302-' + Date.now().toString(36)));
  if (topaz302Runs.has(requestId)) return { ok: false, message: '302.AI 放大任务已经在运行' };
  const controller = new AbortController();
  const record = { controller, startedAt: Date.now() };
  topaz302Runs.set(requestId, record);
  const emit = (phase, message) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('topaz302:progress', {
      requestId,
      phase,
      message,
      elapsedMs: Date.now() - record.startedAt
    });
  };
  const sleep = ms => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Topaz 放大已取消', 'AbortError'));
    }, { once: true });
  });
  const collectURL = value => {
    if (!value) return '';
    if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = collectURL(item);
        if (found) return found;
      }
      return '';
    }
    if (typeof value === 'object') {
      for (const key of ['url', 'file_url', 'fileUrl', 'download_url', 'downloadUrl', 'image_url', 'imageUrl']) {
        const found = collectURL(value[key]);
        if (found) return found;
      }
      for (const item of Object.values(value)) {
        const found = collectURL(item);
        if (found) return found;
      }
    }
    return '';
  };
  try {
    emit('upload', '上传原图');
    const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(match[2], 'base64')], {
      type: 'image/' + match[1]
    }), 'upscale.' + ext);
    const uploaded = await topaz302Request(root + '/302/upload-file', apiKey, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    const imageURL = collectURL(uploaded);
    if (!imageURL) throw new Error('302.AI 文件上传成功但未返回图片地址');
    const inputImage = nativeImage.createFromDataURL(imageDataURL);
    const inputSize = inputImage.getSize();
    const shortEdge = Math.min(inputSize.width, inputSize.height);
    const targetShort = Number(options.targetShortEdge) || (String(options.resolution) === '4k' ? 4096 : String(options.resolution) === '1k' ? 1024 : 2048);
    const scale = shortEdge > 0 ? targetShort / shortEdge : 1;
    const outputWidth = Math.max(1, Math.round(inputSize.width * scale));
    const outputHeight = Math.max(1, Math.round(inputSize.height * scale));
    emit('submit', '提交 Topaz Standard V2');
    const submitted = await topaz302Request(root + '/topazlabs/image/v1/enhance/async', apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageURL,
        model: options.model || 'Standard V2',
        output_format: 'png',
        output_width: outputWidth,
        output_height: outputHeight,
        subject_detection: 'All',
        face_enhancement: true,
        face_enhancement_creativity: 0,
        face_enhancement_strength: 0.8,
        crop_to_fill: false
      }),
      signal: controller.signal
    });
    const processId = submitted.process_id || submitted.processId || (submitted.data && (submitted.data.process_id || submitted.data.processId));
    if (!processId) throw new Error('302.AI 未返回 Topaz 任务编号');
    emit('running', 'Topaz 任务运行中');
    const deadline = Date.now() + 5 * 60 * 1000;
    let resultURL = '';
    let state = {};
    while (Date.now() < deadline) {
      await sleep(1800);
      state = await topaz302Request(root + '/topazlabs/image/v1/status/' + encodeURIComponent(processId), apiKey, {
        method: 'GET',
        signal: controller.signal
      });
      const status = String(state.status || state.state || (state.data && (state.data.status || state.data.state)) || '').toUpperCase();
      if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status)) {
        throw new Error(String(state.message || state.error || status).slice(0, 500));
      }
      resultURL = collectURL(state);
      if (resultURL || ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'DONE'].includes(status)) break;
    }
    if (!resultURL) {
      const response = await net.fetch(root + '/topazlabs/image/v1/download/' + encodeURIComponent(processId), {
        headers: { Authorization: 'Bearer ' + apiKey },
        signal: controller.signal
      });
      if (response.ok) {
        const contentType = (response.headers.get('content-type') || '').split(';')[0];
        if (contentType.startsWith('image/')) {
          const bytes = Buffer.from(await response.arrayBuffer());
          return {
            ok: true,
            dataURL: 'data:' + contentType + ';base64,' + bytes.toString('base64'),
            taskId: processId,
            requestId,
            credits: submitted.credits || state.credits || 0
          };
        }
        const text = await response.text();
        try { resultURL = collectURL(JSON.parse(text)); } catch (error) {}
      }
    }
    if (!resultURL) throw new Error('Topaz 任务完成但没有返回图片');
    emit('download', '下载 Topaz 结果');
    const imageResponse = await net.fetch(resultURL, { signal: controller.signal });
    if (!imageResponse.ok) throw new Error('下载 Topaz 结果失败：HTTP ' + imageResponse.status);
    const contentType = (imageResponse.headers.get('content-type') || 'image/png').split(';')[0];
    if (!contentType.startsWith('image/')) throw new Error('Topaz 返回结果不是图片');
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    return {
      ok: true,
      dataURL: 'data:' + contentType + ';base64,' + bytes.toString('base64'),
      taskId: processId,
      requestId,
      credits: submitted.credits || state.credits || 0
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, canceled: true, message: 'Topaz 放大已取消', requestId };
    }
    return { ok: false, message: error.message || 'Topaz 放大失败', requestId };
  } finally {
    topaz302Runs.delete(requestId);
  }
});

const bailianPanoramaRuns = new Map();

function bailianApiBase(baseURL) {
  const parsed = new URL(baseURL || 'https://dashscope.aliyuncs.com/api/v1');
  if (parsed.protocol !== 'https:') throw new Error('阿里云百炼必须使用 HTTPS 地址');
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!/\/api\/v1$/i.test(pathname)) pathname += '/api/v1';
  return parsed.origin + pathname;
}

async function bailianRequest(url, apiKey, options = {}, signal) {
  const response = await net.fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + apiKey,
      ...(options.headers || {})
    },
    signal
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (error) {}
  if (!response.ok) {
    const detail = data.message || data.msg || data.error || data.code || text;
    throw new Error('阿里云百炼返回 HTTP ' + response.status + '：' + String(detail).slice(0, 500));
  }
  if (data.code !== undefined && data.code !== null && Number(data.code) !== 200) {
    throw new Error(String(data.message || data.msg || ('阿里云百炼错误码 ' + data.code)).slice(0, 500));
  }
  return data;
}

ipcMain.handle('bailian:panorama-cancel', async (_event, { requestId } = {}) => {
  const record = bailianPanoramaRuns.get(String(requestId || ''));
  if (!record) return { ok: false, message: '任务不存在或已经结束' };
  record.controller.abort();
  return { ok: true };
});

ipcMain.handle('bailian:panorama-repair', async (event, options = {}) => {
  const apiKey = String(options.apiKey || '').trim();
  const imageDataURL = String(options.imageDataURL || '');
  const maskDataURL = String(options.maskDataURL || '');
  const foregroundDataURL = String(options.foregroundDataURL || '');
  const prompt = String(options.prompt || '').slice(0, 800);
  const model = options.model === 'image-erase-completion'
    ? 'image-erase-completion'
    : 'wanx2.1-imageedit';
  if (!apiKey) return { ok: false, message: '请先在设置中填写阿里云百炼 API Key' };
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(imageDataURL)) {
    return { ok: false, message: '全景极点图片必须是 PNG、JPEG 或 WebP data URL' };
  }
  if (!/^data:image\/png;base64,/i.test(maskDataURL)) {
    return { ok: false, message: '全景极点遮罩必须是 PNG data URL' };
  }
  if (model === 'image-erase-completion' && !/^data:image\/png;base64,/i.test(foregroundDataURL)) {
    return { ok: false, message: '图像擦除补全需要 PNG 前景保留遮罩' };
  }
  const imageBytes = Buffer.from(imageDataURL.split(',')[1] || '', 'base64');
  const maskBytes = Buffer.from(maskDataURL.split(',')[1] || '', 'base64');
  const foregroundBytes = Buffer.from(foregroundDataURL.split(',')[1] || '', 'base64');
  if (imageBytes.length > 10 * 1024 * 1024 ||
      maskBytes.length > 10 * 1024 * 1024 ||
      foregroundBytes.length > 10 * 1024 * 1024) {
    return { ok: false, message: '全景极点图片或遮罩超过阿里云 10 MB 限制' };
  }
  let root;
  try { root = bailianApiBase(options.baseURL); }
  catch (error) { return { ok: false, message: error.message }; }
  const requestId = String(options.requestId || ('bailian-panorama-' + Date.now().toString(36)));
  if (bailianPanoramaRuns.has(requestId)) {
    return { ok: false, message: '该百炼全景修复任务已经运行' };
  }
  const controller = new AbortController();
  const record = { controller, startedAt: Date.now(), taskId: '' };
  bailianPanoramaRuns.set(requestId, record);
  const emit = (phase, data = {}) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('bailian:panorama-progress', {
      requestId,
      phase,
      elapsedMs: Date.now() - record.startedAt,
      ...data
    });
  };
  const sleep = ms => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('阿里云全景智能修复已取消', 'AbortError'));
    }, { once: true });
  });
  try {
    emit('submit', {
      message: model === 'image-erase-completion'
        ? '提交阿里云图像擦除补全任务'
        : '提交万相局部重绘任务'
    });
    const createSignal = AbortSignal.any
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(65000)])
      : controller.signal;
    const submitted = await bailianRequest(root + '/services/aigc/image2image/image-synthesis', apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model,
        input: model === 'image-erase-completion'
          ? {
              image_url: imageDataURL,
              mask_url: maskDataURL,
              foreground_url: foregroundDataURL
            }
          : {
              function: 'description_edit_with_mask',
              prompt: prompt || '自然补全全景图上下极点，保持原有材质、线条和透视连续，不改变遮罩外区域，不生成任何遮罩或标记。',
              base_image_url: imageDataURL,
              mask_image_url: maskDataURL
            },
        parameters: model === 'image-erase-completion'
          ? { dilate_flag: true }
          : { n: 1, watermark: false, prompt_extend: false }
      })
    }, createSignal);
    const taskId = (submitted.output && submitted.output.task_id) || submitted.task_id;
    if (!taskId) throw new Error('阿里云未返回任务编号');
    record.taskId = taskId;
    emit('running', { message: '万相局部重绘运行中', taskId });
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(1800);
      if (controller.signal.aborted) throw new DOMException('阿里云全景智能修复已取消', 'AbortError');
      let state = await bailianRequest(root + '/tasks/' + encodeURIComponent(taskId), apiKey, {
        method: 'GET'
      }, controller.signal);
      let output = state.output || {};
      const status = String(output.task_status || state.task_status || '').toUpperCase();
      emit('running', { message: status || '运行中', taskId });
      if (['FAILED', 'CANCELED', 'CANCELLED', 'UNKNOWN'].includes(status)) {
        const reason = output.message || output.code || state.message || status;
        throw new Error(String(reason).slice(0, 500));
      }
      if (status === 'SUCCEEDED') {
        const findResultURL = value => {
          if (!value) return '';
          if (typeof value === 'string') {
            return /^(?:https?:\/\/|data:image\/)/i.test(value) ? value : '';
          }
          if (Array.isArray(value)) {
            for (const item of value) {
              const found = findResultURL(item);
              if (found) return found;
            }
            return '';
          }
          if (typeof value === 'object') {
            for (const key of ['url', 'image_url', 'imageUrl', 'file_url', 'fileUrl', 'download_url', 'downloadUrl']) {
              const found = findResultURL(value[key]);
              if (found) return found;
            }
            for (const item of Object.values(value)) {
              const found = findResultURL(item);
              if (found) return found;
            }
          }
          return '';
        };
        let resultURL = findResultURL(output.results || output.result || state.results || state.result || state);
        for (let attempt = 0; !resultURL && attempt < 3; attempt++) {
          await sleep(700);
          state = await bailianRequest(root + '/tasks/' + encodeURIComponent(taskId), apiKey, {
            method: 'GET'
          }, controller.signal);
          output = state.output || {};
          resultURL = findResultURL(output.results || output.result || state.results || state.result || state);
        }
        if (!resultURL) {
          const keys = Object.keys(output).join(', ').slice(0, 160);
          throw new Error('阿里云任务已完成，但结果中没有图片链接' + (keys ? '（返回字段：' + keys + '）' : ''));
        }
        emit('download', { message: '下载万相修复结果', taskId });
        const imageResponse = await net.fetch(resultURL, { signal: controller.signal });
        if (!imageResponse.ok) throw new Error('下载阿里云修复结果失败：HTTP ' + imageResponse.status);
        const contentType = (imageResponse.headers.get('content-type') || 'image/png').split(';')[0];
        if (!contentType.startsWith('image/')) throw new Error('阿里云返回的结果不是图片');
        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        return {
          ok: true,
          dataURL: 'data:' + contentType + ';base64,' + bytes.toString('base64'),
          taskId,
          requestId,
          usage: state.usage || {}
        };
      }
    }
    throw new Error('阿里云全景智能修复超过 3 分钟');
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, canceled: true, message: '阿里云全景智能修复已取消', requestId };
    }
    return { ok: false, message: error.message || '阿里云全景智能修复失败', requestId };
  } finally {
    bailianPanoramaRuns.delete(requestId);
  }
});

const REPLICATE_LAMA_VERSION = 'allenhooo/lama:cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72';
const REPLICATE_MAX_DATA_URL_CHARS = 1400000;
const replicateLamaRuns = new Map();

function normalizeReplicateToken(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

async function replicateRequest(pathname, apiKey, options = {}, signal) {
  const response = await net.fetch('https://api.replicate.com' + pathname, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + apiKey,
      ...(options.headers || {})
    },
    signal
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (error) {}
  if (!response.ok) {
    const message = data.detail || data.title || data.error || data.message || text;
    throw new Error('Replicate 返回 HTTP ' + response.status + '：' + String(message).slice(0, 500));
  }
  return data;
}

ipcMain.handle('replicate:check', async (_event, { apiKey } = {}) => {
  const token = normalizeReplicateToken(apiKey);
  if (!token) return { ok: false, message: '请填写 Replicate API Token' };
  try {
    const [account, model] = await Promise.all([
      replicateRequest('/v1/account', token, {
        headers: { 'Content-Type': 'application/json' }
      }, AbortSignal.timeout(20000)),
      replicateRequest('/v1/models/allenhooo/lama', token, {
        headers: { 'Content-Type': 'application/json' }
      }, AbortSignal.timeout(20000))
    ]);
    return {
      ok: true,
      account: account.username || account.name || account.type || '',
      model: model.latest_version && model.latest_version.id || REPLICATE_LAMA_VERSION.split(':')[1]
    };
  } catch (error) {
    return { ok: false, message: error.message || 'Replicate 连接失败' };
  }
});

ipcMain.handle('replicate:lama-cancel', async (_event, { requestId } = {}) => {
  const record = replicateLamaRuns.get(String(requestId || ''));
  if (!record) return { ok: false, message: '任务不存在或已经结束' };
  record.controller.abort();
  if (record.cancelURL) {
    try {
      await replicateRequest(new URL(record.cancelURL).pathname, record.apiKey, { method: 'POST' }, AbortSignal.timeout(15000));
    } catch (error) {}
  }
  return { ok: true };
});

ipcMain.handle('replicate:lama-repair', async (event, options = {}) => {
  const apiKey = normalizeReplicateToken(options.apiKey);
  const imageDataURL = String(options.imageDataURL || '');
  const maskDataURL = String(options.maskDataURL || '');
  if (!apiKey) return { ok: false, message: '请先在设置中填写 Replicate API Token' };
  if (!/^data:image\/(?:png|jpeg);base64,/i.test(imageDataURL)) {
    return { ok: false, message: 'Replicate LaMa 图片必须为 PNG 或 JPEG data URL' };
  }
  if (!/^data:image\/png;base64,/i.test(maskDataURL)) {
    return { ok: false, message: 'Replicate LaMa 遮罩必须为 PNG data URL' };
  }
  if (imageDataURL.length > REPLICATE_MAX_DATA_URL_CHARS || maskDataURL.length > REPLICATE_MAX_DATA_URL_CHARS) {
    return { ok: false, message: '极点图片或遮罩超过 1 MB，请缩小后重试' };
  }
  const requestId = String(options.requestId || ('replicate-lama-' + Date.now().toString(36)));
  if (replicateLamaRuns.has(requestId)) return { ok: false, message: '该 Replicate LaMa 任务已经运行' };
  const controller = new AbortController();
  const record = { apiKey, controller, startedAt: Date.now(), cancelURL: '' };
  replicateLamaRuns.set(requestId, record);
  const emit = (phase, data = {}) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('replicate:lama-progress', {
      requestId,
      phase,
      elapsedMs: Date.now() - record.startedAt,
      ...data
    });
  };
  const sleep = ms => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Replicate LaMa 修复已取消', 'AbortError'));
    }, { once: true });
  });
  try {
    emit('submit', { message: '提交 Replicate LaMa' });
    const signal = AbortSignal.any
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(65000)])
      : controller.signal;
    let prediction = await replicateRequest('/v1/predictions', apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'wait=60',
        'Cancel-After': '2m'
      },
      body: JSON.stringify({
        version: REPLICATE_LAMA_VERSION,
        input: { image: imageDataURL, mask: maskDataURL }
      })
    }, signal);
    record.cancelURL = prediction.urls && prediction.urls.cancel || '';
    const deadline = Date.now() + 2 * 60 * 1000;
    while (!['succeeded', 'failed', 'canceled'].includes(String(prediction.status || '').toLowerCase())) {
      if (Date.now() > deadline) throw new Error('Replicate LaMa 修复超过 2 分钟');
      emit('running', { message: String(prediction.status || 'processing'), predictionId: prediction.id || '' });
      await sleep(900);
      const getPath = prediction.urls && prediction.urls.get
        ? new URL(prediction.urls.get).pathname
        : '/v1/predictions/' + encodeURIComponent(prediction.id || '');
      prediction = await replicateRequest(getPath, apiKey, {
        headers: { 'Content-Type': 'application/json' }
      }, controller.signal);
    }
    if (String(prediction.status).toLowerCase() !== 'succeeded') {
      const reason = prediction.error || prediction.status || 'unknown';
      throw new Error('Replicate LaMa 修复失败：' + String(reason).slice(0, 500));
    }
    const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!output || typeof output !== 'string') throw new Error('Replicate LaMa 没有返回图片');
    emit('download', { message: '下载 LaMa 修复结果', predictionId: prediction.id || '' });
    let resultDataURL = output;
    if (!/^data:image\//i.test(output)) {
      const imageResponse = await net.fetch(output, {
        headers: { Authorization: 'Bearer ' + apiKey },
        signal: controller.signal
      });
      if (!imageResponse.ok) throw new Error('下载 Replicate LaMa 结果失败：HTTP ' + imageResponse.status);
      const mime = (imageResponse.headers.get('content-type') || 'image/png').split(';')[0];
      if (!mime.startsWith('image/')) throw new Error('Replicate LaMa 返回的不是图片');
      resultDataURL = 'data:' + mime + ';base64,' + Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
    }
    return {
      ok: true,
      dataURL: resultDataURL,
      predictionId: prediction.id || '',
      metrics: prediction.metrics || {},
      requestId
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, canceled: true, message: 'Replicate LaMa 修复已取消', requestId };
    }
    return { ok: false, message: error.message || 'Replicate LaMa 修复失败', requestId };
  } finally {
    replicateLamaRuns.delete(requestId);
  }
});

let updateServiceInstance = null;
function startUpdateService() {
  if (updateServiceInstance) return;
  try {
    updateServiceInstance = updateService.createUpdateService({
      app,
      ipcMain,
      net,
      shell,
      getWindow: () => win
    });
    updateServiceInstance.attachIpc();
    updateServiceInstance.start();
  } catch (error) {
    console.error('[update] 初始化失败', error);
  }
}

function createWindow() {
  const rendererArguments = [];
  if (devEntitlementsEnabled) rendererArguments.push('--gw-dev-entitlements');
  if (app.isPackaged) rendererArguments.push('--gw-packaged');
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1120, minHeight: 700,
    backgroundColor: '#141414',
    title: '极物 GIWIN Studio',
    frame: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      additionalArguments: rendererArguments
    }
  });
  win.loadFile('index.html');
  const notifyWindowState = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('window:maximized-state', win.isMaximized());
  };
  const notifyFullscreenState = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('window:fullscreen-state', win.isFullScreen());
  };
  win.on('maximize', notifyWindowState);
  win.on('unmaximize', notifyWindowState);
  win.on('enter-full-screen', notifyFullscreenState);
  win.on('leave-full-screen', notifyFullscreenState);
  win.on('close', event => {
    if (forceWindowClose || win.webContents.isLoadingMainFrame()) return;
    event.preventDefault();
    win.webContents.send('window:request-close');
  });
  win.webContents.on('did-finish-load', () => {
    notifyWindowState();
    notifyFullscreenState();
    if (safeRenderMode) {
      win.webContents.executeJavaScript(
        "window.GWCanvas && GWCanvas.toast('上次启动异常，已进入安全渲染模式；本次正常退出后会自动恢复', true)"
      ).catch(() => {});
    }
  });
  ipcMain.on('bootlog', (_e, line) => {
    try {
      fs.mkdirSync(path.dirname(runtimeBootLogPath), { recursive: true });
      fs.appendFileSync(runtimeBootLogPath, String(line || '') + '\n');
    } catch (err) {}
  });
}
ipcMain.handle('window:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); return true; });
ipcMain.handle('window:toggle-maximize', () => {
  if (!win || win.isDestroyed()) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:maximized-state', () => !!(win && !win.isDestroyed() && win.isMaximized()));
ipcMain.handle('window:set-fullscreen', (_event, enabled) => {
  if (!win || win.isDestroyed()) return false;
  win.setFullScreen(enabled === true);
  return win.isFullScreen();
});
ipcMain.handle('window:fullscreen-state', () => !!(win && !win.isDestroyed() && win.isFullScreen()));
ipcMain.handle('window:close', () => { if (win && !win.isDestroyed()) win.close(); return true; });
ipcMain.handle('window:force-close', () => {
  if (!win || win.isDestroyed()) return false;
  forceWindowClose = true;
  win.close();
  return true;
});
ipcMain.handle('app:openExternal', async (_event, rawURL) => {
  try {
    const url = new URL(String(rawURL || ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, msg: '仅支持打开网页链接' };
    }
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch (error) {
    return { ok: false, msg: error.message || '无法打开链接' };
  }
});

// ---------- EULA ----------
ipcMain.handle('eula:check', () => readJSON(file('settings.json'), {}).eulaAccepted === true);
ipcMain.handle('eula:accept', () => {
  const s = readJSON(file('settings.json'), {});
  s.eulaAccepted = true; s.eulaAt = Date.now();
  writeJSON(file('settings.json'), s);
  return true;
});

// ---------- 账号 ----------
function makeSession(acc) {
  writeJSON(file('session.json'), {
    accountId: acc.id, token: crypto.randomBytes(24).toString('hex'),
    expires: Date.now() + 7 * 24 * 3600 * 1000
  });
  const s = readJSON(file('settings.json'), {});
  s.lastEmail = acc.email;
  writeJSON(file('settings.json'), s);
  return { ok: true, account: publicAcc(acc) };
}
ipcMain.handle('auth:register', (_e, { email, name, password }) => {
  const accounts = readJSON(file('accounts.json'), []);
  email = (email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, msg: '邮箱格式不正确' };
  if (accounts.some(a => a.email === email)) return { ok: false, msg: '该邮箱已注册，请直接登录' };
  if ((password || '').length < 6) return { ok: false, msg: '密码至少 6 位' };
  const salt = crypto.randomBytes(16).toString('hex');
  const acc = { id: crypto.randomUUID(), email, name: (name || '').trim() || email.split('@')[0],
    salt, passHash: hash(password, salt), createdAt: Date.now() };
  accounts.push(acc);
  writeJSON(file('accounts.json'), accounts);
  fs.mkdirSync(file('workspaces', acc.id), { recursive: true });
  writeJSON(file('workspaces', acc.id, 'projects.json'), []);
  return makeSession(acc);
});
ipcMain.handle('auth:login', (_e, { email, password }) => {
  const accounts = readJSON(file('accounts.json'), []);
  email = (email || '').trim().toLowerCase();
  const acc = accounts.find(a => a.email === email);
  if (!acc || acc.passHash !== hash(password || '', acc.salt)) return { ok: false, msg: '邮箱或密码不正确' };
  return makeSession(acc);
});
ipcMain.handle('auth:session', () => {
  const s = readJSON(file('session.json'), null);
  if (!s || s.expires < Date.now()) return { ok: false };
  const acc = readJSON(file('accounts.json'), []).find(a => a.id === s.accountId);
  return acc ? { ok: true, account: publicAcc(acc) } : { ok: false };
});
ipcMain.handle('auth:logout', () => { try { fs.unlinkSync(file('session.json')); } catch (e) {} return true; });
// M0-修复#4：本机账号列表（邮箱记忆）
ipcMain.handle('auth:accounts', () => readJSON(file('accounts.json'), []).map(publicAcc));
ipcMain.handle('settings:get', () => readJSON(file('settings.json'), {}));

ipcMain.handle('license:status', () => licenseStatus());
ipcMain.handle('license:exportRequest', async (_event, details = {}) => {
  const deviceId = currentDeviceId();
  let request;
  try {
    request = licenseCore.createActivationRequest({
      deviceId,
      appVersion: app.getVersion(),
      platform: process.platform,
      inviteCode: details && details.inviteCode
    });
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
  const result = await dialog.showSaveDialog(win, {
    title: '导出极物内测激活申请',
    defaultPath: 'GIWIN-Activation-' + deviceId + '.gwreq',
    filters: [{ name: '极物激活申请', extensions: ['gwreq'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, JSON.stringify(request, null, 2), 'utf8');
  return { ok: true, filePath: result.filePath, deviceId };
});
ipcMain.handle('license:activate', (_event, code) => {
  try {
    return installActivationCode(code);
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('license:redeemInviteReward', (_event, code) => {
  try {
    return redeemInviteRewardCode(code);
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('license:import', async (_event, providedPath) => {
  let filePath = typeof providedPath === 'string' ? path.resolve(providedPath) : '';
  if (filePath && path.extname(filePath).toLowerCase() !== '.gwlic') {
    return { ok: false, msg: '许可证文件扩展名必须为 .gwlic' };
  }
  if (!filePath) {
    const result = await dialog.showOpenDialog(win, {
      title: '导入极物内测许可证',
      properties: ['openFile'],
      filters: [{ name: '极物许可证', extensions: ['gwlic'] }]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    filePath = result.filePaths[0];
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 128 * 1024) throw new Error('许可证文件无效或过大');
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return installLicenseEnvelope(envelope);
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('license:clear', () => {
  try { fs.unlinkSync(licenseStatePath()); } catch (error) {}
  return licenseStatus();
});
ipcMain.handle('diagnostics:read', () => ({
  ok: true,
  boot: readDiagnosticTail(runtimeBootLogPath) || '暂无启动日志',
  crash: readDiagnosticTail(runtimeCrashLogPath) || '暂无错误日志',
  health: readJSON(runtimeHealthPath, null),
  environment: {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch
  }
}));
ipcMain.handle('diagnostics:openFolder', async () => {
  try {
    await shell.openPath(app.getPath('userData'));
    return { ok: true };
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});

// ---------- 项目 ----------
const projFile = accId => file('workspaces', accId, 'projects.json');
ipcMain.handle('projects:list', (_e, accId) =>
  readJSON(projFile(accId), []).sort((a, b) => b.lastOpened - a.lastOpened));
ipcMain.handle('projects:create', async (_e, { accountId, name }) => {
  name = (name || '').trim();
  if (!name) return { ok: false, msg: '请输入项目名称，如：张姐-江山悦140㎡' };
  const r = await dialog.showOpenDialog(win, { title: '选择「' + name + '」的存放位置', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return { ok: false, msg: 'cancel' };
  const dir = path.join(r.filePaths[0], sanitize(name));
  if (fs.existsSync(dir)) return { ok: false, msg: '该位置已存在同名文件夹' };
  fs.mkdirSync(path.join(dir, 'Content'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
  const p = { id: crypto.randomUUID(), name, path: dir, createdAt: Date.now(), lastOpened: Date.now() };
  writeJSON(path.join(dir, 'project.gw'), { version: 1, ...p });
  const list = readJSON(projFile(accountId), []); list.unshift(p); writeJSON(projFile(accountId), list);
  return { ok: true, project: p };
});
ipcMain.handle('projects:rename', (_e, { accountId, projectId, name } = {}) => {
  name = String(name || '').trim();
  if (!name) return { ok: false, msg: '项目名称不能为空' };
  if (name.length > 80) return { ok: false, msg: '项目名称不能超过 80 个字符' };
  const list = readJSON(projFile(accountId), []);
  const project = list.find(item => item.id === projectId);
  if (!project) return { ok: false, msg: '找不到要重命名的项目' };
  const duplicate = list.some(item =>
    item.id !== project.id && String(item.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (duplicate) return { ok: false, msg: '已有同名项目，请换一个名称' };
  const projectFile = path.join(project.path, 'project.gw');
  const metadata = readJSON(projectFile, null);
  if (!metadata || !metadata.id) return { ok: false, msg: '项目文件不可用，无法重命名' };
  project.name = name;
  metadata.name = name;
  metadata.updatedAt = Date.now();
  try {
    writeJSON(projectFile, metadata);
    writeJSON(projFile(accountId), list);
  } catch (error) {
    return { ok: false, msg: '保存项目名称失败：' + error.message };
  }
  return { ok: true, project };
});
ipcMain.handle('projects:openDialog', async (_e, accountId) => {
  const r = await dialog.showOpenDialog(win, { title: '打开工程（可多选 project.gw）', properties: ['openFile', 'multiSelections'], filters: [{ name: '极物工程', extensions: ['gw'] }] });
  if (r.canceled) return { ok: false, msg: 'cancel' };
  const projects = [];
  const skipped = [];
  for (const filePath of r.filePaths) {
    const data = readJSON(filePath, null);
    if (!data || !data.id) {
      skipped.push(path.basename(filePath));
      continue;
    }
    projects.push({
      id: data.id,
      name: data.name || path.basename(path.dirname(filePath)),
      path: path.dirname(filePath),
      createdAt: data.createdAt || Date.now(),
      lastOpened: Date.now()
    });
  }
  if (!projects.length) return { ok: false, msg: '所选文件都不是有效的极物工程' };
  const openedIds = new Set(projects.map(project => project.id));
  const list = readJSON(projFile(accountId), []).filter(project => !openedIds.has(project.id));
  writeJSON(projFile(accountId), projects.concat(list));
  return { ok: true, project: projects[0], projects, skipped };
});
ipcMain.handle('projects:exportBackup', async (_e, { projectPath } = {}) => {
  if (!projectPath) return { ok: false, msg: '请先打开需要备份的项目' };
  const picked = await dialog.showOpenDialog(win, {
    title: '选择项目备份的保存位置',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) {
    return { ok: false, msg: 'cancel' };
  }
  try {
    const result = await projectBackup.createProjectBackup({
      projectPath,
      destinationRoot: picked.filePaths[0],
      appVersion: app.getVersion()
    });
    return result;
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('projects:restoreBackup', async (_e, { accountId } = {}) => {
  if (!accountId) return { ok: false, msg: '账号状态不可用，无法恢复项目' };
  const picked = await dialog.showOpenDialog(win, {
    title: '选择极物项目备份文件夹',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory']
  });
  if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) {
    return { ok: false, msg: 'cancel' };
  }
  const destination = await dialog.showOpenDialog(win, {
    title: '选择恢复后的项目存放位置',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (destination.canceled || !destination.filePaths || !destination.filePaths[0]) {
    return { ok: false, msg: 'cancel' };
  }
  try {
    const result = await projectBackup.restoreProjectBackup({
      backupPath: picked.filePaths[0],
      destinationRoot: destination.filePaths[0]
    });
    const list = readJSON(projFile(accountId), []);
    writeJSON(projFile(accountId), [result.project].concat(list));
    return result;
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('project:backgroundImage', async (_e, { projectPath } = {}) => {
  if (!projectPath) return { ok: false };
  const thumbDir = path.join(projectPath, 'cache', 'thumbs');
  try {
    const thumbNames = fs.readdirSync(thumbDir);
    const thumbsBySource = new Map();
    thumbNames
      .filter(name => /^[a-f0-9]{20}-(?:1024|256|32)\.meta\.json$/i.test(name))
      .forEach(name => {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(thumbDir, name), 'utf8'));
          const source = path.basename(String(meta.source || ''));
          const filePath = path.join(thumbDir, path.basename(String(meta.file || '')));
          const tier = Number((name.match(/-(1024|256|32)\.meta\.json$/i) || [])[1]) || 0;
          if (!source || !tier || !fs.existsSync(filePath)) return;
          if (!thumbsBySource.has(source)) thumbsBySource.set(source, []);
          thumbsBySource.get(source).push({
            filePath,
            tier,
            width: Math.max(0, Math.round(Number(meta.width) || 0)),
            height: Math.max(0, Math.round(Number(meta.height) || 0))
          });
        } catch (error) {}
      });

    let state = null;
    try {
      const loaded = await loadCanvasState(projectPath);
      if (loaded && loaded.ok) state = loaded.state;
    } catch (error) {}
    const nodes = Array.isArray(state && state.nodes) ? state.nodes : [];
    const candidates = [];
    const seen = new Set();
    const addCandidate = src => {
      const name = path.basename(String(src || ''));
      if (!name || seen.has(name)) return;
      seen.add(name);
      candidates.push(name);
    };
    const addNodeResults = node => {
      if (!node || !Array.isArray(node.results)) return;
      const current = Math.max(0, Math.round(Number(node.cur) || 0));
      addCandidate(node.results[current]);
      node.results.forEach(addCandidate);
    };

    // 优先使用项目真正生成的画面，避免欢迎页误取最新导入的结构图或测试图。
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i] && nodes[i].type === 'variant') addNodeResults(nodes[i]);
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i] || {};
      if (node.type === 'compare') addCandidate(node.genSrc);
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i] || {};
      if (node.type !== 'layout' || !node.layout || !Array.isArray(node.layout.items)) continue;
      node.layout.items.forEach(item => addCandidate(item && item.src));
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i] || {};
      if (node.type === 'image') addCandidate(node.src);
    }

    let preferred = null;
    let preferredSource = '';
    for (const source of candidates) {
      const tiers = thumbsBySource.get(source);
      if (!tiers || !tiers.length) continue;
      const usable = tiers
        .filter(item => item.width === 0 || item.height === 0 || item.width >= 160 || item.height >= 160)
        .sort((a, b) => b.tier - a.tier);
      if (usable.length) {
        preferred = usable[0];
        preferredSource = source;
        break;
      }
    }
    if (!preferred && thumbsBySource.size) {
      const fallback = [];
      thumbsBySource.forEach((tiers, source) => {
        tiers.forEach(item => fallback.push({ ...item, source }));
      });
      fallback.sort((a, b) =>
        (b.width * b.height) - (a.width * a.height) ||
        b.tier - a.tier
      );
      if (fallback.length) {
        preferred = fallback[0];
        preferredSource = fallback[0].source;
      }
    }
    if (preferred) {
      const ext = path.extname(preferred.filePath).slice(1).replace('jpg', 'jpeg');
      return {
        ok: true,
        dataURL: 'data:image/' + ext + ';base64,' + fs.readFileSync(preferred.filePath).toString('base64'),
        width: preferred.width,
        height: preferred.height,
        name: preferredSource,
        cached: true
      };
    }
  } catch (error) {}
  return { ok: false };
});
ipcMain.handle('projects:touch', (_e, { accountId, projectId }) => {
  const list = readJSON(projFile(accountId), []);
  const p = list.find(x => x.id === projectId);
  if (p) { p.lastOpened = Date.now(); writeJSON(projFile(accountId), list); }
});

// ---------- 画布数据（M1） ----------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// 只接受可解码的完整图片；同时兼容部分服务商返回的 WEBP / GIF / AVIF。
function detectImagePayload(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const pngIdx = buf.indexOf(PNG_SIG);
  if (pngIdx >= 0 && buf.indexOf(Buffer.from('IEND'), pngIdx + 8) > pngIdx) {
    return { ext: 'png', start: pngIdx };
  }
  const jpgIdx = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (jpgIdx >= 0) {
    let eoi = -1;
    for (let i = buf.length - 1; i >= Math.max(jpgIdx + 2, buf.length - 65536); i--) {
      if (buf[i] === 0xd9 && buf[i - 1] === 0xff) { eoi = i; break; }
    }
    if (eoi > jpgIdx) return { ext: 'jpg', start: jpgIdx };
  }
  const riffIdx = buf.indexOf(Buffer.from('RIFF'));
  if (riffIdx >= 0 && riffIdx + 12 <= buf.length && buf.toString('ascii', riffIdx + 8, riffIdx + 12) === 'WEBP') {
    const riffSize = buf.readUInt32LE(riffIdx + 4);
    if (riffIdx + 8 + riffSize <= buf.length) return { ext: 'webp', start: riffIdx };
  }
  const gifIdx = buf.indexOf(Buffer.from('GIF8'));
  if (gifIdx >= 0) return { ext: 'gif', start: gifIdx };
  const ftypIdx = buf.indexOf(Buffer.from('ftyp'));
  if (ftypIdx >= 4) {
    const brand = buf.toString('ascii', ftypIdx + 4, ftypIdx + 8);
    if (brand === 'avif' || brand === 'avis') return { ext: 'avif', start: ftypIdx - 4 };
  }
  return null;
}

function imageSizeFromHeader(buf, ext) {
  if (!Buffer.isBuffer(buf) || buf.length < 10) return null;
  try {
    if (ext === 'png' && buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
      if (buf.lastIndexOf(Buffer.from('IEND')) < buf.length - 24) return null;
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (ext === 'gif') {
      if (buf[buf.length - 1] !== 0x3b) return null;
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    if (ext === 'bmp' && buf.length >= 26) {
      return { w: Math.abs(buf.readInt32LE(18)), h: Math.abs(buf.readInt32LE(22)) };
    }
    if ((ext === 'jpg' || ext === 'jpeg') && buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      if (buf.lastIndexOf(Buffer.from([0xff, 0xd9])) < buf.length - 32) return null;
      let offset = 2;
      while (offset + 8 < buf.length) {
        if (buf[offset] !== 0xff) { offset++; continue; }
        while (offset < buf.length && buf[offset] === 0xff) offset++;
        const marker = buf[offset++];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > buf.length) break;
        const length = buf.readUInt16BE(offset);
        if (length < 2 || offset + length > buf.length) break;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          if (offset + 7 > buf.length) break;
          return { w: buf.readUInt16BE(offset + 5), h: buf.readUInt16BE(offset + 3) };
        }
        offset += length;
      }
      return null;
    }
    if (ext === 'webp' && buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF') {
      if (buf.readUInt32LE(4) + 8 > buf.length) return null;
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (kind === 'VP8 ' && buf.length >= 30) return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L' && buf.length >= 25) {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
        const w = 1 + (((b1 & 0x3f) << 8) | b0);
        const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { w, h };
      }
    }
  } catch (error) {}
  return null;
}

function validateImagePayload(buf, detected) {
  const payload = buf.slice(detected.start);
  const headerSize = imageSizeFromHeader(payload, detected.ext);
  if (headerSize) {
    const w = Number(headerSize.w) || 0, h = Number(headerSize.h) || 0;
    if (w > 0 && h > 0 && w <= 30000 && h <= 30000) return { payload, w, h };
    return null;
  }
  // Electron 的解码器与渲染层一致；能解码就顺手带回真实宽高，供 4K/2K 校验。
  try {
    const probe = nativeImage.createFromBuffer(payload);
    if (!probe.isEmpty()) {
      const size = probe.getSize();
      return { payload, w: size.width || 0, h: size.height || 0 };
    }
  } catch (e) {}
  if (detected.ext === 'png' || detected.ext === 'jpg') return null;
  return { payload, w: 0, h: 0 };
}

function decodeBase64Image(b64) {
  let s = String(b64 || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

ipcMain.handle('img:write', async (_e, { projectPath, dataURL }) => {
  try {
    // #125 支持外部URL下载（服务商返回图片链接而非base64）
    if (typeof dataURL === 'string' && dataURL.startsWith('http')) {
      console.log('img:write 收到URL，开始下载:', dataURL.slice(0, 60) + '...');
      const resp = await fetch(dataURL);
      if (!resp.ok) return { ok: false, msg: '下载图片失败：' + resp.status + ' ' + dataURL.slice(0, 60) };
      const buf = Buffer.from(await resp.arrayBuffer());
      const detected = detectImagePayload(buf);
      if (!detected) {
        const preview = buf.slice(0, 80).toString('utf-8').replace(/\s+/g, ' ').slice(0, 60);
        console.error('img:write URL下载后图片校验失败，内容预览:', preview);
        return { ok: false, msg: '下载的图片不完整或格式不支持，请重试' };
      }
      const name = 'content-' + crypto.randomUUID() + '.' + detected.ext;
      const dir = path.join(projectPath, 'Content');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // #139 截取从魔数开始的干净数据，并做一次真实解码校验
      const checked = validateImagePayload(buf, detected);
      if (!checked) return { ok: false, msg: '图片无法解码，可能没有保存完整，请重试' };
      fs.writeFileSync(path.join(dir, name), checked.payload);
      console.log('img:write URL下载成功:', name, buf.length, 'bytes');
      return { ok: true, name, w: checked.w, h: checked.h };
    }

    const m = /^data:image\/(png|jpe?g|webp|gif|avif);base64,(.+)$/.exec(dataURL || '');
    if (!m) return { ok: false, msg: '图片格式不支持（前缀 ' + String(dataURL || '').slice(0, 40) + '）' };
    // #133 图片完整性与格式校验（服务商可能有少量包装前缀）
    const buf = decodeBase64Image(m[2]);
    const detected = detectImagePayload(buf);
    if (!detected) {
      const preview = buf.slice(0, 40).toString('utf-8').replace(/\s+/g, ' ').slice(0, 60);
      console.error('img:write 图片校验失败，内容预览:', preview);
      return { ok: false, msg: '生成结果不完整或格式不支持（' + buf.length + ' 字节，内容：' + preview + '）' };
    }
    const name = 'content-' + crypto.randomUUID() + '.' + detected.ext;
    const dir = path.join(projectPath, 'Content');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });  // #122 目录自动建
    // #139 截取从魔数开始的干净数据，并做一次真实解码校验
    const checked = validateImagePayload(buf, detected);
    if (!checked) return { ok: false, msg: '图片无法解码，可能没有保存完整（格式 ' + detected.ext + '，' + buf.length + ' 字节）' };
    fs.writeFileSync(path.join(dir, name), checked.payload);
    console.log('img:write base64保存成功:', name);
    return { ok: true, name, w: checked.w, h: checked.h };
  } catch (e) {
    console.error('img:write error:', e);
    return { ok: false, msg: '保存失败：' + e.message + '（请检查项目目录权限）' };  // #122 有声失败
  }
});
ipcMain.handle('img:list', (_e, { projectPath }) => {
  try {
    const dir = path.join(projectPath, 'Content');
    if (!fs.existsSync(dir)) return { names: [] };
    return { names: fs.readdirSync(dir).filter(n => n.startsWith('content-')) };
  } catch (e) { return { names: [] }; }
});
function decodeHtmlValue(value) {
  return String(value || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

function productMetadataFromHtml(html, url) {
  const text = String(html || '');
  const meta = {};
  text.replace(/<meta\b[^>]*>/gi, tag => {
    const key = (tag.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent=["']([^"']*)["']/i) || [])[1];
    if (key && content && meta[key.toLowerCase()] == null) meta[key.toLowerCase()] = decodeHtmlValue(content);
    return tag;
  });
  let title = meta['og:title'] || meta['twitter:title'] || (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let price = meta['product:price:amount'] || meta['og:price:amount'] || meta['price'] || '';
  let brand = meta['product:brand'] || meta['og:brand'] || '';
  let image = meta['og:image'] || meta['twitter:image'] || '';
  const scripts = [...text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(decodeHtmlValue(script[1]));
      const queue = Array.isArray(parsed) ? parsed.slice() : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
        const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : String(node['@type'] || '');
        if (/product/i.test(type)) {
          if (!title && node.name) title = node.name;
          if (!brand && node.brand) brand = typeof node.brand === 'string' ? node.brand : (node.brand.name || '');
          if (!image && node.image) image = Array.isArray(node.image) ? node.image[0] : (typeof node.image === 'string' ? node.image : node.image.url || '');
          const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          if (!price && offers) price = offers.price || offers.lowPrice || (offers.priceSpecification && offers.priceSpecification.price) || '';
        }
        Object.values(node).forEach(child => {
          if (child && typeof child === 'object') queue.push(child);
        });
      }
      if (title && price) break;
    } catch (error) {}
  }
  const numericPrice = Number(String(price).replace(/[^\d.]/g, ''));
  return {
    title: decodeHtmlValue(title),
    brand: decodeHtmlValue(brand),
    image: image ? new URL(image, url).href : '',
    price: Number.isFinite(numericPrice) ? numericPrice : 0
  };
}

ipcMain.handle('product:fetchMeta', async (_e, { url } = {}) => {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch (_) { return { ok: false, msg: '商品链接格式不正确' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, msg: '只支持 http/https 商品链接' };
  try {
    const response = await net.fetch(parsed.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7'
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return { ok: false, msg: '商品页返回 HTTP ' + response.status };
    const meta = productMetadataFromHtml((await response.text()).slice(0, 2500000), parsed.href);
    if (!meta.title && !meta.price && !meta.brand) return { ok: false, msg: '商品页没有提供可读取的标题或价格' };
    return { ok: true, link: parsed.href, ...meta };
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});

ipcMain.handle('product:saveImage', async (_e, { projectPath, url } = {}) => {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch (_) { return { ok: false, msg: '商品图片地址不正确' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, msg: '商品图片地址不支持' };
  try {
    const response = await net.fetch(parsed.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        Referer: 'https://item.taobao.com/'
      },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) return { ok: false, msg: '商品图片返回 HTTP ' + response.status };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) return { ok: false, msg: '商品图片大小异常' };
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const ext = /jpeg|jpg/.test(contentType) ? 'jpg' : /webp/.test(contentType) ? 'webp' : /gif/.test(contentType) ? 'gif' : 'png';
    const name = 'content-taobao-' + crypto.randomUUID() + '.' + ext;
    const contentDir = path.join(projectPath, 'Content');
    await fs.promises.mkdir(contentDir, { recursive: true });
    await fs.promises.writeFile(path.join(contentDir, name), bytes);
    let thumb = '';
    let width = 0;
    let height = 0;
    try {
      const image = nativeImage.createFromBuffer(bytes);
      if (!image.isEmpty()) {
        const size = image.getSize();
        width = size.width || 0;
        height = size.height || 0;
        thumb = image.resize({ width: 96 }).toDataURL();
      }
    } catch (error) {}
    return { ok: true, name, thumb, width, height };
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});

function isTaobaoProductUrl(url) {
  return /^https?:\/\/(?:item\.taobao\.com|detail\.tmall\.com|detail\.tmall\.hk|chaoshi\.detail\.tmall\.com)\//i.test(String(url || ''));
}

async function taobaoProductFromWindow(searchWindow, url) {
  let pageMeta = {};
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1200 : 700));
      if (searchWindow.isDestroyed()) break;
      pageMeta = await searchWindow.webContents.executeJavaScript(`(() => {
        const textOf = el => String(el && (el.innerText || el.textContent) || '').trim();
        const firstText = selectors => {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            const value = textOf(el);
            if (value) return value;
          }
          return '';
        };
        const priceText = firstText([
          '.tm-price', '.tm-promo-price', '[class*="mainPrice"]', '[class*="priceText"]',
          '[class*="price-value"]', '[class*="Price--"]', '[class*="price"]', '[class*="Price"]'
        ]);
        const match = priceText.replace(/,/g, '').match(/(?:¥|￥)?\\s*(\\d+(?:\\.\\d{1,2})?)/);
        return {
          title: document.querySelector('h1') ? textOf(document.querySelector('h1')) : document.title,
          brand: firstText(['[class*="brandName"]', '[class*="brand-name"]', '[class*="shopName"]', '[class*="brand"]']),
          image: (document.querySelector('#J_ImgBooth') || document.querySelector('[class*="mainPic"] img') || document.querySelector('[class*="MainImage"] img') || {}).src || '',
          price: match ? Number(match[1]) : 0
        };
      })()`);
      if (pageMeta && (pageMeta.price > 0 || pageMeta.title || pageMeta.brand)) break;
    }
  } catch (error) {}
  try {
    const html = await searchWindow.webContents.executeJavaScript('document.documentElement.outerHTML');
    const meta = productMetadataFromHtml(html, url);
    return {
      link: url,
      title: pageMeta.title || meta.title,
      brand: meta.brand || pageMeta.brand,
      image: meta.image || pageMeta.image || '',
      price: Number(meta.price) > 0 ? Number(meta.price) : Number(pageMeta.price) || 0
    };
  } catch (error) {
    return { link: url, title: pageMeta.title || '', brand: pageMeta.brand || '', image: pageMeta.image || '', price: Number(pageMeta.price) || 0 };
  }
}

ipcMain.handle('taobao:imageSearch', async (event, { dataURL, keyword } = {}) => {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataURL || ''));
  if (!match) return { ok: false, msg: '缺少可上传的软装裁图' };
  const requestId = crypto.randomUUID();
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const tempPath = path.join(app.getPath('temp'), 'giwin-taobao-' + requestId + '.' + ext);
  try {
    await fs.promises.writeFile(tempPath, Buffer.from(match[2], 'base64'));
  } catch (error) {
    return { ok: false, msg: '无法准备上传图片：' + error.message };
  }
  const searchWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: '淘宝以图搜图 · 选中商品后自动回填',
    webPreferences: {
      partition: TAOBAO_PARTITION,
      contextIsolation: true,
      sandbox: true
    }
  });
  taobaoSearchRequests.set(requestId, { window: searchWindow, tempPath, sender: event.sender });
  const finish = async url => {
    if (!isTaobaoProductUrl(url)) return false;
    const request = taobaoSearchRequests.get(requestId);
    if (!request) return true;
    taobaoSearchRequests.delete(requestId);
    const product = await taobaoProductFromWindow(searchWindow, url);
    try {
      if (!request.sender.isDestroyed()) request.sender.send('taobao:searchResult', { requestId, ok: true, product });
    } catch (error) {}
    try { searchWindow.close(); } catch (error) {}
    try { fs.unlinkSync(tempPath); } catch (error) {}
    return true;
  };
  searchWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTaobaoProductUrl(url)) {
      searchWindow.loadURL(url).catch(() => {});
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  searchWindow.webContents.on('did-navigate', (_event, url) => finish(url));
  searchWindow.webContents.on('did-navigate-in-page', (_event, url) => finish(url));
  searchWindow.on('closed', () => {
    flushTaobaoLogin();
    const request = taobaoSearchRequests.get(requestId);
    if (!request) return;
    taobaoSearchRequests.delete(requestId);
    try {
      if (!request.sender.isDestroyed()) request.sender.send('taobao:searchResult', { requestId, ok: false, msg: '已关闭淘宝搜索窗口' });
    } catch (error) {}
    try { fs.unlinkSync(tempPath); } catch (error) {}
  });
  searchWindow.loadURL('https://s.taobao.com/search?q=' + encodeURIComponent(keyword || '')).catch(() => {});
  const injectImage = async () => {
    if (searchWindow.isDestroyed()) return;
    try {
      await new Promise(resolve => setTimeout(resolve, 2200));
      if (!searchWindow.webContents.debugger.isAttached()) searchWindow.webContents.debugger.attach('1.3');
      const documentNode = await searchWindow.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1 });
      const inputNode = await searchWindow.webContents.debugger.sendCommand('DOM.querySelector', {
        nodeId: documentNode.root.nodeId,
        selector: '#image-search-custom-file-input,input[type=file]'
      });
      if (inputNode.nodeId) {
        await searchWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
          nodeId: inputNode.nodeId,
          files: [tempPath]
        });
        await searchWindow.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('#image-search-custom-file-input,input[type=file]');
          if (input) input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
      }
      const camera = await searchWindow.webContents.executeJavaScript(`(() => {
        const el = [...document.querySelectorAll('[class*="camera"],[aria-label*="图片"],[title*="图片"],[class*="imgSearch"],[class*="imageSearch"]')][0];
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!inputNode.nodeId && camera) await new Promise(resolve => setTimeout(resolve, 800));
      searchWindow.webContents.debugger.detach();
    } catch (error) {
      try { searchWindow.webContents.debugger.detach(); } catch (_) {}
    }
  };
  searchWindow.webContents.once('did-finish-load', injectImage);
  return { ok: true, requestId };
});

ipcMain.handle('img:delete', (_e, { projectPath, name }) => {
  try {
    const fp = path.join(projectPath, 'Content', name);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return { ok: true };
  } catch (e) { return { ok: false, msg: e.message }; }
});
ipcMain.handle('img:read', (_e, { projectPath, name }) => {
  try {
    const p = path.join(projectPath, 'Content', name);
    const ext = path.extname(name).slice(1).replace('jpg', 'jpeg');
    return { ok: true, dataURL: 'data:image/' + ext + ';base64,' + fs.readFileSync(p).toString('base64') };
  } catch (e) { return { ok: false }; }
});
ipcMain.handle('img:copy', (_e, { sourceProjectPath, sourceName, targetProjectPath } = {}) => {
  try {
    const safeName = path.basename(String(sourceName || ''));
    if (!safeName || safeName !== sourceName || !sourceProjectPath || !targetProjectPath) {
      return { ok: false, msg: '图片复制参数无效' };
    }
    const sourcePath = path.join(sourceProjectPath, 'Content', safeName);
    if (!fs.existsSync(sourcePath)) return { ok: false, msg: '源项目图片不存在' };
    const targetDir = path.join(targetProjectPath, 'Content');
    fs.mkdirSync(targetDir, { recursive: true });
    const ext = path.extname(safeName);
    const targetName = 'content-' + crypto.randomUUID() + ext;
    fs.copyFileSync(sourcePath, path.join(targetDir, targetName));
    return { ok: true, name: targetName };
  } catch (error) {
    return { ok: false, msg: '复制项目图片失败：' + error.message };
  }
});
function thumbCacheInfo(projectPath, name, edge) {
  const safe = path.basename(String(name || ''));
  if (!projectPath || safe !== name) return null;
  const sourcePath = path.join(projectPath, 'Content', safe);
  const stat = fs.statSync(sourcePath);
  const requested = Math.max(1, Math.round(Number(edge) || 256));
  const size = requested <= 64 ? 32 : (requested <= 256 ? 256 : 1024);
  const fingerprint = crypto.createHash('sha1')
    .update(safe + '\0' + stat.size + '\0' + Math.round(stat.mtimeMs))
    .digest('hex')
    .slice(0, 20);
  return {
    base: path.join(projectPath, 'cache', 'thumbs', fingerprint + '-' + size),
    size,
    fingerprint
  };
}
function buildThumbIndex(projectPath) {
  const index = {};
  const thumbDir = path.join(projectPath, 'cache', 'thumbs');
  const contentDir = path.join(projectPath, 'Content');
  const dirToken = dir => {
    try {
      const stat = fs.statSync(dir);
      return Math.round(stat.mtimeMs) + ':' + stat.size;
    } catch (error) {
      return '0:0';
    }
  };
  const signature = dirToken(contentDir) + '|' + dirToken(thumbDir);
  const cached = thumbIndexCache.get(canvasKey(projectPath));
  if (cached && cached.signature === signature) return cached.index;
  let contentNames = [];
  let thumbNames = [];
  try { contentNames = fs.readdirSync(contentDir); } catch (error) { return index; }
  try { thumbNames = fs.readdirSync(thumbDir); } catch (error) { return index; }
  const fingerprints = new Map();
  contentNames
    .filter(name => /\.(?:png|jpe?g|webp|gif|avif)$/i.test(name))
    .forEach(name => {
      try {
        const stat = fs.statSync(path.join(contentDir, name));
        const fingerprint = crypto.createHash('sha1')
          .update(name + '\0' + stat.size + '\0' + Math.round(stat.mtimeMs))
          .digest('hex')
          .slice(0, 20);
        fingerprints.set(fingerprint, name);
      } catch (error) {}
    });
  const thumbFiles = new Map();
  thumbNames.forEach(name => {
    const matched = name.match(/^([a-f0-9]{20})-(32|256|512|768|1024)\.(png|jpe?g|webp|gif|avif)$/i);
    if (matched) thumbFiles.set(matched[1] + '-' + matched[2], name);
  });
  thumbNames
    .filter(name => /^[a-f0-9]{20}-(?:32|256|512|768|1024)\.meta\.json$/i.test(name))
    .forEach(name => {
      try {
        const matched = name.match(/^([a-f0-9]{20})-(32|256|512|768|1024)\.meta\.json$/i);
        const source = matched && fingerprints.get(matched[1]);
        if (!source || !matched) return;
        const imageName = thumbFiles.get(matched[1] + '-' + matched[2]);
        if (!imageName) return;
        const imageFile = path.join(thumbDir, imageName);
        const tier = Number(matched[2]);
        const ext = path.extname(imageName).slice(1).replace('jpg', 'jpeg');
        if (!index[source]) index[source] = {};
        index[source][tier] = {
          ok: true,
          url: pathToFileURL(imageFile).href,
          dataURL: tier === 32
            ? 'data:image/' + ext + ';base64,' + fs.readFileSync(imageFile).toString('base64')
            : undefined,
          width: 0,
          height: 0
        };
      } catch (error) {}
    });
  thumbNames
    .filter(name => /^[a-f0-9]{20}-(?:32|256|512|768|1024)\.json$/i.test(name))
    .forEach(name => {
      try {
        const matched = name.match(/^([a-f0-9]{20})-(32|256|512|768|1024)\.json$/i);
        const source = matched && fingerprints.get(matched[1]);
        if (!matched || !source) return;
        const cached = JSON.parse(fs.readFileSync(path.join(thumbDir, name), 'utf8'));
        const dataMatch = typeof cached.dataURL === 'string'
          ? /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(cached.dataURL)
          : null;
        if (!dataMatch) return;
        const tier = Number(matched[2]);
        const ext = dataMatch[1].toLowerCase().replace('jpeg', 'jpg');
        const base = path.join(thumbDir, matched[1] + '-' + tier);
        const imageFile = base + '.' + ext;
        const metaFile = base + '.meta.json';
        fs.writeFileSync(imageFile, Buffer.from(dataMatch[2], 'base64'));
        fs.writeFileSync(metaFile, JSON.stringify({
          source,
          file: path.basename(imageFile),
          width: Math.max(0, Math.round(Number(cached.width) || 0)),
          height: Math.max(0, Math.round(Number(cached.height) || 0)),
          edge: tier,
          updatedAt: Date.now()
        }));
        fs.unlinkSync(path.join(thumbDir, name));
        if (!index[source]) index[source] = {};
        index[source][tier] = {
          ok: true,
          url: pathToFileURL(imageFile).href,
          dataURL: tier === 32 ? cached.dataURL : undefined,
          width: Math.max(0, Math.round(Number(cached.width) || 0)),
          height: Math.max(0, Math.round(Number(cached.height) || 0))
        };
      } catch (error) {}
    });
  Object.values(index).forEach(tiers => {
    if (!tiers[512] && tiers[1024]) tiers[512] = tiers[1024];
    if (!tiers[768] && tiers[1024]) tiers[768] = tiers[1024];
  });
  thumbIndexCache.set(canvasKey(projectPath), { signature, index });
  return index;
}
ipcMain.handle('img:thumbRead', (_e, { projectPath, name, edge }) => {
  try {
    const info = thumbCacheInfo(projectPath, name, edge);
    if (!info) return { ok: false };
    const metaFile = info.base + '.meta.json';
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const imageFile = meta && meta.file ? path.join(path.dirname(info.base), path.basename(meta.file)) : '';
      if (imageFile && fs.existsSync(imageFile)) {
        const ext = path.extname(imageFile).slice(1).replace('jpg', 'jpeg');
        return {
          ok: true,
          url: pathToFileURL(imageFile).href,
          mime: 'image/' + ext,
          width: meta.width,
          height: meta.height
        };
      }
    }
    const legacyFile = info.base + '.json';
    if (fs.existsSync(legacyFile)) {
      const cached = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      if (cached && typeof cached.dataURL === 'string' && cached.dataURL.startsWith('data:image/')) {
        return { ok: true, dataURL: cached.dataURL, width: cached.width, height: cached.height };
      }
    }
    return { ok: false };
  } catch (error) {
    return { ok: false };
  }
});
ipcMain.handle('img:thumbWrite', (_e, { projectPath, name, edge, payload } = {}) => {
  try {
    const dataURL = payload && payload.dataURL;
    const match = typeof dataURL === 'string'
      ? /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataURL)
      : null;
    if (!match) {
      return { ok: false };
    }
    const info = thumbCacheInfo(projectPath, name, edge);
    if (!info) return { ok: false };
    fs.mkdirSync(path.dirname(info.base), { recursive: true });
    const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
    const imageFile = info.base + '.' + ext;
    const metaFile = info.base + '.meta.json';
    const imageTemp = imageFile + '.' + process.pid + '.tmp';
    const metaTemp = metaFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(imageTemp, Buffer.from(match[2], 'base64'));
    fs.writeFileSync(metaTemp, JSON.stringify({
      source: name,
      file: path.basename(imageFile),
      width: Math.max(0, Math.round(Number(payload.width) || 0)),
      height: Math.max(0, Math.round(Number(payload.height) || 0)),
      edge: info.size,
      updatedAt: Date.now()
    }));
    fs.renameSync(imageTemp, imageFile);
    fs.renameSync(metaTemp, metaFile);
    for (const oldExt of ['png', 'jpg', 'jpeg', 'webp']) {
      if (oldExt === ext) continue;
      const stale = info.base + '.' + oldExt;
      if (fs.existsSync(stale)) {
        try { fs.unlinkSync(stale); } catch (error) {}
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('asset:saveImage', async (_e, { dataURL, label } = {}) => {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataURL || ''));
  if (!match) return { ok: false, msg: '缺少可保存的图片数据' };
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const name = 'asset-' + crypto.randomUUID() + '.' + ext;
  const dir = file('asset-library', 'images');
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const bytes = Buffer.from(match[2], 'base64');
    await fs.promises.writeFile(path.join(dir, name), bytes);
    let thumb = '';
    let width = 0;
    let height = 0;
    try {
      const image = nativeImage.createFromBuffer(bytes);
      if (!image.isEmpty()) {
        const size = image.getSize();
        width = size.width || 0;
        height = size.height || 0;
        thumb = image.resize({ width: 360 }).toDataURL();
      }
    } catch (error) {}
    return { ok: true, name, thumb, width, height, label: String(label || '图片素材') };
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('asset:readImage', async (_e, name) => {
  const safe = path.basename(String(name || ''));
  if (!/^asset-[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(safe)) return { ok: false, msg: '资产图片名称无效' };
  try {
    const ext = path.extname(safe).slice(1).replace('jpg', 'jpeg');
    const data = await fs.promises.readFile(path.join(file('asset-library', 'images'), safe));
    return { ok: true, dataURL: 'data:image/' + ext + ';base64,' + data.toString('base64') };
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('asset:deleteImage', async (_e, name) => {
  const safe = path.basename(String(name || ''));
  if (!/^asset-[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(safe)) return { ok: false };
  try {
    await fs.promises.unlink(path.join(file('asset-library', 'images'), safe));
    return { ok: true };
  } catch (error) {
    return { ok: false };
  }
});
ipcMain.handle('canvas:save', (_e, { projectPath, state }) => withCanvasLock(canvasKey(projectPath), async () => {
  const paths = canvasFilePaths(projectPath);
  const bytes = await writeJSONAtomic(paths.base, state);
  await clearCanvasJournal(projectPath);
  canvasCache.set(canvasKey(projectPath), {
    state,
    journalOps: 0,
    journalBytes: 0,
    needsFull: false,
    fingerprint: await canvasStateFingerprint(projectPath),
    lastSaveAt: Date.now()
  });
  await maybeAutoVersion(projectPath, state);
  return { ok: true, mode: 'full', bytes, path: paths.base };
}));
ipcMain.handle('canvas:load', async (_e, projectPath) => {
  const result = await loadCanvasState(projectPath);
  if (result && result.ok) result.thumbIndex = buildThumbIndex(projectPath);
  return result;
});
ipcMain.handle('canvas:apiVersion', () => 2);
ipcMain.handle('canvas:saveDiff', (_e, { projectPath, fullState, diff }) => withCanvasLock(canvasKey(projectPath), async () => {
  const paths = canvasFilePaths(projectPath);
  if (fullState) {
    const bytes = await writeJSONAtomic(paths.base, fullState);
    await clearCanvasJournal(projectPath);
    canvasCache.set(canvasKey(projectPath), {
      state: fullState,
      journalOps: 0,
      journalBytes: 0,
      needsFull: false,
      fingerprint: await canvasStateFingerprint(projectPath),
      lastSaveAt: Date.now()
    });
    await maybeAutoVersion(projectPath, fullState);
    return { ok: true, mode: 'full', bytes };
  }
  let cached = canvasCache.get(canvasKey(projectPath));
  if (!cached) {
    const loaded = await loadCanvasState(projectPath);
    cached = canvasCache.get(canvasKey(projectPath));
  }
  if (!cached || !validCanvasState(cached.state)) {
    return { ok: false, msg: '缺少可用的基础存档，请执行完整保存' };
  }
  const state = applyCanvasDiff(structuredClone(cached.state), diff || {});
  const line = JSON.stringify(diff || {}) + '\n';
  const lineBytes = Buffer.byteLength(line);
  const shouldCompact = cached.needsFull ||
    cached.journalOps >= 100 ||
    cached.journalBytes + lineBytes > 1536 * 1024 ||
    lineBytes > 128 * 1024;
  if (shouldCompact) {
    const bytes = await writeJSONAtomic(paths.base, state);
    await clearCanvasJournal(projectPath);
    canvasCache.set(canvasKey(projectPath), {
      state,
      journalOps: 0,
      journalBytes: 0,
      needsFull: false,
      fingerprint: await canvasStateFingerprint(projectPath),
      lastSaveAt: Date.now()
    });
    await maybeAutoVersion(projectPath, state);
    return { ok: true, mode: 'compact', bytes, journalOps: 0 };
  }
  await fs.promises.mkdir(path.dirname(paths.journal), { recursive: true });
  const handle = await fs.promises.open(paths.journal, 'a');
  try {
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  const next = {
    state,
    journalOps: cached.journalOps + 1,
    journalBytes: cached.journalBytes + lineBytes,
    needsFull: false,
    fingerprint: await canvasStateFingerprint(projectPath),
    lastSaveAt: Date.now()
  };
  canvasCache.set(canvasKey(projectPath), next);
  await maybeAutoVersion(projectPath, state);
  return { ok: true, mode: 'diff', bytes: lineBytes, journalOps: next.journalOps };
}));
async function compactCanvas(projectPath, force) {
  return withCanvasLock(canvasKey(projectPath), async () => {
    const cached = canvasCache.get(canvasKey(projectPath));
    if (!cached) return { ok: false, reason: 'no-cache' };
    if (!validCanvasState(cached.state)) return { ok: false, reason: 'invalid-state' };
    if (!cached.journalOps) return { ok: false, reason: 'no-journal', journalOps: 0 };
    if (!force && Date.now() - (cached.lastSaveAt || 0) < 30000) return { ok: false, reason: 'not-idle', journalOps: cached.journalOps };
    const paths = canvasFilePaths(projectPath);
    await writeJSONAtomic(paths.base, cached.state);
    await clearCanvasJournal(projectPath);
    cached.journalOps = 0;
    cached.journalBytes = 0;
    cached.fingerprint = await canvasStateFingerprint(projectPath);
    cached.lastSaveAt = Date.now();
    await maybeAutoVersion(projectPath, cached.state);
    return { ok: true, compacted: true, journalOps: 0 };
  });
}
async function compactIdleCanvas(projectPath) {
  return compactCanvas(projectPath, false);
}
ipcMain.handle('canvas:compactNow', (_e, projectPath) => compactCanvas(projectPath, true));
async function ensureCanvasCache(projectPath) {
  const key = canvasKey(projectPath);
  let cached = canvasCache.get(key);
  if (!cached) {
    await loadCanvasState(projectPath);
    cached = canvasCache.get(key);
  }
  return cached;
}
ipcMain.handle('canvas:createVersion', (_e, { projectPath, label }) => withCanvasLock(canvasKey(projectPath), async () => {
  const cached = await ensureCanvasCache(projectPath);
  if (!cached || !validCanvasState(cached.state)) return { ok: false, msg: '当前项目还没有可保存的画布' };
  const meta = await createCanvasVersion(projectPath, cached.state, label, 'manual');
  return { ok: true, meta };
}));
ipcMain.handle('canvas:listVersions', (_e, projectPath) => listCanvasVersions(projectPath));
ipcMain.handle('canvas:restoreVersion', (_e, { projectPath, id }) => withCanvasLock(canvasKey(projectPath), async () => {
  if (!/^\d+-[a-z0-9]+$/i.test(String(id || ''))) return { ok: false, msg: '版本编号无效' };
  const record = readJSON(path.join(versionsDir(projectPath), id + '.json'), null);
  if (!record || !validCanvasState(record.state)) return { ok: false, msg: '版本文件无效或已损坏' };
  const cached = await ensureCanvasCache(projectPath);
  if (cached && validCanvasState(cached.state)) {
    try { await createCanvasVersion(projectPath, cached.state, '恢复前自动备份', 'restore'); } catch (error) {}
  }
  const paths = canvasFilePaths(projectPath);
  await clearCanvasJournal(projectPath);
  const bytes = await writeJSONAtomic(paths.base, record.state);
  canvasCache.set(canvasKey(projectPath), {
    state: record.state,
    journalOps: 0,
    journalBytes: 0,
    needsFull: false,
    lastSaveAt: Date.now()
  });
  return {
    ok: true,
    state: record.state,
    bytes,
    meta: { id: record.id, label: record.label, createdAt: record.createdAt, stats: record.stats }
  };
}));
let canvasMaintenanceTimer = null;
function startCanvasMaintenance() {
  if (canvasMaintenanceTimer) return;
  canvasMaintenanceTimer = setInterval(() => {
    for (const projectPath of canvasCache.keys()) {
      compactIdleCanvas(projectPath).catch(error => console.warn('[canvas] idle compact failed', error.message));
    }
  }, 60000);
  if (canvasMaintenanceTimer.unref) canvasMaintenanceTimer.unref();
}
ipcMain.handle('dialog:importImages', async () => {
  const r = await dialog.showOpenDialog(win, { title: '导入图片', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (r.canceled) return [];
  return r.filePaths.map(p => {
    const ext = path.extname(p).slice(1).replace('jpg', 'jpeg');
    return { name: path.basename(p), dataURL: 'data:image/' + ext + ';base64,' + fs.readFileSync(p).toString('base64') };
  });
});

ipcMain.handle('export:png', async (_e, dataURL) => {
  const isJpg = (dataURL || '').indexOf('image/jpeg') === 0;
  const ext = isJpg ? 'jpg' : 'png';
  const r = await dialog.showSaveDialog(win, { title: '导出图片', defaultPath: '极物导出.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, Buffer.from(dataURL.split(',')[1], 'base64'));
  return r.filePath;
});
ipcMain.handle('capture:pageRegion', async (event, payload = {}) => {
  const source = event.sender;
  const win = BrowserWindow.fromWebContents(source);
  if (!win || win.isDestroyed()) return { ok: false, msg: '窗口不可用' };
  const [contentWidth, contentHeight] = win.getContentSize();
  const raw = payload && payload.rect || {};
  const x = Math.max(0, Math.min(contentWidth - 1, Math.round(Number(raw.x) || 0)));
  const y = Math.max(0, Math.min(contentHeight - 1, Math.round(Number(raw.y) || 0)));
  const width = Math.max(1, Math.min(contentWidth - x, Math.round(Number(raw.width) || contentWidth)));
  const height = Math.max(1, Math.min(contentHeight - y, Math.round(Number(raw.height) || contentHeight)));
  try {
    const image = await source.capturePage({ x, y, width, height });
    if (!image || image.isEmpty()) return { ok: false, msg: '截图为空' };
    return { ok: true, dataURL: image.toDataURL() };
  } catch (error) {
    return { ok: false, msg: error.message || String(error) };
  }
});
ipcMain.handle('export:web', async (_e, { html, title } = {}) => {
  if (typeof html !== 'string' || html.length < 200) throw new Error('没有可导出的网页内容');
  const safeTitle = String(title || '室内设计方案').replace(/[\\/:*?"<>|]/g, '-');
  const result = await dialog.showSaveDialog(win, {
    title: '导出网页版方案',
    defaultPath: safeTitle + '-网页版.html',
    filters: [{ name: '网页', extensions: ['html'] }]
  });
  if (result.canceled) return null;
  await fs.promises.writeFile(result.filePath, html, 'utf8');
  return result.filePath;
});
ipcMain.handle('export:pdf', async (_e, payload) => {
  const pages = Array.isArray(payload && payload.pages)
    ? payload.pages.filter(page => typeof page === 'string' && /^data:image\/(png|jpeg);base64,/.test(page))
    : [];
  if (!pages.length) throw new Error('没有可导出的方案页');
  const width = Math.max(320, Number(payload.width) || 1600);
  const height = Math.max(320, Number(payload.height) || 900);
  const aspect = payload.aspect === 'A4' ? 'A4' : '16:9';
  const paper = aspect === 'A4'
    ? { css: '210mm 297mm', microns: { width: 210000, height: 297000 } }
    : { css: '338.67mm 190.5mm', microns: { width: 338667, height: 190500 } };
  const title = String(payload.title || '室内设计方案').replace(/[\\/:*?"<>|]/g, '-');
  const result = await dialog.showSaveDialog(win, {
    title: '导出方案册 PDF',
    defaultPath: title + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled) return null;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${paper.css}; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .page { width: ${paper.css.split(' ')[0]}; height: ${paper.css.split(' ')[1]}; page-break-after: always; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    img { display: block; width: 100%; height: 100%; object-fit: fill; }
  </style></head><body>${pages.map(src => `<div class="page"><img src="${src}"></div>`).join('')}</body></html>`;
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  });
  try {
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await printWindow.webContents.executeJavaScript('Promise.all(Array.from(document.images).map(img => img.decode().catch(() => null)))');
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: paper.microns,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    fs.writeFileSync(result.filePath, pdf);
    return result.filePath;
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
});

ipcMain.handle('account:get', (_e, id) => {
  const a = readJSON(file('accounts.json'), []).find(x => x.id === id);
  return a ? { avatar: a.avatar || null, name: a.name, email: a.email } : null;
});
ipcMain.handle('account:setAvatar', (_e, { accountId, dataURL }) => {
  const access = licenseStatus();
  const edition = String(access && access.license && access.license.edition || '').toLowerCase();
  const devTeam = devEntitlementsEnabled && devEntitlementMode === 'team';
  const entitled = devTeam || !!(access && access.valid && (access.development || /pro|professional|premium|team|enterprise|studio/.test(edition)));
  if (!entitled) return false;
  const accounts = readJSON(file('accounts.json'), []);
  const a = accounts.find(x => x.id === accountId);
  if (a) { a.avatar = dataURL; writeJSON(file('accounts.json'), accounts); return true; }
  return false;
});

// M2 代理设置：系统代理 / 自定义 / 直连
ipcMain.handle('proxy:set', async (_e, { mode, custom }) => {
  try {
    const rules = mode === 'custom' ? (custom || '') : (mode === 'direct' ? 'direct://' : '');
    await win.webContents.session.setProxy({ proxyRules: rules });
    return { ok: true, rules: rules || '(系统默认)' };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  let taobaoQuitFlushStarted = false;
  let taobaoQuitFlushFinished = false;
  const finishRuntimeHealth = () => {
    try {
      const currentHealth = readJSON(runtimeHealthPath, {}) || {};
      const retainedGpuFailureCount = safeRenderMode
        ? 0
        : Math.max(0, Number(currentHealth.gpuFailureCount) || 0);
      writeJSON(runtimeHealthPath, {
        startedAt: currentRunStartedAt,
        endedAt: Date.now(),
        cleanExit: true,
        uncleanStarts: 0,
        gpuFailureCount: retainedGpuFailureCount,
        lastGpuFailureAt: 0,
        lastGpuFailureReason: '',
        safeRenderMode,
        electron: process.versions.electron
      });
    } catch (error) {}
  };
  app.on('before-quit', event => {
    if (taobaoQuitFlushFinished) {
      finishRuntimeHealth();
      return;
    }
    // Keep the Taobao login cookies on disk even when the app is closed
    // immediately after the search window. Chromium's cookie flush is async.
    event.preventDefault();
    if (taobaoQuitFlushStarted) return;
    taobaoQuitFlushStarted = true;
    flushTaobaoLogin().finally(() => {
      taobaoQuitFlushFinished = true;
      finishRuntimeHealth();
      app.quit();
    });
  });
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(() => {
    createWindow();
    startCanvasMaintenance();
    startUpdateService();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
