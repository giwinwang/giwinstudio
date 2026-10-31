// 2026-10-31 用户反馈：「双击图片后下载出错，右击图片下载也出错，复制图片也出错」，
// 加上项目图片全是 content-<uuid>.png，不进目录根本不知道图在哪。
//
// 三个入口其实是同一条链：最终都要求拿到 data:image。
// 但节点图片源可能是 http 地址、content-<uuid>.png 文件名或 blob，
// 直接当 dataURL 往下传就会：
//   - nativeImage.createFromDataURL(...) → 空图 → 「图片格式无法复制」
//   - export:png 里 dataURL.split(',')[1] → undefined → Buffer.from 抛错 → 前端只剩「下载失败」
// 另外复制走的是渲染进程的 nativeImage/clipboard，而主进程早就有一个
// clipboard:writeImage 没被用上 —— 这类静默失败根本拿不到错误原因。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CANVAS = fs.readFileSync(path.join(ROOT, 'canvas.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('复制图片必须走主进程，不能在渲染进程直连 nativeImage', () => {
  assert.ok(!/nativeImage\.createFromDataURL/.test(CANVAS),
    '渲染进程又直接用 nativeImage 了：图片格式对不上时会静默失败，拿不到原因');
  assert.ok(CANVAS.includes("ipcRenderer.invoke('clipboard:writeImage'"),
    '复制没走主进程 clipboard:writeImage');
});

test('导出前必须把图片源转成真正的 data:image', () => {
  assert.ok(/function ensureImageDataURL/.test(CANVAS), '缺 ensureImageDataURL：非 dataURL 的来源没被兜住');
  assert.ok(/await ensureImageDataURL\(/.test(CANVAS), '导出链路没用 ensureImageDataURL');
});

test('export:png 要拦下非 dataURL 输入并说明原因', () => {
  assert.ok(MAIN.includes('/^data:image\\/[a-z0-9.+-]+;base64,/i'),
    '主进程没校验 dataURL 前缀，非法输入仍会掉进 split → undefined 的坑');
  assert.ok(MAIN.includes('导出图片失败'), '没给出可读的失败提示');
});

test('三个新入口都在：在文件夹中显示 / 打开项目文件夹 / 按可读名导出', () => {
  assert.ok(MAIN.includes("ipcMain.handle('project:revealImage'"), '缺 project:revealImage');
  assert.ok(MAIN.includes("ipcMain.handle('project:openFolder'"), '缺 project:openFolder');
  assert.ok(MAIN.includes("ipcMain.handle('project:exportImages'"), '缺 project:exportImages');
  assert.ok(/shell\.showItemInFolder\(/.test(MAIN), 'revealImage 没调 showItemInFolder');
  assert.ok(/shell\.openPath\(/.test(MAIN), 'openFolder 没调 shell.openPath');
});

test('上送文件名必须做 basename，防止目录穿越', () => {
  const start = MAIN.indexOf("ipcMain.handle('project:revealImage'");
  assert.ok(start > 0, '缺 project:revealImage');
  const seg = MAIN.slice(start, start + 900);
  assert.ok(/path\.basename\(/.test(seg),
    'revealImage 没做 basename：name 传 ../ 就能定位到项目外');
});

test('悬浮栏与右键菜单都能「在文件夹中显示」', () => {
  assert.ok(CANVAS.includes("makeButton('folder', '在文件夹中显示')"), '悬浮栏缺 folder 按钮');
  assert.ok(CANVAS.includes('data-a="folder">在文件夹中显示'), '大图查看器右键缺「在文件夹中显示」');
  assert.ok(CANVAS.includes("act === 'folder'"), 'folder 动作没有处理分支');
  assert.ok(/function revealImageInFolder/.test(CANVAS), '缺 revealImageInFolder');
});

test('导出副本只能复制，不能动 Content 里的原文件', () => {
  const start = MAIN.indexOf("ipcMain.handle('project:exportImages'");
  assert.ok(start > 0, '缺 project:exportImages');
  const seg = MAIN.slice(start, start + 1700);
  assert.ok(/copyFileSync/.test(seg), '导出应该是复制');
  assert.ok(!/renameSync|unlinkSync/.test(seg),
    '导出过程不能重命名或删除原文件：project.gw 还按 content-<uuid>.png 引用着，改了会断图');
});

test('左侧画布图片列表有打开文件夹与导出图片入口', () => {
  assert.ok(HTML.includes('id="project-folder-actions"'), '缺入口容器');
  assert.ok(HTML.includes('data-project-action="open-folder"'), '缺「打开文件夹」按钮');
  assert.ok(HTML.includes('data-project-action="export-images"'), '缺「导出图片」按钮');
});
