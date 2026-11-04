'use strict';
// 2026-10-31 三机位图生图全部 150 秒超时的事故回归：
//   日志显示主参考图 4096×2304 原样 multipart 上传（10MB+），叠加上游排队全部超时；
//   而报错文案一口咬定「电脑连不上外网」，误导排查（当时连接明明是通的，
//   edits-multi 还收到过网关的非 JSON 响应页）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const providers = fs.readFileSync(path.join(root, 'providers.js'), 'utf8');
const canvas = fs.readFileSync(path.join(root, 'canvas.js'), 'utf8');

test('参考图上传前必须压缩（长边 2048）', () => {
  assert.ok(providers.includes('function shrinkDataUrlForUpload'), 'providers.js 缺少压缩函数');
  // generate() 里必须真的调用：主图、mask（坐标对齐）、多参考列表都要过一遍
  assert.ok(providers.includes('imageDataURL = await shrinkOne(imageDataURL)'), 'generate() 没有压缩主参考图');
  // mask 是唯一的例外：必须单独走 PNG。遮罩语义全在 alpha 通道（透明=要重绘），
  // JPEG 没有透明通道，长边超 2048 的图会被压成整块不透明 → 上游理解成「整张都保留」，
  // 轻则重绘无效、重则原样返回（2026-11-04 定位到的必踩坑，4K 户型图一定触发）。
  assert.ok(providers.includes("maskDataURL = await shrinkDataUrlForUpload(maskDataURL, REF_UPLOAD_MAX_SIDE, 'image/png')"),
    'mask 必须走 PNG 分支，不能跟参考图共用 JPEG');
  assert.ok(!providers.includes('maskDataURL = await shrinkOne(maskDataURL)'),
    'mask 不能再走 shrinkOne，否则透明通道被压掉、遮罩直接失效');
  assert.ok(providers.includes('additionalReferenceDataURLs.map(shrinkOne)'), '多参考列表没有压缩');
  assert.ok(providers.includes('REF_UPLOAD_MAX_SIDE = 2048'), '压缩上限应为 2048');
  // 压缩必须发生在比例/档位判定之后（effectiveSize 计算在前）——上面顺序由代码位置保证，
  // 这里兜底确认判定用的 refSize 读取仍在压缩函数定义之前出现
  assert.ok(providers.indexOf('readImageSize(imageDataURL)') < providers.indexOf('shrinkOne(imageDataURL)'),
    '尺寸判定应基于原图（readImageSize 在压缩之前）');
});

test('超时文案必须区分「上游慢」和「断网」两种情况', () => {
  assert.ok(providers.includes('sawServerResponse = true'), '没有记录「收到过响应」状态');
  assert.ok(providers.includes('连接是通的'), '缺少「上游慢」分支文案（不能一律怪断网）');
  assert.ok(providers.includes('所有通道在'), '保留「完全没响应」的断网分支');
  // canvas.js 的短文案映射也要分开，且不能保留过期的「120 秒」
  assert.ok(canvas.includes('上游排队超时'), 'canvas.js 缺少上游排队分支');
  assert.ok(!canvas.includes('120 秒内所有通道'), 'canvas.js 还留着过期文案「120 秒」');
  // 专用规则必须排在通用 /超时|timeout/ 之前，否则被截胡成死代码
  const specific = canvas.indexOf('生成请求超过|已停止继续尝试');
  const generic = canvas.indexOf('/超时|timeout/i');
  assert.ok(specific > 0 && generic > 0 && specific < generic, '「生成请求超过」映射必须排在通用超时映射之前');
});
