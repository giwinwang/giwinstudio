const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const canvas = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');
const providers = fs.readFileSync(path.join(root, 'providers.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('plan presentation supports five floor inputs and one style reference', () => {
  assert.match(canvas, /const MAX_GENERATOR_CAMERAS = 4;/);
  assert.match(canvas, /const MAX_PLAN_FLOORS = 5;/);
  assert.match(canvas, /maxSources: MAX_PLAN_FLOORS/);
  assert.match(canvas, /structureInputs\.slice\(0, MAX_PLAN_FLOORS\)/);
  assert.match(canvas, /bindCameraInputFrames\(panel, k, MAX_PLAN_FLOORS, '楼层'\)/);
  assert.match(canvas, /inlineInputFrameHTML\('style'/);
});

test('plan presentation reveals its panel and keeps plan-specific labels', () => {
  assert.match(canvas, /function revealPersistentNodePanelIfClipped/);
  assert.match(canvas, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => revealPersistentNodePanelIfClipped\(group\)\)\)/);
  assert.match(canvas, /allowEmpty: true/);
  assert.match(canvas, /createPlanNode\(source \|\| null, at\)/);
  assert.match(canvas, /const planProjection = planMode/);
  assert.match(canvas, /const resultLabelPrefix = planMode \? planProjection\.name \+ ' · ' \+ styleLabel : styleLabel;/);
  assert.match(canvas, /const removedInputLabel = normalizeDesignMode\(g\.gwParams && g\.gwParams\.designMode\) === DESIGN_MODE_PLAN/);
  assert.match(canvas, /if \(mediaSource\) add\('plan', '平面表现'\)/);
  assert.match(canvas, /if \(kind === 'plan'\) \{\s+createPlanNode\(sourceK, world\);/);
});

test('plan presentation exposes three modes plus a flat color preset', () => {
  assert.match(canvas, /id: 'color', name: '彩平图'/);
  assert.match(canvas, /id: 'axonometric', name: '轴测图'/);
  assert.match(canvas, /id: 'perspective', name: '轻透视鸟瞰'/);
  const styleLists = canvas.match(/color: \[[\s\S]*?\],\s*axonometric: \[[\s\S]*?\],\s*perspective: \[[\s\S]*?\]\s*\}\);/);
  assert.ok(styleLists);
  assert.equal((styleLists[0].match(/id: '(?:plan|axo|bird)-/g) || []).length, 13);
  assert.match(canvas, /id: 'plan-flat', name: '扁平建筑图'/);
  assert.match(canvas, /const PLAN_COLOR_PRESETS/);
  for (const name of ['黑白焦糖', '奶油原木', '灰米侘寂', '鼠尾草绿', '雾霾蓝灰', '摩卡可可']) {
    assert.match(canvas, new RegExp("name: '" + name + "'"));
  }
  assert.match(html, /\.gw-node-panel\.plan-panel/);
  assert.match(html, /\.plan-mode-grid/);
  assert.match(html, /\.plan-style-grid/);
  assert.match(html, /\.plan-style-grid\.many/);
  assert.match(html, /\.plan-palette-grid/);
});

test('plan panel uses a subtle custom scrollbar and needs an explicit material connection', () => {
  assert.match(html, /\.gw-node-panel \.plan-scroll::-webkit-scrollbar[\s\S]*?width:5px/);
  assert.match(html, /\.gw-node-panel \.plan-scroll::-webkit-scrollbar-button[\s\S]*?display:none/);
  assert.match(canvas, /const materialRoom = materialNode[\s\S]*?:\s*\(planMode \? '' : \(source\.konva\.gwRoom \|\| currentRoom\)\)/);
  assert.match(canvas, /if \(materialRoom && \(!materialTakeoverActive \|\| materialNode\)\)/);
});

test('a plan style reference is analyzed and locks preset styling', () => {
  assert.match(canvas, /async function analyzePlanStyleReference/);
  assert.match(canvas, /GWReferenceAnalysis\.analyze\(dataURL\)/);
  assert.match(canvas, /const referenceLocked = !!styleInput/);
  assert.match(canvas, /参考图配色接管/);
  assert.match(canvas, /data-plan-style="\$\{item\.id\}"\$\{referenceLocked \? ' disabled' : ''\}/);
  assert.match(canvas, /data-plan-palette="\$\{item\.id\}"\$\{referenceLocked \? ' disabled' : ''\}/);
  assert.match(canvas, /referenceTakesOver: !!styleReferenceDataURL/);
  assert.match(html, /\.plan-style-grid\.locked/);
  assert.match(html, /\.plan-palette-grid\.locked/);
  assert.match(html, /\.plan-reference-analysis/);
  assert.match(html, /\.plan-floor-slot \.gen-camera-strip \{ height:92px; \}/);
  assert.match(html, /\.plan-input-grid \.ni-input-drop \{ height:92px !important; \}/);
  assert.match(canvas, /图2中的户型、墙体和门窗位置、房间数量、家具平面、构图和透视角度全部忽略，绝不能把图2当作结构图/);
  assert.match(canvas, /if \(context\.referenceURL && !planMode\)/);
  assert.match(canvas, /planMode,\s+materialReferenceDataURL, exteriorReferenceDataURL/);
  assert.match(providers, /const separatePlanStyleRef = !!\(planMode && hasStyleRef && imageDataURL\)/);
  assert.match(providers, /separatePlanStyleRef \? \[styleReferenceDataURL\] : \[\]/);
});

test('plan generation keeps geometry and excludes technical annotation from image output', () => {
  assert.match(canvas, /function planPromptText/);
  assert.match(canvas, /图1是唯一几何基准/);
  assert.match(canvas, /不得新增、删除、移动或重排任何空间结构、家具和固定设施/);
  assert.match(canvas, /不要自行生成尺寸线、面积数字、指北针、动线箭头、房间文字/);
  assert.match(canvas, /当前输出第 ' \+ \(cameraIndex \+ 1\) \+ ' 层/);
  assert.match(canvas, /const unitLabel = planMode \? '楼层' : '机位'/);
  assert.match(canvas, /const minWallHeight = 1200;/);
  assert.match(canvas, /设计墙体高度设定为' \+ wallHeight \+ '毫米/);
  assert.match(canvas, /planWallHeight: 1200/);
  assert.match(canvas, /data-plan-height type="range" min="\$\{minWallHeight\}"/);
  assert.match(canvas, /planPaletteId: 'ink-caramel'/);
  assert.match(canvas, /'流行配色「' \+ palette\.name \+ '」：' \+ palette\.prompt/);
});
