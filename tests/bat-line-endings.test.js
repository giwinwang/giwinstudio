// 中文 bat 必须用 CRLF 换行，否则 cmd.exe 会吞掉行首字符。
//
// 实机事故（2026-10-30）：积分发码台.bat 被写成 LF + UTF-8，双击后
//   for /f ... %%i      → 报错 '%i' 不是内部或外部命令
//   if not defined ...  → 报错 'fined' 不是内部或外部命令
//   "%NODE_EXE%"        → NODE_EXE 始终为空，退化成 "" → exit 9009
// 全过程没有任何「编码错误」提示，只有一串看不懂的中文报错。
// 原因：cmd 按当前代码页逐字节读批处理，0x0A 后面紧跟多字节汉字时对齐会错位。
// 纯 ASCII 的 bat 用 LF 侥幸能跑，所以这条规则只对含非 ASCII 字节的文件生效。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// license-admin 与主仓库同级，不在版本控制里；换机器或跑 CI 时直接跳过
const adminDir = path.resolve(__dirname, '..', '..', 'license-admin');

function batFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.bat'))
    .map(name => path.join(dir, name));
}

function hasNonAscii(buffer) {
  return buffer.some(byte => byte > 0x7f);
}

test('含中文的 bat 必须是 CRLF，且不能带 BOM', t => {
  const files = batFiles(adminDir);
  if (!files.length) {
    t.skip('本机没有 license-admin 目录，跳过（该目录未纳入版本控制）');
    return;
  }

  const problems = [];
  for (const file of files) {
    const name = path.basename(file);
    const buffer = fs.readFileSync(file);

    // UTF-8 BOM 会让第一行变成 "锘?a echo off"，cmd 直接报错
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      problems.push(name + '：开头有 UTF-8 BOM，cmd 会把第一行当命令执行');
    }

    if (!hasNonAscii(buffer)) continue; // 纯 ASCII 不受换行影响

    const text = buffer.toString('latin1');
    const bareLf = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '\n' && text[i - 1] !== '\r') bareLf.push(i);
    }
    if (bareLf.length) {
      problems.push(
        name + '：含中文却用了 LF 换行（' + bareLf.length + ' 处），' +
        'cmd 会吞掉行首字符，表现为「xx 不是内部或外部命令」和 exit 9009'
      );
    }
  }

  assert.deepEqual(problems, [], 'bat 换行/编码有问题：\n' + problems.join('\n'));
});

test('发码台启动脚本仍然保留 node 探测与失败提示', t => {
  const file = path.join(adminDir, '积分发码台.bat');
  if (!fs.existsSync(file)) {
    t.skip('本机没有 license-admin 目录，跳过');
    return;
  }
  const text = fs.readFileSync(file, 'latin1');
  assert.ok(text.includes('where node'), '缺少 node 探测，换机器会直接 9009');
  assert.ok(/NODE_EXE/.test(text), '缺少 NODE_EXE 变量');
  assert.ok(text.includes('points-admin.mjs'), '没有真正启动发码台');
  // 端口被占时脚本会自动换端口，用户看到的地址要和实际一致
  assert.ok(text.includes('exit /b'), '失败后要能退出并保留错误码');
});
