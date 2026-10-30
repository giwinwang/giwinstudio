// 授权条档位联动：买了哪档就显示哪档，不再一律写「内测」。
//
// 2026-10-31 用户发现的问题：授权条标题写死「内测授权已激活」，买了标准版/高级版
// 之后还是这么显示（天数和到期日倒是实时联动的）。
// 修复点：app.js 的 licenseTierLabel + 三处调用，main.js 的 status.message 两处。
// 这条测试用真实执行的映射函数 + 静态断言「联动点必须走函数」双保险。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

// 从 app.js 里抽出真实的 licenseTierLabel 执行（改名/挪位置时这里会炸，属预期提醒）
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'app.js 里找不到 function ' + name + '()，可能被改名了，请同步更新本测试');
  let depth = 0, end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  return source.slice(start, end);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFunction(app, 'licenseTierLabel'), sandbox);
const tierLabel = sandbox.licenseTierLabel;

test('licenseTierLabel：各档位中文名映射', () => {
  assert.equal(tierLabel('beta'), '内测授权', 'beta 保持旧文案「内测授权」，兼容历史显示');
  assert.equal(tierLabel(undefined), '内测授权', '缺 edition 时按内测兜底');
  assert.equal(tierLabel('trial'), '体验包');
  assert.equal(tierLabel('solo'), '标准版');
  assert.equal(tierLabel('pro'), '高级版');
  assert.equal(tierLabel('team'), '团队版', '历史档也识别');
  assert.equal(tierLabel('STANDARD'), '标准版', '大小写不敏感（发码端历史码可能有大写）');
});

test('app.js 三个联动点都必须走 licenseTierLabel，不许再写死「内测授权」', () => {
  // 1) 状态栏 licenseStatusText
  assert.match(app, /if \(status\.valid\) return licenseTierLabel\(status\.license && status\.license\.edition\) \+ ' · 剩余 '/,
    '状态栏剩余天数前缀要按档位显示');
  // 2) 设置页授权条标题
  assert.match(app, /status\.valid \? licenseTierLabel\(status\.license && status\.license\.edition\) \+ '已激活'/,
    '授权条标题要按档位显示（买标准版不能再叫「内测授权已激活」）');
  // 3) 设置页详情行不再显示英文 edition
  assert.doesNotMatch(app, /'版本 ' \+ \(status\.license\.edition \|\| 'beta'\)/,
    '详情行不该把英文 edition 直接亮给用户');
});

test('main.js 的 status.message 两处都要按档位拼接', () => {
  assert.match(main, /message: licenseTierLabel\(result\.license\.edition\) \+ '已到期'/, '到期 message 要按档位');
  assert.match(main, /message: licenseTierLabel\(result\.license\.edition\) \+ \(result\.code === 'expired' \? '有效 · 邀请奖励续期' : '有效'\)/,
    '有效 message 要按档位（beta 仍拼出「内测授权有效」）');
  assert.ok(!/message: '内测授权已到期'/.test(main), '不许再有写死的「内测授权已到期」');
  assert.ok(!/message: result\.code === 'expired' \? '邀请奖励续期有效' : '内测授权有效'/.test(main),
    '不许再有写死的三元 message');
});
