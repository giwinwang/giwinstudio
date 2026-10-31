// 2026-10-31 实例：客户参考图生成反复失败，后台却已经产生了扣费（0.40 / 7.60 两笔）。
// 日志时间戳还原了真相：
//   16:44:11 发起请求 → 16:45:41 失败：signal timed out（正好 90 秒）
//   16:46:41 再次 signal timed out（剩余 60 秒耗尽）
// 上游出图实测要 124s+（providers.js 自己的注释就写着 edits multipart 124s），
// 而单次 fetch 被 Math.min(90000, …) 硬砍到 90 秒 —— 慢任务必被切断。
// 切断时请求早已送达上游、服务端照常跑完并计费，客户端却连响应头都没拿到，
// 于是报「所有通道都没有收到响应 / 这台电脑连不上引擎接口」，
// 把用户引去换 API Key、折腾代理（用户确实换过 Key，无效），
// 而且切断后还会换下一条路由重打一遍 —— 同一张图被重复下单、重复扣费。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROVIDERS = fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8');
const CANVAS = fs.readFileSync(path.join(ROOT, 'canvas.js'), 'utf8');

test('单次生成请求不能被 90 秒硬上限砍断', () => {
  // 只看实际代码，不要被解释这段历史的注释误伤
  assert.ok(!/fetchSignal\(Math\.max\(5000,\s*Math\.min\(90000/.test(PROVIDERS),
    '单次 fetch 又套回了 90 秒上限：上游出图常要 124s+，会被切在半路，而上游照常计费');
  assert.ok(/fetchSignal\(Math\.max\(5000, requestBudgetMs - \(Date\.now\(\) - requestStartedAt\)\)\)/.test(PROVIDERS),
    '单次请求没有用满剩余预算，慢任务仍会被提前切断');
});

test('超时/长耗时失败后必须停止，不能换路由重打', () => {
  assert.ok(/function isUpstreamTimeout/.test(PROVIDERS), '缺「请求已发出但超时」的判定函数');
  assert.ok(/upstreamTimedOut\s*=\s*true[\s\S]{0,60}break routeLoop/.test(PROVIDERS),
    '超时后没有 break routeLoop：会换下一条路由再下单，同一张图重复扣费');
  assert.ok(/longLivedFailure/.test(PROVIDERS),
    '跑了很久才断开的请求（连接是通的、上游大概率已收到）也应停止重试');
});

test('超时错误必须如实写「可能已计费」并由 providers 抛出', () => {
  assert.ok(/可能已在服务端执行（可能已计费）/.test(PROVIDERS),
    'providers 的报错没说明「可能已计费」，用户会以为没花钱而反复重试');
});

// 把 canvas.js 里的纯函数抽出来真跑一遍：只做源码字符串断言，改坏了文案也测不出来。
function loadFormatGenError() {
  const start = CANVAS.indexOf('function formatGenError(');
  assert.ok(start > 0, 'canvas.js 缺 formatGenError');
  const end = CANVAS.indexOf('\n}\n', start);
  assert.ok(end > start, '无法定位 formatGenError 结尾');
  const src = CANVAS.slice(start, end + 2);
  return new Function(src + '\nreturn formatGenError;')();
}

test('超时文案：说清可能已扣费，且不再误导用户去查网络', () => {
  const fn = loadFormatGenError();
  const real = '参考图生成失败：生成请求超过 150 秒，上游没有返回结果：请求很可能已在服务端执行（可能已计费），请先到后台确认是否已出图，不要立刻重复提交。';
  const out = fn(real);
  assert.ok(/已计费|已在服务端执行/.test(out), '超时文案没提「可能已扣费」：' + out);
  assert.ok(/不要立刻重复提交|重复提交会重复扣费/.test(out), '没提醒别立刻重试（会再扣一次）：' + out);
  assert.ok(!/连不上引擎接口/.test(out), '仍把「上游慢」误报成「连不上引擎」：' + out);
  assert.ok(!/检查网络、代理和接口地址/.test(out), '仍把「上游慢」说成网络问题：' + out);
});

test('真断网时仍然提示检查网络（不能为了修文案把这种情况吞掉）', () => {
  const fn = loadFormatGenError();
  const out = fn('参考图生成失败：Failed to fetch');
  assert.ok(/网络|连接/.test(out), '真断网的提示丢了：' + out);
});
