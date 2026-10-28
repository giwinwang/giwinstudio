(function () {
  const ICONS = {
    assets: '<path d="M4 7h16v13H4z"/><path d="M3 3h18v4H3z"/><path d="M9 12h6"/>',
    import: '<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 17v3h16v-3"/>',
    arrange: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M6 9v3h12V9M12 12v3"/>',
    versions: '<path d="M4 5v5h5"/><path d="M5 10a8 8 0 1 1 1.8 8.3"/><path d="M12 8v5l3 2"/>',
    fit: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M20 15v5h-5"/>',
    inpaint: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" stroke-dasharray="2.4 2.4"/><path d="m9 15 5-5 2 2-5 5H9z"/>',
    mark: '<path d="M4 19c3.5.2 3.6-9.5 7.5-9.5 3 0 2.4 6.6 5.5 6.6 1.2 0 2-.8 2.5-2"/><circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/>',
    continueMark: '<path d="M4 20l4-1 9-9-3-3-9 9z"/><path d="m13 7 3 3"/><path d="M19 4v6M16 7h6"/>',
    reverse: '<rect x="3" y="4" width="13" height="13" rx="2"/><path d="M7 9h5M7 12h4"/><circle cx="17" cy="16" r="3"/><path d="m19.2 18.2 2.3 2.3"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><circle cx="9" cy="10.5" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r=".8" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r=".8" fill="currentColor" stroke="none"/>',
    upscale: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 15 15 9M10 9h5v5"/>',
    removebg: '<rect x="4" y="4" width="7" height="7" fill="currentColor" fill-opacity=".12"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7" fill="currentColor" fill-opacity=".12"/><path d="m8 18 3-4 2 2 3-5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    panorama: '<circle cx="12" cy="12" r="8"/><path d="M4 12c2.8-2.7 13.2-2.7 16 0M4 12c2.8 2.7 13.2 2.7 16 0M12 4c-2.5 4.8-2.5 11.2 0 16M12 4c2.5 4.8 2.5 11.2 0 16"/>',
    compare: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M8 12h-3m0 0 1.6-1.6M5 12l1.6 1.6M16 12h3m0 0-1.6-1.6M19 12l-1.6 1.6"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    // 档位徽记：同一母题「叠摞的张」，摞数 = 档位，呼应出图额度按张计。
    // fill 用 --panel 让上层遮住下层叠边；绘制顺序由远及近（左上→右下）。
    planTrial: '<rect x="7.5" y="8.5" width="9" height="7" rx="1.4" fill="var(--panel)"/>',
    planSolo: '<rect x="9.3" y="6.7" width="9" height="7" rx="1.4" fill="var(--panel)"/><rect x="5.7" y="10.3" width="9" height="7" rx="1.4" fill="var(--panel)"/>',
    planPro: '<rect x="11.1" y="4.9" width="9" height="7" rx="1.4" fill="var(--panel)"/><rect x="7.5" y="8.5" width="9" height="7" rx="1.4" fill="var(--panel)"/><rect x="3.9" y="12.1" width="9" height="7" rx="1.4" fill="var(--panel)"/>',
    planStudio: '<rect x="12.9" y="3.1" width="9" height="7" rx="1.4" fill="var(--panel)"/><rect x="9.3" y="6.7" width="9" height="7" rx="1.4" fill="var(--panel)"/><rect x="5.7" y="10.3" width="9" height="7" rx="1.4" fill="var(--panel)"/><rect x="2.1" y="13.9" width="9" height="7" rx="1.4" fill="var(--panel)"/>',
    more: '<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    generate: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
    material: '<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="6" rx="2"/><rect x="13" y="13" width="8" height="6" rx="2"/><path d="M6 9h2"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16M10 11h11"/>',
    soft: '<path d="M5 12V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 12h18v6H3z"/><path d="M6 18v2M18 18v2"/>',
    note: '<path d="M5 3h11l4 4v14H5z"/><path d="M16 3v5h5M8 12h8M8 16h6"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9 6.3 6.3M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M20 15.3A8.5 8.5 0 0 1 8.7 4a8.5 8.5 0 1 0 11.3 11.3z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 18 5-5 3 3 2-2 6 5"/>',
    workflow: '<rect x="3" y="4" width="6" height="6" rx="1"/><rect x="15" y="14" width="6" height="6" rx="1"/><path d="M9 7h3v10h3M13 7h5"/>',
    edit: '<path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m14 6 3 3"/>',
    export: '<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v4h16v-4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
    external: '<path d="M13 4h7v7"/><path d="m20 4-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/>',
    paste: '<rect x="7" y="4" width="10" height="16" rx="2"/><path d="M9 4.5V3h6v1.5"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
    eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8"/><path d="M6.1 6.1C3.5 8 2 12 2 12s3.5 6 10 6c1 0 1.9-.1 2.8-.4"/>',
    flipH: '<path d="M12 3v18M4 7l5 5-5 5zM20 7l-5 5 5 5z"/>',
    flipV: '<path d="M3 12h18M7 4l5 5 5-5zM7 20l5-5 5 5z"/>',
    rotateLeft: '<path d="M4 7v5h5"/><path d="M5 12a8 8 0 1 1 2 5.3"/>',
    rotateRight: '<path d="M20 7v5h-5"/><path d="M19 12a8 8 0 1 0-2 5.3"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    // 自描边图标：path 自带 fill/stroke 属性，脱离容器 CSS 也能正确渲染（属性可被容器规则覆盖）
    close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>',
    chevronDown: '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>',
    grid: '<rect x="4.7" y="4.7" width="14.6" height="14.6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.65"/><path d="M4.7 12h14.6M12 4.7v14.6" fill="none" stroke="currentColor" stroke-width="1.65"/>',
    unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    rename: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m14 6 4 4M3 21h18"/>',
    top: '<path d="M4 3h16M6 10l6-6 6 6M12 4v16"/>',
    up: '<path d="M12 20V5m0 0-6 6m6-6 6 6"/>',
    down: '<path d="M12 4v15m0 0-6-6m6 6 6-6"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
    linkOff: '<path d="m3 3 18 18"/><path d="M10.5 13.5a5 5 0 0 0 6.8.1l2-2a5 5 0 0 0-5.4-8.1"/><path d="M13.5 10.5a5 5 0 0 0-6.8-.1l-2 2a5 5 0 0 0 5.4 8.1"/>',
    sliders: '<path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h9M17 18h3"/><circle cx="13" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
    swap: '<path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    douyin: '<path fill="currentColor" stroke="none" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>',
    wechat: '<path fill="currentColor" stroke="none" d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/>',
    bilibili: '<path fill="currentColor" stroke="none" d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"/>',
    xiaohongshu: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h8v8H8z"/>',
    xiaohongshuBook: '<rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="currentColor" fill-opacity=".1" stroke="none"/><text x="12" y="19.2" text-anchor="middle" font-family="Microsoft YaHei,PingFang SC,sans-serif" font-size="22" font-weight="700" fill="currentColor" stroke="none">书</text>'
  };
  ICONS.text2img = ICONS.generate;

  const ACT_ICONS = {
    inpaint: 'inpaint', mark: 'mark', 'continue-mark': 'continueMark', reverse: 'reverse', hd: 'upscale',
    removebg: 'removebg', layers: 'layers', panorama: 'panorama',
    compare: 'compare', star: 'star', gen: 'generate', generate: 'generate',
    material: 'material', layout: 'layout', soft: 'soft', note: 'note',
    light: 'light', more: 'more', settings: 'settings', swap: 'swap'
  };
  const RAIL_ICONS = {
    'drawer-left': 'assets', import: 'import', arrange: 'arrange',
    versions: 'versions', fit: 'fit'
  };
  const MENU_ICONS = {
    edit: 'edit', export: 'export', delete: 'trash', copy: 'copy',
    hint: 'info', workflow: 'workflow', expand: 'fit', compare: 'compare',
    image: 'image', generator: 'generate', material: 'material',
    layout: 'layout', soft: 'soft', inpaint: 'inpaint', mark: 'mark',
    'continue-mark': 'continueMark',
    reverse: 'reverse', panorama: 'panorama', chat: 'chat',
    'upscale-local': 'upscale', upscale: 'upscale', 'online-upscale': 'upscale',
    anchor: 'star', refresh: 'refresh', retry: 'refresh', more: 'more', settings: 'settings',
    fliph: 'flipH', flipv: 'flipV', rotl: 'rotateLeft', rotr: 'rotateRight',
    lock: 'lock', rename: 'rename', top: 'top', up: 'up', down: 'down',
    import: 'import', paste: 'paste', note: 'note', light: 'light',
    text2img: 'generate', arrange: 'arrange', 'arrange-all': 'arrange',
    lines: 'eye', show: 'eye', hide: 'eyeOff', add: 'add', info: 'info',
    both: 'compare', bottom: 'down', gen: 'generate', line: 'link',
    links: 'link', node: 'add', open: 'eye', params: 'sliders',
    ref: 'image', reset: 'refresh', source: 'image', unlink: 'linkOff'
  };

  function svg(name, size) {
    const path = ICONS[name] || ICONS.info;
    const px = Number(size) || 18;
    return `<svg class="gw-icon" viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true">${path}</svg>`;
  }

  function hydrateStatic() {
    document.querySelectorAll('#island button[data-act]').forEach(button => {
      const name = ACT_ICONS[button.dataset.act];
      if (name) button.innerHTML = svg(name, 17);
    });
    const more = document.getElementById('island-more-btn');
    if (more) more.innerHTML = svg('more', 17);
    document.querySelectorAll('#gw-rail button[data-rail]').forEach(button => {
      const name = RAIL_ICONS[button.dataset.rail];
      if (name) button.innerHTML = svg(name, 19);
    });
  }

  function decorateMenu(menu) {
    if (!menu) return;
    menu.querySelectorAll('button').forEach(button => {
      if (button.querySelector('.ctx-ic')) return;
      const key = button.dataset.node || button.dataset.a || button.dataset.up || '';
      const name = MENU_ICONS[key];
      if (!name || !button.textContent.trim()) return;
      const label = button.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (!label) return;
      button.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'ctx-ic';
      icon.innerHTML = svg(name, 18);
      const text = document.createElement('span');
      text.className = 'ctx-label';
      text.textContent = label;
      button.appendChild(icon);
      button.appendChild(text);
    });
  }

  window.GWIcon = { svg, hydrateStatic, decorateMenu };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hydrateStatic, { once: true });
  else hydrateStatic();
})();
