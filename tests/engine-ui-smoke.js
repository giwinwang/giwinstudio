"use strict";
// #163 自定义引擎供应商图标联动 - UI 冒烟测试
// 用法: env -u ELECTRON_RUN_AS_NODE npx electron tests/engine-ui-smoke.js
// 原理：加载真实 main.js 启动完整应用（隐藏主窗口），驱动 UI 验证联动并截图。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const flag = path.join(root, "license-required.flag");
const flagBak = flag + ".smoke-bak";
const shot = process.env.ENGINE_SMOKE_SHOT || path.join(root, "docs", "engine-custom-provider-smoke.png");

// 临时移开 license 标记，避免冒烟环境被激活门挡住
let flagMoved = false;
if (fs.existsSync(flag)) { fs.renameSync(flag, flagBak); flagMoved = true; }

app.whenReady().then(async () => {
  try {
    // 主窗口创建后立即隐藏，避免冒烟时闪窗
    app.on('browser-window-created', (event, window) => {
      try { window.hide(); } catch (_) {}
    });
    // 加载真实主进程（注册全部 IPC，启动渲染层）
    // loadFile('index.html') 以 app path 为基准，这里把 app path 指到项目根
    process.chdir(root);
    if (app.setAppPath) app.setAppPath(root);
    require(path.join(root, 'main.js'));
    // 等主窗口出现并完成启动：EULA → 开屏(3s) → 主界面 / 授权门
    let win = null;
    for (let i = 0; i < 60 && !win; i++) {
      await new Promise(r => setTimeout(r, 250));
      win = BrowserWindow.getAllWindows()[0] || null;
    }
    if (!win) throw new Error('主窗口未创建');
    win.webContents.on('console-message', (event, level, message) => {
      if (level >= 2 && !/GPU|WebGL|fonts|font/i.test(message)) console.log('[page]', message.slice(0, 300));
    });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 250));
      const state = await win.webContents.executeJavaScript(`(() => {
        const vis = id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); };
        return { app: vis('screen-app'), license: vis('screen-license'), auth: vis('screen-auth'), eula: vis('screen-eula') };
      })()`);
      if (state.eula) {
        await win.webContents.executeJavaScript(`(()=>{const b=document.getElementById('btn-eula-ok');b.disabled=false;b.click()})()`);
        continue;
      }
      if (state.auth) {
        // 冒烟环境是独立 userData，注册一个本地测试账号直接进入
        await win.webContents.executeJavaScript(`(async () => {
          const t = document.getElementById('auth-toggle');
          if (t) t.click();
          document.getElementById('in-name').value = 'Smoke';
          document.getElementById('in-email').value = 'smoke@test.local';
          document.getElementById('in-pass').value = 'smoke-123456';
          document.getElementById('btn-auth-go').click();
        })()`);
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      if (state.app || state.license || state.auth) {
        if (!state.app) throw new Error('应用被门挡住: ' + JSON.stringify(state));
        ready = true;
        break;
      }
    }
    if (!ready) throw new Error('应用启动超时');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      const $ = id => document.getElementById(id);
      // 打开设置（捕获页面脚本异常，避免静默失败难排查）
      const pageErrors = [];
      window.addEventListener('error', e => pageErrors.push(String(e.message)));
      try { $('um-settings').click(); } catch (e) { pageErrors.push('click: ' + e.message); }
      await new Promise(r => setTimeout(r, 400));
      out.maskVisible = !$('settings-mask').classList.contains('hidden');
      const toastEl = document.querySelector('#toasts .toast');
      out.toast = toastEl ? toastEl.textContent.trim() : null;
      // 切到引擎页
      const navItems = Array.from(document.querySelectorAll('#set-nav .set-nav-item'));
      if (!navItems.length) throw new Error('设置导航为空 mask=' + out.maskVisible + ' toast=' + out.toast + ' errors=' + pageErrors.join(' | '));
      const engineNav = navItems.find(n => /引擎/.test(n.textContent));
      if (!engineNav) throw new Error('引擎导航项未找到: ' + navItems.map(n => n.textContent).join(','));
      engineNav.click();
      await new Promise(r => setTimeout(r, 150));
      // 切到自定义引擎
      $('eng-picker-btn').click();
      await new Promise(r => setTimeout(r, 100));
      const option = document.querySelector('#eng-picker-menu [data-engine-id="custom"]');
      if (!option) throw new Error('自定义引擎选项未找到');
      option.click();
      await new Promise(r => setTimeout(r, 200));
      // 验证快捷填入按钮
      const chips = Array.from(document.querySelectorAll('#eng-url-presets .engine-url-chip'));
      out.chipCount = chips.length;
      out.chipLabels = chips.map(c => c.textContent.trim());
      // 点击 Gemini 供应商图标 → 自动填入接口地址
      const geminiChip = chips.find(c => c.dataset.pid === 'google');
      if (!geminiChip) throw new Error('Gemini 快捷按钮未找到');
      geminiChip.click();
      await new Promise(r => setTimeout(r, 100));
      out.urlAfterClick = $('eng-url').value;
      out.pickerLogo = $('eng-picker-logo').getAttribute('src');
      out.currentLogo = $('eng-current-logo') ? $('eng-current-logo').getAttribute('src') : null;
      out.geminiChipOn = geminiChip.classList.contains('on');
      // 手输 DeepSeek 地址 → 图标应实时联动
      const url = $('eng-url');
      url.value = 'https://api.deepseek.com/v1';
      url.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      out.pickerLogoAfterInput = $('eng-picker-logo').getAttribute('src');
      out.currentLogoAfterInput = $('eng-current-logo') ? $('eng-current-logo').getAttribute('src') : null;
      // 非常见地址 → 回落 generic
      url.value = 'https://my-own-gateway.example.com/v1';
      url.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      out.pickerLogoFallback = $('eng-picker-logo').getAttribute('src');
      // 恢复 Gemini 地址供截图
      geminiChip.click();
      await new Promise(r => setTimeout(r, 100));
      return out;
    })()`);
    assert.equal(result.chipCount, 7, '应有 7 个供应商快捷按钮');
    assert.equal(result.urlAfterClick, 'https://generativelanguage.googleapis.com/v1beta/openai/', '点击 Gemini 图标应自动填入地址');
    assert.match(result.pickerLogo, /google\.svg/, '引擎选择器图标应联动为 Google');
    assert.match(result.currentLogo, /google\.svg/, '当前模型卡片图标应联动为 Google');
    assert.equal(result.geminiChipOn, true, 'Gemini 按钮应有选中态');
    assert.match(result.pickerLogoAfterInput, /deepseek\.svg/, '手输地址后选择器图标应联动为 DeepSeek');
    assert.match(result.currentLogoAfterInput, /deepseek\.svg/, '手输地址后当前模型图标应联动为 DeepSeek');
    assert.match(result.pickerLogoFallback, /generic\.svg/, '未知地址应回落通用图标');
    // 截图（设置面板打开、自定义引擎、Gemini 已填入）
    await win.webContents.executeJavaScript(`document.getElementById('eng-url').scrollIntoView({block:'center'})`);
    await new Promise(r => setTimeout(r, 300));
    const image = await win.capturePage();
    fs.writeFileSync(shot, image.toPNG());
    console.log(JSON.stringify({ ok: true, ...result, shot }, null, 2));
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    if (flagMoved && fs.existsSync(flagBak)) fs.renameSync(flagBak, flag);
  }
});
