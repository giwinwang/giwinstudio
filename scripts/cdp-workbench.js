// 强制进入工作台视图并截图（仅 CSS 验证用途）
const { chromium } = require('playwright-core');
const OUT = process.argv[2] || 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04/app-workbench3.png';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
  const pages = b.contexts()[0].pages();
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    try {
      if (typeof showLicenseGate === 'function') { window.showLicenseGate = function(){}; }
      if (typeof refreshLicenseState === 'function') { window.refreshLicenseState = async function(){ return { enforced:false, valid:true }; }; }
      if (typeof licenseCheckTimer !== 'undefined' && licenseCheckTimer) { clearInterval(licenseCheckTimer); licenseCheckTimer = null; }
      if (typeof enterApp === 'function') { enterApp(); return 'enterApp 调用成功'; }
      if (typeof show === 'function') { show('screen-app'); return 'show(screen-app) 成功'; }
      return '函数不可用';
    } catch (e) { return '出错: ' + e.message; }
  });
  console.log(r);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: OUT });
  console.log('工作台截图完成');
  await b.close();
})().catch(e => { console.error('失败:', e.message.split('\n')[0]); process.exit(1); });
