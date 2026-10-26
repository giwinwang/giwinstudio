(async () => {
  const source = `
    self.onmessage = async (event) => {
      const { id, dataURL, edge } = event.data;
      try {
        const blob = await (await fetch(dataURL)).blob();
        const probe = await createImageBitmap(blob);
        const nw = probe.width, nh = probe.height;
        probe.close();
        const ratio = Math.min(1, edge / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * ratio));
        const h = Math.max(1, Math.round(nh * ratio));
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: w, resizeHeight: h, resizeQuality: 'high'
        });
        self.postMessage({ id, ok: true, nw, nh, w, h, bitmap }, [bitmap]);
      } catch (error) {
        self.postMessage({ id, ok: false, error: String(error && error.message || error) });
      }
    };
  `;
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = 512;
  sourceCanvas.height = 256;
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.fillStyle = '#336699';
  sourceCtx.fillRect(0, 0, 512, 256);
  sourceCtx.fillStyle = '#ffffff';
  sourceCtx.fillRect(40, 40, 120, 80);
  const dataURL = sourceCanvas.toDataURL('image/png');
  const result = await new Promise((resolve, reject) => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => reject(new Error(event.message));
    worker.postMessage({ id: 1, dataURL, edge: 96 });
    setTimeout(() => reject(new Error('worker timeout')), 10000);
  });
  worker.terminate();
  if (!result.ok) return JSON.stringify(result);
  const canvas = document.createElement('canvas');
  canvas.width = result.w;
  canvas.height = result.h;
  canvas.getContext('2d').drawImage(result.bitmap, 0, 0);
  return JSON.stringify({
    natural: result.nw + 'x' + result.nh,
    thumb: canvas.width + 'x' + canvas.height,
    dataLen: canvas.toDataURL('image/jpeg', 0.7).length
  });
})()
