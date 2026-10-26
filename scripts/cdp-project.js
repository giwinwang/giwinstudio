// 回车创建项目
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
  const pages = b.contexts()[0].pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  await page.waitForTimeout(2500);
  try {
    const input = page.locator('input[placeholder*="新建项目"], input[placeholder*="项目名"]').first();
    await input.fill('UI验证测试', { timeout: 5000 });
    await input.press('Enter');
    await page.waitForTimeout(4000);
    console.log('回车已发');
  } catch (e) { console.log('交互:', e.message.split('\n')[0]); }
  await page.screenshot({ path: 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04/canvas-2.png' });
  console.log('完成');
  await b.close();
})().catch(e => { console.error('失败:', e.message.split('\n')[0]); process.exit(1); });
