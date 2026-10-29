/* 新手使用说明书项目
 *
 * 一个真实项目（userData/guide-project），欢迎页第一张卡 / 底部书本图标 / 工具栏「说明书」按钮一键打开。
 * 内容由 GW_buildGuideContent 在打开时构建（画布为空才构建）：
 * 全部用真实节点 + 运行时按真实渲染尺寸布局，保证零重叠、大间距、整洁。
 * 说明卡/封面图用 infoCard/coverCard 代码绘制，写入项目 Content 目录。
 * 用户改乱后 main.js 的 guide:ensure 会在 guide-version 变化或目录缺失时重置。
 *
 * 历史：早期三个拖入式新手模板（第一次出图/节点说明书/一条龙闭环）已下线删除，
 * 职责全部由本说明书项目承担。
 */
(function () {
  'use strict';

  // 说明卡与真实图片节点同比例（640×420 ≈ 622×408）

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrapText(ctx, text, x, y, maxW, lh) {
    let line = '';
    for (const ch of text) {
      if (ch === '\n' || ctx.measureText(line + ch).width > maxW) {
        ctx.fillText(line, x, y);
        y += lh;
        line = ch === '\n' ? '' : ch;
      } else {
        line += ch;
      }
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }
  // 信息卡：带彩色标注牌的占位图（640×420）
  function infoCard(opts) {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f5f1ea';
    ctx.fillRect(0, 0, 640, 420);
    ctx.strokeStyle = '#c9c2b6';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(16, 16, 608, 388);
    ctx.setLineDash([]);
    // 标注牌（彩色圆角标签）
    ctx.textAlign = 'left';
    ctx.font = '600 22px "Microsoft YaHei", "PingFang SC", sans-serif';
    const badgeW = ctx.measureText(opts.badge).width + 36;
    ctx.fillStyle = opts.badgeColor || '#4a7ba6';
    roundRect(ctx, 40, 44, badgeW, 44, 22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(opts.badge, 58, 74);
    // 标题
    ctx.fillStyle = '#6f6759';
    ctx.font = '600 29px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(opts.title, 40, 148);
    // 正文（自动换行）
    ctx.fillStyle = '#8d867b';
    ctx.font = '400 21px "Microsoft YaHei", "PingFang SC", sans-serif';
    let y = 196;
    for (const line of (opts.lines || [])) y = wrapText(ctx, line, 40, y, 560, 34);
    return canvas.toDataURL('image/png');
  }

  /* ================= 新手使用说明书项目 =================
   * 一个真实项目（userData/guide-project），欢迎页与工具栏一键打开。
   * 内容由本函数在打开时构建（画布为空才构建）：
   * 全部用真实节点 + 运行时按真实渲染尺寸布局，保证零重叠、大间距、整洁。
   * 用户改乱后 main.js 的 guide:ensure 会在 guide-version 变化或目录缺失时重置；
   * 「重新打开恢复」依赖重置逻辑，画布一旦保存过就不再重建。 */
  function coverCard(def) {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2e2a24';
    ctx.fillRect(0, 0, 640, 420);
    ctx.strokeStyle = '#57503f';
    ctx.lineWidth = 3;
    ctx.strokeRect(18, 18, 604, 384);
    ctx.textAlign = 'left';
    // 顶部品牌条
    ctx.fillStyle = '#c9a45c';
    ctx.font = '600 24px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(def.badge, 48, 76);
    // 大标题
    ctx.fillStyle = '#f5f1ea';
    ctx.font = '650 52px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(def.title, 48, 156);
    // 分隔线
    ctx.strokeStyle = '#57503f';
    ctx.beginPath(); ctx.moveTo(48, 186); ctx.lineTo(592, 186); ctx.stroke();
    // 目录
    ctx.fillStyle = '#cfc8ba';
    ctx.font = '400 24px "Microsoft YaHei", "PingFang SC", sans-serif';
    let y = 232;
    for (const line of (def.lines || [])) y = wrapText(ctx, line, 48, y, 544, 38);
    return canvas.toDataURL('image/png');
  }

  const GUIDE_CARDS = {
    cover: {
      kind: 'cover', badge: '极物 GIWIN Studio', title: '新手使用说明书',
      lines: [
        '这份项目本身就是说明书，往下看：',
        '① 画布基础操作　　② 出一张效果图',
        '③ 多机位　　④ 出图之后能干什么',
        '⑤ 更多节点　　⑥ 开始你自己的项目',
        '所有节点都是真的，可以点、可以连、可以生成。'
      ]
    },
    'in-struct': { badge: '输入｜结构端口', badgeColor: '#4a7ba6', title: '户型图 / 结构图', lines: ['一张图 = 一个机位（相机角度）', '从图片右侧圆点拖线到节点端口', '连线方式见下方「连线」便签'] },
    'out-render': { badge: '输出｜效果图', badgeColor: '#b0763b', title: '生成结果（示意）', lines: ['点「生成」后，真实结果出现在这里', '双击结果卡：看大图 / 下载图片', '出图之后能干什么？往下看 ↓'] },
    'in-a': { badge: '输入｜结构端口 · 机位 1', badgeColor: '#4a7ba6', title: '户型图 A', lines: ['第 1 个机位', '多张图连到同一个节点', '每张图各占一个机位'] },
    'in-b': { badge: '输入｜结构端口 · 机位 2', badgeColor: '#4a7ba6', title: '户型图 B', lines: ['第 2 个机位', '生成时每个机位各出一张图', '结构端口最多接 4 张'] },
    'out-a': { badge: '输出｜效果图', badgeColor: '#b0763b', title: '机位 1 的结果', lines: ['结果会标明「机位 1」', '面板里可切换机位逐个查看'] },
    'out-b': { badge: '输出｜效果图', badgeColor: '#b0763b', title: '机位 2 的结果', lines: ['结果会标明「机位 2」', '所有机位共用「风格」参考图'] },
    'out-soft': { badge: '输出｜效果图', badgeColor: '#b0763b', title: '效果图', lines: ['上游「空间渲染」的产出', '可以继续交给下面的节点加工'] },
    'out-layout': { badge: '输出｜效果图', badgeColor: '#b0763b', title: '效果图', lines: ['上游「空间渲染」的产出', '汇报排版从这里开始'] },
    'in-axis': { badge: '输入｜俯视轴测图', badgeColor: '#5b8a5f', title: '正俯视轴测图', lines: ['彩平图要用正俯视角度', '斜视角生成的平面会变形'] },
    'out-plan': { badge: '输出｜彩平图', badgeColor: '#b0763b', title: '彩色平面图（示意）', lines: ['带家具布局的平面表现', '适合放进汇报文件'] },
    'in-sketch': { badge: '输入｜草图 / 户型', badgeColor: '#7a6aa8', title: '手绘草图或户型图', lines: ['项目最初的想法就行', '画得糙也没关系'] },
    'out-concept': { badge: '输出｜概念氛围图', badgeColor: '#b0763b', title: '概念氛围图（示意）', lines: ['用来定风格和方向', '不承诺精确一致'] }
  };

  const GUIDE_NOTES = [
    { key: 'n-how', title: '怎么读这份说明书', text: '【跟着看】从上往下 6 个板块，顺序就是做项目的顺序。\n【动手试】节点都能点、能连、能生成（生成消耗积分，跳过不影响阅读）。\n【改乱了？】关掉这个项目，下次从首页重新点「新手使用说明书」，内容会恢复如初。' },
    { key: 'n-canvas', title: '画布怎么动', text: '【缩放】鼠标滚轮\n【平移】空格 + 左键拖拽，或中键拖拽\n【适应视图】Shift + F（内容一屏看全）\n【自动整理】选中节点按 F，上游向左、下游向右排开' },
    { key: 'n-select', title: '选中与整理', text: '【选中】单击；点空白处取消\n【多选】Ctrl + 点击，或空白处拖框选\n【全选】Ctrl + A\n【合并】多选后按 Q 合成一张卡，再按 Q 展开' },
    { key: 'n-edit', title: '右键、删除与撤销', text: '【菜单】右键节点 / 右键空白处，最常用的操作都在里面\n【删除】选中后按 Delete\n【快速复制】Ctrl + D\n【撤销 / 重做】Ctrl + Z / Ctrl + Y\n【全部快捷键】按 ? 随时查看' },
    { key: 'n-render', title: '空间渲染 · 核心出图节点', text: '【作用】把户型图/结构图变成照片级室内效果图，整个软件的核心。\n【什么时候用】户型确定后，出效果图给业主看方案。\n【怎么用】① 图片连到「结构」端口 ② 双击节点选模型、写风格 ③ 点「生成」\n【提示】结果出现在右侧并自动连线。' },
    { key: 'n-conn3', title: '连线 · 三种方式', text: '① 拖线：从图片右侧的小圆点，拖到节点端口上松开\n② 拖图：直接把图片拖进节点面板的机位框\n③ 右键：右键图片 →「新建空间渲染节点」，自动连好\n小技巧：按住 Alt 右键划过连线可以切断它' },
    { key: 'n-multi', title: '多机位 · 一个节点出多个角度', text: '【规则】结构端口一张图 = 一个机位，最多 4 张\n【示例】左边 2 张户型图都连到同一节点的「结构」端口\n【结果】生成时每个机位各出一张图\n【共用】「风格」端口只有 1 个，所有机位共用同一套材质气质' },
    { key: 'n-soft', title: '可能性 A · 软装提取与选品', text: '【作用】从效果图识别软装清单，逐项换成真实商品。\n【场景】业主说「沙发换个样式」——不用重新画。\n【怎么用】效果图连进来 → 点「提取」→ 逐项选品替换 → 回生成节点重新出图。' },
    { key: 'n-layout', title: '可能性 B · 版式输出', text: '【作用】把图片排成 A4 汇报页，可翻页、可导出。\n【场景】方案汇报、打印交付。\n【怎么用】效果图/彩平图连进来 → 在面板里排版 → 导出。' },
    { key: 'n-plan', title: '平面表现 · 彩平图', text: '【作用】轴测图/实拍空间 → 带家具布局的彩色平面图。\n【什么时候用】汇报文件需要彩平；或业主只想快速看布局。\n【提示】要用正俯视的轴测图，斜视角会变形。' },
    { key: 'n-concept', title: '概念效果图 · 前期氛围', text: '【作用】草图/户型 → 氛围方向图，快速定风格。\n【什么时候用】项目最开始，还不确定要什么效果时。\n【提示】概念图允许重组、不承诺精确一致；要精确交付用「空间渲染」。' },
    { key: 'n-next', title: '下一步 · 开始你自己的项目', text: '① 关掉这个说明书项目\n② 回到首页，输入客户项目名（如：张姐-江山悦140㎡）\n③ 点「新建项目」→ 导入你的户型图 → 开工！\n你的参数配方和工作流可存进资产库，随时一键复用。' },
    { key: 'n-about', title: '关于这份说明书', text: '这是画布里的真实项目，所有节点都能操作。\n不小心改乱了？关掉项目，下次从首页重新点「新手使用说明书」即可恢复。\n遇到问题按 ? 看快捷键速查。' }
  ];

  const GUIDE_NODES = [
    { key: 'gen-core', record: { type: 'generator', params: {} } },
    { key: 'gen-multi', record: { type: 'generator', params: {} } },
    { key: 'soft1', record: { type: 'soft', soft: {} } },
    { key: 'layout1', record: { type: 'layout', layout: {} } },
    { key: 'gen-plan', record: { type: 'generator', params: { designMode: 'plan' } } },
    { key: 'gen-concept', record: { type: 'generator', params: { designMode: 'concept' } } }
  ];

  const GUIDE_EDGES = [
    ['in-struct', 'gen-core', 'structure'],
    ['gen-core', 'out-render', null],
    ['in-a', 'gen-multi', 'structure'],
    ['in-b', 'gen-multi', 'structure'],
    ['gen-multi', 'out-a', null],
    ['gen-multi', 'out-b', null],
    ['out-soft', 'soft1', 'image'],
    ['out-layout', 'layout1', 'media'],
    ['in-axis', 'gen-plan', 'structure'],
    ['gen-plan', 'out-plan', null],
    ['in-sketch', 'gen-concept', 'structure'],
    ['gen-concept', 'out-concept', null]
  ];

  window.GW_buildGuideContent = async function () {
    const A = window.GWCanvas;
    if (!A || typeof A.instantiateNodeRecord !== 'function' || typeof A.nodeLayoutSize !== 'function') return false;
    if (A.hasOpenProject && !A.hasOpenProject()) return false;

    // 1. 说明卡图片写入项目 Content（和手动导入的图完全一致）
    const srcOf = {};
    for (const [key, def] of Object.entries(GUIDE_CARDS)) {
      const dataURL = def.kind === 'cover' ? coverCard(def) : infoCard(def);
      const r = await A.saveProjectImageDataURL(dataURL);
      srcOf[key] = r.name;
    }

    // 2. 创建全部节点（先在原点，稍后统一布局）
    const made = {}, all = [];
    async function put(key, nd) {
      nd.id = 'gc-' + key; nd.x = 0; nd.y = 0;
      const k = await A.instantiateNodeRecord(nd);
      if (k) { made[key] = k; all.push(k); }
      return k;
    }
    for (const [key, def] of Object.entries(GUIDE_CARDS)) {
      await put(key, { type: 'image', src: srcOf[key], label: def.title, ow: 640, oh: 420 });
    }
    for (const nd of GUIDE_NOTES) {
      await put(nd.key, { type: 'note', title: nd.title, text: nd.text, noteKind: 'record', status: 'open' });
    }
    for (const nd of GUIDE_NODES) {
      await put(nd.key, JSON.parse(JSON.stringify(nd.record)));
    }

    // 3. 布局：运行时按真实渲染尺寸排，保证零重叠
    const dim = key => A.nodeLayoutSize(made[key]) || { w: 620, h: 408 };
    const GAP_X = 110, NOTE_GAP = 80, PAGE_GAP = 330, XC = 1500;
    let y = 0;

    function rowExtent(keys) {
      const ds = keys.map(dim);
      return { ds, total: ds.reduce((s, d) => s + d.w, 0) + GAP_X * (keys.length - 1) };
    }
    function placeRow(keys) {
      const { ds, total } = rowExtent(keys);
      let x = XC - total / 2;
      const rowH = Math.max(...ds.map(d => d.h));
      keys.forEach((key, i) => {
        made[key].position({ x: Math.round(x), y: Math.round(y + (rowH - ds[i].h) / 2) });
        x += ds[i].w + GAP_X;
      });
      return rowH;
    }
    function placeNotes(keys) {
      const { ds, total } = rowExtent(keys);
      let x = XC - total / 2;
      const h = Math.max(...ds.map(d => d.h));
      keys.forEach((key, i) => { made[key].position({ x: Math.round(x), y: Math.round(y) }); x += ds[i].w + GAP_X; });
      return h;
    }
    function placeColumn(keys, x) {
      let cy = y;
      keys.forEach(key => {
        const d = dim(key);
        made[key].position({ x: Math.round(x), y: Math.round(cy) });
        cy += d.h + 60;
      });
      return cy - 60 - y;
    }
    function placeMultiPage(leftKeys, midKey, rightKeys) {
      const lw = dim(leftKeys[0]).w, mw = dim(midKey).w, rw = dim(rightKeys[0]).w;
      const total = lw + GAP_X + mw + GAP_X + rw;
      const x0 = XC - total / 2;
      const colH = Math.max(placeColumn(leftKeys, x0), placeColumn(rightKeys, x0 + lw + GAP_X + mw + GAP_X));
      const mid = dim(midKey);
      made[midKey].position({ x: Math.round(x0 + lw + GAP_X), y: Math.round(y + (colH - mid.h) / 2) });
      return colH;
    }

    // —— P0 封面 ——
    y += placeRow(['cover', 'n-how']);
    y += PAGE_GAP;

    // —— P1 画布基础 ——
    y += placeNotes(['n-canvas', 'n-select', 'n-edit']);
    y += PAGE_GAP;

    // —— P2 核心出图 ——
    y += placeNotes(['n-render']);
    y += NOTE_GAP;
    y += placeRow(['in-struct', 'gen-core', 'out-render']);
    y += NOTE_GAP;
    y += placeNotes(['n-conn3']);
    y += PAGE_GAP;

    // —— P3 多机位 ——
    y += placeNotes(['n-multi']);
    y += NOTE_GAP;
    y += placeMultiPage(['in-a', 'in-b'], 'gen-multi', ['out-a', 'out-b']);
    y += PAGE_GAP;

    // —— P4 出图之后 ——
    y += placeNotes(['n-soft']);
    y += NOTE_GAP;
    y += placeRow(['out-soft', 'soft1']);
    y += 170;
    y += placeNotes(['n-layout']);
    y += NOTE_GAP;
    y += placeRow(['out-layout', 'layout1']);
    y += PAGE_GAP;

    // —— P5 更多节点 ——
    y += placeNotes(['n-plan']);
    y += NOTE_GAP;
    y += placeRow(['in-axis', 'gen-plan', 'out-plan']);
    y += 170;
    y += placeNotes(['n-concept']);
    y += NOTE_GAP;
    y += placeRow(['in-sketch', 'gen-concept', 'out-concept']);
    y += PAGE_GAP;

    // —— P6 收尾 ——
    y += placeNotes(['n-next', 'n-about']);

    // 4. 连线（真实端口）
    A.restoreEdgeRecords(GUIDE_EDGES.map(([from, to, port], i) => ({
      id: 'gce-' + i, from: 'gc-' + from, to: 'gc-' + to, ...(port ? { port } : {}), role: 'flow'
    })));

    // 5. 视口适配 + 保存
    if (typeof A.fitToNodes === 'function') A.fitToNodes(all);
    if (typeof A.saveForProjectSwitch === 'function') await A.saveForProjectSwitch();
    if (typeof A.toast === 'function') A.toast('新手使用说明书已就绪，往下滚动逐板块阅读');
    return true;
  };

})();
