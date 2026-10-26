const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// 版本号只有一个来源：package.json。
// 这里不写死具体版本，而是守住「单一来源不漂移」这件事：
// 三个 JSON 字段一致、格式合法、安装器侧全部从 package.json 派生。
test('package.json is the single source of the version', () => {
  const version = packageJSON.version;
  assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
  assert.equal(packageLock.version, version);
  assert.equal(packageLock.packages[''].version, version);
});

test('installer build script derives the version instead of hard-coding it', () => {
  const script = fs.readFileSync(path.join(root, 'installer', 'build-installer.ps1'), 'utf8');
  assert.match(script, /packageVersion/, 'build-installer.ps1 必须从 package.json 读版本');
  assert.doesNotMatch(
    script,
    /GIWIN-Studio-\d+\.\d+\.\d+-Beta-Setup\.exe/,
    'build-installer.ps1 不应再写死安装包文件名'
  );
  assert.match(script, /AppVersion\.g\.cs/, '安装器编译前应生成版本常量文件');
});

test('C# installer sources no longer hard-code a version number', () => {
  for (const file of ['Installer.cs', 'Uninstaller.cs']) {
    const source = fs.readFileSync(path.join(root, 'installer', file), 'utf8');
    assert.doesNotMatch(
      source,
      /"\d+\.\d+\.\d+\s*BETA"/,
      `${file} 里的 BETA 版本标签应从 AppVersion 读取`
    );
    assert.doesNotMatch(
      source,
      /AssemblyVersion\("\d+\.\d+\.\d+\.\d+"\)/,
      `${file} 的 AssemblyVersion 应从 AppVersion 读取`
    );
  }
});

test('the removed workflow shortcut is not advertised in shortcut help', () => {
  assert.doesNotMatch(app, /Shift<\/kbd>\s*\+\s*<kbd>G/);
  assert.doesNotMatch(app, /建立工作流.*Shift/);
});
