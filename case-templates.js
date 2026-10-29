/* 新手案例模板
 *
 * 给第一次打开 GIWIN Studio 的用户一条能照着走的完整链路：
 * 模板一（第一次出图）：单机位主流程 + 多机位示例，便签讲清连线方式与机位规则；
 * 模板二（节点图鉴）：平面表现 / 概念效果图 / 软装选品 / 版式输出，一排一个节点配一张便签。
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

  /* ---------------- 模板二：节点图鉴（其他节点各演示一排） ---------------- */

  const ROW_H2 = 488;                                   // 每排高度（图片 408 + 间距 80）
  const NOTE2 = [
    { title: '平面表现 · 彩平图', text: '连一张轴测图或实拍空间照，生成带家具布局的彩色平面图。\n适合方案汇报和向业主讲解布局。出图请用正俯视的轴测图，效果最稳。' },
    { title: '概念效果图 · 前期沟通', text: '方案前期用的氛围图：只把来源图当空间关系参考，允许模型重组结构、自选机位，快速出感觉。\n注意它不承诺和户型精确一致，精确呈现请用「空间渲染」。' },
    { title: '软装提取与选品 · 清单', text: '连一张效果图，自动提取图里的家具软装清单，可逐项查看、换款、选品。\n选完后可以回到空间渲染，把新软装应用回效果图。' },
    { title: '版式输出 · 汇报页', text: '把画布上的图片和生成结果按版式排成 A4 汇报页，支持多页与封面。\n图片连线进来即可入版，节点内可翻页预览，可导出打印。' }
  ];

  function layout2() {
    return [0, 1, 2, 3].map(i => {
      const y = i * ROW_H2;
      return {
        img: { x: 0, y },
        node: { x: 742, y: y + (IMG_H - GEN_H) / 2 },     // 估算，落位后对齐
        note: { x: 1148, y }
      };
    });
  }

  async function nodeGuideGraph() {
    const api = window.GWCanvas;
    const placeholders = [
      ['axono', '轴测图 / 实拍空间', '从这里连线到「平面表现」节点'],
      ['draft', '草图 / 户型图', '从这里连线到「概念效果图」节点'],
      ['render', '效果图', '从这里连线到「软装提取与选品」节点'],
      ['page', '画布图片 / 生成结果', '从这里连线到「版式输出」节点']
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
      id, type: 'note', x: p.x, y: p.y, title: NOTE2[i].title, text: NOTE2[i].text, noteKind: 'record', status: 'open'
    });
    return {
      version: 1,
      nodes: [
        img('gd-i1', 'axono', '轴测图 / 实拍空间', rows[0].img),
        { id: 'gd-g1', type: 'generator', x: rows[0].node.x, y: rows[0].node.y, params: { designMode: 'plan' } },
        note('gd-n1', 0, rows[0].note),

        img('gd-i2', 'draft', '草图 / 户型图', rows[1].img),
        { id: 'gd-g2', type: 'generator', x: rows[1].node.x, y: rows[1].node.y, params: { designMode: 'concept' } },
        note('gd-n2', 1, rows[1].note),

        img('gd-i3', 'render', '效果图', rows[2].img),
        { id: 'gd-s1', type: 'soft', x: rows[2].node.x, y: rows[2].node.y, soft: {} },
        note('gd-n3', 2, rows[2].note),

        img('gd-i4', 'page', '画布图片 / 生成结果', rows[3].img),
        { id: 'gd-l1', type: 'layout', x: rows[3].node.x, y: rows[3].node.y, layout: {} },
        note('gd-n4', 3, rows[3].note)
      ],
      edges: [
        { id: 'gd-e1', from: 'gd-i1', to: 'gd-g1', port: 'structure', role: 'flow' },
        { id: 'gd-e2', from: 'gd-i2', to: 'gd-g2', port: 'structure', role: 'flow' },
        { id: 'gd-e3', from: 'gd-i3', to: 'gd-s1', port: 'soft', role: 'flow' },
        { id: 'gd-e4', from: 'gd-i4', to: 'gd-l1', port: 'media', role: 'flow' }
      ],
      align: [
        { center: ['gd-i1'], move: ['gd-g1'] },
        { center: ['gd-i2'], move: ['gd-g2'] },
        { center: ['gd-i3'], move: ['gd-s1'] },
        { center: ['gd-i4'], move: ['gd-l1'] }
      ]
    };
  }

  /* ---------------- 放置入口（两个模板共用） ---------------- */

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
      title: '节点图鉴 · 平面表现 / 概念图 / 软装 / 版式',
      summary: '一排一个节点：平面表现、概念效果图、软装提取与选品、版式输出，各配一张说明便签。',
      tag: '进阶必看',
      graph: nodeGuideGraph
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
