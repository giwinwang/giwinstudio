import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/GIWINDESIGN';
const sourceProject = join(root, 'test-projects', 'all-nodes-demo');
const projectPath = join(root, 'test-projects', 'reroll-regression-current');
const contentPath = join(projectPath, 'Content');
const configPath = join(projectPath, 'Config');
const images = {
  source1: 'content-05dbb084-59e2-4691-899d-ec5cfc3264c5.jpg',
  source2: 'content-54c06d24-643b-49fc-bcc9-de6dffc1af50.jpg',
  source3: 'content-2b0c888e-6167-4f28-b8c0-e2b33100eaa3.jpg',
  source4: 'content-63de0ffb-e07e-432f-abd2-411b05cd80bf.jpg',
  result1: 'content-3a99b678-6e1c-4c34-b15f-c7b9b407434c.png',
  result2: 'content-6986445b-cbd6-446b-9fad-958c4e39e89f.png',
  result3: 'content-6d305b55-0e29-416d-ba98-d986b37e57ff.png',
  result4: 'content-ad0aa6ed-211c-41ae-86b4-e771c01642b4.png'
};

await rm(projectPath, { recursive: true, force: true });
await mkdir(contentPath, { recursive: true });
await mkdir(configPath, { recursive: true });
for (const filename of Object.values(images)) {
  await copyFile(join(sourceProject, 'Content', filename), join(contentPath, filename));
}

const prompt = [
  '将结构图改造成奶油风室内空间，严格保持户型、墙体、门窗、家具位置和相机角度不变。',
  '只统一材质、色彩、光影和软装气质，不得添加、删除或移动物体。'
].join('');
const params = {
  styleId: 'cream',
  styleName: '奶油风空间方案',
  blocks: {
    time: '下午 · 柔光',
    view: '无外景',
    people: '无',
    light: '自然柔光'
  },
  weather: '晴天',
  constraint: '保持结构、家具位置和相机角度不变',
  strength: 88,
  size: '2K',
  aspect: '16:9',
  engineId: 'apollo',
  model: 'nano-banana-pro',
  batch: 1
};
const changedGeneratorParams = {
  ...params,
  styleId: 'modern',
  styleName: '现代简约',
  size: '1K',
  model: 'seedream-v5-pro',
  batch: 4
};

const nodes = [];
for (let index = 0; index < 4; index++) {
  nodes.push({
    id: `source-${index + 1}`,
    type: 'image',
    src: images[`source${index + 1}`],
    label: `结构机位 ${index + 1}`,
    room: '客厅',
    x: 80,
    y: 80 + index * 420,
    w: 360,
    h: 240,
    ow: 1024,
    oh: 576
  });
}
nodes.push({
  id: 'generator',
  type: 'generator',
  x: 560,
  y: 500,
  params: changedGeneratorParams,
  status: '上游参数已改变，单张重绘仍应使用原图快照'
});
for (let index = 0; index < 4; index++) {
  const resultImage = images[`result${index + 1}`];
  const isLarge = index === 0;
  nodes.push({
    id: `result-${index + 1}`,
    type: 'image',
    src: resultImage,
    label: `奶油风空间方案 · 机位 ${index + 1}`,
    x: 1080,
    y: 80 + index * 300,
    w: isLarge ? 640 : 360,
    h: 360,
    ow: isLarge ? 256 : 64,
    oh: isLarge ? 144 : 64,
    gwConfirmed: index === 1,
    generationContext: {
      version: 1,
      generatorId: 'generator',
      generationRunId: 'genrun-reroll-regression',
      generatorName: '奶油风空间方案 · NanoBanana Pro',
      cameraIndex: index,
      cameraNumber: index + 1,
      variantIndex: 0,
      variantNumber: 1,
      sourceNodeId: `source-${index + 1}`,
      markNodeId: '',
      markSourceNodeId: '',
      markInstruction: '',
      styleNodeId: '',
      referenceKind: '',
      materialRoom: '',
      engineId: 'apollo',
      model: 'nano-banana-pro',
      size: '2K',
      aspect: '16:9',
      sourceSize: { w: 1024, h: 576 },
      prompt,
      recipe: { ...params },
      paramsSnapshot: { ...params },
      createdAt: new Date(2026, 9, 21, 10, index).toISOString()
    }
  });
}

const edges = [];
for (let index = 0; index < 4; index++) {
  edges.push({
    id: `edge-source-${index + 1}`,
    from: `source-${index + 1}`,
    to: 'generator',
    port: 'structure',
    role: 'source'
  });
  edges.push({
    id: `edge-result-${index + 1}`,
    from: 'generator',
    to: `result-${index + 1}`,
    port: 'source',
    role: 'result'
  });
}

const canvas = {
  version: 3,
  rooms: {},
  materials: {},
  currentRoom: '客厅',
  stage: { x: 20, y: 20, scale: 0.72 },
  anchor: null,
  nodes,
  edges
};

await writeFile(join(configPath, 'canvas.json'), JSON.stringify(canvas, null, 2), 'utf8');
await writeFile(join(projectPath, 'project.gw'), JSON.stringify({
  version: 1,
  name: 'reroll-regression',
  createdAt: Date.now()
}), 'utf8');
console.log(projectPath);
