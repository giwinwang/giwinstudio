import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'G:/GIWINDESIGN/test-projects/light-switch-ui');
await mkdir(path.join(outDir, 'Config', 'versions'), { recursive: true });
await mkdir(path.join(outDir, 'Content'), { recursive: true });
await writeFile(path.join(outDir, 'Config', 'canvas.json'), JSON.stringify({
  version: 3,
  rooms: {},
  materials: {},
  currentRoom: '客厅',
  stage: { x: 760, y: 430, scale: 0.9 },
  anchor: null,
  nodes: [{
    id: 'light-ui',
    type: 'light',
    x: 0,
    y: 0,
    light: {
      presetId: 'weather',
      name: '冷调柔光',
      intensity: 45,
      temperature: 6200,
      softness: 78,
      direction: '窗侧主光',
      weather: '雨天',
      lightingMode: 'on',
      lightingGroups: ['cove'],
      note: '',
      exteriorAffectLight: true,
      exteriorPreset: 'original',
      exteriorName: '保留原图',
      exteriorPrompt: '',
      exterior: null
    }
  }],
  edges: []
}, null, 2), 'utf8');
await writeFile(path.join(outDir, 'Config', 'canvas.journal.jsonl'), '', 'utf8');
await rm(path.join(outDir, 'Config', 'canvas.json.bak'), { force: true });
await rm(path.join(outDir, 'Config', 'canvas.json.tmp'), { force: true });
await writeFile(path.join(outDir, 'project.gw'), JSON.stringify({
  version: 1,
  name: 'Light Switch UI',
  createdAt: Date.now()
}), 'utf8');
console.log(JSON.stringify({ outDir, node: 'light-ui' }));
