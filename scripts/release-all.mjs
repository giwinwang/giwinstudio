// 一键发版：清单 → GitHub Release → 官网配置 → OSS 上线
// 用法（在主项目根目录）：
//   GITHUB_TOKEN=ghp_xxx npm run release:all
//   可选透传参数：npm run release:all -- --notes "要点一|要点二"
//
// 流程：
//   1. publish:update  生成 update/version.json（读取 release-branded 安装包，算 SHA256）
//   2. git push        推送代码与清单到 main
//   3. release:push    建 GitHub Release 并上传安装包
//   4. site:sync       把版本号/网盘链接写入官网 site-config.js
//   5. deploy 官网     OSS 同步上线并验证

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = 'G:\\02_项目开发\\GIWINDESIGN\\05_GIWIN-官网';

function run(name, args, opts) {
  const options = Object.assign({ cwd: root, stdio: 'inherit', shell: true }, opts);
  console.log('\n========== ' + name + ' ==========');
  const r = spawnSync(args.shift(), args, options);
  if (r.status !== 0) {
    console.error('\n✗ ' + name + ' 失败（exit ' + r.status + '），发版中止。已完成的前置步骤不受影响。');
    process.exit(r.status || 1);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!process.env.GITHUB_TOKEN) {
  console.error('缺少环境变量 GITHUB_TOKEN');
  process.exit(1);
}
const installer = fs.readdirSync(path.join(root, 'release-branded'))
  .find((name) => name.toLowerCase().endsWith('.exe') && name.includes(version));
if (!installer) {
  console.error('release-branded 下找不到 v' + version + ' 的安装包，请先打包');
  process.exit(1);
}

const passthrough = process.argv.slice(2); // --notes 等透传给 publish / release

const ossExeUrl = 'https://www.giwin.cn/downloads/' + installer;

run('1/5 生成更新清单', ['node', 'scripts/publish-update.mjs',
  '--base-url', 'https://github.com/giwinwang/giwinstudio/releases/download/v' + version,
  '--asset-url', ossExeUrl,
  ...passthrough]);

run('2/5 推送代码', ['git', 'push', 'origin', 'main']);

run('3/5 发布 GitHub Release', ['node', 'scripts/release-push.mjs', ...passthrough]);

run('4/5 同步官网配置', ['node', 'scripts/sync-site.mjs']);

// 清单与安装包同步到 OSS：国内最快的下载/检查通道，访问日志即活跃统计
const ossutil = 'C:/Users/Administrator/.ossutil-bin/ossutil-v1.7.19-windows-amd64/ossutil.exe';
const oss = [ossutil, '-e', 'oss-cn-hongkong.aliyuncs.com'];
run('5/7 OSS 上传清单', [...oss, 'cp', '-f', 'update/version.json',
  'oss://giwin-cn-web/update/version.json', '--meta', 'Cache-Control:no-cache']);
run('6/7 OSS 上传安装包', [...oss, 'cp', '-f',
  path.join(root, 'release-branded', installer), 'oss://giwin-cn-web/downloads/' + installer]);
run('7/7 官网上线（阿里云 OSS）', ['bash', path.join(siteDir, 'deploy.sh')]);

console.log('\n✓ v' + version + ' 发版完成：GitHub Release / 自动更新 / 官网下载 三处已同步。');
