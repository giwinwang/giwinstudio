(function () {
  'use strict';

  let panel = null;
  let visible = false;
  let frames = 0;
  let fps = 0;
  let windowStart = performance.now();
  let lastPaint = 0;
  let rafId = 0;

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'gw-runtime-hud';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:38px',
      'z-index:520',
      'display:none',
      'min-width:250px',
      'padding:9px 11px',
      'border:1px solid rgba(255,255,255,.14)',
      'border-radius:10px',
      'background:rgba(22,22,22,.9)',
      'box-shadow:0 10px 30px rgba(0,0,0,.35)',
      'color:#d9d6d0',
      'font:11px/17px ui-monospace,SFMono-Regular,Consolas,monospace',
      'pointer-events:none',
      'backdrop-filter:blur(8px)'
    ].join(';');
    document.body.appendChild(panel);
    return panel;
  }

  function paint(now) {
    if (!visible) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(paint);
    frames++;
    if (now - windowStart >= 500) {
      fps = Math.round(frames * 1000 / (now - windowStart));
      frames = 0;
      windowStart = now;
    }
    if (!visible || now - lastPaint < 300) return;
    lastPaint = now;
    const api = window.GWCanvas;
    if (!api || !api.getRuntimeStats) return;
    const stats = api.getRuntimeStats();
    const types = Object.keys(stats.byType || {}).map(k => k + ' ' + stats.byType[k]).join(' · ');
    const mem = stats.memory ? stats.memory.usedMB + ' / ' + stats.memory.limitMB + ' MB' : '不可用';
    const schema = window.GWGraphCore ? 'schema v' + window.GWGraphCore.SCHEMA_VERSION : 'schema --';
    const culling = stats.culling && stats.culling.enabled
      ? '可见 ' + stats.culling.visible + '/' + stats.culling.total
      : '视口裁剪待机';
    const imageCache = stats.images
      ? 'IMG full ' + stats.images.fullMB + 'MB · thumb ' + stats.images.thumbMB + 'MB'
      : '';
    ensurePanel().textContent =
      'FPS ' + fps + '  ·  ' + stats.nodes + ' 节点  ·  ' + stats.edges + ' 连线\n' +
      '选区 ' + stats.selected + '  ·  待生成 ' + stats.pending + '  ·  撤销 ' + stats.undo + ' / 重做 ' + stats.redo + '\n' +
      '缩放 ' + stats.zoom + '%  ·  视口 ' + (stats.viewport ? stats.viewport.w + '×' + stats.viewport.h : '--') + '\n' +
      culling + '  ·  ' + schema + '\n' +
      (types ? types + '\n' : '') +
      (imageCache ? imageCache + '\n' : '') +
      'JS 堆 ' + mem;
  }

  function setEnabled(enabled, persist) {
    visible = !!enabled;
    const el = ensurePanel();
    el.style.display = visible ? 'block' : 'none';
    if (visible) {
      frames = 0;
      windowStart = performance.now();
      lastPaint = 0;
      if (!rafId) rafId = requestAnimationFrame(paint);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (persist !== false) {
      try { localStorage.setItem('gw_perf_hud', visible ? 'on' : 'off'); } catch (error) {}
    }
  }

  function toggle() {
    setEnabled(!visible, true);
  }

  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && e.shiftKey && !e.metaKey && e.code === 'KeyD') {
      e.preventDefault();
      toggle();
    }
  });

  window.GWRuntimeDiagnostics = {
    toggle,
    show() { if (!visible) setEnabled(true, true); },
    hide() { if (visible) setEnabled(false, true); },
    isVisible() { return visible; },
    snapshot() { return window.GWCanvas && window.GWCanvas.getRuntimeStats ? window.GWCanvas.getRuntimeStats() : null; }
  };

  try {
    if (localStorage.getItem('gw_perf_hud') === 'on') setEnabled(true, false);
  } catch (error) {}
})();
