(function () {
  'use strict';

  const STORAGE_KEY = 'gw_quickstart_v1';
  const VERSION = 1;
  let state = loadState();
  let root = null;
  let card = null;
  let spot = null;
  let pollTimer = null;
  let advanceTimer = null;
  let autoTimer = null;

  const steps = [
    {
      id: 'toolbar',
      eyebrow: '工具导航',
      title: '先认识三个区域',
      body: '左侧工具栏负责导入、资产、整理、版本和视图；中央画布用来拖图、选中和连线；选中图片后，右侧会显示生成设置。',
      hint: '这次只先记住“从左侧导入图片”。',
      action: '去导入图片',
      target: () => document.getElementById('gw-rail')
    },
    {
      id: 'import',
      eyebrow: '第 2 步',
      title: '导入一张空间结构图',
      body: '拖入图片，或点击左侧“导入图片”。这张图会锁定镜头角度、墙体、门窗和固定家具结构。',
      hint: '完成后这里会自动进入下一步。',
      action: '打开图片导入',
      target: () => document.querySelector('#gw-rail [data-rail="import"]'),
      complete: () => nodesOfType('image').length > 0,
      run: openImageImporter
    },
    {
      id: 'generator',
      eyebrow: '第 3 步',
      title: '把结构图接入生成节点',
      body: '先选中刚导入的结构图，再创建生成节点。节点之间的连线表示图片、参数和结果的实际流向。',
      hint: '结构图是图 1，始终优先锁定物理结构。',
      action: '创建生成节点',
      target: () => selectedMediaRect() || document.getElementById('canvas-wrap'),
      complete: () => nodesOfType('generator').length > 0,
      run: createGeneratorFromSelection
    },
    {
      id: 'configure',
      eyebrow: '第 4 步',
      title: '确认模型和出图数量',
      body: '在生成节点右侧检查引擎、模型、清晰度和每机位数量。第一次使用建议保持 1 张，先确认结果方向和结构。',
      hint: '模型能力不同，实际可用尺寸以面板显示为准。',
      action: '设置好了',
      target: () => document.querySelector('.generator-panel') || document.getElementById('side-right')
    },
    {
      id: 'references',
      eyebrow: '第 5 步',
      title: '参考设置可以稍后再加',
      body: '材质、光影和外景都是可选增强。第一次出图先不追求参数完整，确认空间结构和镜头正确更重要。',
      hint: '不需要这些设置也可以直接生成。',
      action: '继续生成',
      skipLabel: '保留默认',
      target: () => document.querySelector('.generator-panel') || document.getElementById('side-right')
    },
    {
      id: 'generate',
      eyebrow: '第 6 步',
      title: '生成第一张效果图',
      body: '点击高亮的生成按钮。生成结果会作为新节点出现在画布上，并自动连接到生成节点。',
      hint: '看到生成结果后，引导会自动完成这一步。',
      action: '开始生成',
      target: findGenerateButton,
      complete: () => nodesOfType('variant').length > 0,
      run: clickGenerateButton
    },
    {
      id: 'review',
      eyebrow: '最后一步',
      title: '检查结果并保存正稿',
      body: '双击结果查看大图，选中参考图和生成图可以使用对比。满意后把结果设为定稿，再继续下一张。',
      hint: '完成这次流程后，不会再自动重复提示。',
      action: '完成第一次出图',
      target: () => lastNodeRect('variant')
    }
  ];

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.version === VERSION && typeof saved.step === 'number') return saved;
    } catch (error) {}
    return { version: VERSION, status: 'new', step: 0, updatedAt: Date.now() };
  }

  function saveState(patch) {
    state = Object.assign({}, state, patch || {}, { version: VERSION, updatedAt: Date.now() });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
  }

  function hasProject() {
    return !!(window.GWProjectState && window.GWProjectState.hasProject && window.GWProjectState.hasProject());
  }

  function canvasState() {
    return window.GWCanvas && window.GWCanvas.getCanvasState
      ? window.GWCanvas.getCanvasState()
      : null;
  }

  function nodesOfType(type) {
    const snapshot = canvasState();
    return snapshot && Array.isArray(snapshot.nodes)
      ? snapshot.nodes.filter(node => node.type === type)
      : [];
  }

  function selectedMediaIds() {
    if (!window.GWCanvas || !window.GWCanvas.getSelectionIds) return [];
    const records = nodesOfType('image').concat(nodesOfType('variant'));
    const media = new Set(records.map(record => record.id));
    return window.GWCanvas.getSelectionIds().filter(id => media.has(id));
  }

  function selectedMediaRect() {
    const id = selectedMediaIds()[0];
    return id && window.GWCanvas && window.GWCanvas.nodeClientRect
      ? window.GWCanvas.nodeClientRect(id)
      : null;
  }

  function lastNodeRect(type) {
    const records = nodesOfType(type);
    const id = records.length && records[records.length - 1].id;
    return id && window.GWCanvas && window.GWCanvas.nodeClientRect
      ? window.GWCanvas.nodeClientRect(id)
      : null;
  }

  function findGenerateButton() {
    return document.querySelector('.generator-panel [data-generate]') ||
      document.querySelector('.generator-panel .gen-cta') ||
      document.getElementById('gp-gen');
  }

  function openImageImporter() {
    const button = document.querySelector('#gw-rail [data-rail="import"]') || document.getElementById('btn-empty-import');
    if (button) button.click();
  }

  function createGeneratorFromSelection() {
    const ids = selectedMediaIds();
    if (!ids.length) {
      setNotice('先在画布中点击一张结构图，再回到这里。');
      return false;
    }
    if (!window.GWCanvas || !window.GWCanvas.createRenderWorkflowFromIds) {
      setNotice('当前版本不支持自动创建，请使用画布上的生成入口。');
      return false;
    }
    try {
      const result = window.GWCanvas.createRenderWorkflowFromIds(ids, {}, { positions: null });
      const first = result && result.generatorIds && result.generatorIds[0];
      if (first && window.GWCanvas.selectNodeById) window.GWCanvas.selectNodeById(first);
      completeStep();
      return true;
    } catch (error) {
      setNotice(error && error.message || '创建生成节点失败');
      return false;
    }
  }

  function clickGenerateButton() {
    const button = findGenerateButton();
    if (!button) {
      setNotice('先打开生成节点的设置面板。');
      return false;
    }
    button.click();
    return true;
  }

  function ensureRoot() {
    const host = document.getElementById('canvas-wrap');
    if (!host || !hasProject()) return null;
    if (root && host.contains(root)) return root;
    root = document.createElement('div');
    root.id = 'gw-quickstart';
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = '<div class="qs-spot" aria-hidden="true"></div><section class="qs-card" role="dialog" aria-modal="false" aria-labelledby="qs-title"></section>';
    host.appendChild(root);
    spot = root.querySelector('.qs-spot');
    card = root.querySelector('.qs-card');
    root.addEventListener('pointerdown', event => event.stopPropagation());
    root.addEventListener('click', event => event.stopPropagation());
    return root;
  }

  function currentStep() {
    return steps[Math.max(0, Math.min(steps.length - 1, Number(state.step) || 0))];
  }

  function progressMarkup(index) {
    return steps.map((step, i) => {
      const stateClass = i < index ? 'done' : (i === index ? 'current' : '');
      return '<span class="' + stateClass + '" aria-label="' + (i < index ? '已完成' : (i === index ? '当前步骤' : '未开始')) + '"></span>';
    }).join('');
  }

  function renderCard(options = {}) {
    if (!ensureRoot()) return;
    const index = state.step;
    const step = currentStep();
    if (state.status === 'done') {
      card.innerHTML =
        '<button class="qs-close" type="button" data-qs="close" aria-label="关闭">×</button>' +
        '<div class="qs-complete-mark">✓</div>' +
        '<div class="qs-eyebrow">第一次出图完成</div>' +
        '<h3 id="qs-title">已经走通完整流程</h3>' +
        '<p>你已经完成“导入结构图 → 创建生成节点 → 生成结果”的流程。后续可以继续增加材质、光影、外景和多机位。</p>' +
        '<div class="qs-actions"><button type="button" class="qs-secondary" data-qs="pause">稍后再看</button><button type="button" class="qs-primary" data-qs="close">开始使用</button></div>';
      bindActions();
      positionCard();
      return;
    }
    card.innerHTML =
      '<button class="qs-close" type="button" data-qs="close" aria-label="关闭">×</button>' +
      '<div class="qs-progress">' + progressMarkup(index) + '<b>' + (index + 1) + '/' + steps.length + '</b></div>' +
      '<div class="qs-eyebrow">' + step.eyebrow + '</div>' +
      '<h3 id="qs-title">' + step.title + '</h3>' +
      '<p>' + step.body + '</p>' +
      '<div class="qs-hint">' + (options.notice || step.hint) + '</div>' +
      '<div class="qs-actions">' +
        (index > 0 ? '<button type="button" class="qs-link" data-qs="back">上一步</button>' : '<button type="button" class="qs-link" data-qs="pause">稍后</button>') +
        '<button type="button" class="qs-secondary" data-qs="pause">退出引导</button>' +
        '<button type="button" class="qs-primary" data-qs="primary">' + step.action + '</button>' +
      '</div>';
    bindActions();
    updateSpot();
    positionCard();
    startPolling(step);
  }

  function bindActions() {
    card.querySelectorAll('[data-qs]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.qs;
        if (action === 'close') finish();
        else if (action === 'pause') pause();
        else if (action === 'back') previous();
        else if (action === 'primary') primary();
      });
    });
  }

  function primary() {
    const step = currentStep();
    if (step.run && step.run() === false) return;
    if (step.complete) {
      if (step.complete()) completeStep();
      else if (step.id === 'import' || step.id === 'generate') setNotice(step.id === 'import' ? '导入完成后会自动继续。' : '生成开始后会自动继续。');
      else completeStep();
      return;
    }
    completeStep();
  }

  function previous() {
    if (state.step <= 0) return;
    saveState({ step: state.step - 1, status: 'active' });
    renderCard();
  }

  function completeStep() {
    if (advanceTimer) clearTimeout(advanceTimer);
    if (card) {
      card.classList.add('qs-step-complete');
      const hint = card.querySelector('.qs-hint');
      if (hint) hint.textContent = '这一步完成了，继续下一步。';
    }
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      const next = state.step + 1;
      if (next >= steps.length) {
        saveState({ status: 'done', step: steps.length });
        renderCard();
      } else {
        saveState({ status: 'active', step: next });
        renderCard();
      }
    }, 620);
  }

  function setNotice(text) {
    const hint = card && card.querySelector('.qs-hint');
    if (hint) {
      hint.textContent = text;
      hint.classList.add('warn');
      setTimeout(() => {
        if (!hint.isConnected) return;
        hint.classList.remove('warn');
        hint.textContent = currentStep().hint;
      }, 2600);
    }
  }

  function startPolling(step) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (!step.complete) return;
    pollTimer = setInterval(() => {
      if (state.status !== 'active') return;
      if (step.complete()) {
        clearInterval(pollTimer);
        pollTimer = null;
        completeStep();
      } else {
        updateSpot();
        positionCard();
      }
    }, 450);
  }

  function targetRect(step) {
    try {
      const target = step && step.target ? step.target() : null;
      if (!target) return null;
      if (target.left != null) return target;
      const rect = target.getBoundingClientRect();
      return rect.width && rect.height ? rect : null;
    } catch (error) {
      return null;
    }
  }

  function updateSpot() {
    if (!spot) return;
    const rect = targetRect(currentStep());
    if (!rect) {
      spot.style.display = 'none';
      return;
    }
    const inset = 5;
    spot.style.display = 'block';
    spot.style.left = Math.max(6, rect.left - inset) + 'px';
    spot.style.top = Math.max(50, rect.top - inset) + 'px';
    spot.style.width = Math.max(18, rect.width + inset * 2) + 'px';
    spot.style.height = Math.max(18, rect.height + inset * 2) + 'px';
  }

  function positionCard() {
    if (!card) return;
    const rect = targetRect(currentStep());
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const width = card.offsetWidth || 340;
    const height = card.offsetHeight || 220;
    let left = 24;
    let top = Math.max(78, viewportH - height - 52);
    if (rect) {
      if (rect.right + width + 28 < viewportW) {
        left = rect.right + 18;
        top = rect.top;
      } else if (rect.left - width - 28 > 0) {
        left = rect.left - width - 18;
        top = rect.top;
      } else {
        left = rect.left;
        top = rect.bottom + 16;
        if (top + height > viewportH - 36) top = rect.top - height - 16;
      }
    }
    card.style.left = Math.max(12, Math.min(viewportW - width - 12, left)) + 'px';
    card.style.top = Math.max(54, Math.min(viewportH - height - 36, top)) + 'px';
  }

  function show(status) {
    if (!hasProject()) return;
    state = Object.assign({}, state, { status: status || 'active' }, { version: VERSION, updatedAt: Date.now() });
    if (Math.max(0, Number(state.step) || 0) >= steps.length) state.step = steps.length - 1;
    saveState({});
    renderCard();
  }

  function pause() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    saveState({ status: 'paused' });
    if (root) root.remove();
    root = null;
    card = null;
    spot = null;
  }

  function finish() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    saveState({ status: 'done', step: steps.length });
    if (root) root.remove();
    root = null;
    card = null;
    spot = null;
  }

  function restart() {
    state = { version: VERSION, status: 'active', step: 0, updatedAt: Date.now() };
    saveState({});
    if (root) root.remove();
    root = null;
    card = null;
    spot = null;
    renderCard();
  }

  function maybeAutoShow() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (!hasProject()) return;
      if (state.status === 'active') {
        show('active');
        return;
      }
      if (state.status !== 'new') return;
      const snapshot = canvasState();
      const count = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0;
      if (count === 0) show('active');
    }, 900);
  }

  function bind() {
    const helpEntry = document.getElementById('um-quickstart');
    if (helpEntry) helpEntry.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const menu = document.getElementById('user-menu');
      if (menu) menu.classList.add('hidden');
      restart();
    });
    window.addEventListener('project-opened', maybeAutoShow);
    window.addEventListener('project-ready', maybeAutoShow);
    window.addEventListener('resize', () => {
      updateSpot();
      positionCard();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !root) return;
      pause();
    });
    maybeAutoShow();
  }

  window.GWQuickStart = {
    start: restart,
    resume: () => show('active'),
    pause,
    reset: () => {
      state = { version: VERSION, status: 'new', step: 0, updatedAt: Date.now() };
      saveState({});
      pause();
      maybeAutoShow();
    },
    getState: () => Object.assign({}, state)
  };

  bind();
})();
