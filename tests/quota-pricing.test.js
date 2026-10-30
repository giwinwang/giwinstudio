// 扣分必须跟 apilio 实付对得上 —— 加油包是纯算力转售，扣分就是成本映射，不能按尺寸臆造倍率。
//
// 事故（2026-10-30 深夜）：seedream-v5-pro 被记成 ¥0.27/张，实际是 ¥0.9/次，差 3.3 倍。
// 它正好是图层拆分在用的模型：内测 120 分全出它 = 120 张 × ¥0.9 = ¥108 成本，订阅只收 ¥58，每单亏 ¥50。
// 更早的版本用模型名正则猜价（名字带 nano-banana 就 1 分），4K 和 1K 同价。
// 现在：成本表按「模型 × 计费方式」登记，扣分 = ceil(实付/锚点)，锚点是 nano-banana-pro 的 ¥0.20。
// 这个测试把 providers.js 里的真身函数取出来执行，不是另写一份逻辑。

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

const tableSource = source.match(/const MODEL_COST_YUAN = (\{[\s\S]*?\n  \});/);
assert.ok(tableSource, '找不到 MODEL_COST_YUAN 成本表');
const COST_TABLE = new Function('return ' + tableSource[1])();

const anchor = source.match(/const POINT_COST_YUAN = ([\d.]+);/);
assert.ok(anchor, '找不到 POINT_COST_YUAN 锚点价');
const POINT_COST = Number(anchor[1]);

const unknown = source.match(/const UNKNOWN_MODEL_COST_YUAN = ([\d.]+);/);
assert.ok(unknown, '找不到 UNKNOWN_MODEL_COST_YUAN');
const UNKNOWN_COST = Number(unknown[1]);

const modelCostYuan = new Function(
  'MODEL_COST_YUAN', 'UNKNOWN_MODEL_COST_YUAN',
  'return ' + extractFunction(source, 'modelCostYuan')
)(COST_TABLE, UNKNOWN_COST);

const quotaCostFor = new Function(
  'modelCostYuan', 'POINT_COST_YUAN',
  'return ' + extractFunction(source, 'quotaCostFor')
)(modelCostYuan, POINT_COST);

// apilio default 分组真价（api.apilio.ai/api/pricing，2026-10-30 23:10 核对，分组倍率 1）
// 计费方式来自 quota_type：1 = 按次（model_price 就是单价），0 = 按量（token，价目里 price=0）
const APILIO_COST = {
  'nano-banana-pro': { mode: 'per_size', '1K': 0.2, '2K': 0.2, '4K': 0.275 },
  'nano-banana-2': { mode: 'per_size', '1K': 0.2, '2K': 0.2, '4K': 0.275 },
  'gemini-3-pro-image': { mode: 'per_size', '1K': 0.2, '2K': 0.2, '4K': 0.275 },
  'gemini-3.1-flash-image': { mode: 'per_size', '1K': 0.1, '2K': 0.1, '4K': 0.137 },
  // 阿波罗 1K / 2K / 4K 统一 ¥0.10，4K 唯一的 1 分通道（实测 4K 41 秒）
  'gemini-nano-banana-2.1': { mode: 'per_call', price: 0.1 },
  'seedream-v5-pro': { mode: 'per_call', price: 0.9 },
  'seedream-v5-pro/layer-decomposition': { mode: 'per_call', price: 0.9 },
  'seedream-v5-flash': { mode: 'per_call', price: 0.8 },
  'seedream-v5-flash/layer-decomposition': { mode: 'per_call', price: 0.8 },
  'doubao-seedream-5-0-260128': { mode: 'per_call', price: 0.15 },
  'doubao-seedream-4-5-251128': { mode: 'per_call', price: 0.15 },
  'doubao-seedream-4-0-250828': { mode: 'per_call', price: 0.14 },
  'doubao-seedream-3-0-t2i-250415': { mode: 'per_call', price: 0.1 },
  'seedream-3.0': { mode: 'per_call', price: 0.1 },
  'dall-e-3': { mode: 'per_call', price: 0.04 },
  'gemini-2.5-flash-image': { mode: 'per_call', price: 0.04 },
  'gemini-2.0-flash-exp-image-generation': { mode: 'per_call', price: 0.03 },
  // 按倍率计费（x2.5 / x2.5 / x1），没有固定单价，填的是偏高估值，见 pricing-spec.json 的 unknownModelNote
  'gpt-image-2': { mode: 'per_call', price: 0.6 },
  'gpt-image-1': { mode: 'per_call', price: 0.6 },
  'gpt-image-1-mini': { mode: 'per_call', price: 0.3 }
};

test('成本表与 apilio 真价逐项一致，锚点 ¥0.20', () => {
  assert.equal(POINT_COST, 0.2, '锚点必须是 nano-banana-pro 1K/2K 的实付 ¥0.20');
  assert.deepEqual(COST_TABLE, APILIO_COST, '成本表与 apilio 价目不一致，改价时请同步这张表和 pricing-spec.json');
});

test('Seedream 5.0 Pro 是 ¥0.9/次：任何尺寸都 5 分，不能被记成 ¥0.27', () => {
  ['1K', '1.5K', '2K', '4K', 'auto'].forEach(size => {
    assert.equal(quotaCostFor('seedream-v5-pro', size), 5,
      'seedream-v5-pro ' + size + ' 应扣 5 分（¥0.9 / ¥0.2），扣 1 分等于每张亏 ¥0.7');
  });
});

test('图层拆分层按次扣 5 分，不按层数乘（上游就是按次 ¥0.9）', () => {
  assert.equal(quotaCostFor('seedream-v5-pro/layer-decomposition', '2K'), 5);
  assert.equal(quotaCostFor('seedream-v5-pro/layer-decomposition', '4K'), 5);
  // 源码层再兜一道：拆层扣分语句里不许出现 layers *（会把 ¥0.9 的一次调用收 13 倍）
  const decomposeCall = source.match(/quotaSpendExplicit\(currentEngine,([^;]+);/g) || [];
  decomposeCall.forEach(line => {
    assert.ok(!/layers\s*\*/.test(line), '图层拆分又按层数乘扣分了：' + line.trim().slice(0, 80));
  });
});

test('常用模型 1 分/张，4K 2 分：1 积分 = 1 张标准图', () => {
  ['nano-banana-pro', 'nano-banana-2', 'gemini-3-pro-image'].forEach(model => {
    assert.equal(quotaCostFor(model, '1K'), 1, model + ' 1K 应扣 1 分');
    assert.equal(quotaCostFor(model, '2K'), 1, model + ' 2K 与 1K 同价，应扣 1 分');
    assert.equal(quotaCostFor(model, '4K'), 2, model + ' 4K（¥0.275）应扣 2 分');
  });
});

test('便宜的模型不涨分：gemini-3.1-flash 4K（¥0.137）仍是 1 分', () => {
  assert.equal(quotaCostFor('gemini-3.1-flash-image', '4K'), 1);
  assert.equal(quotaCostFor('gemini-3.1-flash-image', '1K'), 1);
  assert.equal(quotaCostFor('dall-e-3', '任意'), 1);
});

test('模型名带 -4k / -2k 后缀时也要算对（出图前会把尺寸拼进模型名）', () => {
  assert.equal(quotaCostFor('nano-banana-pro-4k', '4K'), 2);
  assert.equal(quotaCostFor('nano-banana-2-4k', '4K'), 2);
  assert.equal(quotaCostFor('gemini-3-pro-image-2k', '2K'), 1);
});

test('未登记模型按 ¥0.6 预扣 3 分（宁可多算不漏算）', () => {
  assert.equal(quotaCostFor('some-new-model', '4K'), 3);
  assert.equal(quotaCostFor('gpt-image-2', '2K'), 3, 'gpt-image-2 按 token 计费、价目里 price=0，不能当成免费');
  assert.equal(quotaCostFor('', ''), 3);
});

test('加油包毛利底线：每分承担的算力成本 ≤ ¥0.20，即 ¥100/230 分至少留 54%', () => {
  const packRevenuePerPoint = 100 / 230;
  for (const model of Object.keys(APILIO_COST)) {
    const entry = APILIO_COST[model];
    const sizes = entry.mode === 'per_call' ? ['任意'] : Object.keys(entry).filter(k => k !== 'mode');
    for (const size of sizes) {
      const cost = modelCostYuan(model, size);
      const points = quotaCostFor(model, size);
      const costPerPoint = cost / points;
      const margin = 1 - costPerPoint / packRevenuePerPoint;
      assert.ok(costPerPoint <= POINT_COST + 1e-9,
        model + ' ' + size + '：每分成本 ¥' + costPerPoint.toFixed(3) + ' 超过锚点 ¥' + POINT_COST);
      assert.ok(margin >= 0.5,
        model + ' ' + size + '：加油包毛利只有 ' + (margin * 100).toFixed(0) + '%，低于 50%');
    }
  }
});

test('扣分必须是整数：main.js 用 Math.floor，写 1.5 会被悄悄截成 1', () => {
  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSource, /Math\.floor\(Number\(payload\s*&&\s*payload\.points\)\)/, 'spendPoints 的小数截断被改了？');
  for (const model of Object.keys(APILIO_COST)) {
    const entry = APILIO_COST[model];
    const sizes = entry.mode === 'per_call' ? ['任意'] : Object.keys(entry).filter(k => k !== 'mode');
    for (const size of sizes) {
      const points = quotaCostFor(model, size);
      assert.equal(points, Math.floor(points), model + ' ' + size + ' 算出了小数分：' + points);
      assert.ok(points >= 1, '扣分不能小于 1');
    }
  }
});

test('尺寸阶梯已被废除，不许复活（成本由模型决定，不由尺寸决定）', () => {
  assert.ok(!/const SIZE_POINTS/.test(source), 'SIZE_POINTS 尺寸阶梯又回来了：上游不按尺寸定价，按尺寸扣分必然一边亏一边宰');
  assert.ok(!/IMAGE_COST_YUAN/.test(source), '旧的 IMAGE_COST_YUAN 表还在，已被 MODEL_COST_YUAN 取代');
});
