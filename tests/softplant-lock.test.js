// 软装植入的「开发中」锁定。
//
// 功能本身已经跑通，但先不对用户开放：入口留在右键菜单里可见、带「开发中」标注，
// 点了只给提示、不建节点。这里把这条约束钉住，避免两种情况：
//   1. 有人顺手把开关改成 true 就发版，功能提前漏出去；
//   2. 有人只改文案忘了拦截，菜单写着「开发中」却真能建出来。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CANVAS = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');

function block(from, to) {
  const start = CANVAS.indexOf(from);
  assert.ok(start > 0, 'canvas.js 找不到锚点：' + from);
  const end = to ? CANVAS.indexOf(to, start + from.length) : -1;
  return CANVAS.slice(start, end > 0 ? end : start + 800);
}

test('功能开关默认关闭，且只有一处定义', () => {
  const defs = CANVAS.match(/const SOFT_PLANT_RELEASED\s*=\s*(true|false)/g) || [];
  assert.equal(defs.length, 1, 'SOFT_PLANT_RELEASED 只能定义一次，多处定义会各自为政');
  assert.match(defs[0], /=\s*false$/, '当前应当锁着（false）；确认要开放时再改，不要顺手改掉');
});

test('锁定提示不建节点、不弹错误红条', () => {
  const fn = block('function softPlantLocked()', '\n}\n');
  assert.match(fn, /if \(SOFT_PLANT_RELEASED\) return false/, '已解锁时必须直接放行');
  assert.match(fn, /toast\(/, '锁定时要告诉用户为什么点不动，不能静默');
  assert.match(fn, /开发中/, '提示文案要明确说在开发中');
  assert.doesNotMatch(fn, /toast\([^)]*,\s*true\)/, '这是「暂未开放」不是错误，别用红色报错样式');
  assert.doesNotMatch(fn, /createSoftPlantNode/, '提示函数里不能顺手创建节点');
});

test('右键菜单入口保持可见，并标注「开发中」', () => {
  const menu = block("ctxButton('soft', '软装植入节点（选品→出图）'");
  assert.ok(menu.length > 20, '右键菜单里必须有软装植入入口——需求是「可以看到」，不是整个藏起来');
  assert.match(menu, /SOFT_PLANT_RELEASED \? '' : '开发中'/, '锁定时要在入口上标出「开发中」，解锁后自动去掉');
});

test('两个新建入口都先过锁定判断', () => {
  const menuHandler = block("if (a === 'softplant') {", 'if (a === \'fit\')');
  assert.match(menuHandler, /^\s*if \(a === 'softplant'\) \{\s*\n\s*if \(softPlantLocked\(\)\) return;/,
    '右键菜单入口必须先判断锁定，否则点了会直接建节点');

  const actionHandler = block("if (act === 'softplant') {");
  assert.match(actionHandler.split('\n')[0], /if \(softPlantLocked\(\)\) return;/,
    '菜单动作分派（doAction）是另一个入口，漏掉这里会绕过锁定');
});

test('锁定只拦新建：已存在的节点与调试通道照常可用', () => {
  // 打开编辑器不设闸，否则用户已有的软装植入节点会打不开
  const editor = block('function openSoftPlantEditor(', '\n}\n');
  assert.doesNotMatch(editor, /softPlantLocked|SOFT_PLANT_RELEASED/, '锁的是新建入口，不能把已有节点的编辑器一起锁死');

  // 冒烟与自动化仍需要能直接建节点
  const exported = block('  createSoftPlantNode: (at, options) => {');
  assert.ok(exported.length > 10, 'GWCanvas.createSoftPlantNode 调试导出要保留，否则冒烟脚本无法验证');
});
