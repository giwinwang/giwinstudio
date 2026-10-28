(function () {
  'use strict';

  const { ipcRenderer } = require('electron');
  const $ = id => document.getElementById(id);
  const MAX_ATTACHMENTS = 24;
  const VISION_ATTACHMENT_EDGE = 640;
  const VISION_ATTACHMENT_QUALITY = 0.84;
  const VISION_LOAD_CONCURRENCY = 2;
  const HISTORY_KEY = 'gw_copilot_conversations_v1';
  const COPILOT_MODE_LABELS = { chat: '只聊不改', confirm: '规划并确认', auto: '自动规划执行' };

  // 执行权限下拉（原 select 已换成统一样式的自定义菜单，select 保留为隐藏数据源）
  function syncCopilotModeLabel() {
    const select = $('copilot-mode');
    const label = $('copilot-mode-label');
    const menu = $('copilot-mode-menu');
    if (!select || !label || !menu) return;
    label.textContent = COPILOT_MODE_LABELS[select.value] || select.value;
    menu.querySelectorAll('.gw-model-option').forEach(opt => {
      const on = opt.dataset.mode === select.value;
      opt.classList.toggle('on', on);
      opt.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  function setCopilotMode(value) {
    const select = $('copilot-mode');
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    syncCopilotModeLabel();
  }

  let panelOpen = false;
  let contextLocked = false;
  let busy = false;
  let attachments = [];
  let lastSelectionIds = [];
  let lastRawSelectionIds = [];
  let activePlan = null;
  let conversation = newConversation();
  let historyPop = null;

  function newConversation() {
    return {
      id: 'conv-' + Date.now().toString(36),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      title: '新对话',
      projectPath: currentProjectPath(),
      messages: []
    };
  }

  function currentProjectPath() {
    try {
      return currentProject && currentProject.path || '';
    } catch (error) {
      return '';
    }
  }

  function projectName() {
    try {
      return currentProject && currentProject.name || '未打开项目';
    } catch (error) {
      return '未打开项目';
    }
  }

  function toast(message, isError) {
    if (window.GWCanvas && GWCanvas.toast) GWCanvas.toast(message, !!isError);
  }

  function nodeInfo(id) {
    const node = window.GWCanvas && GWCanvas.getNodeById(id);
    if (!node) return null;
    const className = node.getClassName && node.getClassName();
    const isVariant = node.gwType === 'variant';
    const isImage = className === 'Image' || node.gwType === 'image';
    if (!isVariant && !isImage) return null;
    const resultIndex = isVariant ? Math.max(0, Number(node.gwCur) || 0) : 0;
    const src = isVariant
      ? (node.gwResults && node.gwResults[resultIndex])
      : node.gwSrc;
    return {
      id,
      label: node.gwStyleName || node.gwLabel || (isVariant ? '生成结果' : '画布图片'),
      room: node.gwRoom || '',
      kind: isVariant ? 'variant' : 'image',
      resultIndex,
      src: src || ''
    };
  }

  async function addAttachmentIds(ids, options = {}) {
    if (contextLocked && !options.force) return;
    const seen = new Set(attachments.map(item => item.id));
    const nextIds = Array.from(new Set((ids || []).filter(Boolean))).filter(id => !seen.has(id));
    if (!nextIds.length) return;
    const room = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (room <= 0) {
      toast('一次对话最多保留 ' + MAX_ATTACHMENTS + ' 张图片上下文', true);
      return;
    }
    const accepted = nextIds.slice(0, room);
    accepted.forEach(id => {
      const info = nodeInfo(id);
      if (!info) return;
      attachments.push(Object.assign(info, {
        attachedAt: Date.now(),
        thumbnail: ''
      }));
    });
    if (nextIds.length > accepted.length) {
      toast('已加入前 ' + accepted.length + ' 张，超出上下文上限的图片未添加', true);
    }
    renderAttachments();
    await Promise.all(accepted.map(async id => {
      const attachment = attachments.find(item => item.id === id);
      if (!attachment || attachment.thumbnail) return;
      try {
        const dataURL = await GWCanvas.getMediaOutputDataURL(attachment.id, { maxEdge: 180, quality: 0.82 });
        const current = attachments.find(item => item.id === attachment.id);
        if (!current || !dataURL) return;
        current.thumbnail = dataURL;
        updateAttachmentThumb(current.id, dataURL);
      } catch (error) {}
    }));
  }

  function updateAttachmentThumb(id, dataURL) {
    const target = $('copilot-attachments').querySelector('[data-attachment-id="' + CSS.escape(id) + '"] .thumb');
    if (target) {
      target.innerHTML = '';
      const img = document.createElement('img');
      img.src = dataURL;
      img.alt = '';
      img.draggable = false;
      target.appendChild(img);
    }
  }

  function removeAttachment(id) {
    attachments = attachments.filter(item => item.id !== id);
    renderAttachments();
    if (!attachments.length) setContextLocked(false);
  }

  function renderAttachments() {
    const box = $('copilot-attachments');
    box.innerHTML = '';
    attachments.forEach((attachment, index) => {
      const chip = document.createElement('div');
      chip.className = 'copilot-attachment';
      chip.dataset.attachmentId = attachment.id;
      chip.title = [attachment.label, attachment.room, '机位/结果 ' + (attachment.resultIndex + 1)].filter(Boolean).join(' · ');
      chip.innerHTML = '<div class="thumb" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:10.5px">图</div>' +
        '<span>' + String(index + 1).padStart(2, '0') + '</span>' +
        '<button class="remove" type="button" title="移除">×</button>';
      if (attachment.thumbnail) updateAttachmentThumb(attachment.id, attachment.thumbnail);
      chip.addEventListener('click', event => {
        if (event.target.closest('.remove')) return;
        GWCanvas.focusNodeById(attachment.id);
      });
      chip.querySelector('.remove').addEventListener('click', event => {
        event.stopPropagation();
        removeAttachment(attachment.id);
      });
      box.appendChild(chip);
    });
    updateContextState();
  }

  function setContextLocked(value) {
    contextLocked = !!value && attachments.length > 0;
    updateContextState();
  }

  function updateContextState() {
    const button = $('copilot-context-state');
    if (contextLocked) {
      button.textContent = '已锁定 ' + attachments.length + ' 张';
      button.classList.add('locked');
      button.title = '当前图片和顺序已锁定 · 点击解除';
    } else {
      button.textContent = attachments.length ? '跟随选择 · ' + attachments.length + ' 张' : '上下文未锁定';
      button.classList.remove('locked');
      button.title = '打开面板时，画布选图会自动加入上下文';
    }
  }

  function selectedMediaIds() {
    const ids = GWCanvas.getSelectionIds ? GWCanvas.getSelectionIds() : [];
    return ids.filter(id => !!nodeInfo(id));
  }

  function handleSelectionChanged(ids) {
    lastRawSelectionIds = (ids || []).slice();
    lastSelectionIds = (ids || []).filter(id => !!nodeInfo(id));
    if (!panelOpen || contextLocked) return;
    addAttachmentIds(ids || []);
  }

  function updateModelLabel() {
    const config = GWCanvas.getVisionConfig ? GWCanvas.getVisionConfig() : null;
    $('copilot-model').textContent = config ? config.label : '未配置对话模型';
    $('copilot-model').title = config ? config.label : '请先在设置 → 引擎配置阿波罗、OpenAI 或 DeepSeek';
  }

  function resizeInput() {
    const input = $('copilot-input');
    input.style.height = 'auto';
    input.style.height = Math.min(132, Math.max(46, input.scrollHeight)) + 'px';
  }

  function openPanel() {
    if (!window.GWProjectState || !window.GWProjectState.hasProject()) {
      toast('请先新建或打开项目');
      return;
    }
    const lockReason = $('copilot-launch').dataset.gwLocked || '';
    if (lockReason) {
      toast(lockReason === 'release'
        ? '粒子魔方为专业版 / 团队版功能，当前授权未包含'
        : '开发权限模拟：切换到「团队全部功能」后可测试粒子魔方');
      return;
    }
    panelOpen = true;
    if (window.GWCopilotMotion) window.GWCopilotMotion.setOpen(true);
    $('copilot-panel').classList.add('open');
    $('copilot-panel').setAttribute('aria-hidden', 'false');
    $('copilot-launch').style.opacity = '0';
    $('copilot-launch').style.pointerEvents = 'none';
    $('copilot-launch').setAttribute('aria-expanded', 'true');
    $('copilot-project-label').textContent = projectName();
    updateModelLabel();
    lastRawSelectionIds = GWCanvas.getSelectionIds ? GWCanvas.getSelectionIds() : [];
    lastSelectionIds = selectedMediaIds();
    if (!attachments.length) addAttachmentIds(selectedMediaIds());
    setTimeout(() => $('copilot-input').focus(), 120);
  }

  function closePanel() {
    panelOpen = false;
    if (window.GWCopilotMotion) window.GWCopilotMotion.setOpen(false);
    $('copilot-panel').classList.remove('open');
    $('copilot-panel').setAttribute('aria-hidden', 'true');
    $('copilot-launch').style.opacity = '';
    $('copilot-launch').style.pointerEvents = '';
    $('copilot-launch').setAttribute('aria-expanded', 'false');
    hideAddMenu();
    hideHistory();
  }

  function togglePanel() {
    if (panelOpen) closePanel(); else openPanel();
  }

  function setupResize() {
    const handle = $('copilot-resize');
    const panel = $('copilot-panel');
    const savedWidth = Number(localStorage.getItem('gw_copilot_panel_width')) || 0;
    if (savedWidth >= 340 && savedWidth <= 520) panel.style.width = savedWidth + 'px';
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      panel.classList.add('resizing');
      handle.setPointerCapture(event.pointerId);
      const move = next => {
        const width = Math.max(340, Math.min(520, window.innerWidth - next.clientX - 16));
        panel.style.width = width + 'px';
      };
      const end = next => {
        panel.classList.remove('resizing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        const width = Math.round(panel.getBoundingClientRect().width);
        localStorage.setItem('gw_copilot_panel_width', String(width));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }

  function scrollThread() {
    const thread = $('copilot-thread');
    thread.scrollTop = thread.scrollHeight;
  }

  function appendMessage(role, text, options = {}) {
    if (!text) return null;
    const wrap = document.createElement('div');
    wrap.className = 'copilot-msg ' + role;
    const label = document.createElement('div');
    label.className = 'copilot-msg-label';
    label.textContent = role === 'user' ? '你' : '粒子魔方';
    const bubble = document.createElement('div');
    bubble.className = 'copilot-bubble';
    bubble.textContent = text;
    wrap.append(label, bubble);
    $('copilot-thread').appendChild(wrap);
    $('copilot-welcome').style.display = 'none';
    if (!options.transient) {
      conversation.messages.push({ role, text, at: Date.now() });
      conversation.updatedAt = Date.now();
      if (role === 'user' && conversation.title === '新对话') {
        conversation.title = text.replace(/\s+/g, ' ').slice(0, 28);
      }
      saveConversation();
    }
    scrollThread();
    return wrap;
  }

  function appendProgressMessage(text) {
    const wrap = appendMessage('assistant', text, { transient: true });
    if (wrap) {
      wrap.dataset.progress = 'true';
      wrap.querySelector('.copilot-bubble').classList.add('copilot-running');
    }
    return wrap;
  }

  function imageTargetForSize(size) {
    const P = window.GWProviders;
    if (!P) return null;
    const recipe = GWCanvas.getRecipeSnapshot ? GWCanvas.getRecipeSnapshot() : {};
    const configs = P.loadConfigs ? P.loadConfigs() : {};
    const engines = Object.keys(P.PROVIDERS || {}).filter(id =>
      P.PROVIDERS[id] && P.PROVIDERS[id].image !== false && configs[id] && configs[id].apiKey
    );
    const ordered = Array.from(new Set([recipe.engineId, ...engines].filter(Boolean)));
    let fallback = null;
    for (const engineId of ordered) {
      const config = configs[engineId] || {};
      if (!config.apiKey) continue;
      const provider = P.PROVIDERS[engineId] || {};
      const model = config.model || provider.model || '';
      if (!model) continue;
      let sizes = [];
      try { sizes = P.getSizes ? P.getSizes(engineId, model) : []; } catch (error) {}
      const supports = !size || size === 'auto' || !sizes.length || sizes.includes(size);
      const candidate = {
        engineId,
        model,
        label: (P.aliasOf ? P.aliasOf(model) : model) + ' · ' + (provider.label || engineId),
        supports,
        declaredSizes: sizes
      };
      if (supports) return candidate;
      if (!fallback) fallback = candidate;
    }
    return fallback;
  }

  function parseImageCount(text) {
    const match = String(text || '').match(/(?:这|当前|选中的?)?\s*([1-9]\d*|[一二两三四五六七八九十])\s*张/i);
    if (!match) return 0;
    if (/^\d+$/.test(match[1])) return Number(match[1]);
    return ({ '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 })[match[1]] || 0;
  }

  function resolveContextSources(text) {
    if (!attachments.length) {
      return { error: '没有图片上下文', text: '当前没有锁定图片。请先在画布选中图片，或从附件菜单添加。' };
    }
    const requestedCount = parseImageCount(text);
    let sourceIds = attachments.map(item => item.id);
    if (requestedCount && requestedCount !== sourceIds.length) {
      const selected = lastSelectionIds.filter(id => attachments.some(item => item.id === id));
      if (selected.length === requestedCount) {
        sourceIds = selected;
      } else {
        return {
          error: '图片数量不明确',
          text: '当前附件中有 ' + sourceIds.length + ' 张图片，但你提到的是 ' + requestedCount + ' 张。请重新在画布选中需要的 ' + requestedCount + ' 张，或调整附件区后再发送。'
        };
      }
    }
    const sourceRefs = sourceIds.map(id => {
      const item = attachments.find(entry => entry.id === id);
      return { id, resultIndex: item.resultIndex, src: item.src };
    });
    return { sourceIds, sourceRefs };
  }

  function planId() {
    return 'plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
  }

  function renderIntent(text, resolved) {
    const recipe = GWCanvas.getRecipeSnapshot ? GWCanvas.getRecipeSnapshot() : {};
    const sizeMatch = String(text).match(/(?:4|四)\s*k/i) ? '4K' : (String(text).match(/(?:2|两)\s*k/i) ? '2K' : (/高清/.test(text) ? '2K' : (recipe.size || 'auto')));
    const target = imageTargetForSize(sizeMatch);
    const { sourceIds, sourceRefs } = resolved;
    const batches = Math.ceil(sourceIds.length / 4);
    const params = Object.assign({}, recipe, {
      size: sizeMatch,
      aspect: 'auto',
      batch: 1,
      concurrency: Math.min(4, Math.max(1, Number(recipe.concurrency) || 4))
    });
    if (target) {
      params.engineId = target.engineId;
      params.model = target.model;
    }
    return {
      id: planId(),
      kind: 'render',
      title: '多机位一致性渲染',
      text: String(text || '').trim(),
      sourceIds,
      sourceRefs,
      sourceCount: sourceIds.length,
      batches,
      size: sizeMatch,
      preserve: true,
      params,
      target,
      missingConfig: !target,
      warnings: target && target.supports === false ? ['当前模型未声明支持 ' + sizeMatch + '，执行后仍需校验实际尺寸。'] : [],
      details: [
        ['上下文图片', sourceIds.length + ' 张'],
        ['生成批次', batches + ' 组（每组最多4机位）'],
        ['清晰度', sizeMatch],
        ['结构保持', '开启'],
        ['模型', target ? target.label : '未配置生图模型']
      ]
    };
  }

  function softIntent(text, resolved) {
    const target = GWCanvas.getVisionConfig ? GWCanvas.getVisionConfig() : null;
    const batches = Math.ceil(resolved.sourceIds.length / 8);
    return {
      id: planId(),
      kind: 'soft',
      title: '软装提取与选品',
      text,
      sourceIds: resolved.sourceIds,
      sourceRefs: resolved.sourceRefs,
      sourceCount: resolved.sourceIds.length,
      batches,
      target,
      missingConfig: !target,
      withLayout: /排版|方案册|方案书|pdf|网页/i.test(text),
      details: [
        ['上下文图片', resolved.sourceIds.length + ' 张'],
        ['软装批次', batches + ' 组（每组最多8张）'],
        ['识别模型', target ? target.label : '未配置视觉模型'],
        ['执行关卡', '提取后等待人工确认'],
        ['后续', /排版|方案册|方案书|pdf|网页/i.test(text) ? '创建方案排版节点' : '停留在选品复核']
      ]
    };
  }

  function upscaleIntent(text, resolved) {
    const config = GWProviders.loadConfigs().runninghub || {};
    const resolution = /(4\s*倍|4\s*k|四倍)/i.test(text) ? '4k' : '2k';
    return {
      id: planId(),
      kind: 'upscale',
      title: '高清放大',
      text,
      sourceIds: resolved.sourceIds,
      sourceRefs: resolved.sourceRefs,
      sourceCount: resolved.sourceIds.length,
      resolution,
      missingConfig: !config.apiKey,
      details: [
        ['上下文图片', resolved.sourceIds.length + ' 张'],
        ['放大档位', resolution === '4k' ? '4× · 短边4096' : '2× · 短边2048'],
        ['处理方式', '线上 RunningHub'],
        ['账号状态', config.apiKey ? '已配置' : '未配置 API Key']
      ]
    };
  }

  function layoutIntent(text, resolved) {
    const target = GWCanvas.getVisionConfig ? GWCanvas.getVisionConfig() : null;
    const selectedLayout = lastRawSelectionIds.find(id => {
      const descriptor = GWCanvas.workflowNodeDescriptor(id);
      return descriptor && descriptor.type === 'layout';
    });
    const selectedSofts = lastRawSelectionIds.filter(id => {
      const descriptor = GWCanvas.workflowNodeDescriptor(id);
      return descriptor && descriptor.type === 'soft';
    });
    const selectedLayoutNode = selectedLayout ? GWCanvas.getNodeById(selectedLayout) : null;
    const internalImages = selectedLayoutNode && selectedLayoutNode.gwLayout && Array.isArray(selectedLayoutNode.gwLayout.items)
      ? selectedLayoutNode.gwLayout.items.length
      : 0;
    const imageCount = Math.max(internalImages, resolved ? resolved.sourceIds.length : 0);
    const hasImages = imageCount > 0;
    return {
      id: planId(),
      kind: 'layout',
      title: '客户方案排版',
      text,
      sourceIds: resolved ? resolved.sourceIds : [],
      sourceRefs: resolved ? resolved.sourceRefs : [],
      sourceCount: imageCount,
      hasInternalImages: !!internalImages,
      softIds: selectedSofts,
      target,
      missingConfig: hasImages && !target,
      details: [
        ['效果图', imageCount + ' 张'],
        ['软装节点', selectedSofts.length ? selectedSofts.length + ' 个' : '未选择'],
        ['文案模型', hasImages ? (target ? target.label : '未配置视觉模型') : '软装页面无需图片文案模型'],
        ['输出', '页面与设计文案'],
        ['导出', '运行后可手动导出网页或PDF']
      ]
    };
  }

  function workflowIntent(text) {
    const ids = lastRawSelectionIds.slice();
    const descriptors = ids.map(id => GWCanvas.workflowNodeDescriptor(id)).filter(Boolean);
    if (!descriptors.length) {
      return { error: '没有运行对象', text: '请先在画布中选中需要运行的工作流节点。' };
    }
    const manual = descriptors.filter(item => item.executionMode === 'manual');
    const executable = descriptors.filter(item => ['auto', 'data'].includes(item.executionMode));
    if (!executable.some(item => item.executionMode === 'auto')) {
      return { error: '没有可执行节点', text: '当前选择只包含输入数据或人工操作节点，没有可自动执行的处理节点。' };
    }
    return {
      id: planId(),
      kind: 'workflow',
      title: '运行选中的工作流',
      text,
      nodeIds: ids,
      missingConfig: false,
      details: [
        ['选中节点', descriptors.length + ' 个'],
        ['自动节点', executable.filter(item => item.executionMode === 'auto').length + ' 个'],
        ['数据节点', executable.filter(item => item.executionMode === 'data').length + ' 个'],
        ['人工关卡', manual.length ? manual.length + ' 个' : '无'],
        ['执行方式', manual.length ? '运行到人工节点后暂停' : '按依赖顺序自动运行']
      ]
    };
  }

  function detectPlan(text) {
    const value = String(text || '');
    if (/(运行|继续|执行)/.test(value) && /(群组|工作流|选中的?|当前)/.test(value)) {
      return workflowIntent(value);
    }
    if (/(标记|局部重绘|圈选|框选)/.test(value)) {
      return {
        error: '需要人工操作',
        text: '标记和局部重绘需要先指定区域，不能在未提供标记的情况下自动完成。请使用标记节点完成区域后再让我继续运行。'
      };
    }
    const resolved = resolveContextSources(value);
    if (/(排版|方案册|方案书|pdf|网页)/i.test(value) && !/(提取|识别)/.test(value)) {
      return resolved.error ? layoutIntent(value, null) : layoutIntent(value, resolved);
    }
    if (/(软装|选品)/.test(value)) return resolved.error ? resolved : softIntent(value, resolved);
    if (/(高清|放大)/.test(value) && !/(渲|效果图)/.test(value)) return resolved.error ? resolved : upscaleIntent(value, resolved);
    if (/(排版|方案册|方案书|pdf|网页)/i.test(value)) return resolved.error ? layoutIntent(value, null) : layoutIntent(value, resolved);
    if (/(渲|效果图|生成.*图|4\s*k|高清出图|出图)/i.test(value)) return resolved.error ? resolved : renderIntent(value, resolved);
    if (/(运行|继续|执行)/.test(value)) return workflowIntent(value);
    return null;
  }

  function appendPlan(plan, options = {}) {
    activePlan = plan;
    const wrap = document.createElement('div');
    wrap.className = 'copilot-msg assistant';
    const canCreate = ['render', 'soft', 'layout'].includes(plan.kind);
    const details = (plan.details || []).map(row =>
      '<span>' + escapeHtml(row[0]) + '</span><b>' + escapeHtml(row[1]) + '</b>'
    ).join('');
    wrap.innerHTML = '<div class="copilot-msg-label">粒子魔方</div>' +
      '<div class="copilot-plan">' +
        '<div class="copilot-plan-head"><div class="copilot-plan-icon">⚡</div><div class="copilot-plan-title">' + plan.title +
          '<div class="copilot-plan-sub">计划已生成，执行前可检查图片与批次</div></div></div>' +
        '<div class="copilot-plan-list">' + details + '</div>' +
        '<div class="copilot-plan-status" style="min-height:15px;margin:0 0 8px;color:var(--faint);font-size:10.5px;line-height:1.5">' +
          (plan.missingConfig ? '当前缺少所需 API 配置，先检查节点或完成引擎设置。' : ((plan.warnings && plan.warnings[0]) || '确认后将按画布依赖关系运行。')) +
        '</div>' +
        '<div class="copilot-plan-actions">' +
          '<button data-plan-action="cancel" class="danger" style="display:none">停止</button>' +
          '<button data-plan-action="chat">只聊不改</button>' +
          (canCreate ? '<button data-plan-action="create">放到画布</button>' : '') +
          '<button data-plan-action="run" class="primary"' + (plan.missingConfig ? ' disabled' : '') + '>确认运行</button>' +
        '</div>' +
      '</div>';
    $('copilot-thread').appendChild(wrap);
    $('copilot-welcome').style.display = 'none';
    plan.dom = wrap;
    setContextLocked(true);
    conversation.messages.push({
      role: 'assistant',
      text: '[执行计划] ' + plan.title + ' · ' + (plan.details || []).map(row => row[0] + '：' + row[1]).join(' · '),
      at: Date.now()
    });
    conversation.updatedAt = Date.now();
    saveConversation();
    wrap.querySelectorAll('[data-plan-action]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.planAction;
        if (action === 'chat') {
          setCopilotMode('chat');
          setPlanStatus(plan, '当前为只聊不改模式，尚未修改画布。');
          return;
        }
        if (action === 'cancel') {
          cancelPlan(plan);
          return;
        }
        if (action === 'create') materializePlan(plan).catch(error => setPlanStatus(plan, error.message, true));
        if (action === 'run') executePlan(plan).catch(error => setPlanStatus(plan, error.message, true));
      });
    });
    scrollThread();
    if (options.autoRun) executePlan(plan).catch(error => setPlanStatus(plan, error.message, true));
    return wrap;
  }

  function setPlanStatus(plan, text, isError) {
    const status = plan && plan.dom && plan.dom.querySelector('.copilot-plan-status');
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? 'var(--danger)' : 'var(--faint)';
  }

  function updatePlanButtons(plan, state) {
    if (!plan || !plan.dom) return;
    const create = plan.dom.querySelector('[data-plan-action="create"]');
    const run = plan.dom.querySelector('[data-plan-action="run"]');
    const chat = plan.dom.querySelector('[data-plan-action="chat"]');
    const cancel = plan.dom.querySelector('[data-plan-action="cancel"]');
    if (create) {
      create.textContent = plan.materialized ? '已放到画布' : '放到画布';
      create.disabled = state !== 'ready' || !!plan.materialized;
    }
    if (run) run.disabled = state !== 'ready' || plan.missingConfig;
    if (chat) chat.disabled = state !== 'ready';
    if (cancel) cancel.style.display = state === 'running' ? '' : 'none';
  }

  function cancelPlan(plan) {
    if (!plan) return;
    plan.cancelRequested = true;
    const ids = Array.from(new Set([
      ...(plan.generatorIds || []),
      ...(plan.softIds || []),
      ...(plan.nodeIds || []),
      plan.layoutId
    ].filter(Boolean)));
    ids.forEach(id => GWCanvas.cancelGeneratorById(id));
    setPlanStatus(plan, '正在取消当前群组任务…');
  }

  async function materializePlan(plan) {
    if (busy) throw new Error('当前已有任务正在运行');
    if (!['render', 'soft', 'layout'].includes(plan.kind)) return null;
    if (plan.materialized) {
      if (plan.kind === 'render') return plan.generatorIds;
      if (plan.kind === 'soft') return plan.softIds;
      return plan.layoutId;
    }
    if (plan.sourceRefs && plan.sourceRefs.length) {
      const changed = plan.sourceRefs.find(reference => {
        const current = nodeInfo(reference.id);
        if (!current) return true;
        return current.resultIndex !== reference.resultIndex || (reference.src && current.src && current.src !== reference.src);
      });
      if (changed) throw new Error('上下文中的图片版本已变化，请解锁后重新选择图片并生成计划');
    }
    busy = true;
    updateSendState();
    try {
      if (plan.kind === 'render') {
        if (!plan.sourceIds.length) throw new Error('计划中没有图片');
        setPlanStatus(plan, '正在画布创建 ' + plan.batches + ' 个生成批次…');
        const result = GWCanvas.createRenderWorkflowFromIds(plan.sourceIds, plan.params, {
          planId: plan.id,
          groupId: plan.id,
          positions: null
        });
        plan.generatorIds = result.generatorIds;
        setPlanStatus(plan, '已在画布创建 ' + result.batchCount + ' 个生成节点，等待确认运行。');
        if (plan.generatorIds[0]) GWCanvas.selectNodeById(plan.generatorIds[0]);
      } else if (plan.kind === 'soft') {
        setPlanStatus(plan, '正在创建软装提取工作流…');
        const result = GWCanvas.createSoftWorkflowFromIds(plan.sourceIds, { planId: plan.id });
        plan.softIds = result.softIds;
        if (plan.withLayout) {
          const layout = GWCanvas.createLayoutWorkflowFromIds(plan.sourceIds, plan.softIds, { planId: plan.id });
          plan.layoutId = layout.layoutId;
        }
        setPlanStatus(plan, '已创建 ' + plan.softIds.length + ' 个软装提取节点' + (plan.layoutId ? '和方案排版节点' : '') + '。');
      } else if (plan.kind === 'layout') {
        const selectedLayout = lastRawSelectionIds.find(id => {
          const descriptor = GWCanvas.workflowNodeDescriptor(id);
          return descriptor && descriptor.type === 'layout';
        });
        if (selectedLayout && !plan.sourceIds.length) {
          plan.layoutId = selectedLayout;
          setPlanStatus(plan, '将使用画布中已选中的方案排版节点。');
        } else {
          setPlanStatus(plan, '正在创建方案排版节点…');
          const layout = GWCanvas.createLayoutWorkflowFromIds(plan.sourceIds, plan.softIds || [], { planId: plan.id });
          plan.layoutId = layout.layoutId;
          setPlanStatus(plan, '已在画布创建方案排版节点。');
        }
      }
      plan.materialized = true;
      updatePlanButtons(plan, 'ready');
      return plan.kind === 'render' ? plan.generatorIds : (plan.kind === 'soft' ? plan.softIds : plan.layoutId);
    } catch (error) {
      setPlanStatus(plan, '创建工作流失败：' + error.message, true);
      throw error;
    } finally {
      busy = false;
      updateSendState();
    }
  }

  async function executePlan(plan) {
    if (busy) return;
    if (plan.missingConfig) throw new Error('请先在设置中完成该任务所需的 API 配置');
    plan.cancelRequested = false;
    await materializePlan(plan);
    busy = true;
    updateSendState();
    updatePlanButtons(plan, 'running');
    const results = [];
    try {
      if (plan.kind === 'render') {
        setPlanStatus(plan, '群组运行中 · 0/' + plan.generatorIds.length + ' 个批次');
        for (let index = 0; index < plan.generatorIds.length; index++) {
          if (plan.cancelRequested) break;
          const id = plan.generatorIds[index];
          const status = document.createElement('span');
          status.textContent = '批次 ' + (index + 1) + ' 准备中';
          const statusBox = plan.dom && plan.dom.querySelector('.copilot-plan-status');
          if (statusBox) {
            statusBox.textContent = '';
            statusBox.style.color = 'var(--faint)';
            statusBox.appendChild(status);
          }
          const result = await GWCanvas.runGeneratorById(id, status);
          results.push(result);
          status.textContent = result.ok
            ? '批次 ' + (index + 1) + '/' + plan.generatorIds.length + ' 完成 · 生成 ' + result.created + ' 张'
            : '批次 ' + (index + 1) + ' 未生成结果';
        }
        const created = results.reduce((sum, result) => sum + (result.created || 0), 0);
        const failedBatches = results.filter(result => !result.ok).length;
        const cancelled = plan.cancelRequested || results.some(result => result.cancelled);
        setPlanStatus(plan, cancelled
          ? '任务已取消 · 已保留完成的 ' + created + ' 张结果'
          : (failedBatches ? '运行结束 · 成功 ' + created + ' 张 · ' + failedBatches + ' 个批次失败' : '运行完成 · 已生成 ' + created + ' 张结果'), failedBatches > 0 && !cancelled);
        appendMessage('assistant', cancelled
          ? '群组任务已取消。取消前完成的 ' + created + ' 张结果仍保留在画布中。'
          : (failedBatches
            ? '群组运行结束：生成 ' + created + ' 张，有 ' + failedBatches + ' 个批次失败。失败结果仍保留在画布中，可单独检查并重试。'
            : '群组运行完成：已生成 ' + created + ' 张结果，并自动连接到生成节点。'));
        if (results[0] && results[0].resultIds && results[0].resultIds[0]) GWCanvas.selectNodeById(results[0].resultIds[0]);
      } else if (plan.kind === 'upscale') {
        setPlanStatus(plan, '正在执行高清放大…');
        const result = await GWCanvas.runUpscaleByIds(plan.sourceIds, plan.resolution, text => setPlanStatus(plan, text), {
          shouldStop: () => plan.cancelRequested
        });
        if (plan.cancelRequested) setPlanStatus(plan, '高清放大已取消 · 已保留完成的 ' + result.made + ' 张');
        else setPlanStatus(plan, result.failed ? '高清放大完成 · 成功 ' + result.made + ' 张 · 失败 ' + result.failed + ' 张' : '高清放大完成 · ' + result.made + ' 张', result.failed > 0);
        appendMessage('assistant', plan.cancelRequested
          ? '高清放大已取消，取消前完成的 ' + result.made + ' 张结果仍保留在画布中。'
          : '高清放大结束：成功 ' + result.made + ' 张' + (result.failed ? '，失败 ' + result.failed + ' 张' : '') + '。');
      } else {
        const ids = plan.kind === 'soft'
          ? [...(plan.softIds || []), plan.layoutId].filter(Boolean)
          : (plan.kind === 'layout' ? [plan.layoutId].filter(Boolean) : plan.nodeIds);
        setPlanStatus(plan, '通用群组运行中 · 0/' + ids.length + ' 个节点');
        const outcome = await GWCanvas.runWorkflowByIds(ids, {
          shouldStop: () => plan.cancelRequested,
          onProgress: event => {
            const result = event.result || {};
            setPlanStatus(plan, '节点 ' + (event.index + 1) + '/' + event.total + ' · ' + (event.node.label || event.node.type) + ' · ' + (result.message || result.status));
          }
        });
        const summary = outcome.summary || {};
        if (outcome.cancelled) setPlanStatus(plan, '群组任务已取消 · 已完成 ' + (summary.success || 0) + ' 个节点');
        else if (summary.waiting) setPlanStatus(plan, '运行已暂停 · ' + summary.waiting + ' 个节点等待人工确认');
        else if (summary.failed) setPlanStatus(plan, '运行结束 · 成功 ' + (summary.success || 0) + ' · 失败 ' + summary.failed + ' · 跳过 ' + (summary.skipped || 0), true);
        else if (plan.kind === 'layout') setPlanStatus(plan, '方案文案与页面已生成');
        else setPlanStatus(plan, '群组运行完成 · 成功 ' + (summary.success || 0) + ' 个节点');
        appendMessage('assistant', summary.waiting
          ? '工作流已运行到人工确认节点。请在画布中完成确认后再让我继续运行。'
          : (summary.failed
            ? '工作流运行结束：成功 ' + (summary.success || 0) + ' 个节点，失败 ' + summary.failed + ' 个，跳过 ' + (summary.skipped || 0) + ' 个。'
            : '工作流运行完成。'));
        if (summary.waiting) {
          const waiting = Object.values(outcome.results || {}).find(result => result.status === 'waiting');
          if (waiting && waiting.nodeId) GWCanvas.selectNodeById(waiting.nodeId);
          if (plan.softIds && plan.softIds[0]) GWCanvas.openSoftEditorById(plan.softIds[0]);
        }
      }
      updatePlanButtons(plan, 'done');
    } catch (error) {
      setPlanStatus(plan, '群组运行失败：' + error.message, true);
      appendMessage('assistant', '群组运行未能完成：' + error.message);
      updatePlanButtons(plan, 'ready');
    } finally {
      busy = false;
      updateSendState();
    }
  }

  function fallbackReply(text) {
    if (/整理|排版/.test(text)) return '我可以整理当前画布，但这一能力将在后续阶段接入。现在可先使用快捷键 F，或在画布中选中节点后使用自动整理。';
    if (/检查|完整/.test(text)) return '请先选中需要检查的工作流节点。当前可以运行多机位渲染、软装提取、高清放大、方案排版和已选节点群组，并会在人工确认节点前暂停。';
    if (/节点|解释/.test(text)) return attachments.length
      ? '当前上下文包含 ' + attachments.length + ' 张图片：' + attachments.map((item, index) => String(index + 1).padStart(2, '0') + ' ' + item.label).join('、') + '。'
      : '当前没有锁定图片。请在画布选中图片，或从“＋”菜单添加。';
    return '我已记录你的要求。当前可以把选中图片规划为多机位渲染、软装提取、高清放大或方案排版工作流，也可以直接运行已选中的节点群组。';
  }

  async function loadVisionAttachments(onProgress) {
    if (!attachments.length || !GWCanvas.getChatPreviewDataURL) return [];
    const snapshot = attachments.slice();
    const results = new Array(snapshot.length);
    let next = 0;
    let completed = 0;
    const total = snapshot.length;
    const worker = async () => {
      while (next < total) {
        const index = next++;
        const attachment = snapshot[index];
        try {
          const dataURL = await GWCanvas.getChatPreviewDataURL(attachment.id, {
            resultIndex: attachment.resultIndex,
            maxEdge: VISION_ATTACHMENT_EDGE,
            quality: VISION_ATTACHMENT_QUALITY
          });
          if (/^data:image\//i.test(dataURL)) {
            results[index] = { attachment, dataURL, index };
          }
        } catch (error) {
          results[index] = { attachment, dataURL: '', index, error: error.message || String(error) };
        }
        completed++;
        if (typeof onProgress === 'function') {
          onProgress('正在读取画布图片 · ' + completed + '/' + total);
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(VISION_LOAD_CONCURRENCY, total) },
      worker
    ));
    return results.filter(Boolean);
  }

  async function chatReply(text, onProgress) {
    const config = GWCanvas.getVisionConfig ? GWCanvas.getVisionConfig() : null;
    if (!config || !window.GWProviders) return fallbackReply(text);
    const visionAttachments = await loadVisionAttachments(onProgress);
    const context = attachments.length
      ? '当前已锁定图片（编号与后续图片顺序一致）：\n' + attachments.map((item, index) =>
          String(index + 1).padStart(2, '0') + '. ' + item.label + (item.room ? ' · ' + item.room : '') + ' · 结果版本 ' + (item.resultIndex + 1)
        ).join('\n')
      : '当前没有锁定图片。';
    const recent = conversation.messages.slice(-10).map(message => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.text
    }));
    const userParts = [{
      type: 'text',
      text: context + '\n\n用户要求：' + text
    }];
    visionAttachments.filter(item => item.dataURL).forEach(item => {
      userParts.push({
        type: 'text',
        text: '附件 ' + String(item.index + 1).padStart(2, '0') + '：' + item.attachment.label
      });
      userParts.push({ type: 'image_url', image_url: { url: item.dataURL } });
    });
    if (typeof onProgress === 'function') onProgress('正在理解图片与画布上下文…');
    const answer = await window.GWProviders.chat(config.engineId, {
      model: config.model,
      maxTokens: 700,
      messages: [
        {
          role: 'system',
          content: '你是极物 GIWIN Studio 的“粒子魔方”画布助手，服务室内设计师。回答要简洁、明确、专业。用户消息中的图片按附件编号顺序提供，分析图片时必须引用对应编号。你只能用文字建议，不能声称已经创建节点、运行生成、修改画布或完成任务。当前可规划多机位渲染、软装提取、高清放大、方案排版和运行已选节点群组；标记与局部重绘必须等待人工操作。'
        },
        ...(recent.slice(0, -1) || []),
        { role: 'user', content: userParts }
      ]
    });
    return String(answer || '').trim() || fallbackReply(text);
  }

  async function handleSend() {
    if (busy) return;
    const input = $('copilot-input');
    const text = input.value.trim();
    if (!text) return;
    appendMessage('user', text);
    input.value = '';
    resizeInput();
    const mode = $('copilot-mode').value;
    const intent = detectPlan(text);
    if (intent && intent.error) {
      appendMessage('assistant', intent.text);
      return;
    }
    if (intent) {
      if (mode === 'chat') {
        const message = appendMessage('assistant', '当前是“只聊不改”模式。我已识别到多机位渲染任务，但没有修改画布。');
        if (message) {
          const action = document.createElement('button');
          action.className = 'copilot-suggestion';
          action.textContent = '切换为规划并确认';
          action.addEventListener('click', () => {
            setCopilotMode('confirm');
            appendPlan(intent);
          }, { once: true });
          message.querySelector('.copilot-bubble').appendChild(document.createElement('br'));
          message.querySelector('.copilot-bubble').appendChild(action);
        }
        return;
      }
      appendPlan(intent, { autoRun: mode === 'auto' });
      return;
    }
    const progress = appendProgressMessage('正在理解当前上下文…');
    const updateProgress = message => {
      const bubble = progress && progress.querySelector('.copilot-bubble');
      if (bubble && message) bubble.textContent = message;
    };
    try {
      const answer = await chatReply(text, updateProgress);
      if (progress) progress.remove();
      appendMessage('assistant', answer);
    } catch (error) {
      if (progress) progress.remove();
      appendMessage('assistant', '对话模型调用失败：' + error.message);
    }
  }

  function updateSendState() {
    $('copilot-send').disabled = busy;
    $('copilot-input').disabled = busy;
    if ($('copilot-launch')) $('copilot-launch').classList.toggle('has-alert', busy);
  }

  function showAddMenu() {
    $('copilot-add-menu').classList.add('show');
  }

  function hideAddMenu() {
    $('copilot-add-menu').classList.remove('show');
  }

  async function addFromSelection() {
    if (contextLocked) {
      toast('上下文已锁定，请先点击“已锁定”解除', true);
      return;
    }
    const ids = selectedMediaIds();
    if (!ids.length) {
      toast('画布中还没有选中图片', true);
      return;
    }
    await addAttachmentIds(ids);
  }

  async function uploadImages() {
    if (contextLocked) {
      toast('上下文已锁定，请先解除锁定', true);
      return;
    }
    const images = await ipcRenderer.invoke('dialog:importImages');
    if (!images || !images.length) return;
    const ids = [];
    for (const image of images) {
      try {
        const inserted = await GWCanvas.addImageFromDataURL(image.dataURL, image.name || '粒子魔方附件', null, undefined, { silent: true });
        if (inserted && inserted.node && inserted.node.gwId) ids.push(inserted.node.gwId);
      } catch (error) {
        toast('附件加入画布失败：' + error.message, true);
      }
    }
    await addAttachmentIds(ids);
  }

  function clearContext() {
    if (busy) {
      toast('群组运行期间不能清空当前上下文', true);
      return;
    }
    attachments = [];
    setContextLocked(false);
    renderAttachments();
  }

  function loadHistoryRecords() {
    try {
      const records = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(records) ? records : [];
    } catch (error) {
      return [];
    }
  }

  function saveConversation() {
    if (!conversation.messages.length) return;
    const records = loadHistoryRecords().filter(item => item.id !== conversation.id);
    records.unshift(JSON.parse(JSON.stringify(conversation)));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, 30)));
  }

  function startNewConversation() {
    if (busy) {
      toast('请先等待当前群组结束或停止运行', true);
      return;
    }
    saveConversation();
    conversation = newConversation();
    activePlan = null;
    setContextLocked(false);
    clearContext();
    $('copilot-thread').innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'copilot-welcome';
    welcome.id = 'copilot-welcome';
    welcome.innerHTML = '<div class="big">今天想怎么操作画布？</div><p>选中画布中的图片后会自动加入上下文。你可以让我规划工作流、创建节点，或在确认后运行生成。</p><div class="copilot-suggestion-grid"><button class="copilot-suggestion" data-copilot-prompt="把这4张图渲成4K的效果图">多机位4K渲染</button><button class="copilot-suggestion" data-copilot-prompt="提取这些图的软装并生成选品清单">软装提取与选品</button><button class="copilot-suggestion" data-copilot-prompt="把这些图高清放大2倍">高清放大</button><button class="copilot-suggestion" data-copilot-prompt="运行当前选中的工作流">运行当前工作流</button></div>';
    $('copilot-thread').appendChild(welcome);
    bindSuggestions();
  }

  function renderHistory() {
    if (!historyPop) {
      historyPop = document.createElement('div');
      historyPop.className = 'copilot-history-pop';
      $('copilot-panel').appendChild(historyPop);
    }
    const records = loadHistoryRecords().filter(item => !item.projectPath || !currentProjectPath() || item.projectPath === currentProjectPath());
    historyPop.innerHTML = records.length
      ? records.map(item => '<button class="copilot-history-item" data-history-id="' + item.id + '"><b>' + escapeHtml(item.title || '新对话') + '</b><span>' + new Date(item.updatedAt || item.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' · ' + (item.messages || []).length + ' 条</span></button>').join('')
      : '<div class="copilot-history-empty">还没有历史对话</div>';
    historyPop.classList.toggle('show');
    historyPop.querySelectorAll('[data-history-id]').forEach(button => {
      button.addEventListener('click', () => loadConversation(button.dataset.historyId));
    });
  }

  function hideHistory() {
    if (historyPop) historyPop.classList.remove('show');
  }

  function loadConversation(id) {
    const record = loadHistoryRecords().find(item => item.id === id);
    if (!record) return;
    saveConversation();
    conversation = JSON.parse(JSON.stringify(record));
    $('copilot-thread').innerHTML = '';
    (conversation.messages || []).forEach(message => appendMessage(message.role, message.text, { transient: true }));
    hideHistory();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function bindSuggestions() {
    document.querySelectorAll('[data-copilot-prompt]').forEach(button => {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => {
        $('copilot-input').value = button.dataset.copilotPrompt || '';
        resizeInput();
        $('copilot-input').focus();
      });
    });
  }

  function init() {
    if ($('copilot-launch').hidden || $('copilot-panel').hidden) return;
    if (!window.GWCanvas) {
      setTimeout(init, 120);
      return;
    }
    setupResize();
    $('copilot-launch').addEventListener('click', togglePanel);
    $('copilot-close').addEventListener('click', closePanel);
    $('copilot-new').addEventListener('click', startNewConversation);
    $('copilot-context-state').addEventListener('click', () => {
      if (!attachments.length) return;
      setContextLocked(!contextLocked);
    });
    $('copilot-add').addEventListener('click', event => {
      event.stopPropagation();
      $('copilot-add-menu').classList.toggle('show');
    });
    $('copilot-add-menu').addEventListener('click', event => {
      const button = event.target.closest('[data-copilot-add]');
      if (!button) return;
      hideAddMenu();
      if (button.dataset.copilotAdd === 'selection') addFromSelection();
      if (button.dataset.copilotAdd === 'upload') uploadImages();
      if (button.dataset.copilotAdd === 'clear') clearContext();
    });
    $('copilot-input').addEventListener('input', resizeInput);
    $('copilot-input').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        handleSend();
      }
    });
    $('copilot-send').addEventListener('click', handleSend);
    $('copilot-mode').addEventListener('change', () => {
      localStorage.setItem('gw_copilot_mode', $('copilot-mode').value);
      syncCopilotModeLabel();
    });
    const modeBtn = $('copilot-mode-btn');
    const modeMenu = $('copilot-mode-menu');
    if (modeBtn && modeMenu) {
      modeBtn.addEventListener('click', event => {
        event.stopPropagation();
        const hidden = modeMenu.classList.toggle('hidden');
        modeBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      });
      modeBtn.addEventListener('keydown', event => {
        if (modeMenu.classList.contains('hidden') && (event.key === 'ArrowDown' || event.key === 'Enter')) {
          event.preventDefault();
          event.stopPropagation();
          modeMenu.classList.remove('hidden');
          modeBtn.setAttribute('aria-expanded', 'true');
          const first = modeMenu.querySelector('.gw-model-option');
          if (first) first.focus();
        }
      });
      modeMenu.addEventListener('click', event => {
        const opt = event.target.closest('.gw-model-option');
        if (!opt) return;
        event.stopPropagation();
        setCopilotMode(opt.dataset.mode);
        modeMenu.classList.add('hidden');
        modeBtn.setAttribute('aria-expanded', 'false');
      });
      modeMenu.addEventListener('keydown', event => {
        const options = Array.from(modeMenu.querySelectorAll('.gw-model-option'));
        const index = options.indexOf(document.activeElement);
        if (event.key === 'Escape') {
          event.stopPropagation();
          modeMenu.classList.add('hidden');
          modeBtn.setAttribute('aria-expanded', 'false');
          modeBtn.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          (options[index + 1] || options[0]).focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          (options[index - 1] || options[options.length - 1]).focus();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (document.activeElement && document.activeElement.dataset.mode) {
            setCopilotMode(document.activeElement.dataset.mode);
            modeMenu.classList.add('hidden');
            modeBtn.setAttribute('aria-expanded', 'false');
          }
        }
      });
      document.addEventListener('click', event => {
        if (!event.target.closest('#copilot-mode-picker')) {
          modeMenu.classList.add('hidden');
          modeBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }
    $('copilot-history').addEventListener('click', event => {
      event.stopPropagation();
      renderHistory();
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('#copilot-add-menu') && !event.target.closest('#copilot-add')) hideAddMenu();
      if (!event.target.closest('.copilot-history-pop') && !event.target.closest('#copilot-history')) hideHistory();
    });
    window.addEventListener('gw-selection-changed', event => handleSelectionChanged(event.detail && event.detail.ids));
    window.addEventListener('project-opened', () => {
      $('copilot-project-label').textContent = projectName();
      clearContext();
      updateModelLabel();
    });
    window.addEventListener('project-renamed', event => {
      const name = event.detail && event.detail.name || projectName();
      $('copilot-project-label').textContent = name;
    });
    window.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        togglePanel();
        return;
      }
      if (event.key === 'Escape' && panelOpen) {
        if ($('copilot-add-menu').classList.contains('show')) {
          hideAddMenu();
          event.stopPropagation();
          return;
        }
        if (historyPop && historyPop.classList.contains('show')) {
          hideHistory();
          event.stopPropagation();
          return;
        }
        if ($('copilot-panel').contains(document.activeElement)) {
          closePanel();
          event.stopPropagation();
        }
      }
    }, true);
    const savedMode = localStorage.getItem('gw_copilot_mode');
    if (savedMode && ['chat', 'confirm', 'auto'].includes(savedMode)) $('copilot-mode').value = savedMode;
    syncCopilotModeLabel();
    bindSuggestions();
    updateModelLabel();
    updateContextState();
    updateSendState();
    $('copilot-project-label').textContent = projectName();
  }

  init();
})();
