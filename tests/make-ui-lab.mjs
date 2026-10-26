import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'G:/GIWINDESIGN/test-projects/ui-lab');
const sourceDir = 'G:/GIWINDESIGN/极物GIWIN/909090/Content';
const images = [
  'content-85075f9e-9e85-4dc0-bfe3-552f5ab5f2e3.png',
  'content-7e99eb0d-7e4b-46ab-8323-bb68b5439ac1.png',
  'content-ab32c66e-58c6-4360-9086-b78017da96a0.jpg'
];

await mkdir(path.join(outDir, 'Config', 'versions'), { recursive: true });
await mkdir(path.join(outDir, 'Content'), { recursive: true });
for (const name of images) await copyFile(path.join(sourceDir, name), path.join(outDir, 'Content', name));

const nodes = [
  { id: 'ui-img-1', type: 'image', src: images[0], label: '客厅结构图', room: '客厅', x: -900, y: -420, w: 560, h: 315 },
  { id: 'ui-img-2', type: 'image', src: images[1], label: '卧室结构图', room: '主卧', x: -900, y: 80, w: 560, h: 376 },
  { id: 'ui-var-1', type: 'variant', x: -240, y: -420, gwW: 420, gwH: 340, results: [images[2]], cur: 0, styleName: '奶油风方案', room: '客厅', engine: 'apollo' },
  { id: 'ui-var-2', type: 'variant', x: -240, y: 40, gwW: 420, gwH: 340, results: [images[1]], cur: 0, styleName: '现代简约方案', room: '客厅', engine: 'apollo' },
  { id: 'ui-var-3', type: 'variant', x: 240, y: 40, gwW: 420, gwH: 340, results: [images[2]], cur: 0, styleName: '主卧方案', room: '主卧', engine: 'apollo' }
];

await writeFile(path.join(outDir, 'Config', 'canvas.json'), JSON.stringify({
  version: 3,
  rooms: {},
  materials: {},
  currentRoom: '客厅',
  stage: { x: 1250, y: 720, scale: 0.55 },
  anchor: null,
  nodes,
  edges: []
}, null, 2), 'utf8');
await writeFile(path.join(outDir, 'Config', 'canvas.journal.jsonl'), '', 'utf8');
await rm(path.join(outDir, 'Config', 'canvas.json.bak'), { force: true });
await rm(path.join(outDir, 'Config', 'canvas.json.tmp'), { force: true });
await writeFile(path.join(outDir, 'project.gw'), JSON.stringify({ version: 1, name: 'UI-Lab', createdAt: Date.now() }), 'utf8');
console.log(JSON.stringify({ outDir, nodes: nodes.length }));
