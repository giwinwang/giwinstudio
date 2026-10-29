"use strict";
// 积分码 App 端冒烟：真实 main.js + 完整 UI
// 用法: env -u ELECTRON_RUN_AS_NODE npx electron tests/points-smoke.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const flag = path.join(root, "license-required.flag");
const flagBak = flag + ".smoke-bak";
const shotPath = path.join(root, "docs", "points-redeem-smoke.png");

// 隔离 userData，避免污染真实账户数据
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "giwin-points-smoke-"));
app.setPath('userData', tmpUserData);

// 临时移开 license 标记（开发模式，免激活门）
let flagMoved = false;
if (fs.existsSync(flag)) { fs.renameSync(flag, flagBak); flagMoved = true; }

app.whenReady().then(async () => {
  try {
    app.on('browser-window-created', (event, window) => { try { window.hide(); } catch (_) {} });
    process.chdir(root);
    if (app.setAppPath) app.setAppPath(root);
    require(path.join(root, 'main.js'));
    let win = null;
    for (let i = 0; i < 60 && !win; i++) {
      await new Promise(r => setTimeout(r, 250));
      win = BrowserWindow.getAllWindows()[0] || null;
    }
    if (!win) throw new Error('主窗口未创建');
    // 等启动：EULA → 开屏 → auth → 主界面
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
      if (state.app) break;
      if (state.license) throw new Error('被激活门挡住');
    }
    // 用真实私钥签一张不绑设备的测试积分码
    const crypto = require("node:crypto");
    const privateKey = fs.readFileSync(path.join(root, '..', 'license-admin', 'private-key.pem'), 'utf8');
    const licenseCore = require(path.join(root, 'license-core.js'));
    const goodCode = licenseCore.issuePointsCode({ privateKey, points: 7, validDays: 90, holder: '冒烟测试', now: Date.now() });
    // 篡改码：面额改大
    const gp = goodCode.split('.');
    const gd = JSON.parse(Buffer.from(gp[1], 'base64url').toString('utf8'));
    gd.p = 777;
    const tamperedCode = gp[0] + '.' + Buffer.from(JSON.stringify(gd), 'utf8').toString('base64url') + '.' + gp[2];
    // 过期码
    const expiredCode = licenseCore.issuePointsCode({ privateKey, points: 5, validDays: 1, now: Date.now() - 3 * 86400000 });

    // 用内联表达式逐步执行
    const result = await win.webContents.executeJavaScript(`(async () => {
      const ipc = require('electron').ipcRenderer;
      const out = {};
      out.status0 = await ipc.invoke('points:status');
      out.redeem = await ipc.invoke('points:redeem', ${JSON.stringify(goodCode)});
      out.redeemAgain = await ipc.invoke('points:redeem', ${JSON.stringify(goodCode)});
      out.tampered = await ipc.invoke('points:redeem', ${JSON.stringify(tamperedCode)});
      out.expired = await ipc.invoke('points:redeem', ${JSON.stringify(expiredCode)});
      out.spend1 = await ipc.invoke('points:spend', { taskId: 't1', points: 3, kind: 'generate', model: 'seedream-1k' });
      out.spendDup = await ipc.invoke('points:spend', { taskId: 't1', points: 3, kind: 'generate' });
      out.spendTooMuch = await ipc.invoke('points:spend', { taskId: 't2', points: 99 });
      out.refund = await ipc.invoke('points:refund', 't1');
      out.refundTwice = await ipc.invoke('points:refund', 't1');
      // quota-router 预检：余额够/不够两态 + 扣分后余额变化
      out.quotaOk = await ipc.invoke('points:quotaCheck', { points: 2 });   // 余额 7，够
      out.spendQuota = await ipc.invoke('points:spend', { taskId: 'gen-x1', points: 2, kind: 'generate', model: 'doubao-seedream-5-0-pro@2K' });
      out.quotaShort = await ipc.invoke('points:quotaCheck', { points: 6 }); // 余额 5，不够
      out.refundQuota = await ipc.invoke('points:refund', 'gen-x1');
      // 留一笔不回滚的消耗（图层拆分类目），验证流水与月汇总
      out.spendFinal = await ipc.invoke('points:spend', { taskId: 't9', points: 2, kind: 'decompose', model: 'seedream-v5-pro/layer-decomposition@2K' });
      // 明细流水：全部 + 按月筛选 + 不存在的月份
      out.ledger = await ipc.invoke('points:ledger', {});
      out.ledgerEmpty = await ipc.invoke('points:ledger', { month: '2030-01' });
      // UI：订阅与授权页积分余额
      document.getElementById('um-settings').click();
      await new Promise(r => setTimeout(r, 400));
      const navItems = Array.from(document.querySelectorAll('#set-nav .set-nav-item'));
      const licenseNav = navItems.find(n => /订阅|授权/.test(n.textContent));
      if (licenseNav) licenseNav.click();
      await new Promise(r => setTimeout(r, 400));
      const balanceEl = document.getElementById('set-points-balance');
      out.uiBalance = balanceEl ? balanceEl.textContent.trim() : null;
      document.getElementById('eng-url') && document.getElementById('eng-url').scrollIntoView;
      return out;
    })()`);

    assert.equal(result.status0.ok, true, 'points:status 可用');
    assert.equal(result.status0.balance, 0, '初始余额 0');
    assert.equal(result.redeem.ok, true, '兑换成功');
    assert.equal(result.redeem.pointsAdded, 7);
    assert.equal(result.redeem.balance, 7);
    assert.equal(result.redeemAgain.ok, false, '重复兑换被拒绝');
    assert.match(result.redeemAgain.msg || '', /已经兑换过/);
    assert.equal(result.tampered.ok, false, '篡改码被拒绝');
    assert.equal(result.expired.ok, false, '过期码被拒绝');
    assert.equal(result.spend1.ok, true);
    assert.equal(result.spend1.balance, 4);
    assert.equal(result.spendDup.duplicate, true, '同 taskId 幂等');
    assert.equal(result.spendTooMuch.ok, false, '余额不足被拒绝');
    assert.equal(result.spendTooMuch.code, 'insufficient');
    assert.equal(result.refund.ok, true, '回滚成功');
    assert.equal(result.refund.balance, 7);
    assert.equal(result.refundTwice.ok, false, '重复回滚被拒绝');
    assert.equal(result.quotaOk.ok, true, 'quotaCheck 可用');
    assert.equal(result.quotaOk.enough, true, '余额 7 ≥ 2 → 足够');
    assert.equal(result.spendQuota.ok, true, 'quota 扣分成功');
    assert.equal(result.spendQuota.balance, 5, '扣 2 分后余额 5');
    assert.equal(result.quotaShort.enough, false, '余额 5 < 6 → 拦截');
    assert.equal(result.quotaShort.balance, 5);
    assert.equal(result.refundQuota.ok, true, 'quota 回滚成功');
    assert.equal(result.refundQuota.balance, 7);
    assert.equal(result.ledger.ok, true, '流水读取成功');
    assert.equal(result.ledger.balance, 5, '流水余额与状态一致（7 − 2）');
    assert.ok(result.ledger.rows.length >= 2, '流水含兑换+消耗条目');
    assert.ok(result.ledger.rows.some(e => e.type === 'redeem' && e.points > 0), '有兑换入账条目');
    assert.ok(result.ledger.rows.some(e => e.type === 'consume' && e.points < 0 && e.label === '图层拆分'), '有图层拆分消耗条目');
    assert.equal(result.ledger.monthIn, 7, '月收入合计 7');
    assert.equal(result.ledger.monthOut, 2, '月支出合计 2');
    assert.ok(Array.isArray(result.ledger.months) && result.ledger.months.length >= 1, '生成月份筛选项');
    assert.equal(result.ledgerEmpty.ok, true, '空月份读取成功');
    assert.equal(result.ledgerEmpty.rows.length, 0, '空月份无流水');
    assert.match(String(result.uiBalance || ''), /5 积分/, '订阅页应显示余额 5 积分，实际: ' + result.uiBalance);

    // 截图
    await win.webContents.executeJavaScript(`document.getElementById('set-points-balance') && document.getElementById('set-points-balance').scrollIntoView({block:'center'})`);
    await new Promise(r => setTimeout(r, 300));
    const image = await win.capturePage();
    fs.writeFileSync(shotPath, image.toPNG());
    console.log(JSON.stringify({ ok: true, balance: result.refund.balance, uiBalance: result.uiBalance, shot: shotPath }, null, 2));
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    if (flagMoved && fs.existsSync(flagBak)) fs.renameSync(flagBak, flag);
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  }
});
