// 概念效果图节点冒烟：连接已启动的开发版（--remote-debugging-port=9223），
// 创建节点 → 校验节点标签/参数 → 校验面板 DOM → 校验提示词 → 截图。
// 用法：先启动 electron --remote-debugging-port=9223，再 node tests/concept-node-smoke.cjs
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
      if (window.GWCanvas && typeof window.GWCanvas.createConceptNode === 'function') return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })()`, true);
  if (!ready) throw new Error('GWCanvas.createConceptNode 未就绪');

  const hasProject = await evaluate('window.GWCanvas.hasOpenProject()');
  console.log('项目已打开:', hasProject);
  if (!hasProject) {
    const opened = await evaluate(`(async () => {
      const cards = Array.from(document.querySelectorAll('.proj-card')).filter(el => !el.classList.contains('restore'));
      if (cards.length) cards[0].click();
      else {
        const nameInput = document.getElementById('new-proj-name');
        const btn = document.getElementById('btn-new-proj');
        if (nameInput && btn) { nameInput.value = '概念节点测试'; btn.click(); }
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
    const g = window.GWCanvas.createConceptNode(null, { x: 420, y: 520 });
    if (!g) return { ok: false };
    return {
      ok: true,
      label: g.gwLabel,
      title: g.gwTitleText ? g.gwTitleText.text() : '',
      sub: g.gwSubText ? g.gwSubText.text() : '',
      designMode: g.gwParams.designMode,
      conceptView: g.gwParams.conceptView,
      strength: g.gwParams.strength
    };
  })()`);
  console.log('创建结果:', JSON.stringify(created));
  await sleep(900);

  const after = await evaluate('window.GWCanvas.__debugState().nodeCount');
  console.log('节点数 ' + before + ' → ' + after);

  const panel = await evaluate(`(() => {
    const el = document.querySelector('.gw-node-panel.plan-panel, .gw-node-panel');
    const nodes = Array.from(document.querySelectorAll('.gw-node-panel'));
    const target = nodes.find(n => /概念效果图/.test(n.textContent || '')) || el;
    if (!target) return { found: false };
    return {
      found: true,
      hasTitle: /概念效果图/.test(target.textContent || ''),
      viewButtons: Array.from(target.querySelectorAll('[data-concept-view]')).map(b => b.dataset.conceptView),
      activeView: (target.querySelector('[data-concept-view].active') || {}).dataset ? target.querySelector('[data-concept-view].active').dataset.conceptView : '',
      hasGenerate: !!target.querySelector('[data-generate]'),
      hasWarning: /不保证|方案前期沟通/.test(target.textContent || ''),
      hasStrengthSlider: !!target.querySelector('[data-p="strength"]')
    };
  })()`);
  console.log('面板检查:', JSON.stringify(panel, null, 2));

  const promptCutaway = await evaluate(`window.GWCanvas.__debugConceptPrompt({ conceptView: 'cutaway', styleId: 'warm' })`);
  const promptInterior = await evaluate(`window.GWCanvas.__debugConceptPrompt({ conceptView: 'interior', styleId: 'wabi' })`);
  console.log('\n--- 剖透视提示词 ---\n' + promptCutaway);
  console.log('\n--- 室内人视提示词 ---\n' + promptInterior);

  const checks = [
    ['节点标签为概念效果图', created.ok && created.label === '概念效果图'],
    ['designMode=concept', created.designMode === 'concept'],
    ['默认视角剖透视', created.conceptView === 'cutaway'],
    ['节点数 +1', after === before + 1],
    ['面板有 4 个视角按钮', panel.found && panel.viewButtons.length === 4],
    ['面板有生成按钮', !!panel.hasGenerate],
    ['面板带免责说明', !!panel.hasWarning],
    ['概念面板不显示结构保持滑块', panel.hasStrengthSlider === false],
    ['剖透视提示词含剖切机位', /剖透视机位表达/.test(promptCutaway)],
    ['提示词不再写「唯一空间结构」', !/唯一空间结构/.test(promptCutaway)],
    ['人视提示词含眼高', /约成年人眼高/.test(promptInterior)],
    ['提示词含方案概念定位', /不是施工依据/.test(promptCutaway)]
  ];
  console.log('\n=== 断言 ===');
  let failed = 0;
  checks.forEach(([name, pass]) => {
    console.log((pass ? '✔ ' : '★ ') + name);
    if (!pass) failed++;
  });

  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      const out = path.join(__dirname, 'concept-node.png');
      fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log('\n截图: ' + out);
    }
  } catch (error) {
    console.log('截图失败: ' + error.message);
  }

  ws.close();
  console.log(failed ? '\n★ 有 ' + failed + ' 项未通过' : '\n✔ 全部通过');
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error(error.message); process.exit(2); });
