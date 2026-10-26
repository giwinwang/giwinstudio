// 一次性：spawn Electron 应用 → CDP 连接 → 截图 → 结束
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = 'G:/02_项目开发/GIWINDESIGN/01_LATEST_GIWIN-Studio-v0.4.24-M2.24';
const OUT = process.argv[2] || 'C:/Users/Administrator/WorkBuddy/2026-10-26-15-07-04/app-live.png';

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_ENABLE_LOGGING = '1';
  const app = spawn(path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
    ['.', '--remote-debugging-port=9333'], { cwd: ROOT, env, stdio: 'pipe' });
  app.stdout.on('data', () => {});
  app.stderr.on('data', (d) => process.stdout.write('[app] ' + d.toString().slice(0, 200)));

  // 等端口就绪
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 700));
    try {
      const res = await fetch('http://127.0.0.1:9333/json/version');
      if (res.ok) { ready = true; break; }
    } catch {}
  }
  if (!ready) { console.error('CDP 端口未就绪'); app.kill(); process.exit(1); }
  console.log('CDP 就绪');

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 10000 });
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    console.log('页面:', pages.map(p => p.url().slice(0, 60)));
    const page = pages.find(p => p.url().includes('index.html')) || pages[0];
    await page.waitForTimeout(2000);
    await page.screenshot({ path: OUT });
    console.log('截图完成:', OUT);
    await browser.close();
  } catch (e) {
    console.error('CDP 失败:', e.message.split('\n')[0]);
  }
  app.kill();
  process.exit(0);
})();
