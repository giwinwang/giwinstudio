import { writeFile } from 'node:fs/promises';

function numberArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : NaN;
}

function textArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

const fromX = numberArg('--from-x');
const fromY = numberArg('--from-y');
const toX = numberArg('--to-x');
const toY = numberArg('--to-y');
const duration = Math.max(120, numberArg('--duration') || 900);
const button = textArg('--button', 'left');
const hoverOnly = process.argv.includes('--hover');
const profilePath = textArg('--profile');
if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
  console.error('usage: node tests/cdp-profile-drag.mjs --from-x 100 --from-y 200 --to-x 300 --to-y 250 --duration 1000 [--button left|middle] [--profile file.json]');
  process.exit(2);
}

const cdpPort = process.env.GW_CDP_PORT || '9222';
const targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
const page = targets.find(target => target.type === 'page');
if (!page) throw new Error('no debuggable page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let sequence = 0;
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
  const id = ++sequence;
  return new Promise(resolve => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const buttons = hoverOnly ? 0 : (button === 'middle' ? 4 : 1);

await send('Page.bringToFront');
await send('Runtime.enable');
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 100 });
await wait(300);
await send('Runtime.evaluate', {
  expression: `(() => {
    window.__gwProfileFrames = [];
    window.__gwProfileSampling = true;
    let last = performance.now();
    const tick = now => {
      window.__gwProfileFrames.push(now - last);
      last = now;
      if (window.__gwProfileSampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`,
  returnByValue: true
});
await send('Profiler.start');
await send('Input.dispatchMouseEvent', {
  type: 'mouseMoved', x: fromX, y: fromY
});
if (!hoverOnly) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: fromX, y: fromY, button, buttons, clickCount: 1
  });
}

const steps = Math.max(8, Math.ceil(duration / 16));
const stepDelay = Math.max(1, duration / steps);
for (let step = 1; step <= steps; step++) {
  const amount = step / steps;
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(fromX + (toX - fromX) * amount),
    y: Math.round(fromY + (toY - fromY) * amount),
    button,
    buttons
  });
  await wait(stepDelay);
}

if (!hoverOnly) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: toX, y: toY, button, buttons: 0, clickCount: 1
  });
}
await wait(350);
const stopped = await send('Profiler.stop');
const frameReply = await send('Runtime.evaluate', {
  expression: `(() => {
    window.__gwProfileSampling = false;
    const frames = window.__gwProfileFrames || [];
    const sorted = frames.slice().sort((a, b) => a - b);
    return {
      count: frames.length,
      average: frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0,
      p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      over25: frames.filter(value => value > 25).length,
      over50: frames.filter(value => value > 50).length
    };
  })()`,
  returnByValue: true
});
const profile = stopped.result && stopped.result.profile;
if (!profile) throw new Error('profile unavailable');
if (profilePath) await writeFile(profilePath, JSON.stringify(profile));

const nodeById = new Map(profile.nodes.map(node => [node.id, node]));
const parentById = new Map();
profile.nodes.forEach(node => {
  (node.children || []).forEach(childId => parentById.set(childId, node.id));
});
const selfMicros = new Map();
let totalMicros = 0;
for (let index = 0; index < profile.samples.length; index++) {
  const delta = Math.max(0, profile.timeDeltas[index] || 0);
  const nodeId = profile.samples[index];
  selfMicros.set(nodeId, (selfMicros.get(nodeId) || 0) + delta);
  totalMicros += delta;
}
const hotspots = [...selfMicros.entries()]
  .map(([id, micros]) => {
    const node = nodeById.get(id);
    const frame = node && node.callFrame || {};
    return {
      function: frame.functionName || '(anonymous)',
      file: String(frame.url || '').split('/').pop(),
      line: Number(frame.lineNumber || 0) + 1,
      ms: +(micros / 1000).toFixed(1),
      pct: +(micros * 100 / Math.max(1, totalMicros)).toFixed(1)
    };
  })
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 25);
const inclusiveMicros = new Map();
function inclusiveFor(node) {
  if (!node) return 0;
  if (inclusiveMicros.has(node.id)) return inclusiveMicros.get(node.id);
  const total = (selfMicros.get(node.id) || 0) +
    (node.children || []).reduce((sum, id) => sum + inclusiveFor(nodeById.get(id)), 0);
  inclusiveMicros.set(node.id, total);
  return total;
}
const inclusive = [...nodeById.values()]
  .map(node => {
    const frame = node.callFrame || {};
    const path = [];
    let current = node;
    while (current && path.length < 10) {
      const currentFrame = current.callFrame || {};
      path.unshift([
        currentFrame.functionName || '(anonymous)',
        String(currentFrame.url || '').split('/').pop(),
        Number(currentFrame.lineNumber || 0) + 1
      ].filter(Boolean).join(':'));
      current = nodeById.get(parentById.get(current.id));
    }
    return {
      function: frame.functionName || '(anonymous)',
      file: String(frame.url || '').split('/').pop(),
      line: Number(frame.lineNumber || 0) + 1,
      ms: +(inclusiveFor(node) / 1000).toFixed(1),
      path
    };
  })
  .filter(item => item.ms >= 2)
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 30);

console.log(JSON.stringify({
  ok: true,
  button,
  duration,
  totalMs: +(totalMicros / 1000).toFixed(1),
  samples: profile.samples.length,
  frames: frameReply.result && frameReply.result.result && frameReply.result.result.value,
  hotspots,
  inclusive
}, null, 2));
ws.close();
setTimeout(() => process.exit(0), 20);
