import { writeFile } from 'node:fs/promises';

const shotIndex = process.argv.indexOf('--shot');
const shotPath = shotIndex >= 0 ? process.argv[shotIndex + 1] : null;
const holdAlt = process.argv.includes('--alt');
const args = process.argv.slice(2).filter((value, index, list) => {
  if (value === '--shot') return false;
  if (value === '--alt') return false;
  if (index > 0 && list[index - 1] === '--shot') return false;
  return true;
});
const [fromX, fromY, toX, toY] = args.slice(0, 4).map(Number);
const dragButton = args[4] || 'left';
const dragButtons = dragButton === 'middle' ? 4 : (dragButton === 'right' ? 2 : 1);
const dragModifiers = holdAlt ? 1 : 0;
if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
  console.error('usage: node tests/cdp-drag.mjs <fromX> <fromY> <toX> <toY> [left|middle|right]');
  process.exit(2);
}

const cdpPort = process.env.GW_CDP_PORT || '9222';
const targetTitle = process.env.GW_CDP_TARGET_TITLE || '';
const targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
const page = targets.find(target => target.type === 'page' && (!targetTitle || String(target.title || '').includes(targetTitle)));
if (!page) throw new Error('no matching CDP page');

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

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await send('Page.bringToFront');
await send('Runtime.enable');
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX, y: fromY, modifiers: dragModifiers });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: dragButton, buttons: dragButtons, clickCount: 1, modifiers: dragModifiers });
for (let step = 1; step <= 8; step++) {
  const amount = step / 8;
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(fromX + (toX - fromX) * amount),
    y: Math.round(fromY + (toY - fromY) * amount),
    button: dragButton,
    buttons: dragButtons,
    modifiers: dragModifiers
  });
  await wait(24);
}
if (shotPath) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(shotPath, Buffer.from(shot.result.data, 'base64'));
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: dragButton, buttons: 0, clickCount: 1, modifiers: dragModifiers });
await wait(250);
console.log(JSON.stringify({ ok: true, button: dragButton, from: [fromX, fromY], to: [toX, toY] }));
ws.close();
setTimeout(() => process.exit(0), 20);
