import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/GIWINDESIGN/test-projects';
const source = join(root, 'reroll-regression-current');
const target = join(root, 'reroll-regression-legacy');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(source, 'Content'), join(target, 'Content'), { recursive: true });

const canvas = JSON.parse(await readFile(join(source, 'Config', 'canvas.json'), 'utf8'));
const resultNodes = canvas.nodes.filter(node => /^result-\d+$/.test(node.id));
if (resultNodes.length !== 4) throw new Error('Expected four generated result nodes');
const idMap = new Map();
const baseTime = 1793000000000;
resultNodes.forEach((node, index) => {
  const legacyId = 'n' + (baseTime + index * 8000) + 'legacy' + (index + 1);
  idMap.set(node.id, legacyId);
  node.id = legacyId;
  delete node.generationContext;
  delete node.gwCreatedAt;
});
canvas.edges.forEach(edge => {
  if (idMap.has(edge.from)) edge.from = idMap.get(edge.from);
  if (idMap.has(edge.to)) edge.to = idMap.get(edge.to);
});
resultNodes.forEach((node, index) => {
  const clone = JSON.parse(JSON.stringify(node));
  clone.id = 'n' + (baseTime + 30 * 60 * 1000 + index * 8000) + 'later' + (index + 1);
  clone.x += 900;
  canvas.nodes.push(clone);
  canvas.edges.push({
    id: 'edge-result-later-' + (index + 1),
    from: 'generator',
    to: clone.id,
    port: 'source',
    role: 'result'
  });
});

await mkdir(join(target, 'Config'), { recursive: true });
await writeFile(join(target, 'Config', 'canvas.json'), JSON.stringify(canvas, null, 2), 'utf8');
await writeFile(join(target, 'project.gw'), JSON.stringify({
  version: 1,
  name: 'reroll-regression-legacy',
  createdAt: Date.now()
}), 'utf8');
console.log(target);
