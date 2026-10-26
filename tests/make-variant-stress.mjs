import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const count = Number(process.argv[2] || 300);
const outDir = path.resolve(process.argv[3] || `G:/GIWINDESIGN/stress-tests/v${count}`);
const sourceImage = 'G:/GIWINDESIGN/极物GIWIN/909090/Content/content-85075f9e-9e85-4dc0-bfe3-552f5ab5f2e3.png';
const srcName = 'variant-4k.png';

await mkdir(path.join(outDir, 'Config'), { recursive: true });
await mkdir(path.join(outDir, 'Content'), { recursive: true });
await copyFile(sourceImage, path.join(outDir, 'Content', srcName));

const cols = Math.ceil(Math.sqrt(count * 1.6));
const nodes = [];
for (let i = 0; i < count; i++) {
  nodes.push({
    id: `variant-${i}`,
    type: 'variant',
    x: (i % cols) * 450,
    y: Math.floor(i / cols) * 370,
    gwW: 380,
    gwH: 300,
    results: [srcName],
    cur: 0,
    styleName: `方案 ${i + 1}`,
    room: `空间 ${Math.floor(i / 12) + 1}`,
    engine: 'apollo'
  });
}

await writeFile(path.join(outDir, 'Config', 'canvas.json'), JSON.stringify({
  version: 3,
  rooms: {},
  currentRoom: '',
  stage: { x: 40, y: 40, scale: 0.3 },
  anchor: null,
  nodes,
  edges: []
}), 'utf8');
await writeFile(path.join(outDir, 'Config', 'canvas.journal.jsonl'), '', 'utf8');
await rm(path.join(outDir, 'Config', 'canvas.json.bak'), { force: true });
await rm(path.join(outDir, 'Config', 'canvas.json.tmp'), { force: true });
console.log(JSON.stringify({ outDir, nodes: nodes.length }));
