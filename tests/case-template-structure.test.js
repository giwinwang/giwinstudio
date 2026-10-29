"use strict";
// 新手案例模板的结构校验（不需要 Electron：canvas 用 mock）
// 用法: node tests/case-template-structure.test.js
const assert = require("node:assert/strict");
const path = require("node:path");

// ---- 最小 canvas mock：模板里的占位图靠它画出来 ----
function fakeContext() {
  const state = {};
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    }
  });
}
global.document = {
  readyState: "complete",
  createElement(tag) {
    if (tag !== "canvas") throw new Error("只应创建 canvas");
    return {
      width: 0,
      height: 0,
      getContext() { return fakeContext(); },
      toDataURL(type) { return "data:" + (type || "image/png") + ";base64,SGVsbG8="; }
    };
  },
  getElementById() { return null; },
  addEventListener() {}
};
global.window = {};

require(path.join(__dirname, "..", "case-templates.js"));

// 与 canvas.js 保持一致的画布真实尺寸：图片卡 = 比例 × NODE_CARD_H(408)
const SIZE = {
  image: { w: 622, h: 408 },
  note: { w: 320, h: 408 },
  generator: { w: 286, h: 112 }
};

async function main() {
  const templates = window.GW_CASE_TEMPLATES;
  assert.ok(Array.isArray(templates), "GW_CASE_TEMPLATES 应为数组");
  assert.equal(templates.length, 1, "先内置一个新手模板");

  const tpl = templates[0];
  assert.ok(tpl.id && tpl.title && tpl.summary, "模板要有 id / title / summary");
  assert.equal(typeof tpl.graph, "function", "graph 应延迟构建（占位图要在渲染时生成）");

  const graph = await tpl.graph();
  assert.equal(graph.version, 1, "graph 版本应为 1");
  assert.equal(graph.nodes.length, 6, "模板应含 6 个节点");
  assert.equal(graph.edges.length, 2, "模板应含 2 条连线");

  const ids = new Set(graph.nodes.map(n => n.id));
  assert.equal(ids.size, graph.nodes.length, "节点 id 不能重复");

  const byType = type => graph.nodes.filter(n => n.type === type);
  const notes = byType("note");
  const images = byType("image");
  const generators = byType("generator");
  assert.equal(notes.length, 3, "3 张步骤便签");
  assert.equal(images.length, 2, "2 张参考图（户型 + 风格）");
  assert.equal(generators.length, 1, "1 个生成节点");

  // 便签：canvas.js 用 title / text / noteKind 渲染，noteKind 必须在 NOTE_KINDS(record/todo/feedback) 内
  notes.forEach(note => {
    assert.ok(note.title && note.title.trim(), "便签要有标题");
    assert.ok(note.text && note.text.length > 10, "便签要有说明文字");
    assert.ok(["record", "todo", "feedback"].includes(note.noteKind), "便签类型必须合法");
    assert.equal(typeof note.x, "number");
    assert.equal(typeof note.y, "number");
  });

  // 参考图：src 是项目内文件名（有 GWCanvas 时）或占位 dataURL（无 GWCanvas 的降级路径）
  images.forEach(image => {
    const src = String(image.src || "");
    assert.ok(src.indexOf("data:image/png;base64,") === 0 || /\.(png|jpe?g|webp)$/i.test(src), "参考图 src 应为项目内文件名或占位 dataURL");
    ["x", "y", "w", "h"].forEach(key => assert.equal(typeof image[key], "number", "参考图缺少 " + key));
  });

  // 生成节点：按 canvas.js 的约定，params 可省略（用当前配方默认值）
  generators.forEach(gen => {
    assert.equal(typeof gen.x, "number");
    assert.equal(typeof gen.y, "number");
    assert.ok(gen.params === undefined || typeof gen.params === "object", "params 若提供必须是对象");
  });

  // 连线：两端必须存在于节点里，端口必须是 generator 的合法输入口
  const GENERATOR_PORTS = ["prompt", "params", "material", "light", "structure", "style"];
  graph.edges.forEach(edge => {
    assert.ok(ids.has(edge.from), "连线起点不存在: " + edge.from);
    assert.ok(ids.has(edge.to), "连线终点不存在: " + edge.to);
    assert.ok(GENERATOR_PORTS.includes(edge.port), "连线端口非法: " + edge.port);
    const target = graph.nodes.find(n => n.id === edge.to);
    assert.equal(target.type, "generator", "连线应接进生成节点");
  });

  const ports = graph.edges.map(e => e.port).sort();
  assert.deepEqual(ports, ["structure", "style"], "一条接结构口、一条接风格口");

  // ---- 布局校验：按真实卡片尺寸算矩形，任意两张卡都不能重叠 ----
  const rects = graph.nodes.map(node => {
    const size = SIZE[node.type];
    assert.ok(size, "未知节点类型: " + node.type);
    return {
      id: node.id,
      type: node.type,
      x: node.x,
      y: node.y,
      right: node.x + size.w,
      bottom: node.y + size.h
    };
  });
  const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.ok(!overlaps(rects[i], rects[j]), "节点重叠，会看不清内容: " + rects[i].id + " / " + rects[j].id);
    }
  }

  // 相对位置：参考图在左、生成节点居中、便签在右（跟着连线顺序读）
  const imgRight = Math.max(...rects.filter(r => r.type === "image").map(r => r.right));
  const gen = rects.find(r => r.type === "generator");
  assert.ok(gen.x >= imgRight, "生成节点应在参考图右侧");
  const noteLeft = Math.min(...rects.filter(r => r.type === "note").map(r => r.x));
  assert.ok(noteLeft >= gen.right, "便签应在生成节点右侧");

  // 整组以原点为中心：instantiateTemplate 拿到的是相对视口中心的偏移，偏了就会跑到屏幕外
  const minX = Math.min(...rects.map(r => r.x));
  const maxX = Math.max(...rects.map(r => r.right));
  const minY = Math.min(...rects.map(r => r.y));
  const maxY = Math.max(...rects.map(r => r.bottom));
  assert.ok(Math.abs(minX + maxX) <= 2, "横向应以原点居中，实际 " + (minX + maxX));
  assert.ok(Math.abs(minY + maxY) <= 2, "纵向应以原点居中，实际 " + (minY + maxY));

  // 整组尺寸要能在 1600×900 视口里以 ≥0.6 的缩放看全（否则第一眼还是看不清字）
  const fitScale = Math.min(1600 / (maxX - minX + 160), 900 / (maxY - minY + 160));
  assert.ok(fitScale >= 0.6, "模板整体过大，自动适配后缩放只有 " + fitScale.toFixed(2));

  // ---- 接线检查：模板要在两个入口都挂上 ----
  const fs = require("node:fs");
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const studioTools = fs.readFileSync(path.join(root, "studio-tools.js"), "utf8");
  const canvasJs = fs.readFileSync(path.join(root, "canvas.js"), "utf8");

  assert.ok(html.indexOf('<script src="case-templates.js"></script>') > 0, "index.html 应加载 case-templates.js");
  assert.ok(
    html.indexOf('<script src="case-templates.js"></script>') < html.indexOf('<script src="studio-tools.js"></script>'),
    "case-templates.js 必须在 studio-tools.js 之前加载"
  );
  assert.ok(html.indexOf('id="btn-empty-template"') > 0, "空白画布应有「用新手模板开始」按钮");

  assert.ok(/function renderCaseTemplates\(/.test(studioTools), "资产库应渲染新手模板区");
  assert.ok(/bindCaseTemplates\(box\)/.test(studioTools), "资产库渲染后要绑定模板按钮");
  assert.ok(/window\.GW_useStarterTemplate/.test(studioTools), "资产库应复用统一的放置入口");

  assert.equal(typeof window.GW_useStarterTemplate, "function", "应暴露统一的模板放置入口");
  assert.ok(/fitToNodes: list => fitToNodes\(list\)/.test(canvasJs), "canvas 应导出 fitToNodes（落位后自动适配视图）");
  assert.ok(/saveProjectImageDataURL: dataURL =>/.test(canvasJs), "canvas 应导出 saveProjectImageDataURL（占位图落盘）");

  console.log("# tests 1");
  console.log("# pass 1");
  console.log("ok: true · 模板结构校验通过（6 节点 / 2 连线 / 无重叠 / 居中 / 两个入口已接线）");
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
