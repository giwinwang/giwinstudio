// 软装植入 · 连线商品冒烟：商品图从画布连线进来，双击节点就该直接是一行可生成商品。
// 用法：先启动 electron（GW_CDP_PORT=9223），再 node tests/softplant-linked-smoke.cjs
const PORT = Number(process.env.GW_CDP_PORT || 9223);

async function main() {
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const target = list.find(item => item.type === 'page');
  if (!target) throw new Error('没有可用的页面 target，请先启动开发版');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise(ok => {
    const id = ++seq;
    pending.set(id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, timeout: 40000 });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('evaluate 失败: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) {
      if (window.GWCanvas && typeof window.GWCanvas.openSoftPlantEditor === 'function') return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })()`, true);
  if (!ready) throw new Error('GWCanvas 未就绪');
  if (!(await evaluate('window.GWCanvas.hasOpenProject()'))) throw new Error('请先打开一个项目');

  const result = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const mk = (w, h, color, label) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px sans-serif';
      ctx.fillText(label, 24, 60);
      return c.toDataURL('image/png');
    };
    const space = await window.GWCanvas.addImageFromDataURL(mk(640, 480, '#5b6b78', 'SPACE'), '连线冒烟空间图', null, undefined, { silent: true });
    const sofa = await window.GWCanvas.addImageFromDataURL(mk(320, 320, '#d8cfc2', 'SOFA'), '米白三人沙发', null, undefined, { silent: true });
    const rug = await window.GWCanvas.addImageFromDataURL(mk(300, 200, '#8c7f6d', 'RUG'), '客厅地毯', null, undefined, { silent: true });
    if (!space || !sofa || !rug) return { ok: false, msg: '测试图片创建失败' };

    window.GWCanvas.__debugSelectNode(space.node.gwId);
    const g = window.GWCanvas.createSoftPlantNode({ x: 1600, y: 1600 }, { openEditor: false });
    if (!g) return { ok: false, msg: '节点创建失败' };
    window.GWCanvas.__debugConnect(sofa.node.gwId, g.gwId);
    await wait(400);

    // 打开编辑器：应当自动把连线商品补成一行
    window.GWCanvas.openSoftPlantEditor(g);
    await wait(1200);
    const mask = document.getElementById('softplant-mask');
    if (!mask) return { ok: false, msg: '编辑器没打开' };

    const rows = Array.from(mask.querySelectorAll('[data-sp-row]'));
    const firstRow = rows[0];
    const rowThumb = firstRow ? firstRow.querySelector('img') : null;
    const rowText = firstRow ? firstRow.textContent.replace(/\\s+/g, ' ').trim() : '';
    const summary = mask.querySelector('#sp-summary').textContent.replace(/\\s+/g, ' ').trim();
    const runBtn = mask.querySelector('#sp-run');
    const linkedTiles = Array.from(mask.querySelectorAll('[data-linked]')).map(el => ({
      id: el.dataset.linked,
      text: el.textContent.replace(/\\s+/g, ' ').trim(),
      hasImg: !!el.querySelector('img')
    }));

    // 点第 2 行的选图（第二行还不存在，先加一条空行再点）
    mask.querySelector('#sp-add').click();
    await wait(500);
    const pop = document.getElementById('sp-pick');
    const pickOptions = pop ? Array.from(pop.querySelectorAll('[data-pick-node]')).map(el => el.textContent.replace(/\\s+/g, ' ').trim()) : [];
    const hasFileEntry = !!(pop && pop.querySelector('#sp-pick-file'));
    if (pop) pop.remove();
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // 刚才为了测「选图」加的空行要删掉，否则保存后多一条空商品
    const removeBtns = mask.querySelectorAll('[data-act="remove"]');
    if (removeBtns.length) removeBtns[removeBtns.length - 1].click();
    await wait(300);

    const cardTexts = g.getChildren().filter(c => c.getClassName && c.getClassName() === 'Text').map(c => c.text()).join(' | ');
    const rowCategory = firstRow ? (firstRow.querySelector('[data-field="category"]') || {}).value : '';

    // 保存后才写回节点，这里验证「连线来源」确实记进了数据
    mask.querySelector('#sp-save').click();
    await wait(400);
    const saved = (g.gwSoftPlant.items || [])[0] || {};
    window.GWCanvas.openSoftPlantEditor(g);
    await wait(900);

    return {
      ok: true,
      rowCount: rows.length,
      rowThumbLoaded: !!rowThumb && /^data:image/.test(rowThumb.src || ''),
      rowText,
      summary,
      runEnabled: !!(runBtn && !runBtn.disabled),
      linkedTiles,
      pickOptions,
      hasFileEntry,
      cardTexts,
      rowCategory,
      itemCount: (g.gwSoftPlant.items || []).length,
      itemCategory: saved.category,
      itemSource: saved.sourceNodeId === sofa.node.gwId
    };
  })()`, true);

  console.log(JSON.stringify(result, null, 2));

  const checks = [
    ['连线商品自动成行', result.rowCount === 1],
    ['行内缩略图已显示（不是「连线」占位）', result.rowThumbLoaded === true],
    ['状态不是缺商品图', !/缺商品图/.test(result.rowText)],
    ['汇总显示待生成 1 张', /待生成\s*1/.test(result.summary)],
    ['汇总不再报缺图', !/缺商品图/.test(result.summary)],
    ['生成按钮可用', result.runEnabled === true],
    ['连线商品区只列连线图', result.linkedTiles.length === 1 && result.linkedTiles[0].text.includes('沙发')],
    ['连线商品区缩略图已加载', result.linkedTiles[0] && result.linkedTiles[0].hasImg === true],
    ['候选里含空间图之外的商品图', result.pickOptions.length >= 2],
    ['候选面板保留本地文件入口', result.hasFileEntry === true],
    ['卡片不再显示缺商品图', !/缺商品图/.test(result.cardTexts)],
    ['品类按名称猜对', result.rowCategory === '沙发' && result.itemCategory === '沙发'],
    ['槽位记下了连线来源', result.itemSource === true]
  ];
  let failed = 0;
  checks.forEach(([name, pass]) => {
    console.log((pass ? '  ✓ ' : '  ✗ ') + name);
    if (!pass) failed++;
  });
  console.log(failed ? ('失败 ' + failed + ' 项') : '全部通过 ' + checks.length + ' 项');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    require('fs').writeFileSync(require('path').join(__dirname, 'softplant-linked.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('截图: tests/softplant-linked.png');
  }
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error(error); process.exit(1); });
