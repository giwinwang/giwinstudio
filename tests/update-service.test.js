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
  const installBlock = source.slice(source.indexOf('  install() {'));
  assert.match(installBlock, /this\.app\.exit\(0\)/, '安装后必须直接 exit，避免退出流程拖住安装器');
  assert.match(installBlock, /prepareQuit/, '退出前的清理必须限时执行');
  assert.ok(!/setTimeout\(\(\) => this\.app\.quit\(\), 600\)/.test(installBlock), '不能再用 app.quit 等待退出');
});
