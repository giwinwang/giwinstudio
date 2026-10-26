// 切浅色主题截图
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
  const pages = b.contexts()[0].pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04/app-light.png' });
  console.log('浅色截图完成');
  await b.close();
})().catch(e => { console.error('失败:', e.message.split('\n')[0]); process.exit(1); });
