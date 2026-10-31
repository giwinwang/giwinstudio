// 软装植入：连线进来的商品图就是商品来源。
//
// 之前的 bug 是「连了商品图进来，卡片仍显示缺商品图、生成按钮是灰的」——
// 判定只看 productImage / productThumb，没有把 sourceNodeId 算进去，
// 而执行链路其实是认 sourceNodeId 的。这里把判定钉住，避免两边又跑偏。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CANVAS = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > 0, 'canvas.js 缺少 ' + name);
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next > 0 ? next : src.length);
}

function categoriesLiteral() {
  const matched = CANVAS.match(/const SOFT_PLANT_CATEGORIES = (\[[^\]]*\]);/);
  assert.ok(matched, 'canvas.js 里找不到 SOFT_PLANT_CATEGORIES');
  return matched[1];
}

function loadHelpers(records, edges) {
  const code = [
    'var SOFT_PLANT_CATEGORIES = ' + categoriesLiteral() + ';',
    'var nodes = arguments[0];',
    'var graphStore = { edges: new Map(arguments[1]) };',
    extractFn(CANVAS, 'softPlantItemDefaults'),
    extractFn(CANVAS, 'softPlantSourceRecord'),
    extractFn(CANVAS, 'softPlantItemHasImage'),
    extractFn(CANVAS, 'guessSoftPlantCategory'),
    extractFn(CANVAS, 'softPlantItemStatus'),
    extractFn(CANVAS, 'softPlantReadyItems'),
    extractFn(CANVAS, 'softPlantPendingItems'),
    extractFn(CANVAS, 'softPlantSources'),
    extractFn(CANVAS, 'softPlantSourceNode'),
    extractFn(CANVAS, 'softPlantProductCandidates'),
    extractFn(CANVAS, 'syncSoftPlantProductSlots'),
    'return { softPlantItemDefaults, softPlantItemHasImage, softPlantItemStatus, softPlantReadyItems, softPlantPendingItems, guessSoftPlantCategory, softPlantSources, softPlantProductCandidates, syncSoftPlantProductSlots };'
  ].join('\n');
  return new Function(code)(records, edges);
}

function imageRecord(id, label, kind) {
  return {
    id,
    konva: { gwType: kind || 'variant', gwLabel: label, getClassName: () => 'Group' }
  };
}

function plantNode(id) {
  return { id, gwId: id, konva: { gwType: 'softplant', getClassName: () => 'Group' } };
}

function edge(from, to, port) {
  return ['e-' + from + '-' + to + '-' + port, { from, to, port }];
}

test('连线来的商品图要算「有图」，否则卡片一直显示缺商品图', () => {
  const space = imageRecord('img-space', '客厅白模');
  const product = imageRecord('img-sofa', '米白三人沙发');
  const node = plantNode('sp1');
  const h = loadHelpers([space, product, node], [edge('img-space', 'sp1', 'source'), edge('img-sofa', 'sp1', 'product')]);

  const item = h.softPlantItemDefaults({ sourceNodeId: 'img-sofa', category: '沙发' });
  assert.equal(item.productImage, '', '这条用例的前提是没落本地文件');
  assert.equal(item.productThumb, '');
  assert.equal(h.softPlantItemHasImage(item), true, 'sourceNodeId 指向的节点就是这张商品图的来源');
  assert.equal(h.softPlantItemStatus(item).key, 'pending', '有连线图却判成缺图，生成按钮会被灰掉');

  const plant = { items: [item] };
  assert.equal(h.softPlantReadyItems(plant).length, 1, '连线项没有进可生成列表');
  assert.equal(h.softPlantPendingItems(plant).length, 1, '连线项没有进待生成列表');
});

test('连线节点被删掉后不能再当有图，否则生成时才报读不到', () => {
  const h = loadHelpers([plantNode('sp1')], []);
  const item = h.softPlantItemDefaults({ sourceNodeId: 'img-gone', category: '沙发' });
  assert.equal(h.softPlantItemHasImage(item), false, '节点已经不在画布上，不能算有图');
  assert.equal(h.softPlantItemStatus(item).key, 'empty');
});

test('连线商品候选里不能出现空间图，避免把底图当成商品', () => {
  const space = imageRecord('img-space', '客厅白模');
  const product = imageRecord('img-sofa', '米白三人沙发');
  const extra = imageRecord('img-rug', '地毯');
  const h = loadHelpers([space, product, extra, plantNode('sp1')], [
    edge('img-space', 'sp1', 'source'),
    edge('img-sofa', 'sp1', 'product')
  ]);
  const ids = h.softPlantProductCandidates(plantNode('sp1')).map(entry => entry.record.id);
  assert.ok(!ids.includes('img-space'), '空间图被列成商品候选了，选中会把底图当商品图发出去');
  assert.ok(ids.includes('img-sofa'), '已连入的商品图必须出现在候选里');
  assert.ok(ids.includes('img-rug'), '画布上的其它图片也要能直接选，否则还得回桌面找文件');
});

test('同步连线时按图片名猜品类，名称与品类相同就留空', () => {
  const sofa = imageRecord('img-sofa', '米白三人沙发');
  const rug = imageRecord('img-rug', '地毯');
  const plain = imageRecord('img-x', '沙发');
  const h = loadHelpers([sofa, rug, plain, plantNode('sp1')], [
    edge('img-sofa', 'sp1', 'product'),
    edge('img-rug', 'sp1', 'product'),
    edge('img-x', 'sp1', 'product')
  ]);
  const group = { gwId: 'sp1', gwSoftPlant: { items: [] } };
  const added = h.syncSoftPlantProductSlots(group);
  assert.equal(added, 3);
  const [a, b, c] = group.gwSoftPlant.items;
  assert.equal(a.category, '沙发', '「米白三人沙发」应该猜成沙发');
  assert.equal(a.name, '米白三人沙发');
  assert.equal(b.category, '地毯');
  assert.equal(c.category, '沙发');
  assert.equal(c.name, '', '名称和品类一样会显示成「沙发 · 沙发」，应当留空让卡片只显示一次');
});

test('同一条连线重复同步不会加出两个槽位', () => {
  const sofa = imageRecord('img-sofa', '沙发');
  const h = loadHelpers([sofa, plantNode('sp1')], [edge('img-sofa', 'sp1', 'product')]);
  const group = { gwId: 'sp1', gwSoftPlant: { items: [] } };
  assert.equal(h.syncSoftPlantProductSlots(group), 1);
  assert.equal(h.syncSoftPlantProductSlots(group), 0, '第二次同步又加了一条：等于同一件商品生成两次');
  assert.equal(group.gwSoftPlant.items.length, 1);
});

test('执行时取图顺序：本地文件 > 连线节点原图 > 缩略图', () => {
  // 缩略图只有 180px，排在节点原图前面会让模型看不清商品细节（拉扣、腿型、缝线）
  assert.match(CANVAS, /item\.productImage \|\| \(linkedRecord && linkedRecord\.konva\) \|\| item\.productThumb/,
    '取图顺序变了：缩略图排在连线原图前面了');
  assert.match(CANVAS, /productReferenceDataURL: productURL/, '执行时没把商品图传给生成接口');
});
