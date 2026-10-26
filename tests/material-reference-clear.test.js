const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('removing a material reference clears the full slot state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  assert.equal((source.match(/delete draft\[slotKey\];/g) || []).length, 2);
  assert.equal((source.match(/data-mat-clear-all/g) || []).length, 4);
  assert.equal((source.match(/已清空全部材质/g) || []).length, 2);
  assert.match(source, /参考图、名称和色调/);
  assert.doesNotMatch(source, /if \(draft\[slotKey\] && draft\[slotKey\]\.ref\) delete draft\[slotKey\]\.ref;/);
});

test('material references can follow the selected tone with adjustable strength', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  assert.match(source, /function materialTintActive\(item, ref\)/);
  assert.match(source, /async function tintedMaterialReferenceDataURL\(src, color, strength/);
  assert.match(source, /data-tone-strength/);
  assert.match(source, /data-tone-hue/);
  assert.match(source, /data-tone-saturation/);
  assert.match(source, /data-tone-lightness/);
  assert.match(source, /mat-tone-preview/);
  assert.match(source, /参考图已按此色调调色/);
  assert.match(source, /entry\.tintFollow && entry\.color/);
  assert.match(source, /analysis\.tintPixels\(frame\.data, color, amount/);
  assert.match(source, /async function sampleMaterialReferenceColor\(src\)/);
  assert.match(source, /class="mat-color-locked"/);
  assert.match(source, /if \(value && !\(value\.ref && value\.ref\.src\)\)/);
  assert.match(source, /if \(color\) \{\s*color\.oninput =/);
});

test('canvas images can be dropped onto a material reference slot', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  assert.match(source, /let acceptedDrop = false[\s\S]*handleCanvasNodeDropOnPanel\(state\.nodes\[0\], client\)/);
  assert.match(source, /const matRefSlot = elements\.map\(el => el\.closest/);
  assert.match(source, /const matRow = elements\.map\(el => el\.closest/);
  assert.match(source, /data-mat-ref-slot/);
  assert.match(source, /applyMaterialReference\(\s*target\.konva\.gwRoom/);
});

test('asset library images can be dropped onto a material reference slot', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const tools = fs.readFileSync(path.join(__dirname, '..', 'studio-tools.js'), 'utf8');
  assert.match(canvas, /assignAssetImagesToMaterialSlot/);
  assert.match(tools, /closest\('\.material-panel'\)/);
  assert.match(tools, /closest\('\[data-mat-ref-slot\]'\)/);
  assert.match(tools, /assignAssetImagesToMaterialSlot\(state\.asset\.images/);
});

test('material categories support presets, recognition matching and scoped prompts', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const providers = fs.readFileSync(path.join(__dirname, '..', 'providers.js'), 'utf8');
  assert.match(canvas, /const MATERIAL_CATEGORY_LIBRARY = Object\.freeze/);
  assert.match(canvas, /<span>类别<\/span>/);
  assert.match(canvas, /list="mat-category-\$\{slot\.key\}"/);
  assert.match(canvas, /normalizeMaterialCategory\(key,/);
  assert.match(canvas, /title: '禁止材质串用'/);
  assert.match(canvas, /composePromptSections\(engineId \|\| 'apollo', model \|\| '', 'material'/);
  assert.match(canvas, /不得将墙面材质复制到吊顶/);
  assert.match(providers, /图中每个带类别标签的材质只作用于对应类别/);
});

test('material panel includes carpet, cushion and skirting with compact layout', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(canvas, /\{ key: 'rug', label: '地毯' \}/);
  assert.match(canvas, /\{ key: 'cushion', label: '靠枕' \}/);
  assert.match(canvas, /\{ key: 'skirting', label: '踢脚线' \}/);
  assert.match(canvas, /\{ key: 'custom', label: '可自定义' \}/);
  assert.match(canvas, /data-mat-surface="\$\{slot\.key\}"/);
  assert.match(canvas, /surface\.oninput = \(\) => \{/);
  assert.match(canvas, /materialSlotLabel\(slot, item\)/);
  assert.match(canvas, /rug: \['浅灰短绒地毯'/);
  assert.match(canvas, /cushion: \['米白布艺靠枕'/);
  assert.match(canvas, /skirting: \['白色踢脚线'/);
  assert.match(canvas, /MATERIAL_SLOTS\.length > 10 \? ' dense'/);
  assert.match(html, /\.mat-rows\.dense \.mat-row \{ height:21px; \}/);
  assert.match(html, /\.gw-node-panel \.mat-rows\.dense input\[data-mat-name\]/);
  assert.match(html, /\.gw-node-panel\.material-panel \.node-footer > \.mat-hint \{ bottom:5px; \}/);
});
