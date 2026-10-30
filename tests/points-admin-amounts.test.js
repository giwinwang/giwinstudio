// 积分发码台的面额一致性：同一个「¥100 加油包」不能在三个入口算出三个结果
// 历史 BUG：预设按钮给 230、截图识别按 ¥1=2 给 200、账单导入直接给 100（Math.round(amount)）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const adminPath = path.resolve(root, '..', 'license-admin', 'points-admin.mjs');
const hasAdmin = fs.existsSync(adminPath);
const phoneHtml = path.resolve(root, '..', 'license-issuer-android', 'app', 'src', 'main', 'assets', 'index.html');

function readPresets(source) {
  const block = source.match(/const POINT_PRESETS = \[([\s\S]*?)\n\];/);
  assert.ok(block, '找不到 POINT_PRESETS 档位表，发码台可能又改回各入口各算一套了');
  return Array.from(block[1].matchAll(
    /\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*amount:\s*(\d+),\s*points:\s*(\d+),\s*days:\s*(\d+),\s*expiry:\s*"([^"]+)",\s*note:\s*"([^"]+)"\s*\}/g
  )).map(match => ({
    key: match[1], label: match[2], amount: Number(match[3]),
    points: Number(match[4]), days: Number(match[5]), expiry: match[6], note: match[7]
  }));
}

test('发码台档位表：金额与面额成对，且与定价定稿一致', { skip: !hasAdmin && '本机没有 license-admin 目录' }, () => {
  const presets = readPresets(fs.readFileSync(adminPath, 'utf8'));

  const expected = {
    18: 36,      // 体验包
    58: 120,     // 标准月付
    100: 230,    // 加油包（¥1=2 只到 200，多送 15% 才是 230）
    156: 360,    // 标准季付
    168: 340,    // 高级月付
    450: 1020,   // 高级季付
    580: 1200,   // 标准年付
    1680: 3400   // 高级年付
  };
  const actual = Object.fromEntries(presets.map(preset => [preset.amount, preset.points]));
  assert.deepEqual(actual, expected, '档位表与 docs/积分体系设计方案-v1.md 的定价对不上');

  // 金额必须唯一，否则 presetForAmount() 会命中错档位
  assert.equal(new Set(presets.map(preset => preset.amount)).size, presets.length, '有两个档位金额相同');

  // 加油包是唯一一个「不按兑换率」的档位，必须显式存在
  const boost = presets.find(preset => preset.key === 'boost');
  assert.ok(boost, '缺少加油包档位');
  assert.equal(boost.amount, 100);
  assert.equal(boost.points, 230);
  assert.notEqual(boost.points, boost.amount * 2, '加油包不能退回 ¥1=2 折算');
});

test('发码台三个入口共用 pointsForAmount()，不再各自折算', { skip: !hasAdmin && '本机没有 license-admin 目录' }, () => {
  const source = fs.readFileSync(adminPath, 'utf8');

  // 截图识别
  const fill = source.match(/function fillFromEntry\(entry\) \{([\s\S]*?)\n\}/);
  assert.ok(fill, '找不到 fillFromEntry()');
  assert.match(fill[1], /pointsForAmount\(entry\.amount\)/, '截图识别没走档位表');
  assert.equal(fill[1].includes('entry.amount * 2'), false, '截图识别还在用 ¥1=2 硬算（¥100 会少给 30 分）');

  // 账单导入（服务端）
  assert.match(source, /suggestedPoints:\s*pointsForAmount\(row\.amount\)/, '账单导入没走档位表');
  assert.equal(source.includes('Math.round(row.amount)'), false, '账单导入还在把金额当积分（¥100 只给 100 分）');

  // 按钮由同一张表渲染，避免「按钮写 230、填表填 200」
  assert.match(source, /POINT_PRESETS\.map\(preset =>/, '预设按钮不是从档位表渲染的');
  assert.equal(source.includes("data-preset=\"boost\">加油包 <small>"), false, '预设按钮还写死在 HTML 里');
});

test('发码台帮助文案里的加油包面额不能写错', { skip: !hasAdmin && '本机没有 license-admin 目录' }, () => {
  const source = fs.readFileSync(adminPath, 'utf8');
  assert.equal(source.includes('= 130 积分'), false, '帮助文案把加油包写成 130 积分（定稿是 230）');
  assert.match(source, /买加油包（= 230 积分）/, '帮助文案没写清加油包 ¥100 = 230 积分');
});

test('手机端积分码卡片与电脑端档位表金额→面额必须一致', { skip: !fs.existsSync(phoneHtml) && '本机没有手机签发器目录' }, () => {
  const html = fs.readFileSync(phoneHtml, 'utf8');
  const phone = Array.from(html.matchAll(/data-points-amount="(\d+)"[^>]*data-points-label="([^"]+)"/g))
    .map(match => ({ points: Number(match[1]), label: match[2] }));
  assert.equal(phone.length, 8, '手机端积木码卡片应有 8 个档位按钮');

  if (!hasAdmin) return; // 只在本机有发码台时做交叉比对
  const presets = readPresets(fs.readFileSync(adminPath, 'utf8'));
  const byAmount = Object.fromEntries(presets.map(preset => [preset.amount, preset.points]));
  phone.forEach(item => {
    assert.ok(
      Object.values(byAmount).includes(item.points),
      '手机端面额 ' + item.points + '（' + item.label + '）在电脑端档位表里找不到，两端口径已分叉'
    );
  });
  assert.deepEqual(
    phone.map(item => item.points).sort((a, b) => a - b),
    Object.values(byAmount).sort((a, b) => a - b),
    '手机端 8 个面额与电脑端档位表不是同一批'
  );
});
