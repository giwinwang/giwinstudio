import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/GIWINDESIGN';
const sourceProject = join(root, 'test-projects', 'all-nodes-demo');
const projectPath = join(root, 'test-projects', 'panorama-regression');
const image = 'content-05dbb084-59e2-4691-899d-ec5cfc3264c5.jpg';

await rm(projectPath, { recursive: true, force: true });
await mkdir(join(projectPath, 'Content'), { recursive: true });
await mkdir(join(projectPath, 'Config'), { recursive: true });
await copyFile(join(sourceProject, 'Content', image), join(projectPath, 'Content', image));

const canvas = {
  version: 3,
  rooms: {},
  materials: {},
  currentRoom: '客厅',
  stage: { x: 40, y: 30, scale: 0.95 },
  anchor: null,
  nodes: [
    { id: 'panorama-source', type: 'image', src: image, label: '全景源图', room: '客厅', x: 80, y: 120, w: 430, h: 300, ow: 1024, oh: 576 },
    {
      id: 'panorama-tool',
      type: 'tool',
      toolKind: 'panorama',
      label: '360° 全景',
      subtitle: '环视与缩放预览',
      source: 'panorama-source',
      x: 590,
      y: 120,
      w: 430,
      h: 360,
      inlineVersion: 2,
      inlineOps: [],
      feather: 5
    }
  ],
  edges: [
    { id: 'panorama-edge', from: 'panorama-source', to: 'panorama-tool', port: 'image', role: 'flow' }
  ]
};

await writeFile(join(projectPath, 'Config', 'canvas.json'), JSON.stringify(canvas, null, 2), 'utf8');
await writeFile(join(projectPath, 'project.gw'), JSON.stringify({
  version: 1,
  name: 'panorama-regression',
  createdAt: Date.now()
}), 'utf8');
console.log(projectPath);
