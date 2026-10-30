// 扣分倍率必须跟 apilio 实付对得上。
//
// 事故（2026-10-30）：quotaCostFor 用模型名正则猜价 —— 只要名字里带 nano-banana 就一律 1 分。
// 于是 4K（apilio ¥0.275）和 1K（¥0.20）收同一个价，4K 毛利从 60% 掉到 45%；
// 更早的版本里 seedream 只有字面量 '2K' 才算 2 分，写 '4K' 会掉进 1 分。
// 现在改成「成本表 + ceil(成本/0.27)」，这个测试直接把 providers.js 里的函数取出来执行，
// 不是另写一份逻辑，改坏了就会失败。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'providers.js'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'providers.js 里找不到 ' + name + '()，被改名或删掉了？');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('函数体没闭合：' + name);
}

// 从源码里取出成本表和锚点价，再把真实的 quotaCostFor 编译成可调用函数
const tableSource = source.match(/const IMAGE_COST_YUAN = (\{[\s\S]*?\});/);
assert.ok(tableSource, '找不到 IMAGE_COST_YUAN 成本表');
const COST_TABLE = new Function('return ' + tableSource[1])();

const anchor = source.match(/const POINT_COST_YUAN = ([\d.]+);/);
assert.ok(anchor, '找不到 POINT_COST_YUAN 锚点价');
const POINT_COST = Number(anchor[1]);

const quotaCostFor = new Function(
  'IMAGE_COST_YUAN', 'POINT_COST_YUAN',
  'return ' + extractFunction(source, 'quotaCostFor')
)(COST_TABLE, POINT_COST);

// apilio 公开价目（api.apilio.ai/api/pricing，2026-10-30 核，分组倍率 1）
const APILIO_COST = {
  'nano-banana-pro': { '1K': 0.2, '2K': 0.2, '4K': 0.275 },
  'nano-banana-2': { '1K': 0.2, '2K': 0.2, '4K': 0.275 },
  'gemini-3-pro-image': { '1K': 0.2, '2K': 0.2, '4K': 0.275 },
  'gemini-3.1-flash-image': { '1K': 0.1, '2K': 0.1, '4K': 0.137 },
  'seedream-v5-pro': { '1K': 0.27, '1.5K': 0.27, '2K': 0.54 }
};

test('成本表与 apilio 公开价一致，锚点价是 0.27', () => {
  assert.equal(POINT_COST, 0.27, '锚点价必须是 seedream 1K 实付 ¥0.27');
  assert.deepEqual(COST_TABLE, APILIO_COST, '成本表与 apilio 价目不一致，改价时请同步这张表');
});

test('4K 必须扣 2 分：成本 0.275 是 1K（0.20）的 1.4 倍，不能和 1K 同价', () => {
  ['nano-banana-pro', 'nano-banana-2', 'gemini-3-pro-image'].forEach(model => {
    assert.equal(quotaCostFor(model, '4K'), 2, model + ' 4K 应扣 2 分');
    assert.equal(quotaCostFor(model, '1K'), 1, model + ' 1K 应扣 1 分');
    assert.equal(quotaCostFor(model, '2K'), 1, model + ' 2K 与 1K 同价，应扣 1 分');
  });
});

test('便宜的 4K 不跟着涨：gemini-3.1-flash-image 4K 成本 0.137 仍是 1 分', () => {
  assert.equal(quotaCostFor('gemini-3.1-flash-image', '4K'), 1);
  assert.equal(quotaCostFor('gemini-3.1-flash-image', '1K'), 1);
});

test('seedream 2K 扣 2 分、1K 与 1.5K 与 auto 扣 1 分', () => {
  assert.equal(quotaCostFor('seedream-v5-pro', '1K'), 1);
  assert.equal(quotaCostFor('seedream-v5-pro', '1.5K'), 1);
  assert.equal(quotaCostFor('seedream-v5-pro', 'auto'), 1);
  assert.equal(quotaCostFor('seedream-v5-pro', '2K'), 2, '0.54 / 0.27 = 2，不能被浮点推成 3');
});

test('模型名带 -4k 后缀时也要算对（出图前会把 4K 拼成 xxx-4k）', () => {
  assert.equal(quotaCostFor('nano-banana-2-4k', '4K'), 2);
  assert.equal(quotaCostFor('nano-banana-pro-4k', '4K'), 2);
  assert.equal(quotaCostFor('nano-banana-2-2k', '2K'), 1);
});

test('未收录模型：4K 兜底 2 分，其它 1 分（宁可多算不漏算）', () => {
  assert.equal(quotaCostFor('some-new-model', '4K'), 2);
  assert.equal(quotaCostFor('some-new-model', '1K'), 1);
  assert.equal(quotaCostFor('', ''), 1);
  // 表里有这个模型但没登记 4K 价（seedream 目前只有到 2K），也不能按 1K 价扣
  assert.equal(quotaCostFor('seedream-v5-pro', '4K'), 2, 'seedream 万一开了 4K，不许回落到 1 分');
});

test('每一档都不能亏：扣分收入（1 分 = ¥0.5）必须高于上游成本', () => {
  for (const model of Object.keys(APILIO_COST)) {
    for (const size of Object.keys(APILIO_COST[model])) {
      const cost = APILIO_COST[model][size];
      const revenue = quotaCostFor(model, size) * 0.5;
      assert.ok(revenue > cost, model + ' ' + size + ' 亏了：收 ¥' + revenue + '，成本 ¥' + cost);
    }
  }
});

test('扣分必须是整数：main.js 用 Math.floor，写 1.5 会被悄悄截成 1', () => {
  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSource, /Math\.floor\(Number\(payload\s*&&\s*payload\.points\)\)/, 'spendPoints 的小数截断被改了？');
  for (const model of Object.keys(APILIO_COST)) {
    for (const size of Object.keys(APILIO_COST[model])) {
      const points = quotaCostFor(model, size);
      assert.equal(points, Math.floor(points), model + ' ' + size + ' 算出了小数分：' + points);
      assert.ok(points >= 1, '扣分不能小于 1');
    }
  }
});
