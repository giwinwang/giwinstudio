const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../image-runtime.js');

function installFakeImage() {
  const previous = global.Image;
  global.Image = class {
    constructor() {
      this.naturalWidth = 100;
      this.naturalHeight = 50;
      this.width = 100;
      this.height = 50;
    }
    set src(value) {
      this._src = value;
      queueMicrotask(() => { if (this.onload) this.onload(); });
    }
    get src() { return this._src; }
  };
  return () => { global.Image = previous; };
}

test('image runtime caches decoded originals and invalidates them', async () => {
  const restore = installFakeImage();
  let reads = 0;
  const runtime = Runtime.create({
    read: async () => {
      reads++;
      return { ok: true, dataURL: 'data:image/png;base64,AA==' };
    },
    fullBudgetBytes: 1024 * 1024
  });
  const first = await runtime.getFull('a.png');
  const second = await runtime.getFull('a.png');
  assert.equal(reads, 1);
  assert.equal(first, second);
  assert.equal(runtime.stats().fullCount, 1);
  runtime.invalidate('a.png');
  assert.equal(runtime.stats().fullCount, 0);
  await runtime.getFull('a.png');
  assert.equal(reads, 2);
  restore();
});

test('image runtime evicts old originals when the byte budget is exceeded', async () => {
  const restore = installFakeImage();
  const runtime = Runtime.create({
    read: async () => ({ ok: true, dataURL: 'data:image/png;base64,AA==' }),
    fullBudgetBytes: 50000
  });
  await runtime.getFull('a.png');
  await runtime.getFull('b.png');
  await runtime.getFull('c.png');
  assert.ok(runtime.stats().fullCount <= 2);
  assert.ok(runtime.stats().fullMB <= 1);
  restore();
});

test('image runtime uses a persisted thumbnail without reading the original', async () => {
  const restore = installFakeImage();
  const previousWorker = global.Worker;
  let workerConstructions = 0;
  let workerMessages = 0;
  global.Worker = class {
    constructor() { workerConstructions++; }
    postMessage() { workerMessages++; }
    terminate() {}
  };
  let reads = 0;
  const runtime = Runtime.create({
    read: async () => {
      reads++;
      return { ok: true, dataURL: 'data:image/png;base64,AA==' };
    },
    readThumb: async () => ({
      ok: true,
      dataURL: 'data:image/jpeg;base64,AA==',
      width: 4000,
      height: 2250
    })
  });
  const thumb = await runtime.getThumb('project-image.jpg', 512);
  assert.equal(reads, 0);
  assert.equal(thumb._gwNaturalWidth, 4000);
  assert.equal(thumb._gwNaturalHeight, 2250);
  assert.equal(runtime.stats().thumbCount, 1);
  assert.equal(workerConstructions, 0);
  assert.equal(workerMessages, 0);
  if (previousWorker === undefined) delete global.Worker;
  else global.Worker = previousWorker;
  restore();
});

test('image runtime preserves distinct 512 and 768 display tiers', async () => {
  const restore = installFakeImage();
  const runtime = Runtime.create({
    read: async () => ({ ok: true, dataURL: 'data:image/png;base64,AA==' }),
    readThumb: async () => ({
      ok: true,
      dataURL: 'data:image/jpeg;base64,AA==',
      width: 4000,
      height: 2250
    })
  });
  await runtime.getThumb('project-image.jpg', 512);
  await runtime.getThumb('project-image.jpg', 768);
  const tiers = runtime.stats().timings.map(item => item.size);
  assert.deepEqual(tiers, [512, 768]);
  restore();
});
