// 画布里 6 处尺寸选择器（生成控制面板 / 概念 / 彩平 / 节点检查器×2 / 文生图弹窗 / 旧生成面板）
// 必须统一走 providers.sizeOptions，不能各写一套 getSizes——否则模型到不了 4K 时，
// 客户只能在模型列表里自己猜换哪个，猜错就是一次超时 + 白扣积分。
// canvas.js 依赖大量 DOM，这里做源码级静态检查（配合 model-sourcing.test.js 的行为用例）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');

test('尺寸下拉统一走 sizeOptionHTML，不许再有手写的 option 拼接', () => {
  // 逐个定位 6 处尺寸控件，确认它们后面接的是 sizeOptionHTML 而不是 ${sizes.map(...)}
  const controls = [
    'data-p="size"',      // 生成控制面板 + 节点检查器
    'data-concept-size',  // 概念效果图
    'data-plan-size',     // 平面表现
    'id="ni-size"',       // 节点检查器（简版）
    'sizeSel.innerHTML'   // 文生图弹窗
  ];
  for (const key of controls) {
    const at = SRC.indexOf(key);
    assert.ok(at > 0, '画布里找不到尺寸控件 ' + key);
    const seg = SRC.slice(at, at + 200);
    if (key === 'sizeSel.innerHTML') {
      assert.ok(seg.includes('sizeOptionHTML'), '文生图弹窗的尺寸列表没走 sizeOptionHTML');
    } else {
      assert.ok(seg.includes('sizeOptionHTML'), key + ' 的选项没走 sizeOptionHTML');
    }
  }
  // 除旧生成面板的按钮组（它用独立的「4K · 换模型」按钮）外，不许再有 sizes.map 渲染 option
  const leftovers = SRC.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(x => /sizes\.map/.test(x.line));
  assert.ok(leftovers.length <= 1,
    '还有 ' + leftovers.length + ' 处 sizes.map 没改造：' + leftovers.map(x => 'L' + x.n).join(', '));
});

test('每个尺寸控件都要处理「4K · 换模型」的连带换模型', () => {
  // 只记尺寸不换模型 = 拿跑不通的通道去生成，客户只会看到超时。
  // 逐个定位尺寸控件的所有出现位置，确认紧随其后（500 字符内）有 switchModel 处理。
  const controls = ['data-p="size"', 'data-concept-size', 'data-plan-size', '#ni-size', 'sizeSel'];
  for (const key of controls) {
    let at = SRC.indexOf(key);
    let found = false;
    while (at > 0) {
      if (/switchModel/.test(SRC.slice(at, at + 500))) { found = true; break; }
      at = SRC.indexOf(key, at + 1);
    }
    assert.ok(found, key + ' 附近没有处理 switchModel（选了 4K 却没换模型）');
  }
  // 旧生成面板走独立按钮
  assert.ok(/data-s="4K" data-switch-model/.test(SRC), '旧生成面板缺「4K · 换模型」按钮');
});

test('校验当前尺寸时要带上 4K 补位项，否则 4K 会被静默打回 auto', () => {
  // 旧生成面板：选了「4K · 换模型」后重绘，若还用 getSizes 校验就会把 4K 冲掉
  assert.ok(/R\.size === '4K' && fourKAlt/.test(SRC), '旧生成面板的尺寸校验没放行 4K 补位项');
});

test('画布侧封装函数齐备', () => {
  ['function sizeOptionList(', 'function sizeOptionHTML(', 'function sizeOptionValues(',
    'function readSizeChoice(', 'function panelWithRef('].forEach(sig => {
    assert.ok(SRC.includes(sig), 'canvas.js 缺少 ' + sig);
  });
});

test('生成控制面板也要有成本行，不能只有旧面板标分', () => {
  // 用户定的口径是「只有积分，看多大的图扣多少分」。客户最常问的就是「这一下扣多少」，
  // 生成控制面板是最常用的出图入口，以前却没有标分——两侧口径必须一致。
  assert.ok(SRC.includes('data-cost-line'), '生成控制面板缺成本行容器');
  assert.ok(/const updateCostLine = \(\) => \{/.test(SRC), '生成控制面板缺 updateCostLine');
  assert.ok(/updateCostLine\(\); \/\/ innerHTML 已落地/.test(SRC), '成本行没有在首次渲染时填充');
  // 改数量不重绘，必须单独刷新，否则张数停在旧值
  const batchAt = SRC.indexOf('[data-p="batch"]').valueOf();
  assert.ok(/updateCostLine\(\);/.test(SRC.slice(batchAt, batchAt + 400)), '改数量后没刷新成本行');
  // 失败不扣：这是对外承诺，文案里不能少
  assert.ok(/失败不扣/.test(SRC.slice(SRC.indexOf('const updateCostLine'), SRC.indexOf('const updateCostLine') + 1200)));
});

test('所有节点面板切模型都必须同步写回全局配置', () => {
  // 设置页「当前模型（与生成面板同步）」读的是全局 cfg.model。以前在节点面板切模型
  // 只写节点参数，全局不更新，设置页就显示旧模型（2026-10-31 用户反馈）。
  // 四处模型下拉（生成控制面板 / 概念 / 彩平 / 节点检查器）都必须走 syncNodeModelToGlobal。
  assert.ok(SRC.includes('function syncNodeModelToGlobal('), 'canvas.js 缺 syncNodeModelToGlobal');
  let count = 0;
  for (const sig of ['params.model = event.target.value;', 'k.gwParams.model = event.target.value;']) {
    let at = 0;
    while ((at = SRC.indexOf(sig, at + 1)) > 0) {
      count++;
      const after = SRC.slice(at, at + 500);
      assert.ok(/syncNodeModelToGlobal/.test(after),
        '切模型后没写回全局配置（设置页会与面板不同步）：' + sig + ' @' + at);
    }
  }
  assert.ok(count >= 4, '模型切换处理点应至少 4 处，实际 ' + count);
  // 写回要保留该引擎其它字段（apiKey / baseURL 等），不能整个覆盖
  assert.ok(/Object\.assign\(\{\}, engCfgNow, \{ model: /.test(SRC), '写回全局配置时丢了其它字段（会清掉 apiKey）');
});

// 上面那条只做字符串断言，函数体从头到尾没被执行过——所以 0.4.43/0.4.44 带着
// 「P is not defined」发到了客户手上：函数里用了 P 却没写 const P = window.GWProviders，
// 一在节点面板切模型就抛 Uncaught ReferenceError，后面的 schedule()/rerender() 全断掉。
// 这条把函数体真正抽出来执行，专门拦这类「引用未定义变量」。
test('syncNodeModelToGlobal 必须能真正执行（不能引用未定义变量）', () => {
  const start = SRC.indexOf('function syncNodeModelToGlobal(');
  assert.ok(start > 0, 'canvas.js 缺 syncNodeModelToGlobal');
  const end = SRC.indexOf('\n}\n', start);
  assert.ok(end > start, '无法定位 syncNodeModelToGlobal 函数结尾');
  const fnSrc = SRC.slice(start, end + 2);

  let saved = null;
  const fakeWindow = {
    GWProviders: {
      loadConfigs: () => ({ nano: { apiKey: 'sk-test', model: 'old-model', baseURL: 'https://x' } }),
      saveConfig: (id, cfg) => { saved = { id, cfg }; }
    }
  };
  const build = win => new Function('window', fnSrc + '\nreturn syncNodeModelToGlobal;')(win);

  const fn = build(fakeWindow);
  assert.doesNotThrow(() => fn({ engineId: 'nano', model: 'NanoBanana 2.1' }),
    '在节点面板切模型时抛错（线上表现：脚本错误 Uncaught ReferenceError + 生图流程中断）');

  assert.ok(saved, '没有调用 saveConfig，全局配置没写回');
  assert.equal(saved.id, 'nano');
  assert.equal(saved.cfg.model, 'NanoBanana 2.1', 'model 没写回');
  assert.equal(saved.cfg.apiKey, 'sk-test', '写回时丢了 apiKey');
  assert.equal(saved.cfg.baseURL, 'https://x', '写回时丢了 baseURL');

  // providers 未加载（或加载失败）时必须静默返回，不许把异常抛到生成流程里
  const fnNoProviders = build({});
  assert.doesNotThrow(() => fnNoProviders({ engineId: 'nano', model: 'x' }),
    'providers 缺失时抛错，会中断生成流程');
});

