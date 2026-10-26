const cdpPort = process.env.GW_CDP_PORT || '9222';
const targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
const page = targets.find(target => target.type === 'page');
if (!page) throw new Error('No debuggable page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter(message);
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = ++seq;
  return new Promise(resolve => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable');
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 500 });
await send('Profiler.start');
const profileMode = process.env.GW_PROFILE_MODE || 'switch';
const profileExpression = profileMode === 'zoom'
  ? `(async () => {
    const element = document.querySelector('.konvajs-content');
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < 30; index++) {
      element.dispatchEvent(new WheelEvent('wheel', {
        deltaY: index % 3 === 0 ? 120 : -120,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true
      }));
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    return 'zoom';
  })()`
  : `(async () => {
    const current = GWProjectState.getCurrent().id;
    const target = [...document.querySelectorAll('.project-tab')]
      .map(element => element.dataset.projectId)
      .find(id => id !== current);
    await activateProjectTab(target);
    await new Promise(resolve => setTimeout(resolve, 3000));
    return target;
  })()`;
await send('Runtime.evaluate', {
  expression: profileExpression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true
});
const stopped = await send('Profiler.stop');
const profile = stopped.result.profile;
const samples = profile.samples || [];
const deltas = profile.timeDeltas || [];
const nodes = new Map((profile.nodes || []).map(node => [node.id, node]));
const parent = new Map();
(profile.nodes || []).forEach(node => {
  (node.children || []).forEach(childId => parent.set(childId, node.id));
});
const selfTime = new Map();
const nodeSelfTime = new Map();
for (let index = 0; index < samples.length; index++) {
  const node = nodes.get(samples[index]);
  if (!node) continue;
  const frame = node.callFrame || {};
  const key = [frame.functionName || '(anonymous)', frame.url || '', frame.lineNumber || 0].join('|');
  const delta = deltas[index] || 0;
  selfTime.set(key, (selfTime.get(key) || 0) + delta);
  nodeSelfTime.set(node.id, (nodeSelfTime.get(node.id) || 0) + delta);
}
const top = [...selfTime.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .map(([key, micros]) => {
    const [fn, url, line] = key.split('|');
    return {
      function: fn,
      file: url.split('/').pop(),
      line: Number(line) + 1,
      selfMs: Math.round(micros / 1000)
    };
  });
const stacks = [...nodeSelfTime.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([nodeId, micros]) => {
    const stack = [];
    let current = nodeId;
    for (let depth = 0; current && depth < 8; depth++) {
      const node = nodes.get(current);
      const frame = node && node.callFrame || {};
      stack.push({
        function: frame.functionName || '(anonymous)',
        file: String(frame.url || '').split('/').pop(),
        line: Number(frame.lineNumber || 0) + 1
      });
      current = parent.get(current);
    }
    return { selfMs: Math.round(micros / 1000), stack };
  });
console.log(JSON.stringify({ top, stacks }, null, 2));
ws.close();
