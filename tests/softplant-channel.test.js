// 软装植入的「商品参考图」通道（productReferenceDataURL）。
//
// 背景：材质节点只能换表面、软装节点只能列清单，两边都到不了"把这件商品放进这个位置"。
// 缺的不是模型能力，是 generate() 里没有「目标商品」这个参数位。
// 这里用真跑的 generate() 打一个假 fetch，直接检查发出去的表单里到底有没有那张图，
// 而不是只 grep 源码字符串 —— 只做字符串断言的话，参数接上了但没塞进 payload 也测不出来。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'providers.js'), 'utf8');

// 1×1 真 PNG：readImageSize 靠 PNG 头读尺寸，所以必须给真图，不能给假 base64
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function bootProviders() {
  const store = { gw_engines: JSON.stringify({ apollo: { apiKey: 'sk-test-key', model: 'gpt-image-1' } }) };
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const win = {};
  const doc = { createElement: () => ({ style: {}, getContext: () => null }), querySelector: () => null, addEventListener: () => {} };
  const P = new Function('window', 'document', 'navigator', 'localStorage', 'Buffer', 'Blob', 'FormData', 'AbortSignal', 'Image',
    source + '; return window.GWProviders;')(win, doc, {}, localStorage, Buffer, Blob, FormData, AbortSignal, undefined);
  return P;
}

function stubFetch(calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: [{ b64_json: PNG_1X1.split(',')[1] }] }),
      text: async () => ''
    };
  };
}

function fileNames(form) {
  return form.getAll('image[]').map(item => (item && item.name) || '');
}

test('带目标商品时：走多图 edits 通道，且商品图真的进了 payload', async () => {
  const P = bootProviders();
  const calls = [];
  global.fetch = stubFetch(calls);
  await P.generate('apollo', {
    prompt: '把目标商品放进客厅主位',
    imageDataURL: PNG_1X1,
    maskDataURL: PNG_1X1,
    productReferenceDataURL: PNG_1X1,
    model: 'gpt-image-1'
  });
  assert.equal(calls.length, 1, '应该只发一次请求');
  const { url, init } = calls[0];
  assert.match(url, /\/images\/edits$/, '有遮罩时必须走 /images/edits，不能退到 generations');
  const form = init.body;
  assert.equal(typeof form.getAll, 'function', '表单不是 FormData');
  assert.ok(form.get('mask'), '遮罩丢了：等于整张图重画');
  const names = fileNames(form);
  assert.ok(names.includes('product_reference.png'), '商品参考图没进 payload，模型拿不到"这件"：' + names.join(','));
  assert.ok(names.includes('structure.png'), '底图丢了');
  assert.match(form.get('prompt'), /目标商品参考图/, 'prompt 里没有目标商品指令，模型只会当成普通参考图');
  assert.match(form.get('prompt'), /不得把它当贴图或画中画平铺/, '缺少"别画成贴图"的约束，白底商品图会出画中画');
});

test('没有目标商品时：payload 与 prompt 一个字都不变（材质/参考图/局部重绘三个入口不受影响）', async () => {
  const P = bootProviders();
  const calls = [];
  global.fetch = stubFetch(calls);
  await P.generate('apollo', {
    prompt: '把墙面换成米白棉麻',
    imageDataURL: PNG_1X1,
    maskDataURL: PNG_1X1,
    model: 'gpt-image-1'
  });
  const form = calls[0].init.body;
  assert.equal(form.getAll('image[]').length, 0, '没接商品时不该切到多图通道');
  const single = form.getAll('image');
  assert.equal(single.length, 1, '单图通道的底图丢了');
  assert.equal(single[0].name, 'structure.png', '底图字段名变了：' + single[0].name);
  assert.ok(!/目标商品参考图/.test(form.get('prompt')), '没接商品却把商品指令写进了 prompt');
});

test('商品图压缩必须保住透明通道（去底 PNG 转 JPEG 会变黑底）', () => {
  assert.match(source, /shrinkDataUrlForUpload\(productReferenceDataURL,\s*PRODUCT_UPLOAD_MAX_SIDE,\s*'image\/png'\)/,
    '商品图没有单独按 PNG 压缩：透明区会被压成黑底，生成出来是一块黑斑');
  assert.match(source, /if \(preferMime === 'image\/png'\) return canvas\.toDataURL\('image\/png'\)/,
    '压缩函数没有保住 alpha 的分支');
});
