import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const count = Number(process.argv[2] || 800);
const outDir = path.resolve(process.argv[3] || `G:/GIWINDESIGN/stress-tests/p${count}`);
const sourceImage = 'G:/GIWINDESIGN/极物GIWIN/909090/Content/content-85075f9e-9e85-4dc0-bfe3-552f5ab5f2e3.png';
const srcName = 'stress-4k.png';

await mkdir(path.join(outDir, 'Config'), { recursive: true });
await mkdir(path.join(outDir, 'Content'), { recursive: true });
await copyFile(sourceImage, path.join(outDir, 'Content', srcName));

const cols = Math.ceil(Math.sqrt(count * 1.8));
const nodes = [];
const edges = [];
for (let i = 0; i < count; i++) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  nodes.push({
    id: `stress-${i}`,
    type: 'image',
    src: srcName,
    label: `压力测试 ${i + 1}`,
    room: `空间 ${Math.floor(i / 20) + 1}`,
    x: col * 320,
    y: row * 220,
    w: 240,
    h: 135
  });
  if (i > 0) {
    edges.push({
      id: `edge-${i}`,
      from: `stress-${i - 1}`,
      to: `stress-${i}`,
      role: 'flow',
      port: 'source'
    });
  }
}

const state = {
  version: 3,
  rooms: {},
  currentRoom: '',
  stage: { x: 40, y: 40, scale: 0.25 },
  anchor: null,
  nodes,
  edges
};
await writeFile(path.join(outDir, 'Config', 'canvas.json'), JSON.stringify(state), 'utf8');
await writeFile(path.join(outDir, 'Config', 'canvas.journal.jsonl'), '', 'utf8');
await rm(path.join(outDir, 'Config', 'canvas.json.bak'), { force: true });
await rm(path.join(outDir, 'Config', 'canvas.json.tmp'), { force: true });
console.log(JSON.stringify({ outDir, nodes: nodes.length, edges: edges.length }));
