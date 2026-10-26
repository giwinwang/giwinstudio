// 驱动应用：等待启动画面结束 → 截登录页 → 注册/登录 → 截工作台
const { chromium } = require('playwright-core');
const OUT = 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
  const pages = b.contexts()[0].pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  await page.waitForTimeout(6000);
  await page.screenshot({ path: OUT + '/app-auth.png' });
  console.log('登录页已截');

  // 探测表单
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input:not([type=hidden])')]
      .filter(i => i.offsetParent !== null)
      .map(i => ({ id: i.id, type: i.type, ph: i.placeholder }))
  );
  console.log('可见输入框:', JSON.stringify(inputs));
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter(i => i.offsetParent !== null)
      .map(i => i.textContent.trim()).filter(Boolean).slice(0, 10)
  );
  console.log('可见按钮:', JSON.stringify(btns));
  await b.close();
})().catch(e => { console.error('失败:', e.message.split('\n')[0]); process.exit(1); });
