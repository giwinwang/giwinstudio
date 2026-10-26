(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GWSceneRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function rectIntersects(a, b) {
    return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
  }

  let ctx = null;
  let forceVisible = false;
  let useGlowBacklight = false;
  let lastStats = { total: 0, visible: 0, culled: 0, enabled: false };
  let shadowMode = null;
  const lastVisibility = new Map();

  function applyShadowTree(node, enabled) {
    if (!node) return;
    if (typeof node.shadowEnabled === 'function') {
      if (enabled) {
        if (node.__gwShadowWasEnabled) node.shadowEnabled(true);
      } else {
        if (node.shadowEnabled()) node.__gwShadowWasEnabled = true;
        node.shadowEnabled(false);
      }
    }
    if (node.getChildren) node.getChildren().forEach(child => applyShadowTree(child, enabled));
  }

  function applyShadowLod(records, enabled, selected) {
    if (useGlowBacklight) return;
    if (!enabled) {
      // 大型项目关闭普通阴影以省性能，但选中节点的背光必须保留。
      records.forEach(rec => applyShadowTree(rec.konva, selected.has(rec.konva)));
      shadowMode = false;
      return;
    }
    if (shadowMode === true) return;
    shadowMode = true;
    records.forEach(rec => applyShadowTree(rec.konva, true));
  }

  function notifyVisibility(records, visibleIds) {
    if (!ctx.onVisible || forceVisible) return;
    records.forEach(rec => {
      const visible = visibleIds.has(rec.id);
      if (lastVisibility.get(rec.id) === visible) return;
      lastVisibility.set(rec.id, visible);
      try { ctx.onVisible(rec, visible); } catch (error) { /* visibility callbacks must not break drawing */ }
    });
  }

  function init(options) {
    ctx = Object.assign({}, options);
    useGlowBacklight = !!ctx.useGlowBacklight;
    forceVisible = false;
    lastStats = { total: 0, visible: 0, culled: 0, enabled: false };
    shadowMode = null;
    lastVisibility.clear();
  }

  function setForceVisible(value) {
    forceVisible = !!value;
    sync();
  }

  function sync() {
    if (!ctx || !ctx.getStage || !ctx.getNodes) return lastStats;
    const stage = ctx.getStage();
    if (!stage) return lastStats;
    const layer = ctx.getLayer ? ctx.getLayer() : null;
    const records = ctx.getNodes().filter(rec => rec && rec.konva && rec.konva.getStage && rec.konva.getStage());
    const selected = new Set(ctx.getSelection ? ctx.getSelection() : []);
    const total = records.length;
    // 视口裁剪和阴影降级使用不同阈值：小项目也需要视口裁剪，
    // 但阴影只应在大型项目里关闭，否则 8 个节点以上就全部失去阴影。
    const zoom = typeof ctx.getZoom === 'function' ? Number(ctx.getZoom()) || 1 : 1;
    const shadowsEnabled = total < (ctx.shadowThreshold || 160) &&
      zoom >= (ctx.shadowMinZoom == null ? 0.35 : ctx.shadowMinZoom);
    applyShadowLod(records, shadowsEnabled, selected);
    const cullingEnabled = !forceVisible && total >= (ctx.threshold || 160);
    if (!cullingEnabled) {
      records.forEach(rec => {
        const panelBacking = !!rec.konva.gwPanelMode;
        rec.konva.visible(!panelBacking);
        if (rec.konva.gwSelectionGlow) rec.konva.gwSelectionGlow.visible(!panelBacking && selected.has(rec.konva));
        if (Array.isArray(rec.konva.gwExtras)) rec.konva.gwExtras.forEach(extra => extra.visible(true));
        if (rec.konva.gwBadgeNode) rec.konva.gwBadgeNode.visible(!panelBacking);
        if (rec.konva.gwLine) rec.konva.gwLine.visible(true);
        if (rec.konva.gwLineDot) rec.konva.gwLineDot.visible(true);
        if (Array.isArray(rec.konva.gwCompareLinks)) rec.konva.gwCompareLinks.forEach(line => line.visible(true));
      });
      lastStats = { total, visible: total, culled: 0, enabled: false };
      notifyVisibility(records, new Set(records.map(rec => rec.id)));
      return lastStats;
    }

    const scale = stage.scaleX() || 1;
    const margin = (ctx.marginScreenPx || 260) / scale;
    const view = {
      x: -stage.x() / scale - margin,
      y: -stage.y() / scale - margin,
      width: stage.width() / scale + margin * 2,
      height: stage.height() / scale + margin * 2
    };
    const visibility = new Map();
    let visibleCount = 0;
    records.forEach(rec => {
      const k = rec.konva;
      const raw = layer ? k.getClientRect({ relativeTo: layer }) : k.getClientRect();
      const box = layer ? raw : {
        x: (raw.x - stage.x()) / scale,
        y: (raw.y - stage.y()) / scale,
        width: raw.width / scale,
        height: raw.height / scale
      };
      // DOM 面板节点（生成/材质/光影）始终参与连线可见性，不能被 Konva 卡片的裁剪误伤。
      const visible = selected.has(k) || k.gwPanelMode || rectIntersects(box, view);
      visibility.set(rec.id, visible);
      if (visible) visibleCount++;
      k.visible(k.gwPanelMode ? false : visible);
      if (k.gwSelectionGlow) k.gwSelectionGlow.visible(!k.gwPanelMode && visible && selected.has(k));
      if (Array.isArray(k.gwExtras)) k.gwExtras.forEach(extra => extra.visible(visible));
      if (k.gwBadgeNode) k.gwBadgeNode.visible(k.gwPanelMode ? false : visible);
      if (k.gwLine) k.gwLine.visible(visible);
      if (k.gwLineDot) k.gwLineDot.visible(visible);
      if (Array.isArray(k.gwCompareLinks)) k.gwCompareLinks.forEach(line => line.visible(visible));
    });
    if (ctx.getEdges) {
      ctx.getEdges().forEach(edge => {
        if (!edge || !edge.line || !edge.line.getStage || !edge.line.getStage()) return;
        edge.line.visible(!!(visibility.get(edge.from) || visibility.get(edge.to)));
      });
    }
    lastStats = { total, visible: visibleCount, culled: total - visibleCount, enabled: true };
    notifyVisibility(records, new Set([...visibility].filter(([, visible]) => visible).map(([id]) => id)));
    return lastStats;
  }

  function stats() {
    return Object.assign({}, lastStats);
  }

  return { init, sync, stats, setForceVisible, rectIntersects };
});
