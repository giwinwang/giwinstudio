/* 新手案例模板
 *
 * 给第一次打开 GIWIN Studio 的用户一条能照着走的完整链路：
 * 画布上直接摆好「户型图 → 风格参考 → 生成节点」，旁边用便签写清每一步做什么。
 * 模板本质就是一份工作流节点图（同「保存当前工作流」的格式），
 * 由 canvas.js 的 instantiateTemplate() 原样还原到画布。
 *
 * 两张占位图在放置时写进项目 Content 目录（和手动导入的图片完全一样），
 * 所以它们能正常预览、能拉线、能被生成节点引用；用户换成自己的图后删掉即可。
 *
 * 坐标按画布真实节点尺寸计算，避免卡片叠在一起看不清内容：
 *   图片卡 622×408（640:420 比例 × NODE_CARD_H 408）、便签 320×408、生成节点 286×112
 */
(function () {
  'use strict';

  const IMG_W = 622, IMG_H = 408;      // createImageNode 按图片比例 × NODE_CARD_H 算出来的实际尺寸
  const NOTE_W = 320, NOTE_H = 408;
  const GEN_W = 286, GEN_H = 112;
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

  const NOTES = [
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
        '· 单机位：只连 1 张户型图/结构图，生成一个角度的室内效果图；\n' +
        '· 多机位：把多张户型图/结构图逐张都连到「结构」端口，每个机位各出一张图，面板里用「机位 1 / 2 / 3…」切换查看。\n' +
        '「风格」端口只接 1 张风格参考图，所有机位共用同一套材质和气质。\n' +
        '选好机位后写一句风格描述（如「现代简约、浅色木饰面、傍晚自然光」），点「生成」。'
    },
    {
      id: 'case-n3',
      title: '第 3 步 · 出图之后',
      text: '结果卡会出现在生成节点的右侧——左边那张虚线图就是这个位置的示意，生成后它会被真实结果替代。\n' +
        '结果卡可以继续精修、高清放大或拿去排版。\n' +
        '跑通一次后，把这几个节点一起选中，点「保存当前工作流」，下次一键复用这套连线。'
    }
  ];

  // 坐标以原点为中心算好，instantiateTemplate 会把整组摆到当前视口中心。
  function layout() {
    const imgLeft = 0;
    const imgTop = 0;
    const imgBottomY = imgTop + IMG_H + ROW_GAP;      // 468
    const genX = imgLeft + IMG_W + GAP;               // 742
    const flowCenterY = (imgTop + imgBottomY + IMG_H) / 2;  // 438：两图整体竖直中心
    const genY = flowCenterY - GEN_H / 2;             // 382
    const resX = genX + GEN_W + GAP;                  // 1148：结果示意占位图
    const resY = flowCenterY - IMG_H / 2;             // 234
    const noteX = resX + IMG_W + GAP;                 // 1890
    const notes = [
      { x: noteX, y: imgTop },
      { x: noteX, y: imgTop + NOTE_H + 40 },
      { x: noteX + NOTE_W + 40, y: flowCenterY - NOTE_H / 2 }
    ];
    const maxX = noteX + NOTE_W * 2 + 40;             // 2570
    const maxY = Math.max(imgTop + IMG_H, imgBottomY + IMG_H, notes[1].y + NOTE_H); // 876
    const offsetX = -maxX / 2;
    const offsetY = -(maxY + Math.min(imgTop, notes[0].y)) / 2;
    return {
      img1: { x: imgLeft + offsetX, y: imgTop + offsetY },
      img2: { x: imgLeft + offsetX, y: imgBottomY + offsetY },
      gen: { x: genX + offsetX, y: genY + offsetY },
      res: { x: resX + offsetX, y: resY + offsetY },
      notes: notes.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }))
    };
  }

  async function starterGraph() {
    const api = window.GWCanvas;
    let structure = null, style = null, result = null;
    if (api && typeof api.saveProjectImageDataURL === 'function') {
      try {
        const a = await api.saveProjectImageDataURL(
          placeholderImage('户型图 / 结构图', '换成你的户型图，从这里连线到「结构」端口')
        );
        const b = await api.saveProjectImageDataURL(
          placeholderImage('风格参考图', '换成你喜欢的效果图，从这里连线到「风格」端口')
        );
        const c = await api.saveProjectImageDataURL(
          placeholderImage('生成结果（示意）', '点「生成」后，结果卡出现在空间渲染节点的这个位置')
        );
        structure = { src: a.name, ow: a.w || 640, oh: a.h || 420 };
        style = { src: b.name, ow: b.w || 640, oh: b.h || 420 };
        result = { src: c.name, ow: c.w || 640, oh: c.h || 420 };
      } catch (error) {
        console.warn('[case-template] 占位图写入项目失败，改用内联图片：', error && error.message);
      }
    }
    if (!structure) structure = { src: placeholderImage('户型图 / 结构图', '换成你的户型图，从这里连线到「结构」端口'), ow: 640, oh: 420 };
    if (!style) style = { src: placeholderImage('风格参考图', '换成你喜欢的效果图，从这里连线到「风格」端口'), ow: 640, oh: 420 };
    if (!result) result = { src: placeholderImage('生成结果（示意）', '点「生成」后，结果卡出现在空间渲染节点的这个位置'), ow: 640, oh: 420 };

    const pos = layout();
    return {
      version: 1,
      nodes: [
        {
          id: 'case-n1', type: 'note', x: pos.notes[0].x, y: pos.notes[0].y,
          title: NOTES[0].title, text: NOTES[0].text, noteKind: 'record', status: 'open'
        },
        {
          id: 'case-i1', type: 'image', x: pos.img1.x, y: pos.img1.y,
          w: IMG_W, h: IMG_H, src: structure.src, ow: structure.ow, oh: structure.oh,
          label: '户型图', name: '户型图'
        },
        {
          id: 'case-i2', type: 'image', x: pos.img2.x, y: pos.img2.y,
          w: IMG_W, h: IMG_H, src: style.src, ow: style.ow, oh: style.oh,
          label: '风格参考', name: '风格参考'
        },
        {
          id: 'case-n2', type: 'note', x: pos.notes[1].x, y: pos.notes[1].y,
          title: NOTES[1].title, text: NOTES[1].text, noteKind: 'record', status: 'open'
        },
        { id: 'case-g1', type: 'generator', x: pos.gen.x, y: pos.gen.y },
        {
          id: 'case-r1', type: 'image', x: pos.res.x, y: pos.res.y,
          w: IMG_W, h: IMG_H, src: result.src, ow: result.ow, oh: result.oh,
          label: '生成结果（示意）', name: '生成结果（示意）'
        },
        {
          id: 'case-n3', type: 'note', x: pos.notes[2].x, y: pos.notes[2].y,
          title: NOTES[2].title, text: NOTES[2].text, noteKind: 'record', status: 'open'
        }
      ].filter(Boolean),
      edges: [
        { id: 'case-e1', from: 'case-i1', to: 'case-g1', port: 'structure', role: 'flow' },
        { id: 'case-e2', from: 'case-i2', to: 'case-g1', port: 'style', role: 'flow' }
      ]
    };
  }

  window.GW_CASE_TEMPLATES = [
    {
      id: 'starter-full-flow',
      title: '第一次出图 · 三分钟走完整个流程',
      summary: '户型图 + 风格参考 → 空间渲染 → 结果。画布已连好线，三张便签讲清连线方式与机位规则，并示意结果卡出现的位置。',
      tag: '新手必看',
      graph: starterGraph
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
      // 落位后把这一组节点铺满视口，第一眼就能看清便签和卡片内容。
      if (created && created.length && typeof canvasApi.fitToNodes === 'function') {
        canvasApi.fitToNodes(created);
      }
      const expect = graph && graph.nodes ? graph.nodes.length : 0;
      if (created && expect && created.length < expect) {
        notify('模板已放到画布，但有 ' + (expect - created.length) + ' 个节点没放成功（见日志）', true);
      } else {
        notify('模板已放到画布 · 按便签 ①②③ 走一遍（共 ' + (created ? created.length : 0) + ' 个节点）');
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
