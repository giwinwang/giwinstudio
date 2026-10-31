// 软装植入节点的结构与提示词。
//
// 这个节点和「软装提取与选品」方向相反：提取是"图 → 清单"，植入是"清单 → 图"。
// 两者共用 item 结构，但端口完全独立，这里把端口契约和提示词规则都钉住，
// 免得后面有人"顺手复用一个 soft 端口"把两条链路又搅在一起。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CORE = require(path.join(root, 'graph-core.js'));
const CANVAS = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > 0, 'canvas.js 缺少 ' + name);
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next > 0 ? next : src.length);
}

function loadPromptHelpers() {
  const code = [
    extractFn(CANVAS, 'softPlantItemBrief'),
    extractFn(CANVAS, 'softPlantPrompt')
  ].join('\n') + '\nreturn { softPlantItemBrief, softPlantPrompt };';
  return new Function(code)();
}

test('softplant 节点已注册，端口是 source / product / params → result', () => {
  const def = CORE.getNodeDef('softplant');
  assert.ok(def, 'graph-core 里没有 softplant：拖不出节点，端口也画不出来');
  const inputs = Object.fromEntries(def.inputs.map(port => [port.id, port]));
  assert.equal(inputs.source && inputs.source.type, CORE.PORT.MEDIA, 'source 必须是图片口');
  assert.equal(inputs.source.required, true, '没有空间图就不该能跑');
  assert.equal(inputs.source.max, 1, '空间图只能一张，多了会拿错底图');
  assert.equal(inputs.product && inputs.product.type, CORE.PORT.MEDIA, 'product 必须是图片口');
  assert.equal(inputs.product.max, 8, '商品图上限改了要同步 runSoftPlant 的循环');
  assert.ok(inputs.params, '缺 params 口');
  assert.equal(def.outputs[0].type, CORE.PORT.MEDIA, '输出必须是图片');
});

test('软装提取的输出（SOFT）不能连进软装植入，两条链路不能混', () => {
  assert.equal(CORE.canConnect('soft', 'softplant', 'source'), false,
    'soft 输出的是清单不是图，接上去会拿一张不存在的图当底图');
  assert.equal(CORE.canConnect('image', 'softplant', 'source'), true);
  assert.equal(CORE.canConnect('variant', 'softplant', 'product'), true);
});

test('有落位框时提示词必须锁死"只改框内"，否则等于整张重画', () => {
  const { softPlantPrompt } = loadPromptHelpers();
  const prompt = softPlantPrompt({ category: '沙发', name: '米白三人位', qty: 1 }, { spaceType: 'white', mode: 'replace' }, { hasMask: true });
  assert.match(prompt, /只有标记区域允许改动/, '缺"只改标记区域"的约束，模型会顺手改墙和别的家具');
  assert.match(prompt, /不得移动、缩放或替换其它家具/, '缺"其它家具不许动"的约束');
  assert.match(prompt, /图2/, '没告诉模型第二张图是什么：商品图会被当成风格参考');
});

test('没有落位框时提示词必须限定"只出现一次"，否则模型会摆两件', () => {
  const { softPlantPrompt } = loadPromptHelpers();
  const prompt = softPlantPrompt({ category: '落地灯', name: '黄铜', qty: 1 }, { spaceType: 'auto' }, { hasMask: false });
  assert.ok(!/只有标记区域允许改动/.test(prompt), '没有遮罩却说"只改标记区域"，模型会无所适从');
  assert.match(prompt, /只出现一次/, '没限制件数，模型容易在画面里摆两件同类家具');
});

test('平面图与白模走不同规则（不能拿平面图当白模要求对齐门窗）', () => {
  const { softPlantPrompt } = loadPromptHelpers();
  const plan = softPlantPrompt({ category: '沙发' }, { spaceType: 'plan' }, { hasMask: false });
  assert.match(plan, /建筑平面图/, '平面图没有单独规则，模型会按效果图去"对齐墙体"');
  assert.match(plan, /不得改变户型/, '平面图没约束户型，出图会和图1对不上');
  const white = softPlantPrompt({ category: '沙发' }, { spaceType: 'white' }, { hasMask: false });
  assert.match(white, /白模/, '白模没有单独规则');
  assert.match(white, /层高/, '白模缺"保持层高"，会出比例失真的图');
});

test('商品说明要同时带品类、名称和数量', () => {
  const { softPlantItemBrief } = loadPromptHelpers();
  assert.equal(softPlantItemBrief({ category: '沙发', name: '米白三人位', qty: 1 }), '沙发 · 米白三人位');
  assert.equal(softPlantItemBrief({ category: '餐椅', name: '藤编', qty: 4 }), '餐椅 · 藤编 · 数量 4');
  assert.equal(softPlantItemBrief({}), '');
});

test('商品图压缩走 PNG（透明底不能被压成黑底）', () => {
  const PROVIDERS = fs.readFileSync(path.join(root, 'providers.js'), 'utf8');
  assert.match(PROVIDERS, /product_reference/, 'payload 里没有命名商品图，多图通道下无法和图注对应');
});
