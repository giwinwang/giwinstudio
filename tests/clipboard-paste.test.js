// 系统剪贴板粘贴通道。
//
// 背景：Snipaste、微信输入法的剪贴板同步、资源管理器"复制文件"这些场景，
// 剪贴板里只有文件引用（CF_HDROP），没有位图。此时 clipboard.readImage() 返回空图，
// 旧实现直接静默 return，用户看到的就是"复制了但粘不进去"，还会误以为是画布坏了。
// 这里把「两条通道都要接住 + 读不到要说明原因」钉住。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CANVAS = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadFileListFilter() {
  const extMatch = CANVAS.match(/const CLIPBOARD_IMAGE_EXT = (\/[^\n]+?\/i);/);
  assert.ok(extMatch, 'canvas.js 缺少 CLIPBOARD_IMAGE_EXT');
  const start = CANVAS.indexOf('function clipboardImageFileList(');
  assert.ok(start > 0, 'canvas.js 缺少 clipboardImageFileList');
  const end = CANVAS.indexOf('\n  }', start);
  assert.ok(end > start, 'clipboardImageFileList 结构异常');
  const body = CANVAS.slice(start, end + 4);
  return new Function('CLIPBOARD_IMAGE_EXT', body + '\nreturn clipboardImageFileList;')(eval(extMatch[1]));
}

test('画布监听 paste 事件，从 DataTransfer 取文件，位图路径保留为兜底', () => {
  assert.match(CANVAS, /document\.addEventListener\('paste'/);
  assert.match(CANVAS, /clipboardImageFileList/);
  assert.match(CANVAS, /readImageFileDataURL/);
  assert.match(CANVAS, /clipboard\.readImage\(\)/);
});

test('只有剪贴板可能含图片时才接管，纯文本粘贴不弹提示', () => {
  assert.match(CANVAS, /const maybeImage = candidates\.length > 0 \|\| formats\.some/);
  assert.match(CANVAS, /if \(!maybeImage\) return;/);
});

test('输入框内粘贴交给输入框，画布内部复制不会重复贴两遍', () => {
  assert.match(CANVAS, /if \(isEditableActiveElement\(\)\) return;/);
  assert.match(CANVAS, /internalPasteAt = Date\.now\(\)/);
  assert.match(CANVAS, /Date\.now\(\) - internalPasteAt < 600/);
});

test('Ctrl+V 不再只认位图，给 paste 事件留了等待窗口', () => {
  assert.match(CANVAS, /lastPasteEventAt = Date\.now\(\)/);
  assert.match(CANVAS, /Date\.now\(\) - lastPasteEventAt < 320/);
});

test('主进程提供 clipboard:paste，右键菜单也能走文件引用通道', () => {
  assert.match(MAIN, /ipcMain\.handle\('clipboard:paste'/);
  assert.match(MAIN, /target\.paste\(\)/);
  assert.match(CANVAS, /ipcRenderer\.invoke\('clipboard:paste'\)/);
});

test('剪贴板里只有文件路径时，提示要说明原因和出路', () => {
  assert.match(CANVAS, /剪贴板里只有文件路径/);
  assert.match(CANVAS, /微信输入法/);
});

test('文件列表过滤器认扩展名也认 MIME，且能扛住空值', () => {
  const filter = loadFileListFilter();
  const keep = filter([
    { name: 'a.png', type: '' },
    { name: 'b.JPG', type: '' },
    { name: 'noext', type: 'image/webp' },
    { name: 'shot.jpeg', type: 'application/octet-stream' }
  ]);
  assert.equal(keep.length, 4);

  const drop = filter([
    { name: 'notes.txt', type: 'text/plain' },
    { name: 'archive.zip', type: '' },
    null
  ]);
  assert.equal(drop.length, 0);
  assert.equal(filter(null).length, 0);
  assert.equal(filter(undefined).length, 0);
});
