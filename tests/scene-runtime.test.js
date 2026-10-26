const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../scene-runtime.js');

test('viewport intersection includes touching bounds and rejects far nodes', () => {
  const view = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(Runtime.rectIntersects({ x: 90, y: 90, width: 20, height: 20 }, view), true);
  assert.equal(Runtime.rectIntersects({ x: 101, y: 0, width: 20, height: 20 }, view), false);
});

test('scene runtime culls large projects and restores when forced visible', () => {
  const fakeStage = { x: () => 0, y: () => 0, width: () => 1000, height: () => 800, scaleX: () => 1 };
  const records = Array.from({ length: 200 }, (_, i) => {
    const node = {
      _visible: true,
      visible(value) {
        if (value == null) return this._visible;
        this._visible = value;
        return this;
      },
      getStage: () => fakeStage,
      getClientRect: () => i === 199
        ? { x: 5000, y: 5000, width: 200, height: 120 }
        : { x: 0, y: 0, width: 200, height: 120 }
    };
    return { id: 'n' + i, konva: node };
  });
  Runtime.init({
    getStage: () => fakeStage,
    getNodes: () => records,
    getSelection: () => [],
    getEdges: () => [],
    threshold: 160,
    marginScreenPx: 0
  });
  let stats = Runtime.sync();
  assert.equal(stats.enabled, true);
  assert.equal(stats.total, 200);
  assert.equal(stats.visible, 199);
  assert.equal(records[199].konva.visible(), false);
  Runtime.setForceVisible(true);
  stats = Runtime.stats();
  assert.equal(stats.visible, 200);
  assert.equal(records[199].konva.visible(), true);
});

test('shadow LOD turns shadows off for large graphs and restores them for small graphs', () => {
  const fakeStage = { x: () => 0, y: () => 0, width: () => 1000, height: () => 800, scaleX: () => 1 };
  function makeNode(shadow) {
    return {
      _shadow: shadow,
      _visible: true,
      visible(value) {
        if (value == null) return this._visible;
        this._visible = value;
        return this;
      },
      shadowEnabled(value) {
        if (value == null) return this._shadow;
        this._shadow = value;
        return this;
      },
      getStage: () => fakeStage,
      getClientRect: () => ({ x: 0, y: 0, width: 100, height: 80 })
    };
  }
  const big = Array.from({ length: 200 }, (_, i) => ({ id: 'b' + i, konva: makeNode(true) }));
  Runtime.init({ getStage: () => fakeStage, getNodes: () => big, getSelection: () => [], getEdges: () => [], threshold: 160 });
  Runtime.sync();
  assert.equal(big[0].konva.shadowEnabled(), false);

  const small = Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, konva: makeNode(true) }));
  Runtime.init({ getStage: () => fakeStage, getNodes: () => small, getSelection: () => [], getEdges: () => [], threshold: 160 });
  Runtime.sync();
  assert.equal(small[0].konva.shadowEnabled(), true);
});

test('shadow LOD suppresses ordinary node shadows at low zoom and restores them when zoomed in', () => {
  const fakeStage = { x: () => 0, y: () => 0, width: () => 1000, height: () => 800, scaleX: () => 0.25 };
  function makeNode() {
    return {
      _shadow: true,
      _visible: true,
      visible(value) {
        if (value == null) return this._visible;
        this._visible = value;
        return this;
      },
      shadowEnabled(value) {
        if (value == null) return this._shadow;
        this._shadow = value;
        return this;
      },
      getStage: () => fakeStage,
      getClientRect: () => ({ x: 0, y: 0, width: 100, height: 80 })
    };
  }
  const records = Array.from({ length: 20 }, (_, i) => ({ id: 'z' + i, konva: makeNode() }));
  Runtime.init({
    getStage: () => fakeStage,
    getNodes: () => records,
    getSelection: () => [],
    getEdges: () => [],
    threshold: 160,
    shadowMinZoom: 0.35,
    getZoom: () => fakeStage.scaleX()
  });
  Runtime.sync();
  assert.equal(records[0].konva.shadowEnabled(), false);
  fakeStage.scaleX = () => 0.8;
  Runtime.init({
    getStage: () => fakeStage,
    getNodes: () => records,
    getSelection: () => [],
    getEdges: () => [],
    threshold: 160,
    shadowMinZoom: 0.35,
    getZoom: () => fakeStage.scaleX()
  });
  Runtime.sync();
  assert.equal(records[0].konva.shadowEnabled(), true);
});

test('shadow LOD keeps backlight for selected nodes in large graphs', () => {
  const fakeStage = { x: () => 0, y: () => 0, width: () => 1000, height: () => 800, scaleX: () => 1 };
  function makeNode() {
    return {
      _shadow: true,
      _visible: true,
      visible(value) {
        if (value == null) return this._visible;
        this._visible = value;
        return this;
      },
      shadowEnabled(value) {
        if (value == null) return this._shadow;
        this._shadow = value;
        return this;
      },
      getStage: () => fakeStage,
      getClientRect: () => ({ x: 0, y: 0, width: 100, height: 80 })
    };
  }
  let selected = [];
  const records = Array.from({ length: 200 }, (_, i) => ({ id: 'g' + i, konva: makeNode() }));
  Runtime.init({ getStage: () => fakeStage, getNodes: () => records, getSelection: () => selected, getEdges: () => [], threshold: 160 });
  selected = [records[0].konva];
  Runtime.sync();
  assert.equal(records[0].konva.shadowEnabled(), true);
  assert.equal(records[1].konva.shadowEnabled(), false);
  selected = [records[1].konva];
  Runtime.sync();
  assert.equal(records[0].konva.shadowEnabled(), false);
  assert.equal(records[1].konva.shadowEnabled(), true);
});

test('visibility callback fires only when a node enters or leaves the viewport', () => {
  const fakeStage = { x: () => 0, y: () => 0, width: () => 1000, height: () => 800, scaleX: () => 1 };
  const records = Array.from({ length: 200 }, (_, i) => ({
    id: 'v' + i,
    konva: {
      _visible: true,
      visible(value) {
        if (value == null) return this._visible;
        this._visible = value;
        return this;
      },
      getStage: () => fakeStage,
      getClientRect: () => i === 199
        ? { x: 5000, y: 5000, width: 100, height: 80 }
        : { x: 0, y: 0, width: 100, height: 80 }
    }
  }));
  const events = [];
  Runtime.init({
    getStage: () => fakeStage,
    getNodes: () => records,
    getSelection: () => [],
    getEdges: () => [],
    threshold: 160,
    marginScreenPx: 0,
    onVisible: (rec, visible) => events.push(rec.id + ':' + visible)
  });
  Runtime.sync();
  assert.equal(events.filter(e => e === 'v199:false').length, 1);
  Runtime.sync();
  assert.equal(events.filter(e => e === 'v199:false').length, 1);
  Runtime.setForceVisible(true);
  assert.equal(events.filter(e => e === 'v199:true').length, 0);
  Runtime.setForceVisible(false);
  assert.equal(events.filter(e => e === 'v199:false').length, 1);
});

test('glow-backlight mode keeps panel backings out of the canvas without touching shadows', () => {
  const fakeStage = { x: () => 0, y: () => 0, width: () => 1000, height: () => 800, scaleX: () => 1 };
  function makeNode(panelMode) {
    return {
      _shadow: true,
      _visible: true,
      gwPanelMode: panelMode,
      visible(value) {
        if (value == null) return this._visible;
        this._visible = value;
        return this;
      },
      shadowEnabled(value) {
        if (value == null) return this._shadow;
        this._shadow = value;
        return this;
      },
      getStage: () => fakeStage,
      getClientRect: () => ({ x: 0, y: 0, width: 100, height: 80 })
    };
  }
  const canvasNode = makeNode(false);
  const panelNode = makeNode(true);
  const records = [
    { id: 'canvas', konva: canvasNode },
    { id: 'panel', konva: panelNode }
  ];
  Runtime.init({
    getStage: () => fakeStage,
    getNodes: () => records,
    getSelection: () => [],
    getEdges: () => [],
    threshold: 8,
    marginScreenPx: 0,
    useGlowBacklight: true
  });
  const stats = Runtime.sync();
  assert.equal(stats.visible, 2);
  assert.equal(canvasNode.visible(), true);
  assert.equal(panelNode.visible(), false);
  assert.equal(canvasNode.shadowEnabled(), true);
  assert.equal(panelNode.shadowEnabled(), true);
});
