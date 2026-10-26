import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const count = Number(process.argv[2] || 100);
const outDir = path.resolve(process.argv[3] || `G:/GIWINDESIGN/stress-tests/u${count}`);
const sourceImage = 'G:/GIWINDESIGN/极物GIWIN/909090/Content/content-9adb3dd9-8d60-4a50-9488-11a72b358de0.png';

await mkdir(path.join(outDir, 'Config'), { recursive: true });
await mkdir(path.join(outDir, 'Content'), { recursive: true });

const cols = Math.ceil(Math.sqrt(count * 1.8));
const nodes = [];
const edges = [];
for (let i = 0; i < count; i++) {
  const name = `unique-${String(i).padStart(3, '0')}.png`;
  await copyFile(sourceImage, path.join(outDir, 'Content', name));
  nodes.push({
    id: `unique-${i}`,
    type: 'image',
    src: name,
    label: `唯一图片 ${i + 1}`,
    room: `空间 ${Math.floor(i / 10) + 1}`,
    x: (i % cols) * 320,
    y: Math.floor(i / cols) * 220,
    w: 240,
    h: 152
  });
  if (i > 0) {
    edges.push({ id: `u-edge-${i}`, from: `unique-${i - 1}`, to: `unique-${i}`, role: 'flow', port: 'source' });
  }
}

await writeFile(path.join(outDir, 'Config', 'canvas.json'), JSON.stringify({
  version: 3,
  rooms: {},
  currentRoom: '',
  stage: { x: 40, y: 40, scale: 0.3 },
  anchor: null,
  nodes,
  edges
}), 'utf8');
await writeFile(path.join(outDir, 'Config', 'canvas.journal.jsonl'), '', 'utf8');
await rm(path.join(outDir, 'Config', 'canvas.json.bak'), { force: true });
await rm(path.join(outDir, 'Config', 'canvas.json.tmp'), { force: true });
console.log(JSON.stringify({ outDir, nodes: nodes.length, edges: edges.length }));
