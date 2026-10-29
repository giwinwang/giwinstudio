/* 新手模板 UI 冒烟（CDP 版，零依赖）
 * 启动真实 Electron 窗口 → 调用 GW_useStarterTemplate(0) → 读 __debugState 快照。
 * 只诊断，不改画布。退出时关闭 Electron。
 * 用法：node tests/case-template-ui-smoke.cjs [--keep]
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.GW_CDP_PORT || '9223';
const KEEP = process.argv.includes('--keep');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE; // 否则 electron 会当 node 跑，不开窗口
  let child = null;
  if (!process.argv.includes('--connect')) {
    child = spawn(process.execPath, [
      path.join(ROOT, 'node_modules', 'electron', 'cli.js'),
      ROOT, '--remote-debugging-port=' + PORT
    ], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', d => { const s = String(d); if (/error|exception/i.test(s)) console.error('[electron]', s.trim().slice(0, 300)); });
  }
  const kill = () => { try { if (child && process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']); else if (child) child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', () => { if (!KEEP) kill(); });

  // 等 CDP 端点
  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      targets = list.filter(t => t.type === 'page' && !/devtools/i.test(t.url || ''));
      if (targets.length) break;
    } catch (e) { /* 未就绪 */ }
  }
  if (!targets || !targets.length) { console.error('CDP 未能连上窗口'); process.exit(2); }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise(ok => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); ok({ __timeout: true }); }
    }, 8000);
    pending.set(id, msg => { clearTimeout(timer); ok(msg); });
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(timer); ok({ __timeout: true }); }
  });
  async function evaluate(expression, awaitPromise = false) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, timeout: 20000 });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('evaluate 失败: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async function screenshot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result && r.result.data) {
      fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.result.data, 'base64'));
      console.log('截图: tests/' + name);
    }
  }
  await send('Page.enable');

  // 等画布脚本就绪（reload 后也用它）
  async function waitReady() {
    return evaluate(`(async () => {
      for (let i = 0; i < 100; i++) {
        if (window.GWCanvas && typeof window.GWCanvas.__debugState === 'function' && window.GW_useStarterTemplate) return true;
        await new Promise(r => setTimeout(r, 200));
      }
      return false;
    })()`, true);
  }

  async function runCase(name, baseCount = 0) {
    const placed = await evaluate('window.GW_useStarterTemplate(0)', true);
    console.log(`--- [${name}] 调用 GW_useStarterTemplate(0) →`, placed);
    await new Promise(r => setTimeout(r, 1400)); // 等 settle 定时器跑完
    const after = await evaluate('window.GWCanvas.__debugState()');
    const st = after.stage;
    console.log('stage:', JSON.stringify(st), ' nodeCount:', after.nodeCount);
    console.log('canvases:', JSON.stringify(after.canvases));
    const added = (after.nodes || []).slice(baseCount);
    let onScreen = 0;
    added.forEach(n => {
      const left = n.x * st.scale + st.x, top = n.y * st.scale + st.y;
      const vis = left < st.w && top < st.h && left + n.w * st.scale > 0 && top + n.h * st.scale > 0;
      if (vis) onScreen++;
      console.log(`  [${n.type}] pos=(${n.x},${n.y}) size=${n.w}x${n.h} visible=${n.visible} screenXY=(${Math.round(left)},${Math.round(top)}) ${vis ? '在视口内' : '★视口外'}`);
    });
    console.log(`[${name}] 新增 ${added.length} 个，视口内 ${onScreen} 个`);
    await screenshot(name + '.png');
    return { ok: added.length === 13 && onScreen === added.length, added: added.length, onScreen, total: after.nodeCount };
  }

  if (!(await waitReady())) { console.error('画布脚本 10s 内未就绪'); process.exit(3); }

  // 用例0：无项目冷启动 —— 应被拦截（不创建节点），防止被项目恢复流程清掉
  const pre = await evaluate('window.GWCanvas.__debugState()');
  const gate = await evaluate('window.GW_useStarterTemplate(0)', true);
  const post0 = await evaluate('window.GWCanvas.__debugState()');
  const blockedOk = pre.project === false && gate === false && post0.nodeCount === pre.nodeCount;
  console.log(`--- 用例0 无项目拦截: project=${pre.project} 返回=${gate} 节点 ${pre.nodeCount}→${post0.nodeCount} ${blockedOk ? '✔ 已正确拦截' : '★ 未拦截'}`);
  if (!pre.project) {
    console.log('（冷启动未自动恢复项目，后面的放置用例跳过 —— 用户需先打开项目）');
    ws.close(); await sleep(300); if (!KEEP) kill(); process.exit(blockedOk ? 0 : 1);
  }

  // 用例1：默认视口（刚打开的空项目）
  const before = await evaluate('window.GWCanvas.__debugState()');
  console.log('--- 放置前 ---');
  console.log(JSON.stringify({ project: before.project, nodeCount: before.nodeCount, stage: before.stage }));
  const case1 = await runCase('case1-default-view', 0);

  // 用例2：先把视口弄乱（缩放 40% + 偏移），模拟用户此前拖过画布
  await evaluate(`window.GWCanvas.setZoom(0.4, { x: 200, y: 700 }); true`);
  const mid = await evaluate('window.GWCanvas.__debugState()');
  console.log('--- 用例2 视口已打乱:', JSON.stringify(mid.stage));
  const case2 = await runCase('case2-messy-view', case1.total);

  console.log(case1.ok && case2.ok ? '✔ 两个用例：13 个新增节点均落在视口内' : '★ 存在用例节点不在视口内，需要修 fitToNodes/落位');
  ws.close();
  await sleep(300);
  if (!KEEP) kill();
  process.exit(0);
}

main().catch(e => { console.error('冒烟失败:', e.message); process.exit(1); });
