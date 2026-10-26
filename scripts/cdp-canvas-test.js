// 画布 H 部分验证：真实注册登录 → 新建项目 → 合成内联工具节点（不同比例底图）→ 截图
// 用法：node scripts/cdp-canvas-test.js [输出png]
const { chromium } = require('playwright-core');
const OUT = process.argv[2] || 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04/canvas-h-verify.png';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
  const pages = b.contexts()[0].pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  await page.waitForTimeout(2000);

  // 1. EULA：滚动到协议底部解锁按钮，再点「同意并继续」
  try {
    const okBtn = page.locator('#btn-eula-ok');
    await okBtn.waitFor({ state: 'attached', timeout: 4000 });
    await page.evaluate(() => {
      const body = document.getElementById('eula-body');
      if (body) { body.scrollTop = body.scrollHeight; body.dispatchEvent(new Event('scroll')); }
    });
    await page.waitForTimeout(600);
    await okBtn.click({ timeout: 5000, force: true });
    console.log('EULA 已同意');
    await page.waitForTimeout(4500); // 开屏动画
  } catch (e) { console.log('EULA 跳过: ' + e.message.split('\n')[0]); }

  // 2. 注册 / 登录（测试账号）
  const authState = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const authScreen = $('screen-auth');
    if (!authScreen || getComputedStyle(authScreen).display === 'none') return 'auth 屏不可见（可能已登录）';
    if ($('in-email').value && $('in-pass').value) {
      $('btn-auth-go').click();
      return '用已填账号登录';
    }
    // 切到注册模式
    const toggle = $('auth-toggle');
    if (toggle && /注册/.test($('btn-auth-go').textContent || '')) { /* 已是登录态 */ }
    try { if (toggle) toggle.click(); } catch (e) {}
    $('in-name').value = 'UI验证';
    $('in-email').value = 'ui-verify@gw.local';
    $('in-pass').value = 'verify-123456';
    $('btn-auth-go').click();
    return '已提交注册';
  });
  console.log('auth:', authState);
  await page.waitForTimeout(3500);

  // 3. 新建项目（激活画布）
  const projState = await page.evaluate(() => {
    const nameEl = document.getElementById('np-name');
    if (!nameEl) return 'np-name 不存在';
    nameEl.value = 'H规范验证';
    const btn = document.getElementById('btn-np-new');
    if (btn) { btn.click(); return '已点新建项目'; }
    return 'btn-np-new 不存在';
  });
  console.log('project:', projState);
  await page.waitForTimeout(4500);

  // 3.5 关闭欢迎弹窗、确认画布就绪
  const ready = await page.evaluate(() => {
    try { if (typeof closeWelcome === 'function') closeWelcome(); } catch (e) {}
    const mask = document.getElementById('welcome-mask');
    if (mask) mask.classList.add('hidden');
    // 测试链路兜底：程序化建项目可能不触发画布可见性事件，手动放开
    const mount = document.getElementById('canvas-mount');
    if (mount) mount.style.visibility = 'visible';
    const wrap = document.getElementById('canvas-wrap');
    if (wrap) wrap.style.visibility = 'visible';
    const dbg = window.__gwCanvasDebug;
    const stage = dbg && dbg.stageRef();
    if (stage) stage.draw();
    return { stageW: stage ? stage.width() : -1, stageH: stage ? stage.height() : -1 };
  });
  console.log('ready:', JSON.stringify(ready));
  await page.waitForTimeout(800);

  // 4. 合成测试节点
  const report = await page.evaluate(async () => {
    const dbg = window.__gwCanvasDebug;
    if (!dbg) return { error: '调试出口不存在' };
    const stage = dbg.stageRef();
    const layer = dbg.mainLayerRef();
    if (!stage || !layer) return { error: 'stage/layer 未初始化' };
    const makeImage = (w, h) => new Promise(resolve => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#dfe6ea'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#83A0B2'; ctx.fillRect(20, 20, w - 40, 14);
      ctx.fillStyle = '#4a5560'; ctx.font = '700 28px sans-serif';
      ctx.fillText(w + 'x' + h, 24, h / 2);
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = c.toDataURL('image/png');
    });
    const kinds = [
      { toolKind: 'mark', label: '标记 · 3:2 底图', img: [906, 604] },
      { toolKind: 'inpaint', label: '局部重绘 · 1:1 底图', img: [704, 704] },
      { toolKind: 'reverse', label: '反推 · 4:3 底图', img: [808, 606] },
      { toolKind: 'reverse', label: '反推 · 竖图 2:3', img: [500, 750] },
      { toolKind: 'plain', label: '工作台工具 · 参数类', img: null }
    ];
    const out = [];
    let x = 80, y = 120;
    for (const item of kinds) {
      try {
        const nd = { id: 'verify-' + Math.random().toString(36).slice(2, 7), x, y, toolKind: item.toolKind, label: item.label, subtitle: 'H 规范验证', w: 240, h: 92 };
        let group;
        if (item.toolKind === 'plain') {
          group = dbg.buildLegacyToolGroup(nd);
        } else {
          const img = await makeImage(item.img[0], item.img[1]);
          group = dbg.buildInlineToolGroup(nd, img);
        }
        const added = dbg.addTestNode(group);
        out.push({
          kind: item.toolKind, label: item.label, added,
          w: group.gwToolW || group.width(), h: group.gwToolH || group.height(),
          preview: group.gwPreviewSize || null
        });
        y += (group.gwToolH || group.height() || 408) + 60;
      } catch (e) { out.push({ kind: item.toolKind, error: e.message }); }
    }
    dbg.fit();
    return out;
  });
  console.log(JSON.stringify(report, null, 1));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT });
  console.log('截图: ' + OUT);
  await b.close();
})().catch(e => { console.error('失败:', e.message.split('\n')[0]); process.exit(1); });
