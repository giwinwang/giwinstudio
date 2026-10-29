"use strict";
// 新手使用说明书项目的结构校验（不需要 Electron：canvas/GWCanvas 用 stub）
// 前身是「新手案例模板」结构校验；三个拖入式模板已下线，由内置说明书项目替代。
const assert = require("node:assert/strict");
const path = require("node:path");

// ---- 最小 canvas mock：说明卡/封面靠它画出来 ----
function fakeContext() {
  return new Proxy({}, {
    get(target, key) {
      if (key === "measureText") return s => ({ width: String(s).length * 12 });
      if (key in target) return target[key];
      return () => {};
    },
    set() { return true; }
  });
}
function fakeCanvas() {
  return {
    width: 0, height: 0,
    getContext() { return fakeContext(); },
    toDataURL(type) { return "data:" + (type || "image/png") + ";base64,SGVsbG8="; }
  };
}

// 近似真实渲染尺寸（image 固定 408 高、宽=ratio*408；note 320x408；generator 面板 430 宽）
const SIZES = {
  image: { w: 622, h: 408 },
  note: { w: 320, h: 408 },
  generator: { w: 430, h: 175 },
  soft: { w: 300, h: 210 },
  layout: { w: 320, h: 420 }
};

const made = [];
const edges = [];
let saved = false;
global.window = {
  GWCanvas: {
    hasOpenProject: () => true,
    saveProjectImageDataURL: async () => ({ name: "asset-fake.png", w: 640, h: 420 }),
    instantiateNodeRecord: async (nd) => {
      const node = {
        __type: nd.type, __key: nd.id, x: 0, y: 0,
        position(p) { this.x = p.x; this.y = p.y; }
      };
      made.push(node);
      return node;
    },
    restoreEdgeRecords: (rs) => rs.forEach(r => edges.push(r)),
    nodeLayoutSize: k => SIZES[k.__type] || { w: 320, h: 408 },
    fitToNodes: () => {},
    saveForProjectSwitch: async () => { saved = true; },
    toast: () => {},
    guideContentNodeCount: () => 0
  }
};
global.document = {
  readyState: "complete",
  createElement: tag => tag === "canvas" ? fakeCanvas() : { style: {}, addEventListener() {}, classList: { add() {}, remove() {} }, setAttribute() {}, querySelectorAll: () => [] },
  getElementById() { return null; },
  addEventListener() {}
};

require(path.join(__dirname, "..", "case-templates.js"));

// 与 canvas.js 保持一致的画布真实尺寸：图片卡 = 比例 × NODE_CARD_H(408)
const SIZE = {
  image: { w: 622, h: 408 },
  note: { w: 320, h: 408 },
  generator: { w: 430, h: 175 },
  soft: { w: 300, h: 210 },
  layout: { w: 320, h: 420 }
};

async function main() {
  // ---- 说明书构建函数存在且可执行 ----
  assert.equal(typeof window.GW_buildGuideContent, "function", "应暴露 GW_buildGuideContent");
  assert.equal(typeof window.GW_CASE_TEMPLATES, "undefined", "拖入式新手模板已下线，不应再导出 GW_CASE_TEMPLATES");
  assert.equal(typeof window.GW_useStarterTemplate, "undefined", "拖入式新手模板已下线，不应再导出 GW_useStarterTemplate");

  const ok = await window.GW_buildGuideContent();
  assert.ok(ok, "说明书内容应构建成功");

  const byKey = new Map(made.map(k => [k.__key, k]));
  assert.ok(made.length >= 25, "说明书应有足够节点（当前 " + made.length + "）");
  assert.ok(edges.length >= 10, "说明书应有真实连线（当前 " + edges.length + "）");

  // id 唯一
  const ids = made.map(k => k.__key);
  assert.equal(new Set(ids).size, ids.length, "节点 id 不能重复");

  // 坐标有限值
  made.forEach(k => {
    assert.ok(Number.isFinite(k.x) && Number.isFinite(k.y), "节点 " + k.__key + " 坐标非法");
  });

  // 连线两端存在
  edges.forEach(edge => {
    assert.ok(byKey.has(edge.from), "连线起点不存在: " + edge.from);
    assert.ok(byKey.has(edge.to), "连线终点不存在: " + edge.to);
  });

  // ---- 布局校验：按真实卡片尺寸算矩形，任意两张卡都不能重叠 ----
  const rects = made.map(node => {
    const size = SIZE[node.__type] || { w: 320, h: 408 };
    return {
      id: node.__key, type: node.__type, x: node.x, y: node.y,
      right: node.x + size.w, bottom: node.y + size.h, size
    };
  });
  const overlaps = (a, b) => a.x < b.right - 4 && b.x < a.right - 4 && a.y < b.bottom - 4 && b.y < a.bottom - 4;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.ok(!overlaps(rects[i], rects[j]), "节点重叠，会看不清内容: " + rects[i].id + " / " + rects[j].id);
    }
  }

  // 便签应位于其解释的流程行上方
  const noteBottom = k => k.y + (SIZE.note.h);
  [["n-render", "in-struct"], ["n-multi", "in-a"], ["n-soft", "out-soft"], ["n-layout", "out-layout"], ["n-plan", "in-axis"], ["n-concept", "in-sketch"]]
    .forEach(([nk, target]) => {
      const n = byKey.get("gc-" + nk), t = byKey.get("gc-" + target);
      if (n && t) assert.ok(noteBottom(n) <= t.y, "便签 " + nk + " 应在 " + target + " 上方");
    });

  // ---- 接线检查：说明书入口都在 ----
  const fs = require("node:fs");
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const canvasJs = fs.readFileSync(path.join(root, "canvas.js"), "utf8");
  const studioTools = fs.readFileSync(path.join(root, "studio-tools.js"), "utf8");

  assert.ok(html.indexOf('<script src="case-templates.js"></script>') > 0, "index.html 应加载 case-templates.js");
  assert.ok(html.indexOf('id="btn-empty-template"') > 0, "空白画布应有「打开新手使用说明书」按钮");
  assert.ok(html.indexOf('id="btn-guide-project"') > 0, "工具栏应有「说明书」按钮");
  assert.ok(html.indexOf('id="btn-guide-foot"') > 0, "欢迎页底部应有书本图标入口");
  assert.ok(/\$\('btn-empty-template'\)\)\s*\$\('btn-empty-template'\)\.onclick = openGuideProject/.test(appJs), "空白画布按钮应打开说明书项目");
  assert.ok(/\$\('btn-guide-project'\)\.onclick = openGuideProject/.test(appJs), "工具栏按钮应打开说明书项目");
  assert.ok(/btn-guide-foot/.test(appJs), "欢迎页底部书本图标应绑定打开逻辑");
  assert.ok(!/renderCaseTemplates/.test(studioTools), "资产库不应再渲染新手模板区");
  assert.ok(/fitToNodes: list => fitToNodes\(list\)/.test(canvasJs), "canvas 应导出 fitToNodes（落位后自动适配视图）");
  assert.ok(/saveProjectImageDataURL: dataURL =>/.test(canvasJs), "canvas 应导出 saveProjectImageDataURL（说明卡落盘）");

  assert.ok(saved, "构建完成应触发保存");

  console.log("# tests 1");
  console.log("# pass 1");
  console.log("ok: true · 说明书项目结构校验通过（" + made.length + " 节点 / " + edges.length + " 连线 / 无重叠 / 便签在行上方 / 入口齐全）");
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
