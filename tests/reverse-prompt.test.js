// 反推提示词：一份指令，两个入口，别退回单句硬问。
//
// 2026-11-01 用户反馈（第一轮）：拿一张 CAD 平面布置图去反推，输出却是
// 「现代简约客厅，浅灰色地砖，搭配大理石茶几与深灰色布沙发…」
// 原因是两个入口各自写死了一句「请分析这张室内效果图」，
// 模型被这句话带着走，强行给图纸编出软装和灯光。
//
// 2026-11-01 用户反馈（第二轮）：光说清了图类型还不够，输出的仍是一堆
// 「柔和、通透、低饱和」的观感词。用户要的是「我想做出这样的画面，提示词该怎么写」——
// 也就是生成指令，不是画面描述。于是把输出拆成八块固定结构，
// 让用户能单块改、按出口挑块重拼。详见 providers.js 的 REVERSE_BLOCKS 注释。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const providers = read('providers.js');
const canvas = read('canvas.js');
const studio = read('studio-tools.js');

// 从 providers.js 里抠出 REVERSE_PROMPT 的真实定义并求值，避免测试和实现各写一份文案。
function loadReversePrompt() {
  const start = providers.indexOf('const REVERSE_PROMPT = {');
  assert.ok(start >= 0, 'providers.js 里找不到 REVERSE_PROMPT 定义');
  const end = providers.indexOf('\n  };', start);
  assert.ok(end > start, 'REVERSE_PROMPT 定义没有正常收尾');
  const snippet = providers.slice(start, end + 4);
  // eslint-disable-next-line no-new-func
  return new Function(snippet + '\nreturn REVERSE_PROMPT;')();
}

// 分块运行时不靠静态断言，直接把真实代码抠出来在 Node 里跑，
// 否则「解析器坏了」这件事只有用户点了按钮才会发现。
function loadReverseRuntime() {
  const b0 = providers.indexOf('const REVERSE_BLOCKS = [');
  const b1 = providers.indexOf('const REVERSE_PROMPT = {', b0);
  const f0 = providers.indexOf('function parseReverseBlocks');
  const f1 = providers.indexOf('window.GWProviders = {', f0);
  assert.ok(b0 > 0 && b1 > b0, '找不到 REVERSE_BLOCKS / REVERSE_BLOCK_MODES');
  assert.ok(f0 > 0 && f1 > f0, '找不到 parseReverseBlocks / composeReversePrompt');
  const snippet = providers.slice(b0, b1) + '\n' + providers.slice(f0, f1);
  // eslint-disable-next-line no-new-func
  return new Function(snippet + '\nreturn { REVERSE_BLOCKS, REVERSE_BLOCK_MODES, parseReverseBlocks, composeReversePrompt };')();
}

test('REVERSE_PROMPT 存在且已随 GWProviders 导出', () => {
  const prompt = loadReversePrompt();
  assert.equal(typeof prompt.system, 'string');
  assert.equal(typeof prompt.instruction, 'string');
  assert.ok(prompt.system.length > 10, 'system 提示太短，模型没有角色约束');
  assert.ok(/window\.GWProviders\s*=\s*\{[^}]*REVERSE_PROMPT/.test(providers), 'REVERSE_PROMPT 没有导出到 window.GWProviders');
});

test('指令要求先认图类型，图纸类禁止编软装', () => {
  const { instruction } = loadReversePrompt();
  // 六类图都要点名，否则模型又会把所有输入当成效果图。
  for (const kind of ['透视效果图', '轴测或鸟瞰俯视图', '平面布置图', '立面图', '实景照片', '材质或家具特写']) {
    assert.ok(instruction.includes(kind), '指令里缺少图类型：' + kind);
  }
  // 图纸分支必须明确禁止幻觉，这是用户踩过的坑。
  assert.ok(/图纸不是效果图/.test(instruction), '图纸分支没有说明「图纸不是效果图」');
  assert.ok(/不许编造/.test(instruction), '图纸分支没有禁止编造软装和光效');
  assert.ok(/全部留空/.test(instruction), '图纸分支没说要留空，等于默许模型往里填');
  assert.ok(/不确定的一律留空/.test(instruction), '缺少「不确定就留空」的兜底');
});

test('指令要求输出分块结构，而不是一整段观感描述', () => {
  const { instruction } = loadReversePrompt();
  // 必须要求 JSON，否则解析器只能退回兜底路径，分块面板就白做了
  assert.ok(/只输出一个 JSON/i.test(instruction), '没有要求输出 JSON');
  assert.ok(/不要 Markdown/i.test(instruction), '没有禁止 Markdown 代码块');
  // 八个字段必须逐个点名，模型才不会自己发明字段名
  for (const key of ['kind', 'space', 'style', 'hard', 'soft', 'light', 'color', 'material', 'negative']) {
    assert.ok(instruction.includes('"' + key + '"'), '指令里缺少字段：' + key);
  }
  // 空话黑名单：上一版就是被这些词占了版面
  for (const word of ['柔和', '通透', '低饱和', '空间感十足']) {
    assert.ok(instruction.includes(word), '空话黑名单里少了：' + word);
  }
  // 每个字段的字数要有上限，否则拼出来几百字，画布节点放不下
  const m = instruction.match(/(\d+)\s*[～~]\s*(\d+)\s*字/);
  assert.ok(m, '没有给出单字段字数区间');
  const [min, max] = [Number(m[1]), Number(m[2])];
  assert.ok(min >= 10 && max <= 100, '单字段字数区间不合理：' + min + '～' + max);
});

test('分块定义覆盖八个字段，每个出口挑的块对得上用途', () => {
  const { REVERSE_BLOCKS, REVERSE_BLOCK_MODES } = loadReverseRuntime();
  const keys = REVERSE_BLOCKS.map(b => b.key);
  assert.deepEqual(keys, ['space', 'style', 'hard', 'soft', 'light', 'color', 'material', 'negative'],
    '分块顺序或字段变了，拼接出来的句子会散');
  REVERSE_BLOCKS.forEach(b => {
    assert.ok(b.label && b.hint, b.key + ' 缺 label 或 hint，面板上没法给用户解释');
  });
  // 文生图：原图不参与，视角和布局必须写
  assert.ok(REVERSE_BLOCK_MODES.gen.includes('space'), '文生图不能丢空间与视角');
  assert.ok(REVERSE_BLOCK_MODES.gen.includes('negative'), '文生图不能丢负面词');
  // 图生图：结构由原图定，再写视角会跟原图打架
  assert.ok(!REVERSE_BLOCK_MODES.edit.includes('space'), '图生图不该带空间与视角');
  // 局部重绘：默认只带软装，其余由用户自己勾
  assert.deepEqual(REVERSE_BLOCK_MODES.local, ['soft'], '局部重绘默认块变了会一次改太多东西');
});

test('解析器能扛住围栏、前言和坏 JSON', () => {
  const { parseReverseBlocks, composeReversePrompt } = loadReverseRuntime();
  const good = JSON.stringify({
    kind: 'A 透视效果图', space: '32㎡ 客厅，平视一点透视', style: '现代简约',
    hard: '无主灯跌级吊顶', soft: '三人位亚麻沙发靠左墙', light: '落地窗侧光 4000K',
    color: '奶油白 60%', material: '岩板哑光细纹', negative: '人物、文字、水印'
  });
  // 1. 正常 JSON
  assert.equal(parseReverseBlocks(good).style, '现代简约');
  // 2. 包了 ```json 围栏 + 前后带话（模型最常见的回法）
  const fenced = '好的，以下是分析：\n```json\n' + good + '\n```\n希望有帮助';
  assert.equal(parseReverseBlocks(fenced).space, '32㎡ 客厅，平视一点透视');
  // 3. JSON 语法坏了，只能靠正则逐字段抠
  const broken = '{ "space": "客厅", "style": "新中式", "hard": 坏掉了';
  const salvaged = parseReverseBlocks(broken);
  assert.equal(salvaged.space, '客厅');
  assert.equal(salvaged.style, '新中式');
  // 4. 完全不是 JSON，返回 null 让调用方走原文兜底
  assert.equal(parseReverseBlocks('这是一张客厅照片'), null);
  assert.equal(parseReverseBlocks(''), null);

  // 拼接：gen 带视角，edit 不带，负面变成一句话而不是生硬字段
  const blocks = parseReverseBlocks(good);
  const gen = composeReversePrompt(blocks, 'gen');
  const edit = composeReversePrompt(blocks, 'edit');
  assert.ok(gen.includes('平视一点透视'), '文生图拼出来丢了视角');
  assert.ok(!edit.includes('平视一点透视'), '图生图拼出来还带着视角，会跟原图打架');
  assert.ok(gen.includes('画面中不要出现：'), '负面词没有转成句子');
  assert.ok(gen.endsWith('。'), '拼接结果没有正常收尾');
  assert.ok(!/、。/.test(gen), '拼接处出现了多余的顿号');
});

test('两个入口都读同一份指令，没有各写一句', () => {
  assert.ok(/GWProviders\.REVERSE_PROMPT/.test(canvas), 'canvas.js 没有读 REVERSE_PROMPT');
  assert.ok(/reverseLib\.instruction/.test(canvas), 'canvas.js 没有用共用指令当问题');
  assert.ok(/REVERSE_PROMPT/.test(studio), 'studio-tools.js 没有读 REVERSE_PROMPT');
  assert.ok(/reverseLib\.instruction/.test(studio), 'studio-tools.js 没有用共用指令当问题');
});

test('老的「请分析这张室内效果图」不再出现', () => {
  // 这句是那次离谱输出的直接诱因：先把输入定义成效果图，模型就照着效果图编。
  for (const [name, text] of [['canvas.js', canvas], ['studio-tools.js', studio]]) {
    assert.ok(!text.includes('请分析这张室内效果图'), name + ' 里还留着旧的效果图硬问句');
  }
});

test('画布节点把 JSON 转成整段提示词再往下游传', () => {
  // 直接把 JSON 原文丢给生图节点等于废掉这条链
  assert.ok(/gwReverseBlocks/.test(canvas), '画布节点没有保存分块');
  assert.ok(/composeReversePrompt\(blocks, 'gen'\)/.test(canvas), '画布节点没有把分块拼成整段');
  assert.ok(/parseReverseBlocks/.test(canvas), '画布节点没有解析分块');
});

test('工作台面板有分块勾选、单块编辑和三个出口', () => {
  assert.ok(/data-rev-check/.test(studio), '没有勾选框，用户没法挑块');
  assert.ok(/data-rev-text/.test(studio), '分块不能单独编辑');
  assert.ok(/data-rev-all/.test(studio), '没有全选');
  assert.ok(/id="rev-blocks"/.test(studio), '没有分块区域');
  // 三个出口必须都在：分别对应 重新生成 / 保持构图改 / 只改一块
  assert.ok(/id="rev-txt2img"/.test(studio), '缺「文生图验证」出口');
  assert.ok(/id="rev-img2img"/.test(studio), '缺「按这张图改」出口');
  assert.ok(/id="rev-local"/.test(studio), '缺「去局部重绘」出口');
  // 三个都真的会出图扣分，必须让用户看得见
  assert.ok(/各扣约 1 积分/.test(studio), '没有提示按钮会扣积分');
  // 图生图出口要自动去掉视角块
  assert.ok(/compose\('edit'\)/.test(studio), '图生图出口没有走 edit 拼接');
});

test('画布侧提供了两个落节点的接口', () => {
  assert.ok(/createTextToImageWithPrompt/.test(canvas), '画布没有提供「按提示词建文生图节点」的接口');
  assert.ok(/createImageToImageWithPrompt/.test(canvas), '画布没有提供「按提示词建图生图节点」的接口');
  // 图生图必须 singleSource，否则会把当前选中的其它图一起接进来，结构参考就乱了
  assert.ok(/createGeneratorNode\(record\.konva, at, null, \{ singleSource: true \}\)/.test(canvas),
    '图生图节点没有限制只用一张来源图');
});

// 2026-11-01 用户要求：「反推提示词也要做几个常用好用的模型下拉菜单让他们自己选」。
// 之前用的是设置里那一项识别模型（默认还写死 gpt-5），用户既看不到在用什么，也没法换。

// pool: visionModelsForEngine 吐出的模型 id 列表；cfgs: loadConfigs 的返回值。
// 两个都开成参数，是为了能模拟「中转目录同步下来两百多条」这种真实情况。
function loadReverseModelOptions(pool, cfgs) {
  const start = providers.indexOf('const REVERSE_MODEL_ORDER');
  const end = providers.indexOf('const REVERSE_MODEL_KEY', start);
  assert.ok(start > 0 && end > start, 'providers.js 里找不到 REVERSE_MODEL_ORDER / reverseModelOptions');
  const snippet = providers.slice(start, end);
  const poolJson = JSON.stringify(pool || ['gpt-5', 'claude-sonnet-4-20250514', 'gpt-4o']);
  const cfgJson = JSON.stringify(cfgs || { apollo: { apiKey: 'k', visionModel: 'gpt-4o', model: 'gemini-3-pro-image' } });
  const harness = `
    const PROVIDERS = {
      apollo: { label: '阿波罗（中转站）' },
      openai: { label: 'OpenAI' },
      deepseek: { label: 'DeepSeek' },
      custom: { label: '自定义（OpenAI 兼容）' }
    };
    const loadConfigs = () => (${cfgJson});
    const aliasOf = id => ({ 'gpt-4o': 'GPT-4o Vision' }[id] || id);
    const visionModelsForEngine = () => (${poolJson}).map(id => ({ id }));
    ${snippet}
    return reverseModelOptions();
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)();
}

test('模型下拉：只列已填 Key 的引擎，常用模型排前面', () => {
  const options = loadReverseModelOptions();
  assert.ok(Array.isArray(options) && options.length >= 3, '可用模型太少，下拉菜单没内容');
  // 常用度排序：gpt-4o 必须排第一，不能还是 gpt-5 打头（多半没渠道，一调就 503）
  assert.equal(options[0].model, 'gpt-4o', '第一项应该是 GPT-4o');
  assert.equal(options[0].engineId, 'apollo');
  assert.equal(options[0].alias, 'GPT-4o Vision', 'alias 没走 aliasOf');
  assert.ok(options.some(o => o.model === 'claude-sonnet-4-20250514'), '登记表里的其他看图模型没进列表');
  // 阿波罗的 model 是出图模型，不能混进看图下拉（选了必然报错或答非所问）
  assert.ok(!options.some(o => /image/i.test(o.model)), '出图模型混进了看图下拉');
  // 没填 Key 的引擎不能出现（否则用户选了必然报错）
  assert.ok(options.every(o => o.engineId === 'apollo'), '未配置 Key 的引擎被列进来了');
  // 每一项都要有说明，下拉里只给模型名用户没法判断
  options.forEach(o => {
    assert.ok(typeof o.note === 'string' && o.note.length > 0, o.model + ' 没有说明文案');
    assert.equal(typeof o.engineLabel, 'string');
  });
  // 去重：同引擎同模型只出现一次
  const keys = options.map(o => o.engineId + '|' + o.model);
  assert.equal(new Set(keys).size, keys.length, '下拉里出现了重复模型');
});

test('模型下拉不会被中转的整本模型目录灌满', () => {
  // 2026-11-01 端到端实测发现：阿波罗的模型目录同步下来 250+ 条，
  // 早先的写法把 visionModelsForEngine() 整个丢进 <select>，排序只提前不减少，
  // 下拉打开像翻通讯录。这里用同样的规模跑一遍，确保白名单过滤真的生效。
  const junk = [];
  for (let i = 0; i < 260; i++) junk.push('some-vl-model-' + i);
  const options = loadReverseModelOptions(['gpt-4o', 'gpt-4.1', 'gemini-2.5-pro'].concat(junk));
  assert.ok(options.length <= 10, '下拉条数 ' + options.length + ' 条，白名单过滤没生效');
  assert.ok(options.length >= 3, '过滤过头了，常用模型都没了');
  assert.ok(!options.some(o => /^some-vl-model-/.test(o.model)), '目录里的杂项模型漏进了下拉');
  // 顺序仍然是白名单顺序，第一个必须是默认值
  assert.equal(options[0].model, 'gpt-4o');
});

test('用户手填的识别模型即使不在登记表里也留在下拉', () => {
  const options = loadReverseModelOptions(['gpt-4o'], { apollo: { apiKey: 'k', visionModel: 'my-private-vlm' } });
  const found = options.find(o => o.model === 'my-private-vlm');
  assert.ok(found, '手填的识别模型被过滤掉了 —— 用户填了却选不到，比看不到更费解');
  assert.ok(found.note && found.note.length > 0, '手填的识别模型没有说明文案，下拉里看不出它是哪来的');
  // 它必须排在白名单模型之后，不能顶掉默认值
  assert.equal(options[0].model, 'gpt-4o');
});

test('模型选择会被记住，并且导出给两个入口用', () => {
  for (const name of ['reverseModelOptions', 'readReverseChoice', 'saveReverseChoice']) {
    assert.ok(new RegExp('window\\.GWProviders\\s*=\\s*\\{[^}]*\\b' + name + '\\b', 's').test(providers),
      name + ' 没有导出到 window.GWProviders');
  }
  assert.ok(/gw_reverse_model/.test(providers), '没有存用户选的模型');
});

test('画布节点上有模型下拉，选完写回节点并存档', () => {
  assert.ok(/function showInlineReverseModelMenu/.test(canvas), '画布没有模型下拉菜单');
  assert.ok(/reverseModelConfig\(group\)/.test(canvas), '画布没有按「节点 > 上次选择 > 设置」解析模型');
  assert.ok(/group\.gwReverseEngine = option\.engineId/.test(canvas), '选完没写回节点');
  assert.ok(/saveReverseChoice\(option\.engineId, option\.model\)/.test(canvas), '选完没记住，下一个节点又要重选');
  // 序列化：不存档的话重开项目又变回默认模型
  assert.ok(/reverseEngine: k\.gwReverseEngine/.test(canvas), '节点的模型选择没有存档');
  assert.ok(/reverseModel: k\.gwReverseModel/.test(canvas), '节点的模型选择没有存档');
});

test('工作台反推面板也有模型下拉', () => {
  assert.ok(/id="rev-model"/.test(studio), '工作台反推面板没有模型下拉');
  assert.ok(/reverseModelOptions\(\)/.test(studio), '工作台没有读共用模型清单');
  assert.ok(/saveReverseChoice\(current\.engineId, current\.model\)/.test(studio), '工作台分析成功后没记住模型');
  // 503 要给能照做的提示，而不是把原始报错甩给用户
  assert.ok(/没有渠道/.test(studio), '模型没渠道时没有给出换模型的提示');
});

// ---------------------------------------------------------------------------
// 2026-11-01 用户反馈（第三轮）：面板一开就重推一遍、挡住整个画布、最终提示词改不了。
// 这三条都是「用起来才知道」的问题，靠界面截图看不出来，所以在这里钉死。
// ---------------------------------------------------------------------------

const html = read('index.html');

test('反推面板是浮窗：不再挂全屏遮罩，点画布能继续干活', () => {
  // 老实现是 mask.className = 'studio-editor-mask'（position:fixed; inset:0 + 半透明底）
  // 整个画布被盖住，用户在反推的时候没法去生图。
  const start = studio.indexOf('async function reversePrompt()');
  const end = studio.indexOf('function openTool(kind, context)', start);
  assert.ok(start > 0 && end > start, '找不到 reversePrompt 函数');
  const body = studio.slice(start, end);
  assert.ok(!/studio-editor-mask/.test(body), '反推面板又退回全屏遮罩了，会挡住画布');
  assert.ok(/rev-float/.test(body), '反推面板没有用浮窗样式 rev-float');
  assert.ok(/document\.body\.appendChild\(panel\)/.test(body), '面板没有直接挂到 body（还套着遮罩？）');
  // 点空白关闭的逻辑只对模态有意义，浮窗里必须去掉，否则点画布就没了
  assert.ok(!/e\.target === mask/.test(body), '浮窗里还留着「点空白关闭」，点画布会把面板关掉');
  // 样式：浮窗要 fixed 定位 + 独立层，且不能有 scrim
  assert.ok(/\.rev-float\s*\{[^}]*position:\s*fixed/.test(html), 'rev-float 没有 fixed 定位');
  assert.ok(!/\.rev-float\s*\{[^}]*--scrim/.test(html), 'rev-float 还带着半透明遮罩底色');
});

test('反推面板可拖动、可最小化，位置会记住', () => {
  assert.ok(/gw_reverse_panel_pos/.test(studio), '没有记住面板位置，每次打开都回到屏幕正中');
  assert.ok(/gw_reverse_panel_min/.test(studio), '没有记住最小化状态');
  assert.ok(/addEventListener\('mousedown'/.test(studio), '标题栏没有拖动');
  assert.ok(/classList\.toggle\('rev-min'/.test(studio), '没有最小化切换');
  // 最小化必须真的只剩一条标题栏
  assert.ok(/\.rev-float\.rev-min\s*\{[^}]*height:\s*46px/.test(html), '最小化的高度没有生效');
  assert.ok(/\.rev-float\.rev-min\s*>\s*\*:not\(\.studio-editor-head\)\s*\{[^}]*display:\s*none/.test(html),
    '最小化后正文没隐藏，面板还是占着一大块');
  // 标题栏上的按钮不能触发拖动
  assert.ok(/closest\('button,select,input,textarea,a'\)/.test(studio), '点标题栏按钮会被当成拖动起点');
});

test('重开面板先读上次结果，不再自动重跑模型', () => {
  // 用户原话：「不是第一次推过之后，这个就应该保存的吗」
  assert.ok(/getTextResult/.test(canvas), 'canvas.js 没有回读结果卡的接口');
  assert.ok(/addTextResultNode, getTextResult,/.test(canvas), 'getTextResult 没有导出给工作台');
  assert.ok(/API\(\)\.getTextResult\(media\.id, 'reverse'\)/.test(studio), '工作台打开面板时没有先查有没有上次结果');
  // run() 只允许出现在「没有缓存」的分支里
  const start = studio.indexOf('async function reversePrompt()');
  const end = studio.indexOf('function openTool(kind, context)', start);
  const body = studio.slice(start, end);
  const guard = body.indexOf('if (cached && cached.blocks)');
  assert.ok(guard > 0, '没有「有缓存就直接回填」的分支');
  const runCalls = body.split('run();').length - 1;
  assert.equal(runCalls, 1, 'run() 应该只在无缓存分支调用一次，现在调了 ' + runCalls + ' 次（打开就重推的老毛病）');
  assert.ok(body.indexOf('run();') > guard, 'run() 出现在缓存判断之前，等于无条件重推');
  // 手动点「重新分析」仍然要能重跑
  assert.ok(/q\('#rev-again'\)\.onclick = run/.test(studio), '「重新分析」按钮没接上，用户没法强制重跑');
});

test('反推的八块结构随结果卡存档，并且能读回来', () => {
  // 只存拼好的整段话是没法回填面板的：分块信息丢了就得重推
  assert.ok(/grp\.gwReverseBlocks = data\.reverseBlocks/.test(canvas), '结果卡没有接收分块结构');
  assert.ok(/reverseBlocks: k\.gwReverseBlocks \|\| undefined/.test(canvas), '分块结构没有进项目存档');
  assert.ok(/reverseBlocks: blocks && Object\.assign\(\{\}, blocks\)/.test(studio), '反推成功后没把分块交给结果卡');
  assert.ok(/extraBlocks/.test(canvas), 'addTextResultNode 没有扩展参数位');

  // 真实执行：把 getTextResult 抠出来，喂一个假 nodes，确认能读回并区分有无分块
  const s = canvas.indexOf('function getTextResult');
  const e = canvas.indexOf('function placeNode', s);
  assert.ok(s > 0 && e > s, '找不到 getTextResult 的实现');
  const snippet = canvas.slice(s, e);
  const blocks = { kind: 'A 透视效果图', space: '客厅', style: '现代' };
  const harness = `
    const nodes = [
      { id: 'n1', type: 'note', konva: { gwResultKey: 'reverse:img1', gwText: '客厅一段话', gwReverseBlocks: ${JSON.stringify(blocks)} } },
      { id: 'n2', type: 'note', konva: { gwResultKey: 'reverse:img2', gwText: '旧卡只有文字', gwReverseBlocks: null } },
      { id: 'n3', type: 'note', konva: { gwResultKey: 'chat:img1', gwText: '别的工具结果' } }
    ];
    ${snippet}
    return { hit: getTextResult('img1', 'reverse'), legacy: getTextResult('img2', 'reverse'), miss: getTextResult('img3', 'reverse') };
  `;
  // eslint-disable-next-line no-new-func
  const r = new Function(harness)();
  assert.ok(r.hit, '有存档的结果卡读不回来');
  assert.deepEqual(r.hit.blocks, blocks, '读回来的分块和存进去的不一致');
  assert.equal(r.hit.text, '客厅一段话');
  assert.ok(r.legacy && r.legacy.blocks === null, '老卡（无分块）应该返回 blocks=null 而不是报错');
  assert.equal(r.miss, null, '没有存档时应该返回 null，让面板去调模型');
  // 键必须带工具名，别把对话结果当成反推结果
  assert.ok(!r.hit || r.hit.text !== '别的工具结果', 'getTextResult 没区分工具类型');
});

test('完整提示词可以直接改，改完以手动版为准', () => {
  const start = studio.indexOf('async function reversePrompt()');
  const end = studio.indexOf('function openTool(kind, context)', start);
  const body = studio.slice(start, end);
  // readonly 是老问题：用户要的是「提示词后面有个修改按钮」，结果连框都不让改
  assert.ok(!/<textarea id="rev-out"[^>]*readonly/.test(body), '最终提示词框还是只读的');
  assert.ok(/out\.addEventListener\('input'/.test(body), '改了文字没有监听，切不到手动版');
  assert.ok(/manual = true/.test(body), '没有手动版状态');
  // 手动版必须优先于自动拼接，否则用户一改就被覆盖
  const composeIdx = body.indexOf('const compose = (mode)');
  const manualIdx = body.indexOf('if (manual) return String(out.value', composeIdx);
  const blocksIdx = body.indexOf('if (!blocks) return rawText', composeIdx);
  assert.ok(manualIdx > composeIdx, 'compose 里没有手动版分支');
  assert.ok(manualIdx < blocksIdx, '手动版分支排在自动拼接之后，等于没生效');
  // 三个出口都要走 compose，别自己另拼一份
  ['rev-txt2img', 'rev-img2img', 'rev-local'].forEach(id => {
    const at = body.indexOf("q('#" + id + "')");
    assert.ok(at > 0, id + ' 按钮没绑定');
    assert.ok(/compose\('(gen|edit|local)'\)/.test(body.slice(at, at + 260)), id + ' 没走 compose');
  });
  // 手改过的文字要能存回画布，不然一关面板就丢
  assert.ok(/persistResult/.test(body), '手动版没有写回结果卡');
  assert.ok(/恢复自动拼接/.test(body), '没有回退到自动拼接的入口');
});

