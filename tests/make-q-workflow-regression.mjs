import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/GIWINDESIGN';
const sourceProject = join(root, 'test-projects', 'all-nodes-demo');
const projectPath = join(root, 'test-projects', 'q-workflow-regression');
const images = {
  source1: 'content-05dbb084-59e2-4691-899d-ec5cfc3264c5.jpg',
  source2: 'content-54c06d24-643b-49fc-bcc9-de6dffc1af50.jpg',
  result1: 'content-3a99b678-6e1c-4c34-b15f-c7b9b407434c.png',
  result2: 'content-6986445b-cbd6-446b-9fad-958c4e39e89f.png'
};

await rm(projectPath, { recursive: true, force: true });
await mkdir(join(projectPath, 'Content'), { recursive: true });
await mkdir(join(projectPath, 'Config'), { recursive: true });
for (const filename of Object.values(images)) {
  await copyFile(join(sourceProject, 'Content', filename), join(projectPath, 'Content', filename));
}

const canvas = {
  version: 3,
  rooms: {},
  materials: {},
  currentRoom: '客厅',
  stage: { x: 20, y: 20, scale: 0.72 },
  anchor: null,
  nodes: [
    { id: 'source-1', type: 'image', src: images.source1, label: '结构图 1', room: '客厅', x: 80, y: 100, w: 360, h: 240, ow: 1024, oh: 576 },
    { id: 'source-2', type: 'image', src: images.source2, label: '结构图 2', room: '客厅', x: 80, y: 500, w: 360, h: 240, ow: 1024, oh: 576 },
    {
      id: 'mark-1',
      type: 'tool',
      toolKind: 'mark',
      label: '标记',
      subtitle: '画笔、矩形、箭头',
      source: 'source-1',
      x: 560,
      y: 80,
      w: 430,
      h: 360,
      inlineVersion: 2,
      inlineOps: [{ type: 'rect', start: { x: 40, y: 40 }, end: { x: 140, y: 120 }, points: [] }],
      markCameras: [{
        sourceId: 'source-1',
        ops: [{ type: 'rect', start: { x: 40, y: 40 }, end: { x: 140, y: 120 }, points: [] }],
        promptMode: 'preset',
        promptPreset: 'background',
        prompt: '',
        promptScope: 'shared_plus_local',
        result: '',
        order: 0
      }],
      sharedPrompt: { mode: 'preset', presetId: 'background', prompt: '' },
      activeCamera: 0,
      feather: 5
    },
    {
      id: 'param-1',
      type: 'param',
      x: 560,
      y: 520,
      params: { styleId: 'cream', styleName: '奶油风', model: 'nano-banana-pro', size: '2K', aspect: '16:9', strength: 88 }
    },
    {
      id: 'generator-1',
      type: 'generator',
      x: 1110,
      y: 280,
      params: { styleId: 'cream', styleName: '奶油风', weather: '晴天', engineId: 'apollo', model: 'nano-banana-pro', size: '2K', aspect: '16:9', batch: 1 },
      status: '点击节点编辑参数'
    },
    { id: 'result-1', type: 'image', src: images.result1, label: '奶油风 · 机位 1', room: '客厅', x: 1700, y: 160, w: 640, h: 360, ow: 256, oh: 144 },
    { id: 'result-2', type: 'image', src: images.result2, label: '奶油风 · 机位 2', room: '客厅', x: 1700, y: 600, w: 360, h: 360, ow: 64, oh: 64 }
  ],
  edges: [
    { id: 'e-source-mark', from: 'source-1', to: 'mark-1', port: 'image', role: 'flow' },
    { id: 'e-source-gen', from: 'source-2', to: 'generator-1', port: 'structure', role: 'flow' },
    { id: 'e-mark-gen', from: 'mark-1', to: 'generator-1', port: 'structure', role: 'flow' },
    { id: 'e-param-gen', from: 'param-1', to: 'generator-1', port: 'params', role: 'flow' },
    { id: 'e-gen-result-1', from: 'generator-1', to: 'result-1', port: 'source', role: 'result' },
    { id: 'e-gen-result-2', from: 'generator-1', to: 'result-2', port: 'source', role: 'result' }
  ]
};

await writeFile(join(projectPath, 'Config', 'canvas.json'), JSON.stringify(canvas, null, 2), 'utf8');
await writeFile(join(projectPath, 'project.gw'), JSON.stringify({
  version: 1,
  name: 'q-workflow-regression',
  createdAt: Date.now()
}), 'utf8');
console.log(projectPath);
