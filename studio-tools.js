(function () {
  'use strict';
  const Marzipano = require('marzipano');

  const $ = id => document.getElementById(id);
  const API = () => window.GWCanvas;
  const P = () => window.GWProviders;
  const toast = (message, error) => {
    try { API().toast(message, error); } catch (e) { console.warn(message); }
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const ASSET_KEY = 'gw_workflow_assets_v1';
  let assetQuery = '';
  let assetPointerDrag = null;
  let assetDragGhost = null;
  const workflowAssetsDisabled = () => document.body.dataset.gwWorkflowAssets === 'disabled';
  // 工作流为订阅权益：锁定时默认落在通用资产视图，避免直接看到工作流列表。
  let assetView = workflowAssetsDisabled() ? 'assets' : 'workflows';

  function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片解码失败'));
      image.src = dataURL;
    });
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- 工作流资产库 ----------
  function readAssets() {
    try {
      const list = JSON.parse(localStorage.getItem(ASSET_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function writeAssets(list) {
    localStorage.setItem(ASSET_KEY, JSON.stringify(list.slice(0, 80)));
  }
  function assetKindOf(item, kind) {
    if (kind === 'images') return !!item && item.kind === 'images';
    if (kind === 'workflow') return !!item && !!item.graph;
    return !!item && !item.graph && item.kind !== 'images';
  }
  function uniqueAssetName(name, list, kind) {
    const base = String(name || '未命名资产').trim() || '未命名资产';
    let index = 2;
    let candidate = base + ' · v' + index;
    while (list.some(item => assetKindOf(item, kind) && item.name === candidate)) {
      index++;
      candidate = base + ' · v' + index;
    }
    return candidate;
  }
  function askAssetConflict(asset) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.style.zIndex = '365';
      mask.innerHTML = `<div class="welcome" style="width:min(430px,92vw)">
        <div><h2 style="margin:0">资产名称已存在</h2>
        <div class="sub" style="margin:7px 0 0">「${esc(asset && asset.name || '未命名资产')}」已经保存过。覆盖会替换原资产；另存版本会保留原资产。</div></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
          <button class="studio-btn" data-choice="cancel">取消</button>
          <button class="studio-btn" data-choice="version">另存版本</button>
          <button class="studio-btn primary" data-choice="overwrite">覆盖</button>
        </div>
      </div>`;
      const close = choice => { mask.remove(); resolve(choice); };
      mask.querySelectorAll('[data-choice]').forEach(button => {
        button.onclick = () => close(button.dataset.choice);
      });
      mask.addEventListener('mousedown', event => { if (event.target === mask) close('cancel'); });
      document.body.appendChild(mask);
    });
  }
  async function resolveAssetName(details, kind, list) {
    const existing = list.find(item => assetKindOf(item, kind) && item.name === details.name);
    if (!existing) return { details, existing: null };
    const choice = await askAssetConflict(existing);
    if (choice === 'cancel') return null;
    if (choice === 'version') {
      return {
        details: Object.assign({}, details, { name: uniqueAssetName(details.name, list, kind) }),
        existing: null
      };
    }
    return { details, existing };
  }
  function confirmDeleteAsset(asset) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.style.zIndex = '360';
      mask.innerHTML = `<div class="welcome" style="width:min(420px,92vw)">
        <div><h2 style="margin:0">删除资产</h2>
        <div class="sub" style="margin:7px 0 0">确认删除「${esc(asset.name || '未命名资产')}」？图片素材的原文件也会一起删除。</div></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
          <button class="studio-btn" data-choice="cancel">取消</button>
          <button class="studio-btn primary" data-choice="delete">删除</button>
        </div>
      </div>`;
      const close = result => { mask.remove(); resolve(result); };
      mask.querySelector('[data-choice="cancel"]').onclick = () => close(false);
      mask.querySelector('[data-choice="delete"]').onclick = () => close(true);
      mask.addEventListener('mousedown', event => { if (event.target === mask) close(false); });
      document.body.appendChild(mask);
    });
  }
  function syncAssetSaveState() {
    const button = $('studio-save-images');
    if (!button) return;
    const api = API();
    const canSave = !!(api && api.hasSelectedMediaForAsset && api.hasSelectedMediaForAsset());
    button.disabled = !canSave;
    button.title = canSave ? '把当前选中的图片保存为可跨项目使用的图片素材' : '先选中一张或多张图片';
  }
  function askWorkflowDetails({ suggested, graph, kind }) {
    return new Promise(resolve => {
      const isImages = kind === 'images';
      const isWorkflow = !!graph || kind === 'workflow';
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.style.zIndex = '360';
      mask.innerHTML = `<div class="welcome" style="width:min(480px,92vw)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div><h2 style="margin:0">${isWorkflow ? '建立工作流' : (isImages ? '保存图片素材' : '保存通用资产')}</h2>
          <div class="sub" style="margin:6px 0 0">${isWorkflow ? '保存选中节点、参数和节点之间的连线。' : (isImages ? '把选中图片保存为可跨项目使用的图片素材。' : '保存当前风格、模型和参数配方。')}</div></div>
          <button class="close-icon-btn" data-close title="关闭" aria-label="关闭">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:18px">
          <label style="font-size:11px;color:var(--sub)">名称
            <input data-name value="${esc(suggested)}" style="width:100%;height:34px;margin-top:5px;background:var(--raised);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:0 9px" />
          </label>
          <label style="font-size:11px;color:var(--sub)">分类
            <select data-category style="width:100%;height:34px;margin-top:5px;background:var(--raised);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:0 8px">
              <option>全流程</option><option>空间生图</option><option>改图精修</option><option>高清放大</option><option>方案交付</option><option>软装提取与选品</option><option>其他</option>
            </select>
          </label>
          <label style="font-size:11px;color:var(--sub)">说明（可选）
            <textarea data-description placeholder="例如：客厅四机位一致性出图，包含材质、光影和排版" style="width:100%;height:58px;margin-top:5px;background:var(--raised);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:8px;resize:none;line-height:18px"></textarea>
          </label>
          ${graph ? `<div style="font-size:10.5px;color:var(--faint)">将保存 ${graph.nodes.length} 个节点、${graph.edges.length} 条内部连线</div>` : ''}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
            <button class="studio-btn" data-close>取消</button>
            <button class="studio-btn primary" data-save>保存到${isWorkflow ? '工作流' : '资产库'}</button>
          </div>
        </div>
      </div>`;
      const close = result => {
        mask.remove();
        resolve(result);
      };
      document.body.appendChild(mask);
      const nameInput = mask.querySelector('[data-name]');
      requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
      mask.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => close(null); });
      mask.addEventListener('mousedown', event => { if (event.target === mask) close(null); });
      mask.querySelector('[data-save]').onclick = () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.style.borderColor = 'var(--danger)';
          nameInput.focus();
          return;
        }
        close({
          name,
          category: mask.querySelector('[data-category]').value,
          description: mask.querySelector('[data-description]').value.trim()
        });
      };
      mask.addEventListener('keydown', event => {
        if (event.key === 'Escape') close(null);
        if (event.key === 'Enter' && event.target === nameInput) mask.querySelector('[data-save]').click();
      });
    });
  }
  async function saveCurrentWorkflow() {
    if (workflowAssetsDisabled()) {
      if (window.GW_requireWorkflowAssets) window.GW_requireWorkflowAssets();
      return false;
    }
    try {
      const recipe = API().getRecipeSnapshot();
      const graph = API().captureWorkflowTemplate
        ? API().captureWorkflowTemplate()
        : (API().captureSelectionTemplate ? API().captureSelectionTemplate() : null);
      if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) {
        toast('先选中需要保存为工作流的节点', true);
        return;
      }
      const suggested = graph
        ? ('节点工作流 · ' + graph.nodes.length + ' 个节点')
        : ((recipe.styleName || '室内方案') + ' · ' + (P().aliasOf(recipe.model) || recipe.model || '模型'));
      const details = await askWorkflowDetails({ suggested, graph, kind: 'workflow' });
      if (!details) return;
      const list = readAssets();
      const placement = await resolveAssetName(details, 'workflow', list);
      if (!placement) return;
      const saveDetails = placement.details;
      closePanel();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let preview = API().captureWorkflowCompositePreview
        ? await API().captureWorkflowCompositePreview()
        : '';
      if (!preview && API().captureAssetPreview) {
        preview = await API().captureAssetPreview({ kind: 'workflow', graph, name: saveDetails.name });
      }
      const asset = {
        id: placement.existing ? placement.existing.id : ('wf' + Date.now().toString(36)),
        name: saveDetails.name,
        category: saveDetails.category,
        description: saveDetails.description,
        version: placement.existing ? Math.max(1, Number(placement.existing.version) || 1) + 1 : 1,
        createdAt: Date.now(),
        preview,
        recipe
      };
      if (graph) asset.graph = graph;
      if (placement.existing) {
        const oldIndex = list.findIndex(item => item.id === placement.existing.id);
        if (oldIndex >= 0) list.splice(oldIndex, 1);
      }
      list.unshift(asset);
      writeAssets(list);
      assetView = graph ? 'workflows' : 'assets';
      setAssetScope(graph ? 'workflow' : 'common');
      toast((placement.existing ? '已覆盖工作流资产：' : '已保存工作流资产：') + saveDetails.name);
    } catch (e) {
      toast('保存工作流失败：' + e.message, true);
    }
  }
  async function saveCurrentAsset() {
    try {
      const recipe = API().getRecipeSnapshot();
      const suggested = (recipe.styleName || '室内方案') + ' · ' +
        (P().aliasOf(recipe.model) || recipe.model || '模型');
      const details = await askWorkflowDetails({ suggested, graph: null, kind: 'asset' });
      if (!details) return;
      const list = readAssets();
      const placement = await resolveAssetName(details, 'asset', list);
      if (!placement) return;
      const saveDetails = placement.details;
      closePanel();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let preview = API().captureWorkflowCompositePreview
        ? await API().captureWorkflowCompositePreview()
        : '';
      if (!preview && API().captureAssetPreview) {
        preview = await API().captureAssetPreview({ kind: 'asset', recipe, name: saveDetails.name });
      }
      const asset = {
        id: placement.existing ? placement.existing.id : ('asset' + Date.now().toString(36)),
        name: saveDetails.name,
        category: saveDetails.category,
        description: saveDetails.description,
        version: placement.existing ? Math.max(1, Number(placement.existing.version) || 1) + 1 : 1,
        createdAt: Date.now(),
        preview,
        recipe
      };
      if (placement.existing) {
        const oldIndex = list.findIndex(item => item.id === placement.existing.id);
        if (oldIndex >= 0) list.splice(oldIndex, 1);
      }
      list.unshift(asset);
      writeAssets(list);
      assetView = 'assets';
      setAssetScope('common');
      toast((placement.existing ? '已覆盖通用资产：' : '已保存通用资产：') + saveDetails.name);
    } catch (error) {
      toast('保存通用资产失败：' + error.message, true);
    }
  }
  async function saveSelectedImagesAsset() {
    try {
      if (!API().saveSelectedImagesForAssetLibrary) throw new Error('当前版本不支持图片资产');
      const images = await API().saveSelectedImagesForAssetLibrary();
      if (!images.length) {
        toast('先选中需要保存的图片', true);
        return;
      }
      const details = await askWorkflowDetails({
        suggested: '图片素材 · ' + images.length + ' 张',
        graph: null,
        kind: 'images'
      });
      if (!details) {
        await API().deleteAssetImageFiles(images);
        return;
      }
      const list = readAssets();
      const placement = await resolveAssetName(details, 'images', list);
      if (!placement) {
        await API().deleteAssetImageFiles(images);
        return;
      }
      const saveDetails = placement.details;
      if (placement.existing && placement.existing.images && API().deleteAssetImageFiles) {
        await API().deleteAssetImageFiles(placement.existing.images);
      }
      const asset = {
        id: placement.existing ? placement.existing.id : ('images' + Date.now().toString(36)),
        kind: 'images',
        name: saveDetails.name,
        category: saveDetails.category,
        description: saveDetails.description,
        version: placement.existing ? Math.max(1, Number(placement.existing.version) || 1) + 1 : 1,
        createdAt: Date.now(),
        preview: images[0].preview || '',
        images
      };
      if (placement.existing) {
        const oldIndex = list.findIndex(item => item.id === placement.existing.id);
        if (oldIndex >= 0) list.splice(oldIndex, 1);
      }
      list.unshift(asset);
      writeAssets(list);
      assetView = 'assets';
      setAssetScope('common');
      toast((placement.existing ? '已覆盖图片素材：' : '已保存图片素材：') + saveDetails.name);
    } catch (error) {
      toast('保存图片素材失败：' + error.message, true);
    }
  }
  async function deleteAsset(id) {
    const asset = readAssets().find(x => x.id === id);
    if (!asset) return;
    if (!await confirmDeleteAsset(asset)) return;
    if (asset.kind === 'images' && API().deleteAssetImageFiles) {
      await API().deleteAssetImageFiles(asset.images);
    }
    writeAssets(readAssets().filter(x => x.id !== id));
    renderAssets();
    toast('已删除工作流资产');
  }
  async function exportAssets() {
    const list = readAssets();
    const locked = workflowAssetsDisabled();
    const exportable = locked ? list.filter(item => !item.graph) : list;
    const skippedWorkflows = list.length - exportable.length;
    if (!exportable.length) {
      toast(locked ? '工作流为订阅功能，当前没有可导出的通用资产' : '还没有工作流资产', true);
      return;
    }
    try {
      const exported = [];
      for (const item of exportable) {
        const copy = JSON.parse(JSON.stringify(item));
        if (copy.kind === 'images' && Array.isArray(copy.images)) {
          copy.images = await Promise.all(copy.images.map(async image => {
            let dataURL = '';
            if (image && image.file && API().readAssetImageFile) {
              try { dataURL = await API().readAssetImageFile(image.file); } catch (error) {}
            }
            return Object.assign({}, image, {
              dataURL: dataURL || image.dataURL || undefined,
              portable: !!dataURL
            });
          }));
        }
        exported.push(copy);
      }
      downloadFile('极物资产库-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ version: 2, exportedAt: Date.now(), assets: exported }, null, 2));
      toast(skippedWorkflows
        ? '已导出 ' + exported.length + ' 个通用资产，跳过 ' + skippedWorkflows + ' 个工作流（订阅功能）'
        : '已导出 ' + exported.length + ' 个资产，图片素材已包含原图');
    } catch (error) {
      toast('导出资产失败：' + error.message, true);
    }
  }
  function importAssets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const incoming = Array.isArray(data) ? data : (data.assets || []);
        const list = readAssets();
        let importedCount = 0;
        let missingImageCount = 0;
        let skippedWorkflows = 0;
        for (const item of incoming) {
          if (workflowAssetsDisabled() && item && item.graph) { skippedWorkflows++; continue; }
          if (!item || (!item.recipe && !item.graph && !(Array.isArray(item.images) && item.images.length))) continue;
          let images;
          if (Array.isArray(item.images)) {
            images = [];
            for (const image of item.images) {
              if (!image) continue;
              if (image.dataURL && API().saveAssetImageDataURL) {
                const saved = await API().saveAssetImageDataURL(image.dataURL, image.label || item.name);
                if (saved) {
                  images.push({
                    file: saved.name,
                    label: image.label || item.name || '图片素材',
                    room: image.room || '',
                    width: saved.width || image.width || 0,
                    height: saved.height || image.height || 0,
                    preview: saved.thumb || image.preview || '',
                    upscale: image.upscale || undefined
                  });
                  continue;
                }
              }
              images.push(Object.assign({}, image, {
                dataURL: undefined,
                portable: false,
                missing: true
              }));
              missingImageCount++;
            }
          }
          const inferredKind = item.graph ? 'workflow' : (item.kind === 'images' ? 'images' : 'asset');
          const uniqueName = uniqueAssetName(String(item.name || '导入资产'), list, inferredKind);
          const preview = (images && images.find(image => image.preview) && images.find(image => image.preview).preview)
            || item.preview
            || (API().captureAssetPreview
            ? await API().captureAssetPreview({
              kind: item.graph ? 'workflow' : 'asset',
              graph: item.graph,
              recipe: item.recipe,
              name: item.name
            })
            : '');
          const imported = {
            id: 'wf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            name: uniqueName,
            category: String(item.category || ''),
            description: String(item.description || ''),
            version: Math.max(1, Number(item.version) || 1),
            createdAt: Date.now(),
            kind: item.kind || undefined,
            preview,
            recipe: item.recipe ? JSON.parse(JSON.stringify(item.recipe)) : undefined,
            graph: item.graph ? JSON.parse(JSON.stringify(item.graph)) : undefined,
            images
          };
          list.unshift(imported);
          importedCount++;
        }
        writeAssets(list);
        renderAssets();
        toast('已导入 ' + importedCount + ' 个资产'
          + (skippedWorkflows ? '，跳过 ' + skippedWorkflows + ' 个工作流（订阅功能）' : '')
          + (missingImageCount ? '，' + missingImageCount + ' 张旧素材缺少原图，请重新保存' : ''));
      } catch (e) {
        toast('工作流文件读取失败：' + e.message, true);
      }
    };
    input.click();
  }
  function fallbackAssetPreview(item) {
    const recipe = item.recipe || {};
    const title = item.name || (item.graph ? '工作流资产' : '通用资产');
    const subtitle = item.graph
      ? item.graph.nodes.length + ' 个节点 · ' + (item.graph.edges || []).length + ' 条连线'
      : [recipe.styleName, P() && P().aliasOf ? P().aliasOf(recipe.model || '') : recipe.model, recipe.size, recipe.aspect]
        .filter(Boolean).join(' · ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f3eee5"/><stop offset="1" stop-color="#dbe3e5"/></linearGradient></defs>
      <rect width="720" height="420" fill="url(#g)"/><rect x="48" y="48" width="54" height="5" fill="#83A0B2"/>
      <text x="48" y="126" font-family="'GIWIN Sans', sans-serif" font-size="38" font-weight="700" fill="#272522">${esc(title)}</text>
      <text x="48" y="172" font-family="'GIWIN Sans', sans-serif" font-size="17" fill="#68635d">${esc(subtitle)}</text>
      <text x="48" y="370" font-family="'GIWIN Sans', sans-serif" font-size="12" fill="#8f8981">${item.graph ? 'GIWIN WORKFLOW ASSET' : 'GIWIN REUSABLE ASSET'}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function finishAssetPointerDrag(event, cancelled) {
    if (!assetPointerDrag) return;
    const state = assetPointerDrag;
    assetPointerDrag = null;
    if (assetDragGhost) {
      assetDragGhost.remove();
      assetDragGhost = null;
    }
    if (state.wrapper) state.wrapper.classList.remove('dragging');
    document.body.classList.remove('asset-dragging');
    if (!state.moved || cancelled) return;
    state.wrapper.__suppressAssetClick = true;
    setTimeout(() => { state.wrapper.__suppressAssetClick = false; }, 80);
    const elements = document.elementsFromPoint(event.clientX, event.clientY);
    const materialPanel = elements.map(el => el.closest && el.closest('.material-panel')).find(Boolean);
    const materialSlot = elements.map(el => el.closest && el.closest('[data-mat-ref-slot]')).find(Boolean);
    const materialRow = elements.map(el => el.closest && el.closest('[data-mat-row]')).find(Boolean);
    const lightExterior = elements.map(el => el.closest && el.closest('[data-light-exterior-drop]')).find(Boolean);
    if (lightExterior && state.asset.kind === 'images') {
      const lightPanel = lightExterior.closest('.light-panel');
      if (!lightPanel) return;
      closePanel();
      const targetId = lightPanel.dataset.nodeId || lightPanel.id.replace(/^gw-node-panel-/, '');
      Promise.resolve(API().assignAssetImagesToLightExterior(state.asset.images, targetId))
        .then(() => toast('已把资产图片设为窗外外景'))
        .catch(error => toast('外景参考设置失败：' + error.message, true));
      return;
    }
    if (materialPanel && (materialSlot || materialRow) && state.asset.kind === 'images') {
      closePanel();
      const targetId = materialPanel.dataset.nodeId || materialPanel.id.replace(/^gw-node-panel-/, '');
      const slotKey = (materialSlot && materialSlot.dataset.matRefSlot) ||
        (materialRow && materialRow.dataset.matRow) ||
        'floor';
      Promise.resolve(API().assignAssetImagesToMaterialSlot(state.asset.images, targetId, slotKey))
        .then(() => toast('已把资产图片设为材质参考'))
        .catch(error => toast('材质参考设置失败：' + error.message, true));
      return;
    }
    const canvas = $('canvas-wrap');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) return;
    const asset = state.asset;
    const world = API().clientToWorld(event.clientX, event.clientY);
    closePanel();
    try {
      if (asset.graph) {
        Promise.resolve(API().instantiateTemplate(asset.graph, world))
          .catch(error => toast('调用工作流失败：' + error.message, true));
      } else if (asset.kind === 'images') {
        Promise.resolve(API().insertAssetImageGroup(asset.images, world))
          .catch(error => toast('放置图片素材失败：' + error.message, true));
      } else if (asset.recipe) {
        if (API().applyRecipeAsset) API().applyRecipeAsset(asset.recipe, world, { forceCreate: true });
        else API().applyRecipeSnapshot(asset.recipe);
      }
    } catch (error) {
      toast('使用资产失败：' + error.message, true);
    }
  }
  function bindAssetPointerDrag(wrapper, row, asset) {
    row.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      if (event.target.closest('[data-a="apply"],[data-a="del"]')) return;
      assetPointerDrag = {
        asset,
        wrapper,
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        moved: false
      };
    });
  }
  function bindAssetPointerEvents() {
    if (window.__gwAssetPointerBound) return;
    window.__gwAssetPointerBound = true;
    window.addEventListener('pointermove', event => {
      const state = assetPointerDrag;
      if (!state || event.pointerId !== state.pointerId) return;
      if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return;
      if (!state.moved) {
        state.moved = true;
        state.wrapper.classList.add('dragging');
        document.body.classList.add('asset-dragging');
        assetDragGhost = document.createElement('div');
        assetDragGhost.className = 'asset-drag-ghost';
        const preview = state.asset.preview || fallbackAssetPreview(state.asset);
        assetDragGhost.innerHTML = '<img src="' + esc(preview) + '" alt=""><span>' + esc(state.asset.name || '资产') + '</span>';
        document.body.appendChild(assetDragGhost);
      }
      event.preventDefault();
      if (assetDragGhost) {
        assetDragGhost.style.left = (event.clientX + 16) + 'px';
        assetDragGhost.style.top = (event.clientY + 16) + 'px';
      }
    }, { passive: false });
    window.addEventListener('pointerup', event => {
      if (!assetPointerDrag || event.pointerId !== assetPointerDrag.pointerId) return;
      finishAssetPointerDrag(event, false);
    });
    window.addEventListener('pointercancel', event => {
      if (!assetPointerDrag || event.pointerId !== assetPointerDrag.pointerId) return;
      finishAssetPointerDrag(event, true);
    });
  }
  // ---------- 新手案例模板（已下线） ----------
  // 三个拖入式模板已由「新手使用说明书」内置项目替代（欢迎页第一张卡 / 底部书本图标 / 工具栏按钮），
  // 资产库不再渲染模板区。

  function renderAssets() {
    const box = $('studio-assets');
    if (!box) return;
    if (workflowAssetsDisabled() && assetView === 'workflows') assetView = 'assets';
    const all = readAssets();
    const workflowCount = all.filter(item => item && item.graph).length;
    const assetCount = all.filter(item => item && !item.graph).length;
    const workflowTab = $('studio-view-workflows');
    const assetTab = $('studio-view-assets');
    if (workflowTab) workflowTab.textContent = '工作流 ' + workflowCount;
    if (assetTab) assetTab.textContent = '资产库 ' + assetCount;
    document.querySelectorAll('[data-asset-view]').forEach(button => {
      button.classList.toggle('on', button.dataset.assetView === assetView);
    });
    const query = assetQuery.trim().toLowerCase();
    const list = all.filter(item => {
      if (!item) return false;
      if (assetView === 'workflows' ? !item.graph : !!item.graph) return false;
      if (!query) return true;
      const recipe = item.recipe || {};
      return [item.name, recipe.styleName, recipe.model, recipe.size, recipe.aspect]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
    if (!list.length) {
      box.innerHTML = '<div class="studio-empty">' + (query
        ? '没有找到匹配的资产。'
        : (assetView === 'workflows'
          ? '还没有节点工作流。选中一组节点后，点下方「保存当前工作流」。'
          : '还没有参数配方资产。未选中节点时保存，会作为参数资产存到这里。')) + '</div>';
      syncAssetSaveState();
      return;
    }
    box.innerHTML = list.map(item => {
      const r = item.recipe || {};
      const model = P() && P().aliasOf ? P().aliasOf(r.model || '') : (r.model || '未指定模型');
      const graph = item.graph;
      const info = graph
        ? '节点组 · ' + graph.nodes.length + ' 节点 · ' + (graph.edges || []).length + ' 连线 · 可拖到画布'
        : (item.kind === 'images'
          ? '图片素材 · ' + (item.images || []).length + ' 张 · 可拖到画布'
          : ((r.styleName || '未命名风格') + ' · ' + model + ' · ' + (r.size || 'auto') + ' / ' + (r.aspect || 'auto')));
      const kindText = graph ? '工作流' : (item.kind === 'images' ? '图片素材' : '参数配方');
      const meta = [kindText, item.category ? '[' + item.category + ']' : '', info, item.description || '']
        .filter(Boolean)
        .join(' · ');
      const missingImage = item.kind === 'images' && (!item.images || !item.images.length ||
        item.images.some(image => image && (image.missing || !image.file)));
      const imageCount = item.kind === 'images' && item.images ? item.images.length : 0;
      const preview = item.preview || fallbackAssetPreview(item);
      return '<div class="studio-asset-wrap" data-id="' + esc(item.id) + '">' +
        '<div class="studio-asset">' +
          '<button class="studio-asset-thumb" data-a="preview" title="单击展开预览；拖到画布直接使用"><img src="' + esc(preview) + '" alt="">' +
            (imageCount > 1 ? '<i class="studio-asset-count">' + imageCount + '</i>' : '') +
          '</button>' +
          '<div class="meta"><b>' + esc(item.name) + '</b><span>' + esc(meta) + '</span>' +
            (missingImage ? '<em>旧素材缺少原图，请重新保存</em>' : '') +
          '</div>' +
          '<div class="studio-asset-actions"><button class="studio-btn" data-a="apply">调用</button><button class="studio-btn" data-a="del">删</button></div>' +
        '</div>' +
        '<div class="studio-asset-expanded"><img data-expanded-image src="' + esc(preview) + '" alt="" decoding="async"><p>' + esc(meta) + '</p></div>' +
      '</div>';
    }).join('');
    box.querySelectorAll('.studio-asset-wrap').forEach(wrapper => {
      const asset = readAssets().find(x => x.id === wrapper.dataset.id);
      const row = wrapper.querySelector('.studio-asset');
      if (!asset) return;
      wrapper.querySelector('[data-a="preview"]').onclick = async () => {
        if (wrapper.__suppressAssetClick) return;
        const opening = !wrapper.classList.contains('expanded');
        box.querySelectorAll('.studio-asset-wrap.expanded').forEach(other => {
          if (other !== wrapper) other.classList.remove('expanded');
        });
        wrapper.classList.toggle('expanded', opening);
        if (!opening || asset.kind !== 'images' || !API().readAssetImageFile) return;
        const image = wrapper.querySelector('[data-expanded-image]');
        const sourceImage = asset.images && asset.images.find(item => item && item.file);
        const file = sourceImage && sourceImage.file;
        if (!image || !file || image.dataset.fullLoaded === '1') return;
        image.style.opacity = '.55';
        try {
          const dataURL = await API().readAssetImageFile(file);
          if (dataURL) {
            image.src = dataURL;
            image.dataset.fullLoaded = '1';
          }
        } catch (error) {}
        image.style.opacity = '';
      };
      bindAssetPointerDrag(wrapper, row, asset);
      row.querySelector('[data-a="apply"]').onclick = async () => {
        try {
          if (asset.graph) await API().instantiateTemplate(asset.graph);
          else if (asset.kind === 'images') await API().insertAssetImageGroup(asset.images);
          else if (API().applyRecipeAsset) API().applyRecipeAsset(asset.recipe);
          else API().applyRecipeSnapshot(asset.recipe);
          closePanel();
        } catch (e) { toast(e.message, true); }
      };
      row.querySelector('[data-a="del"]').onclick = () => deleteAsset(asset.id);
    });
    syncAssetSaveState();
  }

  // ---------- 右栏工作台 ----------
  const TOOL_META = {
    mark: { label: '标记', subtitle: '画笔、矩形、箭头' },
    inpaint: { label: '局部重绘', subtitle: '框选、圈选、魔术棒' },
    panorama: { label: '360° 全景', subtitle: '环视与缩放预览' },
    reverse: { label: '反推提示词', subtitle: '分析图片生成提示词' },
    chat: { label: '对话模式', subtitle: '带当前图片继续讨论' },
    layers: { label: '图像分层', subtitle: 'Seedream 图层分解' }
  };
  const TOOL_ICONS = {
    mark: '✎',
    inpaint: '✂',
    panorama: '◐',
    reverse: '↺',
    chat: '💬'
  };
  let workbenchSourceId = null;
  function openPanel() {
    const selectedId = API() && API().selectedMediaId();
    if (selectedId) workbenchSourceId = selectedId;
    if (window.GW_setCanvasDrawer) window.GW_setCanvasDrawer('left', true);
    renderAssets();
  }
  function closePanel() {
    if (window.GW_setCanvasDrawer) window.GW_setCanvasDrawer('left', false);
  }
  function createNodeForTool(tool) {
    const meta = TOOL_META[tool];
    if (!meta) {
      toast('这个功能需要先配置对应的工作流或模型接口，当前不会假装可运行。', true);
      return;
    }
    const activeId = API() && API().selectedMediaId();
    if (activeId) workbenchSourceId = activeId;
    if (!workbenchSourceId) { toast('请先从一张图片打开工作台', true); return; }
    if (!activeId) API().selectNodeById(workbenchSourceId);
    if (tool === 'layers' && API().runLayerSeparationOnSelection) {
      return Promise.resolve(API().runLayerSeparationOnSelection())
        .then(result => {
          if (window.GW_setCanvasDrawer) window.GW_setCanvasDrawer('left', false);
          return result;
        });
    }
    return Promise.resolve(API().createToolNode(tool, meta.label, meta.subtitle, workbenchSourceId))
      .then(result => {
        if (window.GW_setCanvasDrawer) window.GW_setCanvasDrawer('left', false);
        return result;
      })
      .catch(e => toast('创建工作台节点失败：' + e.message, true));
  }
  function setAssetScope(scope) {
    const next = scope === 'workflow' ? 'workflow' : (scope === 'common' ? 'common' : 'project');
    if (next === 'workflow' && workflowAssetsDisabled()) return false;
    document.querySelectorAll('[data-asset-scope]').forEach(button => {
      button.classList.toggle('on', button.dataset.assetScope === next);
    });
    const projectView = $('asset-project-view');
    const commonView = $('asset-common-view');
    if (projectView) projectView.classList.toggle('hidden', next !== 'project');
    if (commonView) commonView.classList.toggle('hidden', next === 'project');
    if (next === 'workflow') {
      assetView = 'workflows';
      const saveButton = $('studio-save-wf');
      if (saveButton) saveButton.textContent = '保存当前工作流';
      const saveImagesButton = $('studio-save-images');
      if (saveImagesButton) saveImagesButton.style.display = 'none';
      if (saveButton) saveButton.style.gridColumn = '1 / -1';
      renderAssets();
    } else if (next === 'common') {
      assetView = 'assets';
      const saveButton = $('studio-save-wf');
      if (saveButton) saveButton.textContent = '保存当前配方';
      const saveImagesButton = $('studio-save-images');
      if (saveImagesButton) saveImagesButton.style.display = '';
      if (saveButton) saveButton.style.gridColumn = '';
      renderAssets();
    }
  }
  function applyWorkflowGate(locked) {
    if (!locked) return;
    if (assetView === 'workflows') {
      assetView = 'assets';
      renderAssets();
    }
    const active = document.querySelector('[data-asset-scope].on');
    if (active && active.dataset.assetScope === 'workflow') setAssetScope('project');
  }
  window.addEventListener('gw:workflow-gate', event => {
    applyWorkflowGate(!!(event.detail && event.detail.locked));
  });
  function buildToolLibrary() {
    const assetsBox = $('studio-assets');
    if (!assetsBox) return;
    $('studio-save-wf').onclick = () => {
      if (assetView === 'workflows') saveCurrentWorkflow();
      else saveCurrentAsset();
    };
    $('studio-save-images').onclick = saveSelectedImagesAsset;
    $('studio-export-wf').onclick = exportAssets;
    $('studio-import-wf').onclick = importAssets;
    document.querySelectorAll('[data-asset-scope]').forEach(button => {
      button.onclick = () => {
        if (button.dataset.assetScope === 'workflow' && workflowAssetsDisabled()) {
          if (window.GW_requireWorkflowAssets) window.GW_requireWorkflowAssets();
          return;
        }
        setAssetScope(button.dataset.assetScope);
      };
    });
    const search = $('studio-asset-search');
    if (search) {
      search.oninput = () => {
        assetQuery = search.value;
        renderAssets();
      };
    }
    bindAssetPointerEvents();
    setAssetScope('project');
    renderAssets();
  }
  function createToolAt(kind, clientX, clientY) {
    const meta = TOOL_META[kind];
    if (!meta) return;
    const activeId = API().selectedMediaId() || workbenchSourceId;
    if (!activeId) { toast('先选中一张图片', true); return; }
    if (window.GW_setCanvasDrawer) window.GW_setCanvasDrawer('left', false);
    Promise.resolve(API().createToolAtClient(kind, meta.label, meta.subtitle, activeId, clientX, clientY))
      .catch(error => toast('创建工具节点失败：' + error.message, true));
  }
  // ---------- 通用编辑器 ----------
  function makeEditor(title, media, toolsHTML, footerHTML) {
    const mask = document.createElement('div');
    mask.className = 'studio-editor-mask';
    mask.innerHTML = `<div class="studio-editor">
      <div class="studio-editor-head"><b>${esc(title)}</b><span style="font-size:10.5px;color:var(--faint)">${esc(media.label)} · ${media.w}×${media.h}</span><button class="studio-btn close-icon-btn" data-close title="关闭" aria-label="关闭">×</button></div>
      <div class="studio-editor-tools">${toolsHTML}</div>
      <div class="studio-editor-stage"></div>
      <div class="studio-editor-foot">${footerHTML}</div>
    </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.querySelector('[data-close]').onclick = close;
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
    return { mask, close, stage: mask.querySelector('.studio-editor-stage') };
  }

  function drawArrow(ctx, x1, y1, x2, y2, color, size) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(12, size * 3.5);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 标记 ----------
  async function openMarkup() {
    const media = API() && await API().selectedMediaInfoFull();
    if (!media) { toast('请先选中一张图片或变体卡', true); return; }
    let image;
    try { image = await loadImage(media.dataURL); } catch (e) { toast(e.message, true); return; }
    const editor = makeEditor('标记图片', media,
      '<button data-t="pen" class="on">画笔</button><button data-t="rect">矩形</button><button data-t="arrow">箭头</button>' +
      '<span style="width:1px;height:18px;background:var(--line);margin:0 5px"></span>' +
      '<input id="mark-color" type="color" value="#ff3b30" title="颜色" style="width:28px;height:28px;border:none;background:transparent;padding:0;cursor:pointer">' +
      '<label style="font-size:10.5px;color:var(--faint)">粗细 <input id="mark-size" type="range" min="2" max="28" value="6"></label>' +
      '<button id="mark-undo">撤销</button><button id="mark-clear">清空</button>',
      '<span style="font-size:10.5px;color:var(--faint);flex:1">标记完成后会另存为一张新图片，原图不变。</span><button class="studio-btn primary" id="mark-save">保存标记图</button>');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    editor.stage.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let tool = 'pen';
    let color = '#ff3b30';
    let size = 6;
    let ops = [];
    let draft = null;
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      ops.forEach(drawOp);
      if (draft) drawOp(draft);
    };
    const point = e => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
    };
    const drawOp = op => {
      if (!op) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.size;
      if (op.type === 'pen' && op.points.length) {
        ctx.beginPath();
        ctx.moveTo(op.points[0].x, op.points[0].y);
        for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i].x, op.points[i].y);
        ctx.stroke();
      } else if (op.type === 'rect') {
        ctx.strokeRect(op.start.x, op.start.y, op.end.x - op.start.x, op.end.y - op.start.y);
      } else if (op.type === 'arrow') {
        drawArrow(ctx, op.start.x, op.start.y, op.end.x, op.end.y, op.color, op.size);
      }
      ctx.restore();
    };
    editor.mask.querySelectorAll('[data-t]').forEach(btn => {
      btn.onclick = () => {
        tool = btn.dataset.t;
        editor.mask.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === btn));
      };
    });
    $('mark-color').oninput = e => { color = e.target.value; };
    $('mark-size').oninput = e => { size = +e.target.value; };
    $('mark-undo').onclick = () => { ops.pop(); redraw(); };
    $('mark-clear').onclick = () => { ops = []; draft = null; redraw(); };
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const p = point(e);
      draft = { type: tool, color, size, start: p, end: p, points: [p] };
      redraw();
    });
    canvas.addEventListener('pointermove', e => {
      if (!draft) return;
      const p = point(e);
      if (tool === 'pen') draft.points.push(p);
      else draft.end = p;
      redraw();
    });
    const finish = () => {
      if (!draft) return;
      if (tool === 'pen' ? draft.points.length > 1 : (Math.abs(draft.end.x - draft.start.x) + Math.abs(draft.end.y - draft.start.y) > 2)) ops.push(draft);
      draft = null;
      redraw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    redraw();
    $('mark-save').onclick = async () => {
      const btn = $('mark-save');
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        await API().addImageFromDataURL(canvas.toDataURL('image/png'), '标记图 · ' + media.label, null, 'mark');
        editor.close();
      } catch (e) {
        toast('保存标记图失败：' + e.message, true);
        btn.disabled = false;
        btn.textContent = '保存标记图';
      }
    };
  }

  // ---------- 局部重绘 ----------
  async function openInpaint(context) {
    const existingInpaint = document.getElementById('inpaint-editor');
    if (existingInpaint) existingInpaint.remove();
    const media = API() && await API().selectedMediaInfoFull();
    if (!media) { toast('请先选中一张图片或变体卡', true); return; }
    let image;
    try { image = await loadImage(media.dataURL); } catch (e) { toast(e.message, true); return; }
    const engineOptions = Object.keys(P().PROVIDERS).filter(id => {
      const cfg = P().loadConfigs()[id];
      if (!cfg || !cfg.apiKey) return false;
      if (P().PROVIDERS[id] && P().PROVIDERS[id].image === false) return false;
      const model = cfg.model || (P().PROVIDERS[id] && P().PROVIDERS[id].model);
      return P().inpaintRouteFor(id, model) !== 'unsupported';
    }).map(id => '<option value="' + esc(id) + '">' + esc(P().PROVIDERS[id].label) + '</option>').join('');
    const editor = makeEditor('局部重绘', media,
      '<button data-t="rect" class="on">框选</button><button data-t="lasso">圈选</button><button data-t="wand">魔术棒</button>' +
      '<label id="inp-tol-wrap" style="font-size:10.5px;color:var(--faint);display:none;align-items:center;gap:5px">容差 <input id="inp-tol" type="range" min="0" max="100" value="26" style="width:86px"></label>' +
      '<button id="inp-undo">撤销</button><button id="inp-invert">反选</button><button id="inp-clear">清空</button>',
      '<input id="inp-prompt" type="text" placeholder="只写要改的内容，例如：把沙发换成深棕色皮质沙发">' +
      '<select id="inp-engine" class="studio-btn">' + (engineOptions || '<option value="">未配置引擎</option>') + '</select>' +
      '<button id="inp-model-btn" class="studio-btn" type="button" style="width:190px;display:flex;align-items:center;justify-content:space-between;gap:6px"><span id="inp-model-label">选择模型</span><span aria-hidden="true">▴</span></button>' +
      '<input id="inp-model" type="hidden">' +
      '<span id="inp-route-note" style="font-size:10.5px;color:var(--faint);white-space:nowrap"></span>' +
      '<label style="font-size:10.5px;color:var(--faint);display:flex;align-items:center;gap:5px;white-space:nowrap">边缘 <input id="inp-feather" type="range" min="0" max="48" value="5" style="width:70px"><span id="inp-feather-val">5</span></label>' +
      '<button class="studio-btn primary" id="inp-go">生成</button>');
    editor.mask.id = 'inpaint-editor';
    const pendingFromNodeId = context && context.toolNodeId ? context.toolNodeId : '';
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    editor.stage.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    const tintCanvas = document.createElement('canvas');
    tintCanvas.width = canvas.width;
    tintCanvas.height = canvas.height;
    const tintCtx = tintCanvas.getContext('2d');
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = canvas.width;
    baseCanvas.height = canvas.height;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
    baseCtx.drawImage(image, 0, 0);
    let tool = 'rect';
    let ops = [];
    let wandMasks = [];
    let draft = null;
    let inverted = false;
    let hasMask = false;
    const point = e => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
    };
    const renderMask = () => {
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.fillStyle = '#fff';
      maskCtx.strokeStyle = '#fff';
      ops.forEach(op => {
        maskCtx.beginPath();
        if (op.type === 'rect') {
          maskCtx.rect(op.start.x, op.start.y, op.end.x - op.start.x, op.end.y - op.start.y);
        } else {
          if (!op.points.length) return;
          maskCtx.moveTo(op.points[0].x, op.points[0].y);
          for (let i = 1; i < op.points.length; i++) maskCtx.lineTo(op.points[i].x, op.points[i].y);
          maskCtx.closePath();
        }
        maskCtx.fill();
      });
      wandMasks.forEach(m => maskCtx.drawImage(m, 0, 0));
      if (inverted) {
        const data = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        for (let i = 0; i < data.data.length; i += 4) {
          const selected = data.data[i + 3] > 127;
          data.data[i] = 255;
          data.data[i + 1] = 255;
          data.data[i + 2] = 255;
          data.data[i + 3] = selected ? 0 : 255;
        }
        maskCtx.putImageData(data, 0, 0);
      }
      hasMask = ops.length > 0 || wandMasks.length > 0;
    };
    const render = () => {
      renderMask();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(baseCanvas, 0, 0);
      if (hasMask) {
        tintCtx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
        tintCtx.drawImage(maskCanvas, 0, 0);
        tintCtx.globalCompositeOperation = 'source-in';
        tintCtx.fillStyle = '#ff3b30';
        tintCtx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);
        tintCtx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.48;
        ctx.drawImage(tintCanvas, 0, 0);
        ctx.globalAlpha = 1;
      }
      if (draft) {
        ctx.save();
        ctx.strokeStyle = '#ff3b30';
        ctx.fillStyle = 'rgba(255,59,48,.28)';
        ctx.lineWidth = Math.max(2, canvas.width / 600);
        ctx.beginPath();
        if (draft.type === 'rect') {
          ctx.rect(draft.start.x, draft.start.y, draft.end.x - draft.start.x, draft.end.y - draft.start.y);
        } else if (draft.points && draft.points.length) {
          ctx.moveTo(draft.points[0].x, draft.points[0].y);
          for (let i = 1; i < draft.points.length; i++) ctx.lineTo(draft.points[i].x, draft.points[i].y);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    };
    const exportMask = () => {
      const apiMask = document.createElement('canvas');
      apiMask.width = maskCanvas.width;
      apiMask.height = maskCanvas.height;
      const c = apiMask.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, apiMask.width, apiMask.height);
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(maskCanvas, 0, 0);
      c.globalCompositeOperation = 'source-over';
      return apiMask.toDataURL('image/png');
    };
    function magicWand(seed, tolerance) {
      const w = baseCanvas.width, h = baseCanvas.height;
      if (seed.x < 0 || seed.y < 0 || seed.x >= w || seed.y >= h) return;
      const src = baseCtx.getImageData(0, 0, w, h).data;
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const outCtx = out.getContext('2d');
      const result = outCtx.createImageData(w, h);
      const start = (Math.floor(seed.y) * w + Math.floor(seed.x)) * 4;
      const tr = src[start], tg = src[start + 1], tb = src[start + 2];
      const tol = Math.pow(tolerance / 100 * 120, 2) * 3;
      const seen = new Uint8Array(w * h);
      const stack = new Int32Array(w * h);
      let sp = 0;
      const first = Math.floor(seed.y) * w + Math.floor(seed.x);
      stack[sp++] = first;
      seen[first] = 1;
      while (sp) {
        const idx = stack[--sp];
        const o = idx * 4;
        const dr = src[o] - tr, dg = src[o + 1] - tg, db = src[o + 2] - tb;
        if (dr * dr + dg * dg + db * db > tol) continue;
        result.data[o] = 255; result.data[o + 1] = 255; result.data[o + 2] = 255; result.data[o + 3] = 255;
        const x = idx % w, y = (idx / w) | 0;
        const add = next => {
          if (seen[next]) return;
          seen[next] = 1;
          stack[sp++] = next;
        };
        if (x > 0) add(idx - 1);
        if (x + 1 < w) add(idx + 1);
        if (y > 0) add(idx - w);
        if (y + 1 < h) add(idx + w);
      }
      outCtx.putImageData(result, 0, 0);
      wandMasks.push(out);
      render();
    }
    editor.mask.querySelectorAll('[data-t]').forEach(btn => {
      btn.onclick = () => {
        tool = btn.dataset.t;
        $('inp-tol-wrap').style.display = tool === 'wand' ? 'flex' : 'none';
        editor.mask.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === btn));
      };
    });
    $('inp-undo').onclick = () => {
      if (wandMasks.length) wandMasks.pop();
      else ops.pop();
      render();
    };
    $('inp-clear').onclick = () => { ops = []; wandMasks = []; inverted = false; draft = null; render(); };
    $('inp-invert').onclick = () => { inverted = !inverted; render(); };
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = point(e);
      if (tool === 'wand') { magicWand(p, +$('inp-tol').value); return; }
      canvas.setPointerCapture(e.pointerId);
      draft = { type: tool, start: p, end: p, points: [p] };
      render();
    });
    canvas.addEventListener('pointermove', e => {
      if (!draft) return;
      const p = point(e);
      draft.end = p;
      if (tool === 'lasso') draft.points.push(p);
      render();
    });
    const finish = () => {
      if (!draft) return;
      const moved = Math.abs(draft.end.x - draft.start.x) + Math.abs(draft.end.y - draft.start.y) > 2 || draft.points.length > 2;
      if (moved) ops.push(draft);
      draft = null;
      render();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    const engineSel = $('inp-engine');
    const routeNote = $('inp-route-note');
    const updateRouteNote = () => {
      const id = engineSel.value;
      const model = $('inp-model').value.trim();
      const route = id ? P().inpaintRouteFor(id, model) : 'unsupported';
      routeNote.textContent = route === 'mask'
        ? '原生遮罩'
        : route === 'reference'
          ? '参考图编辑 · 自动回贴'
          : '不支持局部重绘';
      routeNote.style.color = route === 'unsupported' ? 'var(--danger)' : 'var(--faint)';
    };
    const fillModel = () => {
      const id = engineSel.value;
      const cfg = id ? (P().loadConfigs()[id] || {}) : {};
      let synced = [];
      try { synced = JSON.parse(localStorage.getItem('gw_models_' + id) || '[]'); } catch (e) {}
      const candidates = Array.from(new Set([
        cfg.model,
        ...(Array.isArray(synced) ? synced : []),
        ...((P().BUILTIN_MODELS && P().BUILTIN_MODELS[id]) || []),
        id && P().PROVIDERS[id] ? P().PROVIDERS[id].model : ''
      ].filter(Boolean)));
      const usable = candidates.filter(model => P().inpaintRouteFor(id, model) !== 'unsupported');
      const select = $('inp-model');
      select.innerHTML = usable.length
        ? usable.map(model => {
            const route = P().inpaintRouteFor(id, model);
            const label = (P().aliasOf ? P().aliasOf(model) : model) + (route === 'mask' ? ' · 原生遮罩' : ' · 参考图编辑');
            return '<option value="' + esc(model) + '">' + esc(label) + '</option>';
          }).join('')
        : '<option value="">暂无可用模型</option>';
      select.disabled = !usable.length;
      updateRouteNote();
    };
    let modelChoices = [];
    let modelMenuEl = null;
    let modelMenuDocHandler = null;
    let modelMenuKeyHandler = null;
    const closeModelMenu = () => {
      if (modelMenuEl) modelMenuEl.remove();
      modelMenuEl = null;
      if (modelMenuDocHandler) document.removeEventListener('mousedown', modelMenuDocHandler);
      if (modelMenuKeyHandler) document.removeEventListener('keydown', modelMenuKeyHandler);
      modelMenuDocHandler = null;
      modelMenuKeyHandler = null;
      $('inp-model-btn').setAttribute('aria-expanded', 'false');
    };
    const chooseModel = choice => {
      if (!choice) return;
      $('inp-model').value = choice.model;
      $('inp-model-label').textContent = choice.alias;
      updateRouteNote();
      closeModelMenu();
    };
    const openModelMenu = () => {
      closeModelMenu();
      if (!modelChoices.length) return;
      const button = $('inp-model-btn');
      const rect = button.getBoundingClientRect();
      const menu = document.createElement('div');
      menu.id = 'inp-model-menu';
      menu.style.cssText = 'position:fixed;z-index:100030;width:280px;max-height:280px;overflow:auto;padding:6px;border:1px solid var(--line);border-radius:10px;background:var(--panel);box-shadow:var(--shadow-2)';
      menu.innerHTML = '<div style="padding:6px 8px 4px;color:var(--faint);font-size:10.5px;font-weight:700">选择局部重绘模型</div>' +
        modelChoices.map((choice, index) =>
          '<button type="button" data-model-index="' + index + '" style="width:100%;display:block;text-align:left;border:0;border-radius:8px;background:transparent;padding:7px 8px;cursor:pointer;color:var(--text)">' +
            '<span style="display:block;font-size:11px;font-weight:700">' + esc(choice.alias) + '</span>' +
            '<span style="display:block;margin-top:2px;font-size:10.5px;color:var(--faint)">' + esc(choice.engineLabel) + ' · ' + (choice.route === 'mask' ? '原生遮罩' : '参考图编辑') + '</span>' +
          '</button>').join('');
      document.body.appendChild(menu);
      menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 288)) + 'px';
      const menuHeight = menu.offsetHeight;
      menu.style.top = rect.top > menuHeight + 12
        ? (rect.top - menuHeight - 6) + 'px'
        : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6) + 'px';
      menu.querySelectorAll('[data-model-index]').forEach(item => {
        item.onmouseenter = () => { item.style.background = 'var(--raised)'; };
        item.onmouseleave = () => { item.style.background = 'transparent'; };
        item.onclick = () => chooseModel(modelChoices[+item.dataset.modelIndex]);
      });
      modelMenuEl = menu;
      button.setAttribute('aria-expanded', 'true');
      modelMenuDocHandler = event => {
        if (menu.contains(event.target) || button.contains(event.target)) return;
        closeModelMenu();
      };
      modelMenuKeyHandler = event => {
        if (event.key === 'Escape') closeModelMenu();
      };
      setTimeout(() => document.addEventListener('mousedown', modelMenuDocHandler), 0);
      document.addEventListener('keydown', modelMenuKeyHandler);
    };
    const fillModelMenu = () => {
      const id = engineSel.value;
      const cfg = id ? (P().loadConfigs()[id] || {}) : {};
      let synced = [];
      try { synced = JSON.parse(localStorage.getItem('gw_models_' + id) || '[]'); } catch (e) {}
      const candidates = Array.from(new Set([
        cfg.model,
        ...(Array.isArray(synced) ? synced : []),
        ...((P().BUILTIN_MODELS && P().BUILTIN_MODELS[id]) || []),
        id && P().PROVIDERS[id] ? P().PROVIDERS[id].model : ''
      ].filter(Boolean)));
      modelChoices = candidates
        .filter(model => P().inpaintRouteFor(id, model) !== 'unsupported')
        .map(model => ({
          engineId: id,
          engineLabel: P().PROVIDERS[id] ? P().PROVIDERS[id].label : id,
          model,
          alias: P().aliasOf ? P().aliasOf(model) : model,
          route: P().inpaintRouteFor(id, model)
        }));
      $('inp-model-btn').disabled = !modelChoices.length;
      chooseModel(modelChoices[0] || null);
      if (!modelChoices.length) {
        $('inp-model').value = '';
        $('inp-model-label').textContent = '暂无可用模型';
        updateRouteNote();
      }
    };
    engineSel.onchange = fillModelMenu;
    $('inp-model-btn').setAttribute('aria-expanded', 'false');
    $('inp-model-btn').onclick = openModelMenu;
    $('inp-feather').addEventListener('input', () => {
      $('inp-feather-val').textContent = $('inp-feather').value;
    });
    fillModelMenu();
    const buildInpaintOverlay = () => {
      const overlay = document.createElement('canvas');
      overlay.width = baseCanvas.width;
      overlay.height = baseCanvas.height;
      const overlayCtx = overlay.getContext('2d');
      overlayCtx.drawImage(baseCanvas, 0, 0);
      const region = document.createElement('canvas');
      region.width = maskCanvas.width;
      region.height = maskCanvas.height;
      const regionCtx = region.getContext('2d');
      regionCtx.drawImage(maskCanvas, 0, 0);
      regionCtx.globalCompositeOperation = 'source-in';
      regionCtx.fillStyle = '#ff3b30';
      regionCtx.fillRect(0, 0, region.width, region.height);
      regionCtx.globalCompositeOperation = 'source-over';
      overlayCtx.globalAlpha = 0.42;
      overlayCtx.drawImage(region, 0, 0);
      overlayCtx.globalAlpha = 1;
      return overlay.toDataURL('image/png');
    };
    $('inp-go').onclick = async () => {
      renderMask();
      if (!hasMask) { toast('请先框选、圈选或用魔术棒选择要重绘的区域', true); return; }
      const prompt = $('inp-prompt').value.trim();
      if (!prompt) { toast('请填写要修改成什么', true); return; }
      const btn = $('inp-go');
      btn.disabled = true;
      btn.textContent = '重绘中…';
      try {
        const engineId = engineSel.value;
        const model = $('inp-model').value.trim();
        const route = P().inpaintRouteFor(engineId, model);
        if (route === 'unsupported') throw new Error('当前模型不支持局部重绘，请换用 GPT Image、NanoBanana 或豆包 Seedream');
        await API().runMaskedEdit({
          prompt,
          maskDataURL: exportMask(),
          maskOverlayDataURL: route === 'reference' ? buildInpaintOverlay() : '',
          inpaintRoute: route,
          feather: +$('inp-feather').value || 0,
          pendingFromNodeId,
          engineId,
          model
        });
        editor.close();
      } catch (e) {
        toast('局部重绘失败：' + e.message, true);
        btn.disabled = false;
        btn.textContent = '生成';
      }
    };
    render();
  }

  // ---------- 360° 全景 ----------
  async function openPanoramaLegacy() {
    const media = API() && await API().selectedMediaInfoFull();
    if (!media) { toast('请先选中一张全景图片', true); return; }
    let image;
    try { image = await loadImage(media.dataURL); } catch (e) { toast(e.message, true); return; }
    const ratio = image.naturalWidth / image.naturalHeight;
    const editor = makeEditor('360° VR 全景预览', media,
      '<span style="font-size:10.5px;color:var(--faint);flex:1">拖拽环视 · 滚轮缩放' + (Math.abs(ratio - 2) > 0.2 ? ' · 提示：这张图不是标准 2:1 全景比例' : '') + '</span><button id="vr-reset">回到正面</button>',
      '<span style="font-size:10.5px;color:var(--faint)">等距柱状投影预览，不会修改原图。</span>');
    const canvas = document.createElement('canvas');
    editor.stage.appendChild(canvas);
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false });
    if (!gl) { toast('当前显卡不支持 WebGL 全景预览', true); editor.close(); return; }
    const vs = 'attribute vec2 p; varying vec2 v; void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    const fs = `precision highp float; varying vec2 v; uniform sampler2D tex; uniform vec2 res; uniform float yaw; uniform float pitch; uniform float fov;
      const float PI=3.141592653589793;
      void main(){
        vec2 p=v*2.-1.; p.x*=res.x/res.y;
        vec3 d=normalize(vec3(p.x*tan(fov*.5),p.y*tan(fov*.5),-1.));
        float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
        d=vec3(cy*d.x+sy*d.z,d.y,-sy*d.x+cy*d.z);
        d=vec3(d.x,cp*d.y-sp*d.z,sp*d.y+cp*d.z);
        float lon=atan(d.x,-d.z),lat=asin(clamp(d.y,-1.,1.));
        vec2 uv=vec2(lon/(2.*PI)+.5,.5-lat/PI);
        gl_FragColor=texture2D(tex,uv);
      }`;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    let program;
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    } catch (e) {
      toast('全景渲染器初始化失败：' + e.message, true);
      editor.close();
      return;
    }
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    let yaw = 0, pitch = 0, fov = 1.2, dragging = false, lx = 0, ly = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(320, editor.stage.clientWidth);
      const h = Math.max(240, editor.stage.clientHeight);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    };
    const draw = () => {
      gl.uniform1i(gl.getUniformLocation(program, 'tex'), 0);
      gl.uniform2f(gl.getUniformLocation(program, 'res'), canvas.width, canvas.height);
      gl.uniform1f(gl.getUniformLocation(program, 'yaw'), yaw);
      gl.uniform1f(gl.getUniformLocation(program, 'pitch'), pitch);
      gl.uniform1f(gl.getUniformLocation(program, 'fov'), fov);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    canvas.addEventListener('pointerdown', e => {
      dragging = true; lx = e.clientX; ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      yaw += (e.clientX - lx) * 0.006;
      pitch = Math.max(-1.35, Math.min(1.35, pitch + (e.clientY - ly) * 0.006));
      lx = e.clientX; ly = e.clientY;
      draw();
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      fov = Math.max(0.45, Math.min(2.1, fov + (e.deltaY > 0 ? 0.08 : -0.08)));
      draw();
    }, { passive: false });
    $('vr-reset').onclick = () => { yaw = 0; pitch = 0; fov = 1.2; draw(); };
    requestAnimationFrame(resize);
  }

  async function openPanorama() {
    const media = API() && await API().selectedMediaInfoFull();
    if (!media) { toast('请先选中一张全景图片', true); return; }
    let image;
    try { image = await loadImage(media.dataURL); } catch (e) { toast(e.message, true); return; }
    if (!Marzipano || !Marzipano.Viewer) {
      toast('全景查看器未正确加载', true);
      return;
    }
    const ratio = image.naturalWidth / image.naturalHeight;
    const editor = makeEditor(
      '360° 全景预览',
      media,
      '<span style="font-size:10.5px;color:var(--faint);flex:1">平滑拖拽环视 · 滚轮/双指缩放' +
        (Math.abs(ratio - 2) > 0.2 ? ' · 提示：这张图不是标准 2:1 全景比例' : '') +
      '</span><button id="vr-reset">回到正面</button>',
      '<span style="font-size:10.5px;color:var(--faint)">Marzipano 球面查看器 · 不会修改原图</span>'
    );
    editor.stage.innerHTML = '';
    editor.stage.style.background = '#101214';
    let viewer = null;
    try {
      viewer = new Marzipano.Viewer(editor.stage, {
        controls: { mouseViewMode: 'drag', dragMode: 'pan' },
        stage: { antialias: true }
      });
      const source = Marzipano.ImageUrlSource.fromString(media.dataURL);
      const geometry = new Marzipano.EquirectGeometry([{ width: image.naturalWidth }]);
      const baseLimiter = Marzipano.RectilinearView.limit.traditional(4096, 88 * Math.PI / 180);
      const pitchLimit = 78 * Math.PI / 180;
      const limiter = params => {
        const next = baseLimiter(params) || Object.assign({}, params);
        next.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, next.pitch));
        return next;
      };
      const view = new Marzipano.RectilinearView(
        { yaw: 0, pitch: 0, fov: 72 * Math.PI / 180 },
        limiter
      );
      const scene = viewer.createScene({ source, geometry, view, pinFirstLevel: true });
      scene.switchTo({ transitionDuration: 0 });
      $('vr-reset').onclick = () => {
        view.setParameters({ yaw: 0, pitch: 0, fov: 72 * Math.PI / 180 });
      };
    } catch (error) {
      if (viewer) { try { viewer.destroy(); } catch (destroyError) {} }
      toast('全景查看器初始化失败：' + (error.message || error), true);
      editor.close();
      return;
    }
    const closeEditor = editor.close;
    editor.close = () => {
      if (viewer) { try { viewer.destroy(); } catch (error) {} }
      viewer = null;
      closeEditor();
    };
  }

  // ---------- 对话 / 反推提示词 ----------
  function configuredEngines() {
    const P0 = P();
    const cfgs = P0.loadConfigs();
    return Object.keys(P0.PROVIDERS).filter(id => cfgs[id] && cfgs[id].apiKey);
  }
  function engineModel(engineId) {
    const cfg = P().loadConfigs()[engineId] || {};
    return cfg.model || (P().PROVIDERS[engineId] && P().PROVIDERS[engineId].model) || '';
  }
  let chatHistory = [];
  async function openChat() {
    const engines = configuredEngines();
    if (!engines.length) { toast('请先在 设置 → 引擎 配置至少一个 API Key', true); return; }
    const media = await API().selectedMediaInfoFull();
    const mask = document.createElement('div');
    mask.className = 'studio-editor-mask';
    mask.innerHTML = `<div class="studio-editor" style="width:min(520px,94vw);height:min(780px,92vh)">
      <div class="studio-editor-head"><b>极物对话</b><span style="font-size:10.5px;color:var(--faint)">${media ? '已附当前选中图片' : '未附图'}</span><button class="studio-btn close-icon-btn" data-close title="关闭" aria-label="关闭">×</button></div>
      <div class="studio-editor-tools">
        <select id="chat-engine" class="studio-btn">${engines.map(id => '<option value="' + esc(id) + '">' + esc(P().PROVIDERS[id].label) + '</option>').join('')}</select>
        <input id="chat-model" type="text" placeholder="模型 ID" style="flex:1;height:28px;background:var(--raised);border:1px solid var(--line);border-radius:7px;padding:0 8px;color:var(--text);font-size:11px">
      </div>
      <div class="studio-chat-list" id="chat-list"></div>
      <div class="studio-chat-input"><textarea id="chat-text" placeholder="输入设计问题，Enter 发送，Shift+Enter 换行"></textarea><button class="studio-btn primary" id="chat-send">发送</button></div>
    </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.querySelector('[data-close]').onclick = close;
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
    const engineSel = $('chat-engine');
    const modelInput = $('chat-model');
    const fill = () => { modelInput.value = engineModel(engineSel.value); };
    engineSel.onchange = fill; fill();
    const list = $('chat-list');
    const add = (role, text, type) => {
      const el = document.createElement('div');
      el.className = 'studio-msg ' + role + (type ? ' ' + type : '');
      el.textContent = text;
      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
      return el;
    };
    if (media) add('bot', '已带上当前选中的「' + media.label + '」。你可以直接问空间、材质、灯光、构图或改图建议。');
    chatHistory.forEach(m => add(m.role === 'assistant' ? 'bot' : 'user', m.uiText || m.content));
    const send = async () => {
      const text = $('chat-text').value.trim();
      if (!text) return;
      const btn = $('chat-send');
      btn.disabled = true;
      $('chat-text').value = '';
      add('user', text);
      const engineId = engineSel.value;
      const model = modelInput.value.trim() || engineModel(engineId);
      const useImage = media && !chatHistory.some(m => m.imageAttached);
      const apiMessages = [{ role: 'system', content: '你是极物 GIWIN Studio 的室内设计助理。回答简洁、具体，优先给可直接执行的改图或建模建议。' }];
      chatHistory.forEach(m => {
        if (m.role === 'user' && m.imageAttached) {
          apiMessages.push({ role: 'user', content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: m.imageDataURL || media.dataURL } }
          ] });
        } else if (m.role === 'user' || m.role === 'assistant') {
          apiMessages.push({ role: m.role, content: m.content });
        }
      });
      if (useImage) {
        apiMessages.push({ role: 'user', content: [
          { type: 'text', text: text },
          { type: 'image_url', image_url: { url: media.dataURL } }
        ] });
      } else {
        apiMessages.push({ role: 'user', content: text });
      }
      const typing = add('bot', '思考中…', 'typing');
      try {
        const answer = await P().chat(engineId, { model, messages: apiMessages });
        typing.remove();
        add('bot', answer);
        if (media) API().addTextResultNode(answer, '对话结果', media.id, 'chat');
        chatHistory.push({ role: 'user', content: text, uiText: text, imageAttached: !!useImage, imageDataURL: useImage ? media.dataURL : null });
        chatHistory.push({ role: 'assistant', content: answer, uiText: answer });
      } catch (e) {
        typing.remove();
        add('bot', '请求失败：' + e.message);
      } finally {
        btn.disabled = false;
      }
    };
    $('chat-send').onclick = send;
    $('chat-text').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  async function reversePrompt() {
    const media = API() && await API().selectedMediaInfoFull();
    if (!media) { toast('请先选中一张图片', true); return; }
    const vision = API() && API().getVisionConfig ? API().getVisionConfig() : null;
    if (!vision) {
      toast('请先在 设置 → 引擎 配置阿波罗、OpenAI 或 DeepSeek 的视觉模型与 API Key', true);
      return;
    }
    const engineId = vision.engineId;
    const model = vision.model;
    const mask = document.createElement('div');
    mask.className = 'studio-editor-mask';
    mask.innerHTML = `<div class="studio-editor" style="width:min(720px,94vw);height:min(600px,90vh)">
      <div class="studio-editor-head"><b>反推提示词</b><span style="font-size:10.5px;color:var(--faint)">${esc(P().PROVIDERS[engineId].label + ' / ' + (P().aliasOf(model) || model))}</span><button class="studio-btn close-icon-btn" data-close title="关闭" aria-label="关闭">×</button></div>
      <div class="studio-editor-stage" style="align-items:stretch"><textarea id="rev-out" style="width:100%;height:100%;resize:none;background:var(--raised);border:none;padding:16px;color:var(--text);font-size:13px;line-height:22px;outline:none" placeholder="正在分析图片…"></textarea></div>
      <div class="studio-editor-foot"><span style="font-size:10.5px;color:var(--faint);flex:1">结果可直接用于文生图或作为改图提示词。</span><button class="studio-btn" id="rev-copy">复制</button><button class="studio-btn primary" id="rev-again">重新分析</button></div>
    </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.querySelector('[data-close]').onclick = close;
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
    const out = $('rev-out');
    const run = async () => {
      out.value = '正在分析图片…';
      try {
        const text = await P().chat(engineId, {
          model,
          messages: [
            { role: 'system', content: '你是资深室内设计视觉分析师。' },
            { role: 'user', content: [
              { type: 'text', text: '请分析这张室内效果图，输出一段可直接用于生图的中文提示词。必须包含空间类型、风格、布局、主要材质、家具、色彩、光影、镜头视角，不要解释，不要 Markdown。' },
              { type: 'image_url', image_url: { url: media.dataURL } }
            ] }
          ]
        });
        out.value = text;
        API().addTextResultNode(text, '反推提示词', media.id, 'reverse');
      } catch (e) {
        out.value = '分析失败：' + e.message;
      }
    };
    $('rev-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(out.value); toast('提示词已复制'); }
      catch (e) { toast('复制失败，请手动选择文本', true); }
    };
    $('rev-again').onclick = run;
    run();
  }

  function openTool(kind, context) {
    if (kind === 'mark') return openMarkup();
    if (kind === 'inpaint') return openInpaint(context);
    if (kind === 'panorama') return openPanorama();
    if (kind === 'reverse') return reversePrompt();
    if (kind === 'chat') return openChat();
    if (kind === 'seedvr') return window.GWCanvas && window.GWCanvas.openHdUpscale ? window.GWCanvas.openHdUpscale() : toast('高清放大模块未加载', true);
    toast('这个工作台节点类型暂不支持打开', true);
  }

  buildToolLibrary();
  applyWorkflowGate(workflowAssetsDisabled());
  window.GWStudio = { open: openPanel, close: closePanel, saveCurrentWorkflow, saveCurrentAsset, saveSelectedImagesAsset, createToolAt, openTool, openMarkup, openInpaint, openPanorama, openChat, reversePrompt };
})();
