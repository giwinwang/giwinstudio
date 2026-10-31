// 软装植入节点冒烟：连接已启动的开发版（--remote-debugging-port=9223），
// 创建节点 → 校验卡片文案 → 打开编辑器 → 加一条商品 → 校验 mask/prompt → 截图。
// 用法：先启动 electron --remote-debugging-port=9223，再 node tests/softplant-node-smoke.cjs
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
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, timeout: 20000 });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('evaluate 失败: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) {
      if (window.GWCanvas && typeof window.GWCanvas.createSoftPlantNode === 'function') return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })()`, true);
  if (!ready) throw new Error('GWCanvas.createSoftPlantNode 未就绪');

  const hasProject = await evaluate('window.GWCanvas.hasOpenProject()');
  console.log('项目已打开:', hasProject);
  if (!hasProject) {
    const opened = await evaluate(`(async () => {
      const cards = Array.from(document.querySelectorAll('.proj-card')).filter(el => !el.classList.contains('restore'));
      if (cards.length) cards[0].click();
      else {
        const nameInput = document.getElementById('new-proj-name');
        const btn = document.getElementById('btn-new-proj');
        if (nameInput && btn) { nameInput.value = '软装植入测试'; btn.click(); }
      }
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 250));
        if (window.GWCanvas.hasOpenProject()) return 'opened';
      }
      return 'failed';
    })()`, true);
    console.log('自动打开项目:', opened);
    if (opened === 'failed') throw new Error('无法自动打开项目，请手动打开后再测');
  }

  const before = await evaluate('window.GWCanvas.__debugState().nodeCount');
  const created = await evaluate(`(() => {
    const g = window.GWCanvas.createSoftPlantNode({ x: 460, y: 560 }, { openEditor: false });
    if (!g) return { ok: false };
    const texts = g.getChildren().filter(c => c.getClassName && c.getClassName() === 'Text').map(c => c.text());
    return {
      ok: true,
      type: g.gwType,
      hasStore: !!g.gwSoftPlant,
      mode: g.gwSoftPlant && g.gwSoftPlant.mode,
      spaceType: g.gwSoftPlant && g.gwSoftPlant.spaceType,
      itemCount: (g.gwSoftPlant && g.gwSoftPlant.items || []).length,
      texts
    };
  })()`);
  console.log('创建结果:', JSON.stringify(created, null, 2));
  await sleep(700);

  const after = await evaluate('window.GWCanvas.__debugState().nodeCount');
  console.log('节点数 ' + before + ' → ' + after);

  // 编辑器：加一条商品后检查行与统计
  const openEditor = await evaluate(`(async () => {
    let g = window.__gwLastSoftPlant;
    if (!g || !g.getStage || !g.getStage()) {
      const list = window.GWCanvas.__debugState().nodes.filter(n => n.type === 'softplant');
      g = list.length ? window.GWCanvas.__debugNodeById(list[list.length - 1].id) : null;
    }
    if (!g) return { ok: false, msg: '找不到节点' };
    window.GWCanvas.openSoftPlantEditor(g);
    await new Promise(r => setTimeout(r, 500));
    const mask = document.getElementById('softplant-mask');
    if (!mask) return { ok: false, msg: '编辑器未打开' };
    const emptyVisible = mask.querySelector('#sp-source-empty').style.display !== 'none';
    const modes = Array.from(mask.querySelectorAll('[data-mode]')).map(b => b.dataset.mode);
    const rowsBefore = mask.querySelectorAll('[data-sp-row]').length;
    const emptyText = (mask.querySelector('#sp-rows').textContent || '').trim();
    mask.querySelector('#sp-add').click();
    await new Promise(r => setTimeout(r, 200));
    const rowsAfter = mask.querySelectorAll('[data-sp-row]').length;
    const summary = (mask.querySelector('#sp-summary').textContent || '').replace(/\\s+/g, ' ').trim();
    const categorySelect = mask.querySelector('[data-field="category"]');
    const options = categorySelect ? Array.from(categorySelect.options).map(o => o.value) : [];
    const routeText = (mask.querySelector('#sp-route').textContent || '').trim();
    return { ok: true, hasEmpty: !!mask.querySelector('#sp-source-empty'), emptyVisible, modes, rowsBefore, rowsAfter, summary, options, routeText, emptyText: emptyText.slice(0, 60) };
  })()`, true);
  console.log('编辑器检查:', JSON.stringify(openEditor, null, 2));

  // mask 与 prompt 的执行级检查
  const maskCheck = await evaluate(`(() => {
    const url = window.GWCanvas.__debugSoftPlantMask(400, 300, [0.2, 0.3, 0.6, 0.8]);
    return { isPng: /^data:image\\/png;base64,/.test(url || ''), length: (url || '').length };
  })()`);
  console.log('落位遮罩:', JSON.stringify(maskCheck));

  const promptMasked = await evaluate(`window.GWCanvas.__debugSoftPlantPrompt({ category: '沙发', name: '米白三人位', qty: 1 }, { spaceType: 'white' }, { hasMask: true })`);
  const promptFree = await evaluate(`window.GWCanvas.__debugSoftPlantPrompt({ category: '落地灯', name: '黄铜' }, { spaceType: 'plan' }, { hasMask: false })`);
  console.log('\n--- 有落位框 ---\n' + promptMasked);
  console.log('\n--- 平面图 / 无框 ---\n' + promptFree);

  const checks = [
    ['节点类型 softplant', created.ok && created.type === 'softplant'],
    ['带软装植入数据', !!created.hasStore],
    ['默认模式为植入', created.mode === 'implant'],
    ['默认空间类型自动', created.spaceType === 'auto'],
    ['节点数 +1', after === before + 1],
    ['卡片标题正确', (created.texts || []).some(t => /软装植入/.test(t))],
    ['卡片显示件数与已植入', (created.texts || []).some(t => /件 · 已植入/.test(t))],
    ['卡片提示预计消耗', (created.texts || []).some(t => /还没有可生成的商品图/.test(t))],
    ['编辑器已打开', openEditor.ok],
    ['未接空间图时显示空态', openEditor.ok && openEditor.emptyVisible === true],
    ['有植入/置换两个模式', openEditor.ok && openEditor.modes.join(',') === 'implant,replace'],
    ['空态提示可读', openEditor.ok && /添加商品/.test(openEditor.emptyText)],
    ['添加商品后出现一行', openEditor.ok && openEditor.rowsBefore === 0 && openEditor.rowsAfter === 1],
    ['统计显示待生成', openEditor.ok && /待生成/.test(openEditor.summary)],
    ['品类里含沙发与落地灯', openEditor.ok && openEditor.options.includes('沙发') && openEditor.options.includes('落地灯')],
    ['落位遮罩是真 PNG', maskCheck.isPng === true],
    ['有框提示锁死标记区域', /只有标记区域允许改动/.test(promptMasked || '')],
    ['无框提示限定只出现一次', /只出现一次/.test(promptFree || '')],
    ['平面图走建筑规则', /建筑平面图/.test(promptFree || '')]
  ];
  console.log('\n=== 断言 ===');
  let failed = 0;
  checks.forEach(([name, pass]) => {
    console.log((pass ? '✔ ' : '★ ') + name);
    if (!pass) failed++;
  });

  try {
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      const out = path.join(__dirname, 'softplant-node.png');
      fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log('\n截图: ' + out);
    }
  } catch (error) {
    console.log('截图失败:', error.message);
  }

  ws.close();
  if (failed) {
    console.log('\n失败 ' + failed + ' 项');
    process.exit(1);
  }
  console.log('\n全部通过');
}

main().catch(error => { console.error('冒烟失败:', error.message); process.exit(1); });
