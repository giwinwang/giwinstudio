(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GWImageRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function create(options) {
    const opts = options || {};
    const read = opts.read;
    const readThumbCache = typeof opts.readThumb === 'function' ? opts.readThumb : null;
    const writeThumbCache = typeof opts.writeThumb === 'function' ? opts.writeThumb : null;
    if (typeof read !== 'function') throw new Error('image runtime requires read(src)');
    const fullBudget = opts.fullBudgetBytes || 192 * 1024 * 1024;
    const thumbBudget = opts.thumbBudgetBytes || 160 * 1024 * 1024;
    const full = new Map();
    const thumbs = new Map();
    const pending = new Map();
    let fullBytes = 0;
    let thumbBytes = 0;
    let thumbWorker = null;
    let workerUrl = '';
    let workerBroken = false;
    let workerSeq = 0;
    const workerPending = new Map();
    let thumbCacheHits = 0;
    let thumbCacheMisses = 0;
    const thumbTimings = [];

    function thumbTier(edge) {
      const requested = Math.max(1, Math.round(Number(edge) || 256));
      if (requested <= 64) return 32;
      if (requested <= 256) return 256;
      if (requested <= 512) return 512;
      if (requested <= 768) return 768;
      return 1024;
    }

    function touch(map, key) {
      const value = map.get(key);
      if (value == null) return value;
      map.delete(key);
      map.set(key, value);
      return value;
    }

    function pruneFull() {
      while (fullBytes > fullBudget) {
        const first = full.keys().next();
        if (first.done) break;
        const entry = full.get(first.value);
        full.delete(first.value);
        fullBytes -= entry.bytes;
      }
    }

    function pruneThumbs() {
      while (thumbBytes > thumbBudget) {
        const first = thumbs.keys().next();
        if (first.done) break;
        const entry = thumbs.get(first.value);
        thumbs.delete(first.value);
        thumbBytes -= entry.bytes;
      }
    }

    async function readDataURL(src) {
      const result = await read(src);
      if (!result || !result.ok || !result.dataURL) {
        throw new Error(result && result.msg ? result.msg : ('无法读取图片 ' + src));
      }
      return result.dataURL;
    }

    function decodeImage(dataURL) {
      const img = new Image();
      return new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = dataURL;
      });
    }

    function persistThumb(src, edge, canvas) {
      if (!writeThumbCache || !canvas || !canvas.toDataURL) return Promise.resolve(false);
      let dataURL = '';
      try {
        dataURL = canvas.toDataURL('image/webp', 0.82);
        if (!/^data:image\/webp/i.test(dataURL)) {
          dataURL = canvas.toDataURL('image/jpeg', 0.84);
        }
      } catch (error) {
        return Promise.resolve(false);
      }
      if (!dataURL) return Promise.resolve(false);
      try {
        return Promise.resolve(writeThumbCache(src, thumbTier(edge), {
          dataURL,
          width: canvas._gwNaturalWidth || canvas.naturalWidth || canvas.width,
          height: canvas._gwNaturalHeight || canvas.naturalHeight || canvas.height
        })).then(result => !!(result && result.ok)).catch(() => false);
      } catch (error) {
        return Promise.resolve(false);
      }
    }

    function thumbCanvasFromElement(image, edge) {
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      const ratio = Math.min(1, edge / Math.max(naturalWidth, naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(naturalHeight * ratio));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas._gwNaturalWidth = naturalWidth;
      canvas._gwNaturalHeight = naturalHeight;
      return canvas;
    }

    async function decodeCachedThumb(cached) {
      const image = await decodeImage(cached.dataURL || cached.url);
      if (Number(cached.width) > 0 && Number(cached.height) > 0) {
        image._gwNaturalWidth = Number(cached.width);
        image._gwNaturalHeight = Number(cached.height);
      }
      return image;
    }

    function ensureThumbWorker() {
      if (workerBroken || typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
      if (thumbWorker) return thumbWorker;
      try {
        const source = [
          'self.onmessage = async function (event) {',
          '  var d = event.data;',
          '  try {',
          '    var blob = await (await fetch(d.dataURL)).blob();',
          '    var probe = await createImageBitmap(blob);',
          '    var nw = probe.width, nh = probe.height;',
          '    var ratio = Math.min(1, d.edge / Math.max(nw, nh));',
          '    var w = Math.max(1, Math.round(nw * ratio));',
          '    var h = Math.max(1, Math.round(nh * ratio));',
          '    var bitmap;',
          '    if (ratio >= 1) { bitmap = probe; }',
          '    else { probe.close(); bitmap = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }); }',
          '    self.postMessage({ id: d.id, ok: true, nw: nw, nh: nh, w: w, h: h, bitmap: bitmap }, [bitmap]);',
          '  } catch (error) {',
          '    self.postMessage({ id: d.id, ok: false, error: String(error && error.message || error) });',
          '  }',
          '};'
        ].join('\n');
        workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        thumbWorker = new Worker(workerUrl);
        thumbWorker.onmessage = event => {
          const reply = event.data || {};
          const resolve = workerPending.get(reply.id);
          if (!resolve) return;
          workerPending.delete(reply.id);
          resolve(reply);
        };
        thumbWorker.onerror = () => {
          workerBroken = true;
          workerPending.forEach(resolve => resolve({ ok: false, error: 'worker error' }));
          workerPending.clear();
        };
        return thumbWorker;
      } catch (error) {
        workerBroken = true;
        return null;
      }
    }

    function thumbViaWorker(src, dataURL, edge) {
      const worker = ensureThumbWorker();
      if (!worker) return Promise.resolve(null);
      const id = ++workerSeq;
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          workerPending.delete(id);
          resolve(null);
        }, 20000);
        workerPending.set(id, reply => {
          clearTimeout(timer);
          if (!reply.ok || !reply.bitmap) { resolve(null); return; }
          try {
            const canvas = document.createElement('canvas');
            canvas.width = reply.w;
            canvas.height = reply.h;
            canvas.getContext('2d').drawImage(reply.bitmap, 0, 0);
            reply.bitmap.close();
            canvas._gwNaturalWidth = reply.nw;
            canvas._gwNaturalHeight = reply.nh;
            canvas._gwSrc = src;
            resolve(canvas);
          } catch (error) {
            try { reply.bitmap.close(); } catch (e) {}
            resolve(null);
          }
        });
        try {
          worker.postMessage({ id, dataURL, edge });
        } catch (error) {
          clearTimeout(timer);
          workerPending.delete(id);
          resolve(null);
        }
      });
    }

    async function buildThumb(src, edge) {
      const size = thumbTier(edge);
      if (readThumbCache) {
        const readStartedAt = performance.now();
        try {
          const cached = await readThumbCache(src, size);
          const readMs = Math.round(performance.now() - readStartedAt);
          if (cached && cached.ok && (cached.url || cached.dataURL)) {
            thumbCacheHits++;
            const decodeStartedAt = performance.now();
            // Persisted thumbnails are already small. Decode them directly instead of
            // sending them through the full-image worker path and copying pixels again.
            const image = await decodeCachedThumb(cached);
            const decodeMs = Math.round(performance.now() - decodeStartedAt);
            if (thumbTimings.length < 30) thumbTimings.push({ src, size, readMs, decodeMs, hit: true });
            image._gwSrc = src;
            return image;
          }
        } catch (error) {}
      }
      thumbCacheMisses++;
      const dataURL = await readDataURL(src);
      const workerThumb = await thumbViaWorker(src, dataURL, size);
      if (workerThumb) {
        persistThumb(src, size, workerThumb);
        return workerThumb;
      }
      let bitmap = null;
      try {
        const blob = await (await fetch(dataURL)).blob();
        bitmap = await createImageBitmap(blob);
        const naturalWidth = bitmap.width;
        const naturalHeight = bitmap.height;
        const ratio = Math.min(1, size / Math.max(naturalWidth, naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(naturalHeight * ratio));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        canvas._gwNaturalWidth = naturalWidth;
        canvas._gwNaturalHeight = naturalHeight;
        canvas._gwSrc = src;
        persistThumb(src, size, canvas);
        return canvas;
      } catch (error) {
        const img = await decodeImage(dataURL);
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        const ratio = Math.min(1, size / Math.max(naturalWidth, naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(naturalHeight * ratio));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas._gwNaturalWidth = naturalWidth;
        canvas._gwNaturalHeight = naturalHeight;
        canvas._gwSrc = src;
        persistThumb(src, size, canvas);
        return canvas;
      } finally {
        if (bitmap) bitmap.close();
      }
    }

    async function getFull(src) {
      const cached = touch(full, src);
      if (cached) return cached.img;
      const key = 'full:' + src;
      if (pending.has(key)) return pending.get(key);
      const task = (async () => {
        const dataURL = await readDataURL(src);
        const img = await decodeImage(dataURL);
        const bytes = Math.max(1, (img.naturalWidth || img.width) * (img.naturalHeight || img.height) * 4);
        full.set(src, { img, bytes });
        fullBytes += bytes;
        pruneFull();
        return img;
      })();
      pending.set(key, task);
      try {
        return await task;
      } finally {
        pending.delete(key);
      }
    }

    async function getThumb(src, edge) {
      const size = thumbTier(edge);
      const key = src + '@' + size;
      const cached = touch(thumbs, key);
      if (cached) return cached.canvas;
      if (pending.has('thumb:' + key)) return pending.get('thumb:' + key);
      const task = (async () => {
        const canvas = await buildThumb(src, size);
        const bytes = Math.max(1, canvas.width * canvas.height * 4);
        thumbs.set(key, { canvas, bytes });
        thumbBytes += bytes;
        pruneThumbs();
        return canvas;
      })();
      pending.set('thumb:' + key, task);
      try {
        return await task;
      } finally {
        pending.delete('thumb:' + key);
      }
    }

    async function warmThumb(src, tiers = [32, 256]) {
      const sizes = [...new Set((tiers || []).map(thumbTier))];
      const missing = [];
      for (const size of sizes) {
        const key = src + '@' + size;
        if (thumbs.has(key)) continue;
        let cached = null;
        if (readThumbCache) {
          try { cached = await readThumbCache(src, size); } catch (error) {}
        }
        if (!cached || !cached.ok || (!cached.url && !cached.dataURL)) missing.push(size);
      }
      if (!missing.length) return true;
      try {
        const dataURL = await readDataURL(src);
        let created = 0;
        for (const size of missing) {
          const canvas = await thumbViaWorker(src, dataURL, size);
          if (!canvas) continue;
          canvas._gwSrc = src;
          await persistThumb(src, size, canvas);
          const bytes = Math.max(1, canvas.width * canvas.height * 4);
          thumbs.set(src + '@' + size, { canvas, bytes });
          thumbBytes += bytes;
          pruneThumbs();
          created++;
        }
        if (created === missing.length) return true;
        const image = await decodeImage(dataURL);
        for (const size of missing) {
          const key = src + '@' + size;
          if (thumbs.has(key)) continue;
          const canvas = thumbCanvasFromElement(image, size);
          canvas._gwSrc = src;
          await persistThumb(src, size, canvas);
          const bytes = Math.max(1, canvas.width * canvas.height * 4);
          thumbs.set(key, { canvas, bytes });
          thumbBytes += bytes;
          pruneThumbs();
        }
        return true;
      } catch (error) {
        return false;
      }
    }

    function invalidate(src) {
      const fullEntry = full.get(src);
      if (fullEntry) {
        full.delete(src);
        fullBytes -= fullEntry.bytes;
      }
      for (const key of [...thumbs.keys()]) {
        if (key.startsWith(src + '@')) {
          thumbBytes -= thumbs.get(key).bytes;
          thumbs.delete(key);
        }
      }
    }

    function stats() {
      return {
        fullCount: full.size,
        fullMB: Math.round(fullBytes / 1048576),
        thumbCount: thumbs.size,
        thumbMB: Math.round(thumbBytes / 1048576),
        pending: pending.size,
        worker: !!thumbWorker && !workerBroken,
        workerPending: workerPending.size,
        cacheHits: thumbCacheHits,
        cacheMisses: thumbCacheMisses,
        timings: thumbTimings.slice()
      };
    }

    function dispose() {
      workerBroken = true;
      workerPending.forEach(resolve => resolve({ ok: false, error: 'disposed' }));
      workerPending.clear();
      if (thumbWorker) { try { thumbWorker.terminate(); } catch (e) {} thumbWorker = null; }
      if (workerUrl) { try { URL.revokeObjectURL(workerUrl); } catch (e) {} workerUrl = ''; }
    }

    return { getFull, getThumb, warmThumb, readDataURL, invalidate, stats, dispose };
  }

  return { create };
});
