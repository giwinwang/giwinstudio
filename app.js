// 极物 GIWIN Studio · 外壳逻辑（M1）
const { ipcRenderer } = require('electron');
const APP_VERSION = require('./package.json').version;
const DEV_ENTITLEMENTS_ENABLED = process.argv.includes('--gw-dev-entitlements');
const PACKAGED_BUILD = process.argv.includes('--gw-packaged');
// 内部自测开关：设了环境变量 GW_COPILOT_UNLOCK=1 就无条件放开粒子魔方。
// 只影响设了变量的那台机器，不改变对外行为（可随时删变量恢复）。
const COPILOT_UNLOCK_ENV = (() => {
  try { return process.env.GW_COPILOT_UNLOCK === '1'; } catch (error) { return false; }
})();
const DEV_ENTITLEMENT_STORAGE_KEY = 'gw_dev_entitlement_mode';
const DEV_ENTITLEMENT_LABELS = {
  beta: '内测未订阅',
  team: '工作室全部功能'
};
const $ = id => document.getElementById(id);
const bundledFontsReady = (() => {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.allSettled([
    document.fonts.load('400 13px "GIWIN Sans"'),
    document.fonts.load('500 13px "GIWIN Sans"'),
    document.fonts.load('600 13px "GIWIN Sans"'),
    document.fonts.load('700 13px "GIWIN Sans"'),
    document.fonts.load('600 27px "GIWIN Serif"'),
    document.fonts.load('700 27px "GIWIN Serif"')
  ]);
})();

let account = null;
let currentProject = null;
let licenseState = null;
let licenseCheckTimer = null;
let devEntitlementMode = (() => {
  if (!DEV_ENTITLEMENTS_ENABLED) return 'beta';
  try {
    return localStorage.getItem(DEV_ENTITLEMENT_STORAGE_KEY) === 'team' ? 'team' : 'beta';
  } catch (error) {
    return 'beta';
  }
})();
if (DEV_ENTITLEMENTS_ENABLED) {
  ipcRenderer.invoke('dev:entitlement-mode', devEntitlementMode).catch(() => {});
}
window.GWProjectState = {
  hasProject: () => Boolean(currentProject),
  getCurrent: () => currentProject
};
const PROJECT_TABS_STORAGE_PREFIX = 'gw_project_tabs_v1:';
let projectTabs = [];
let activeProjectTabId = null;
let switchingProjectTabId = null;
let projectSwitchChain = Promise.resolve();
let projectPrefetchTimer = null;
let renameProjectId = null;
let projectTabDragId = null;
let authMode = 'login';
let setPage = 'interface';

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('gw_theme', t);
  if (window.GWCanvas) GWCanvas.themeChanged();
  updateThemeRailButton();
}
function updateThemeRailButton() {
  const button = document.getElementById('gw-theme-toggle');
  if (!button || !window.GWIcon) return;
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  const label = dark ? '切换到浅色主题' : '切换到深色主题';
  button.innerHTML = window.GWIcon.svg(dark ? 'sun' : 'moon', 19);
  button.dataset.tip = label;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', dark ? 'true' : 'false');
}
setTheme(localStorage.getItem('gw_theme') || 'dark');

let splashAudio = null;
function playSplashSound(preview = false) {
  if (!preview && localStorage.getItem('gw_splash_sound') === 'off') return;
  try {
    if (!splashAudio) {
      splashAudio = new Audio('splash-start.wav');
      splashAudio.preload = 'auto';
      splashAudio.volume = 0.68;
    }
    splashAudio.pause();
    splashAudio.currentTime = 0;
    const playback = splashAudio.play();
    if (playback && playback.catch) {
      playback.catch(error => {
        console.warn('启动音效播放失败', error);
        window.__logBoot && __logBoot('启动音效播放失败：' + (error.message || error));
      });
    }
  } catch (error) {
    console.warn('启动音效播放失败', error);
    window.__logBoot && __logBoot('启动音效播放失败：' + (error.message || error));
  }
}

// ---------- EULA ----------
const eulaBody = $('eula-body');
eulaBody.addEventListener('scroll', () => {
  const pct = eulaBody.scrollTop / (eulaBody.scrollHeight - eulaBody.clientHeight);
  $('eula-hint').textContent = '请阅读协议（' + Math.round(pct * 100) + '%）';
  if (pct > 0.95) { $('btn-eula-ok').disabled = false; $('eula-hint').textContent = '感谢阅读'; }
});
$('btn-eula-ok').onclick = async () => {
  await ipcRenderer.invoke('eula:accept');
  hide('screen-eula'); startSplash();
};
$('btn-eula-quit').onclick = () => window.close();
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('screen-eula').classList.contains('hidden')) e.preventDefault();
});

// ---------- 开屏 ----------
function startSplash() {
  show('screen-splash');
  playSplashSound();
  const progress = $('splash-progress-fill');
  if (progress) {
    progress.style.animation = 'none';
    void progress.offsetWidth;
    progress.style.animation = 'splashProgress 3000ms linear forwards';
  }
  const steps = ['正在准备画布…', '正在读取项目…', '正在恢复工作区…', '即将就绪…'];
  let i = 0;
  $('splash-status').textContent = steps[0];
  const tick = setInterval(() => { i++; if (i < steps.length) $('splash-status').textContent = steps[i]; }, 750);
  const sessionPromise = ipcRenderer.invoke('auth:session');
  setTimeout(async () => {
    clearInterval(tick);
    await bundledFontsReady;
    const s = await sessionPromise;
    hide('screen-splash');
    if (s.ok) {
      account = s.account;
      await continueAfterAuth();
    } else show('screen-auth');
  }, 3000);
}

function effectiveEntitlementState(status) {
  const source = status || licenseState;
  if (!DEV_ENTITLEMENTS_ENABLED) return source;
  const edition = devEntitlementMode === 'team' ? 'team' : 'beta';
  return Object.assign({}, source || {}, {
    valid: true,
    enforced: true,
    development: false,
    daysRemaining: 3650,
    license: Object.assign({}, source && source.license || {}, { edition })
  });
}
function setDevEntitlementMode(mode) {
  if (!DEV_ENTITLEMENTS_ENABLED) return;
  devEntitlementMode = mode === 'team' ? 'team' : 'beta';
  try {
    localStorage.setItem(DEV_ENTITLEMENT_STORAGE_KEY, devEntitlementMode);
  } catch (error) {}
  ipcRenderer.invoke('dev:entitlement-mode', devEntitlementMode).catch(() => {});
  syncLicenseIndicators();
  if (!$('settings-mask').classList.contains('hidden')) renderSettings();
  toast('开发权限模拟已切换为「' + DEV_ENTITLEMENT_LABELS[devEntitlementMode] + '」');
}
function licenseStatusText(status) {
  if (DEV_ENTITLEMENTS_ENABLED) {
    return '开发权限模拟 · ' + DEV_ENTITLEMENT_LABELS[devEntitlementMode];
  }
  if (!status) return '正在检查授权…';
  if (status.development) return '开发模式 · 免授权';
  if (status.valid) return licenseTierLabel(status.license && status.license.edition) + ' · 剩余 ' + (status.daysRemaining == null ? '未知' : status.daysRemaining) + ' 天';
  return status.message || '内测授权无效';
}
// ---------- 计价真源：pricing-spec.json（生成产物 window.GW_PRICING）----------
// 金额是软件使用费；积分是随订阅赠送的额度。两期只差赠分，订阅价格完全一致。
// 任何页面要显示「送多少积分」都必须走这里，不许再手写数字（以前 app.js 里散着 120/340/36）。
function pricingSpec() { return (typeof window !== 'undefined' && window.GW_PRICING) || null; }
function pricingPlans() { const spec = pricingSpec(); return (spec && spec.plans) || []; }
function planByKey(key) {
  const plans = pricingPlans();
  for (let i = 0; i < plans.length; i++) if (plans[i].key === key) return plans[i];
  return null;
}
function planByPrice(price) {
  const plans = pricingPlans();
  for (let i = 0; i < plans.length; i++) if (plans[i].price === Number(price)) return plans[i];
  return null;
}
// 内测期（截至 spec.giftPeriods.beta.endsAt，默认 2026-11-30）双倍赠送；过期自动切标准额度。
// 已到账的积分不回收——这里只决定「现在新买送多少」。
function giftScopeNow(now) {
  const spec = pricingSpec();
  const periods = spec && spec.giftPeriods;
  const end = periods && periods.beta && periods.beta.endsAt;
  if (!end) return 'beta';
  const endAt = new Date(end);
  if (isNaN(endAt.getTime())) return 'beta';
  return (now || new Date()) < endAt ? 'beta' : 'standard';
}
function giftPointsOf(key, scope) {
  const plan = planByKey(key);
  if (!plan) return 0;
  const period = scope || giftScopeNow();
  return plan.giftPoints[period] || plan.giftPoints.beta || 0;
}
// 授权条/状态栏的档位显示名：买的是哪档就显示哪档，不再一律写「内测」。
// edition 值域与 accountTierInfo 一致（beta/trial/solo/pro + 历史档 studio/team/enterprise）。
// beta 返回「内测授权」，与旧文案「内测授权已激活」「内测授权 · 剩余 N 天」完全兼容。
function licenseTierLabel(edition) {
  const e = String(edition || '').toLowerCase();
  if (e === 'pro' || e === 'professional' || e === 'premium') return '高级版';
  if (e === 'solo' || e === 'basic' || e === 'starter' || e === 'standard') return '标准版';
  if (e === 'trial' || e === 'first') return '体验包';
  if (e === 'studio' || e === 'team' || e === 'enterprise') return '团队版';
  return '内测授权';
}
function accountTierInfo(status) {
  return accountTierInfoFromState(effectiveEntitlementState(status));
}
function accountTierInfoFromState(status) {
  if (!status || !status.valid) return { plan: 'none', label: '未开通额度', icon: 'lock' };
  if (status.development || !status.enforced) return { plan: 'dev', label: '开发版', mark: 'D' };
  // edition 取值（人工发 Key 时写入，见 手工发Key-SOP）：beta 只激活 / trial 体验包 / solo 标准 / pro 高级
  // 档位徽标只写档位名，不再写「X 积分 / 月」——积分是按码一次性到账的赠品额度，
  // 不是按月发放的配额，写死数字会在内测结束后变成假话。实际余额看积分面板（points:status）。
  const edition = String(status.license && status.license.edition || 'beta').toLowerCase();
  // 档位合并：对外只卖「标准 / 高级」两档；studio/team/enterprise 为历史 Key，仍识别显示。
  if (/^(studio|team|enterprise)$/.test(edition)) return { plan: 'studio', label: '团队版（历史档）', icon: 'planStudio' };
  if (/^(pro|professional|premium)$/.test(edition)) return { plan: 'pro', label: '高级版', icon: 'planPro' };
  if (/^(solo|basic|starter|standard)$/.test(edition)) return { plan: 'solo', label: '标准版', icon: 'planSolo' };
  if (/^(trial|first)$/.test(edition)) return { plan: 'trial', label: '体验包', icon: 'planTrial' };
  return { plan: 'beta', label: '内测成员 · 未开通额度', mark: 'β' };
}
function accountTierVisual(tier) {
  if (tier.icon && window.GWIcon) return window.GWIcon.svg(tier.icon, 16);
  return `<b>${esc(tier.mark || '—')}</b>`;
}
function avatarFeatureUnlocked() {
  const tier = accountTierInfo(licenseState);
  return (tier.plan === 'pro' || tier.plan === 'studio' || tier.plan === 'dev');
}
// 粒子魔方（Copilot）：订阅权益 + 开发版放开。与头像、资产库工作流同一套判定，
// 区别只在"未打包的开发运行"也放开，便于本地开发与内测验证。
function copilotFeatureUnlocked() {
  if (COPILOT_UNLOCK_ENV) return true;
  const tier = accountTierInfo(licenseState);
  if ((tier.plan === 'pro' || tier.plan === 'studio' || tier.plan === 'dev')) return true;
  return !PACKAGED_BUILD && !DEV_ENTITLEMENTS_ENABLED;
}
function notifyAvatarSubscriptionRequired() {
  toast('上传自定义头像为高级版功能，订阅高级版后开放（官方头像所有人可用）');
}
function requireAvatarFeature() {
  if (avatarFeatureUnlocked()) return true;
  notifyAvatarSubscriptionRequired();
  return false;
}
// 资产库工作流：订阅权益。判定与头像一致，读取端在 canvas.js / studio-tools.js
// （都看 body[data-gw-workflow-assets="disabled"]），此处是唯一的写入端。
function workflowAssetsUnlocked() {
  const tier = accountTierInfo(licenseState);
  return (tier.plan === 'pro' || tier.plan === 'studio' || tier.plan === 'dev');
}
function notifyWorkflowAssetsRequired() {
  toast('资产库工作流为高级版功能，订阅高级版后开放');
}
function requireWorkflowAssetsFeature() {
  if (workflowAssetsUnlocked()) return true;
  notifyWorkflowAssetsRequired();
  return false;
}
function syncWorkflowAssetsGate() {
  const locked = !workflowAssetsUnlocked();
  if (locked) document.body.dataset.gwWorkflowAssets = 'disabled';
  else delete document.body.dataset.gwWorkflowAssets;
  document.querySelectorAll('[data-asset-scope="workflow"]').forEach(button => {
    button.classList.toggle('is-locked', locked);
    button.dataset.locked = locked ? 'true' : 'false';
    button.setAttribute('aria-disabled', locked ? 'true' : 'false');
    button.title = locked ? '资产库工作流为高级版功能' : '';
  });
  try {
    window.dispatchEvent(new CustomEvent('gw:workflow-gate', { detail: { locked } }));
  } catch (error) {}
  return locked;
}
function accountTierMarkup(status) {
  const tier = accountTierInfo(status);
  return `<span class="account-tier" id="set-account-tier" data-plan="${tier.plan}" title="${esc(tier.label)}" aria-label="账号方案：${esc(tier.label)}">${accountTierVisual(tier)}</span>`;
}

function syncDevEntitlementControls() {
  const badge = $('dev-entitlement-badge');
  const menuButton = $('um-dev-entitlement');
  const menuState = $('um-dev-entitlement-state');
  const copilotButton = $('copilot-launch');
  const label = DEV_ENTITLEMENT_LABELS[devEntitlementMode];
  if (badge) {
    badge.hidden = !DEV_ENTITLEMENTS_ENABLED;
    badge.textContent = '开发模拟 · ' + label;
    badge.title = '仅主开发版有效，不修改真实授权';
  }
  if (menuButton) {
    menuButton.hidden = !DEV_ENTITLEMENTS_ENABLED;
    menuButton.title = '切换开发权限模拟，不修改真实授权';
  }
  if (menuState) menuState.textContent = label;
  if (copilotButton) {
    // 粒子魔方闸门（唯一写入端，读取端在 copilot.js）：按授权等级放开，不再按"是否打包"一刀切。
    // 放开：高级版 / 团队版 / 开发版（免授权）——开发权限模拟切到「团队全部功能」时
    // effectiveEntitlementState 会把 edition 换成 team，因此也走这条；未打包的开发运行同样放开。
    // 锁住：内测版（beta）与普通正式包，入口保留、提示文案由设置页统一说明。
    const copilotOpen = copilotFeatureUnlocked();
    const lockReason = copilotOpen ? '' : (PACKAGED_BUILD ? 'release' : 'beta');
    copilotButton.dataset.gwLocked = lockReason;
    copilotButton.dataset.tip = lockReason === 'release'
      ? '高级版可用'
      : (lockReason === 'beta' ? '开发模拟：团队功能' : '粒子魔方');
    copilotButton.setAttribute(
      'aria-label',
      lockReason === 'release'
        ? '粒子魔方，高级版可用'
        : (lockReason === 'beta' ? '粒子魔方，开发模拟需切换团队功能' : '粒子魔方')
    );
    if (lockReason && $('copilot-panel') && $('copilot-panel').classList.contains('open')) {
      const close = $('copilot-close');
      if (close) close.click();
    }
  }
}
function syncLicenseIndicators() {
  syncLicenseIndicatorsBase();
  if (DEV_ENTITLEMENTS_ENABLED) {
    const state = $('um-license-state');
    if (state) state.textContent = '模拟 ' + (devEntitlementMode === 'team' ? '全部' : '内测');
  }
  syncDevEntitlementControls();
  syncWorkflowAssetsGate();
}
// 启动即锁（fail-closed）：授权状态返回前，工作流入口不允许短暂可用。
syncWorkflowAssetsGate();
function syncLicenseIndicatorsBase() {
  const state = $('um-license-state');
  if (state) state.textContent = licenseState && licenseState.valid
    ? ((licenseState.development || !licenseState.enforced) ? '开发' : '剩 ' + licenseState.daysRemaining + ' 天')
    : '未激活';
  const avatarEntry = $('um-avatar');
  const avatarKey = $('um-avatar-key');
  // 官方头像全员可用（2026-10-29 档位界点调整）；只有上传自定义头像需要高级版，
  // 门槛在 changeAvatar() 与设置页上传按钮里把守，入口本身不再锁。
  if (avatarEntry) {
    avatarEntry.setAttribute('aria-disabled', 'false');
    avatarEntry.title = '更换头像';
  }
  if (avatarKey) avatarKey.textContent = '';
}

async function refreshLicenseState() {
  licenseState = await ipcRenderer.invoke('license:status');
  syncLicenseIndicators();
  return licenseState;
}

function renderLicenseGate(status) {
  licenseState = status || licenseState;
  const device = $('license-gate-device');
  const statusBox = $('license-gate-status');
  const error = $('license-gate-error');
  if (device) device.textContent = licenseState && licenseState.deviceId || '读取失败';
  if (statusBox) {
    statusBox.innerHTML = '';
    const title = document.createElement('b');
    title.textContent = licenseStatusText(licenseState);
    const detail = document.createElement('span');
    detail.textContent = licenseState && licenseState.license
      ? '许可版本：' + (licenseState.license.edition || 'beta') + ' · 到期：' + fmtDate(licenseState.license.expiresAt)
      : '复制当前设备 ID 发给管理员获取激活码，再粘贴到下方完成激活。';
    statusBox.append(title, detail);
  }
  if (error) error.textContent = '';
}

async function showLicenseGate(status) {
  account ||= await ipcRenderer.invoke('auth:session').then(result => result && result.account || null);
  renderLicenseGate(status);
  show('screen-license');
}

async function continueAfterAuth() {
  const status = await refreshLicenseState();
  if (status.enforced && !status.valid) {
    await showLicenseGate(status);
    return;
  }
  enterApp();
}

// ---------- 登录/注册（M0-修复#4：邮箱记忆） ----------
async function initAuthMemory() {
  const accounts = await ipcRenderer.invoke('auth:accounts');
  const dl = $('email-list');
  dl.innerHTML = '';
  accounts.forEach(a => {
    const o = document.createElement('option');
    o.value = a.email; o.label = a.name;
    dl.appendChild(o);
  });
  const s = await ipcRenderer.invoke('settings:get');
  if (s.lastEmail) $('in-email').value = s.lastEmail;
}
$('auth-toggle').onclick = () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  const reg = authMode === 'register';
  $('f-name').classList.toggle('hidden', !reg);
  $('btn-auth-go').textContent = reg ? '注 册 并 进 入' : '登 录';
  $('auth-switch').innerHTML = reg
    ? '已有账号？<a id="auth-toggle">直接登录</a>'
    : '还没有账号？<a id="auth-toggle">注册一个</a>';
  $('auth-switch').querySelector('a').onclick = $('auth-toggle').onclick;
  $('auth-err').textContent = '';
};
$('btn-auth-go').onclick = async () => {
  const r = await ipcRenderer.invoke(authMode === 'register' ? 'auth:register' : 'auth:login', {
    email: $('in-email').value, password: $('in-pass').value, name: $('in-name').value
  });
  if (!r.ok) { $('auth-err').textContent = r.msg; return; }
  account = r.account;
  hide('screen-auth');
  await continueAfterAuth();
};
$('in-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-auth-go').click(); });

$('license-gate-copy').onclick = async () => {
  const deviceId = licenseState && licenseState.deviceId || $('license-gate-device').textContent;
  const inviter = $('license-gate-inviter').value.trim();
  const requestText = '设备 ID：' + deviceId + (inviter ? '\n邀请码：' + inviter : '');
  try {
    await navigator.clipboard.writeText(requestText);
    toast(inviter ? '设备 ID 和邀请码已复制' : '设备 ID 已复制');
  } catch (error) {
    toast('复制失败，请手动选择申请信息', true);
  }
};
$('license-gate-export').onclick = async () => {
  const result = await ipcRenderer.invoke('license:exportRequest', {
    inviteCode: $('license-gate-inviter').value.trim()
  });
  if (result.ok) toast('激活申请文件已导出');
  else if (!result.canceled) toast(result.msg || '导出失败', true);
};
$('license-gate-activate').onclick = async () => {
  const code = $('license-gate-code').value.trim();
  if (!code) {
    $('license-gate-error').textContent = '请先粘贴激活码';
    return;
  }
  const result = await ipcRenderer.invoke('license:activate', code);
  if (result.pointsAdded != null && result.ok) {
    // 积分码：入账但不改变授权状态，留在激活页继续操作
    $('license-gate-code').value = '';
    syncLicenseIndicators();
    toast('积分已到账 +' + result.pointsAdded + (result.expiryLabel || '') + '，当前余额 ' + result.balance);
    return;
  }
  if (!result.ok) {
    $('license-gate-error').textContent = result.msg || '激活码无效';
    return;
  }
  licenseState = result;
  $('license-gate-code').value = '';
  syncLicenseIndicators();
  hide('screen-license');
  enterApp();
  toast('激活码使用成功');
};
$('license-gate-code').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) $('license-gate-activate').click();
});
$('license-gate-import').onclick = async () => {
  const result = await ipcRenderer.invoke('license:import');
  if (result.canceled) return;
  if (!result.ok) {
    $('license-gate-error').textContent = result.msg || '许可证导入失败';
    return;
  }
  licenseState = result;
  syncLicenseIndicators();
  hide('screen-license');
  enterApp();
  toast('内测许可证已激活');
};
$('license-gate-logout').onclick = async () => {
  await ipcRenderer.invoke('auth:logout');
  hide('screen-license');
  show('screen-auth');
};

// ---------- 主框架 ----------
async function refreshAvatar() {
  const img = $('tb-avatar-img');
  if (!img || !account) return;
  const a = await ipcRenderer.invoke('account:get', account.id);
  img.src = (a && a.avatar) ? a.avatar : 'avatar-default.png';
}
function enterApp() {
  show('screen-app');
  const umName = $('um-name'); if (umName) umName.textContent = account.name + ' · 已登录';
  refreshLicenseState().catch(() => {});
  if (!licenseCheckTimer) {
    licenseCheckTimer = setInterval(async () => {
      try {
        const status = await refreshLicenseState();
        if (status.enforced && !status.valid) showLicenseGate(status);
      } catch (error) {}
    }, 60 * 60 * 1000);
  }
  refreshAvatar();
  if (restoreProjectTabs()) {
    setTimeout(() => {
      activateProjectTab(activeProjectTabId);
    }, 0);
  } else {
    setCanvasProjectVisibility(false);
    openWelcome();
  }
}

// ---------- 欢迎弹窗 ----------
const WELCOME_QUOTES = [
  '空间不是被填满的，而是被留下来的。',
  '先理解光，再决定墙放在哪里。',
  '好的设计，让秩序看不见，却处处可感。',
  '材质不是装饰，是空间触感的语言。',
  '家不是风格的陈列，而是生活的留白。',
  '尺度让人安心，留白让空间呼吸。',
  '光落到哪里，空间的重心就在哪里。',
  '真正的高级感，来自克制而准确的选择。',
  '让动线先于造型，让生活先于风格。',
  '空间的温度，往往藏在一处不经意的阴影里。',
  '设计不是增加更多，而是让重要的事被看见。',
  '每一块材质，都应当回应人的触感与日常。',
  '窗外的景，也是室内设计的一部分。',
  '颜色负责情绪，比例负责秩序。',
  '家的完成，不在交付那天，而在住进去以后。',
  '一条好动线，会把普通的一天走得从容。',
  '空间的气质，来自结构和光线的默契。',
  '先让空间成立，再让装饰发生。',
  '细节不是装饰，而是使用时的安心。',
  '材料的真实，比表面的华丽更耐看。',
  '舒服的空间，从不要求人改变自己。',
  '光线经过材质，才会成为空间的情绪。',
  '好设计不喧哗，却能让生活自然发生。',
  '把复杂藏起来，把从容留给使用者。',
  '空间的界线可以模糊，生活的秩序不能。',
  '家具不是填满房间，而是组织关系。',
  '有呼吸感的留白，比更多造型更有力量。',
  '设计最终服务的，是人停留时的感受。',
  '让每一个转角，都有合理的理由。',
  '耐看的空间，总有一种安静的秩序。'
];
const WELCOME_QUOTE_CACHE = 'gw_daily_design_quote_v1';
const welcomeQuoteAttempted = new Set();
const welcomeBackgroundCache = new Map();
let welcomeBackdropToken = 0;

function welcomeDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function localWelcomeQuote(dateKey) {
  const seed = Array.from(dateKey + (account && account.id ? account.id : '')).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return WELCOME_QUOTES[seed % WELCOME_QUOTES.length];
}

function readWelcomeQuoteCache() {
  try {
    const value = JSON.parse(localStorage.getItem(WELCOME_QUOTE_CACHE) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
}

function applyWelcomeQuote(text, options = {}) {
  const el = $('welcome-quote');
  if (!el) return;
  const clean = String(text || '').trim();
  if (!clean) return;
  el.textContent = clean;
  if (!options.refreshing) return;
  el.classList.add('refreshing');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.remove('refreshing'));
  });
}

function normalizeGeneratedQuote(value) {
  let text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(?:金句|句子|答案|设计金句)\s*[:：]\s*/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[\s"'“”‘’「」《》]+|[\s"'“”‘’「」《》]+$/g, '')
    .trim();
  const firstSentence = text.split(/[。！？!?]\s*/)[0].trim();
  if (firstSentence.length >= 6 && firstSentence.length <= 34) text = firstSentence;
  return text.length >= 6 && text.length <= 34 ? text : '';
}

async function fetchOnlineWelcomeQuote(dateKey) {
  const P = window.GWProviders;
  if (!P || !P.chat || !P.loadConfigs || welcomeQuoteAttempted.has(dateKey)) return '';
  welcomeQuoteAttempted.add(dateKey);
  const configs = P.loadConfigs();
  const candidates = ['deepseek', 'apollo', 'openai'];
  const engineId = candidates.find(id => configs[id] && configs[id].apiKey);
  if (!engineId) return '';
  const def = P.PROVIDERS[engineId] || {};
  const cfg = configs[engineId] || {};
  const model = engineId === 'apollo'
    ? (cfg.quoteModel || cfg.visionModel || def.visionModel || 'gpt-4o')
    : (cfg.quoteModel || cfg.model || def.model);
  const content = await P.chat(engineId, {
    model,
    maxTokens: 90,
    messages: [
      {
        role: 'system',
        content: '你是室内设计工作室的中文文案编辑。只输出一句简洁、克制、有设计思考的中文短句，不解释，不使用 Markdown，不署名。'
      },
      {
        role: 'user',
        content: '今天是 ' + dateKey + '。请围绕空间、光影、材质、秩序、生活或人与空间的关系，生成一句新的设计金句。要求 12 到 26 个汉字，不复用常见网络套话。'
      }
    ]
  });
  return normalizeGeneratedQuote(content);
}

async function ensureWelcomeQuote() {
  const dateKey = welcomeDateKey();
  const cached = readWelcomeQuoteCache();
  const initial = cached && cached.date === dateKey && cached.text
    ? cached.text
    : localWelcomeQuote(dateKey);
  applyWelcomeQuote(initial);
  if (cached && cached.date === dateKey && cached.source === 'online') return;
  try {
    const text = await fetchOnlineWelcomeQuote(dateKey);
    if (!text) return;
    localStorage.setItem(WELCOME_QUOTE_CACHE, JSON.stringify({
      date: dateKey,
      text,
      source: 'online',
      updatedAt: Date.now()
    }));
    applyWelcomeQuote(text, { refreshing: true });
  } catch (error) {
    window.__logBoot && window.__logBoot('[welcome] 金句更新失败：' + (error.message || error));
  }
}

async function applyProjectCardCover(card, project, token) {
  if (!card || !card.isConnected || !project || !project.path) return;
  const cached = welcomeBackgroundCache.get(project.path);
  if (cached) {
    if (token === welcomeBackdropToken) {
      card.style.setProperty('--gw-card-cover', 'url("' + cached + '")');
      card.classList.add('has-cover');
    }
    return;
  }
  try {
    const result = await ipcRenderer.invoke('project:backgroundImage', { projectPath: project.path });
    if (!result || !result.ok || !result.dataURL ||
        token !== welcomeBackdropToken || !card.isConnected) return;
    if (welcomeBackgroundCache.size >= 8) {
      welcomeBackgroundCache.delete(welcomeBackgroundCache.keys().next().value);
    }
    welcomeBackgroundCache.set(project.path, result.dataURL);
    card.style.setProperty('--gw-card-cover', 'url("' + result.dataURL + '")');
    card.classList.add('has-cover');
  } catch (error) {}
}

// 新手使用说明书：内置项目（main.js guide:ensure 负责创建/重置）。
// 打开后若画布为空（首次或被重置），由 case-templates.js 的 GW_buildGuideContent 构建内容。
let __guideOpening = false;
async function openGuideProject() {
  if (__guideOpening) return;
  __guideOpening = true;
  try {
    const r = await ipcRenderer.invoke('guide:ensure');
    if (!r || !r.ok) { toast((r && r.msg) || '说明书项目创建失败', true); return; }
    await openProject(r.project);
    if (!r.exists && window.GWCanvas && typeof window.GWCanvas.guideContentNodeCount === 'function') {
      const built = window.GW_buildGuideContent
        ? await window.GW_buildGuideContent().catch(error => { console.warn('[guide] 构建失败', error); return false; })
        : false;
      if (!built) toast('说明书内容构建失败，请重启应用重试', true);
    }
  } finally {
    __guideOpening = false;
  }
}
window.GW_openGuideProject = openGuideProject;

async function openWelcome() {
  window.__welcomeOpen = true;
  const coverToken = ++welcomeBackdropToken;
  const list = await ipcRenderer.invoke('projects:list', account.id);
  const grid = $('recent-grid');
  grid.innerHTML = '';
  // 说明书卡片已按用户要求从欢迎页移除（入口保留：底部书本图标 / 工具栏「说明书」/ 空白画布按钮）
  if (list.length) {
    const newest = list[0];
    const rc = document.createElement('div');
    rc.className = 'proj-card restore';
    rc.innerHTML = '<div class="arrow">↻</div><div class="restore-copy"><div class="restore-title">继续最近项目</div><div class="name">' + esc(newest.name) + '</div></div><div class="meta">' + fmtDate(newest.lastOpened) + '</div>';
    rc.onclick = () => openProject(newest);
    grid.appendChild(rc);
    applyProjectCardCover(rc, newest, coverToken);
  }
  list.slice(1, 5).forEach(p => {
    const c = document.createElement('div');
    c.className = 'proj-card';
    c.innerHTML = '<div class="name">' + esc(p.name) + '</div><div class="meta">最近打开：' + fmtDate(p.lastOpened) + '</div>';
    c.onclick = () => openProject(p);
    grid.appendChild(c);
    applyProjectCardCover(c, p, coverToken);
  });
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'proj-card';
    empty.style.cssText = 'grid-column:1/-1;text-align:center;color:var(--faint);font-size:12px;line-height:20px;padding:22px';
    empty.textContent = '还没有项目。在下方输入客户项目名（如：张姐-江山悦140㎡），开始第一单。';
    grid.appendChild(empty);
  }
  const backupButton = $('btn-backup-project');
  if (backupButton) {
    backupButton.disabled = !currentProject;
    backupButton.title = currentProject
      ? '备份当前项目的画布、版本和原图'
      : '打开项目后可创建完整备份';
  }
  show('welcome-mask');
  ensureWelcomeQuote();
}
$('btn-new-proj').onclick = async () => {
  const r = await ipcRenderer.invoke('projects:create', { accountId: account.id, name: $('new-proj-name').value });
  if (!r.ok) { toast(r.msg === 'cancel' ? '已取消' : r.msg, r.msg !== 'cancel'); return; }
  $('new-proj-name').value = '';
  openProject(r.project);
};
$('new-proj-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-new-proj').click(); });
$('btn-open-proj').onclick = async () => {
  const r = await ipcRenderer.invoke('projects:openDialog', account.id);
  if (r.ok) {
    const projects = Array.isArray(r.projects) && r.projects.length ? r.projects : [r.project];
    projects.forEach((project, index) => openProject(project, { activate: index === projects.length - 1 }));
    if (r.skipped && r.skipped.length) toast('已跳过 ' + r.skipped.length + ' 个无效工程文件', true);
  }
  else if (r.msg !== 'cancel') toast(r.msg, true);
};
$('btn-backup-project').onclick = async () => {
  if (!currentProject) { toast('请先打开需要备份的项目', true); return; }
  const button = $('btn-backup-project');
  if (button) { button.disabled = true; button.querySelector('span').textContent = '备份中…'; }
  try {
    const saved = window.GWCanvas && GWCanvas.saveForProjectSwitch
      ? await GWCanvas.saveForProjectSwitch()
      : true;
    if (saved === false) { toast('项目保存失败，已取消备份', true); return; }
    toast('正在创建完整项目备份…');
    const result = await ipcRenderer.invoke('projects:exportBackup', { projectPath: currentProject.path });
    if (!result.ok) {
      if (result.msg !== 'cancel') toast(result.msg || '项目备份失败', true);
      return;
    }
    toast('项目备份完成 · ' + formatVersionBytes(result.bytes));
  } catch (error) {
    toast('项目备份失败：' + (error.message || error), true);
  } finally {
    if (button) {
      button.disabled = !currentProject;
      button.querySelector('span').textContent = '备份当前项目';
    }
  }
};
$('btn-restore-backup').onclick = async () => {
  const button = $('btn-restore-backup');
  if (currentProject && window.GWCanvas && GWCanvas.saveForProjectSwitch) {
    const saved = await GWCanvas.saveForProjectSwitch();
    if (saved === false) { toast('当前项目保存失败，已取消恢复', true); return; }
  }
  if (button) { button.disabled = true; button.querySelector('span').textContent = '恢复中…'; }
  try {
    const result = await ipcRenderer.invoke('projects:restoreBackup', { accountId: account.id });
    if (!result.ok) {
      if (result.msg !== 'cancel') toast(result.msg || '项目恢复失败', true);
      return;
    }
    toast('项目备份已恢复 · ' + formatVersionBytes(result.bytes));
    openProject(result.project);
  } catch (error) {
    toast('项目恢复失败：' + (error.message || error), true);
  } finally {
    if (button) { button.disabled = false; button.querySelector('span').textContent = '从备份恢复'; }
  }
};
$('btn-welcome-close').onclick = () => { window.__welcomeOpen = false; hide('welcome-mask'); };
// #66c 遮罩点击不再关闭（防误触），保留 X 与 ESC
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('welcome-mask').classList.contains('hidden')) { window.__welcomeOpen = false; hide('welcome-mask'); }
});
$('btn-logout').onclick = async () => {
  if (currentProject && window.GWCanvas && GWCanvas.saveForProjectSwitch) {
    await GWCanvas.saveForProjectSwitch();
  }
  if (window.GWCanvas && GWCanvas.forgetProject) {
    projectTabs.forEach(tab => GWCanvas.forgetProject(tab.path));
  }
  await ipcRenderer.invoke('auth:logout');
  currentProject = null;
  activeProjectTabId = null;
  projectTabs = [];
  renderProjectTabs();
  hide('welcome-mask'); hide('screen-app');
  await initAuthMemory();
  show('screen-auth');
};
$('btn-welcome').onclick = openWelcome;
// #47 头像下拉菜单
$('tb-user').onclick = e => {
  e.stopPropagation();
  const menu = $('user-menu');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    positionUserMenu();
    scheduleCanvasAvatarPosition(120);
  }
};
document.addEventListener('click', e => {
  const m = $('user-menu');
  if (m && !m.classList.contains('hidden') && !m.contains(e.target) && e.target.id !== 'tb-user') m.classList.add('hidden');
});
function projectTabsStorageKey() {
  return account && account.id ? PROJECT_TABS_STORAGE_PREFIX + account.id : '';
}
function persistProjectTabs() {
  const key = projectTabsStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      tabs: projectTabs.map(tab => ({
        id: tab.id,
        name: tab.name,
        path: tab.path,
        createdAt: tab.createdAt,
        lastOpened: tab.lastOpened
      })),
      activeTabId: activeProjectTabId
    }));
  } catch (error) {}
}
function restoreProjectTabs() {
  projectTabs = [];
  activeProjectTabId = null;
  const key = projectTabsStorageKey();
  if (!key) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    projectTabs = (saved && Array.isArray(saved.tabs) ? saved.tabs : [])
      .filter(tab => tab && tab.id && tab.path && tab.name)
      .map(tab => ({
        id: tab.id,
        name: tab.name,
        path: tab.path,
        createdAt: tab.createdAt || Date.now(),
        lastOpened: tab.lastOpened || Date.now(),
        dirty: false
      }));
    activeProjectTabId = projectTabs.some(tab => tab.id === (saved && saved.activeTabId))
      ? saved.activeTabId
      : (projectTabs[0] && projectTabs[0].id || null);
  } catch (error) {
    projectTabs = [];
    activeProjectTabId = null;
  }
  return projectTabs.length > 0;
}
function setCanvasProjectVisibility(visible) {
  const mount = document.getElementById('canvas-mount');
  const panels = document.getElementById('gw-panels-world');
  const noProject = document.getElementById('canvas-noproject');
  if (mount) mount.style.visibility = visible ? '' : 'hidden';
  if (panels) panels.style.visibility = visible ? '' : 'hidden';
  if (noProject) noProject.style.display = visible ? 'none' : 'flex';
}
function updateProjectChrome() {
  $('tb-project').value = currentProject && currentProject.name || '未打开项目';
}
function renderProjectTabs() {
  const strip = $('project-tabs');
  if (!strip) return;
  strip.innerHTML = '';
  projectTabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = 'project-tab'
      + (tab.id === activeProjectTabId ? ' active' : '')
      + (tab.id === switchingProjectTabId ? ' loading' : '')
      + (tab.dirty ? ' dirty' : '');
    tabEl.dataset.projectId = tab.id;
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', tab.id === activeProjectTabId ? 'true' : 'false');
    tabEl.setAttribute('tabindex', '0');
    tabEl.title = tab.name + ' · 双击重命名';
    tabEl.draggable = true;

    const name = document.createElement('span');
    name.className = 'project-tab-name';
    name.textContent = tab.name;
    const dirty = document.createElement('span');
    dirty.className = 'project-tab-dirty';
    dirty.setAttribute('aria-label', '有未保存更改');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'project-tab-close';
    close.textContent = '×';
    close.title = '关闭项目标签';
    close.setAttribute('aria-label', '关闭 ' + tab.name);
    close.onclick = event => {
      event.stopPropagation();
      closeProjectTab(tab.id);
    };
    tabEl.append(name, dirty, close);
    tabEl.addEventListener('click', () => activateProjectTab(tab.id));
    tabEl.addEventListener('dblclick', event => {
      event.preventDefault();
      openRenameProject(tab.id);
    });
    tabEl.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateProjectTab(tab.id);
      } else if (event.key === 'F2') {
        event.preventDefault();
        openRenameProject(tab.id);
      }
    });
    tabEl.addEventListener('dragstart', event => {
      projectTabDragId = tab.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tab.id);
      tabEl.style.opacity = '.55';
    });
    tabEl.addEventListener('dragend', () => {
      projectTabDragId = null;
      tabEl.style.opacity = '';
    });
    tabEl.addEventListener('dragover', event => {
      if (projectTabDragId && projectTabDragId !== tab.id) event.preventDefault();
    });
    tabEl.addEventListener('drop', event => {
      event.preventDefault();
      const fromIndex = projectTabs.findIndex(item => item.id === projectTabDragId);
      const toIndex = projectTabs.findIndex(item => item.id === tab.id);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      const moved = projectTabs.splice(fromIndex, 1)[0];
      projectTabs.splice(toIndex, 0, moved);
      persistProjectTabs();
      renderProjectTabs();
    });
    strip.appendChild(tabEl);
  });
  updateProjectChrome();
  requestAnimationFrame(() => {
    const active = strip.querySelector('.project-tab.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}
function waitForProjectReady(projectId) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('project-ready', onReady);
      resolve();
    };
    const onReady = event => {
      if (!event.detail || event.detail.id === projectId) finish();
    };
    const timer = setTimeout(finish, 15000);
    window.addEventListener('project-ready', onReady);
  });
}
async function activateProjectTabNow(projectId, skipSave) {
  const target = projectTabs.find(tab => tab.id === projectId);
  if (!target) return false;
  if (currentProject && currentProject.id === projectId) {
    renderProjectTabs();
    return true;
  }
  const stats = window.GWCanvas && GWCanvas.getRuntimeStats ? GWCanvas.getRuntimeStats() : null;
  if (stats && stats.running > 0) {
    toast('当前项目还有生成任务运行中，完成后再切换', true);
    return false;
  }
  if (currentProject && !skipSave && window.GWCanvas && GWCanvas.saveForProjectSwitch) {
    const saved = await GWCanvas.saveForProjectSwitch();
    if (saved === false) {
      toast('当前项目保存失败，已取消切换', true);
      return false;
    }
  }
  currentProject = target;
  activeProjectTabId = projectId;
  switchingProjectTabId = projectId;
  persistProjectTabs();
  renderProjectTabs();
  setCanvasProjectVisibility(true);
  hide('welcome-mask');
  window.__welcomeOpen = false;
  ipcRenderer.invoke('projects:touch', { accountId: account.id, projectId });
  const ready = waitForProjectReady(projectId);
  window.dispatchEvent(new CustomEvent('project-opened', { detail: target }));
  await ready;
  switchingProjectTabId = null;
  renderProjectTabs();
  scheduleInactiveProjectPrefetch();
  return true;
}
function scheduleInactiveProjectPrefetch() {
  clearTimeout(projectPrefetchTimer);
  if (!window.GWCanvas || !GWCanvas.prefetchProject) return;
  projectPrefetchTimer = setTimeout(async () => {
    projectPrefetchTimer = null;
    if (document.visibilityState !== 'visible') return;
    if (performance.now() < (window.__gwCanvasBusyUntil || 0)) {
      scheduleInactiveProjectPrefetch();
      return;
    }
    const candidates = projectTabs
      .filter(tab => tab.id !== activeProjectTabId)
      .slice(0, 3);
    for (const tab of candidates) {
      if (!projectTabs.some(item => item.id === tab.id) || tab.id === activeProjectTabId) continue;
      const stats = GWCanvas.getRuntimeStats ? GWCanvas.getRuntimeStats() : null;
      if (stats && (stats.running > 0 || stats.nodes >= 40)) return;
      if (document.visibilityState !== 'visible' || performance.now() < (window.__gwCanvasBusyUntil || 0)) {
        scheduleInactiveProjectPrefetch();
        return;
      }
      try {
        await GWCanvas.prefetchProject(tab);
      } catch (error) {}
      await new Promise(resolve => setTimeout(resolve, 220));
    }
  }, 1100);
}
function activateProjectTab(projectId, options = {}) {
  const run = projectSwitchChain
    .catch(() => {})
    .then(() => activateProjectTabNow(projectId, Boolean(options.skipSave)));
  projectSwitchChain = run.catch(() => {});
  return run;
}
function openProject(p, options = {}) {
  window.__logBoot && __logBoot('openProject: ' + p.name + ' @ ' + p.path);
  let tab = projectTabs.find(item => item.id === p.id || item.path === p.path);
  if (tab) {
    tab.name = p.name || tab.name;
    tab.path = p.path || tab.path;
    tab.lastOpened = Date.now();
  } else {
    tab = {
      id: p.id,
      name: p.name,
      path: p.path,
      createdAt: p.createdAt || Date.now(),
      lastOpened: Date.now(),
      dirty: false
    };
    projectTabs.push(tab);
  }
  persistProjectTabs();
  renderProjectTabs();
  hide('welcome-mask');
  window.__welcomeOpen = false;
  toast('已打开：' + tab.name);
  return options.activate === false
    ? Promise.resolve(true)
    : activateProjectTab(tab.id);
}

async function closeProjectTab(projectId) {
  const index = projectTabs.findIndex(tab => tab.id === projectId);
  if (index < 0) return false;
  const closedTab = projectTabs[index];
  const isActive = projectId === activeProjectTabId;
  if (isActive && window.GWCanvas && GWCanvas.saveForProjectSwitch) {
    const saved = await GWCanvas.saveForProjectSwitch();
    if (saved === false) {
      toast('项目保存失败，已取消关闭', true);
      return false;
    }
  }
  projectTabs.splice(index, 1);
  if (window.GWCanvas && GWCanvas.forgetProject) GWCanvas.forgetProject(closedTab.path);
  persistProjectTabs();
  if (!isActive) {
    renderProjectTabs();
    return true;
  }
  currentProject = null;
  activeProjectTabId = null;
  const next = projectTabs[Math.min(index, projectTabs.length - 1)] || null;
  if (next) {
    activeProjectTabId = next.id;
    renderProjectTabs();
    await activateProjectTab(next.id, { skipSave: true });
  } else {
    setCanvasProjectVisibility(false);
    renderProjectTabs();
    setCanvasDrawer('left', false);
    setCanvasDrawer('right', false);
    if (window.GWStudio && window.GWStudio.close) window.GWStudio.close();
    if (window.GWQuickStart && window.GWQuickStart.pause) window.GWQuickStart.pause();
    openWelcome().catch(error => toast('项目列表加载失败：' + (error.message || error), true));
  }
  return true;
}

function openRenameProject(projectId) {
  const tab = projectTabs.find(item => item.id === (projectId || activeProjectTabId));
  if (!tab) {
    toast('请先新建或打开项目', true);
    return;
  }
  renameProjectId = tab.id;
  $('rename-input').value = tab.name || '';
  $('rename-error').textContent = '';
  $('btn-rename-save').disabled = false;
  $('btn-rename-save').textContent = '保存';
  show('rename-mask');
  setTimeout(() => {
    const input = $('rename-input');
    input.focus();
    input.select();
  }, 40);
}

async function saveProjectRename() {
  const tab = projectTabs.find(item => item.id === renameProjectId);
  if (!tab) return;
  const name = $('rename-input').value.trim();
  const error = $('rename-error');
  const save = $('btn-rename-save');
  if (!name) {
    error.textContent = '项目名称不能为空';
    $('rename-input').focus();
    return;
  }
  if (name === tab.name) {
    hide('rename-mask');
    return;
  }
  save.disabled = true;
  save.textContent = '保存中…';
  error.textContent = '';
  try {
    const result = await ipcRenderer.invoke('projects:rename', {
      accountId: account.id,
      projectId: tab.id,
      name
    });
    if (!result.ok) {
      error.textContent = result.msg || '重命名失败';
      return;
    }
    tab.name = result.project.name;
    if (currentProject && currentProject.id === tab.id) {
      currentProject.name = result.project.name;
      $('copilot-project-label').textContent = result.project.name;
      window.dispatchEvent(new CustomEvent('project-renamed', { detail: currentProject }));
    }
    persistProjectTabs();
    renderProjectTabs();
    hide('rename-mask');
    toast('项目已重命名为“' + result.project.name + '”');
  } catch (err) {
    error.textContent = '重命名失败：' + err.message;
  } finally {
    save.disabled = false;
    save.textContent = '保存';
  }
}

$('btn-welcome').onclick = openWelcome;
$('btn-project-add').onclick = openWelcome;
// 工具栏「说明书」按钮已按用户要求移除；入口保留：欢迎页底部书本图标 / 空白画布按钮
const guideFootBtn = $('btn-guide-foot');
if (guideFootBtn) guideFootBtn.onclick = openGuideProject;
$('btn-rename-cancel').onclick = () => hide('rename-mask');
$('btn-rename-save').onclick = saveProjectRename;
$('rename-mask').addEventListener('click', event => {
  if (event.target === $('rename-mask')) hide('rename-mask');
});
$('rename-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveProjectRename();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hide('rename-mask');
  }
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('rename-mask').classList.contains('hidden')) {
    hide('rename-mask');
  }
});
$('project-tabs').addEventListener('wheel', event => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.currentTarget.scrollLeft += event.deltaY;
  event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', event => {
  if ($('screen-app').classList.contains('hidden') || projectTabs.length < 2) return;
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'Tab') return;
  event.preventDefault();
  const index = Math.max(0, projectTabs.findIndex(tab => tab.id === activeProjectTabId));
  const nextIndex = (index + (event.shiftKey ? -1 : 1) + projectTabs.length) % projectTabs.length;
  activateProjectTab(projectTabs[nextIndex].id);
});
window.addEventListener('keydown', event => {
  if ($('screen-app').classList.contains('hidden') || !activeProjectTabId) return;
  if (event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const target = event.target;
    if (target && target.closest && target.closest('input,textarea')) return;
    event.preventDefault();
    openRenameProject(activeProjectTabId);
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'w') return;
  event.preventDefault();
  closeProjectTab(activeProjectTabId);
});
window.addEventListener('canvas-dirty-state', event => {
  const projectId = event.detail && event.detail.projectId || activeProjectTabId;
  const tab = projectTabs.find(item => item.id === projectId);
  if (!tab) return;
  const dirty = Boolean(event.detail && event.detail.dirty);
  if (tab.dirty === dirty) return;
  tab.dirty = dirty;
  persistProjectTabs();
  renderProjectTabs();
});
renderProjectTabs();

// ---------- 设置 ----------
const SET_PAGES = [
  { id: 'interface', name: '通用 · 界面' },
  { id: 'account', name: '账号' },
  { id: 'license', name: '订阅与授权' },
  { id: 'engine', name: '引擎（API 配置）' },
  { id: 'shortcuts', name: '快捷键' },
  { id: 'perf', name: '性能' },
  { id: 'proxy', name: '代理设置' },
  { id: 'log', name: '日志' },
  { id: 'about', name: '关于' }
];
const PLAN_FEATURES = [
  ['画布与节点编辑', true, true],
  ['单张生成与标记修改', true, true],
  ['常规图片与方案导出', true, true],
  ['多机位批量生成', false, true],
  ['工作流群组自动运行', false, true],
  ['批量精修与资产整理', false, true],
  ['全景 AI 修复等高级工具', false, true]
];
function planMark(included) {
  return `<span class="plan-mark ${included ? 'yes' : 'no'}" aria-label="${included ? '包含' : '不包含'}">${included ? '✓' : '×'}</span>`;
}
const SHORTCUT_DEFS = [
  ['缩放画布', '<kbd>滚轮</kbd>'],
  ['平移画布', '<kbd>空格</kbd>+左键拖拽，或 <kbd>中键</kbd>拖拽'],
  ['切换项目标签', '<kbd>Ctrl</kbd>+<kbd>Tab</kbd>'],
  ['关闭项目标签', '<kbd>Ctrl</kbd>+<kbd>W</kbd>'],
  ['重命名当前项目', '<kbd>F2</kbd>'],
  ['资产库', '<kbd>Ctrl</kbd>+<kbd>K</kbd>'],
  ['粒子魔方', '<kbd>Ctrl</kbd>+<kbd>J</kbd>'],
  ['导入图片', '<kbd>Ctrl</kbd>+<kbd>O</kbd>'],
  ['选中 / 取消', '点击 / 点击空白处'],
  ['多选 / 框选', '<kbd>Ctrl</kbd>+点击，或空白处左键拖框'],
  ['框选方式', '左向右 = 完整包含；右向左 = 碰到即选'],
  ['看大图', '<kbd>双击</kbd>图片'],
  ['跟随整理连通网络', '<kbd>F</kbd>（以选中节点为锚点，上游向左、下游向右）'],
  ['合并 / 展开节点', '<kbd>Q</kbd>（多选合并；选中合并卡时展开）'],
  ['适应视图 / 聚焦', '<kbd>Shift</kbd>+<kbd>F</kbd>'],
  ['Alt 拖动复制', '按住 <kbd>Alt</kbd> 拖动节点'],
  ['向上对齐', '<kbd>↑</kbd>（顶边对齐并统一横向间距）'],
  ['向左对齐', '<kbd>←</kbd>（整列左对齐，保持纵向等间距）'],
  ['删除选中', '<kbd>Delete</kbd> / <kbd>Backspace</kbd>'],
  ['复制 / 粘贴', '<kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd>'],
  ['快速复制节点', '<kbd>Ctrl</kbd>+<kbd>D</kbd>'],
  ['撤销 / 重做', '<span class="shortcut-group"><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd></span><span class="shortcut-or">或</span><span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></span></span>'],
  ['全选', '<kbd>Ctrl</kbd>+<kbd>A</kbd>'],
  ['手动保存', '<kbd>Ctrl</kbd>+<kbd>S</kbd>'],
  ['切割连线', '<span class="shortcut-note"><kbd>Alt</kbd> + 右键拖过连线</span><span class="shortcut-note">悬停连线点 <span class="shortcut-action">×</span> 断开单条</span>'],
  ['关闭弹层 / 取消选择', '<kbd>Esc</kbd>'],
  ['快捷键速查', '<kbd>?</kbd>']
];
function shortcutRowsHtml() {
  return SHORTCUT_DEFS.map(item => '<tr><td>' + item[0] + '</td><td>' + item[1] + '</td></tr>').join('');
}
function renderShortcutTable(target) {
  if (target) target.innerHTML = shortcutRowsHtml();
}
const AVATAR_INK = '#17191a';
const AVATAR_PAPER = '#f1efeb';
const AVATAR_HAIR = {
  short: {
    back: '',
    front: '<path d="M23 25c0-10 5-16 13-16s13 6 13 16c-4-4-8-6-13-6s-9 2-13 6z" fill="#17191a"/>'
  },
  side: {
    back: '',
    front: '<path d="M23 24c-1-10 5-15 13-15 8 0 13 5 13 14-4-1-7-4-10-7-4 5-9 7-16 8z" fill="#17191a"/>'
  },
  long: {
    back: '<path d="M19 60V31c0-13 7-22 17-22s17 9 17 22v29h-6V31c-2-5-6-7-11-7s-9 2-11 7v29z" fill="#17191a"/>',
    front: '<path d="M23 25c0-10 5-16 13-16 9 0 14 6 14 17-3-5-7-7-11-8l-3 7c-4-3-9-3-13 0z" fill="#17191a"/>'
  },
  bob: {
    back: '<path d="M19 47V29c0-11 7-18 17-18s17 7 17 18v18h-6V28c-3-4-6-6-11-6s-9 2-11 6v19z" fill="#17191a"/>',
    front: '<path d="M23 25c0-10 5-16 13-16 9 0 14 6 14 17-5-2-10-4-14-8-3 4-7 6-13 7z" fill="#17191a"/>'
  },
  bun: {
    back: '<circle cx="36" cy="8" r="6" fill="#17191a"/>',
    front: '<path d="M22 25c0-10 6-16 14-16s14 6 14 16c-4-4-8-6-14-6s-10 2-14 6z" fill="#17191a"/>'
  },
  pigtails: {
    back: '<circle cx="16" cy="33" r="7" fill="#17191a"/><circle cx="56" cy="33" r="7" fill="#17191a"/>',
    front: '<path d="M22 25c0-10 6-16 14-16s14 6 14 16c-5-4-9-6-14-6s-9 2-14 6z" fill="#17191a"/>'
  },
  curly: {
    back: '',
    front: '<circle cx="25" cy="17" r="6" fill="#17191a"/><circle cx="35" cy="13" r="7" fill="#17191a"/><circle cx="46" cy="17" r="6" fill="#17191a"/><circle cx="22" cy="25" r="4" fill="#17191a"/><circle cx="50" cy="25" r="4" fill="#17191a"/>'
  },
  ponytail: {
    back: '<ellipse cx="56" cy="34" rx="5" ry="11" fill="#17191a"/>',
    front: '<path d="M23 25c0-10 5-16 13-16s13 6 13 16c-4-4-8-6-13-6s-9 2-13 6z" fill="#17191a"/><path d="M50 25h7v5h-7z" fill="#17191a"/>'
  },
  cap: {
    back: '',
    front: '<path d="M21 24c0-9 6-15 15-15s15 7 15 16H21z" fill="#17191a"/><path d="M21 23h31l8 4H25z" fill="#17191a"/>'
  },
  bald: {
    back: '',
    front: '<path d="M23 25c0-5 2-8 5-10v4c3 2 5 4 8 4h8c-2-2-4-5-4-8 5 2 8 6 8 11h-4v4H27v-4z" fill="#17191a"/>'
  },
  scarf: {
    back: '<path d="M18 48V31c0-13 8-22 18-22s18 9 18 22v17h-5V31c0-4-2-7-5-9v24H23V22c-3 2-5 5-5 9v17z" fill="#17191a"/>',
    front: '<path d="M22 24c2-8 7-12 14-12s12 4 14 12c-5-3-9-4-14-4s-9 1-14 4z" fill="#17191a"/>'
  }
};
const AVATAR_OUTFITS = {
  solid: '<path d="M15 70c1-12 9-19 21-19s20 7 21 19z" fill="#17191a"/>',
  shirt: '<path d="M15 70c1-12 9-19 21-19s20 7 21 19z" fill="#f1efeb" stroke="#17191a" stroke-width="2.4"/><path d="m30 51 6 9 6-9" fill="none" stroke="#17191a" stroke-width="2.4" stroke-linecap="square"/>',
  stripe: '<path d="M15 70c1-12 9-19 21-19s20 7 21 19z" fill="#f1efeb" stroke="#17191a" stroke-width="2.4"/><path d="m22 68 15-13M31 70l15-13M40 70l15-13" stroke="#17191a" stroke-width="4" stroke-linecap="square"/>',
  collar: '<path d="M15 70c1-12 9-19 21-19s20 7 21 19z" fill="#17191a"/><path d="m30 51 6 8 6-8" fill="none" stroke="#f1efeb" stroke-width="2.5" stroke-linecap="square"/>'
};
const AVATAR_EYES = {
  calm: '<circle cx="31" cy="29" r="1.7" fill="#17191a"/><circle cx="41" cy="29" r="1.7" fill="#17191a"/>',
  happy: '<path d="M28 29q3-3 6 0M38 29q3-3 6 0" fill="none" stroke="#17191a" stroke-width="2" stroke-linecap="round"/>',
  serious: '<path d="M28 28h6M38 28h6M28 26l5 1M44 26l-5 1" fill="none" stroke="#17191a" stroke-width="1.8" stroke-linecap="round"/>',
  closed: '<path d="M28 29q3 2 6 0M38 29q3 2 6 0" fill="none" stroke="#17191a" stroke-width="1.8" stroke-linecap="round"/>'
};
const AVATAR_MOUTHS = {
  smile: '<path d="M31 35q5 5 10 0" fill="none" stroke="#17191a" stroke-width="2" stroke-linecap="round"/>',
  slight: '<path d="M32 36q4 2 8 0" fill="none" stroke="#17191a" stroke-width="2" stroke-linecap="round"/>',
  neutral: '<path d="M32 36h8" fill="none" stroke="#17191a" stroke-width="2" stroke-linecap="round"/>',
  open: '<ellipse cx="36" cy="36" rx="4" ry="2.8" fill="#17191a"/>'
};
const AVATAR_ACCESSORIES = {
  none: '',
  glasses: '<g fill="none" stroke="#17191a" stroke-width="1.8"><circle cx="31" cy="29" r="5"/><circle cx="41" cy="29" r="5"/><path d="M36 29h0M26 28l-3-1M46 28l3-1"/></g>',
  earrings: '<circle cx="22" cy="34" r="1.8" fill="#17191a"/><circle cx="50" cy="34" r="1.8" fill="#17191a"/>',
  beard: '<path d="M25 35c2 8 6 12 11 12s9-4 11-12c-3 3-7 5-11 5s-8-2-11-5z" fill="none" stroke="#17191a" stroke-width="2.4" stroke-linejoin="round"/>',
  mustache: '<path d="M29 34q4-3 7 0 3-3 7 0-4 2-7 1-3 1-7-1z" fill="#17191a"/>',
  wrinkles: '<path d="M27 23l5-1M40 22l5 1M27 32l3-1M42 31l3 1" fill="none" stroke="#17191a" stroke-width="1.2" stroke-linecap="round"/>'
};
function portraitAvatarArt(options) {
  const hair = AVATAR_HAIR[options.hair] || AVATAR_HAIR.short;
  return '<rect width="72" height="72" fill="#f1efeb"/>' +
    (hair.back || '') +
    (AVATAR_OUTFITS[options.outfit] || AVATAR_OUTFITS.solid) +
    '<path d="M32 40h8v9h-8z" fill="#f1efeb" stroke="#17191a" stroke-width="2.2"/>' +
    '<circle cx="23" cy="30" r="2.5" fill="#f1efeb" stroke="#17191a" stroke-width="1.8"/>' +
    '<circle cx="49" cy="30" r="2.5" fill="#f1efeb" stroke="#17191a" stroke-width="1.8"/>' +
    '<ellipse cx="36" cy="28" rx="13" ry="14" fill="#f1efeb" stroke="#17191a" stroke-width="2.2"/>' +
    (hair.front || '') +
    (AVATAR_EYES[options.eyes] || AVATAR_EYES.calm) +
    (AVATAR_ACCESSORIES[options.accessory] || '') +
    (AVATAR_MOUTHS[options.mouth] || AVATAR_MOUTHS.smile);
}
const OFFICIAL_AVATARS = [
  { id: 'young-man', label: '短发青年', options: { hair: 'short', eyes: 'calm', mouth: 'smile', outfit: 'solid', accessory: 'none' } },
  { id: 'long-hair-woman', label: '长发女性', options: { hair: 'long', eyes: 'happy', mouth: 'smile', outfit: 'shirt', accessory: 'earrings' } },
  { id: 'bun-senior-woman', label: '丸子头长辈', options: { hair: 'bun', eyes: 'closed', mouth: 'slight', outfit: 'collar', accessory: 'wrinkles' } },
  { id: 'glasses-senior-man', label: '眼镜长者', options: { hair: 'bald', eyes: 'serious', mouth: 'neutral', outfit: 'shirt', accessory: 'mustache' } },
  { id: 'pigtail-girl', label: '双马尾女孩', options: { hair: 'pigtails', eyes: 'happy', mouth: 'open', outfit: 'shirt', accessory: 'none' } },
  { id: 'cap-boy', label: '棒球帽男孩', options: { hair: 'cap', eyes: 'happy', mouth: 'open', outfit: 'stripe', accessory: 'none' } },
  { id: 'beard-man', label: '络腮胡男性', options: { hair: 'curly', eyes: 'serious', mouth: 'neutral', outfit: 'solid', accessory: 'beard' } },
  { id: 'bob-woman', label: '短发女性', options: { hair: 'bob', eyes: 'calm', mouth: 'slight', outfit: 'shirt', accessory: 'earrings' } },
  { id: 'side-part-man', label: '侧分男性', options: { hair: 'side', eyes: 'happy', mouth: 'smile', outfit: 'collar', accessory: 'none' } },
  { id: 'ponytail-woman', label: '马尾女性', options: { hair: 'ponytail', eyes: 'happy', mouth: 'smile', outfit: 'stripe', accessory: 'none' } },
  { id: 'curly-child', label: '卷发儿童', options: { hair: 'curly', eyes: 'happy', mouth: 'open', outfit: 'shirt', accessory: 'none' } },
  { id: 'long-hair-teen', label: '长发少女', options: { hair: 'long', eyes: 'closed', mouth: 'slight', outfit: 'solid', accessory: 'earrings' } },
  { id: 'older-glasses-man', label: '眼镜长辈', options: { hair: 'side', eyes: 'serious', mouth: 'neutral', outfit: 'shirt', accessory: 'glasses' } },
  { id: 'middle-aged-woman', label: '中年女性', options: { hair: 'bob', eyes: 'serious', mouth: 'neutral', outfit: 'collar', accessory: 'earrings' } },
  { id: 'cap-man', label: '帽子男性', options: { hair: 'cap', eyes: 'serious', mouth: 'slight', outfit: 'shirt', accessory: 'none' } },
  { id: 'scarf-woman', label: '围巾女性', options: { hair: 'scarf', eyes: 'happy', mouth: 'smile', outfit: 'solid', accessory: 'none' } },
  { id: 'older-bun-woman', label: '丸子头老人', options: { hair: 'bun', eyes: 'closed', mouth: 'slight', outfit: 'shirt', accessory: 'glasses' } },
  { id: 'short-hair-boy', label: '短发男孩', options: { hair: 'short', eyes: 'happy', mouth: 'open', outfit: 'stripe', accessory: 'none' } },
  { id: 'beard-middle-man', label: '胡须男性', options: { hair: 'side', eyes: 'calm', mouth: 'neutral', outfit: 'solid', accessory: 'beard' } },
  { id: 'middle-ponytail-woman', label: '马尾女士', options: { hair: 'ponytail', eyes: 'serious', mouth: 'slight', outfit: 'shirt', accessory: 'earrings' } },
  { id: 'short-glasses-woman', label: '短发眼镜女性', options: { hair: 'short', eyes: 'closed', mouth: 'neutral', outfit: 'collar', accessory: 'glasses' } },
  { id: 'long-calm-woman', label: '长发沉静女性', options: { hair: 'long', eyes: 'calm', mouth: 'neutral', outfit: 'shirt', accessory: 'earrings' } },
  { id: 'side-beard-open', label: '胡须侧分男性', options: { hair: 'side', eyes: 'calm', mouth: 'open', outfit: 'solid', accessory: 'beard' } },
  { id: 'curly-glasses-youth', label: '卷发眼镜青年', options: { hair: 'curly', eyes: 'serious', mouth: 'smile', outfit: 'collar', accessory: 'glasses' } },
  { id: 'bob-happy-woman', label: '短发笑容女性', options: { hair: 'bob', eyes: 'happy', mouth: 'open', outfit: 'stripe', accessory: 'earrings' } },
  { id: 'ponytail-professional', label: '马尾职业女性', options: { hair: 'ponytail', eyes: 'happy', mouth: 'smile', outfit: 'shirt', accessory: 'earrings' } },
  { id: 'pigtail-calm-girl', label: '双马尾安静女孩', options: { hair: 'pigtails', eyes: 'calm', mouth: 'slight', outfit: 'shirt', accessory: 'earrings' } },
  { id: 'cap-calm-man', label: '帽子沉静男性', options: { hair: 'cap', eyes: 'serious', mouth: 'neutral', outfit: 'stripe', accessory: 'glasses' } },
  { id: 'scarf-senior-woman', label: '围巾长辈女性', options: { hair: 'scarf', eyes: 'closed', mouth: 'slight', outfit: 'solid', accessory: 'glasses' } },
  { id: 'bun-happy-woman', label: '丸子头笑容女性', options: { hair: 'bun', eyes: 'happy', mouth: 'smile', outfit: 'collar', accessory: 'earrings' } },
  { id: 'wrinkle-elder', label: '皱纹长者', options: { hair: 'bald', eyes: 'serious', mouth: 'neutral', outfit: 'solid', accessory: 'wrinkles' } },
  { id: 'long-serious-woman', label: '长发沉稳女性', options: { hair: 'long', eyes: 'serious', mouth: 'neutral', outfit: 'shirt', accessory: 'none' } },
  { id: 'bob-glasses-youth', label: '短发眼镜青年', options: { hair: 'bob', eyes: 'happy', mouth: 'neutral', outfit: 'collar', accessory: 'glasses' } },
  { id: 'short-beard-man', label: '短胡须男性', options: { hair: 'short', eyes: 'calm', mouth: 'neutral', outfit: 'solid', accessory: 'beard' } },
  { id: 'curly-closed-youth', label: '卷发微笑青年', options: { hair: 'curly', eyes: 'closed', mouth: 'smile', outfit: 'shirt', accessory: 'none' } },
  { id: 'ponytail-earring-woman', label: '马尾耳饰女性', options: { hair: 'ponytail', eyes: 'happy', mouth: 'slight', outfit: 'solid', accessory: 'earrings' } },
  { id: 'bald-happy-elder', label: '光头笑脸长者', options: { hair: 'bald', eyes: 'happy', mouth: 'smile', outfit: 'collar', accessory: 'none' } },
  { id: 'scarf-serious-woman', label: '围巾严肃女性', options: { hair: 'scarf', eyes: 'serious', mouth: 'slight', outfit: 'shirt', accessory: 'none' } },
  { id: 'pigtail-smile-girl', label: '双马尾少女', options: { hair: 'pigtails', eyes: 'calm', mouth: 'smile', outfit: 'solid', accessory: 'none' } },
  { id: 'cap-happy-woman', label: '帽子笑容女性', options: { hair: 'cap', eyes: 'happy', mouth: 'smile', outfit: 'collar', accessory: 'earrings' } }
].map(item => ({
  ...item,
  dataURL: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">' +
    portraitAvatarArt(item.options) +
    '</svg>'
  )
}));
function officialAvatarsHtml() {
  return OFFICIAL_AVATARS.map(item =>
    '<button type="button" class="official-avatar-option" data-official-avatar="' + item.id + '" title="' + item.label + '" aria-label="使用' + item.label + '头像">' +
      '<img src="' + item.dataURL + '" alt="" draggable="false"/>' +
    '</button>'
  ).join('');
}
function markOfficialAvatarSelection(dataURL) {
  document.querySelectorAll('[data-official-avatar]').forEach(button => {
    const item = OFFICIAL_AVATARS.find(choice => choice.id === button.dataset.officialAvatar);
    button.classList.toggle('on', !!item && item.dataURL === dataURL);
    button.setAttribute('aria-pressed', item && item.dataURL === dataURL ? 'true' : 'false');
  });
}
function bindOfficialAvatarStrip(strip) {
  if (!strip) return;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startScroll = 0;
  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    strip.classList.remove('dragging');
    document.removeEventListener('pointerup', finishDrag);
    document.removeEventListener('pointercancel', finishDrag);
    if (moved) {
      const blockClick = event => {
        event.preventDefault();
        event.stopPropagation();
        document.removeEventListener('click', blockClick, true);
      };
      document.addEventListener('click', blockClick, true);
      setTimeout(() => document.removeEventListener('click', blockClick, true), 320);
    }
  };
  strip.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startScroll = strip.scrollLeft;
    strip.classList.add('dragging');
    document.addEventListener('pointerup', finishDrag);
    document.addEventListener('pointercancel', finishDrag);
  });
  strip.addEventListener('pointermove', event => {
    if (!dragging) return;
    const distance = event.clientX - startX;
    if (!moved && Math.abs(distance) > 4) moved = true;
    if (!moved) return;
    strip.scrollLeft = startScroll - distance;
    event.preventDefault();
  });
  strip.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    strip.scrollLeft += event.deltaY;
    event.preventDefault();
  }, { passive: false });
}
let socialQrAnchor = null;
let socialQrPinned = null;
let socialQrTimer = 0;
// 二维码卡跟着设置左侧栏走：由 renderSettings() 建在 #set-nav 底部（社交图标上方），
// 这里只负责取用；不再浮到内容区上方。
function socialQrPopover() {
  return document.getElementById('social-qr-pop');
}
function showSocialQr(anchor) {
  const pop = socialQrPopover();
  if (!pop) return;
  clearTimeout(socialQrTimer);
  if (socialQrAnchor && socialQrAnchor !== anchor) socialQrAnchor.classList.remove('on');
  socialQrAnchor = anchor;
  const img = pop.querySelector('#social-qr-img');
  if (img.getAttribute('src') !== anchor.dataset.qr) img.src = anchor.dataset.qr;
  img.alt = anchor.dataset.qrCap;
  anchor.classList.add('on');
  pop.classList.remove('hidden');
}
function hideSocialQr() {
  clearTimeout(socialQrTimer);
  const pop = document.getElementById('social-qr-pop');
  if (pop) pop.classList.add('hidden');
  if (socialQrAnchor) socialQrAnchor.classList.remove('on');
  socialQrAnchor = null;
}
function scheduleHideSocialQr() {
  clearTimeout(socialQrTimer);
  if (socialQrPinned && socialQrPinned === socialQrAnchor) return;
  socialQrTimer = setTimeout(() => { if (!socialQrPinned) hideSocialQr(); }, 140);
}
document.addEventListener('click', event => {
  if (event.target && event.target.closest && event.target.closest('.set-social-link')) return;
  if (!socialQrPinned && !socialQrAnchor) return;
  socialQrPinned = null;
  hideSocialQr();
}, true);
function renderSettings() {
  socialQrPinned = null;
  hideSocialQr();
  const nav = $('set-nav');
  nav.innerHTML = '';
  SET_PAGES.forEach(p => {
    const el = document.createElement('div');
    el.className = 'set-nav-item' + (p.id === setPage ? ' on' : '');
    el.textContent = p.name;
    el.onclick = () => { setPage = p.id; renderSettings(); };
    nav.appendChild(el);
  });
  // 二维码卡建在左侧栏底部（图标上方）：微信/抖音有码，B站/小红书只留图标、暂不挂链接
  const socialLinks = [
    { name: '抖音', icon: 'douyin', qr: 'qr-douyin.png', cap: '抖音 · 49044824665' },
    { name: '微信', icon: 'wechat', qr: 'qr-wechat.png', cap: '微信 · 扫码加好友' },
    { name: 'B站', icon: 'bilibili' },
    { name: '小红书', icon: 'xiaohongshuBook' }
  ];
  const foot = document.createElement('div');
  foot.className = 'set-nav-foot';
  const pop = document.createElement('div');
  pop.id = 'social-qr-pop';
  pop.className = 'social-qr-pop hidden';
  pop.innerHTML = '<div class="social-qr-tile"><img id="social-qr-img" alt=""/></div>';
  foot.appendChild(pop);
  const social = document.createElement('div');
  social.className = 'set-social-links';
  socialLinks.forEach(item => {
    const glyph = window.GWIcon ? window.GWIcon.svg(item.icon, 17) : item.name.slice(0, 1);
    if (!item.qr) {
      const idle = document.createElement('span');
      idle.className = 'set-social-link is-idle';
      idle.title = item.name + ' · 链接暂未开放';
      idle.innerHTML = glyph;
      social.appendChild(idle);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'set-social-link is-live';
    button.dataset.qr = item.qr;
    button.dataset.qrCap = item.cap;
    button.title = item.cap;
    button.setAttribute('aria-label', item.cap + '，悬停查看二维码');
    button.innerHTML = glyph;
    button.onmouseenter = () => showSocialQr(button);
    button.onmouseleave = () => scheduleHideSocialQr();
    button.onfocus = () => showSocialQr(button);
    button.onblur = () => scheduleHideSocialQr();
    button.onclick = () => {
      if (socialQrPinned === button) {
        socialQrPinned = null;
        if (button.matches(':hover')) showSocialQr(button); else hideSocialQr();
      } else {
        socialQrPinned = button;
        showSocialQr(button);
      }
    };
    social.appendChild(button);
  });
  foot.appendChild(social);
  nav.appendChild(foot);
  const body = $('set-body');
  body.scrollTop = 0;
  body.scrollLeft = 0;
  if (setPage === 'interface') {
    body.innerHTML = `
      <h3>界面</h3>
      <div class="set-row"><div><div class="n">主题</div><div class="d">暗色适合长时间盯图；浅色适合给客户展示</div></div>
        <div class="seg" id="seg-theme"><button data-t="dark">深色</button><button data-t="light">浅色</button></div></div>
      <div class="set-row"><div><div class="n">启动音效</div><div class="d">打开软件时播放一次轻量提示音</div></div>
        <div style="display:flex;align-items:center;gap:8px"><button class="btn btn-ghost" id="set-splash-preview" style="height:29px;padding:0 12px">试听</button>
          <div class="seg" id="seg-splash-sound"><button data-v="on">开启</button><button data-v="off">关闭</button></div></div></div>
      <div class="set-row"><div><div class="n">血缘线样式</div><div class="d">画布中"谁生成谁"的连线外观（M2 生成时可见）</div></div>
        <div class="seg" id="seg-line"><button data-s="bezier">贝塞尔</button><button data-s="straight">直线</button></div></div>
      <div class="set-row" style="border:none"><div><div class="n">画布网格</div><div class="d">点阵底纹</div></div>
        <div class="seg"><button class="on">点阵</button><button onclick="toastSoon()">无网格</button></div></div>`;
    const cur = document.documentElement.getAttribute('data-theme');
    body.querySelectorAll('#seg-theme button').forEach(b => {
      b.classList.toggle('on', b.dataset.t === cur);
      b.onclick = () => { setTheme(b.dataset.t); renderSettings(); };
    });
    const splashSound = localStorage.getItem('gw_splash_sound') === 'off' ? 'off' : 'on';
    body.querySelectorAll('#seg-splash-sound button').forEach(b => {
      b.classList.toggle('on', b.dataset.v === splashSound);
      b.onclick = () => {
        localStorage.setItem('gw_splash_sound', b.dataset.v);
        renderSettings();
        if (b.dataset.v === 'on') {
          playSplashSound(true);
          toast('启动音效已开启');
        } else {
          toast('启动音效已关闭');
        }
      };
    });
    body.querySelector('#set-splash-preview').onclick = () => playSplashSound(true);
    const lineStyle = localStorage.getItem('gw_linestyle') || 'bezier';
    body.querySelectorAll('#seg-line button').forEach(b => {
      b.classList.toggle('on', b.dataset.s === lineStyle);
      b.onclick = () => { localStorage.setItem('gw_linestyle', b.dataset.s); renderSettings(); toast('血缘线样式已更新'); };
    });
    const railRow = document.createElement('div');
    railRow.className = 'set-row';
    railRow.innerHTML = '<div><div class="n">画布工具栏</div><div class="d">悬浮图标栏显示在画布哪一侧</div></div>' +
      '<div class="seg" id="seg-rail"><button data-p="left">左</button><button data-p="right">右</button><button data-p="top">上</button><button data-p="bottom">下</button></div>';
    const lineRow = body.querySelector('#seg-line');
    if (lineRow && lineRow.closest('.set-row')) lineRow.closest('.set-row').after(railRow);
    else body.appendChild(railRow);
    const railPos = localStorage.getItem('gw_rail_pos') || 'left';
    applyRailPosition(railPos);
    railRow.querySelectorAll('#seg-rail button').forEach(b => {
      b.classList.toggle('on', b.dataset.p === railPos);
      b.onclick = () => { applyRailPosition(b.dataset.p); renderSettings(); toast('工具栏位置已更新'); };
    });
  } else if (setPage === 'shortcuts') {
    body.innerHTML = `
      <h3>快捷键</h3>
      <div class="d" style="margin:-4px 0 14px;color:var(--faint);font-size:11px;line-height:18px">有快捷键的工具图标，鼠标悬停时提示中会直接显示对应按键。</div>
      <table class="keys-table"><tbody>${shortcutRowsHtml()}</tbody></table>`;
  } else if (setPage === 'account') {
    const uploadLocked = !avatarFeatureUnlocked();
    body.innerHTML = `
      <h3>账号</h3>
      <div class="about-brand" style="margin-bottom:14px">
        <div class="about-logo" style="width:52px;height:52px;font-size:15px;overflow:hidden;padding:0"><img id="set-avatar-img" src="avatar-default.png" style="width:100%;height:100%;object-fit:cover"/></div>
        <div style="min-width:0"><div class="account-name-row"><div class="n">${esc(account.name)}</div>${accountTierMarkup(licenseState)}</div><div class="v">${esc(account.email)}</div></div>
      </div>
      <div class="official-avatar-block${uploadLocked ? ' tier-locked' : ''}">
        <div class="official-avatar-head">
          <div><div class="n">官方头像</div><div class="d">统一黑白风格 · ${OFFICIAL_AVATARS.length} 款人物 · ${uploadLocked ? '未订阅可先用，订阅高级版后高亮' : '所有人可用 · 左右滑动选择'}</div></div>
        </div>
        <div class="official-avatar-grid">${officialAvatarsHtml()}</div>
      </div>
      <div class="official-avatar-block custom-avatar-block">
        <div class="official-avatar-head" style="margin-bottom:0">
          <div><div class="n">自定义头像</div><div class="d">上传自己的图片作为头像${uploadLocked ? ' · 高级版功能' : ''}</div></div>
          <button type="button" class="official-avatar-upload${uploadLocked ? ' is-locked' : ''}" id="set-upload-avatar" aria-disabled="${uploadLocked ? 'true' : 'false'}" title="${uploadLocked ? '上传自定义头像为高级版功能，订阅高级版后开放' : '上传自定义头像'}">${uploadLocked ? '高级版可自定义' : '上传自定义'}</button>
        </div>
      </div>
      <div class="set-row" style="border:none"><div><div class="n">切换账号</div><div class="d">退出当前账号，回到登录页</div></div><button class="btn btn-ghost" id="set-logout">切换账号</button></div>`;
    const sa = body.querySelector('#set-avatar-img');
    bindOfficialAvatarStrip(body.querySelector('.official-avatar-grid'));
    ipcRenderer.invoke('account:get', account.id).then(a => {
      const avatarURL = a && a.avatar ? a.avatar : 'avatar-default.png';
      if (sa) sa.src = avatarURL;
      markOfficialAvatarSelection(avatarURL);
    });
    refreshLicenseState().then(status => {
      const tierEl = body.querySelector('#set-account-tier');
      if (!tierEl) return;
      const tier = accountTierInfo(status);
      tierEl.dataset.plan = tier.plan;
      tierEl.title = tier.label;
      tierEl.setAttribute('aria-label', '账号方案：' + tier.label);
      tierEl.innerHTML = accountTierVisual(tier);
    }).catch(() => {});
    body.querySelectorAll('[data-official-avatar]').forEach(button => {
      button.onclick = async () => {
        const item = OFFICIAL_AVATARS.find(choice => choice.id === button.dataset.officialAvatar);
        if (!item) return;
        const ok = await ipcRenderer.invoke('account:setAvatar', { accountId: account.id, dataURL: item.dataURL, official: true });
        if (!ok) { toast('头像保存失败', true); return; }
        account.avatar = item.dataURL;
        $('tb-avatar-img').src = item.dataURL;
        if (sa) sa.src = item.dataURL;
        markOfficialAvatarSelection(item.dataURL);
        toast('已更换为' + item.label + '头像');
      };
    });
    body.querySelector('#set-upload-avatar').onclick = () => {
      if (!requireAvatarFeature()) return;
      hide('settings-mask');
      changeAvatar();
    };
    body.querySelector('#set-logout').onclick = () => { hide('settings-mask'); $('btn-logout').click(); };
  } else if (setPage === 'license') {
    body.innerHTML = `
      ${DEV_ENTITLEMENTS_ENABLED ? `<div class="dev-entitlement-panel">
        <div class="dev-entitlement-copy"><b>开发权限模拟</b><span>仅主开发版生效，不写入或覆盖真实授权</span></div>
        <div class="seg" id="dev-entitlement-seg">
          <button type="button" data-dev-entitlement="beta">内测未订阅</button>
          <button type="button" data-dev-entitlement="team">团队全部功能</button>
        </div>
      </div>` : ''}
      <h3>订阅与授权</h3>
      <div class="license-settings-status">
        <div class="license-settings-status-main">
          <div class="n" id="set-license-title">正在检查授权…</div>
          <div class="d" id="set-license-detail">激活码仅绑定当前设备，不上传项目文件、图片或 API Key。</div>
        </div>
        <div class="license-settings-side">
          <span class="license-settings-badge" id="set-license-badge">读取中</span>
          <button class="license-text-action" id="set-license-refresh">重新检测</button>
        </div>
      </div>
      <div class="license-plan-block" style="margin-top:16px">
        <div class="license-plan-head"><div class="n">出图额度</div><span class="license-settings-badge">内测期</span></div>
        <div class="license-plan-body" style="padding:30px 26px 26px">
          <div style="display:flex;align-items:baseline;gap:16px;margin-bottom:20px;flex-wrap:wrap">
            <div id="set-pay-amount" style="font-size:40px;font-weight:400;line-height:1;color:var(--text);letter-spacing:-.02em">¥18</div>
            <div id="set-pay-amount-desc" style="font-size:13px;color:var(--sub)"></div>
          </div>

          <div style="height:1px;background:var(--line);margin:0 0 22px"></div>

          <div style="display:flex;gap:26px;align-items:center;margin-bottom:22px;flex-wrap:wrap">
            <div style="flex:0 0 auto;text-align:center">
              <div style="display:inline-block;background:#fff;padding:9px;border-radius:7px;border:1px solid rgba(0,0,0,.10)">
                <img id="set-pay-qr" src="pay-qr-18.png" alt="付款二维码" style="width:104px;height:104px;display:block"/>
              </div>
              <div id="set-pay-qr-note" style="margin-top:8px;font-size:11px;color:var(--faint)">扫码即为 18 元</div>
            </div>
            <div style="flex:1 1 300px;min-width:260px">
              <div style="display:grid;gap:11px;margin-bottom:16px">
                <div style="display:flex;gap:14px;align-items:baseline">
                  <span style="font-size:11px;color:var(--faint);letter-spacing:.12em;min-width:20px">01</span>
                  <span id="set-pay-step-01" style="font-size:13px;color:var(--sub);line-height:1.6">扫码付款，金额已填好，截一张图</span>
                </div>
                <div style="display:flex;gap:14px;align-items:baseline">
                  <span style="font-size:11px;color:var(--faint);letter-spacing:.12em;min-width:20px">02</span>
                  <span style="font-size:13px;color:var(--sub);line-height:1.6">添加微信 <span id="set-pay-wechat" style="color:var(--text)">GIWIN-DESIGN</span>，发图</span>
                </div>
                <div style="display:flex;gap:14px;align-items:baseline">
                  <span style="font-size:11px;color:var(--faint);letter-spacing:.12em;min-width:20px">03</span>
                  <span style="font-size:13px;color:var(--sub);line-height:1.6">额度码填入引擎设置</span>
                </div>
              </div>
              <div class="license-settings-actions">
                <button class="btn btn-primary" id="set-pay-goto-engine">去填额度码</button>
                <button class="btn btn-ghost" id="set-pay-copy-wechat">复制微信号</button>
              </div>
            </div>
          </div>

          <div style="height:1px;background:var(--line);margin:0 0 20px"></div>

          <div id="set-pay-beta-banner" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:9px 13px;background:rgba(232,179,75,.08);border:1px solid rgba(232,179,75,.38);border-radius:9px">
            <span style="font-size:11px;font-weight:600;color:#E8B34B;white-space:nowrap">内测期福利</span>
            <span id="set-pay-beta-text" style="font-size:11px;color:var(--sub)"></span>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap">
            <div id="set-pay-cycle" style="display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden">
              <button type="button" data-cycle="m" style="padding:6px 16px;font-size:12px;border:none;background:transparent;color:var(--sub);cursor:pointer;font-family:inherit">月付</button>
              <button type="button" data-cycle="q" style="padding:6px 16px;font-size:12px;border:none;border-left:1px solid var(--line);background:transparent;color:var(--sub);cursor:pointer;font-family:inherit">季付 · 约9折</button>
              <button type="button" data-cycle="y" style="padding:6px 16px;font-size:12px;border:none;border-left:1px solid var(--line);background:transparent;color:var(--sub);cursor:pointer;font-family:inherit">年付 · 送2个月</button>
            </div>
            <div style="font-size:10px;color:var(--faint)">季 / 年积分一次到账 · 有效期覆盖整个订阅期</div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;align-items:stretch">

            <div data-pay-plan="trial" style="display:flex;flex-direction:column;background:var(--raised);border:1px solid var(--line);border-radius:9px;padding:12px 11px;cursor:pointer;transition:border-color .15s">
              <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-bottom:10px">
                <span style="font-size:12px;color:var(--sub)">体验包</span>
                <span style="font-size:10px;color:var(--faint);white-space:nowrap">限购一次</span>
              </div>
              <div style="display:flex;align-items:baseline;gap:2px">
                <span style="font-size:10px;color:var(--sub)">¥</span>
                <span style="font-size:27px;font-weight:400;line-height:1;color:var(--text);letter-spacing:-.02em">18</span>
                <span style="font-size:10px;color:var(--faint);text-decoration:line-through">30</span>
              </div>
              <div id="set-trial-line" style="margin-top:8px;font-size:11px;color:var(--text)"></div>
              <div id="set-trial-note" style="margin-top:3px;font-size:10px;color:var(--faint);min-height:15px"></div>
              <div style="height:1px;background:var(--line);margin:10px 0 9px"></div>
              <div style="flex:1;display:grid;gap:4px;align-content:start;font-size:10px;color:var(--faint);line-height:1.5">
                <div>失败不计张</div>
                <div>可抵订阅首月</div>
              </div>
            </div>

            <div data-pay-plan="solo" style="display:flex;flex-direction:column;background:var(--raised);border:1px solid var(--line);border-radius:9px;padding:12px 11px;cursor:pointer;transition:border-color .15s">
              <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-bottom:10px">
                <span style="font-size:12px;color:var(--text)">标准</span>
                <span id="set-solo-beta" style="font-size:9px;color:#E8B34B;border:1px solid rgba(232,179,75,.5);border-radius:4px;padding:1px 5px;white-space:nowrap">内测加赠</span>
                <span style="font-size:10px;color:var(--faint);white-space:nowrap;margin-left:auto">多数人选</span>
              </div>
              <div style="display:flex;align-items:baseline;gap:2px">
                <span style="font-size:10px;color:var(--sub)">¥</span>
                <span style="font-size:27px;font-weight:400;line-height:1;color:var(--text);letter-spacing:-.02em" id="set-solo-price">58</span>
                <span style="font-size:10px;color:var(--faint)" id="set-solo-unit">/ 月</span>
              </div>
              <div style="margin-top:8px;font-size:11px;color:var(--text)" id="set-solo-line"></div>
              <div style="margin-top:3px;font-size:10px;color:var(--faint);min-height:15px" id="set-solo-sub">内测加赠 · 出图失败不扣分</div>
              <div style="height:1px;background:var(--line);margin:10px 0 9px"></div>
              <div style="flex:1;display:grid;gap:4px;align-content:start;font-size:10px;color:var(--faint);line-height:1.5">
                <div>基础出图全开放</div>
                <div>自带 Key 不限张</div>
                <div>1 台设备</div>
              </div>
            </div>

            <div data-pay-plan="pro" style="display:flex;flex-direction:column;background:var(--raised);border:1px solid var(--line);border-radius:9px;padding:12px 11px;cursor:pointer;transition:border-color .15s">
              <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-bottom:10px">
                <span style="font-size:12px;color:var(--text)">高级</span>
                <span id="set-pro-beta" style="font-size:9px;color:#E8B34B;border:1px solid rgba(232,179,75,.5);border-radius:4px;padding:1px 5px;white-space:nowrap">内测加赠</span>
                <span style="font-size:10px;color:var(--faint);white-space:nowrap;margin-left:auto">团队 / 量大</span>
              </div>
              <div style="display:flex;align-items:baseline;gap:2px">
                <span style="font-size:10px;color:var(--sub)">¥</span>
                <span style="font-size:27px;font-weight:400;line-height:1;color:var(--text);letter-spacing:-.02em" id="set-pro-price">168</span>
                <span style="font-size:10px;color:var(--faint)" id="set-pro-unit">/ 月</span>
              </div>
              <div style="margin-top:8px;font-size:11px;color:var(--text)" id="set-pro-line"></div>
              <div style="margin-top:3px;font-size:10px;color:var(--faint);min-height:15px" id="set-pro-sub">积分 ≈ 标准 3 倍 · 内测加赠</div>
              <div style="height:1px;background:var(--line);margin:10px 0 9px"></div>
              <div style="flex:1;display:grid;gap:4px;align-content:start;font-size:10px;color:var(--faint);line-height:1.5">
                <div>标准版全部 + 3 席团队</div>
                <div>上传自定义头像 · 资产库工作流</div>
                <div>新功能优先内测</div>
              </div>
            </div>

          </div>

          <div data-pay-plan="pack" style="display:flex;gap:14px;align-items:center;margin-top:10px;background:var(--raised);border:1px solid var(--line);border-radius:9px;padding:11px 14px;cursor:pointer;transition:border-color .15s">
            <div style="display:flex;align-items:baseline;gap:2px;flex:0 0 auto">
              <span style="font-size:10px;color:var(--sub)">¥</span>
              <span style="font-size:22px;font-weight:400;line-height:1;color:var(--text);letter-spacing:-.02em">100</span>
              <span style="font-size:10px;color:var(--faint)">起</span>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;color:var(--text)">积分加油包 · ¥100 = 230 积分 · 90 天有效</div>
              <div style="margin-top:2px;font-size:10px;color:var(--faint)">¥100 起充；更大额直接加微信 GIWIN-DESIGN 定制</div>
            </div>
            <div style="flex:0 0 auto;font-size:10px;color:var(--faint)">通用码转账 100 元</div>
          </div>

          <div style="margin-top:13px;font-size:11px;color:var(--faint);line-height:1.7">
            积分按模型实付折算：1 积分 = 1 张标准图（贵模型如 Seedream 5.0 Pro 按 5 分），生成前显示本次扣分，出图失败不扣分；自带 API Key 出图不扣积分。两档出图能力完全一致（文生图 / 图生图 / 全部尺寸），高级版额外开放订阅级功能，官方头像所有人可用。月付为固定金额码，季 / 年与加油包用通用码转账并备注昵称；加油包不参与内测加赠。
          </div>
        </div>
      </div>
      <div class="license-invite-card">
        <div class="license-invite-head"><b>邀请好友</b><span>好友激活后奖励 7 天</span></div>
        <div class="license-invite-copyline">
          <div class="license-invite-code" id="set-invite-code">正在读取…</div>
          <button class="license-copy-btn" id="set-invite-copy">复制邀请</button>
        </div>
        <div class="license-invite-stats" id="set-invite-stats">已兑换 0 位好友 · 已增加 0 天 · 上限 35 天</div>
        <div class="license-invite-reward">
          <label for="set-invite-reward-code">邀请奖励码</label>
          <input class="license-reward-input" id="set-invite-reward-code" spellcheck="false" autocomplete="off" placeholder="好友成功激活后，粘贴管理员提供的奖励码">
          <div class="license-settings-actions" style="grid-template-columns:1fr">
            <button class="btn btn-ghost" id="set-invite-redeem">兑换邀请奖励</button>
          </div>
        </div>
      </div>
      <div style="margin-top:16px">
        <div style="color:var(--sub);font-size:11px">当前设备 ID</div>
        <div class="license-device-box">
          <div class="license-device-value" id="set-license-device">正在读取…</div>
          <button class="license-copy-btn" id="set-license-copy">复制</button>
        </div>
        <div style="color:var(--sub);font-size:11px;margin-top:13px">激活码 / 积分兑换码</div>
        <textarea class="license-code-input" id="set-license-code" spellcheck="false" autocomplete="off" placeholder="粘贴管理员提供的激活码或 GIWIN4 积分兑换码"></textarea>
        <div class="license-settings-actions" style="grid-template-columns:1fr">
          <button class="btn btn-primary" id="set-license-activate">使用激活码 / 兑换积分</button>
        </div>
        <div style="color:var(--sub);font-size:11px;margin-top:13px">积分余额</div>
        <div class="license-device-box">
          <div class="license-device-value" id="set-points-balance">正在读取…</div>
          <button class="license-copy-btn" id="set-points-refresh">刷新</button>
        </div>
        <div style="font-size:11px;color:var(--faint);margin-top:5px">余额 = 未过期积分码面额合计 − 已消耗；扣分按本次调用的真实算力折算（1 积分 ≈ 1 张标准图）：常用模型 1 分/张、4K 2 分/张、Seedream 5.0 Pro 5 分/张、图层拆分每次 5 分；生成前会显示本次扣分，失败不扣分</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:11px;gap:8px">
          <div style="color:var(--sub);font-size:11px">积分明细</div>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="set-points-month" style="background:var(--raised);border:1px solid var(--line);border-radius:6px;color:var(--text);font-size:11px;padding:2px 6px"><option value="">全部</option></select>
            <button class="license-copy-btn" id="set-points-csv">导出 CSV</button>
          </div>
        </div>
        <div id="set-points-ledger" style="margin-top:7px;max-height:210px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;background:var(--raised)"></div>
        <div class="license-settings-actions">
          <button class="btn btn-ghost" id="set-license-export">导出申请文件</button>
          <button class="btn btn-ghost" id="set-license-import">导入旧版许可证</button>
        </div>
      </div>`;
    const payCopyWechat = body.querySelector('#set-pay-copy-wechat');
    if (payCopyWechat) payCopyWechat.onclick = async () => {
      try {
        await navigator.clipboard.writeText('GIWIN-DESIGN');
        toast('微信号已复制：GIWIN-DESIGN');
      } catch (e) {
        toast('复制失败，请手动添加微信：GIWIN-DESIGN');
      }
    };
    const payGotoEngine = body.querySelector('#set-pay-goto-engine');
    if (payGotoEngine) payGotoEngine.onclick = () => { setPage = 'engine'; renderSettings(); };

    const payQrImg = body.querySelector('#set-pay-qr');
    const payAmountEl = body.querySelector('#set-pay-amount');
    const payDescEl = body.querySelector('#set-pay-amount-desc');
    const payNoteEl = body.querySelector('#set-pay-qr-note');
    const payStep01 = body.querySelector('#set-pay-step-01');
    // 档位 × 周期定价：赠分全部取自 pricing-spec.json（window.GW_PRICING），不再手写数字。
    // 金额是软件使用费，积分是随订阅赠送的额度——两期只差赠分，价格完全一致。
    // 标准：月 58 / 季 156（约 9 折）/ 年 580（10 个月价，送 2 个月）；高级：168 / 450 / 1680。
    const GIFT_SCOPE = giftScopeNow();
    const giftLine = key => giftPointsOf(key, GIFT_SCOPE);
    const PAY_PLAN_COPY = {
      solo: {
        m: { line: giftLine('solo-m') + ' 积分 / 月', sub: (GIFT_SCOPE === 'beta' ? '内测加赠 · ' : '') + '出图失败不扣分' },
        q: { line: giftLine('solo-q') + ' 积分 / 90 天', sub: '季付 · 约 9 折' },
        y: { line: giftLine('solo-y') + ' 积分 / 365 天', sub: '年付 · 送 2 个月使用期' }
      },
      pro: {
        m: { line: giftLine('pro-m') + ' 积分 / 月', sub: '积分 ≈ 标准 3 倍 · ' + (GIFT_SCOPE === 'beta' ? '内测加赠' : '标准额度') },
        q: { line: giftLine('pro-q') + ' 积分 / 90 天', sub: '季付 · 约 9 折' },
        y: { line: giftLine('pro-y') + ' 积分 / 365 天', sub: '年付 · 送 2 个月使用期' }
      }
    };
    const payPlans = {
      trial: { file: 'pay-qr-18.png', price: '¥18', desc: '体验包 · ' + giftLine('trial') + ' 积分 · 30 天', note: '扫码即为 18 元' },
      solo: {
        m: { file: 'pay-qr-58.png', price: '¥58', desc: '标准 · ' + giftLine('solo-m') + ' 积分 · 30 天', note: '扫码即为 58 元' },
        q: { file: 'pay-qr.png', price: '¥156', desc: '标准 · ' + giftLine('solo-q') + ' 积分 · 90 天', note: '转账 156 元并备注昵称' },
        y: { file: 'pay-qr.png', price: '¥580', desc: '标准 · ' + giftLine('solo-y') + ' 积分 · 365 天', note: '转账 580 元并备注昵称' }
      },
      pro: {
        m: { file: 'pay-qr-168.png', price: '¥168', desc: '高级 · ' + giftLine('pro-m') + ' 积分 · 30 天 · 3 席', note: '扫码即为 168 元' },
        q: { file: 'pay-qr.png', price: '¥450', desc: '高级 · ' + giftLine('pro-q') + ' 积分 · 90 天 · 3 席', note: '转账 450 元并备注昵称' },
        y: { file: 'pay-qr.png', price: '¥1680', desc: '高级 · ' + giftLine('pro-y') + ' 积分 · 365 天 · 3 席', note: '转账 1680 元并备注昵称' }
      },
      pack: { file: 'pay-qr.png', price: '¥100', desc: '加油包 · ' + giftLine('boost') + ' 积分 · 90 天 · 约 ' + giftLine('boost') + ' 张标准图', note: '转账 100 元并备注昵称' }
    };
    let payCycle = 'm';
    let payPlanKey = 'trial';
    const planFor = key => {
      const entry = payPlans[key];
      return entry && entry.m ? entry[payCycle] : entry;
    };
    const payPlanCards = Array.from(body.querySelectorAll('[data-pay-plan]'));
    payPlanCards.forEach(card => {
      const matched = /solid\s+([^;]+)/.exec(card.getAttribute('style') || '');
      card.dataset.payBaseBorder = matched ? matched[1].trim() : 'var(--line)';
    });
    // 内测期标示：口径与截止日全部取自 pricing-spec.json，过期自动移除横幅与徽章，无需等发版
    try {
      if (giftScopeNow() === 'standard') {
        const betaBanner = body.querySelector('#set-pay-beta-banner');
        if (betaBanner) betaBanner.remove();
        ['set-solo-beta', 'set-pro-beta'].forEach(id => {
          const el = body.querySelector('#' + id);
          if (el) el.remove();
        });
      } else {
        const betaText = body.querySelector('#set-pay-beta-text');
        const spec = pricingSpec();
        const endsAt = spec && spec.giftPeriods && spec.giftPeriods.beta && spec.giftPeriods.beta.endsAt;
        const endDate = endsAt ? new Date(endsAt) : null;
        const endLabel = endDate && !isNaN(endDate.getTime())
          ? (endDate.getMonth() + 1) + ' 月 ' + endDate.getDate() + ' 日' : '另行通知';
        if (betaText) {
          betaText.innerHTML = '现在购买订阅档，积分按正式期<b style="color:#E8B34B">双倍赠送</b>（标准版 '
            + giftPointsOf('solo-m', 'beta') + ' 积分/月，正式期 ' + giftPointsOf('solo-m', 'standard')
            + ' 积分/月）· 内测期至 ' + endLabel + '，结束后已购积分不受影响';
        }
      }
    } catch (e) {}

    const paintPayPlan = key => {
      const plan = planFor(key);
      if (!plan) return;
      payPlanKey = key;
      if (payQrImg && payQrImg.getAttribute('src') !== plan.file) payQrImg.setAttribute('src', plan.file);
      if (payAmountEl) payAmountEl.textContent = plan.price;
      if (payDescEl) payDescEl.textContent = plan.desc;
      if (payNoteEl) payNoteEl.textContent = plan.note;
      if (payStep01) payStep01.textContent = plan && plan.note && plan.note.indexOf('转账') === 0 ? '用通用码转账对应金额，截一张图' : '扫码付款，金额已填好，截一张图';
      payPlanCards.forEach(card => {
        const active = card.dataset.payPlan === key;
        card.style.borderColor = active ? 'var(--text)' : card.dataset.payBaseBorder;
      });
    };
    payPlanCards.forEach(card => {
      card.onclick = () => paintPayPlan(card.dataset.payPlan);
      card.onmouseenter = () => {
        if (card.dataset.payPlan !== payPlanKey) {
          card.style.borderColor = 'var(--faint)';
        }
      };
      card.onmouseleave = () => paintPayPlan(payPlanKey);
    });

    // 月 / 季 / 年周期切换：切价格、切赠送积分文案，并同步当前选中档的二维码与说明。
    const cycleWrap = body.querySelector('#set-pay-cycle');
    const cycleBtns = cycleWrap ? Array.from(cycleWrap.querySelectorAll('[data-cycle]')) : [];
    const paintCycle = () => {
      cycleBtns.forEach(btn => {
        const on = btn.dataset.cycle === payCycle;
        btn.style.background = on ? 'var(--text)' : 'transparent';
        btn.style.color = on ? 'var(--bg)' : 'var(--sub)';
      });
    };
    const applyCycleCopy = () => {
      const set = (id, text) => { const el = body.querySelector('#' + id); if (el) el.textContent = text; };
      const unit = payCycle === 'm' ? '/ 月' : payCycle === 'q' ? '/ 季' : '/ 年';
      set('set-solo-price', payPlans.solo[payCycle].price.slice(1));
      set('set-solo-unit', unit);
      set('set-trial-line', giftLine('trial') + ' 积分 · 30 天');
      set('set-trial-note', GIFT_SCOPE === 'beta' ? '内测期双倍' : '标准额度');
      set('set-solo-line', PAY_PLAN_COPY.solo[payCycle].line);
      set('set-solo-sub', PAY_PLAN_COPY.solo[payCycle].sub);
      set('set-pro-price', payPlans.pro[payCycle].price.slice(1));
      set('set-pro-unit', unit);
      set('set-pro-line', PAY_PLAN_COPY.pro[payCycle].line);
      set('set-pro-sub', PAY_PLAN_COPY.pro[payCycle].sub);
    };
    const setPayCycle = cycle => {
      payCycle = cycle;
      paintCycle();
      applyCycleCopy();
      paintPayPlan(payPlanKey);
    };
    cycleBtns.forEach(btn => { btn.onclick = () => setPayCycle(btn.dataset.cycle); });
    paintCycle();
    applyCycleCopy();
    if (payQrImg) {
      payQrImg.addEventListener('error', () => {
        const holder = payQrImg.parentElement;
        if (!holder || holder.querySelector('.pay-qr-missing')) return;
        payQrImg.style.display = 'none';
        const missing = document.createElement('div');
        missing.className = 'pay-qr-missing';
        missing.style.cssText = 'width:104px;height:104px;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1.5;color:#b4544c;text-align:center';
        missing.textContent = '收款码缺图';
        holder.appendChild(missing);
      });
    }
    paintPayPlan('trial');
    body.querySelectorAll('[data-dev-entitlement]').forEach(button => {
      button.classList.toggle('on', button.dataset.devEntitlement === devEntitlementMode);
      button.onclick = () => setDevEntitlementMode(button.dataset.devEntitlement);
    });
    const paint = status => {
      paintBase(status);
      if (!DEV_ENTITLEMENTS_ENABLED || !status) return;
      const label = DEV_ENTITLEMENT_LABELS[devEntitlementMode];
      const title = body.querySelector('#set-license-title');
      const detail = body.querySelector('#set-license-detail');
      const badge = body.querySelector('#set-license-badge');
      if (title) title.textContent = '开发权限模拟 · ' + label;
      if (badge) badge.textContent = '本地模拟';
      if (detail) {
        detail.textContent = '真实授权保持为 ' + ((status.license && status.license.edition) || (status.valid ? 'beta' : '未激活')) +
          '；当前仅在主开发版临时模拟「' + label + '」，不修改授权文件。';
      }
    };
    const paintBase = status => {
      const title = body.querySelector('#set-license-title');
      const detail = body.querySelector('#set-license-detail');
      const badge = body.querySelector('#set-license-badge');
      const device = body.querySelector('#set-license-device');
      const inviteCode = body.querySelector('#set-invite-code');
      const inviteStats = body.querySelector('#set-invite-stats');
      if (!status) return;
      device.textContent = status.deviceId || '读取失败';
      inviteCode.textContent = status.inviteCode || '读取失败';
      inviteStats.textContent = '已兑换 ' + (status.referralCount || 0) + ' 位好友 · 已增加 ' + (status.referralBonusDays || 0) + ' 天 · 上限 ' + (status.maxReferralBonusDays || 35) + ' 天';
      title.textContent = status.development ? '开发模式' : (status.valid ? licenseTierLabel(status.license && status.license.edition) + '已激活' : '尚未激活');
      badge.textContent = status.development ? '免授权' : (status.valid ? '剩余 ' + status.daysRemaining + ' 天' : '需要授权');
      detail.textContent = status.license
        ? '版本 ' + (tierLabel => tierLabel === '内测授权' ? '内测' : tierLabel)(licenseTierLabel(status.license.edition)) + ' · 到期 ' + fmtDate(status.license.expiresAt) + ' · ' + status.message
        : status.message;
    };
    refreshLicenseState().then(paint).catch(error => {
      body.querySelector('#set-license-detail').textContent = error.message || '授权状态读取失败';
    });
    body.querySelector('#set-license-copy').onclick = async () => {
      const deviceId = licenseState && licenseState.deviceId || '';
      try {
        await navigator.clipboard.writeText(deviceId);
        toast('设备 ID 已复制');
      } catch (error) {
        toast('复制失败，请手动选择设备 ID', true);
      }
    };
    body.querySelector('#set-invite-copy').onclick = async () => {
      const inviteCode = licenseState && licenseState.inviteCode || '';
      try {
        await navigator.clipboard.writeText(inviteCode);
        toast('邀请码已复制');
      } catch (error) {
        toast('复制失败，请手动选择邀请码', true);
      }
    };
    body.querySelector('#set-license-export').onclick = async () => {
      const result = await ipcRenderer.invoke('license:exportRequest');
      if (result.ok) toast('激活申请文件已导出');
      else if (!result.canceled) toast(result.msg || '导出失败', true);
    };
    body.querySelector('#set-license-activate').onclick = async () => {
      const input = body.querySelector('#set-license-code');
      const code = input.value.trim();
      if (!code) { toast('请先粘贴激活码', true); return; }
      const result = await ipcRenderer.invoke('license:activate', code);
      if (result.pointsAdded != null && result.ok) {
        // 积分码：入账，刷新余额显示，不动授权状态
        input.value = '';
        const pointsEl = body.querySelector('#set-points-balance');
        if (pointsEl) pointsEl.textContent = result.balance + ' 积分';
        const refreshBtn = body.querySelector('#set-points-refresh');
        if (refreshBtn) refreshBtn.click(); // 兑换后同步刷新明细流水
        toast('积分已到账 +' + result.pointsAdded + (result.expiryLabel || '') + '，当前余额 ' + result.balance);
        return;
      }
      if (!result.ok) { toast(result.msg || '激活码无效', true); return; }
      licenseState = result;
      input.value = '';
      paint(result);
      syncLicenseIndicators();
      toast('激活码已更新');
    };
    // 积分余额 + 明细流水展示
    const pointsBalanceEl = body.querySelector('#set-points-balance');
    if (pointsBalanceEl) {
      const ledgerEl = body.querySelector('#set-points-ledger');
      const monthEl = body.querySelector('#set-points-month');
      const fmtTime = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/); return m ? m[2] + '-' + m[3] + ' ' + m[4] : '—'; };
      const paintLedger = async () => {
        const ledger = await ipcRenderer.invoke('points:ledger', { month: monthEl.value || '' });
        if (!ledgerEl) return;
        if (!ledger || !ledger.ok) { ledgerEl.innerHTML = '<div style="padding:10px;color:var(--faint);font-size:11px">明细读取失败</div>'; return; }
        const sig = ledger.months.join(',');
        if (monthEl.dataset.sig !== sig) {
          monthEl.innerHTML = ['<option value="">全部</option>'].concat(ledger.months.map(m =>
            '<option value="' + m + '"' + (m === monthEl.value ? ' selected' : '') + '>' + m + '</option>')).join('');
          monthEl.dataset.sig = sig;
        }
        if (!ledger.rows.length) {
          ledgerEl.innerHTML = '<div style="padding:10px;color:var(--faint);font-size:11px">暂无流水 · 兑换积分码或生图后，这里会显示每一条进出账</div>';
          return;
        }
        const rowHtml = ledger.rows.map(e => {
          const plus = e.points > 0;
          const color = e.type === 'expire' ? 'var(--faint)' : plus ? '#3fb96b' : 'var(--text)';
          return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);font-size:11px">' +
            '<span style="color:var(--faint);white-space:nowrap">' + fmtTime(e.time) + '</span>' +
            '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + e.label +
            (e.tail ? ' <span style="color:var(--faint)">· ' + e.tail + '</span>' : '') + '</span>' +
            '<span style="white-space:nowrap;font-weight:600;color:' + color + '">' + (plus ? '+' : '') + e.points + '</span></div>';
        }).join('');
        const sumHtml = '<div style="display:flex;justify-content:space-between;padding:6px 10px;font-size:11px;color:var(--sub)">' +
          '<span>' + ledger.rows.length + ' 条' + (monthEl.value ? ' · ' + monthEl.value : '') + '</span>' +
          '<span>收入 +' + ledger.monthIn + ' · 支出 −' + ledger.monthOut + '</span></div>';
        ledgerEl.innerHTML = sumHtml + rowHtml;
      };
      const paintPoints = async () => {
        const status = await ipcRenderer.invoke('points:status');
        pointsBalanceEl.textContent = status && status.ok ? (status.balance + ' 积分 · 已兑 ' + status.totalRedeemed + ' / 已耗 ' + status.totalConsumed + (status.totalExpired ? ' / 已过期 ' + status.totalExpired : '')) : '读取失败';
        await paintLedger();
      };
      monthEl.onchange = paintPoints;
      body.querySelector('#set-points-csv').onclick = async () => {
        const r = await ipcRenderer.invoke('points:exportCsv', { month: monthEl.value || '' });
        if (r && r.ok) toast('已导出 ' + r.count + ' 条流水：' + r.path);
        else if (r && !r.canceled) toast('导出失败：' + (r.msg || '未知错误'), true);
      };
      paintPoints();
      body.querySelector('#set-points-refresh').onclick = async () => { await paintPoints(); toast('积分余额已刷新'); };
    }
    body.querySelector('#set-license-code').addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) body.querySelector('#set-license-activate').click();
    });
    body.querySelector('#set-invite-redeem').onclick = async () => {
      const input = body.querySelector('#set-invite-reward-code');
      const code = input.value.trim();
      if (!code) { toast('请先粘贴邀请奖励码', true); return; }
      const result = await ipcRenderer.invoke('license:redeemInviteReward', code);
      if (!result.ok) { toast(result.msg || '邀请奖励码无效', true); return; }
      licenseState = result;
      input.value = '';
      paint(result);
      syncLicenseIndicators();
      toast('邀请奖励已到账，增加 ' + result.rewardDays + ' 天');
    };
    body.querySelector('#set-license-import').onclick = async () => {
      const result = await ipcRenderer.invoke('license:import');
      if (result.canceled) return;
      if (!result.ok) { toast(result.msg || '许可证导入失败', true); return; }
      licenseState = result;
      paint(result);
      syncLicenseIndicators();
      toast('内测许可证已更新');
    };
    body.querySelector('#set-license-refresh').onclick = async () => {
      paint(await refreshLicenseState());
      toast('授权状态已刷新');
    };
  } else if (setPage === 'about') {
    body.innerHTML = `
      <div class="about-brand" style="margin-top:8px">
        <div class="about-logo" style="overflow:hidden;padding:5px;background:#f1efeb"><img src="icon-mark.svg" alt="极物 GIWIN Studio" style="width:100%;height:100%;border-radius:0"/></div>
        <div><div class="n">极物 GIWIN Studio</div><div class="v">Version ${APP_VERSION} · Beta</div></div>
      </div>
      <div class="set-row"><div><div class="n">检查更新</div><div class="d" id="set-update-desc">当前版本 ${APP_VERSION} · 每 6 小时自动检查一次</div></div><button class="btn btn-ghost" id="btn-about-check-update">检查更新</button></div>
      <div class="set-row"><div><div class="n">软件许可协议</div><div class="d">首次启动时已签署，可随时重阅</div></div><button class="btn btn-ghost" id="btn-reread-eula">查看</button></div>
      <div class="set-row"><div><div class="n">隐私与数据</div><div class="d">项目、账号和 API Key 保存在本机；调用第三方模型时，仅向所选服务商发送必要图片与提示词</div></div><button class="btn btn-ghost" id="btn-about-privacy">查看</button></div>
      <div class="set-row"><div><div class="n">当前授权</div><div class="d">内测高级版 · 激活码绑定当前设备</div></div><button class="btn btn-ghost" id="btn-about-license">管理授权</button></div>
      <p style="margin-top:24px;font-size:11px;color:var(--faint);line-height:19px">
        封闭内测构建 · 本地优先<br/>
        项目数据归用户所有，请定期备份工程文件<br/>
        <span style="color:var(--sub)">由 GIWIN-DESIGN 与 AI 协作开发</span></p>`;
    // 检查更新：接真实更新服务（update-service.js），手动检查把结果回显到界面
    const updateBtn = body.querySelector('#btn-about-check-update');
    const updateDesc = body.querySelector('#set-update-desc');
    updateBtn.onclick = async () => {
      updateBtn.disabled = true;
      updateBtn.textContent = '检查中…';
      try {
        const res = await ipcRenderer.invoke('update:check', { manual: true });
        if (!res || !res.ok) {
          const errText = (res && res.error) || '未知错误';
          updateDesc.textContent = '检查失败：' + errText;
          toast(errText, true);
        } else {
          const state = res.state || {};
          if (state.phase === 'available') {
            updateDesc.textContent = '发现新版本，正在打开更新窗口…';
            showUpdateDialog(state);
          } else if (state.error) {
            updateDesc.textContent = '检查失败：' + state.error;
            toast(state.error, true);
          } else {
            const ver = 'v' + (state.currentVersion || APP_VERSION);
            updateDesc.textContent = '已是最新版本 ' + ver + ' · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            toast('已是最新版本 ' + ver);
          }
        }
      } catch (error) {
        updateDesc.textContent = '检查失败，请检查网络后重试';
        toast('检查更新失败', true);
      }
      updateBtn.disabled = false;
      updateBtn.textContent = '检查更新';
    };
    body.querySelector('#btn-reread-eula').onclick = () => {
      $('btn-eula-ok').disabled = false;
      $('eula-hint').textContent = '已签署版本 · 可重阅';
      $('btn-eula-ok').textContent = '关 闭';
      $('btn-eula-ok').onclick = () => hide('screen-eula');
      show('screen-eula');
    };
    body.querySelector('#btn-about-privacy').onclick = () => {
      $('btn-eula-ok').disabled = false;
      $('eula-hint').textContent = '隐私与第三方服务说明见协议第二条和第五条';
      $('btn-eula-ok').textContent = '关 闭';
      $('btn-eula-ok').onclick = () => hide('screen-eula');
      show('screen-eula');
    };
    body.querySelector('#btn-about-license').onclick = () => {
      setPage = 'license';
      renderSettings();
    };
  } else if (setPage === 'engine') {
    renderEnginePage(body);
  } else if (setPage === 'proxy') {
    renderProxyPage(body);
  } else if (setPage === 'perf') {
    renderPerformancePage(body);
  } else if (setPage === 'log') {
    body.innerHTML = `
      <h3>日志</h3>
      <div class="diagnostic-actions">
        <button class="btn btn-ghost" id="diag-refresh">刷新日志</button>
        <button class="btn btn-ghost" id="diag-copy">复制诊断信息</button>
        <button class="btn btn-ghost" id="diag-folder">打开日志目录</button>
      </div>
      <div class="diagnostic-summary">
        <div><span>版本</span><b id="diag-version">读取中</b></div>
        <div><span>渲染状态</span><b id="diag-render">读取中</b></div>
        <div><span>运行环境</span><b id="diag-runtime">读取中</b></div>
      </div>
      <div class="diagnostic-section">
        <div class="diagnostic-section-head"><span>启动日志</span><span id="diag-boot-state">最近记录</span></div>
        <pre class="diagnostic-pre" id="diag-boot">正在读取…</pre>
      </div>
      <div class="diagnostic-section">
        <div class="diagnostic-section-head"><span>错误日志</span><span>仅保存在本机</span></div>
        <pre class="diagnostic-pre" id="diag-crash">正在读取…</pre>
      </div>
      <div style="margin-top:12px;color:var(--faint);font-size:10.5px;line-height:16px">复制前已自动隐藏 API Key、Authorization 和访问令牌。日志不会自动上传。</div>`;
    let diagnostic = null;
    const paintLogs = value => {
      diagnostic = value || {};
      const environment = diagnostic.environment || {};
      const health = diagnostic.health || {};
      body.querySelector('#diag-version').textContent = 'v' + (environment.version || APP_VERSION);
      body.querySelector('#diag-runtime').textContent = [environment.electron && ('Electron ' + environment.electron), environment.arch].filter(Boolean).join(' / ');
      body.querySelector('#diag-render').textContent = health.safeRenderMode ? '软件渲染' : '硬件加速';
      const boot = body.querySelector('#diag-boot');
      const crash = body.querySelector('#diag-crash');
      boot.textContent = diagnostic.boot || '暂无启动日志';
      crash.textContent = diagnostic.crash || '暂无错误日志';
      body.querySelector('#diag-boot-state').textContent = boot.textContent === '暂无启动日志' ? '暂无记录' : '最近 ' + boot.textContent.split('\n').length + ' 行';
    };
    const refreshDiagnostics = async () => {
      try {
        paintLogs(await ipcRenderer.invoke('diagnostics:read'));
      } catch (error) {
        body.querySelector('#diag-boot').textContent = '读取失败：' + error.message;
      }
    };
    body.querySelector('#diag-refresh').onclick = refreshDiagnostics;
    body.querySelector('#diag-copy').onclick = async () => {
      const environment = diagnostic && diagnostic.environment || {};
      const health = diagnostic && diagnostic.health || {};
      const text = [
        'GIWIN Studio 诊断信息',
        'Version: ' + (environment.version || APP_VERSION),
        'Electron: ' + (environment.electron || ''),
        'Chrome: ' + (environment.chrome || ''),
        'Node: ' + (environment.node || ''),
        'Platform: ' + [environment.platform, environment.arch].filter(Boolean).join(' '),
        'Renderer: ' + (health.safeRenderMode ? 'software' : 'hardware'),
        '',
        '--- 启动日志 ---',
        diagnostic && diagnostic.boot || '暂无启动日志',
        '',
        '--- 错误日志 ---',
        diagnostic && diagnostic.crash || '暂无错误日志'
      ].join('\n');
      try {
        await navigator.clipboard.writeText(text);
        toast('诊断信息已复制');
      } catch (error) {
        toast('复制失败，请手动选择日志内容', true);
      }
    };
    body.querySelector('#diag-folder').onclick = async () => {
      const result = await ipcRenderer.invoke('diagnostics:openFolder');
      if (!result.ok) toast(result.msg || '无法打开日志目录', true);
    };
    refreshDiagnostics();
  } else {
    const names = {};
    body.innerHTML = `<h3>${names[setPage] || '设置'}</h3>
      <div class="set-placeholder">「${names[setPage] || '此项目'}」将在对应里程碑交付时解锁。</div>`;
  }
}
window.toastSoon = () => toast('将在后续里程碑解锁');

function renderPerformancePage(body) {
  body.innerHTML = `
    <div class="perf-summary">
      <div class="perf-card"><span>画布规模</span><b id="perf-canvas">读取中…</b><small id="perf-viewport">当前项目运行状态</small></div>
      <div class="perf-card"><span>渲染方式</span><b id="perf-render">读取中…</b><small id="perf-render-note">自动选择</small></div>
      <div class="perf-card"><span>脚本内存</span><b id="perf-memory">读取中…</b><small id="perf-memory-note">当前渲染进程</small></div>
      <div class="perf-card"><span>图片缓存</span><b id="perf-image-cache">读取中…</b><small id="perf-cache-note">原图与缩略图分级</small></div>
    </div>
    <div class="set-row">
      <div><div class="n">实时性能面板</div><div class="d">显示帧率、节点、缓存和视口裁剪状态；快捷键 Ctrl+Alt+Shift+D</div></div>
      <div class="seg" id="perf-hud-seg"><button type="button" data-v="on">开启</button><button type="button" data-v="off">关闭</button></div>
    </div>
    <div class="set-row">
      <div><div class="n">自动性能优化</div><div class="d">按项目和缩放自动启用视口裁剪、缩略图分级与阴影降级</div></div>
      <span class="license-settings-badge" id="perf-auto-state">已启用</span>
    </div>
    <div class="perf-actions">
      <span class="proxy-apply-result" id="perf-refresh-state"></span>
      <div><button class="btn btn-ghost" type="button" id="perf-log">查看日志</button><button class="btn btn-primary" type="button" id="perf-refresh">刷新状态</button></div>
    </div>
    <p class="perf-note">极物会优先保证画布交互流畅。大项目中暂时隐藏的画布内容和普通阴影不会影响导出，导出时会自动恢复完整质量。</p>`;

  const setHudButtons = enabled => {
    body.querySelectorAll('#perf-hud-seg button').forEach(button => {
      button.classList.toggle('on', (button.dataset.v === 'on') === enabled);
    });
  };
  body.querySelectorAll('#perf-hud-seg button').forEach(button => {
    button.onclick = () => {
      const enabled = button.dataset.v === 'on';
      if (enabled) window.GWRuntimeDiagnostics?.show();
      else window.GWRuntimeDiagnostics?.hide();
      setHudButtons(enabled);
    };
  });
  setHudButtons(Boolean(window.GWRuntimeDiagnostics?.isVisible?.()));

  const paint = async () => {
    const refreshState = body.querySelector('#perf-refresh-state');
    if (refreshState) refreshState.textContent = '正在刷新…';
    let diagnostic = {};
    try { diagnostic = await ipcRenderer.invoke('diagnostics:read') || {}; } catch (error) {}
    if (!body.isConnected || !body.querySelector('#perf-canvas')) return;
    const stats = window.GWCanvas?.getRuntimeStats?.() || null;
    const health = diagnostic.health || {};
    const canvas = body.querySelector('#perf-canvas');
    const viewport = body.querySelector('#perf-viewport');
    const render = body.querySelector('#perf-render');
    const renderNote = body.querySelector('#perf-render-note');
    const memory = body.querySelector('#perf-memory');
    const memoryNote = body.querySelector('#perf-memory-note');
    const imageCache = body.querySelector('#perf-image-cache');
    const cacheNote = body.querySelector('#perf-cache-note');
    const autoState = body.querySelector('#perf-auto-state');

    if (stats) {
      canvas.textContent = stats.nodes + ' 节点，' + stats.edges + ' 连线';
      viewport.textContent = '缩放 ' + stats.zoom + '%，视口 ' + (stats.viewport ? stats.viewport.w + '×' + stats.viewport.h : '—');
      memory.textContent = stats.memory ? stats.memory.usedMB + ' / ' + stats.memory.limitMB + ' MB' : '浏览器未开放';
      memoryNote.textContent = stats.memory ? ('已用约 ' + Math.round(stats.memory.usedMB / Math.max(1, stats.memory.limitMB) * 100) + '%') : '不影响画布使用';
      if (stats.images) {
        imageCache.textContent = (stats.images.fullMB + stats.images.thumbMB) + ' MB';
        cacheNote.textContent = '原图 ' + stats.images.fullCount + '，缩略图 ' + stats.images.thumbCount + (stats.images.worker ? '，后台解码' : '');
      } else {
        imageCache.textContent = '暂无缓存';
        cacheNote.textContent = '打开或生成图片后显示';
      }
      const culling = stats.culling;
      autoState.textContent = culling && culling.enabled ? '视口裁剪运行中' : '自动优化已启用';
    } else {
      canvas.textContent = '未打开项目';
      viewport.textContent = '打开工程后显示画布数据';
      memory.textContent = '—';
      memoryNote.textContent = '等待画布';
      imageCache.textContent = '暂无缓存';
      cacheNote.textContent = '打开或生成图片后显示';
    }
    render.textContent = health.safeRenderMode ? '软件渲染' : '硬件加速';
    renderNote.textContent = health.safeRenderMode ? '已进入兼容模式，可在日志中排查' : '默认使用 GPU 加速';
    if (refreshState) refreshState.textContent = '状态已更新';
  };

  body.querySelector('#perf-refresh').onclick = paint;
  body.querySelector('#perf-log').onclick = () => { setPage = 'log'; renderSettings(); };
  paint();
}

// ============ M2 引擎设置页 ============
const ENGINE_PROVIDER_LOGOS = {
  apollo: 'logos/provider-apollo.png',
  bailian: 'logos/alibaba.svg',
  topaz302: 'logos/generic.svg',
  runninghub: 'logos/provider-runninghub.ico',
  deepseek: 'logos/provider-deepseek.ico',
  volc: 'logos/provider-volc.png',
  custom: 'logos/generic.svg',
  openai: 'logos/provider-openai.png'
};
function engineProviderLogo(id) {
  return ENGINE_PROVIDER_LOGOS[id] || 'logos/generic.svg';
}
// #163 自定义引擎：常见供应商一键填入 + 三处图标联动（引擎选择器 / 接口地址 / 当前模型）
const CUSTOM_URL_PROVIDERS = [
  { id: 'google', label: 'Gemini', logo: 'logos/google.svg', url: 'https://generativelanguage.googleapis.com/v1beta/openai/', match: /googleapis\.com|generativelanguage/i },
  { id: 'apollo', label: '阿波罗', logo: 'logos/provider-apollo.png', url: 'https://apilio.ai/v1', match: /apilio\.ai/i },
  { id: 'openai', label: 'OpenAI', logo: 'logos/openai.svg', url: 'https://api.openai.com/v1', match: /openai\.com/i },
  { id: 'deepseek', label: 'DeepSeek', logo: 'logos/deepseek.svg', url: 'https://api.deepseek.com/v1', match: /deepseek\.com/i },
  { id: 'volc', label: '火山方舟', logo: 'logos/volc.svg', url: 'https://ark.cn-beijing.volces.com/api/v3', match: /volces\.com|volcengine\.com/i },
  { id: 'alibaba', label: '阿里百炼', logo: 'logos/alibaba.svg', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', match: /aliyuncs\.com/i },
  { id: 'topaz302', label: '302.AI', logo: 'logos/generic.svg', url: 'https://api.302.ai/v1', match: /302\.ai/i }
];
const CUSTOM_MODEL_HINTS = [
  { id: 'google', logo: 'logos/google.svg', re: /gemini|nano-banana|imagen/i },
  { id: 'openai', logo: 'logos/openai.svg', re: /gpt|dall-e|dalle|chatgpt/i },
  { id: 'deepseek', logo: 'logos/deepseek.svg', re: /deepseek/i },
  { id: 'volc', logo: 'logos/volc.svg', re: /seedream|seededit|doubao/i },
  { id: 'alibaba', logo: 'logos/alibaba.svg', re: /qwen|wanx|wan2/i },
  { id: 'kuaishou', logo: 'logos/kuaishou.svg', re: /kling/i },
  { id: 'flux', logo: 'logos/flux.svg', re: /flux/i },
  { id: 'stability', logo: 'logos/stability.svg', re: /stable-diffusion|sd3|sdxl/i },
  { id: 'zhipu', logo: 'logos/zhipu.svg', re: /glm|cogview/i },
  { id: 'xai', logo: 'logos/xai.svg', re: /grok/i },
  { id: 'midjourney', logo: 'logos/midjourney.svg', re: /midjourney|\bmj[-_]/i },
  { id: 'tencent', logo: 'logos/tencent.svg', re: /hunyuan/i }
];
function detectCustomProvider(baseURL, model) {
  const url = String(baseURL || '');
  for (const p of CUSTOM_URL_PROVIDERS) if (p.match.test(url)) return { id: p.id, label: p.label, logo: p.logo };
  const m = String(model || '');
  for (const h of CUSTOM_MODEL_HINTS) if (h.re.test(m)) return { id: h.id, label: h.id, logo: h.logo };
  return { id: 'generic', label: '自定义', logo: 'logos/generic.svg' };
}
function engineConsoleTarget(id, baseURL) {
  if (id === 'runninghub') {
    return {
      label: 'RunningHub 控制台',
      url: /runninghub\.cn/i.test(baseURL) ? 'https://www.runninghub.cn' : 'https://www.runninghub.ai'
    };
  }
  return {
    apollo: { label: '阿波罗控制台', url: 'https://apilio.ai' },
    volc: { label: '火山方舟控制台', url: 'https://console.volcengine.com/ark' },
    replicate: { label: 'Replicate API Tokens', url: 'https://replicate.com/account/api-tokens' },
    bailian: { label: '阿里云百炼控制台', url: 'https://bailian.console.aliyun.com/' },
    topaz302: { label: '302.AI 控制台', url: 'https://dash.302.ai/' },
    openai: { label: 'OpenAI 控制台', url: 'https://platform.openai.com/' },
    deepseek: { label: 'DeepSeek 控制台', url: 'https://platform.deepseek.com/' }
  }[id] || null;
}
function engineProviderState(id, cur, cfgs, usedIds) {
  if (usedIds.includes(id) || id === cur) return '使用中';
  return cfgs[id] && cfgs[id].apiKey ? '已配置' : '';
}
function renderEnginePage(body) {
  const P = window.GWProviders;
  if (!P) { body.innerHTML = '<h3>引擎</h3><div class="set-placeholder">引擎模块未加载</div>'; return; }
  const cfgs = P.loadConfigs();
  const ids = Object.keys(P.PROVIDERS);
  const usage = window.GWCanvas && GWCanvas.getModelUsage ? GWCanvas.getModelUsage() : [];
  const usedIds = usage.map(item => item.engineId).filter(id => ids.indexOf(id) >= 0);
  const configuredIds = ids.filter(id => cfgs[id] && cfgs[id].apiKey);
  const savedEngineId = localStorage.getItem('gw_last_engine');
  const initialEngineId = usedIds[0] || (ids.indexOf(savedEngineId) >= 0 ? savedEngineId : '') ||
    configuredIds[0] || ids[0];
  const cur = (body.__engId && ids.indexOf(body.__engId) >= 0) ? body.__engId : initialEngineId;
  const orderedIds = [...new Set([cur].concat(usedIds, configuredIds, ids))];
  const def = P.PROVIDERS[cur];
  const cfg = cfgs[cur] || {};
  let currentRealModel = P.realIdOf ? P.realIdOf(cfg.model || def.model, cur) : (cfg.model || def.model);
  if (cur === 'runninghub' && !/seedream-(5-0-pro|v5-pro)/i.test(currentRealModel)) currentRealModel = 'doubao-seedream-5-0-pro-250930';
  if (cur === 'deepseek' && (!cfg.model || cfg.model === 'deepseek-chat')) currentRealModel = def.model;
  const deepseekVisionModel = (cfg.visionModel && !/^(deepseek-vl2|deepseek-v4-pro)$/i.test(cfg.visionModel)) ? cfg.visionModel : (def.visionModel || 'deepseek-flash');
  const apolloVisionModel = cfg.visionModel || def.visionModel || 'gpt-4o';
  const currentCaps = P.getCapabilities ? P.getCapabilities(cur, currentRealModel) : null;
  const currentVendor = P.vendorMeta ? P.vendorMeta(cur, currentRealModel) : null;
  const catalog = P.modelCatalogStatus ? P.modelCatalogStatus(cur) : { count: 0, syncedAt: 0 };
  const catalogTime = catalog.syncedAt
    ? new Date(catalog.syncedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  const catalogState = catalog.count
    ? '模型目录：' + catalog.count + ' 个 · ' + catalogTime
    : '模型目录尚未同步';
  const supportsCatalog = ['apollo', 'openai', 'deepseek', 'volc', 'custom'].includes(cur);
  const storageMode = P.storageMode ? P.storageMode() : 'local';
  const baseURLValue = cur === 'runninghub'
    ? normalizeRunningHubBaseURL(cfg.baseURL || def.baseURL)
    : (cfg.baseURL || def.baseURL);
  const consoleTarget = engineConsoleTarget(cur, baseURLValue);
  // #163 自定义引擎：按 Base URL / 模型名识别实际供应商，驱动三处图标联动
  const customMeta = detectCustomProvider(
    cur === 'custom' ? baseURLValue : ((cfgs.custom && cfgs.custom.baseURL) || ''),
    cur === 'custom' ? currentRealModel : ((cfgs.custom && cfgs.custom.model) || '')
  );
  body.innerHTML = `
    <h3>引擎（API 配置）</h3>
    ${cfg.apiKey ? '' : `
    <div class="license-plan-block" style="margin-bottom:16px">
      <div class="license-plan-head"><div class="n">还没有 API Key？</div><span class="license-settings-badge">内测期</span></div>
      <div class="license-plan-body" style="padding:14px 16px;color:var(--sub);font-size:12px;line-height:1.8">
        最省事的方式：在「订阅与授权」订阅或买加油包，把额度码粘贴到「阿波罗算力」即可出图——按积分扣费，出图失败不扣。<br>
        如果你在其他模型服务商已有自己的 API Key，选对应引擎填入也一样能用，出图不扣积分。
        <div class="license-settings-actions" style="margin-top:10px;grid-template-columns:1fr">
          <button class="btn btn-primary" id="eng-pay-goto-license">去订阅 / 买加油包</button>
        </div>
      </div>
    </div>`}
    <div class="field" style="margin-bottom:16px">
      <label>选择引擎</label>
      <div class="gw-model-picker engine-picker" id="eng-picker">
        <button id="eng-picker-btn" class="gw-model-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
          <img id="eng-picker-logo" class="gw-vendor-logo" src="${esc(cur === 'custom' ? customMeta.logo : engineProviderLogo(cur))}" alt="">
          <span class="gw-model-current">${esc(P.PROVIDERS[cur].label)}${engineProviderState(cur, cur, cfgs, usedIds) ? ' · ' + engineProviderState(cur, cur, cfgs, usedIds) : ''}</span>
          <span class="gw-caret" aria-hidden="true">▾</span>
        </button>
        ${consoleTarget ? `<button type="button" class="engine-console-icon" id="eng-console-link" data-console-url="${esc(consoleTarget.url)}" aria-label="打开${esc(consoleTarget.label)}" title="${esc(consoleTarget.label)}">${window.GWIcon ? window.GWIcon.svg('external', 15) : '↗'}</button>` : ''}
        <div id="eng-picker-menu" class="gw-model-menu hidden" role="listbox" aria-label="选择引擎">
          ${orderedIds.map(k => `<button type="button" class="gw-model-option ${k === cur ? 'on' : ''}" data-engine-id="${esc(k)}" role="option" aria-selected="${k === cur ? 'true' : 'false'}">
            <img class="gw-vendor-logo" src="${esc(k === 'custom' ? customMeta.logo : engineProviderLogo(k))}" alt="">
            <span>${esc(P.PROVIDERS[k].label)}</span>
            ${engineProviderState(k, cur, cfgs, usedIds) ? `<span class="engine-option-state">${engineProviderState(k, cur, cfgs, usedIds)}</span>` : ''}
          </button>`).join('')}
        </div>
      </div>
      <div class="engine-provider-note">API 的充值、余额及调用费用由你与所选供应商直接结算，极物不代收。</div>
    </div>
    <div class="field">
      <label>API Key</label>
      <div style="position:relative">
        <input id="eng-key" type="password" placeholder="sk-..." value="${esc(cfg.apiKey || '')}" style="padding-right:34px" />
        <button id="eng-eye" title="显示/隐藏 Key" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:none;background:transparent;cursor:pointer;color:var(--sub);font-size:13px;border-radius:6px">👁</button>
      </div>
      <div style="font-size:11px;color:var(--faint);margin-top:5px">${def.hint}</div>
      <div style="font-size:11px;margin-top:5px;color:${storageMode === 'encrypted' ? 'var(--faint)' : 'var(--danger)'}">${storageMode === 'encrypted' ? '🔒 密钥使用系统安全存储加密保存' : '⚠ 系统加密不可用，密钥暂存在本地浏览器存储'}</div>
    </div>
    <div class="field">
      <label>接口地址（Base URL）</label>
      <input id="eng-url" value="${esc(baseURLValue)}" placeholder="https://api.example.com/v1" />
      ${cur === 'custom' ? `<div class="engine-url-presets" id="eng-url-presets">${CUSTOM_URL_PROVIDERS.map(p => `<button type="button" class="engine-url-chip" data-pid="${esc(p.id)}" data-url="${esc(p.url)}" title="点击填入 ${esc(p.url)}"><img src="${esc(p.logo)}" alt="">${esc(p.label)}</button>`).join('')}</div>` : ''}
      ${cur === 'runninghub' ? `<div style="display:flex;gap:6px;margin-top:6px"><button id="rh-ai" class="btn btn-ghost" style="font-size:11px;padding:3px 8px;border:1px solid transparent">国际版 .ai</button><button id="rh-cn" class="btn btn-ghost" style="font-size:11px;padding:3px 8px;border:1px solid transparent">国内版 .cn</button></div>` : ''}
      <div style="font-size:11px;color:var(--faint);margin-top:5px">${cur === 'runninghub' ? 'RunningHub 官方地址：国际版 www.runninghub.ai；国内版 www.runninghub.cn' : (cur === 'topaz302' ? '默认使用 https://api.302.ai；由用户自己的 302.AI Key 计费。' : '以你控制台"接入指南"显示为准，如 https://apilio.ai/v1')}</div>
    </div>
    <div class="field">
      <label>${cur === 'topaz302' ? '增强模型' : (cur === 'openai' ? '识别模型' : (cur === 'deepseek' ? '对话模型' : '当前模型（与生成面板同步）'))}</label>
      ${cur === 'topaz302'
        ? `<div title="${esc(currentRealModel)}" style="height:36px;display:flex;align-items:center;gap:8px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:0 11px;font-size:13px;color:var(--text)">
             <img class="gw-vendor-logo" src="${esc(engineProviderLogo(cur))}" alt="">
             <span>${esc(P.aliasOf ? P.aliasOf(currentRealModel) : currentRealModel)}</span>
           </div>
           <input id="eng-model" type="hidden" value="${esc(currentRealModel)}" />
           <div style="font-size:11px;color:var(--faint);margin-top:5px">固定用于高清放大，不参与普通生图和全景修复；实际倍率在放大时选择。</div>`
        : (cur === 'openai'
        ? `<input id="eng-model" value="${esc(currentRealModel)}" placeholder="例如 gpt-5 / gpt-4.1" style="width:100%;height:36px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:0 11px;font-size:13px;color:var(--text)" />
           <div style="font-size:11px;color:var(--faint);margin-top:5px">用于空间材质视觉识别；填写你的账号可用视觉模型，不参与生图。</div>`
        : (cur === 'deepseek'
          ? `<input id="eng-model" value="${esc(currentRealModel)}" placeholder="deepseek-chat" style="width:100%;height:36px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:0 11px;font-size:13px;color:var(--text)" />
             <div style="font-size:11px;color:var(--faint);margin-top:5px">用于后续对话系统；默认 deepseek-chat。</div>
             <label style="margin-top:12px">视觉模型（材质识别）</label>
             <input id="eng-vision-model" value="${esc(deepseekVisionModel)}" placeholder="deepseek-flash" style="width:100%;height:36px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:0 11px;font-size:13px;color:var(--text)" />
             <div style="font-size:11px;color:var(--faint);margin-top:5px">deepseek-flash 支持看图；实测 deepseek-v4-pro 不接收图片。视觉识别默认使用 flash。</div>`
          : `<div title="${esc(currentRealModel)}" style="height:36px;display:flex;align-items:center;gap:8px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:0 11px;font-size:13px;color:var(--text)"><img id="eng-current-logo" class="gw-vendor-logo" src="${esc(cur === 'custom' ? customMeta.logo : (currentVendor ? currentVendor.logo : 'logos/generic.svg'))}" alt="">${esc(P.aliasOf ? P.aliasOf(currentRealModel) : currentRealModel)}</div>
           <input id="eng-model" type="hidden" value="${esc(currentRealModel)}" />
           <div style="font-size:11px;color:var(--faint);margin-top:5px">支持尺寸：${currentCaps ? currentCaps.sizes.map(z => z === 'auto' ? '跟随原图' : z).join(' / ') : '—'}　支持比例：${currentCaps ? currentCaps.aspects.filter(a => a !== 'auto').join(' / ') : '—'}</div>
           ${cur !== 'custom' && P.isRegisteredModel && !P.isRegisteredModel(cur, currentRealModel) ? '<div style="font-size:11px;color:var(--faint);margin-top:4px">该模型没有登记尺寸档位，按通用尺寸/比例出图</div>' : ''}
           <div style="font-size:11px;color:var(--faint);margin-top:5px">在右侧生成面板切换模型——此处仅显示</div>`))}
    </div>  <!-- #112 模型一处说话 -->
    ${supportsCatalog ? `<div class="engine-catalog-row">
      <span class="${catalog.count ? 'ready' : ''}" id="eng-catalog-state">${esc(catalogState)}</span>
      <button class="btn btn-ghost" type="button" id="eng-sync-models">同步模型</button>
    </div>` : ''}
    ${cur === 'apollo' ? `<div class="field">
      <label>视觉识别模型</label>
      <input id="eng-vision-model" value="${esc(apolloVisionModel)}" placeholder="例如 gpt-4o / gpt-4.1 / gemini-2.5-pro" style="width:100%;height:36px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:0 11px;font-size:13px;color:var(--text)" />
      <div style="font-size:11px;color:var(--faint);margin-top:5px">用于软装识图、材质识别、反推提示词和方案文案；不影响上方生图模型。</div>
    </div>` : ''}
    <div class="field">
      <label>材质识别使用</label>
      <select id="eng-vision-provider" style="width:100%;height:36px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;color:var(--text)">
        <option value="openai" ${(localStorage.getItem('gw_vision_provider') || 'openai') === 'openai' ? 'selected' : ''}>OpenAI GPT 视觉</option>
        <option value="apollo" ${localStorage.getItem('gw_vision_provider') === 'apollo' ? 'selected' : ''}>阿波罗 / Apollo 视觉</option>
        <option value="deepseek" ${localStorage.getItem('gw_vision_provider') === 'deepseek' ? 'selected' : ''}>DeepSeek Flash 视觉</option>
      </select>
      <div style="font-size:11px;color:var(--faint);margin-top:5px">需要对应引擎已填写 Key；DeepSeek 视觉还需填写视觉模型。</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:6px;justify-content:flex-end">
      <button class="btn btn-ghost" id="eng-test">测试连接</button>
      <button class="btn btn-primary" id="eng-save">保存</button>
    </div>
    <div id="eng-test-result" style="font-size:12px;color:var(--sub);margin-top:8px;text-align:right"></div>
    <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:12px">
      <div style="font-size:12px;color:var(--sub);margin-bottom:8px">模型特性表 <span style="font-size:10.5px;color:var(--faint)">基础能力本地登记 · 可用模型按平台同步</span></div>
      <div class="model-cap-table">
      <div class="model-cap-head"><span>模型</span><span>规格与定位</span></div>
      ${P.NOTES.slice().sort((a, b) => {
        const order = { apollo: 0, volc: 1, runninghub: 2, openai: 3, deepseek: 4, any: 5 };
        return (order[a.engine] == null ? 9 : order[a.engine]) - (order[b.engine] == null ? 9 : order[b.engine]);
      }).map(n => {
        const caps = P.getCapabilities ? P.getCapabilities(n.engine, n.id) : null;
        const vendor = P.vendorMeta ? P.vendorMeta(n.engine, n.id) : null;
        const engineLabel = n.engine === 'any' ? '通用兼容' : (P.PROVIDERS[n.engine] ? P.PROVIDERS[n.engine].label : n.engine);
        const typeLabel = n.type === 'vision' ? '识图' : (n.type === 'chat' ? '对话' : '生图');
        const sizeText = n.type === 'generate' && caps
          ? caps.sizes.map(z => z === 'auto' ? '跟随原图' : z).join(' / ')
          : (n.type === 'vision' ? '仅识图' : '仅对话');
        const aspectText = n.type === 'generate' && caps
          ? caps.aspects.filter(a => a !== 'auto').join(' / ')
          : '不用于生图';
        // 扣分直接由成本表算出来，不写死在文案里：客户在选模型时就能看见「1 分/张」还是「5 分/张」，
        // 不必出完图才发现差价。只有阿波罗通道扣积分，自有 Key 不扣。
        let costText = '';
        if (n.type === 'generate' && n.engine === 'apollo' && P.quotaCostFor) {
          const p1 = P.quotaCostFor(n.id, '1K');
          const p4 = P.quotaCostFor(n.id, '4K');
          const has4k = !!caps && caps.sizes.includes('4K');
          costText = p1 + ' 积分/张' + (has4k && p4 !== p1 ? '（4K ' + p4 + '）' : '');
        }
        return `
        <div class="note-card model-cap-row" data-model="${esc(n.id || n.model)}">  <!-- #121 纯阅读 -->
          <div class="model-cap-model">
            ${vendor ? `<img class="gw-vendor-logo model-cap-logo" src="${esc(vendor.logo)}" alt="">` : ''}
            <div><b>${esc(n.model)}</b><small>${esc(engineLabel)} · ${esc(typeLabel)}</small></div>
          </div>
          <div class="model-cap-spec">
            <span>${esc(sizeText)}</span>
            <small>${esc(aspectText)}</small>
            ${costText ? `<small style="color:#8fd4a8;font-weight:600">${esc(costText)}</small>` : ''}
          </div>
          <div class="model-cap-note">${esc(n.note || '特性说明待补充')}</div>
        </div>`;
      }).join('')}
      </div>
    </div>`;
  body.__engId = cur;
  body.querySelector('#eng-model') && body.querySelector('#eng-model').addEventListener('change', () => { saveEngineFrom(body, cur); toast('模型已同步'); syncCustomProviderUI(); });
  const enginePicker = body.querySelector('#eng-picker');
  const enginePayEntry = body.querySelector('#eng-pay-goto-license');
  if (enginePayEntry) enginePayEntry.onclick = () => { setPage = 'license'; renderSettings(); };
  const enginePickerButton = body.querySelector('#eng-picker-btn');
  const enginePickerMenu = body.querySelector('#eng-picker-menu');
  const setEnginePickerOpen = open => {
    enginePickerMenu.classList.toggle('hidden', !open);
    enginePickerButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  enginePickerButton.onclick = event => {
    event.stopPropagation();
    setEnginePickerOpen(enginePickerMenu.classList.contains('hidden'));
  };
  enginePickerButton.onkeydown = event => {
    if (event.key === 'Escape') setEnginePickerOpen(false);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setEnginePickerOpen(true);
      enginePickerMenu.querySelector('.gw-model-option')?.focus();
    }
  };
  enginePicker.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setEnginePickerOpen(false);
      enginePickerButton.focus();
    }
  });
  enginePickerMenu.querySelectorAll('[data-engine-id]').forEach(option => {
    option.onclick = () => {
      const nextEngine = option.dataset.engineId;
      if (!nextEngine || nextEngine === cur) {
        setEnginePickerOpen(false);
        return;
      }
      saveEngineFrom(body, cur);
      body.__engId = nextEngine;
      localStorage.setItem('gw_last_engine', nextEngine);
      renderEnginePage(body);
    };
  });
  const consoleLink = body.querySelector('#eng-console-link');
  if (consoleLink) consoleLink.onclick = async () => {
    const result = await ipcRenderer.invoke('app:openExternal', consoleLink.dataset.consoleUrl);
    if (!result || !result.ok) toast((result && result.msg) || '无法打开供应商控制台', true);
  };
  body.querySelector('#eng-sel')?.addEventListener('change', (e) => {
    saveEngineFrom(body, cur);
    body.__engId = e.target.value;
    localStorage.setItem('gw_last_engine', e.target.value);
    renderEnginePage(body);
  });
  const visionProvider = body.querySelector('#eng-vision-provider');
  if (visionProvider) visionProvider.onchange = () => {
    localStorage.setItem('gw_vision_provider', visionProvider.value);
    const visionLabel = {
      apollo: '阿波罗 / Apollo 视觉',
      openai: 'OpenAI GPT 视觉',
      deepseek: 'DeepSeek Flash 视觉'
    }[visionProvider.value] || visionProvider.value;
    toast('材质识别引擎已切换为：' + visionLabel);
  };
  // #162 RunningHub .ai/.cn 一键切换 + 选中状态
  const rhAi = body.querySelector('#rh-ai');
  const rhCn = body.querySelector('#rh-cn');
  const urlInput = body.querySelector('#eng-url');
  function updateRhBtnState() {
    const val = urlInput.value.trim();
    const active = 'var(--accent)';
    const inactive = 'transparent';
    if (rhAi) rhAi.style.borderColor = val.includes('.ai') ? active : inactive;
    if (rhCn) rhCn.style.borderColor = val.includes('.cn') ? active : inactive;
  }
  updateRhBtnState();
  if (rhAi) rhAi.onclick = () => { urlInput.value = 'https://www.runninghub.ai'; updateRhBtnState(); };
  if (rhCn) rhCn.onclick = () => { urlInput.value = 'https://www.runninghub.cn'; updateRhBtnState(); };
  urlInput.addEventListener('input', updateRhBtnState);
  // #163 自定义引擎：供应商图标三处联动（引擎选择器 / 接口地址 / 当前模型）
  const pickerLogoImg = body.querySelector('#eng-picker-logo');
  const currentLogoImg = body.querySelector('#eng-current-logo');
  function syncCustomProviderUI() {
    if (cur !== 'custom') return;
    const modelInput = body.querySelector('#eng-model');
    const meta = detectCustomProvider(urlInput.value.trim(), (modelInput && modelInput.value) || currentRealModel);
    if (pickerLogoImg) pickerLogoImg.src = meta.logo;
    if (currentLogoImg) currentLogoImg.src = meta.logo;
    body.querySelectorAll('#eng-url-presets .engine-url-chip').forEach(chip => {
      chip.classList.toggle('on', chip.dataset.pid === meta.id);
    });
  }
  const presetWrap = body.querySelector('#eng-url-presets');
  if (presetWrap) presetWrap.querySelectorAll('.engine-url-chip').forEach(chip => {
    chip.onclick = () => { urlInput.value = chip.dataset.url; syncCustomProviderUI(); };
  });
  urlInput.addEventListener('input', syncCustomProviderUI);
  syncCustomProviderUI();
  body.querySelector('#eng-eye').onclick = () => {
    const k = body.querySelector('#eng-key');
    k.type = k.type === 'password' ? 'text' : 'password';
  };
  body.querySelector('#eng-save').onclick = () => {
    saveEngineFrom(body, cur);
    localStorage.setItem('gw_last_engine', cur);
    toast('已保存到本机');
  };
  const syncModelsButton = body.querySelector('#eng-sync-models');
  if (syncModelsButton) syncModelsButton.onclick = async () => {
    const resultBox = body.querySelector('#eng-test-result');
    const catalogStateBox = body.querySelector('#eng-catalog-state');
    syncModelsButton.disabled = true;
    syncModelsButton.textContent = '同步中…';
    resultBox.textContent = '';
    try {
      saveEngineFrom(body, cur);
      const result = await P.syncModels(cur);
      catalogStateBox.textContent = '模型目录：' + result.count + ' 个 · ' +
        new Date(result.syncedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      catalogStateBox.classList.add('ready');
      resultBox.textContent = '✓ 模型目录已同步';
    } catch (error) {
      resultBox.textContent = '× ' + (error.message || '模型目录同步失败');
    } finally {
      syncModelsButton.disabled = false;
      syncModelsButton.textContent = '同步模型';
    }
  };
  body.querySelector('#eng-test').onclick = async () => {
    const r = body.querySelector('#eng-test-result');
    r.textContent = '测试中…';
    const c = P.loadConfigs()[cur] || {};
    const isRH = cur === 'runninghub';
    try {
      if (cur === 'replicate') {
        saveEngineFrom(body, cur);
        const result = await ipcRenderer.invoke('replicate:check', {
          apiKey: body.querySelector('#eng-key').value.trim()
        });
        r.textContent = result.ok ? '✓ Replicate Token 可用，LaMa 模型可访问' : '× ' + (result.message || 'Replicate 连接失败');
        return;
      }
      if (cur === 'topaz302') {
        saveEngineFrom(body, cur);
        const result = await ipcRenderer.invoke('topaz302:check', {
          baseURL: body.querySelector('#eng-url').value.trim(),
          apiKey: body.querySelector('#eng-key').value.trim()
        });
        r.textContent = result.ok
          ? '\u2713 302.AI Key 可用'
          : '\u00d7 ' + (result.message || '302.AI 连接失败');
        return;
      }
      if (isRH) {
        const baseURL = normalizeRunningHubBaseURL(body.querySelector('#eng-url').value.trim());
        body.querySelector('#eng-url').value = baseURL;
        updateRhBtnState();
        saveEngineFrom(body, cur);
        const result = await ipcRenderer.invoke('runninghub:check', { baseURL, apiKey: body.querySelector('#eng-key').value.trim() });
        if (!result.ok) { r.textContent = '\u00d7 ' + result.message; return; }
        const account = result.account || {};
        const balance = account.remainMoney ? '，余额 ' + account.remainMoney + (account.currency || '') : (account.remainCoins ? '，余额 ' + account.remainCoins + ' 币' : '');
        r.textContent = '\u2713 RunningHub 连接成功' + balance;
        return;
      }
      saveEngineFrom(body, cur);
      if (cur === 'custom') {
        // 自定义引擎：真打一次 /models，顺带把目录同步好，避免"地址可访问"式的假阳性
        const synced = await P.syncModels(cur);
        if (syncModelsButton) {
          const catalogStateBox = body.querySelector('#eng-catalog-state');
          if (catalogStateBox) {
            catalogStateBox.textContent = '模型目录：' + synced.count + ' 个 · 刚刚';
            catalogStateBox.classList.add('ready');
          }
        }
        const head = synced.models.slice(0, 3).join('、');
        r.textContent = '✓ 接口和密钥可用，读到 ' + synced.count + ' 个模型' + (head ? '：' + head + (synced.count > 3 ? ' 等' : '') : '');
        return;
      }
      if (cur === 'apollo' || cur === 'openai' || cur === 'deepseek') {
        let catalogText = '';
        try {
          const synced = await P.syncModels(cur);
          catalogText = ' · 模型目录 ' + synced.count + ' 个';
          if (syncModelsButton) {
            const catalogStateBox = body.querySelector('#eng-catalog-state');
            catalogStateBox.textContent = '模型目录：' + synced.count + ' 个 · 刚刚';
            catalogStateBox.classList.add('ready');
          }
          const generationModel = P.realIdOf((body.querySelector('#eng-model') || {}).value || c.model || def.model, cur);
          const availability = P.modelAvailability(cur, generationModel);
          if (availability.status === 'missing') {
            r.textContent = '× ' + availability.message;
            return;
          }
        } catch (error) {
          r.textContent = '× ' + (error.message || '模型目录同步失败');
          return;
        }
        const testModel = cur === 'apollo'
          ? (def.visionModel || 'gpt-4o')
          : (def.visionModel || c.model || def.model);
        if (!testModel) {
          r.textContent = '\u00d7 请先填写要测试的模型';
          return;
        }
        await P.chat(cur, {
          model: testModel,
          maxTokens: 8,
          messages: [{ role: 'user', content: '只回复 OK' }]
        });
        r.textContent = '\u2713 接口、密钥和当前模型可用' + catalogText;
        return;
      }
      const baseURL = (c.baseURL || def.baseURL || '').replace(/\/+$/, '');
      if (!baseURL) {
        r.textContent = '\u00d7 请先填写 Base URL';
        return;
      }
      const response = await fetch(baseURL, {
        headers: { 'Authorization': 'Bearer ' + (c.apiKey || '') },
        signal: AbortSignal.timeout(15000)
      });
      if (response.status === 401 || response.status === 403) {
        r.textContent = '\u00d7 ' + response.status + ' Key 无效或无权限';
        return;
      }
      if (response.status >= 500) {
        r.textContent = '\u00d7 服务暂时不可用（' + response.status + '）';
        return;
      }
      r.textContent = '\u2713 地址可访问（未拉取模型列表，密钥会在生成时验证）';
    } catch (e) {
    const em = String(e && e.message || '连接失败');
    r.textContent = /Failed to fetch|NetworkError|ENOTFOUND|ECONN|fetch failed|timed?[- ]?out/i.test(em)
      ? '× ' + em + ' —— 这台电脑连不上引擎接口：先到「代理设置」页选「直连」试一次；若需代理（海外模型），在「代理设置」页配置好再测；豆包走火山直连不用代理'
      : '× ' + em;
  }
  };
}
function normalizeRunningHubBaseURL(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === 'api.runninghub.ai' || host === 'runninghub.ai') url.hostname = 'www.runninghub.ai';
    else if (host === 'api.runninghub.cn' || host === 'runninghub.cn') url.hostname = 'www.runninghub.cn';
    if (host.endsWith('runninghub.ai') || host.endsWith('runninghub.cn')) {
      url.pathname = ''; url.search = ''; url.hash = '';
    }
    return url.origin;
  } catch (_) { return value; }
}
function saveEngineFrom(body, cur) {
  const P = window.GWProviders;
  const visionModel = body.querySelector('#eng-vision-model');
  P.saveConfig(cur, {
    apiKey: body.querySelector('#eng-key').value.trim(),
    baseURL: body.querySelector('#eng-url').value.trim(),
    model: body.querySelector('#eng-model').value.trim(),
    visionModel: visionModel ? visionModel.value.trim() : (P.loadConfigs()[cur] || {}).visionModel,
    price: (P.loadConfigs()[cur] || {}).price || 0
  });
}
// ============ M2 代理设置页 ============
function renderProxyPage(body) {
  const cur = JSON.parse(localStorage.getItem('gw_proxy') || '{"mode":"system","custom":"http://127.0.0.1:7890"}');
  body.innerHTML = `
    <h3>代理设置</h3>
    <div class="proxy-mode-block">
      <div class="n">代理模式</div>
      <div class="d">国内访问海外模型需代理；火山官方直连可设“直连”。</div>
      <div class="seg" id="px-mode">
        <button data-m="system" class="${cur.mode === 'system' ? 'on' : ''}">系统代理</button>
        <button data-m="custom" class="${cur.mode === 'custom' ? 'on' : ''}">自定义</button>
        <button data-m="direct" class="${cur.mode === 'direct' ? 'on' : ''}">直连</button>
      </div>
    </div>
    <div class="field proxy-custom-field" id="px-custom-row" style="display:${cur.mode === 'custom' ? 'block' : 'none'}">
      <label>自定义代理地址（HTTP/SOCKS5）</label>
      <input id="px-custom" value="${esc(cur.custom || 'http://127.0.0.1:7890')}" placeholder="http://127.0.0.1:7890" /></div>
    <div class="proxy-actions">
      <span id="px-result" class="proxy-apply-result"></span>
      <button class="btn btn-ghost" id="px-test">测试连通性</button>
      <button class="btn btn-primary" id="px-apply">应用</button>
    </div>
    <div id="px-test-result" style="margin-top:12px;font-size:12px;line-height:1.85;color:var(--sub)"></div>
    <p style="margin-top:14px;font-size:11px;color:var(--faint);line-height:19px">建议：海外模型（NanoBanana/GPT）走系统或自定义代理；豆包走火山直连不用代理。配好后点「测试连通性」确认，再回引擎页"测试连接"。</p>`;
  let mode = cur.mode;
  body.querySelectorAll('#px-mode button').forEach(b => {
    b.onclick = () => {
      body.querySelectorAll('#px-mode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      mode = b.dataset.m;
      body.querySelector('#px-custom-row').style.display = mode === 'custom' ? 'block' : 'none';
    };
  });
  body.querySelector('#px-apply').onclick = async () => {
    const custom = body.querySelector('#px-custom').value.trim();
    localStorage.setItem('gw_proxy', JSON.stringify({ mode, custom }));
    const r = await ipcRenderer.invoke('proxy:set', { mode, custom });
    body.querySelector('#px-result').textContent = r.ok ? ('\u2713 已应用 ' + r.rules + (r.bypass ? '（国内域名自动直连）' : '')) : ('\u00d7 ' + r.msg);
  };
  // 连通性检测：按当前选中的代理模式实测国外/国内两个端点，帮用户判断到底通不通
  body.querySelector('#px-test').onclick = async () => {
    const btn = body.querySelector('#px-test');
    const box = body.querySelector('#px-test-result');
    const custom = body.querySelector('#px-custom').value.trim();
    btn.disabled = true;
    btn.textContent = '测试中…';
    box.textContent = '正在按当前模式连接…';
    localStorage.setItem('gw_proxy', JSON.stringify({ mode, custom }));
    await ipcRenderer.invoke('proxy:set', { mode, custom });
    const probe = async url => {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        return { ok: true, status: r.status, ms: Date.now() - t0 };
      } catch (e) {
        return { ok: false, msg: e.message || '连接失败', ms: Date.now() - t0 };
      }
    };
    const row = (label, r) => {
      if (r.ok) {
        const authNote = (r.status === 401 || r.status === 403) ? '，未带密钥属正常' : '';
        return '<div>\u2713 ' + label + ' 可达（HTTP ' + r.status + ' · ' + r.ms + 'ms' + authNote + '）</div>';
      }
      const reason = /timeout|abort/i.test(r.msg) ? '超时（多半是代理没生效或端口不对）' : r.msg;
      return '<div style="color:var(--danger)">\u00d7 ' + label + ' 不可达：' + esc(reason) + '</div>';
    };
    const [intl, cn] = await Promise.all([
      probe('https://api.openai.com/v1/models'),
      probe('https://ark.cn-beijing.volces.com/api/v3/models')
    ]);
    box.innerHTML = row('国外（api.openai.com）', intl) + row('国内（火山方舟）', cn) +
      '<div style="color:var(--faint);margin-top:4px">国外不通就换代理模式、或把代理端口填对后重测；国内也不通通常是本机网络问题。</div>';
    btn.disabled = false;
    btn.textContent = '测试连通性';
  };
}


$('settings-mask').addEventListener('click', e => { if (e.target === $('settings-mask')) hide('settings-mask'); });

$('btn-help-close').onclick = () => hide('help-mask');
$('help-mask').addEventListener('click', e => { if (e.target === $('help-mask')) hide('help-mask'); });

// M1.13：导入迁入头像菜单；保留旧引用守卫
async function doImport() {
  if (!currentProject) { toast('请先打开项目', true); return; }
  const imgs = await ipcRenderer.invoke('dialog:importImages');
  if (imgs.length && window.GWCanvas) GWCanvas.importDataURLs(imgs.map(i => i.dataURL));
}
if ($('btn-import')) $('btn-import').onclick = doImport;

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(t) {
  const d = new Date(t);
  return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  const accepted = await ipcRenderer.invoke('eula:check');
  await initAuthMemory();
  if (accepted) startSplash();
  else show('screen-eula');
})();
window.__logBoot && __logBoot('app.js 已加载');

function paintAvatarCanvas(canvas, image, zoom) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.max(size / image.width, size / image.height) * zoom;
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
}
function editAvatarImage(image) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'avatar-editor-mask';
    mask.innerHTML = `
      <div class="avatar-editor-card" role="dialog" aria-modal="true" aria-label="调整头像">
        <h3>调整头像</h3>
        <div class="sub">拖动滑块调整图片大小，圆形区域就是最终头像范围。</div>
        <div class="avatar-editor-preview"><canvas width="256" height="256"></canvas></div>
        <div class="avatar-editor-row">
          <span>缩放</span>
          <input type="range" min="100" max="250" value="100" step="1" aria-label="头像缩放">
          <output>100%</output>
        </div>
        <div class="avatar-editor-actions">
          <button class="btn btn-ghost" type="button" data-avatar-cancel>取消</button>
          <button class="btn btn-primary" type="button" data-avatar-save>保存头像</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const canvas = mask.querySelector('canvas');
    const slider = mask.querySelector('input[type=range]');
    const output = mask.querySelector('output');
    const paint = () => {
      output.textContent = slider.value + '%';
      paintAvatarCanvas(canvas, image, Number(slider.value) / 100);
    };
    const onKey = event => { if (event.key === 'Escape') close(null); };
    const close = value => {
      document.removeEventListener('keydown', onKey);
      mask.remove();
      resolve(value);
    };
    slider.addEventListener('input', paint);
    mask.querySelector('[data-avatar-cancel]').onclick = () => close(null);
    mask.querySelector('[data-avatar-save]').onclick = () => {
      const out = document.createElement('canvas');
      out.width = out.height = 256;
      paintAvatarCanvas(out, image, Number(slider.value) / 100);
      close(out.toDataURL('image/png'));
    };
    mask.addEventListener('pointerdown', event => { if (event.target === mask) close(null); });
    document.addEventListener('keydown', onKey);
    paint();
    slider.focus();
  });
}
async function changeAvatar() {
  if (!requireAvatarFeature()) return;
  const imgs = await ipcRenderer.invoke('dialog:importImages');
  if (!imgs.length) return;
  const im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = imgs[0].dataURL; });
  if (!im.width || !im.height) { toast('图片无效', true); return; }
  const dataURL = await editAvatarImage(im);
  if (!dataURL) return;
  const ok = await ipcRenderer.invoke('account:setAvatar', { accountId: account.id, dataURL });
  if (!ok) { toast('头像保存失败', true); return; }
  account.avatar = dataURL;
  $('tb-avatar-img').src = dataURL;
  const settingsAvatar = document.getElementById('set-avatar-img');
  if (settingsAvatar) settingsAvatar.src = dataURL;
  toast('头像已更新');
}

function formatVersionTime(ts) {
  try { return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return '--'; }
}
function formatVersionBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10240 ? 1 : 0) + ' KB';
  return (value / (1024 * 1024)).toFixed(2) + ' MB';
}
function askAppText({ title, help, defaultValue, placeholder }) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.style.zIndex = '420';
    mask.innerHTML = `<div class="welcome" style="width:min(440px,92vw)">
      <h2>${esc(title || '输入')}</h2>
      <div class="sub">${esc(help || 'Enter 确认，Esc 取消')}</div>
      <input data-text value="${esc(defaultValue || '')}" placeholder="${esc(placeholder || '')}" style="width:100%;height:36px;box-sizing:border-box;margin-top:14px;border:1px solid var(--line);border-radius:9px;background:var(--raised);color:var(--text);padding:0 10px;outline:none" />
      <div class="welcome-foot"><span></span><div style="display:flex;gap:8px">
        <button class="link-btn" data-cancel>取消</button><button class="btn btn-primary" data-ok>确认</button>
      </div></div>
    </div>`;
    const close = value => { mask.remove(); resolve(value); };
    const input = mask.querySelector('[data-text]');
    mask.querySelector('[data-cancel]').onclick = () => close(null);
    mask.querySelector('[data-ok]').onclick = () => close(input.value.trim());
    mask.addEventListener('mousedown', event => { if (event.target === mask) close(null); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') close(input.value.trim());
      if (event.key === 'Escape') close(null);
    });
    document.body.appendChild(mask);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}
function askAppConfirm({ title, message, confirmLabel }) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.style.zIndex = '420';
    mask.innerHTML = `<div class="welcome" style="width:min(420px,92vw)">
      <h2>${esc(title || '确认操作')}</h2>
      <div class="sub">${esc(message || '')}</div>
      <div class="welcome-foot"><span></span><div style="display:flex;gap:8px">
        <button class="link-btn" data-cancel>取消</button><button class="btn btn-primary" data-ok>${esc(confirmLabel || '确认')}</button>
      </div></div>
    </div>`;
    const close = value => { mask.remove(); resolve(value); };
    mask.querySelector('[data-cancel]').onclick = () => close(false);
    mask.querySelector('[data-ok]').onclick = () => close(true);
    mask.addEventListener('mousedown', event => { if (event.target === mask) close(false); });
    document.body.appendChild(mask);
  });
}
// ---------- 自动更新：检查 → 提示 → 下载 → 安装重启 ----------
let updateDialogState = null;
let updatePendingState = null;
let updatePendingTimer = 0;
let updateRenderedKey = '';      // 已渲染的内容指纹：同名版本不重复重建 DOM
let updateDismissedVersion = ''; // 用户点过「稍后」的版本，本次会话内不再自动弹出

function updateUiReady() {
  return ['screen-license', 'screen-auth', 'screen-eula', 'screen-splash'].every(id => {
    const el = document.getElementById(id);
    return !el || el.classList.contains('hidden');
  });
}

function updateSizeLabel(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

function ensureUpdateDialog() {
  let mask = document.getElementById('update-mask');
  if (mask) return mask;
  updateRenderedKey = '';
  mask = document.createElement('div');
  mask.id = 'update-mask';
  mask.className = 'modal-mask';
  mask.style.zIndex = '430';
  mask.innerHTML = `<div class="welcome" style="width:min(480px,92vw)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <h2 data-title>发现新版本</h2>
      <button class="close-icon-btn" data-close title="关闭" aria-label="关闭更新提示">×</button>
    </div>
    <div class="sub" data-meta></div>
    <img class="update-banner hidden" data-banner alt="" />
    <div class="update-highlights hidden" data-highlights></div>
    <ul class="update-notes" data-notes></ul>
    <div class="update-progress hidden" data-progress>
      <div class="update-bar"><i data-bar></i></div>
      <div class="update-percent" data-percent>0%</div>
    </div>
    <div class="update-error hidden" data-error></div>
    <div class="update-hint hidden" data-hint></div>
    <div class="welcome-foot">
      <button class="link-btn update-mirror hidden" data-mirror>下载慢？用网盘</button>
      <div style="display:flex;gap:8px">
        <button class="link-btn" data-later>稍后</button>
        <button class="btn btn-primary" data-action>立即更新</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(mask);

  mask.querySelector('[data-mirror]').onclick = () => {
    ipcRenderer.invoke('update:open-url', { manual: true }).catch(() => {});
  };

  const dismiss = () => {
    // 安装已经开始时软件马上会退出，此时不允许把提示藏起来造成状态误解。
    if (updateDialogState && updateDialogState.phase === 'installing') return;
    const version = updateDialogState && updateDialogState.release ? updateDialogState.release.version : '';
    if (version) updateDismissedVersion = version;
    updatePendingState = null;
    mask.classList.add('hidden');
  };
  mask.querySelector('[data-close]').onclick = dismiss;
  mask.querySelector('[data-later]').onclick = dismiss;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !mask.classList.contains('hidden')) dismiss();
  });
  mask.querySelector('[data-action]').onclick = async () => {
    const phase = updateDialogState ? updateDialogState.phase : 'available';
    const button = mask.querySelector('[data-action]');
    if (phase === 'available') {
      button.disabled = true;
      button.textContent = '准备下载…';
      try { await ipcRenderer.invoke('update:download'); } catch (error) {}
      return;
    }
    if (phase === 'downloading') {
      try { await ipcRenderer.invoke('update:cancel'); } catch (error) {}
      return;
    }
    if (phase === 'ready') {
      button.disabled = true;
      button.textContent = '正在安装…';
      try {
        // 必须看返回值：invoke 失败时返回的是 { ok:false, error }，不抛异常。
        // 旧代码忽略返回值，安装器一旦没拉起来，按钮就永远停在「正在安装…」，
        // 用户既看不到原因也没有出路，只能自己关掉重开——正是不重启还以为是没装成。
        const res = await ipcRenderer.invoke('update:install');
        if (!res || !res.ok) {
          const reason = (res && res.error) || '安装未能启动';
          updateDialogState = Object.assign({}, updateDialogState, { phase: 'error', error: reason });
          renderUpdateDialog(updateDialogState);
        }
      } catch (error) {
        updateDialogState = Object.assign({}, updateDialogState, {
          phase: 'error',
          error: String((error && error.message) || error)
        });
        renderUpdateDialog(updateDialogState);
      }
      return;
    }
    if (phase === 'error') {
      try { await ipcRenderer.invoke('update:open-url', { manual: true }); } catch (error) {}
    }
  };
  return mask;
}

function renderUpdateDialog(state) {
  updateDialogState = state;
  const release = state && state.release;
  const mask = ensureUpdateDialog();
  if (!release) return;

  const action = mask.querySelector('[data-action]');
  const later = mask.querySelector('[data-later]');
  const progress = mask.querySelector('[data-progress]');
  const errorBox = mask.querySelector('[data-error]');
  const hint = mask.querySelector('[data-hint]');

  const size = updateSizeLabel(release.size);
  const mirror = mask.querySelector('[data-mirror]');
  // 上次自动安装没成功：这个面板不是"发现新版本"，而是"接着把上次没做完的事做完"。
  // 必须限定为「失败的就是这个版本」——否则一条历史失败记录会让之后每个新版本都
  // 被说成「上次更新未完成」，用户会以为更新从来没成功过。
  const failedVersion = String(state.failedInstallVersion || '');
  const installRetry = !!(
    state.lastInstallError &&
    (state.phase === 'available' || state.phase === 'ready') &&
    failedVersion && failedVersion === String(release.version || '')
  );

  // 内容区（标题/元信息/横幅/要点/备注）只在版本或素材变化时重建。
  // 下载进度每 150ms 推一次，若跟着重建 DOM，要点里的图片会被反复销毁并重新请求，
  // 整个弹窗会持续抖动、图片永远加载不完（用户反馈的"面板一直跳"）。
  const contentKey = [
    release.version, release.releaseDate || '', release.size || 0,
    release.banner || '', release.manualUrl || '',
    installRetry ? 'retry' : '',
    (release.notes || []).join('\u0001'),
    (release.highlights || []).map(item => [item.title, item.text, item.image].join('\u0002')).join('\u0003')
  ].join('\u0004');

  if (contentKey !== updateRenderedKey) {
    updateRenderedKey = contentKey;

    // 上次自动安装没成功时，这个面板不是"发现新版本"，而是"接着把上次没做完的事做完"。
    // 旧文案让用户以为每次都是新弹出的更新提示，实际是同一个版本反复安装失败。
    mask.querySelector('[data-title]').textContent = installRetry
      ? '继续完成更新 ' + release.version
      : '发现新版本 ' + release.version;
    const meta = ['当前 v' + state.currentVersion];
    if (release.releaseDate) meta.push('发布于 ' + release.releaseDate);
    if (size) meta.push(size);
    mask.querySelector('[data-meta]').textContent = meta.join(' · ');

    const banner = mask.querySelector('[data-banner]');
    if (release.banner) {
      banner.src = release.banner;
      banner.classList.remove('hidden');
      banner.onerror = () => { banner.classList.add('hidden'); banner.removeAttribute('src'); };
    } else {
      banner.classList.add('hidden');
      banner.removeAttribute('src');
      banner.onerror = null;
    }

    const highlights = Array.isArray(release.highlights) ? release.highlights : [];
    const highlightsBox = mask.querySelector('[data-highlights]');
    const notesBox = mask.querySelector('[data-notes]');
    if (highlights.length) {
      highlightsBox.innerHTML = highlights.map(item => {
        const image = item.image ? '<img src="' + esc(item.image) + '" alt="">' : '';
        const desc = item.text ? '<div class="update-highlight-desc">' + esc(item.text) + '</div>' : '';
        return '<div class="update-highlight">' + image +
          '<div class="update-highlight-body"><div class="update-highlight-title">' + esc(item.title) + '</div>' + desc + '</div></div>';
      }).join('');
      highlightsBox.querySelectorAll('img').forEach(img => {
        img.onerror = () => { img.style.display = 'none'; };
      });
      highlightsBox.classList.remove('hidden');
      notesBox.classList.add('hidden');
    } else {
      highlightsBox.classList.add('hidden');
      highlightsBox.innerHTML = '';
      notesBox.classList.remove('hidden');
      notesBox.innerHTML = (release.notes && release.notes.length)
        ? release.notes.map(note => '<li>' + esc(note) + '</li>').join('')
        : '<li>细节改进与问题修复</li>';
    }
  }

  // 状态区：只切类名与文本，保持 DOM 稳定，进度刷新时按钮和提示不再闪烁
  const phase = state.phase;
  const manual = !!release.manualUrl;
  const showError = phase === 'error';
  const showHint = showError ? manual : phase !== 'idle' && phase !== 'checking';

  // 待安装/下载中/失败也必须有出路；旧逻辑只在 available 显示「稍后」，
  // 一旦安装包已准备好，用户只能点「立即安装并重启」，连关闭弹窗都做不到。
  later.classList.toggle('hidden', !['available', 'downloading', 'ready', 'error'].includes(phase));
  mask.querySelector('[data-close]').classList.toggle('hidden', phase === 'installing');
  progress.classList.toggle('hidden', phase !== 'downloading');
  errorBox.classList.toggle('hidden', !showError);
  hint.classList.toggle('hidden', !showHint);
  if (mirror) mirror.classList.toggle('hidden', !manual);
  action.disabled = phase === 'installing';

  const setText = (node, text) => {
    if (node && node.textContent !== text) node.textContent = text;
  };
  const setHint = (text) => setText(hint, showHint ? text : '');
  const bar = mask.querySelector('[data-bar]');
  const percentLabel = mask.querySelector('[data-percent]');

  if (phase === 'available') {
    setText(action, size ? '立即更新（' + size + '）' : '立即更新');
    setHint(installRetry
      ? '上次安装没有完成，重新下载后会自动安装。请不要同时打开另一个极物窗口。'
      : '更新会在后台下载，完成后由你确认安装。');
  } else if (phase === 'downloading') {
    setText(action, '取消下载');
    const percent = Math.max(0, Math.min(100, Number(state.progress && state.progress.percent) || 0));
    const width = percent + '%';
    if (bar.style.width !== width) bar.style.width = width;
    setText(percentLabel, width);
    setHint('正在下载更新包，可以继续使用软件。');
  } else if (phase === 'ready') {
    setText(action, '立即安装并重启');
    setHint(installRetry
      ? '安装包已准备好，点上面按钮重试。安装时软件会关闭，请不要再手动打开。'
      : '安装时软件会自动关闭，完成后自动打开，项目与设置不受影响。');
  } else if (phase === 'installing') {
    setText(action, '正在安装…');
    setHint('软件即将关闭并自动重启，请稍候。');
  } else if (showError) {
    setText(action, manual ? '手动下载（网盘）' : '手动下载');
    setText(errorBox, state.error || '更新失败');
    if (manual) setHint('软件内下载没能完成，已为你准备好网盘备用入口。');
  }
}

function scheduleUpdatePending() {
  if (updatePendingTimer) clearTimeout(updatePendingTimer);
  updatePendingTimer = setTimeout(() => {
    updatePendingTimer = 0;
    if (!updatePendingState) return;
    if (updateUiReady()) {
      const pending = updatePendingState;
      updatePendingState = null;
      showUpdateDialog(pending);
    } else {
      scheduleUpdatePending();
    }
  }, 15000);
}

function showUpdateDialog(state) {
  if (!state || !state.release) return;
  // 用户关闭过这个版本的提示后，本次会话不再自己弹回来（含下载完成后的 ready）。
  // 手动检查更新会清掉这个标记；安装已经开始时不再拦截状态展示。
  if (state.phase !== 'installing' && state.release.version === updateDismissedVersion) return;
  if (!updateUiReady()) {
    updatePendingState = state;
    scheduleUpdatePending();
    return;
  }
  updatePendingState = null;
  const mask = ensureUpdateDialog();
  mask.classList.remove('hidden');
  renderUpdateDialog(state);
}

async function checkForUpdatesManually() {
  updateDismissedVersion = ''; // 主动检查：之前点过「稍后」的也重新提示
  try {
    const res = await ipcRenderer.invoke('update:check', { manual: true });
    if (!res || !res.ok) { toast((res && res.error) || '检查更新失败', true); return; }
    const state = res.state;
    if (state.phase === 'available' || state.phase === 'ready') { showUpdateDialog(state); return; }
    if (state.error) { toast(state.error, true); return; }
    toast('已是最新版本 v' + state.currentVersion);
  } catch (error) {
    toast('检查更新失败', true);
  }
}

function initUpdateUi() {
  try {
    ipcRenderer.on('update:event', (_event, state) => {
      if (!state) return;
      const mask = document.getElementById('update-mask');
      if (state.phase === 'available') { showUpdateDialog(state); return; }
      if (state.phase === 'error') { if (mask) renderUpdateDialog(state); return; }
      if (state.phase === 'ready' || state.phase === 'installing') { showUpdateDialog(state); return; }
      if (mask && state.phase === 'downloading') renderUpdateDialog(state);
    });
    ipcRenderer.invoke('update:state').then(res => {
      const state = res && res.state;
      if (state && state.phase === 'available') showUpdateDialog(state);
    }).catch(() => {});
  } catch (error) {}
}

window.GW_checkForUpdates = checkForUpdatesManually;

async function openVersionHistory() {
  if (!currentProject) { toast('请先打开项目', true); return; }
  const old = document.getElementById('version-mask');
  if (old) old.remove();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.id = 'version-mask';
  mask.innerHTML = `<div class="welcome" style="width:560px;max-height:82vh;display:flex;flex-direction:column">
    <h2>版本历史</h2>
    <div class="sub">自动安全备份最近 30 个，手动命名版本最近 100 个；恢复前会先备份当前画布<span id="ver-usage"></span></div>
    <div style="display:flex;justify-content:flex-end;margin:10px 0"><button class="btn btn-primary" id="ver-save">保存当前版本</button></div>
    <div id="ver-list" style="overflow:auto;flex:1;min-height:220px"></div>
    <div class="welcome-foot"><span></span><button class="close-icon-btn" id="ver-close" title="关闭" aria-label="关闭">×</button></div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
  mask.querySelector('#ver-close').onclick = close;
  const listEl = mask.querySelector('#ver-list');
  const refresh = async () => {
    listEl.innerHTML = '<div class="set-placeholder">读取中…</div>';
    const list = await ipcRenderer.invoke('canvas:listVersions', currentProject.path) || [];
    const usage = document.getElementById('ver-usage');
    if (usage) {
      const totalBytes = list.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
      const manualCount = list.filter(item => item.kind === 'manual').length;
      const autoCount = list.length - manualCount;
      usage.textContent = list.length
        ? ' · 自动 ' + autoCount + '/30 · 手动 ' + manualCount + '/100 · 占用 ' + formatVersionBytes(totalBytes)
        : '';
    }
    if (!list.length) {
      listEl.innerHTML = '<div class="set-placeholder">还没有历史版本。点上方按钮保存当前版本。</div>';
      return;
    }
    listEl.innerHTML = list.map(v => {
      const kindText = v.kind === 'manual' ? '手动' : (v.kind === 'restore' ? '恢复前备份' : '自动备份');
      return `<div class="set-row" style="align-items:center">
        <div style="min-width:0"><div class="n">${esc(v.label || '历史版本')}</div>
        <div class="d">${kindText} · ${formatVersionTime(v.createdAt)} · ${v.stats.nodes || 0} 节点 · ${v.stats.edges || 0} 连线 · ${formatVersionBytes(v.bytes)}</div></div>
        <button class="btn btn-ghost" data-version="${esc(v.id)}">恢复</button></div>`;
    }).join('');
    listEl.querySelectorAll('[data-version]').forEach(button => {
      button.onclick = async () => {
        if (!await askAppConfirm({
          title: '恢复历史版本',
          message: '恢复这个版本？当前画布会先自动备份。',
          confirmLabel: '恢复'
        })) return;
        button.disabled = true;
        try {
          await window.GWCanvas.saveNow();
          const result = await ipcRenderer.invoke('canvas:restoreVersion', {
            projectPath: currentProject.path,
            id: button.dataset.version
          });
          if (!result.ok) { toast(result.msg || '恢复失败', true); return; }
          await window.GWCanvas.restoreFromVersion(result.state);
          close();
          toast('已恢复版本：' + ((result.meta && result.meta.label) || '历史版本'));
        } catch (error) {
          toast('恢复失败：' + error.message, true);
        } finally {
          button.disabled = false;
        }
      };
    });
  };
  mask.querySelector('#ver-save').onclick = async () => {
    const label = await askAppText({
      title: '保存历史版本',
      help: '输入版本名称，可留空使用“手动版本”。',
      defaultValue: '手动版本',
      placeholder: '例如：客厅方案第二版'
    });
    if (label == null) return;
    await window.GWCanvas.saveNow();
    const result = await ipcRenderer.invoke('canvas:createVersion', {
      projectPath: currentProject.path,
      label: label.trim() || '手动版本'
    });
    if (!result.ok) { toast(result.msg || '保存版本失败', true); return; }
    toast(result.meta && result.meta.unchanged ? '内容未变化，已沿用现有版本' : '已保存版本');
    await refresh();
  };
  refresh().catch(error => toast('读取版本失败：' + error.message, true));
}
function applyRailPosition(position) {
  const rail = document.getElementById('gw-rail');
  if (!rail) return;
  const pos = ['left', 'right', 'top', 'bottom'].includes(position) ? position : 'left';
  rail.dataset.pos = pos;
  try { localStorage.setItem('gw_rail_pos', pos); } catch (e) {}
  updateDrawerOffsets();
  scheduleCanvasAvatarPosition(260);
}
function updateDrawerOffsets() {
  const rail = document.getElementById('gw-rail');
  const left = document.getElementById('side-left');
  const right = document.getElementById('side-right');
  const wrap = document.getElementById('canvas-wrap');
  if (!rail || !left || !right || !wrap) return;
  const openLeft = left.classList.contains('open');
  const openRight = right.classList.contains('open');
  if (openLeft || openRight) {
    const drawer = openLeft ? left : right;
    const width = drawer.offsetWidth || (openLeft ? 240 : 312);
    rail.style.setProperty('--rail-drawer-offset', (width + 12) + 'px');
    rail.classList.add('drawer-open');
  } else {
    rail.classList.remove('drawer-open');
    rail.style.removeProperty('--rail-drawer-offset');
  }
  wrap.classList.toggle('rail-at-bottom', rail.dataset.pos === 'bottom' && !rail.classList.contains('drawer-open'));
  scheduleCanvasAvatarPosition(260);
}
let avatarFollowRaf = 0;
let avatarFollowUntil = 0;
let avatarResizeObserver = null;
function positionUserMenu() {
  const menu = document.getElementById('user-menu');
  const avatar = document.getElementById('tb-user');
  const wrap = document.getElementById('canvas-wrap');
  if (!menu || !avatar || !wrap || menu.classList.contains('hidden')) return;
  const ar = avatar.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const mw = menu.offsetWidth || 190;
  const mh = menu.offsetHeight || 220;
  let left = ar.left - wr.left;
  let top = ar.top - wr.top - mh - 8;
  if (top < 8) top = ar.bottom - wr.top + 8;
  left = Math.max(8, Math.min(left, wr.width - mw - 8));
  top = Math.max(8, Math.min(top, wr.height - mh - 8));
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
  menu.style.bottom = 'auto';
  menu.style.right = 'auto';
}
function positionCanvasAvatar() {
  const rail = document.getElementById('gw-rail');
  const avatar = document.getElementById('tb-user');
  const wrap = document.getElementById('canvas-wrap');
  if (!rail || !avatar || !wrap) return;
  const rr = rail.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  if (rr.width < 1 || rr.height < 1 || wr.width < 1 || wr.height < 1) return;
  const pos = rail.dataset.pos || 'left';
  const drawerOpen = rail.classList.contains('drawer-open');
  const verticalRail = drawerOpen || pos === 'left' || pos === 'right';
  const avatarSize = Math.max(32, Math.min(72, Math.round(verticalRail ? rr.width : rr.height)));
  if (avatar.offsetWidth !== avatarSize || avatar.offsetHeight !== avatarSize) {
    avatar.style.width = avatarSize + 'px';
    avatar.style.height = avatarSize + 'px';
  }
  const aw = avatarSize;
  const ah = avatarSize;
  const gap = 12;
  const edge = 12;
  let left, top;
  if (verticalRail) {
    left = rr.left - wr.left + (rr.width - aw) / 2;
    top = rr.bottom - wr.top + gap;
    if (top + ah > wr.height - edge) {
      top = rr.top - wr.top + (rr.height - ah) / 2;
      left = pos === 'right' ? rr.left - wr.left - aw - gap : rr.right - wr.left + gap;
    }
  } else {
    // 顶部/底部工具条为横向布局，头像放在其右手边并与工具条垂直居中。
    left = rr.right - wr.left + gap;
    top = rr.top - wr.top + (rr.height - ah) / 2;
  }
  left = Math.max(edge, Math.min(left, wr.width - aw - edge));
  top = Math.max(edge, Math.min(top, wr.height - ah - edge));
  avatar.style.left = Math.round(left) + 'px';
  avatar.style.top = Math.round(top) + 'px';
  avatar.style.bottom = 'auto';
  positionUserMenu();
}
function scheduleCanvasAvatarPosition(duration) {
  avatarFollowUntil = Math.max(avatarFollowUntil, performance.now() + (duration || 240));
  if (avatarFollowRaf) return;
  const avatar = document.getElementById('tb-user');
  if (avatar) avatar.style.transition = 'none';
  const tick = now => {
    positionCanvasAvatar();
    if (now < avatarFollowUntil) {
      avatarFollowRaf = requestAnimationFrame(tick);
    } else {
      avatarFollowRaf = 0;
      if (avatar) avatar.style.transition = '';
    }
  };
  avatarFollowRaf = requestAnimationFrame(tick);
}
function bindCanvasAvatarFollow() {
  const rail = document.getElementById('gw-rail');
  const wrap = document.getElementById('canvas-wrap');
  if (!rail || !wrap) return;
  if (!rail.__gwAvatarFollowBound) {
    rail.__gwAvatarFollowBound = true;
    window.addEventListener('resize', () => scheduleCanvasAvatarPosition(160));
    rail.addEventListener('transitionend', event => {
      if (['left', 'top', 'right', 'transform'].includes(event.propertyName)) scheduleCanvasAvatarPosition(80);
    });
    if (window.ResizeObserver) {
      avatarResizeObserver = new ResizeObserver(() => scheduleCanvasAvatarPosition(100));
      avatarResizeObserver.observe(rail);
      avatarResizeObserver.observe(wrap);
    }
  }
  scheduleCanvasAvatarPosition(420);
}
function setCanvasDrawer(side, open) {
  const left = document.getElementById('side-left');
  const right = document.getElementById('side-right');
  const scrim = document.getElementById('drawer-scrim');
  if (!left || !right || !scrim) return;
  if (open) {
    left.classList.toggle('open', side === 'left');
    right.classList.toggle('open', side === 'right');
    scrim.classList.add('on');
  } else {
    left.classList.remove('open');
    right.classList.remove('open');
    scrim.classList.remove('on');
  }
  updateDrawerOffsets();
}
function closeCanvasDrawers() {
  setCanvasDrawer('left', false);
}
window.GW_setCanvasDrawer = setCanvasDrawer;
window.GW_requireWorkflowAssets = requireWorkflowAssetsFeature;
window.GW_syncWorkflowAssetsGate = syncWorkflowAssetsGate;
function bindCanvasRail() {
  const rail = document.getElementById('gw-rail');
  if (!rail) return;
  applyRailPosition(localStorage.getItem('gw_rail_pos') || 'left');
  bindCanvasAvatarFollow();
  const scrim = document.getElementById('drawer-scrim');
  if (scrim) scrim.onclick = closeCanvasDrawers;
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCanvasDrawers();
  });
  rail.querySelectorAll('[data-rail]').forEach(button => {
    button.onclick = () => {
      const action = button.dataset.rail;
      try {
        if (action === 'import') { doImport(); return; }
        if (action === 'drawer-left') {
          const isOpen = document.getElementById('side-left').classList.contains('open');
          setCanvasDrawer('left', !isOpen);
          return;
        }
        if (action === 'drawer-right') {
          if (window.GWStudio && window.GWStudio.close) window.GWStudio.close();
          const isOpen = document.getElementById('side-right').classList.contains('open');
          setCanvasDrawer('right', !isOpen);
          return;
        }
        if (action === 'generate') {
          if (!window.GWCanvas.getRuntimeStats().selected) {
            window.GWCanvas.createTextToImageNode();
            return;
          }
          const target = document.querySelector('#island [data-act="gen"]');
          if (target) target.click();
          return;
        }
        if (action === 'workbench') {
          if (!window.GWStudio) { toast('工作流与资产模块未加载', true); return; }
          setCanvasDrawer('right', true);
          window.GWStudio.open();
          return;
        }
        if (action === 'material') { window.GWCanvas.openMaterialForSelection(); return; }
        if (action === 'light') { window.GWCanvas.createLightNode(); return; }
        if (action === 'note') { window.GWCanvas.addNoteAtCenter(); return; }
        if (action === 'compare') {
          const target = document.querySelector('#island [data-act="compare"]');
          if (target) target.click();
          return;
        }
        if (action === 'arrange') {
          if (window.GWCanvas.getRuntimeStats().selected >= 2) {
            window.GWCanvas.arrangeSelected();
            return;
          }
          const nodes = window.GWCanvas.getCanvasState().nodes || [];
          const ids = nodes.filter(node => node.type !== 'note').map(node => node.id);
          if (ids.length < 2) { toast('至少需要两个节点', true); return; }
          window.GWCanvas.selectByIds(ids);
          window.GWCanvas.arrangeSelected();
          return;
        }
        if (action === 'versions') {
          const target = document.getElementById('um-versions');
          if (target) target.click();
          return;
        }
        if (action === 'fit') { window.GWCanvas.fitView(); return; }
        if (action === 'theme') {
          const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
          setTheme(current === 'dark' ? 'light' : 'dark');
          return;
        }
      } catch (error) {
        toast('操作失败：' + error.message, true);
      }
    };
  });
}
// M1.13：头像菜单强制重绑（防失效统一入口）
(function bindUserMenu() {
  const B = (id, fn) => {
    const el = $(id);
    if (!el) return;
    el.onclick = e => {
      e.stopPropagation();
      $('user-menu').classList.add('hidden');
      try { Promise.resolve(fn()).catch(err => toast('操作失败：' + err.message, true)); }
      catch (err) { toast('操作失败：' + err.message, true); }
    };
  };
  B('um-avatar', () => {
    setPage = 'account';
    renderSettings();
    show('settings-mask');
  });
  B('um-license', () => { setPage = 'license'; renderSettings(); show('settings-mask'); });
  B('um-dev-entitlement', () => {
    setDevEntitlementMode(devEntitlementMode === 'team' ? 'beta' : 'team');
  });
  B('um-settings', () => { renderSettings(); show('settings-mask'); });
  B('um-help', () => show('help-mask'));
  B('um-export', () => { if (window.GWCanvas) GWCanvas.openExportDialog(); });
  B('um-versions', openVersionHistory);
  B('um-check-update', checkForUpdatesManually);
  if ($('um-version')) $('um-version').textContent = 'v' + APP_VERSION;
})();
function syncWindowControlState(maximized) {
  const button = document.getElementById('win-maximize');
  if (!button) return;
  button.classList.toggle('is-maximized', !!maximized);
  button.title = maximized ? '还原' : '最大化';
  button.setAttribute('aria-label', maximized ? '还原' : '最大化');
}
const winMinimize = document.getElementById('win-minimize');
const winMaximize = document.getElementById('win-maximize');
const winClose = document.getElementById('win-close');
if (winMinimize) winMinimize.onclick = () => ipcRenderer.invoke('window:minimize');
if (winMaximize) winMaximize.onclick = async () => syncWindowControlState(await ipcRenderer.invoke('window:toggle-maximize'));
if (winClose) winClose.onclick = () => ipcRenderer.invoke('window:close');
// 登录页/授权页没有 topbar，各自带一组窗口按钮（无边框窗口否则关不掉也拖不动）
document.querySelectorAll('[data-gate-win]').forEach(button => {
  button.onclick = () => ipcRenderer.invoke(
    button.dataset.gateWin === 'minimize' ? 'window:minimize' : 'window:close'
  );
});
if ($('dev-entitlement-badge')) {
  $('dev-entitlement-badge').onclick = () => setDevEntitlementMode(devEntitlementMode === 'team' ? 'beta' : 'team');
}
ipcRenderer.on('window:maximized-state', (_event, maximized) => syncWindowControlState(maximized));
ipcRenderer.invoke('window:maximized-state').then(syncWindowControlState).catch(() => {});

let exitConfirmMask = null;
let exitConfirmBusy = false;

function closeWindowNow() {
  return ipcRenderer.invoke('window:force-close');
}

function dismissExitConfirm() {
  if (exitConfirmMask) exitConfirmMask.remove();
  exitConfirmMask = null;
  exitConfirmBusy = false;
}

function dirtyProjectNames(stats) {
  const names = projectTabs.filter(tab => tab.dirty).map(tab => tab.name);
  if (currentProject && stats && stats.dirty && !names.includes(currentProject.name)) names.push(currentProject.name);
  return Array.from(new Set(names.filter(Boolean)));
}

function showExitConfirm(dirtyNames, taskCount) {
  if (exitConfirmMask) {
    const cancel = exitConfirmMask.querySelector('[data-exit="cancel"]');
    if (cancel) cancel.focus();
    return;
  }
  const hasDirty = dirtyNames.length > 0;
  const hasTasks = taskCount > 0;
  const title = hasTasks ? '还有任务正在运行' : '退出极物 GIWIN Studio？';
  const detail = hasTasks
    ? '还有 ' + taskCount + ' 个生成任务正在运行。退出会中断任务，未完成结果可能丢失。'
    : '以下项目还有未保存的更改。';
  const projects = hasDirty
    ? '<div class="exit-confirm-projects">' + dirtyNames.map(name => '<b>' + esc(name) + '</b>').join('、') + '</div>'
    : '';
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.id = 'exit-confirm-mask';
  mask.style.zIndex = '420';
  mask.innerHTML =
    '<section class="welcome exit-confirm" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">' +
      '<h2 id="exit-confirm-title">' + title + '</h2>' +
      '<div class="sub">' + detail + '</div>' +
      projects +
      '<div class="exit-confirm-note" role="status"></div>' +
      '<div class="exit-confirm-actions">' +
        '<button class="btn btn-ghost" type="button" data-exit="cancel">取消</button>' +
        '<button class="btn btn-ghost danger" type="button" data-exit="discard">' + (hasDirty ? '不保存退出' : '仍然退出') + '</button>' +
        (hasDirty ? '<button class="btn btn-primary" type="button" data-exit="save">' + (hasTasks ? '保存当前进度并退出' : '保存并退出') + '</button>' : '') +
      '</div>' +
    '</section>';
  document.body.appendChild(mask);
  exitConfirmMask = mask;
  exitConfirmBusy = false;
  const cancel = mask.querySelector('[data-exit="cancel"]');
  const discard = mask.querySelector('[data-exit="discard"]');
  const save = mask.querySelector('[data-exit="save"]');
  const note = mask.querySelector('.exit-confirm-note');
  const buttons = [cancel, discard, save].filter(Boolean);
  const setBusy = busy => {
    exitConfirmBusy = busy;
    buttons.forEach(button => { button.disabled = busy; });
  };
  cancel.onclick = () => dismissExitConfirm();
  discard.onclick = async () => {
    if (exitConfirmBusy) return;
    setBusy(true);
    await closeWindowNow();
  };
  if (save) save.onclick = async () => {
    if (exitConfirmBusy) return;
    setBusy(true);
    note.textContent = '正在保存…';
    try {
      const saved = window.GWCanvas && window.GWCanvas.saveForProjectSwitch
        ? await window.GWCanvas.saveForProjectSwitch()
        : false;
      if (saved === false) throw new Error('项目保存失败');
      await closeWindowNow();
    } catch (error) {
      setBusy(false);
      note.textContent = (error.message || '项目保存失败') + '，已取消退出。';
    }
  };
  mask.addEventListener('mousedown', event => {
    if (event.target === mask && !exitConfirmBusy) dismissExitConfirm();
  });
  mask.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !exitConfirmBusy) {
      event.preventDefault();
      event.stopPropagation();
      dismissExitConfirm();
    }
  });
  requestAnimationFrame(() => cancel.focus());
}

async function handleWindowCloseRequest() {
  const stats = window.GWCanvas && window.GWCanvas.getRuntimeStats
    ? window.GWCanvas.getRuntimeStats()
    : null;
  const dirtyNames = dirtyProjectNames(stats);
  const taskCount = Math.max(Number(stats && stats.running) || 0, Number(stats && stats.pending) || 0);
  if (!dirtyNames.length && !taskCount) {
    await closeWindowNow();
    return;
  }
  showExitConfirm(dirtyNames, taskCount);
}

ipcRenderer.on('window:request-close', () => {
  handleWindowCloseRequest().catch(error => toast('检查退出状态失败：' + (error.message || error), true));
});
bindCanvasRail();
renderShortcutTable(document.getElementById('help-keys'));

// M1.16：空态直达按钮 + 全局出口
if ($('btn-empty-import')) $('btn-empty-import').onclick = doImport;
// 空白画布的引导按钮：新手模板已下线，改为打开内置的「新手使用说明书」项目
if ($('btn-empty-template')) $('btn-empty-template').onclick = openGuideProject;
if ($('btn-hint-import')) $('btn-hint-import').onclick = doImport;
window.GW_doImport = doImport;
window.GW_createProject = async (name) => {
  const r = await ipcRenderer.invoke('projects:create', { accountId: account.id, name });
  if (!r.ok) { toast(r.msg === 'cancel' ? '已取消' : r.msg, r.msg !== 'cancel'); return; }
  openProject(r.project);
};

initUpdateUi();
