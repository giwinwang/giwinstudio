import { readFile, writeFile } from 'node:fs/promises';

const shotIndex = process.argv.indexOf('--shot');
const shotPath = shotIndex >= 0 ? process.argv[shotIndex + 1] : null;
const clipIndex = process.argv.indexOf('--clip');
const clipValue = clipIndex >= 0 ? String(process.argv[clipIndex + 1] || '').split(',').map(Number) : null;
const shotScaleIndex = process.argv.indexOf('--shot-scale');
const shotScale = shotScaleIndex >= 0 ? Math.max(1, Number(process.argv[shotScaleIndex + 1]) || 1) : 1;
const args = process.argv.slice(2).filter((value, index, list) => {
  if (value === '--shot') return false;
  if (index > 0 && list[index - 1] === '--shot') return false;
  if (value === '--clip') return false;
  if (index > 0 && list[index - 1] === '--clip') return false;
  if (value === '--shot-scale') return false;
  if (index > 0 && list[index - 1] === '--shot-scale') return false;
  return true;
});
const source = args[0] === '--file'
  ? await readFile(args[1], 'utf8')
  : args[0];
if (!source) {
  console.error('usage: node tests/cdp-eval.mjs "<expression>" | --file <path>');
  process.exit(2);
}

const cdpPort = process.env.GW_CDP_PORT || '9222';
const targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
const targetTitle = process.env.GW_CDP_TARGET_TITLE || '';
const page = targets.find(t => t.type === 'page' && (!targetTitle || String(t.title || '').includes(targetTitle)));
if (!page) {
  console.error('no debuggable page');
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  waiter(msg);
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

function send(method, params) {
  const id = ++seq;
  return new Promise(resolve => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable', {});
const reply = await send('Runtime.evaluate', {
  expression: source,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true
});
const result = reply.result || {};
if (result.exceptionDetails) {
  console.error(JSON.stringify(result.exceptionDetails, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result.result?.value ?? result.result, null, 2));
}
if (shotPath) {
  const shotParams = { format: 'png', captureBeyondViewport: false };
  if (clipValue && clipValue.length === 4 && clipValue.every(Number.isFinite)) {
    shotParams.clip = {
      x: clipValue[0],
      y: clipValue[1],
      width: clipValue[2],
      height: clipValue[3],
      scale: shotScale
    };
  }
  const shot = await send('Page.captureScreenshot', shotParams);
  await writeFile(shotPath, Buffer.from(shot.result.data, 'base64'));
}
ws.close();
