// 发码台 / 手机签发器 / 定价真源的一致性守护
// 历史 BUG：同一个「¥100 加油包」在三个入口算出三个结果（预设 230、截图 ¥100×2=200、账单 100）；
// 后来又出现「电脑端发 120、手机端发 36」的漂移。现在唯一真源是 pricing-spec.json，
// 这里确保没有任何一端偷偷另存一份数字。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const specPath = path.join(root, 'pricing-spec.json');
const adminPath = path.resolve(root, '..', 'license-admin', 'points-admin.mjs');
const phoneHtml = path.resolve(root, '..', 'license-issuer-android', 'app', 'src', 'main', 'assets', 'index.html');
const hasAdmin = fs.existsSync(adminPath);
const hasPhone = fs.existsSync(phoneHtml);

function readSpec() {
  return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

test('定价真源自洽：8 档、金额唯一、订阅档内测赠分恰为正式期两倍', () => {
  const spec = readSpec();
  assert.equal(spec.plans.length, 8, '档位应固定为 8 个（体验包 / 标准×3 / 高级×3 / 加油包）');

  const prices = spec.plans.map(plan => plan.price);
  assert.equal(new Set(prices).size, prices.length, '有两个档位金额相同，发码台按金额反查会命中错档');

  spec.plans.forEach(plan => {
    const beta = plan.giftPoints.beta;
    const standard = plan.giftPoints.standard;
    assert.ok(Number.isInteger(beta) && beta > 0, plan.key + ' 内测赠分必须是正整数');
    assert.ok(Number.isInteger(standard) && standard > 0, plan.key + ' 正式赠分必须是正整数');
    if (plan.key === 'boost') {
      assert.equal(beta, standard, '加油包是纯算力包，不参与内测加赠，两期面额必须相同');
    } else {
      assert.equal(beta, standard * 2, plan.key + ' 内测期应为正式期的两倍赠分（' + beta + ' vs ' + standard + '）');
    }
  });

  // 赠品成本不能超过订阅价：客户把赠分用光这一单也不能倒贴（1 积分 = 0.27 元上游成本）
  const pointCost = spec.billing.pointCostYuan;
  spec.plans.forEach(plan => {
    const cost = plan.giftPoints.beta * pointCost;
    assert.ok(cost < plan.price, plan.key + ' 内测赠分成本 ¥' + cost.toFixed(2) + ' 超过售价 ¥' + plan.price);
  });
});

test('发码台从真源读档位，不再自己维护第二张表', { skip: !hasAdmin && '本机没有 license-admin 目录' }, () => {
  const source = fs.readFileSync(adminPath, 'utf8');
  assert.match(source, /function loadPricingSpec\(\)/, '发码台必须读 pricing-spec.json');
  assert.match(source, /const POINT_PRESETS = presetsForScope\("beta"\)/, '内测口径必须由真源生成');
  assert.match(source, /const STANDARD_PRESETS = presetsForScope\("standard"\)/, '正式口径必须由真源生成');
  assert.equal(/const POINT_PRESETS = \[\s*\{/.test(source), false, '发码台又写回字面量档位表了，会和画布客户端漂移');
  // 兜底表允许存在（spec 读不到时不能整站起不来），但必须明确标注是兜底
  assert.match(source, /FALLBACK_PLANS/, '缺少 spec 读不到时的兜底表');
});

test('发码台三个入口共用 pointsForAmount(amount, scope)，不再各自折算', { skip: !hasAdmin && '本机没有 license-admin 目录' }, () => {
  const source = fs.readFileSync(adminPath, 'utf8');

  const fill = source.match(/function fillFromEntry\(entry\) \{([\s\S]*?)\n\}/);
  assert.ok(fill, '找不到 fillFromEntry()');
  assert.match(fill[1], /pointsForAmount\(entry\.amount/, '截图识别没走档位表');
  assert.equal(fill[1].includes('entry.amount * 2'), false, '截图识别还在用 ¥1=2 硬算');

  assert.match(source, /suggestedPoints:\s*pointsForAmount\(row\.amount\)/, '账单导入没走档位表');
  assert.equal(source.includes('Math.round(row.amount)'), false, '账单导入还在把金额当积分');

  // 账单点击必须按当前口径重算，不能直接用服务端建议值（服务端不知道页面选的是哪期口径）
  const billClick = source.match(/billList\.querySelectorAll\('button'\)\.forEach\(button => button\.onclick = \(\) => \{([\s\S]*?)\n {4}\}\)/);
  assert.ok(billClick, '找不到账单记录点击逻辑');
  assert.match(billClick[1], /pointsForAmount\(row\.amount, currentScope\)/, '账单录入没有按当前口径重算面额');

  assert.match(source, /POINT_PRESETS\.map\(preset =>/, '预设按钮不是从档位表渲染的');
  assert.match(source, /data-points-standard=/, '预设按钮缺少正式期面额，切换口径会显示旧数字');
});

test('发码台口径切换会写进台账备注', { skip: !hasAdmin && '本机没有 license-admin 目录' }, () => {
  const source = fs.readFileSync(adminPath, 'utf8');
  assert.match(source, /const scope = normalizeScope\(body\.scope\)/, '服务端没有接收口径');
  assert.match(source, /scopeNote/, '台账备注没有记录内测/正式口径，半年后分不清谁是双倍 cohort');
  assert.match(source, /scope:\s*currentScope/, '前端提交没有带上当前口径');
});

test('手机端 8 个面额 = 真源内测口径', { skip: !hasPhone && '本机没有手机签发器目录' }, () => {
  const html = fs.readFileSync(phoneHtml, 'utf8');
  const spec = readSpec();
  const betaPoints = spec.plans.map(plan => plan.giftPoints.beta).sort((a, b) => a - b);

  const phone = Array.from(html.matchAll(/data-points-amount="(\d+)"/g)).map(match => Number(match[1]));
  assert.equal(phone.length, 8, '手机端积分码卡片应有 8 个档位按钮');
  assert.deepEqual(phone.slice().sort((a, b) => a - b), betaPoints, '手机端 8 个面额与真源内测口径不是同一批');

  // 手机端必须引真源，并在加载后按口径重写按钮数字，否则 11-30 之后会继续按双倍发码
  assert.match(html, /<script src="pricing-spec\.js"><\/script>/, '手机端没有引入 pricing-spec.js');
  const appJs = path.resolve(path.dirname(phoneHtml), 'issuer-app.js');
  assert.ok(fs.existsSync(appJs), '找不到 issuer-app.js');
  const appSource = fs.readFileSync(appJs, 'utf8');
  assert.match(appSource, /function applyPricingScope\(\)/, '手机端没有按口径重写面额');
  assert.match(appSource, /data-pricing-scope/, '手机端没有口径切换');
});

test('手机端资源里的真源副本与最新版一致', { skip: !hasPhone && '本机没有手机签发器目录' }, () => {
  const phoneSpec = path.resolve(path.dirname(phoneHtml), 'pricing-spec.js');
  if (!fs.existsSync(phoneSpec)) return;
  const canonical = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const copy = new Function('window', fs.readFileSync(phoneSpec, 'utf8') + '\nreturn window.GW_PRICING;')({});
  assert.deepEqual(copy.plans, canonical.plans, '手机端 pricing-spec.js 副本过期了，重新复制一份');
});
