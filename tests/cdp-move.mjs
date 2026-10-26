import { writeFile } from 'node:fs/promises';

const shotIndex = process.argv.indexOf('--shot');
const shotPath = shotIndex >= 0 ? process.argv[shotIndex + 1] : null;
const args = process.argv.slice(2).filter((value, index, list) => {
  if (value === '--shot') return false;
  return !(index > 0 && list[index - 1] === '--shot');
});
const [x, y] = args.slice(0, 2).map(Number);
if (![x, y].every(Number.isFinite)) {
  console.error('usage: node tests/cdp-move.mjs <x> <y> [--shot file.png]');
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
function send(method, params) {
  const id = ++sequence;
  return new Promise(resolve => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
await send('Page.bringToFront');
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
await new Promise(resolve => setTimeout(resolve, 250));
if (shotPath) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(shotPath, Buffer.from(shot.result.data, 'base64'));
}
console.log(JSON.stringify({ ok: true, x, y }));
ws.close();
