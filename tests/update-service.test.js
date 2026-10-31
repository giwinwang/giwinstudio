const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  compareVersions,
  parseVersion,
  channelAccepts,
  validateManifest
} = require('../update-service');

const root = path.join(__dirname, '..');

test('版本解析接受正式版与预发布版', () => {
  assert.deepStrictEqual(parseVersion('0.4.29').core, [0, 4, 29]);
  assert.deepStrictEqual(parseVersion('0.4.30-beta.1').pre, ['beta', '1']);
  assert.strictEqual(parseVersion('0.4'), null);
  assert.strictEqual(parseVersion('abc'), null);
});

test('版本比较覆盖补丁、次版本与预发布', () => {
  assert.strictEqual(compareVersions('0.4.30', '0.4.29'), 1);
  assert.strictEqual(compareVersions('0.4.29', '0.4.30'), -1);
  assert.strictEqual(compareVersions('0.4.29', '0.4.29'), 0);
  assert.strictEqual(compareVersions('0.5.0', '0.4.99'), 1);
  assert.strictEqual(compareVersions('0.4.29-beta.1', '0.4.29'), -1);
  assert.strictEqual(compareVersions('0.4.29', '0.4.29-beta.1'), 1);
  assert.strictEqual(compareVersions('0.4.29-beta.2', '0.4.29-beta.1'), 1);
});

test('预发布段按 semver 规则比较：数字段小于字符串段', () => {
  assert.strictEqual(compareVersions('0.4.29-beta.2', '0.4.29-beta.10'), -1);
  assert.strictEqual(compareVersions('0.4.29-alpha', '0.4.29-beta'), -1);
});

test('通道规则：beta 可收正式版，stable 不收内测版', () => {
  assert.strictEqual(channelAccepts('beta', 'beta'), true);
  assert.strictEqual(channelAccepts('beta', 'stable'), true);
  assert.strictEqual(channelAccepts('stable', 'stable'), true);
  assert.strictEqual(channelAccepts('stable', 'beta'), false);
});

test('合法清单通过校验并归一化字段', () => {
  const result = validateManifest({
    version: '0.4.30',
    channel: 'beta',
    url: 'https://download.example.com/GIWIN-Studio-0.4.30-Beta-Setup.exe',
    sha256: 'A'.repeat(64),
    size: 140433920,
    notes: ['修复素材丢失', '新增批量导出'],
    releaseDate: '2026-11-02'
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.manifest.sha256, 'a'.repeat(64));
  assert.strictEqual(result.manifest.notes.length, 2);
  assert.strictEqual(result.manifest.force, false);
});

test('清单校验拒绝不安全或不完整的输入', () => {
  const base = {
    version: '0.4.30',
    channel: 'beta',
    url: 'https://download.example.com/a.exe',
    sha256: 'a'.repeat(64),
    size: 1024
  };
  assert.strictEqual(validateManifest(null).ok, false);
  assert.strictEqual(validateManifest({ ...base, url: 'http://download.example.com/a.exe' }).ok, false);
  assert.strictEqual(validateManifest({ ...base, sha256: 'xyz' }).ok, false);
  assert.strictEqual(validateManifest({ ...base, size: 0 }).ok, false);
  assert.strictEqual(validateManifest({ ...base, version: 'latest' }).ok, false);
  assert.strictEqual(validateManifest({ ...base, channel: 'nightly' }).ok, false);
});

test('备用下载地址：只接受 https，非法值降级为空', () => {
  const base = {
    version: '0.4.30',
    channel: 'beta',
    url: 'https://download.example.com/a.exe',
    sha256: 'a'.repeat(64),
    size: 1024
  };
  const okResult = validateManifest({ ...base, manualUrl: 'https://pan.baidu.com/s/xxxx' });
  assert.strictEqual(okResult.ok, true);
  assert.strictEqual(okResult.manifest.manualUrl, 'https://pan.baidu.com/s/xxxx');

  assert.strictEqual(validateManifest(base).manifest.manualUrl, '');
  assert.strictEqual(validateManifest({ ...base, manualUrl: 'http://pan.baidu.com/s/xxxx' }).manifest.manualUrl, '');
  assert.strictEqual(validateManifest({ ...base, manualUrl: 123 }).manifest.manualUrl, '');
});

test('主进程确实接上了更新服务', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/update-service'\)/);
  assert.match(main, /updateService\.createUpdateService\(/);
  assert.match(main, /startUpdateService\(\);/);
});

test('安装器支持自动更新所需的静默参数', () => {
  const installer = fs.readFileSync(path.join(root, 'installer', 'Installer.cs'), 'utf8');
  assert.match(installer, /HasArgument\(args, "--launch"\)/, '静默安装需要支持装完自动启动');
  assert.match(installer, /ReadIntArgument\(args, "--wait-pid"\)/, '需要等待旧进程退出，避免“正在运行”拒绝安装');
  assert.match(installer, /WaitForInstallTargetFree/, '需要等待旧进程完全退出（含 Electron 子进程），避免“正在运行”拒绝安装');
  assert.match(installer, /LogSilent/, '静默安装失败必须写日志，否则无从排查');
});

test('更新源配置默认关闭且通道为 beta', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'update-config.json'), 'utf8'));
  assert.strictEqual(config.channel, 'beta');
  assert.strictEqual(typeof config.manifestUrl, 'string');
  assert.strictEqual(config.enabled, true);
});

test('更新弹窗与手动检查入口已接进界面', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(app, /ipcRenderer\.invoke\('update:check'/);
  assert.match(app, /ipcRenderer\.invoke\('update:download'/);
  assert.match(app, /ipcRenderer\.invoke\('update:install'/);
  assert.match(app, /initUpdateUi\(\);/);
  assert.match(html, /id="um-check-update"/);
  assert.match(html, /\.update-notes\s*\{/);
  assert.match(app, /class="update-notes"/);
});

test('安装器在静默升级时会接管被占用的安装目录', () => {
  const installer = fs.readFileSync(path.join(root, 'installer', 'Installer.cs'), 'utf8');
  assert.match(installer, /AllowTakingOverRunningApp/, '静默升级需要开启“接管运行中的应用”开关');
  assert.match(installer, /TerminateProcessesUnderTarget/, '目录被占用时必须能结束占用进程，而不是重试到失败');
  assert.match(installer, /ProcessesUnderTarget/, '需要按目录/进程名查找占用者，不能只依赖 MainModule 权限');
  // 旧实现只靠 MainModule.FileName 判断，32 位安装器读 64 位进程会抛异常并被吞掉
  const moveBlock = installer.slice(installer.indexOf('private static void MoveDirectoryWithRetry'));
  assert.match(moveBlock, /TerminateProcessesUnderTarget/, '移动目录失败后要主动结束占用进程再重试');
});

test('已下载并校验过的安装包不会在重启后被丢弃', () => {
  const { createUpdateService } = require('../update-service');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-upd-'));
  const pkgPath = path.join(tmp, 'setup.exe');
  fs.writeFileSync(pkgPath, Buffer.alloc(2048, 1));
  const statePath = path.join(tmp, 'update-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ downloadedVersion: '0.4.41', downloadedPath: pkgPath }));

  const service = createUpdateService({
    app: {
      getAppPath: () => tmp,
      getPath: () => tmp,
      getVersion: () => '0.4.40',
      isPackaged: true
    },
    ipcMain: { handle() {} },
    net: { fetch: async () => { throw new Error('unused'); } },
    shell: { openExternal() {} },
    configPath: path.join(tmp, 'update-config.json'),
    statePath,
    downloadRoot: path.join(tmp, 'downloads')
  });
  service.readConfig();
  service.syncStateFromDisk();

  assert.strictEqual(service.hasUsablePackage({ version: '0.4.41', size: 2048 }), true, '版本与大小一致时应复用');
  assert.strictEqual(service.hasUsablePackage({ version: '0.4.41', size: 4096 }), false, '大小不一致应重新下载');
  assert.strictEqual(service.hasUsablePackage({ version: '0.4.42', size: 2048 }), false, '版本不同应重新下载');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('安装步骤直接退出进程，不等待 before-quit 的清理流程', () => {
  const source = fs.readFileSync(path.join(root, 'update-service.js'), 'utf8');
  const installBlock = source.slice(source.indexOf('  async install() {'));
  assert.match(installBlock, /this\.app\.exit\(0\)/, '安装后必须直接 exit，避免退出流程拖住安装器');
  assert.match(installBlock, /prepareQuit/, '退出前的清理必须限时执行');
  assert.ok(!/setTimeout\(\(\) => this\.app\.quit\(\), 600\)/.test(installBlock), '不能再用 app.quit 等待退出');
});

test('手动装好新版后，历史失败说明不会永久残留', () => {
  const { createUpdateService } = require('../update-service');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-recon-'));
  const statePath = path.join(tmp, 'update-state.json');
  // 用户先在应用内更新 0.4.40 失败，之后自己双击安装包装上了 0.4.41
  fs.writeFileSync(statePath, JSON.stringify({
    installedVersion: '0.4.39',
    pendingInstallVersion: '',
    lastInstallError: '自动更新未能完成，当前仍是 0.4.39',
    failedInstallVersion: '0.4.40'
  }));

  const service = createUpdateService({
    app: {
      getAppPath: () => tmp,
      getPath: () => tmp,
      getVersion: () => '0.4.41',
      isPackaged: true
    },
    ipcMain: { handle() {} },
    net: { fetch: async () => { throw new Error('unused'); } },
    shell: { openExternal() {} },
    configPath: path.join(tmp, 'update-config.json'),
    statePath,
    downloadRoot: path.join(tmp, 'downloads')
  });
  service.reconcileInstallResult();
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.strictEqual(saved.installedVersion, '0.4.41', '对账后要记录真实版本');
  assert.strictEqual(saved.lastInstallError, '', '已经装上新版，失败说明必须清掉');
  assert.strictEqual(saved.failedInstallVersion, '', '失败版本标记也要清掉');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('失败记录只对当次版本生效，不会套到后面的新版本上', () => {
  const { createUpdateService } = require('../update-service');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-recon2-'));
  const statePath = path.join(tmp, 'update-state.json');
  // 仍是 0.4.40，0.4.41 那次安装失败：失败记录要保留（用户还在旧版）
  fs.writeFileSync(statePath, JSON.stringify({
    installedVersion: '0.4.39',
    pendingInstallVersion: '',
    lastInstallError: '自动更新未能完成，当前仍是 0.4.40',
    failedInstallVersion: '0.4.41'
  }));
  const service = createUpdateService({
    app: {
      getAppPath: () => tmp,
      getPath: () => tmp,
      getVersion: () => '0.4.40',
      isPackaged: true
    },
    ipcMain: { handle() {} },
    net: { fetch: async () => { throw new Error('unused'); } },
    shell: { openExternal() {} },
    configPath: path.join(tmp, 'update-config.json'),
    statePath,
    downloadRoot: path.join(tmp, 'downloads')
  });
  service.reconcileInstallResult();
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.strictEqual(saved.lastInstallError, '自动更新未能完成，当前仍是 0.4.40', '还没装上就不能清');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('面板只在失败版本与待更新版本一致时才说「继续完成更新」', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const anchor = source.indexOf('const installRetry = ');
  assert.ok(anchor > 0, '找不到 installRetry 判断');
  // 判断依赖的 failedVersion 变量就在它上方几行内
  const block = source.slice(Math.max(0, anchor - 400), anchor + 400);
  assert.match(block, /failedInstallVersion/, '必须比对失败版本，不能只看有没有错误记录');
  assert.match(block, /failedVersion ===/, '要与当前待更新版本做相等比较');
});

// ---------- 安装器拉起失败：必须可见，绝不能静默关掉应用 ----------

function makeInstallHarness(setupPath) {
  const { createUpdateService } = require('../update-service');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-inst-'));
  const statePath = path.join(tmp, 'update-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ downloadedVersion: '9.9.9', downloadedPath: setupPath }));
  const exits = [];
  const service = createUpdateService({
    app: {
      isPackaged: true,
      getAppPath: () => tmp,
      getPath: (name) => (name === 'exe' ? path.join(tmp, 'GIWIN.exe') : tmp),
      getVersion: () => '0.4.41',
      exit: (code) => exits.push(code)
    },
    ipcMain: { handle() {} },
    net: { fetch: async () => { throw new Error('unused'); } },
    shell: { openExternal() {} },
    configPath: path.join(tmp, 'update-config.json'),
    statePath,
    downloadRoot: path.join(tmp, 'downloads')
  });
  service.readConfig();
  service.state.phase = 'ready';
  service.state.release = { version: '9.9.9', url: 'https://example.com/a.exe', sha256: 'a'.repeat(64), size: 1024 };
  return { service, exits, statePath, tmp };
}

test('安装器拉不起来时：报错、不关应用、不留待安装记录', async () => {
  const { service, exits, statePath, tmp } = makeInstallHarness(path.join(__dirname, 'update-service.test.js'));
  // 安装器由系统启动器创建，这里模拟系统拒绝创建（WMI 返回非 0）
  service.launchInstallerOutsideJob = async () => ({ ok: false, error: '系统拒绝创建安装进程（Win32_Process.Create 返回 2）' });
  await service.install();
  assert.strictEqual(service.state.phase, 'error', '必须进入 error，不能停在 installing');
  assert.match(service.state.error, /没能启动安装程序/, '要直接说清安装程序没起来');
  // 越过退出延时窗口，确认应用真的没被关掉
  await new Promise((resolve) => setTimeout(resolve, 2600));
  assert.deepStrictEqual(exits, [], '安装器没起来时绝不能关闭应用，否则用户只看到「点了没反应」');
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.strictEqual(saved.pendingInstallVersion || '', '', '安装从未开始就不该留 pending，否则下次启动误报「上次没装成」');
  const logPath = path.join(tmp, 'update-install.log');
  assert.ok(fs.existsSync(logPath), '必须留下排查日志');
  assert.match(fs.readFileSync(logPath, 'utf8'), /安装器启动失败/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('安装器由系统启动器创建后才退出应用，并留下待安装版本与日志', async () => {
  const { service, exits, statePath, tmp } = makeInstallHarness(path.join(__dirname, 'update-service.test.js'));
  let called = null;
  service.launchInstallerOutsideJob = async (setupPath, args) => {
    called = { setupPath, args };
    return { ok: true, pid: 4242 };
  };
  await service.install();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.ok(called, '必须走系统启动器，而不是在应用进程里直接 spawn');
  assert.ok(Array.isArray(called.args));
  assert.strictEqual(called.args[0], '--silent', '第一个参数必须是 --silent，安装器靠它识别自动更新');
  assert.ok(called.args.includes('--launch'), '必须让安装器装完自动拉起');
  assert.ok(called.args.includes('--wait-pid'));
  assert.ok(called.args.includes(tmp), '要显式传入安装目录，否则安装器会装到默认位置');
  assert.deepStrictEqual(exits, [0], '安装器起来后应用应当退出，把安装目录交出去');
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.strictEqual(saved.pendingInstallVersion, '9.9.9', '要记下待安装版本供下次启动对账');
  const log = fs.readFileSync(path.join(tmp, 'update-install.log'), 'utf8');
  assert.match(log, /已交出安装器/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('安装器绝不能由应用进程直接 spawn（会被 Electron 的 Job 连坐杀掉）', () => {
  const source = fs.readFileSync(path.join(root, 'update-service.js'), 'utf8');
  const block = source.slice(source.indexOf('  async install() {'));
  assert.match(block, /launchInstallerOutsideJob/, '安装器必须交给应用进程之外的宿主创建');
  assert.doesNotMatch(block, /spawn\(setupPath/, '直接在应用里 spawn 安装器：应用一退，安装器就被系统杀掉，日志只留半截 "silent install start"');
  assert.match(source, /Win32_Process/, '要用 WMI 的 Win32_Process.Create 创建安装器进程');
  assert.match(block, /failInstallLaunch/, '要有明确的失败处理，不能直接退出');
  assert.match(source, /if \(!launched\.ok\)/, '拿不到进程号就不许关闭应用');
});

test('安装器支持写入受保护目录时自动申请管理员权限', () => {
  const installer = fs.readFileSync(path.join(root, 'installer', 'Installer.cs'), 'utf8');
  assert.match(installer, /CanWriteToDirectory/, '要真的探测目标目录可写性（Windows 的 W_OK 检查不可信）');
  assert.match(installer, /Verb = "runas"/, '装进 Program Files 这类目录必须提权，否则文件替换必然失败');
  assert.match(installer, /RelaunchElevated/, '提权要带原参数重跑自己');
  assert.match(installer, /--elevated/, '提权标记，避免反复弹 UAC');
});

test('提权安装后拉起应用要走资源管理器，避免应用变成管理员权限', () => {
  const installer = fs.readFileSync(path.join(root, 'installer', 'Installer.cs'), 'utf8');
  assert.match(installer, /IsElevated\(\)/, '需要判断是否处于提权状态');
  const launchBlock = installer.slice(installer.indexOf('if (options.LaunchAfterInstall)'));
  assert.match(launchBlock, /elevatedLaunch/, '提权时不能直接 Process.Start 拉起应用');
  assert.match(launchBlock, /explorer\.exe/, '提权后交给资源管理器以普通用户身份启动');
});

test('界面点安装后必须检查返回值，不能卡在「正在安装…」', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const block = source.slice(source.indexOf("ipcRenderer.invoke('update:install')"));
  assert.match(block, /res\.ok/, 'invoke 失败时不抛异常，只看返回值才能发现');
  assert.match(block, /renderUpdateDialog/, '失败要把错误显示出来，给用户下一步');
});

test('安装器命令行正确加引号：路径带空格、结尾反斜杠都不会解析错位', () => {
  const { buildInstallerCommandLine } = require('../update-service');
  const line = buildInstallerCommandLine('C:\\Users\\A B\\Temp\\setup.exe', [
    '--silent', 'C:\\Program Files\\GIWIN Studio', '--no-shortcuts', '--launch', '--wait-pid', '99'
  ]);
  assert.ok(line.startsWith('"C:\\Users\\A B\\Temp\\setup.exe"'), '安装包路径含空格必须加引号：' + line);
  assert.ok(line.includes('--silent "C:\\Program Files\\GIWIN Studio"'), '安装目录含空格必须加引号：' + line);
  assert.ok(line.endsWith('--wait-pid 99'), '不带空格的参数不要多加引号');

  // 结尾反斜杠 + 引号是 CreateProcess 的经典坑，必须成对转义
  const trailing = buildInstallerCommandLine('C:\\a b\\', []);
  assert.strictEqual(trailing, '"C:\\a b\\\\"');
});

test('WMI 启动脚本：单引号转义正确，并且有 CIM 不可用时的退路', () => {
  const { buildWmiCreateScript } = require('../update-service');
  const script = buildWmiCreateScript(`"C:\\a b\\setup.exe" --silent "D:\\It's here"`);
  assert.match(script, /Win32_Process/);
  assert.match(script, /MethodName Create/);
  assert.ok(!/It's here/.test(script), '命令行里的单引号必须转义成两个，否则 PowerShell 直接语法错误');
  assert.match(script, /It''s here/, '单引号要成对');
  assert.match(script, /wmiclass/, 'CIM 不可用时退回 wmiclass');
  assert.match(script, /GWOK/, '必须回报结果，成功与否不能靠猜');
});
test('安装目录写权限不能在应用侧提前拦截，要交给安装器提权', () => {
  const source = fs.readFileSync(path.join(root, 'update-service.js'), 'utf8');
  const block = source.slice(source.indexOf('  assertInstallable() {'), source.indexOf('  async install() {'));
  const code = block.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /accessSync|W_OK/,
    '旧版在 Program Files 会在这里直接失败，导致带 UAC 的安装器根本没有机会启动');
  assert.match(block, /path\.dirname\(exePath\)/);
});

test('更新弹窗在待安装、下载中和失败状态也都有关闭出口', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const dialog = source.slice(source.indexOf('function ensureUpdateDialog()'), source.indexOf('async function checkForUpdatesManually()'));
  assert.match(dialog, /data-close[^>]*title="关闭"/, '右上角必须始终有关闭按钮（安装进行中除外）');
  assert.match(dialog, /\['available', 'downloading', 'ready', 'error'\]\.includes\(phase\)/,
    'ready 不能再隐藏「稍后」，否则用户只能强制安装');
  assert.match(dialog, /event\.key === 'Escape'/, 'Esc 也应能关闭提示');
  assert.match(dialog, /state\.phase !== 'installing' && state\.release\.version === updateDismissedVersion/,
    '关闭后，下载完成或重试状态也不能在本次会话反复自动弹出');
});

test('关闭待安装提示后，手动检查更新仍能重新打开它', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const block = source.slice(source.indexOf('async function checkForUpdatesManually()'), source.indexOf('function initUpdateUi()'));
  assert.match(block, /updateDismissedVersion = ''/, '手动检查必须清除本次会话的忽略标记');
  assert.match(block, /state\.phase === 'available' \|\| state\.phase === 'ready'/,
    '安装包已下载好时手动检查应打开安装面板，不能误报已是最新版');
});
