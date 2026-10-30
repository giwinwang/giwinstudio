// 模型来源与默认值：算力全部从阿波罗（apilio）分销，模型一律优先从阿波罗选。
//
// 事故背景（2026-10-30）：阿波罗上 Seedream 5.0 有三条通道，价差 6 倍——
//   doubao-seedream-5-0-260128  ¥0.15/次 → 1 分
//   seedream-v5-flash           ¥0.80/次 → 4 分
//   seedream-v5-pro             ¥0.90/次 → 5 分
// 而默认模型一度指向 Pro。客户不知道自己在用哪条时，一点就是 5 分/张，
// 等于拿最贵的通道当默认卖 —— 这就是「骗人」。默认必须是最便宜那条。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'providers.js'), 'utf8');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'pricing-spec.json'), 'utf8'));

// 用最小的假 DOM 把 providers.js 跑起来，拿到的就是真身注册表，不是另抄一份
const P = new Function('window', 'document', 'navigator', 'localStorage',
  source + '; return window.GWProviders;')(
  {},
  { createElement: () => ({ style: {} }), querySelector: () => null, addEventListener: () => {} },
  {},
  { getItem: () => null, setItem: () => {} }
);

const apolloGen = P.MODEL_REGISTRY.filter(entry => entry.engine === 'apollo' && entry.type === 'generate');

test('阿波罗默认模型必须是 Seedream 5.0 标准版（最便宜那条），不能是 Pro', () => {
  assert.equal(P.PROVIDERS.apollo.model, 'doubao-seedream-5-0-260128',
    '阿波罗默认模型被改成 ' + P.PROVIDERS.apollo.model + '，默认位只能放最便宜的 5.0 标准版');
  assert.equal(spec.billing.defaultModel, P.PROVIDERS.apollo.model,
    'pricing-spec.json 的 defaultModel 与代码不一致');
});

test('Seedream 5.0 三条通道都挂在阿波罗下，客户可自选', () => {
  const ids = apolloGen.map(entry => entry.id);
  ['doubao-seedream-5-0-260128', 'seedream-v5-flash', 'seedream-v5-pro'].forEach(id => {
    assert.ok(ids.includes(id), '阿波罗下缺少 ' + id + '，客户就无法在 5.0 三档里自己选');
  });
});

test('默认档一定是同族里最便宜的', () => {
  const seedream = apolloGen.filter(entry => /seedream|doubao-seedream/.test(entry.id));
  const costs = seedream.map(entry => ({ id: entry.id, cost: P.modelCostYuan(entry.id, '1K') }));
  const cheapest = costs.reduce((a, b) => (b.cost < a.cost ? b : a));
  assert.equal(cheapest.id, P.PROVIDERS.apollo.model,
    '默认模型不是最便宜的：' + P.PROVIDERS.apollo.model + '，同族最便宜是 ' + cheapest.id + ' ¥' + cheapest.cost);
});

test('同族高价档必须在备注里写明每张扣几分，客户要能一眼看见差价', () => {
  ['seedream-v5-flash', 'seedream-v5-pro'].forEach(id => {
    const entry = apolloGen.find(e => e.id === id);
    assert.ok(entry, '找不到 ' + id);
    const points = P.quotaCostFor(id, '1K');
    assert.match(entry.note || '', new RegExp(points + ' 积分'),
      id + ' 实际扣 ' + points + ' 分，但 note 里没写，客户会以为和 5.0 一样是 1 分');
  });
});

test('阿波罗注册的生图模型都必须在成本表里登记（不许靠 ¥0.6 兜底蒙混）', () => {
  // gpt-image 系列按 token 计费，价目里 price=0，只能按兜底价预扣，属已知例外
  const tokenBilled = /^gpt-image/;
  apolloGen.filter(entry => !tokenBilled.test(entry.id)).forEach(entry => {
    assert.ok(P.MODEL_COST_YUAN[entry.id],
      entry.id + ' 没登记成本，会按 ¥' + P.UNKNOWN_MODEL_COST_YUAN + ' 兜底扣 3 分，可能亏本');
  });
});

test('模型特性表里的积分单价由成本表算出来，不写死在文案里', () => {
  // 客户在「设置 → 模型特性表」应该直接看见 1 分/张 与 5 分/张 的差别，
  // 所以 app.js 必须调用 quotaCostFor，而不是在 note 里手写数字。
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /P\.quotaCostFor\(n\.id, '1K'\)/, '模型特性表没按成本表计算积分单价');
  assert.match(app, /积分\/张/, '模型特性表没把积分单价显示出来');
});

test('阿波罗 default 分组打不通的模型不进生成面板', () => {
  // gemini-2.5-flash-image 在阿波罗只在 gemini-t3 / gemini优质 / origin 分组，
  // 我们发出去的额度码走 default，选中必 503。注册表保留条目（老画布不崩），但面板不许展示。
  const list = P.filterImageModels(['gemini-2.5-flash-image', 'nano-banana-pro', 'doubao-seedream-5-0-260128'], 'apollo');
  assert.ok(!list.includes('gemini-2.5-flash-image'), 'default 分组无渠道的模型又出现在生成面板里了');
  assert.ok(list.includes('nano-banana-pro'), '正常模型被误杀了');
});

test('注册表里不许留阿波罗根本没有的模型', () => {
  // 对账清单来自 tools/check-apollo-models.mjs（2026-10-30 核对 apilio.ai/api/pricing 1126 个模型）。
  // 这几个当年挂在 engine:'any' 下，客户选中只会得到 404。
  const ghosts = ['flux-1.1-pro', 'imagen-3.0-generate-002', 'imagen-4.0-generate-001',
    'stable-diffusion-3.5-large', 'kolors', 'hunyuan-image', 'cogview-4'];
  const ids = P.MODEL_REGISTRY.map(e => e.id);
  ghosts.forEach(id => assert.ok(!ids.includes(id), id + ' 阿波罗没有，必须从注册表删除'));
});

test('尺寸后缀按白名单拼：只对确认存在 -2k/-4k 变体的模型加后缀', () => {
  const alias = P.__test_APOLLO_SIZE_ALIASED;
  if (!alias) return; // 没导出就跳过（生成路径由 quota-pricing 的 -4k 用例覆盖）
  ['nano-banana-pro', 'nano-banana-2', 'gemini-nano-banana-2.1', 'gemini-3-pro-image', 'gemini-3.1-flash-image']
    .forEach(id => assert.ok(alias.has(id), id + ' 在阿波罗有 -4k 变体，应允许拼后缀'));
  assert.ok(!alias.has('doubao-seedream-5-0-260128'), 'Seedream 5.0 没有 -4k 变体，拼了就是 503');
});

test('4K 必须有 1 积分通道：NanoBanana 2.1 全程同价', () => {
  // 阿波罗 1K / 2K / 4K 统一 ¥0.10，实测 4K 41 秒出真 4096×4096（2026-10-31）。
  // 没有这条，客户想 4K 只能在 ¥0.275 扣 2 分、实测 >180 秒超时的那几条里挑。
  assert.equal(P.modelCostYuan('gemini-nano-banana-2.1', '4K'), 0.1,
    '4K 成本变了，扣分与对外说明要跟着改');
  ['1K', '2K', '4K'].forEach(size => assert.equal(P.quotaCostFor('gemini-nano-banana-2.1', size), 1,
    'NanoBanana 2.1 的 ' + size + ' 档扣分应是 1 分'));
  assert.ok(P.MODEL_REGISTRY.some(e => e.id === 'gemini-nano-banana-2.1'), '注册表里没有这个 4K 通道');
});

test('4K 推荐位给实测最快最省那条，不能推给没测过的模型', () => {
  const t2i = P.bestModelForSize('4K');
  assert.ok(t2i, '4K 没有任何推荐通道');
  assert.equal(t2i.id, 'gemini-nano-banana-2.1', '4K 文生图推荐变成了 ' + t2i.id + '，最省的是 NanoBanana 2.1（¥0.10）');
  assert.equal(t2i.points, 1, '4K 推荐通道扣 ' + t2i.points + ' 分，客户会以为 4K 更贵');
  assert.ok(t2i.latencySec && t2i.latencySec <= 90, '4K 推荐通道必须有实测耗时且不超过 90 秒');
});

test('4K 图生图不能推荐「带参考图会超时」的模型', () => {
  // 实测（2026-10-31）：gemini-nano-banana-2.1-4k 带参考图 300 秒没出图；gemini-3.1-flash-image-4k 带参考图 29 秒成功。
  const ref = P.bestModelForSize('4K', { withRef: true });
  assert.ok(ref, '4K 图生图没有推荐通道');
  assert.equal(ref.id, 'gemini-3.1-flash-image',
    '4K 图生图推荐变成了 ' + ref.id + '，它带参考图实测超时，客户会白等 5 分钟');
  assert.equal(ref.points, 1, '4K 图生图推荐通道应只扣 1 分');
  const t2i = P.bestModelForSize('4K');
  assert.notEqual(ref.id, t2i.id, '4K 文生图与图生图应各有各的推荐，不能混为一谈');
});

test('4K 老通道必须写明扣分与超时风险，不能让人白等', () => {
  const pro = P.MODEL_REGISTRY.find(e => e.id === 'nano-banana-pro');
  assert.match(pro.note || '', /4K/, 'nano-banana-pro 的 note 没提 4K');
  assert.match(pro.note || '', /超时|180/, 'nano-banana-pro 4K 实测 >180 秒，note 必须写出来，否则客户一直等');
});

test('sizeOptions：模型到不了 4K 时给一条能换模型的 4K 选项', () => {
  // 只给 4K 不给换模型 = 让客户拿跑不通的通道硬撞
  const opts = P.sizeOptions('apollo', 'doubao-seedream-5-0-260128', { withRef: false });
  const fourK = opts.find(o => o.value === '4K');
  assert.ok(fourK, '默认模型到不了 4K，尺寸列表里却没有 4K 选项');
  assert.ok(fourK.switchModel, '4K 选项没有附带要切换的模型');
  assert.equal(fourK.switchModel, 'gemini-nano-banana-2.1', '文生图 4K 应推 NanoBanana 2.1（实测 41s）');
  // 本身支持 4K 的模型不该出现「换模型」选项
  const native = P.sizeOptions('apollo', 'gemini-3.1-flash-image', { withRef: false });
  assert.ok(native.some(o => o.value === '4K'), '3.1-flash 本身支持 4K');
  assert.ok(!native.some(o => o.switchModel), '模型自己能出 4K 就别再提示换模型');
});

test('sizeOptions：4K 文生图与图生图必须走不同通道', () => {
  // 实测：NanoBanana 2.1 文生图 4K 41s，带参考图 4K 等满 300s 不出图；
  // 反过来 3.1-flash 带参考图 4K 只要 29s。我们主链路是图生图，推错就是一次超时。
  const t2i = P.sizeOptions('apollo', 'doubao-seedream-5-0-260128', { withRef: false }).find(o => o.value === '4K');
  const i2i = P.sizeOptions('apollo', 'doubao-seedream-5-0-260128', { withRef: true }).find(o => o.value === '4K');
  assert.equal(t2i.switchModel, 'gemini-nano-banana-2.1');
  assert.equal(i2i.switchModel, 'gemini-3.1-flash-image', '图生图 4K 推了 ' + i2i.switchModel + '，实测带参考图会超时');
  assert.equal(i2i.points, 1, '图生图 4K 通道扣 ' + i2i.points + ' 分，应仍是 1 分');
});

test('sizeOptions：auto 文案可配，文生图面板用「自动」', () => {
  const a = P.sizeOptions('apollo', 'doubao-seedream-5-0-260128', {}).find(o => o.value === 'auto');
  const b = P.sizeOptions('apollo', 'doubao-seedream-5-0-260128', { autoLabel: '自动' }).find(o => o.value === 'auto');
  assert.equal(a.label, '跟随原图');
  assert.equal(b.label, '自动');
});
