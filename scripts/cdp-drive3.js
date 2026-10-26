// 注册账号 → 登录 → 进工作台截图
const { chromium } = require('playwright-core');
const OUT = 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
  const pages = b.contexts()[0].pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  await page.waitForTimeout(2000);

  // 切到注册
  const regLink = page.locator('a:has-text("注册一个"), #auth-toggle, [id*=toggle]').first();
  await regLink.click({ timeout: 5000 }).catch(() => console.log('注册链接点击失败'));
  await page.waitForTimeout(800);

  // 填表
  await page.fill('#in-email', 'uitest@giwin.cn');
  await page.fill('#in-pass', 'uitest123');
  const nameInput = page.locator('#in-name, input[id*=name], input[placeholder*=昵称]').first();
  if (await nameInput.count()) await nameInput.fill('UI测试');
  const submit = page.locator('button:has-text("注 册"), button:has-text("注册"), button:has-text("创建")').first();
  await submit.click({ timeout: 5000 }).catch(() => console.log('注册按钮未找到，尝试登录'));
  await page.waitForTimeout(2500);

  // 若还在登录页则直接登录
  if (await page.locator('#in-email').isVisible().catch(() => false)) {
    await page.fill('#in-email', 'uitest@giwin.cn');
    await page.fill('#in-pass', 'uitest123');
    await page.locator('button:has-text("登 录"), button:has-text("登录")').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: OUT + '/app-workbench.png' });
  console.log('工作台已截');
  await b.close();
})().catch(e => { console.error('失败:', e.message.split('\n')[0]); process.exit(1); });
