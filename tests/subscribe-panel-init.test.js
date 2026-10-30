// 订阅面板初始化：首次打开就要把三档位的积分画出来。
//
// 2026-10-31 的线上 bug：首次打开订阅面板，三张卡上的积分行是空的，
// 必须点一次「季付」再点回「月付」才会出现。
// 根因是初始化漏调了 applyCycleCopy() —— 只有 paintCycle() 高亮了周期按钮。
//
// 这里不做静态字符串断言，而是把 app.js 里那段真实代码抽出来跑一遍：
// 建一个最小 DOM 替身，执行初始化，再检查三个积分行有没有被填上数字。
// 好处是以后就算有人把 paintCycle / applyCycleCopy 改名或重排，也能拦住。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const lines = app.split('\n');

// 按行区间取源码（1-indexed，闭区间）。
function block(from, to) {
  return lines.slice(from - 1, to).join('\n');
}

// 取出订阅面板初始化用到的真实代码。行号变了会直接炸，属于预期行为：
// 那时就应该由改代码的人来确认初始化顺序还成立。
const source = [
  block(189, 189),   // function pricingSpec()
  block(190, 190),   // function pricingPlans()
  block(191, 195),   // function planByKey()
  block(203, 211),   // function giftScopeNow()
  block(212, 217),   // function giftPointsOf()
  block(1960 + 11, 1988 + 11), // GIFT_SCOPE / giftLine / PAY_PLAN_COPY / payPlans / payCycle
  block(2048 + 11, 2079 + 11)  // paintCycle / applyCycleCopy / setPayCycle / 初始化调用
].join('\n');

// 最小 DOM 替身：只实现这段代码碰得到的部分。
function makeDom() {
  const ids = [
    'set-trial-line', 'set-trial-note', 'set-solo-line', 'set-solo-sub', 'set-solo-price', 'set-solo-unit',
    'set-pro-line', 'set-pro-sub', 'set-pro-price', 'set-pro-unit', 'set-pay-cycle'
  ];
  const store = new Map();
  ids.forEach(id => store.set(id, { id, textContent: '', style: {}, dataset: {} }));
  const body = {
    querySelector(sel) {
      if (!sel.startsWith('#')) return null;
      const el = store.get(sel.slice(1));
      if (!el) return null;
      // 周期按钮容器要给回三个按钮，否则 cycleBtns 为空、paintCycle 无事可做
      if (sel === '#set-pay-cycle') {
        return {
          querySelectorAll() {
            return ['m', 'q', 'y'].map(cycle => ({ dataset: { cycle }, style: {} }));
          }
        };
      }
      return el;
    }
  };
  return { body, store };
}

function runInit(fakeNow) {
  const { body, store } = makeDom();
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'pricing-spec.json'), 'utf8'));
  const sandbox = {
    window: { GW_PRICING: spec },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [fakeNow])); }
      static now() { return new Date(fakeNow).getTime(); }
    },
    body,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;({ payCycle, PAY_PLAN_COPY, payPlans, setPayCycle })', sandbox);
  return {
    // 数字文案都写在 "#id" 的 textContent 里
    trial: store.get('set-trial-line').textContent,
    solo: store.get('set-solo-line').textContent,
    pro: store.get('set-pro-line').textContent,
    soloPrice: store.get('set-solo-price').textContent,
    proPrice: store.get('set-pro-price').textContent
  };
}

test('订阅面板初始化后：三档积分、金额首屏就有数值（不用点周期按钮）', () => {
  // 落在内测期内（清单写的 2026-11-30 之前）
  const r = runInit('2026-11-01T10:00:00');

  assert.match(r.trial, /^\d+ 积分/, '体验包积分行首屏应显示「N 积分 · 30 天」，实际是 ' + JSON.stringify(r.trial));
  assert.match(r.solo, /^\d+ 积分 \/ 月/, '标准档积分行首屏应显示「N 积分 / 月」，实际是 ' + JSON.stringify(r.solo));
  assert.match(r.pro, /^\d+ 积分 \/ 月/, '高级档积分行首屏应显示「N 积分 / 月」，实际是 ' + JSON.stringify(r.pro));

  assert.equal(r.soloPrice, '58', '标准档月付金额应是 58');
  assert.equal(r.proPrice, '168', '高级档月付金额应是 168');
});

test('积分数字来自 pricing-spec.json 的内测期额度，不是写死的', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'pricing-spec.json'), 'utf8'));
  const findClosest = key => (spec.plans || []).find(p => p.key === key);
  const inBeta = runInit('2026-11-01T10:00:00');
  const afterBeta = runInit('2027-01-01T10:00:00');

  const soloPlan = findClosest('solo-m');
  assert.ok(soloPlan, '真源里应该有 solo-m 档');

  const betaPoints = Number(inBeta.solo.match(/^(\d+)/)[1]);
  const standardPoints = Number(afterBeta.solo.match(/^(\d+)/)[1]);
  assert.equal(betaPoints, soloPlan.giftPoints.beta, '首屏显示的应是真源里 beta 期的赠分');
  assert.equal(standardPoints, soloPlan.giftPoints.standard, '过了内测期显示的是 standard 赠分');
  assert.ok(betaPoints === standardPoints * 2, '内测期应是正式期的双倍（' + betaPoints + ' vs ' + standardPoints + '）');
});
