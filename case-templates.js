/* 新手案例模板
 *
 * 给第一次打开 GIWIN Studio 的用户一条能照着走的完整链路：
 * 模板一（第一次出图）：单机位主流程 + 多机位示例，便签讲清连线方式与机位规则；
 * 模板二（节点详解）：每类功能节点一整行「输入图 → 节点 → 输出示意 → 详解便签」，
 *   便签按「作用 / 什么时候用 / 怎么用 / 提示」四段写清楚；
 * 模板三（一条龙闭环）：从草图到交付全流程串成链，跨行连线表达数据流向，
 *   概念定调 → 空间渲染 → 软装选品（回渲染闭环）→ 平面表现 → 版式交付。
 *
 * 模板本质就是一份工作流节点图（同「保存当前工作流」的格式），
 * 由 canvas.js 的 instantiateTemplate() 原样还原到画布。
 *
 * 两点工程约定：
 * 1. 占位图在放置时写进项目 Content 目录（和手动导入的图片完全一样），
 *    所以它们能正常预览、能拉线、能被生成节点引用；用户换成自己的图后删掉即可。
 * 2. 生成节点实际渲染高度比常量高（有机位框/参数行），所以模板里只给估算 y，
 *    放置完成后由 align 规格按画布真实尺寸重新做中轴对齐（GW_useStarterTemplate 里执行）。
 */
(function () {
  'use strict';

  const IMG_W = 622, IMG_H = 408;      // createImageNode 按图片比例 × NODE_CARD_H 算出来的实际尺寸
  const NOTE_W = 320, NOTE_H = 408;
  const GEN_W = 286, GEN_H = 112;      // 估算值，落位后按真实高度重新对齐
  const SOFT_W = 400;                  // 软装节点 400×408
  const LAYOUT_W = 420;                // 版式节点 420×408
  const CTRL_W = 320;                  // 材质/光影节点宽度
  const GAP = 120;                     // 列间距
  const ROW_GAP = 60;                  // 同列卡片间距

  function placeholderImage(title, subtitle) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f5f1ea';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c9c2b6';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8d867b';
    ctx.font = '600 34px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 12);
    ctx.fillStyle = '#a9a29a';
    ctx.font = '400 19px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 32);
    return canvas.toDataURL('image/png');
  }

  /* ---------------- 模板一：第一次出图（单机位 + 多机位示例） ---------------- */

  const NOTES1 = [
    {
      id: 'case-n1',
      title: '第 1 步 · 换图与连线',
      text: '左列两张是占位图：上面放户型图（决定空间结构），下面放风格参考（决定材质和气质）。\n' +
        '把自己的图拖进画布后，用任意一种方式接到生成节点：\n' +
        '① 从图片右侧的小圆点拖一条线，接到节点的「结构」或「风格」端口；\n' +
        '② 直接把图片拖到节点面板上的机位框 / 风格参考框；\n' +
        '③ 右键图片 →「新建空间渲染节点」，自动接好线。\n' +
        '接好后把占位图删掉就行。'
    },
    {
      id: 'case-n2',
      title: '第 2 步 · 机位怎么排',
      text: '「结构」端口：一张图就是一个机位，最多接 4 张。\n' +
        '· 单机位（本行示例）：只连 1 张户型图/结构图，生成一个角度的室内效果图；\n' +
        '· 多机位（下一行示例）：把多张户型图/结构图逐张都连到「结构」端口，每个机位各出一张图，面板里用「机位 1 / 2 / 3…」切换。\n' +
        '「风格」端口只接 1 张风格参考图，所有机位共用同一套材质和气质。'
    },
    {
      id: 'case-n3',
      title: '多机位示例 · 看这行',
      text: '下面这一行就是多机位的排法：两张户型图逐张连到同一个「结构」端口（机位 1、机位 2），\n' +
        '生成节点右侧会出现两个结果位，一个机位对应一张结果。\n' +
        '换成自己的图后，同样从图片右侧圆点拖线到「结构」端口即可，最多 4 张。'
    },
    {
      id: 'case-n4',
      title: '第 3 步 · 出图之后',
      text: '点生成节点选模型、写一句风格描述（如「现代简约、浅色木饰面、傍晚自然光」），点「生成」。\n' +
        '结果卡出现在节点右侧——虚线占位图就是这个位置的示意，生成后会被真实结果替代。\n' +
        '结果可以继续精修、高清放大或拿去排版。\n' +
        '跑通一次后全选节点，点「保存当前工作流」，下次一键复用。'
    }
  ];

  function layout1() {
    const imgLeft = 0, imgTop = 0;
    const imgBottomY = imgTop + IMG_H + ROW_GAP;            // 468
    const genX = imgLeft + IMG_W + GAP;                     // 742
    const resX = genX + GEN_W + GAP;                        // 1148
    const flowY1 = (imgTop + imgBottomY + IMG_H) / 2;       // 438：单机位行中轴
    const gen1Y = flowY1 - GEN_H / 2;                       // 382（估算，落位后对齐）
    const row2Y = 1020;                                     // 多机位行（便签②底边 856 + 间距）
    const img3Y = row2Y, img4Y = row2Y + IMG_H + ROW_GAP;   // 1020 / 1488
    const flowY2 = (img3Y + img4Y + IMG_H) / 2;             // 1458：多机位行中轴
    const noteX = resX + IMG_W + GAP;                       // 1890
    return {
      img1: { x: imgLeft, y: imgTop },
      img2: { x: imgLeft, y: imgBottomY },
      gen1: { x: genX, y: gen1Y },
      res1: { x: resX, y: flowY1 - IMG_H / 2 },             // 234
      img3: { x: imgLeft, y: img3Y },
      img4: { x: imgLeft, y: img4Y },
      gen2: { x: genX, y: flowY2 - GEN_H / 2 },             // 1402（估算）
      res2: { x: resX, y: img3Y },                          // 与机位 1 同排
      res3: { x: resX, y: img4Y },                          // 与机位 2 同排
      n1: { x: noteX, y: imgTop },
      n2: { x: noteX, y: imgTop + NOTE_H + 40 },            // 448
      n3: { x: noteX, y: row2Y },
      n4: { x: noteX + NOTE_W + 40, y: flowY2 - NOTE_H / 2 } // 1254
    };
  }

  async function starterGraph() {
    const api = window.GWCanvas;
    const placeholders = [
      ['structure', '户型图 / 结构图', '换成你的户型图，从这里连线到「结构」端口'],
      ['style', '风格参考图', '换成你喜欢的效果图，从这里连线到「风格」端口'],
      ['result', '生成结果（示意）', '点「生成」后，结果卡出现在空间渲染节点的这个位置'],
      ['cam1', '户型图 A · 机位 1', '多机位示例：连接到「结构」端口即为机位 1'],
      ['cam2', '户型图 B · 机位 2', '多机位示例：再连一张就是机位 2（最多 4 张）'],
      ['resCam1', '生成结果 · 机位 1（示意）', '机位 1 的结果卡出现在这个位置'],
      ['resCam2', '生成结果 · 机位 2（示意）', '机位 2 的结果卡出现在这个位置']
    ];
    const stored = {};
    if (api && typeof api.saveProjectImageDataURL === 'function') {
      for (const [key, title, subtitle] of placeholders) {
        try {
          const saved = await api.saveProjectImageDataURL(placeholderImage(title, subtitle));
          stored[key] = { src: saved.name, ow: saved.w || 640, oh: saved.h || 420 };
        } catch (error) {
          console.warn('[case-template] 占位图写入项目失败，改用内联图片：', error && error.message);
        }
      }
    }
    placeholders.forEach(([key, title, subtitle]) => {
      if (!stored[key]) stored[key] = { src: placeholderImage(title, subtitle), ow: 640, oh: 420 };
    });

    const pos = layout1();
    const img = (id, key, label, name, p) => ({
      id, type: 'image', x: p.x, y: p.y, w: IMG_W, h: IMG_H,
      src: stored[key].src, ow: stored[key].ow, oh: stored[key].oh, label, name
    });
    return {
      version: 1,
      nodes: [
        { id: 'case-n1', type: 'note', x: pos.n1.x, y: pos.n1.y, title: NOTES1[0].title, text: NOTES1[0].text, noteKind: 'record', status: 'open' },
        img('case-i1', 'structure', '户型图', '户型图', pos.img1),
        img('case-i2', 'style', '风格参考', '风格参考', pos.img2),
        { id: 'case-n2', type: 'note', x: pos.n2.x, y: pos.n2.y, title: NOTES1[1].title, text: NOTES1[1].text, noteKind: 'record', status: 'open' },
        { id: 'case-g1', type: 'generator', x: pos.gen1.x, y: pos.gen1.y },
        img('case-r1', 'result', '生成结果（示意）', '生成结果（示意）', pos.res1),
        img('case-i3', 'cam1', '户型图 A · 机位 1', '户型图 A · 机位 1', pos.img3),
        img('case-i4', 'cam2', '户型图 B · 机位 2', '户型图 B · 机位 2', pos.img4),
        { id: 'case-g2', type: 'generator', x: pos.gen2.x, y: pos.gen2.y },
        img('case-r2', 'resCam1', '生成结果 · 机位 1（示意）', '生成结果 · 机位 1（示意）', pos.res2),
        img('case-r3', 'resCam2', '生成结果 · 机位 2（示意）', '生成结果 · 机位 2（示意）', pos.res3),
        { id: 'case-n3', type: 'note', x: pos.n3.x, y: pos.n3.y, title: NOTES1[2].title, text: NOTES1[2].text, noteKind: 'record', status: 'open' },
        { id: 'case-n4', type: 'note', x: pos.n4.x, y: pos.n4.y, title: NOTES1[3].title, text: NOTES1[3].text, noteKind: 'record', status: 'open' }
      ],
      edges: [
        { id: 'case-e1', from: 'case-i1', to: 'case-g1', port: 'structure', role: 'flow' },
        { id: 'case-e2', from: 'case-i2', to: 'case-g1', port: 'style', role: 'flow' },
        { id: 'case-e3', from: 'case-g1', to: 'case-r1', role: 'flow' },
        { id: 'case-e4', from: 'case-i3', to: 'case-g2', port: 'structure', role: 'flow' },
        { id: 'case-e5', from: 'case-i4', to: 'case-g2', port: 'structure', role: 'flow' },
        { id: 'case-e6', from: 'case-g2', to: 'case-r2', role: 'flow' },
        { id: 'case-e7', from: 'case-g2', to: 'case-r3', role: 'flow' }
      ],
      // 落位后按真实渲染尺寸重排中轴：生成节点比常量高，估算 y 会偏低
      align: [
        { center: ['case-i1', 'case-i2'], move: ['case-g1', 'case-r1'] },
        { center: ['case-i3', 'case-i4'], move: ['case-g2'] }
      ]
    };
  }

  /* ---------------- 模板二：节点详解（每类节点一整行完整链路） ----------------
   * 每行固定结构：输入图 → 功能节点 → 输出示意 → 详解便签。
   * 便签统一按「作用 / 什么时候用 / 怎么用 / 提示」四段写，
   * 让用户不看文档也能知道：这节点干嘛的、什么时候轮到它、具体怎么操作。
   */

  const ROW2 = 560;                                     // 每行高度（图片 408 + 间距 152）
  const COL2 = { in: 0, node: 742, out: 1148, note: 1890 };

  const GUIDE2 = [
    {
      key: 'render',
      kind: 'generator', params: null,
      inTitle: '户型图 / 结构图', inSub: '连到「结构」端口，一张图就是一个机位',
      outTitle: '室内效果图（示意）', outSub: '生成结果出现在节点右侧，可继续精修',
      title: '① 空间渲染 · 核心出图节点',
      text: '【作用】把户型图/结构图变成可交付的室内效果图，整个流程的核心。\n' +
        '【什么时候用】户型确定后，要照片级效果图给业主看效果、定方案。\n' +
        '【怎么用】①连 1~4 张户型图到「结构」端口（一张图一个机位）\n' +
        '②可选：连 1 张参考图到「风格」端口定材质气质\n' +
        '③双击节点选模型、写风格描述，点「生成」。\n' +
        '【提示】要多角度就多连几张结构图；换风格只换「风格」端口的图，结构不用重连。'
    },
    {
      key: 'plan',
      kind: 'generator', params: { designMode: 'plan' },
      inTitle: '轴测图 / 实拍空间', inSub: '用正俯视的图，彩平最准确',
      outTitle: '彩色平面图（示意）', outSub: '带家具布局的彩平，汇报必备',
      title: '② 平面表现 · 彩平图',
      text: '【作用】把轴测图/实拍空间变成带家具布局的彩色平面图。\n' +
        '【什么时候用】效果图做完后，汇报文件需要彩平；或业主只想快速看布局。\n' +
        '【怎么用】①准备一张正俯视的轴测图\n' +
        '②从轴测图右侧圆点拖线连到本节点\n' +
        '③双击节点选风格、点「生成」。\n' +
        '【提示】俯视角度越正，墙体和家具越准；斜视角轴测图出的彩平会变形。'
    },
    {
      key: 'concept',
      kind: 'generator', params: { designMode: 'concept' },
      inTitle: '草图 / 户型图 / 任意参考', inSub: '只当空间关系参考，模型可自由发挥',
      outTitle: '概念氛围图（示意）', outSub: '快速定调，不承诺精确一致',
      title: '③ 概念效果图 · 前期定调',
      text: '【作用】方案前期的氛围图：只参考空间关系，允许模型重组结构、自选机位。\n' +
        '【什么时候用】项目刚开始、户型没定死，想先和业主对齐风格方向。\n' +
        '【怎么用】①连一张草图/户型图/任意参考图\n' +
        '②双击节点选机位（剖透视 / 室内人视 / 鸟瞰 / 自由）\n' +
        '③点「生成」，快速出几张感觉图。\n' +
        '【提示】它不承诺和户型精确一致——要快速定调用它，要精确交付用「空间渲染」。'
    },
    {
      key: 'material',
      kind: 'material',
      inTitle: '材质参考图', inSub: '大理石/木饰面/涂料样板照，连到材质节点',
      outTitle: '空间渲染节点（示意）', outSub: '材质节点连到它，出图材质以参考为准',
      title: '④ 空间材质 · 精确控制质感',
      text: '【作用】指定「用什么材质」：接管出图的表面质感、纹理、软装气质，但不动空间结构。\n' +
        '【什么时候用】有明确材质参考（业主给了大理石样板照、木饰面照片），要精确控质感。\n' +
        '【怎么用】①右键材质参考图→「空间材质」，或从圆点拖线连到材质节点\n' +
        '②再把材质节点连到空间渲染节点\n' +
        '③生成时材质以参考图为准，结构仍来自户型图。\n' +
        '【提示】和「风格端口」的区别：风格端口整体定调，材质节点精确接管表面质感，可同时用。'
    },
    {
      key: 'light',
      kind: 'light',
      inTitle: '户型图 / 结构图', inSub: '照常连到「结构」端口',
      outTitle: '空间渲染节点（示意）', outSub: '光影节点连到它，接管灯光与天气',
      title: '⑤ 光影参数 · 统一光照',
      text: '【作用】统一控制出图的光照：室内灯光组合、天气氛围、强度、色温。\n' +
        '【什么时候用】同一套方案要出白天版/黄昏版/夜景版；或多张图要求光影统一。\n' +
        '【怎么用】①右键生成节点端口拖出「光影参数」，或新建后拖线连到生成节点\n' +
        '②双击光影节点调灯光、天气、强度、色温\n' +
        '③生成节点自己的光影设置会被接管（面板显示「以光影参数为准」）。\n' +
        '【提示】做整套方案时，用一个光影节点管住所有机位，出的图光影才统一。'
    },
    {
      key: 'soft',
      kind: 'soft',
      inTitle: '效果图', inSub: '空间渲染的结果连进来',
      outTitle: null,                        // 软装节点本身就是输出（清单）
      title: '⑥ 软装提取与选品 · 清单与换款',
      text: '【作用】从效果图自动提取家具软装清单，可逐项查看、换款、选品（节点本身显示清单，就是输出）。\n' +
        '【什么时候用】效果图定了，业主要问「沙发是什么、能不能换」，或要做软装预算。\n' +
        '【怎么用】①把效果图连到本节点\n' +
        '②双击节点看提取出的清单\n' +
        '③逐项换款选品\n' +
        '④选完回到空间渲染，把新软装应用回去重新出图。\n' +
        '【提示】这就是「闭环」：效果图→选品→回渲染→新效果图，改软装不用重画。'
    },
    {
      key: 'layout',
      kind: 'layout',
      inTitle: '效果图 / 彩平图 / 任意图片', inSub: '连线的顺序就是版面顺序',
      outTitle: null,                        // 版式节点本身就是输出（汇报页）
      title: '⑦ 版式输出 · 汇报页交付',
      text: '【作用】把画布上的效果图、彩平图、参考图排成 A4 汇报页，直接交付（节点本身翻页预览，就是输出）。\n' +
        '【什么时候用】方案做完要出汇报文件时，把散落的成果一键变成可打印的册子。\n' +
        '【怎么用】①把要入版的图片从圆点拖线连到本节点\n' +
        '②双击节点选版式、翻页预览\n' +
        '③导出打印或直接发业主。\n' +
        '【提示】连线顺序就是版面顺序；支持多页和封面，最后一步永远归它。'
    }
  ];

  function layout2() {
    return GUIDE2.map((row, i) => {
      const y = i * ROW2;
      return { y, in: { x: COL2.in, y }, node: { x: COL2.node, y: y + (IMG_H - GEN_H) / 2 }, out: { x: COL2.out, y }, note: { x: COL2.note, y } };
    });
  }

  async function nodeGuideGraph() {
    const api = window.GWCanvas;
    // 占位图按语义去重：同一种输入图复用同一张占位
    const placeholders = [
      ['structure', '户型图 / 结构图', '连到「结构」端口，一张图一个机位'],
      ['axono', '轴测图 / 实拍空间', '用正俯视的图，彩平最准确'],
      ['draft', '草图 / 任意参考', '概念图的输入，只当空间关系参考'],
      ['material', '材质参考图', '样板照/材质照片，精确控制质感'],
      ['render', '效果图', '空间渲染的结果，软装和版式的输入'],
      ['outRender', '室内效果图（示意）', '生成结果出现在节点右侧'],
      ['outPlan', '彩色平面图（示意）', '带家具布局的彩平，汇报必备'],
      ['outConcept', '概念氛围图（示意）', '快速定调，不承诺精确一致']
    ];
    const stored = {};
    if (api && typeof api.saveProjectImageDataURL === 'function') {
      for (const [key, title, subtitle] of placeholders) {
        try {
          const saved = await api.saveProjectImageDataURL(placeholderImage(title, subtitle));
          stored[key] = { src: saved.name, ow: saved.w || 640, oh: saved.h || 420 };
        } catch (error) {
          console.warn('[case-template] 占位图写入项目失败，改用内联图片：', error && error.message);
        }
      }
    }
    placeholders.forEach(([key, title, subtitle]) => {
      if (!stored[key]) stored[key] = { src: placeholderImage(title, subtitle), ow: 640, oh: 420 };
    });

    const rows = layout2();
    const img = (id, key, label, p) => ({
      id, type: 'image', x: p.x, y: p.y, w: IMG_W, h: IMG_H,
      src: stored[key].src, ow: stored[key].ow, oh: stored[key].oh, label, name: label
    });
    const note = (id, i, p) => ({
      id, type: 'note', x: p.x, y: p.y, title: GUIDE2[i].title, text: GUIDE2[i].text, noteKind: 'record', status: 'open'
    });
    const nodes = [], edges = [], align = [];
    rows.forEach((p, i) => {
      const row = GUIDE2[i];
      const inId = 'gd-i' + i, nodeId = 'gd-x' + i;
      const inKey = { render: 'structure', plan: 'axono', concept: 'draft', material: 'material', light: 'structure', soft: 'render', layout: 'render' }[row.key];
      nodes.push(img(inId, inKey, row.inTitle, p.in));
      align.push({ center: [inId], move: [nodeId] });
      // 节点列 + 输出列，按类型接真实端口：
      // 生成类：输入→structure；节点→输出占位图
      // 材质/光影：输入/控制节点 汇入输出列的示意生成节点（材质走 material 端口、光影走 light 端口）
      // 软装/版式：节点本身就是输出，没有独立结果占位
      let outId = null;
      if (row.kind === 'generator') {
        nodes.push({ id: nodeId, type: 'generator', x: p.node.x, y: p.node.y, params: row.params || {} });
        outId = 'gd-o' + i;
        const outKey = { render: 'outRender', plan: 'outPlan', concept: 'outConcept' }[row.key];
        nodes.push(img(outId, outKey, row.outTitle, p.out));
        edges.push({ id: 'gd-ei' + i, from: inId, to: nodeId, port: 'structure', role: 'flow' });
        edges.push({ id: 'gd-eo' + i, from: nodeId, to: outId, role: 'flow' });
        align.push({ center: [inId], move: [outId] });
      } else if (row.kind === 'material' || row.kind === 'light') {
        // material 节点记录读顶层 room；light 节点记录读 nd.light
        if (row.kind === 'material') {
          nodes.push({ id: nodeId, type: 'material', x: p.node.x, y: p.node.y, room: '空间材质示例' });
        } else {
          nodes.push({ id: nodeId, type: 'light', x: p.node.x, y: p.node.y, light: {} });
        }
        outId = 'gd-o' + i;                                   // 输出列放示意生成节点
        nodes.push({ id: outId, type: 'generator', x: p.out.x, y: p.out.y });
        if (row.kind === 'material') {
          edges.push({ id: 'gd-ei' + i, from: inId, to: nodeId, port: 'reference', role: 'flow' });
          edges.push({ id: 'gd-eo' + i, from: nodeId, to: outId, port: 'material', role: 'flow' });
        } else {
          edges.push({ id: 'gd-ei' + i, from: inId, to: outId, port: 'structure', role: 'flow' });
          edges.push({ id: 'gd-eo' + i, from: nodeId, to: outId, port: 'light', role: 'flow' });
        }
        align.push({ center: [inId], move: [outId] });
      } else if (row.kind === 'soft') {
        nodes.push({ id: nodeId, type: 'soft', x: p.node.x, y: p.node.y, soft: {} });
        edges.push({ id: 'gd-ei' + i, from: inId, to: nodeId, port: 'image', role: 'flow' });
      } else if (row.kind === 'layout') {
        nodes.push({ id: nodeId, type: 'layout', x: p.node.x, y: p.node.y, layout: {} });
        edges.push({ id: 'gd-ei' + i, from: inId, to: nodeId, port: 'media', role: 'flow' });
      }
      nodes.push(note('gd-n' + i, i, p.note));
    });
    return { version: 1, nodes, edges, align };
  }

  /* ---------------- 模板三：一条龙闭环（从草图到交付全流程） ----------------
   * 五个阶段各占一行，跨行连线表达真实数据流向：
   * 概念图（定调）→ 作为风格参考流入空间渲染 → 效果图流入软装选品（闭环回渲染）
   * 和版式输出；彩平图也流入版式。编号便签讲每一步的阶段目标和衔接关系。
   */

  const ROW3 = 560;
  const COL3 = { in: 0, node: 742, out: 1148, note: 1890 };

  const FLOW_NOTES = [
    {
      title: '一条龙闭环 · 先读我',
      text: '从草图到交付的完整流程，按编号走：\n' +
        '① 概念定调 → ② 空间渲染出效果图 → ③ 软装提取选品 → ④ 平面表现出彩平 → ⑤ 版式输出交付。\n' +
        '跨行的连线就是数据流向：概念图定调后，作为风格参考流进空间渲染；\n' +
        '效果图出来后，一路流进软装选品和版式输出。\n' +
        '闭环在哪：软装选完款，回到②把新软装应用回效果图，重新生成——改软装不用重画。\n' +
        '每个节点的详细用法，见「节点详解」模板。'
    },
    {
      title: '① 概念定调 · 用概念效果图',
      text: '阶段目标：先和业主对齐风格方向，不追求精确。\n' +
        '草图或户型图连到概念效果图节点，快速出几张氛围图。\n' +
        '业主点头后，右边这张概念图不会浪费——\n' +
        '它已经连到下一行的空间渲染节点「风格」端口，出图自带这个气质。'
    },
    {
      title: '② 空间渲染 · 出精确效果图',
      text: '阶段目标：把定下的方向变成可交付的室内效果图。\n' +
        '户型图连「结构」端口（精确的空间骨架），\n' +
        '上一行定调的概念图连「风格」端口（材质和气质）。\n' +
        '双击节点选模型、写一句描述，点「生成」。\n' +
        '出图后如果业主想换软装，走下一行。'
    },
    {
      title: '③ 软装选品 · 闭环在这里',
      text: '阶段目标：应对「沙发能不能换、有没有别的款」。\n' +
        '效果图的连线已经流进软装节点，自动提取软装清单。\n' +
        '逐项换款选品后，回到②空间渲染把新软装应用回去，重新出图。\n' +
        '改软装不用重新画——这就是闭环的意义。'
    },
    {
      title: '④ 平面表现 · 汇报用彩平',
      text: '阶段目标：给汇报文件配一张彩色平面图。\n' +
        '正俯视的轴测图连到平面表现节点，生成带家具布局的彩平图。\n' +
        '彩平图也会流进最后的版式节点，和效果图一起入版。'
    },
    {
      title: '⑤ 版式输出 · 一键交付',
      text: '阶段目标：把所有成果变成可打印的汇报册。\n' +
        '效果图和彩平图的连线已经流进版式节点，\n' +
        '双击节点选版式、翻页预览，导出打印或直接发业主。\n' +
        '整条链到此交付。之后每次改图，都从对应的行重新走一遍即可。'
    }
  ];

  function layout3() {
    return [0, 1, 2, 3, 4].map(i => {
      const y = i * ROW3;
      return {
        y,
        in: { x: COL3.in, y },
        node: { x: COL3.node, y: y + (IMG_H - GEN_H) / 2 },
        out: { x: COL3.out, y },
        note: { x: COL3.note, y }
      };
    });
  }

  async function closedLoopGraph() {
    const api = window.GWCanvas;
    const placeholders = [
      ['draft', '草图 / 手绘方案', '从这里开始：连到概念效果图节点'],
      ['outConcept', '概念氛围图（示意）', '定调用的氛围图，将流进下行「风格」端口'],
      ['structure', '户型图 / 结构图', '连到「结构」端口，出精确效果图'],
      ['outRender', '室内效果图（示意）', '空间渲染的结果，将流进软装和版式'],
      ['axono', '轴测图（正俯视）', '连到平面表现节点，出彩平图'],
      ['outPlan', '彩色平面图（示意）', '彩平结果，将流进版式输出']
    ];
    const stored = {};
    if (api && typeof api.saveProjectImageDataURL === 'function') {
      for (const [key, title, subtitle] of placeholders) {
        try {
          const saved = await api.saveProjectImageDataURL(placeholderImage(title, subtitle));
          stored[key] = { src: saved.name, ow: saved.w || 640, oh: saved.h || 420 };
        } catch (error) {
          console.warn('[case-template] 占位图写入项目失败，改用内联图片：', error && error.message);
        }
      }
    }
    placeholders.forEach(([key, title, subtitle]) => {
      if (!stored[key]) stored[key] = { src: placeholderImage(title, subtitle), ow: 640, oh: 420 };
    });

    const rows = layout3();
    const img = (id, key, label, p) => ({
      id, type: 'image', x: p.x, y: p.y, w: IMG_W, h: IMG_H,
      src: stored[key].src, ow: stored[key].ow, oh: stored[key].oh, label, name: label
    });
    const note = (id, i, p) => ({
      id, type: 'note', x: p.x, y: p.y, title: FLOW_NOTES[i].title, text: FLOW_NOTES[i].text, noteKind: 'record', status: 'open'
    });

    // 行 0：草图 → 概念 → 氛围图
    const nodes = [
      img('cl-i0', 'draft', '草图 / 手绘方案', rows[0].in),
      { id: 'cl-g0', type: 'generator', x: rows[0].node.x, y: rows[0].node.y, params: { designMode: 'concept' } },
      img('cl-o0', 'outConcept', '概念氛围图（示意）', rows[0].out),
      note('cl-n0', 0, { x: COL3.note, y: rows[0].y }),
      // 行 1：户型图 → 空间渲染 → 效果图（风格来自行 0 的概念图）
      img('cl-i1', 'structure', '户型图 / 结构图', rows[1].in),
      { id: 'cl-g1', type: 'generator', x: rows[1].node.x, y: rows[1].node.y },
      img('cl-o1', 'outRender', '室内效果图（示意）', rows[1].out),
      note('cl-n1', 1, { x: COL3.note, y: rows[1].y }),
      // 行 2：软装提取与选品（输入 = 行 1 的效果图）
      { id: 'cl-s2', type: 'soft', x: rows[2].node.x, y: rows[2].node.y, soft: {} },
      note('cl-n2', 2, { x: COL3.note, y: rows[2].y }),
      // 行 3：轴测图 → 平面表现 → 彩平图
      img('cl-i3', 'axono', '轴测图（正俯视）', rows[3].in),
      { id: 'cl-g3', type: 'generator', x: rows[3].node.x, y: rows[3].node.y, params: { designMode: 'plan' } },
      img('cl-o3', 'outPlan', '彩色平面图（示意）', rows[3].out),
      note('cl-n3', 3, { x: COL3.note, y: rows[3].y }),
      // 行 4：版式输出（输入 = 行 1 效果图 + 行 3 彩平）
      { id: 'cl-l4', type: 'layout', x: rows[4].node.x, y: rows[4].node.y, layout: {} },
      note('cl-n4', 4, { x: COL3.note, y: rows[4].y })
    ];
    const edges = [
      { id: 'cl-e1', from: 'cl-i0', to: 'cl-g0', port: 'structure', role: 'flow' },
      { id: 'cl-e2', from: 'cl-g0', to: 'cl-o0', role: 'flow' },
      { id: 'cl-e3', from: 'cl-o0', to: 'cl-g1', port: 'style', role: 'flow' },        // 概念图 → 风格端口
      { id: 'cl-e4', from: 'cl-i1', to: 'cl-g1', port: 'structure', role: 'flow' },
      { id: 'cl-e5', from: 'cl-g1', to: 'cl-o1', role: 'flow' },
      { id: 'cl-e6', from: 'cl-o1', to: 'cl-s2', port: 'image', role: 'flow' },         // 效果图 → 软装
      { id: 'cl-e7', from: 'cl-i3', to: 'cl-g3', port: 'structure', role: 'flow' },
      { id: 'cl-e8', from: 'cl-g3', to: 'cl-o3', role: 'flow' },
      { id: 'cl-e9', from: 'cl-o1', to: 'cl-l4', port: 'media', role: 'flow' },         // 效果图 → 版式
      { id: 'cl-e10', from: 'cl-o3', to: 'cl-l4', port: 'media', role: 'flow' }         // 彩平 → 版式
    ];
    const align = [
      { center: ['cl-i0'], move: ['cl-g0', 'cl-o0'] },
      { center: ['cl-i1'], move: ['cl-g1', 'cl-o1'] },
      { center: ['cl-i3'], move: ['cl-g3', 'cl-o3'] }
    ];
    return { version: 1, nodes, edges, align };
  }

  /* ---------------- 放置入口（三个模板共用） ---------------- */

  window.GW_CASE_TEMPLATES = [
    {
      id: 'starter-full-flow',
      title: '第一次出图 · 三分钟走完整个流程',
      summary: '单机位主流程 + 多机位示例。画布已连好线，四张便签讲清连线方式、机位规则和结果位置。',
      tag: '新手必看',
      graph: starterGraph
    },
    {
      id: 'node-guide',
      title: '节点详解 · 每个节点怎么用',
      summary: '七类功能节点各一整行：输入图 → 节点 → 输出示意 → 详解便签（作用 / 什么时候用 / 怎么用 / 提示）。',
      tag: '进阶必看',
      graph: nodeGuideGraph
    },
    {
      id: 'closed-loop',
      title: '一条龙闭环 · 从草图到交付',
      summary: '五个阶段串成完整链：概念定调 → 空间渲染 → 软装选品（回渲染闭环）→ 平面表现 → 版式交付，跨行连线即数据流向。',
      tag: '全流程',
      graph: closedLoopGraph
    }
  ];

  // 统一的放置入口：资产库面板、空白画布按钮都调这里，行为保持一致。
  window.GW_useStarterTemplate = async function (index) {
    const list = window.GW_CASE_TEMPLATES || [];
    const tpl = list[typeof index === 'number' ? index : 0];
    const canvasApi = window.GWCanvas;
    const notify = (message, error) => {
      if (canvasApi && typeof canvasApi.toast === 'function') canvasApi.toast(message, error);
    };
    if (!tpl) { notify('没有可用的新手模板', true); return false; }
    // 必须已打开项目：占位图要写进项目 Content 目录；且没开项目时，
    // 启动阶段的项目恢复（loadProject）会清空画布，刚放的模板会被无声吞掉。
    if (canvasApi.hasOpenProject && !canvasApi.hasOpenProject()) {
      notify('请先打开或新建一个项目，再放新手模板', true);
      return false;
    }
    if (!canvasApi || typeof canvasApi.instantiateTemplate !== 'function') {
      notify('当前版本不支持模板放置', true);
      return false;
    }
    try {
      const graph = typeof tpl.graph === 'function' ? await tpl.graph() : tpl.graph;
      const created = await canvasApi.instantiateTemplate(graph, null, { label: '套用新手模板' });
      // instantiateTemplate 按模板顺序返回创建成功的节点 —— 建立模板 id → 实际节点的映射
      const byKey = {};
      let cursor = 0;
      (graph.nodes || []).forEach(nd => {
        const k = created[cursor++];
        if (k) byKey[nd.id] = k;
      });
      // 中轴对齐：生成节点等实际渲染高度与估算常量有出入，按已落位节点的真实尺寸重排
      (graph.align || []).forEach(spec => {
        const centers = (spec.center || []).map(id => byKey[id]).filter(Boolean);
        const moves = (spec.move || []).map(id => byKey[id]).filter(Boolean);
        if (!centers.length || !moves.length || typeof canvasApi.nodeLayoutSize !== 'function') return;
        const centerY = centers.reduce((sum, k) => {
          const size = canvasApi.nodeLayoutSize(k);
          return sum + k.y() + size.h / 2;
        }, 0) / centers.length;
        moves.forEach(k => {
          const size = canvasApi.nodeLayoutSize(k);
          k.y(Math.round(centerY - size.h / 2));
        });
      });
      // 落位后把这一组节点铺满视口，第一眼就能看清便签和卡片内容。
      if (created && created.length && typeof canvasApi.fitToNodes === 'function') {
        canvasApi.fitToNodes(created);
      }
      const expect = graph && graph.nodes ? graph.nodes.length : 0;
      if (created && expect && created.length < expect) {
        notify('模板已放到画布，但有 ' + (expect - created.length) + ' 个节点没放成功（见日志）', true);
      } else {
        notify('模板已放到画布 · 共 ' + (created ? created.length : 0) + ' 个节点，按便签提示走一遍');
      }
      return true;
    } catch (error) {
      notify('模板放置失败：' + (error && error.message ? error.message : '未知错误'), true);
      return false;
    }
  };

  function bindEmptyCanvasButton() {
    const button = document.getElementById('btn-empty-template');
    if (!button || button.__gwBound) return;
    button.__gwBound = true;
    button.onclick = async () => {
      button.disabled = true;
      const label = button.textContent;
      button.textContent = '正在放置…';
      await window.GW_useStarterTemplate(0);
      button.disabled = false;
      button.textContent = label;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEmptyCanvasButton);
  } else {
    bindEmptyCanvasButton();
  }
})();
