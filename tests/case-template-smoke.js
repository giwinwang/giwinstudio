"use strict";
// 新手案例模板冒烟：真实 main.js + 完整 UI，验证模板能放到画布、连线成立、便签齐全
// 用法: env -u ELECTRON_RUN_AS_NODE npx electron tests/case-template-smoke.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const flag = path.join(root, "license-required.flag");
const flagBak = flag + ".smoke-bak";
const shotPath = path.join(root, "docs", "case-template-smoke.png");

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "giwin-case-smoke-"));
app.setPath("userData", tmpUserData);

let flagMoved = false;
if (fs.existsSync(flag)) { fs.renameSync(flag, flagBak); flagMoved = true; }

function restoreFlag() {
  if (flagMoved && fs.existsSync(flagBak)) {
    try { fs.renameSync(flagBak, flag); } catch (e) { console.warn("flag 还原失败:", e.message); }
  }
}

app.whenReady().then(async () => {
  try {
    app.on("browser-window-created", (event, window) => { try { window.hide(); } catch (_) {} });
    process.chdir(root);
    if (app.setAppPath) app.setAppPath(root);
    require(path.join(root, "main.js"));

    let win = null;
    for (let i = 0; i < 60 && !win; i++) {
      await new Promise(r => setTimeout(r, 250));
      win = BrowserWindow.getAllWindows()[0] || null;
    }
    if (!win) throw new Error("主窗口未创建");

    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 250));
      const state = await win.webContents.executeJavaScript(`(() => {
        const vis = id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); };
        return { app: vis('screen-app'), license: vis('screen-license'), auth: vis('screen-auth'), eula: vis('screen-eula') };
      })()`);
      if (state.eula) {
        await win.webContents.executeJavaScript(`(()=>{const b=document.getElementById('btn-eula-ok');if(b){b.disabled=false;b.click();}})()`);
        continue;
      }
      if (state.auth) {
        await win.webContents.executeJavaScript(`(async () => {
          const t = document.getElementById('auth-toggle');
          if (t) t.click();
          document.getElementById('in-name').value = 'Smoke';
          document.getElementById('in-email').value = 'case-smoke@test.local';
          document.getElementById('in-pass').value = 'smoke-123456';
          document.getElementById('btn-auth-go').click();
        })()`);
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      if (state.app) break;
      if (state.license) throw new Error("被激活门挡住");
    }

    const result = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.templates = Array.isArray(window.GW_CASE_TEMPLATES) ? window.GW_CASE_TEMPLATES.length : 0;
      if (!out.templates) return out;
      const tpl = window.GW_CASE_TEMPLATES[0];
      out.title = tpl.title;
      const graph = typeof tpl.graph === 'function' ? tpl.graph() : tpl.graph;
      out.graphNodes = graph.nodes.length;
      out.graphEdges = graph.edges.length;
      out.hasPlaceholder = graph.nodes.filter(n => n.type === 'image').every(n => typeof n.src === 'string' && n.src.indexOf('data:image/png') === 0);
      out.noteTitles = graph.nodes.filter(n => n.type === 'note').map(n => n.title);

      // 打开一个项目，画布才可用
      if (window.GW_createProject) { await window.GW_createProject('模板冒烟'); }
      await new Promise(r => setTimeout(r, 600));
      const before = window.GWCanvas.serialize();
      out.beforeNodes = before.nodes.length;

      const created = await window.GWCanvas.instantiateTemplate(graph, null, { label: '冒烟：套用新手模板' });
      out.createdCount = Array.isArray(created) ? created.length : -1;
      await new Promise(r => setTimeout(r, 500));

      const after = window.GWCanvas.serialize();
      out.afterNodes = after.nodes.length;
      out.afterEdges = after.edges.length;
      out.noteCount = after.nodes.filter(n => n.type === 'note').length;
      out.imageCount = after.nodes.filter(n => n.type === 'image').length;
      out.generatorCount = after.nodes.filter(n => n.type === 'generator').length;
      out.edgePorts = after.edges.map(e => e.port).sort();
      return out;
    })()`);

    console.log(JSON.stringify(result, null, 2));

    assert.ok(result.templates >= 1, "内置模板应至少有一个");
    assert.equal(result.graphNodes, 6, "模板节点数应为 6（3 便签 + 2 参考图 + 1 生成）");
    assert.equal(result.graphEdges, 2, "模板内部应有 2 条连线（结构 + 风格）");
    assert.ok(result.hasPlaceholder, "参考图应使用占位图 dataURL");
    assert.equal(result.createdCount, 6, "应成功实例化 6 个节点");
    assert.equal(result.afterNodes - result.beforeNodes, 6, "画布节点应增加 6 个");
    assert.equal(result.noteCount, 3, "画布上应有 3 张便签");
    assert.equal(result.imageCount, 2, "画布上应有 2 张参考图");
    assert.equal(result.generatorCount, 1, "画布上应有 1 个生成节点");
    assert.deepEqual(result.edgePorts, ["structure", "style"], "两条连线应接在结构口和风格口");

    await new Promise(r => setTimeout(r, 400));
    const image = await win.capturePage();
    fs.writeFileSync(shotPath, image.toPNG());
    console.log("ok: true · 截图 " + shotPath);
  } catch (error) {
    console.error("ok: false ·", error && error.stack || error);
    process.exitCode = 1;
  } finally {
    restoreFlag();
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
