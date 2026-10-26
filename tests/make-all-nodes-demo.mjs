import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'G:/GIWINDESIGN/test-projects/all-nodes-demo');
const sourceDir = 'G:/GIWINDESIGN/极物GIWIN/909090/Content';
const images = [
  'content-05dbb084-59e2-4691-899d-ec5cfc3264c5.jpg',
  'content-5ca98881-e0f2-4b3c-99f3-24ebabac6ee4.jpg',
  'content-67f1b219-cc16-4449-9f64-9ed899d0f340.png',
  'content-11a8e739-89b9-4c6e-a285-9f0865e3e17f.jpg'
];

await mkdir(path.join(outDir, 'Config', 'versions'), { recursive: true });
await mkdir(path.join(outDir, 'Content'), { recursive: true });
for (const name of images) await copyFile(path.join(sourceDir, name), path.join(outDir, 'Content', name));

const recipe = {
  styleId: 'cream',
  styleName: '奶油风空间方案',
  blocks: { time: '下午 · 柔光', view: '无外景', people: '无', light: '自然柔光' },
  weather: '晴天',
  constraint: '保持墙体、门窗、家具位置和相机角度不变，只统一材质、光影和软装气质。',
  strength: 88,
  size: '2K',
  aspect: '16:9',
  engineId: 'apollo',
  model: 'gemini-3-pro-image',
  batch: 2
};

const nodes = [
  // 区块一：空间一致性生图
  { id: 'demo-head-gen', type: 'note', x: -2300, y: -1650, text: '① 空间一致性生图  ·  输入从左下往右上汇入生成节点' },
  { id: 'demo-src-1', type: 'image', src: images[0], label: '客厅结构机位 A', room: '客厅', x: -2300, y: -1550, w: 560, h: 315 },
  {
    id: 'demo-ref', type: 'variant', x: -2300, y: -1150, gwW: 420, gwH: 340,
    results: [images[3]], cur: 0, recipe, engine: 'apollo',
    styleName: '客厅空间参考 · 已定稿', room: '客厅', time: '14:26'
  },
  { id: 'demo-material', type: 'material', x: -2300, y: -750, room: '客厅' },
  {
    id: 'demo-gen', type: 'generator', x: -1650, y: -1050,
    params: recipe, status: '结构 + 参考 + 材质 + 参数 → 生成',
    prompt: '', room: '客厅'
  },
  {
    id: 'demo-result', type: 'variant', x: -1200, y: -1200, gwW: 420, gwH: 340,
    results: [images[1], images[0]], cur: 0, recipe, engine: 'apollo',
    styleName: '客厅机位 B · 一致性结果', room: '客厅', time: '14:31'
  },

  // 区块二：效果图修改工具
  { id: 'demo-head-tools', type: 'note', x: -700, y: -1650, text: '② 效果图修改工具  ·  一张结果图分别连接六种操作' },
  {
    id: 'demo-tool-src', type: 'variant', x: -700, y: -1500, gwW: 420, gwH: 340,
    results: [images[1]], cur: 0, recipe, engine: 'apollo',
    styleName: '待修改结果图', room: '客厅', time: '14:35'
  },
  {
    id: 'demo-tool-mark', type: 'tool', toolKind: 'mark', label: '标记与批注',
    subtitle: '画笔、矩形、箭头，直接标给客户看', x: 0, y: -1550,
    inlineVersion: 2, source: 'demo-tool-src'
  },
  {
    id: 'demo-tool-inpaint', type: 'tool', toolKind: 'inpaint', label: '局部重绘',
    subtitle: '框选、圈选、魔术棒', x: 500, y: -1550,
    inlineVersion: 2, source: 'demo-tool-src'
  },
  {
    id: 'demo-tool-panorama', type: 'tool', toolKind: 'panorama', label: '360° 全景',
    subtitle: '环视与缩放预览', x: 1000, y: -1550,
    inlineVersion: 2, source: 'demo-tool-src'
  },
  {
    id: 'demo-tool-reverse', type: 'tool', toolKind: 'reverse', label: '反推提示词',
    subtitle: '分析图片生成可复用提示词', x: 0, y: -1170,
    inlineVersion: 2, source: 'demo-tool-src'
  },
  {
    id: 'demo-tool-chat', type: 'tool', toolKind: 'chat', label: '对话模式',
    subtitle: '围绕当前图片继续讨论', x: 500, y: -1170,
    inlineVersion: 2, source: 'demo-tool-src'
  },
  {
    id: 'demo-tool-upscale', type: 'tool', toolKind: 'upscale-local', label: '本地高清放大',
    subtitle: '2× / 4× 高质量重采样', x: 1000, y: -1170,
    inlineVersion: 2, source: 'demo-tool-src'
  },

  // 区块三：对比、软装与交付
  { id: 'demo-head-delivery', type: 'note', x: -2300, y: 200, text: '③ 对比、软装与交付  ·  从左到右完成客户方案' },
  {
    id: 'demo-compare', type: 'compare', x: -2300, y: 320, w: 560, h: 315,
    split: 50, refSrc: images[0], genSrc: images[1],
    refLabel: '结构机位 A', genLabel: '一致性生成结果', refRole: '结构',
    room: '客厅'
  },
  {
    id: 'demo-soft', type: 'soft', x: -1650, y: 320, w: 400, h: 240,
    soft: {
      title: '客厅软装提取与选品', room: '客厅',
      items: [
        { name: '弧形布艺沙发', category: '家具', brand: 'NORHOR', qty: 1, price: 12800, link: 'https://example.com/sofa', material: '羊羔绒', color: '奶油白', sourceNodeId: 'demo-src-1', image: 0, box: [0.42, 0.55, 0.68, 0.89], placements: [{ sourceNodeId: 'demo-src-1', image: 0, box: [0.42, 0.55, 0.68, 0.89] }] },
        { name: '亚麻落地灯', category: '灯具', brand: 'Flos', qty: 1, price: 1899, link: 'https://example.com/lamp', material: '亚麻灯罩 / 金属', color: '米白', sourceNodeId: 'demo-src-1', image: 0, box: [0.70, 0.34, 0.79, 0.83], placements: [{ sourceNodeId: 'demo-src-1', image: 0, box: [0.70, 0.34, 0.79, 0.83] }] },
        { name: '羊毛地毯', category: '地毯', brand: 'RUG', qty: 1, price: 3600, link: 'https://example.com/rug', material: '羊毛', color: '浅米灰', sourceNodeId: 'demo-src-1', image: 0, box: [0.18, 0.70, 0.76, 0.95], placements: [{ sourceNodeId: 'demo-src-1', image: 0, box: [0.18, 0.70, 0.76, 0.95] }] },
        { name: '亚麻窗帘', category: '窗帘', brand: '本地定制', qty: 2, price: 680, link: '', material: '亚麻混纺', color: '杏仁白', sourceNodeId: 'demo-src-1', image: 0, box: [0.08, 0.04, 0.27, 0.72], placements: [{ sourceNodeId: 'demo-src-1', image: 0, box: [0.08, 0.04, 0.27, 0.72] }] }
      ]
    }
  },
  {
    id: 'demo-layout', type: 'layout', x: -1150, y: 320, w: 420, h: 300,
    layout: {
      title: '江山悦 · 客厅方案', subtitle: '空间效果图与软装选品', theme: 'light',
      columns: 2, aspect: '16:9',
      items: [
        { sourceNodeId: 'demo-src-1', src: images[0], label: '客厅机位 A', room: '客厅' },
        { sourceNodeId: 'demo-result', src: images[1], label: '客厅机位 B', room: '客厅' },
        { sourceNodeId: 'demo-ref', src: images[3], label: '客厅定稿参考', room: '客厅' }
      ]
    }
  },
  {
    id: 'demo-text2img', type: 'generator', textOnly: true, x: -650, y: 320,
    prompt: '现代简约客厅，暖木色与浅灰石材，落地窗，傍晚自然光，真实室内摄影',
    params: { styleName: '文生图方案', model: 'gemini-3-pro-image', size: '2K', aspect: '16:9' },
    status: '点击节点填写或修改提示词', room: '客厅'
  },
  {
    id: 'demo-error', type: 'error', x: -150, y: 320, w: 360, h: 360,
    message: '失败状态独立显示：接口超时。\n可重试或保留参数，不会丢失其他结果。',
    room: '客厅'
  }
];

const edges = [
  { id: 'demo-e1', from: 'demo-src-1', to: 'demo-gen', port: 'structure', role: 'source' },
  { id: 'demo-e2', from: 'demo-ref', to: 'demo-gen', port: 'style', role: 'style' },
  { id: 'demo-e3', from: 'demo-material', to: 'demo-gen', port: 'material', role: 'material' },
  { id: 'demo-e5', from: 'demo-tool-src', to: 'demo-tool-mark', port: 'image', role: 'flow' },
  { id: 'demo-e6', from: 'demo-tool-src', to: 'demo-tool-inpaint', port: 'image', role: 'flow' },
  { id: 'demo-e7', from: 'demo-tool-src', to: 'demo-tool-panorama', port: 'image', role: 'flow' },
  { id: 'demo-e8', from: 'demo-tool-src', to: 'demo-tool-reverse', port: 'image', role: 'flow' },
  { id: 'demo-e9', from: 'demo-tool-src', to: 'demo-tool-chat', port: 'image', role: 'flow' },
  { id: 'demo-e10', from: 'demo-tool-src', to: 'demo-tool-upscale', port: 'image', role: 'flow' },
  { id: 'demo-e11', from: 'demo-soft', to: 'demo-layout', port: 'soft', role: 'flow' }
];

await writeFile(path.join(outDir, 'Config', 'canvas.json'), JSON.stringify({
  version: 3,
  rooms: {
    客厅: { nodeId: 'demo-result', src: images[1], label: '客厅机位 B · 一致性生成', time: Date.now(), version: Date.now() }
  },
  materials: {
    客厅: {
      floor: { name: '浅灰微水泥', color: '#b9b4ad' },
      wall: { name: '暖白艺术漆', color: '#e7e0d6' },
      cabinet: { name: '浅胡桃木饰面', color: '#8a6c50' },
      ceiling: { name: '哑光暖白', color: '#f1ede6' },
      reference: { src: images[2], name: '材质参考图', w: 0, h: 0, at: Date.now() }
    }
  },
  currentRoom: '客厅',
  stage: { x: 1500, y: 900, scale: 0.42 },
  anchor: 'demo-result',
  nodes,
  edges
}, null, 2), 'utf8');
await writeFile(path.join(outDir, 'Config', 'canvas.journal.jsonl'), '', 'utf8');
await rm(path.join(outDir, 'Config', 'canvas.json.bak'), { force: true });
await rm(path.join(outDir, 'Config', 'canvas.json.tmp'), { force: true });
await writeFile(path.join(outDir, 'project.gw'), JSON.stringify({ version: 1, name: '全节点演示', createdAt: Date.now() }), 'utf8');
console.log(JSON.stringify({ outDir, nodes: nodes.length, edges: edges.length }));
