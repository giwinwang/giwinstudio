// 软装植入的端到端执行验证（不花钱）：
// 把 window.GWProviders.generate 换成一个假的，跑完 runSoftPlant 全流程，
// 检查每一件的 payload 是否真的带上了商品参考图、是否按件顺序执行、
// 结果是否落成新节点并连线、条目状态与卡片文案是否跟着变。
//
// 为什么必须这样测：prompt 和 mask 都对，不代表 generate 收到的参数对；
// 而真调一次要花积分，改成假引擎就能把整条链路跑穿。
// 用法：先启动 electron（GW_CDP_PORT=9223），再 node tests/softplant-run-smoke.cjs
const PORT = Number(process.env.GW_CDP_PORT || 9223);
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise(ok => {
    const id = ++seq;
    pending.set(id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, timeout: 60000 });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('evaluate 失败: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) {
      if (window.GWCanvas && typeof window.GWCanvas.__debugRunSoftPlant === 'function') return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })()`, true);
  if (!ready) throw new Error('调试钩子未就绪（__debugRunSoftPlant）');

  const result = await evaluate(`(async () => {
    // 1) 造一张空间图和一张商品图，都走真实的图片落地流程
    const mk = (w, h, color, label) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = '28px sans-serif';
      ctx.fillText(label, 24, 60);
      return c.toDataURL('image/png');
    };
    const space = await window.GWCanvas.addImageFromDataURL(mk(640, 480, '#5b6b78', 'SPACE'), '冒烟空间图', null, undefined, { silent: true });
    if (!space || !space.node) return { ok: false, msg: '空间图创建失败' };
    const product = await window.GWCanvas.addImageFromDataURL(mk(320, 320, '#d8cfc2', 'PRODUCT'), '冒烟商品图', null, undefined, { silent: true });
    if (!product || !product.node) return { ok: false, msg: '商品图创建失败' };

    const spaceId = space.node.gwId;
    const productId = product.node.gwId;
    // 2) 选中空间图后创建软装植入节点 → 空间图自动接上
    window.GWCanvas.__debugSelectNode(spaceId);
    const g = window.GWCanvas.createSoftPlantNode({ x: 1400, y: 1400 }, { openEditor: false });
    if (!g) return { ok: false, msg: '节点创建失败' };

    // 3) 两件商品：第一件有落位框（走遮罩），第二件没有框（走整图重绘）
    const productURL = await window.GWCanvas.getMediaOutputDataURL(productId, { maxEdge: 512 });
    g.gwSoftPlant.spaceType = 'white';
    g.gwSoftPlant.items = [
      { id: 'a', category: '沙发', name: '米白三人位', qty: 1, note: '客厅主位靠窗', box: [0.2, 0.45, 0.75, 0.8], productImage: '', productThumb: productURL, status: 'pending' },
      { id: 'b', category: '落地灯', name: '黄铜', qty: 1, note: '沙发右侧角落', box: null, productImage: '', productThumb: productURL, status: 'pending' }
    ];

    // 4) 换掉 generate：记录每次调用，返回一张同尺寸假图
    const P = window.GWProviders;
    const original = P.generate;
    const calls = [];
    P.generate = async (engineId, params) => {
      calls.push({
        engineId,
        hasProduct: !!params.productReferenceDataURL,
        productPrefix: String(params.productReferenceDataURL || '').slice(0, 22),
        hasMask: !!params.maskDataURL,
        hasOverlay: !!params.inpaintOverlayDataURL,
        // 「目标商品参考图」那段固定指令由 providers 层拼进最终 prompt（见 softplant-channel.test.js），
        // canvas 层负责的是把商品图说成「图2」，这两层各测各的
        promptHasProductRule: /图2/.test(String(params.prompt || '')),
        promptHasMaskRule: /只有标记区域允许改动/.test(String(params.prompt || '')),
        size: params.sourceSize
      });
      await new Promise(r => setTimeout(r, 60));
      return mk(params.sourceSize.w, params.sourceSize.h, '#8a8f8b', 'MOCK ' + calls.length);
    };
    let run = null;
    let error = '';
    const countBefore = window.GWCanvas.__debugState().nodeCount;
    try {
      run = await window.GWCanvas.__debugRunSoftPlant(g, {});
    } catch (e) {
      error = String(e && e.message || e);
    } finally {
      P.generate = original;
    }
    const countAfter = window.GWCanvas.__debugState().nodeCount;
    const texts = g.getChildren().filter(c => c.getClassName && c.getClassName() === 'Text').map(c => c.text());
    return {
      ok: !error,
      error,
      calls,
      run,
      grew: countAfter - countBefore,
      statuses: g.gwSoftPlant.items.map(i => i.status),
      hasResultIds: g.gwSoftPlant.items.map(i => !!i.resultId),
      texts
    };
  })()`, true);

  console.log('执行结果:', JSON.stringify(result, null, 2));

  const calls = result.calls || [];
  const first = calls[0] || {};
  const second = calls[1] || {};
  const checks = [
    ['两件商品各发起一次调用', calls.length === 2],
    ['每次都带商品参考图', calls.length === 2 && calls.every(c => c.hasProduct)],
    ['有落位框的那件带遮罩', first.hasMask === true],
    ['没落位框的那件不带遮罩', second.hasMask === false],
    ['prompt 指明商品是图2', calls.every(c => c.promptHasProductRule)],
    ['有框那件 prompt 带区域约束', first.promptHasMaskRule === true],
    ['无框那件 prompt 不带区域约束', second.promptHasMaskRule === false],
    ['执行后两件都变已植入', (result.statuses || []).join(',') === 'done,done'],
    ['每件都记了结果节点', (result.hasResultIds || []).every(Boolean)],
    ['新增了 2 个结果节点', result.grew === 2],
    ['卡片显示已植入 2 件', (result.texts || []).some(t => /已植入 2/.test(t))],
    ['执行没有报错', result.ok === true]
  ];
  console.log('\n=== 断言 ===');
  let failed = 0;
  checks.forEach(([name, pass]) => {
    console.log((pass ? '✔ ' : '★ ') + name);
    if (!pass) failed++;
  });
  if (result.error) console.log('错误信息:', result.error);

  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      const out = path.join(__dirname, 'softplant-run.png');
      fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log('\n截图: ' + out);
    }
  } catch (error) {
    console.log('截图失败:', error.message);
  }

  ws.close();
  if (failed) { console.log('\n失败 ' + failed + ' 项'); process.exit(1); }
  console.log('\n全部通过');
}

main().catch(error => { console.error('冒烟失败:', error.message); process.exit(1); });
