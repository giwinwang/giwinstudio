import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/GIWINDESIGN/test-projects';
const source = join(root, 'reroll-regression-current');
const target = join(root, 'collapse-legacy');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(source, 'Content'), join(target, 'Content'), { recursive: true });
const canvas = JSON.parse(await readFile(join(source, 'Config', 'canvas.json'), 'utf8'));
const card = canvas.nodes.find(node => node.type === 'collapsed');
if (!card || !card.boundaryEdges) {
  throw new Error('The source project must contain a collapsed group with boundary edges');
}
card.template.edges = (card.template.edges || []).concat(card.boundaryEdges);
delete card.boundaryEdges;
const collapsedId = card.id;
canvas.edges = (canvas.edges || []).filter(edge => edge.from !== collapsedId && edge.to !== collapsedId);

await mkdir(join(target, 'Config'), { recursive: true });
await writeFile(join(target, 'Config', 'canvas.json'), JSON.stringify(canvas, null, 2), 'utf8');
await writeFile(join(target, 'project.gw'), JSON.stringify({
  version: 1,
  name: 'collapse-legacy',
  createdAt: Date.now()
}), 'utf8');
console.log(target);
