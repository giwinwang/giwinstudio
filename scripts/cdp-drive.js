// 驱动应用：同意协议 → 截图主界面
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
  const pages = b.contexts()[0].pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  await page.waitForTimeout(1500);

  // 滚动 EULA 到底
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 100);
    els.forEach(e => e.scrollTop = e.scrollHeight);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04/app-eula-end.png' });

  // 点击同意
  const agree = page.locator('#eula-agree, button:has-text("同意并继续")').first();
  if (await agree.count()) {
    try { await agree.click({ timeout: 3000 }); } catch (e) { console.log('点击失败，尝试强制', e.message.split('\n')[0]); }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04/app-after-agree.png' });
  console.log('完成, 当前URL:', page.url().slice(0, 60));
  await b.close();
})().catch(e => { console.error('失败:', e.message.split('\n')[0]); process.exit(1); });
