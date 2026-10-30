const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = {};
global.localStorage = {
  _data: {},
  getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
  setItem(key, value) { this._data[key] = String(value); },
  removeItem(key) { delete this._data[key]; }
};
require('../model-tuning.js');
require('../providers.js');
const P = global.window.GWProviders;

test('model registry validates ids, aliases, sizes and aspects', () => {
  assert.ok(P);
  assert.deepEqual(global.window.__modelRegistryProblems || [], []);
  assert.ok(P.MODEL_REGISTRY.length >= 20);
});

test('every registered alias resolves to its real model id', () => {
  for (const entry of P.MODEL_REGISTRY) {
    const engine = entry.engine === 'any' ? 'custom' : entry.engine;
    for (const name of [entry.alias].concat(entry.aliases || [])) {
      assert.equal(P.realIdOf(name, engine), entry.id, `${engine} / ${name}`);
    }
    assert.equal(P.aliasOf(entry.id), entry.alias, entry.id);
    assert.deepEqual(P.getSizes(engine, entry.id), entry.sizes, entry.id);
    assert.deepEqual(P.getAspects(engine, entry.id), entry.aspects, entry.id);
  }
});

test('cross-engine aliases fall back to the selected engine default', () => {
  assert.equal(P.realIdOf('NanoBanana 2', 'apollo'), 'nano-banana-2');
  assert.equal(P.realIdOf('NanoBanana 2', 'volc'), P.PROVIDERS.volc.model);
  assert.equal(P.realIdOf('豆包 Seedream 5.0 Pro', 'runninghub'), 'doubao-seedream-5-0-pro-250930');
  assert.equal(P.realIdOf('豆包 Seedream 5.0 Pro', 'apollo'), 'seedream-v5-pro');
  assert.equal(P.realIdOf('豆包 Seedream 5.0 Flash', 'apollo'), P.PROVIDERS.apollo.model);
  assert.equal(P.realIdOf('FLUX Pro', 'apollo'), 'flux-pro');
});

test('legacy resolution suffixes are removed from provider model ids', () => {
  // 解析层只负责剥掉尺寸后缀、回到基础模型；真正的 xxx-4k 模型名由 generate 按尺寸重新拼，
  // 且 4K 与 2K 在阿波罗是不同的模型名、不同价格（0.275 / 0.20）。
  assert.equal(P.realIdOf('gemini-3-pro-image-2k', 'apollo'), 'gemini-3-pro-image');
  assert.equal(P.realIdOf('gemini-3-pro-image-4k', 'apollo'), 'gemini-3-pro-image');
  assert.equal(P.realIdOf('gemini-3.1-flash-image-4k', 'apollo'), 'gemini-3.1-flash-image');
});

test('Apollo prefers the versioned API path and real aggregate model ids', () => {
  assert.equal(P.urlCandidates('apollo', 'https://api.apilio.ai')[0], 'https://api.apilio.ai/v1');
  assert.equal(P.realIdOf('NanoBanana Pro', 'apollo'), 'nano-banana-pro');
  assert.equal(P.realIdOf('NanoBanana 2', 'apollo'), 'nano-banana-2');
});

test('Bailian Wanx image edit remains reserved for masked panorama repair', () => {
  assert.equal(P.PROVIDERS.bailian.image, false);
  assert.equal(P.PROVIDERS.bailian.model, 'wanx2.1-imageedit');
  assert.equal(P.realIdOf('wanx2.1-imageedit', 'bailian'), 'wanx2.1-imageedit');
  assert.deepEqual(P.getCapabilities('bailian', 'wanx2.1-imageedit').aspects, ['auto', '2:1']);
});

test('302.AI Topaz remains a dedicated upscale provider', () => {
  assert.equal(P.PROVIDERS.topaz302.image, false);
  assert.equal(P.PROVIDERS.topaz302.baseURL, 'https://api.302.ai');
  assert.equal(P.realIdOf('Standard V2', 'topaz302'), 'Standard V2');
  assert.equal(P.vendorOf('topaz302', 'Standard V2'), 'topaz');
});

test('upscale prefers a configured provider and leaves 302.AI as the unconfigured default', () => {
  assert.equal(P.preferredUpscaleEngine({}), 'topaz302');
  assert.equal(P.preferredUpscaleEngine({ topaz302: { apiKey: '  ' }, runninghub: { apiKey: 'rh-key' } }), 'runninghub');
  assert.equal(P.preferredUpscaleEngine({ topaz302: { apiKey: '302-key' }, runninghub: { apiKey: 'rh-key' } }), 'topaz302');
});

test('user style reference outranks preset styling in generated prompts', () => {
  const base = {
    styleName: '奶油风',
    blocks: [{ key: 'light', name: '光线', value: '暖光', on: true }],
    weather: '晴天',
    strength: 0.85,
    structureLocked: true
  };
  for (const engineId of ['apollo', 'volc']) {
    const referencePrompt = P.renderPrompt(engineId, { ...base, styleReferenceFirst: true });
    assert.match(referencePrompt, /图2/);
    assert.match(referencePrompt, /唯一外观依据/);
    assert.match(referencePrompt, /不启用方案预设/);
    assert.doesNotMatch(referencePrompt, /奶油风/);
    assert.doesNotMatch(referencePrompt, /将图1改造为/);
    const weatherPrompt = P.renderPrompt(engineId, { ...base, styleReferenceFirst: true, weather: '雨天' });
    assert.match(weatherPrompt, /雨天/);
    assert.match(weatherPrompt, /阴雨天气形成冷灰天空/);
    assert.match(weatherPrompt, /不表现雨滴、水珠、雨丝、水幕、积水或湿面/);
    assert.match(weatherPrompt, /全部室内区域必须干燥/);
    assert.match(weatherPrompt, /玻璃隔断也不得出现水珠、水痕或湿反光/);
    assert.doesNotMatch(weatherPrompt, /窗外有雨幕/);
    assert.doesNotMatch(weatherPrompt, /雨幕与少量水珠只允许/);
    assert.doesNotMatch(weatherPrompt, /室内暖光对比/);
    const atmospherePrompt = P.renderPrompt(engineId, { ...base, styleReferenceFirst: true, referenceMode: 'atmosphere' });
    assert.match(atmospherePrompt, /保留图1的材质种类、纹理和表面颜色/);
    assert.doesNotMatch(atmospherePrompt, /唯一外观依据/);

    const presetPrompt = P.renderPrompt(engineId, { ...base, styleReferenceFirst: false });
    assert.match(presetPrompt, /奶油风/);
  }
});

test('light switches compile into model-appropriate prompt language', () => {
  const baseLight = {
    name: '冷调柔光',
    intensity: 45,
    temperature: 6200,
    softness: 78,
    direction: '窗侧主光',
    weather: '雨天',
    lightingMode: 'off',
    lightingGroups: ['ceiling', 'cove', 'decor']
  };
  const naturalOff = P.renderLightPrompt('apollo', 'nano-banana-2', baseLight, { includeWeather: false });
  assert.match(naturalOff, /人工灯光：所有人工照明关闭/);
  assert.match(naturalOff, /灯具实体、数量和位置全部保留/);
  assert.match(naturalOff, /不得发光、投射光斑/);

  const keywordOn = P.renderLightPrompt('volc', 'doubao-seedream-5-0-pro-260628', {
    ...baseLight,
    lightingMode: 'on',
    lightingGroups: ['cove']
  }, { includeWeather: false });
  assert.match(keywordOn, /【人工灯光】/);
  assert.match(keywordOn, /只点亮天花灯带、柜底灯和洗墙灯/);
  assert.match(keywordOn, /筒灯、射灯和吸顶灯、落地灯、台灯和壁灯保持关闭/);
  assert.doesNotMatch(keywordOn, /雨幕|雨滴|水珠/);
});

test('Seedream 5 Pro sends explicit 2K pixels and rejects sub-1K short edges', async () => {
  function fakePng(w, h) {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(w, 16);
    head.writeUInt32BE(h, 20);
    const tail = Buffer.alloc(12);
    tail.writeUInt32BE(0, 0);
    tail.write('IEND', 4, 'ascii');
    return 'data:image/png;base64,' + Buffer.concat([head, tail]).toString('base64');
  }
  assert.equal(P.seedreamRequestSize('2K', '16:9'), '2752x1536');
  assert.equal(P.seedreamRequestSize('2K', '1:1'), '2048x2048');
  assert.equal(P.seedreamResolutionGate('2K', { w: 1312, h: 736 }), false);
  assert.equal(P.seedreamResolutionGate('2K', { w: 2048, h: 1152 }), true);

  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  localStorage.setItem('gw_route_apollo', 'edits');
  const requestBodies = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const form = {};
    if (init.body && typeof init.body.entries === 'function') {
      for (const [key, value] of init.body.entries()) form[key] = typeof value === 'string' ? value : value.name;
    }
    requestBodies.push({ url: String(url), form });
    return new Response(JSON.stringify({ data: [{ b64_json: fakePng(2752, 1536).split(',')[1] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const result = await P.generate('apollo', {
      prompt: '测试渲染',
      imageDataURL: fakePng(4096, 2304),
      size: '2K',
      aspect: 'auto',
      model: 'seedream-v5-pro',
      sourceSize: { w: 4096, h: 2304 }
    });
    assert.match(result, /^data:image\/png;base64,/);
    assert.equal(requestBodies[0].url.endsWith('/images/edits'), true);
    assert.equal(requestBodies[0].form.size, '2752x1536');
    assert.equal(requestBodies[0].form.image_size, '2K');
    assert.equal(requestBodies[0].form.aspect_ratio, '16:9');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Seedream 5 Pro refuses to silently save a sub-1K response for a 2K request', async () => {
  function fakePng(w, h) {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(w, 16);
    head.writeUInt32BE(h, 20);
    const tail = Buffer.alloc(12);
    tail.writeUInt32BE(0, 0);
    tail.write('IEND', 4, 'ascii');
    return 'data:image/png;base64,' + Buffer.concat([head, tail]).toString('base64');
  }
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  localStorage.setItem('gw_route_apollo', 'edits');
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    data: [{ b64_json: fakePng(1312, 736).split(',')[1] }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(
      P.generate('apollo', {
        prompt: '测试 2K',
        imageDataURL: fakePng(4096, 2304),
        size: '2K',
        aspect: 'auto',
        model: 'seedream-v5-pro',
        sourceSize: { w: 4096, h: 2304 }
      }),
      /未达到请求的 2K/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('single-image reroll sends all consistency references through multi-image editing', async () => {
  function fakePng(w, h) {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(w, 16);
    head.writeUInt32BE(h, 20);
    const tail = Buffer.alloc(12);
    tail.writeUInt32BE(0, 0);
    tail.write('IEND', 4, 'ascii');
    return 'data:image/png;base64,' + Buffer.concat([head, tail]).toString('base64');
  }
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  localStorage.setItem('gw_route_apollo', 'edits');
  const requestBodies = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const form = { image: [] };
    for (const [key, value] of init.body.entries()) {
      if (key === 'image[]' || key === 'image') form.image.push(typeof value === 'string' ? value : value.name);
    }
    requestBodies.push({ url: String(url), form });
    return new Response(JSON.stringify({ data: [{ b64_json: fakePng(1024, 576).split(',')[1] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const result = await P.generate('apollo', {
      prompt: '单张重绘一致性测试',
      imageDataURL: fakePng(1024, 576),
      additionalReferenceDataURLs: [
        fakePng(1024, 576),
        fakePng(1024, 576),
        fakePng(1024, 576)
      ],
      size: '1K',
      aspect: '16:9',
      model: 'nano-banana-2',
      sourceSize: { w: 1024, h: 576 }
    });
    assert.match(result, /^data:image\/png;base64,/);
    assert.equal(requestBodies[0].url.endsWith('/images/edits'), true);
    assert.deepEqual(requestBodies[0].form.image, [
      'structure.png',
      'consistency_1.png',
      'consistency_2.png',
      'consistency_3.png'
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('material references are sent through multi-image editing', async () => {
  function fakePng(w, h) {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(w, 16);
    head.writeUInt32BE(h, 20);
    const tail = Buffer.alloc(12);
    tail.writeUInt32BE(0, 0);
    tail.write('IEND', 4, 'ascii');
    return 'data:image/png;base64,' + Buffer.concat([head, tail]).toString('base64');
  }
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  localStorage.setItem('gw_route_apollo', 'edits');
  const requestBodies = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const form = { images: [] };
    for (const [key, value] of init.body.entries()) {
      if (key === 'image[]' || key === 'image') form.images.push(typeof value === 'string' ? value : value.name);
    }
    requestBodies.push({ url: String(url), form });
    return new Response(JSON.stringify({ data: [{ b64_json: fakePng(1024, 576).split(',')[1] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const result = await P.generate('apollo', {
      prompt: 'material tint test',
      imageDataURL: fakePng(1024, 576),
      materialReferenceDataURL: fakePng(512, 512),
      size: '1K',
      aspect: '16:9',
      model: 'nano-banana-2',
      sourceSize: { w: 1024, h: 576 }
    });
    assert.match(result, /^data:image\/png;base64,/);
    assert.equal(requestBodies[0].url.endsWith('/images/edits'), true);
    assert.deepEqual(requestBodies[0].form.images, ['structure.png', 'material.png']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('exterior references are sent as a dedicated window-view image', async () => {
  function fakePng(w, h) {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(w, 16);
    head.writeUInt32BE(h, 20);
    const tail = Buffer.alloc(12);
    tail.writeUInt32BE(0, 0);
    tail.write('IEND', 4, 'ascii');
    return 'data:image/png;base64,' + Buffer.concat([head, tail]).toString('base64');
  }
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  localStorage.setItem('gw_route_apollo', 'edits');
  const requestBodies = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const form = { images: [] };
    for (const [key, value] of init.body.entries()) {
      if (key === 'image[]' || key === 'image') form.images.push(typeof value === 'string' ? value : value.name);
    }
    requestBodies.push({ url: String(url), form });
    return new Response(JSON.stringify({ data: [{ b64_json: fakePng(1024, 576).split(',')[1] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const result = await P.generate('apollo', {
      prompt: 'exterior reference test',
      imageDataURL: fakePng(1024, 576),
      exteriorReferenceDataURL: fakePng(512, 288),
      size: '1K',
      aspect: '16:9',
      model: 'nano-banana-2',
      sourceSize: { w: 1024, h: 576 }
    });
    assert.match(result, /^data:image\/png;base64,/);
    assert.equal(requestBodies[0].url.endsWith('/images/edits'), true);
    assert.deepEqual(requestBodies[0].form.images, ['structure.png', 'exterior.png']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('multi-floor plan references stay separate from the current floor output', async () => {
  function fakePng(w, h) {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(w, 16);
    head.writeUInt32BE(h, 20);
    const tail = Buffer.alloc(12);
    tail.writeUInt32BE(0, 0);
    tail.write('IEND', 4, 'ascii');
    return 'data:image/png;base64,' + Buffer.concat([head, tail]).toString('base64');
  }
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  localStorage.setItem('gw_route_apollo', 'edits');
  const requestBodies = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const form = { images: [] };
    for (const [key, value] of init.body.entries()) {
      if (key === 'image[]' || key === 'image') form.images.push(typeof value === 'string' ? value : value.name);
    }
    requestBodies.push({ url: String(url), form });
    return new Response(JSON.stringify({ data: [{ b64_json: fakePng(1024, 576).split(',')[1] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const result = await P.generate('apollo', {
      prompt: 'multi-floor plan test',
      imageDataURL: fakePng(1024, 576),
      planReferenceDataURLs: [fakePng(1024, 576), fakePng(1024, 576)],
      size: '1K',
      aspect: '16:9',
      model: 'nano-banana-2',
      sourceSize: { w: 1024, h: 576 }
    });
    assert.match(result, /^data:image\/png;base64,/);
    assert.equal(requestBodies[0].url.endsWith('/images/edits'), true);
    assert.deepEqual(requestBodies[0].form.images, [
      'structure.png',
      'floor_reference_1.png',
      'floor_reference_2.png'
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('image generation stops immediately when the caller aborts a panorama repair', async () => {
  function fakePng(w, h) {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(w, 16);
    head.writeUInt32BE(h, 20);
    const tail = Buffer.alloc(12);
    tail.writeUInt32BE(0, 0);
    tail.write('IEND', 4, 'ascii');
    return 'data:image/png;base64,' + Buffer.concat([head, tail]).toString('base64');
  }
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('panorama repair cancelled', 'AbortError'));
    }, { once: true });
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  try {
    await assert.rejects(
      P.generate('apollo', {
        prompt: 'repair panorama seam and poles',
        imageDataURL: fakePng(1024, 512),
        size: '2K',
        aspect: '2:1',
        model: 'nano-banana-2',
        sourceSize: { w: 1024, h: 512 },
        signal: controller.signal
      }),
      error => error && error.name === 'AbortError'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('every registered model exposes a vendor logo and capability tiers', () => {
  for (const entry of P.MODEL_REGISTRY) {
    const engine = entry.engine === 'any' ? 'custom' : entry.engine;
    const meta = P.vendorMeta(engine, entry.id);
    assert.ok(meta.logo && meta.logo.endsWith('.svg'), entry.id);
    assert.ok(entry.sizes.includes('auto'), entry.id);
    assert.ok(entry.aspects.includes('auto'), entry.id);
    assert.ok(P.isRegisteredModel(engine, entry.id), entry.id);
  }
});

test('every registered model has a feature note and an existing local logo asset', () => {
  for (const entry of P.MODEL_REGISTRY) {
    const engine = entry.engine === 'any' ? 'custom' : entry.engine;
    const meta = P.vendorMeta(engine, entry.id);
    assert.ok(String(entry.note || '').trim(), entry.id + ': note');
    assert.ok(fs.existsSync(path.join(__dirname, '..', meta.logo)), entry.id + ': ' + meta.logo);
  }
  assert.equal(P.NOTES.length, P.MODEL_REGISTRY.length);
});

test('Apollo exposes vision models without mixing them into image generation', () => {
  const visionIds = P.MODEL_REGISTRY
    .filter(entry => entry.engine === 'apollo' && entry.type === 'vision')
    .map(entry => entry.id);
  assert.ok(visionIds.includes('gpt-4o'));
  assert.ok(visionIds.includes('gpt-4.1'));
  assert.ok(visionIds.includes('gemini-2.5-pro'));
  assert.ok(visionIds.includes('claude-sonnet-4-20250514'));
  assert.equal(P.filterImageModels(visionIds).length, 0);
  const choices = P.visionModelsForEngine('apollo').map(entry => entry.id);
  assert.ok(choices.includes('gpt-4o'));
  assert.ok(choices.includes('gemini-2.5-flash'));
});

test('inpainting routes follow model capabilities', () => {
  assert.equal(P.inpaintRouteFor('apollo', 'gpt-image-2'), 'mask');
  assert.equal(P.inpaintRouteFor('apollo', 'nano-banana-2'), 'reference');
  assert.equal(P.inpaintRouteFor('apollo', 'seedream-v5-pro'), 'reference');
  assert.equal(P.inpaintRouteFor('volc', 'doubao-seedream-5-0-pro-260628'), 'reference');
  assert.equal(P.inpaintRouteFor('runninghub', 'doubao-seedream-5-0-pro-250930'), 'reference');
  assert.equal(P.inpaintRouteFor('openai', 'gpt-5'), 'unsupported');
});

test('layer decomposition uses the Seedream layer model contract', async () => {
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://layer.test' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let requestBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/images/generations')) {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: [
        { url: 'https://layer.test/bg.png', size: '1024x768', name: 'background' },
        { url: 'https://layer.test/chair.png', size: '1024x768', name: 'chair', z_index: 2 }
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const result = await P.decomposeLayers({
      engineId: 'apollo',
      imageDataURL: 'data:image/png;base64,aGVsbG8=',
      prompt: '拆分家具和背景',
      resolution: '2K'
    });
    assert.equal(requestBody.model, 'seedream-v5-pro/layer-decomposition');
    assert.equal(requestBody.layer_decomposition, true);
    assert.equal(requestBody.image.length, 1);
    assert.equal(result.images.length, 2);
    assert.equal(result.images[0].background, true);
    assert.equal(result.images[1].name, 'chair');
  } finally {
    global.fetch = originalFetch;
  }
});

test('engine config falls back to local storage without Electron encryption', () => {
  P.saveConfig('custom', { apiKey: 'test-key', baseURL: 'https://example.test' });
  assert.equal(P.loadConfigs().custom.apiKey, 'test-key');
  assert.equal(P.storageMode(), 'local');
});

test('image data URLs are normalized before decode and signature validation', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const clean = 'data:image/png;base64,' + png;
  assert.equal(P.normalizeImageDataURL(clean), clean);
  assert.equal(P.normalizeImageDataURL('data:image/png;base64,data:image/png;base64,' + png), clean);
  assert.equal(P.normalizeImageDataURL(png), clean);
  assert.equal(P.imageDataURLSignatureValid(clean), true);
  assert.equal(P.imageDataURLSignatureValid('data:image/png;base64,bm90LWltYWdl'), false);
});

test('generate accepts a signature-valid image when the renderer decode probe fails', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const previousFetch = global.fetch;
  const previousImage = global.Image;
  P.saveConfig('apollo', { apiKey: 'test-key', baseURL: 'https://example.test' });
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ data: [{ b64_json: png }] })
  });
  global.Image = class {
    set src(_value) { setTimeout(() => { if (this.onerror) this.onerror(); }, 0); }
  };
  try {
    const result = await P.generate('apollo', {
      prompt: 'test',
      imageDataURL: 'data:image/png;base64,' + png,
      size: '1K',
      aspect: 'auto',
      model: 'NanoBanana 2',
      sourceSize: { w: 640, h: 360 }
    });
    assert.equal(result, 'data:image/png;base64,' + png);
  } finally {
    global.fetch = previousFetch;
    global.Image = previousImage;
  }
});
