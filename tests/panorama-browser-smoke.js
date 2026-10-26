"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1500,
    height: 700,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, "panorama-browser-smoke.html"));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const P = window.GWPanoramaRuntime;
    if (!P) throw new Error('panorama runtime missing');
    const source = document.createElement('canvas');
    source.width = 512;
    source.height = 256;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    const gradient = sourceContext.createLinearGradient(0, 0, 512, 256);
    gradient.addColorStop(0, '#8a5a32');
    gradient.addColorStop(1, '#d6d2cc');
    sourceContext.fillStyle = gradient;
    sourceContext.fillRect(0, 0, 512, 256);
    sourceContext.fillStyle = 'rgba(12,34,56,.5)';
    sourceContext.fillRect(255, 127, 2, 2);

    const assets = P.createPoleRepairSheet(source, { size: 256, radius: 12, fov: 70 });
    const repaired = document.createElement('canvas');
    repaired.width = 512;
    repaired.height = 256;
    const repairedContext = repaired.getContext('2d');
    repairedContext.fillStyle = '#54c28a';
    repairedContext.fillRect(0, 0, repaired.width, repaired.height);
    P.compositePoleSheet(source, repaired, { size: 256, radius: 12, fov: 70 });
    const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
    const alphaAt = (x, y) => pixels[(y * source.width + x) * 4 + 3];
    const top = Array.from(sourceContext.getImageData(256, 0, 1, 1).data);
    const bottom = Array.from(sourceContext.getImageData(256, 255, 1, 1).data);
    const equator = Array.from(sourceContext.getImageData(256, 128, 1, 1).data);
    const stage = document.querySelector('#stage');
    for (const [label, canvas] of [['source', source], ['sheet', assets.sheet], ['mask', assets.mask], ['overlay', assets.overlay]]) {
      const wrap = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = label;
      canvas.style.width = label === 'source' ? '360px' : '540px';
      canvas.style.height = 'auto';
      wrap.appendChild(title);
      wrap.appendChild(canvas);
      stage.appendChild(wrap);
    }
    return {
      assets: [assets.sheet.width, assets.sheet.height, assets.mask.width, assets.mask.height],
      alphaPreserved: alphaAt(256, 128) === alphaAt(20, 20),
      equator,
      top,
      bottom,
      maskCentre: assets.mask.toDataURL('image/png').length,
      uploadBytesApprox: Math.round(assets.mask.toDataURL('image/png').length * 0.75),
      overlayBytesApprox: Math.round(assets.overlay.toDataURL('image/png').length * 0.75)
    };
  })()`);
  assert.deepEqual(result.assets, [512, 256, 512, 256]);
  assert.equal(result.alphaPreserved, true);
  assert.ok(result.equator[3] > 0);
  assert.ok(result.top[1] > 100, 'top pole should receive the repaired tile');
  assert.ok(result.bottom[1] > 100, 'bottom pole should receive the repaired tile');
  assert.ok(result.overlayBytesApprox < 4 * 1024 * 1024, 'pole repair upload should stay small');
  console.log(JSON.stringify(result));
  if (process.env.PANORAMA_SMOKE_OUT) fs.writeFileSync(process.env.PANORAMA_SMOKE_OUT, JSON.stringify(result, null, 2));
  if (process.env.PANORAMA_SMOKE_SHOT) {
    const image = await win.capturePage();
    fs.writeFileSync(process.env.PANORAMA_SMOKE_SHOT, image.toPNG());
  }
  win.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  if (process.env.PANORAMA_SMOKE_OUT) fs.writeFileSync(process.env.PANORAMA_SMOKE_OUT, JSON.stringify({ ok: false, error: error.stack || String(error) }, null, 2));
  app.exit(1);
});
