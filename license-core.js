'use strict';

const crypto = require('crypto');

const PRODUCT = 'giwin-studio';
const FORMAT = 'giwin-license-v1';
const ACTIVATION_PREFIX = 'GIWIN1';
const COMPACT_ACTIVATION_PREFIX = 'GIWIN2';
const INVITE_PREFIX = 'INV-';
const INVITE_REWARD_PREFIX = 'GIWIN3';
const POINTS_CODE_PREFIX = 'GIWIN4';
const MAX_ACTIVATION_CODE_LENGTH = 16 * 1024;
const MAX_INVITE_REWARD_DAYS = 35;
const INVITE_REWARD_DAYS = 7;
const MAX_POINTS_PER_CODE = 100000;
const DEFAULT_FEATURES = ['canvas', 'generate', 'workflow', 'export'];

// 授权档位定稿（docs/积分体系设计方案-v1.md「档位改写 2026-10-29 二次简化」）：
// beta 只激活 / trial 体验包 / solo 标准版 / pro 高级版。工作室档已取消，新码不再签发。
// 客户端 app.js 的 entitlementTier() 按同一套取值判定，两处必须一致。
const EDITIONS = ['beta', 'trial', 'solo', 'pro'];

function normalizeEdition(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!raw) return 'beta';
  if (EDITIONS.indexOf(raw) >= 0) return raw;
  // 历史别名收敛到正名，兼容老 SOP 与手工命令里的写法
  if (/^(basic|starter|standard)$/.test(raw)) return 'solo';
  if (/^(professional|premium)$/.test(raw)) return 'pro';
  if (/^first$/.test(raw)) return 'trial';
  if (/^(studio|team|enterprise)$/.test(raw)) {
    throw new Error('授权档位已取消：' + raw + '（工作室档并入高级版，请改用 pro）');
  }
  throw new Error('未知授权档位：' + raw + '（可选 beta / trial / solo / pro）');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('许可证编码格式无效');
  }
  return Buffer.from(value, 'base64url');
}

function canonicalDeviceId(value) {
  return String(value || '').trim().toUpperCase();
}

function inviteCodeForDeviceId(value) {
  const deviceId = canonicalDeviceId(value);
  if (!/^GW-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(deviceId)) {
    throw new Error('设备 ID 格式无效');
  }
  return INVITE_PREFIX + deviceId.slice(3);
}

function deviceIdFromInviteCode(value) {
  const code = canonicalDeviceId(value);
  if (/^GW-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code)) return code;
  if (/^INV-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code)) return 'GW-' + code.slice(4);
  throw new Error('邀请码格式不正确');
}

function createDeviceId(...parts) {
  const values = parts.map(value => String(value || '').trim());
  if (!values.length || values.some(value => !value)) throw new Error('缺少设备标识');
  const digest = crypto.createHash('sha256')
    .update([PRODUCT, ...values].join('|'))
    .digest('hex')
    .toUpperCase();
  return 'GW-' + digest.slice(0, 4) + '-' + digest.slice(4, 8) + '-' + digest.slice(8, 12) + '-' + digest.slice(12, 16);
}

function encodeActivationCode(envelope) {
  if (!envelope || envelope.format !== FORMAT || !envelope.payload || !envelope.signature) {
    throw new Error('许可证内容不完整，无法生成激活码');
  }
  return ACTIVATION_PREFIX + '.' + envelope.payload + '.' + envelope.signature;
}

function issueActivationCode(options = {}) {
  const privateKey = options.privateKey;
  const deviceId = canonicalDeviceId(options.deviceId);
  if (!privateKey) throw new Error('缺少许可证签发私钥');
  if (!deviceId) throw new Error('缺少设备 ID');
  const now = Number(options.now) || Date.now();
  const days = Math.max(1, Math.min(3650, Number(options.days) || 15));
  const features = Array.isArray(options.features) && options.features.length
    ? Array.from(new Set(options.features.map(String)))
    : DEFAULT_FEATURES;
  const payload = {
    v: 2,
    id: crypto.randomBytes(4).toString('hex'),
    d: deviceId,
    e: normalizeEdition(options.edition),
    i: Math.floor(now / 1000),
    x: Math.floor((now + days * 24 * 60 * 60 * 1000) / 1000),
    f: features.length === DEFAULT_FEATURES.length && features.every((value, index) => value === DEFAULT_FEATURES[index])
      ? 15
      : features
  };
  const holder = String(options.holder || '').trim();
  if (holder) payload.h = holder.slice(0, 80);
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto.sign(null, payloadBytes, privateKey);
  return COMPACT_ACTIVATION_PREFIX + '.' + payloadBytes.toString('base64url') + '.' + signature.toString('base64url');
}

function parseActivationCode(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact) throw new Error('请输入激活码');
  if (compact.length > MAX_ACTIVATION_CODE_LENGTH) throw new Error('激活码长度异常');
  const parts = compact.split('.');
  if (parts.length !== 3 || ![ACTIVATION_PREFIX, COMPACT_ACTIVATION_PREFIX].includes(parts[0].toUpperCase())) {
    throw new Error('激活码格式不正确');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    throw new Error('激活码包含无效字符');
  }
  try {
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    Buffer.from(parts[2], 'base64url');
    if (parts[0].toUpperCase() === COMPACT_ACTIVATION_PREFIX) {
      return { version: 2, compact, payload: parts[1], signature: parts[2], data: decoded };
    }
  } catch (error) {
    throw new Error('激活码内容无法解析');
  }
  return {
    version: 1,
    compact,
    envelope: {
      format: FORMAT,
      payload: parts[1],
      signature: parts[2]
    }
  };
}

function verifyActivationCode(value, options = {}) {
  const publicKey = options.publicKey;
  const expectedDeviceId = canonicalDeviceId(options.deviceId);
  const now = Number(options.now) || Date.now();
  if (!publicKey) return { ok: false, code: 'missing_public_key', message: '许可证公钥缺失' };
  let parsed;
  try {
    parsed = parseActivationCode(value);
  } catch (error) {
    return { ok: false, code: 'invalid_format', message: error.message };
  }
  if (parsed.version === 1) return verifyLicense(parsed.envelope, { publicKey, deviceId: expectedDeviceId, now });

  const payloadBytes = Buffer.from(parsed.payload, 'base64url');
  const signature = Buffer.from(parsed.signature, 'base64url');
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, payloadBytes, publicKey, signature);
  } catch (error) {}
  if (!signatureValid) return { ok: false, code: 'invalid_signature', message: '激活码签名无效' };
  const data = parsed.data || {};
  if (data.v !== 2) return { ok: false, code: 'wrong_product', message: '这不是极物激活码' };
  if (!expectedDeviceId || canonicalDeviceId(data.d) !== expectedDeviceId) {
    return { ok: false, code: 'device_mismatch', message: '激活码不属于当前设备' };
  }
  const issuedAt = Number(data.i) * 1000;
  const expiresAt = Number(data.x) * 1000;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    return { ok: false, code: 'invalid_dates', message: '激活码有效期无效' };
  }
  if (now + 5 * 60 * 1000 < issuedAt) {
    return { ok: false, code: 'not_yet_valid', message: '激活码尚未生效' };
  }
  const features = data.f === 15
    ? DEFAULT_FEATURES.slice()
    : Array.isArray(data.f) && data.f.length
      ? Array.from(new Set(data.f.map(String)))
      : DEFAULT_FEATURES.slice();
  const license = {
    version: 1,
    product: PRODUCT,
    licenseId: 'code-' + String(data.id || ''),
    edition: String(data.e || 'beta'),
    holder: String(data.h || '').trim(),
    deviceId: canonicalDeviceId(data.d),
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    features,
    note: '离线激活码'
  };
  if (now >= expiresAt && !options.allowExpired) {
    return { ok: false, code: 'expired', message: '内测激活码已到期', license };
  }
  return { ok: true, code: 'valid', license };
}

function issueInviteRewardCode(options = {}) {
  const privateKey = options.privateKey;
  const deviceId = canonicalDeviceId(options.deviceId);
  const inviteeDeviceId = canonicalDeviceId(options.inviteeDeviceId);
  if (!privateKey) throw new Error('缺少奖励码签发私钥');
  if (!deviceId || !inviteeDeviceId) throw new Error('缺少邀请双方设备 ID');
  if (deviceId === inviteeDeviceId) throw new Error('不能邀请当前设备自身');
  const now = Number(options.now) || Date.now();
  const days = Math.max(1, Math.min(MAX_INVITE_REWARD_DAYS, Number(options.days) || INVITE_REWARD_DAYS));
  const validDays = Math.max(1, Math.min(365, Number(options.validDays) || 30));
  const payload = {
    v: 3,
    id: crypto.randomBytes(4).toString('hex'),
    d: deviceId,
    b: inviteeDeviceId,
    s: days,
    i: Math.floor(now / 1000),
    x: Math.floor((now + validDays * 24 * 60 * 60 * 1000) / 1000)
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto.sign(null, payloadBytes, privateKey);
  return INVITE_REWARD_PREFIX + '.' + payloadBytes.toString('base64url') + '.' + signature.toString('base64url');
}

function verifyInviteRewardCode(value, options = {}) {
  const publicKey = options.publicKey;
  const expectedDeviceId = canonicalDeviceId(options.deviceId);
  const now = Number(options.now) || Date.now();
  if (!publicKey) return { ok: false, code: 'missing_public_key', message: '奖励码公钥缺失' };
  const compact = String(value || '').replace(/\s+/g, '');
  const parts = compact.split('.');
  if (compact.length > MAX_ACTIVATION_CODE_LENGTH || parts.length !== 3 || parts[0].toUpperCase() !== INVITE_REWARD_PREFIX) {
    return { ok: false, code: 'invalid_format', message: '邀请奖励码格式不正确' };
  }
  let payloadBytes;
  let signature;
  let data;
  try {
    payloadBytes = Buffer.from(parts[1], 'base64url');
    signature = Buffer.from(parts[2], 'base64url');
    data = JSON.parse(payloadBytes.toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'invalid_format', message: '邀请奖励码无法解析' };
  }
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, payloadBytes, publicKey, signature);
  } catch (error) {}
  if (!signatureValid) return { ok: false, code: 'invalid_signature', message: '邀请奖励码签名无效' };
  if (data.v !== 3) return { ok: false, code: 'invalid_format', message: '邀请奖励码版本无效' };
  if (!expectedDeviceId || canonicalDeviceId(data.d) !== expectedDeviceId) {
    return { ok: false, code: 'device_mismatch', message: '邀请奖励码不属于当前设备' };
  }
  if (!/^GW-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(canonicalDeviceId(data.b)) ||
      canonicalDeviceId(data.b) === canonicalDeviceId(data.d)) {
    return { ok: false, code: 'invalid_invite', message: '邀请关系无效' };
  }
  const issuedAt = Number(data.i) * 1000;
  const expiresAt = Number(data.x) * 1000;
  const days = Number(data.s);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || !Number.isInteger(days) || days < 1 || days > MAX_INVITE_REWARD_DAYS) {
    return { ok: false, code: 'invalid_dates', message: '邀请奖励码内容无效' };
  }
  if (now + 5 * 60 * 1000 < issuedAt) {
    return { ok: false, code: 'not_yet_valid', message: '邀请奖励码尚未生效' };
  }
  if (!options.allowExpired && now >= expiresAt) return { ok: false, code: 'expired', message: '邀请奖励码已过期' };
  return {
    ok: true,
    code: 'valid',
    reward: {
      id: 'invite-' + String(data.id || ''),
      deviceId: canonicalDeviceId(data.d),
      inviteeDeviceId: canonicalDeviceId(data.b),
      days,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString()
    }
  };
}

// ---------- 积分码（GIWIN4）：带面额的兑换码，复用 Ed25519 签名 ----------
// payload: { v:4, id, p:面额(积分), d:设备ID(可空=不绑设备), i:签发秒, x:兑换截止秒, h:备注 }
// 兑换率（2026-10-29 定）：¥1 = 2 积分；1 积分 = 1 张 1K 出图（成本锚 apilio seedream-v5-pro ¥0.27/张，2K ¥0.54）
function issuePointsCode(options = {}) {
  const privateKey = options.privateKey;
  if (!privateKey) throw new Error('缺少积分码签发私钥');
  const points = Math.floor(Number(options.points));
  if (!Number.isFinite(points) || points < 1 || points > MAX_POINTS_PER_CODE) {
    throw new Error('积分面额无效（1-' + MAX_POINTS_PER_CODE + '）');
  }
  const now = Number(options.now) || Date.now();
  const validDays = Math.max(1, Math.min(3650, Number(options.validDays) || 90));
  const payload = {
    v: 4,
    id: crypto.randomBytes(4).toString('hex'),
    p: points,
    i: Math.floor(now / 1000),
    x: Math.floor((now + validDays * 24 * 60 * 60 * 1000) / 1000)
  };
  const deviceId = canonicalDeviceId(options.deviceId);
  if (deviceId) payload.d = deviceId;
  // 积分有效期：'month' = 月底清零；数字 = 兑换后 N 天有效；不填 = 永久
  const pe = options.pointsExpiry;
  if (pe === 'month') payload.pe = 'm';
  else if (Number.isFinite(Number(pe)) && Number(pe) > 0) payload.pe = Math.min(3650, Math.floor(Number(pe)));
  const holder = String(options.holder || '').trim();
  if (holder) payload.h = holder.slice(0, 80);
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto.sign(null, payloadBytes, privateKey);
  return POINTS_CODE_PREFIX + '.' + payloadBytes.toString('base64url') + '.' + signature.toString('base64url');
}

function parsePointsCode(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact) throw new Error('请输入兑换码');
  if (compact.length > MAX_ACTIVATION_CODE_LENGTH) throw new Error('兑换码长度异常');
  const parts = compact.split('.');
  if (parts.length !== 3 || parts[0].toUpperCase() !== POINTS_CODE_PREFIX) {
    throw new Error('积分兑换码格式不正确');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    throw new Error('积分兑换码包含无效字符');
  }
  try {
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { compact, data };
  } catch (error) {
    throw new Error('积分兑换码无法解析');
  }
}

function verifyPointsCode(value, options = {}) {
  const publicKey = options.publicKey;
  const expectedDeviceId = canonicalDeviceId(options.deviceId);
  const now = Number(options.now) || Date.now();
  if (!publicKey) return { ok: false, code: 'missing_public_key', message: '公钥缺失' };
  let parsed;
  try {
    parsed = parsePointsCode(value);
  } catch (error) {
    return { ok: false, code: 'invalid_format', message: error.message };
  }
  const payloadBytes = Buffer.from(parsed.compact.split('.')[1], 'base64url');
  const signature = Buffer.from(parsed.compact.split('.')[2], 'base64url');
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, payloadBytes, publicKey, signature);
  } catch (error) {}
  if (!signatureValid) return { ok: false, code: 'invalid_signature', message: '兑换码签名无效' };
  const data = parsed.data || {};
  if (data.v !== 4) return { ok: false, code: 'wrong_version', message: '这不是积分兑换码' };
  const points = Number(data.p);
  if (!Number.isInteger(points) || points < 1 || points > MAX_POINTS_PER_CODE) {
    return { ok: false, code: 'invalid_points', message: '兑换码面额无效' };
  }
  // 绑定设备的码必须在本机兑换；未绑定设备的码任何设备可兑
  if (data.d && expectedDeviceId && canonicalDeviceId(data.d) !== expectedDeviceId) {
    return { ok: false, code: 'device_mismatch', message: '兑换码不属于当前设备' };
  }
  const issuedAt = Number(data.i) * 1000;
  const redeemBy = Number(data.x) * 1000;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(redeemBy) || redeemBy <= issuedAt) {
    return { ok: false, code: 'invalid_dates', message: '兑换码有效期无效' };
  }
  if (now + 5 * 60 * 1000 < issuedAt) {
    return { ok: false, code: 'not_yet_valid', message: '兑换码尚未生效' };
  }
  if (!options.allowExpired && now >= redeemBy) {
    return { ok: false, code: 'expired', message: '兑换码已过兑换截止日', credit: { id: 'points-' + String(data.id || ''), points, redeemBy: new Date(redeemBy).toISOString() } };
  }
  return {
    ok: true,
    code: 'valid',
    credit: {
      id: 'points-' + String(data.id || ''),
      points,
      pointsExpiry: data.pe === 'm' ? 'month' : (Number.isFinite(Number(data.pe)) && Number(data.pe) > 0 ? Number(data.pe) : null),
      deviceId: data.d ? canonicalDeviceId(data.d) : '',
      issuedAt: new Date(issuedAt).toISOString(),
      redeemBy: new Date(redeemBy).toISOString()
    }
  };
}

function issueLicense(options = {}) {
  const privateKey = options.privateKey;
  const deviceId = canonicalDeviceId(options.deviceId);
  if (!privateKey) throw new Error('缺少许可证签发私钥');
  if (!deviceId) throw new Error('缺少设备 ID');

  const now = Number(options.now) || Date.now();
  const days = Math.max(1, Math.min(3650, Number(options.days) || 15));
  const payload = {
    version: 1,
    product: PRODUCT,
    licenseId: options.licenseId || crypto.randomUUID(),
    edition: normalizeEdition(options.edition),
    holder: String(options.holder || '').trim(),
    deviceId,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
    features: Array.isArray(options.features) && options.features.length
      ? Array.from(new Set(options.features.map(String)))
      : ['canvas', 'generate', 'workflow', 'export'],
    note: String(options.note || '').trim()
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto.sign(null, payloadBytes, privateKey);
  return {
    format: FORMAT,
    payload: payloadBytes.toString('base64url'),
    signature: signature.toString('base64url')
  };
}

function verifyLicense(envelope, options = {}) {
  const publicKey = options.publicKey;
  const expectedDeviceId = canonicalDeviceId(options.deviceId);
  const now = Number(options.now) || Date.now();
  if (!publicKey) return { ok: false, code: 'missing_public_key', message: '许可证公钥缺失' };
  if (!envelope || envelope.format !== FORMAT || !envelope.payload || !envelope.signature) {
    return { ok: false, code: 'invalid_format', message: '许可证文件格式不正确' };
  }

  let payloadBytes;
  let signature;
  let payload;
  try {
    payloadBytes = fromBase64url(envelope.payload);
    signature = fromBase64url(envelope.signature);
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'invalid_format', message: '许可证内容无法解析' };
  }

  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, payloadBytes, publicKey, signature);
  } catch (error) {}
  if (!signatureValid) return { ok: false, code: 'invalid_signature', message: '许可证签名无效' };
  if (!payload || payload.version !== 1 || payload.product !== PRODUCT) {
    return { ok: false, code: 'wrong_product', message: '这不是极物内测许可证' };
  }
  if (!expectedDeviceId || canonicalDeviceId(payload.deviceId) !== expectedDeviceId) {
    return { ok: false, code: 'device_mismatch', message: '许可证不属于当前设备' };
  }

  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    return { ok: false, code: 'invalid_dates', message: '许可证有效期无效' };
  }
  if (now + 5 * 60 * 1000 < issuedAt) {
    return { ok: false, code: 'not_yet_valid', message: '许可证尚未生效' };
  }
  if (now >= expiresAt) {
    return { ok: false, code: 'expired', message: '内测许可证已到期', license: payload };
  }
  return { ok: true, code: 'valid', license: payload };
}

function createActivationRequest(options = {}) {
  const deviceId = canonicalDeviceId(options.deviceId);
  if (!deviceId) throw new Error('缺少设备 ID');
  const request = {
    format: 'giwin-activation-request-v1',
    product: PRODUCT,
    deviceId,
    appVersion: String(options.appVersion || ''),
    platform: String(options.platform || process.platform),
    requestedAt: new Date(Number(options.now) || Date.now()).toISOString()
  };
  if (options.inviteCode) request.inviteCode = inviteCodeForDeviceId(deviceIdFromInviteCode(options.inviteCode));
  return request;
}

module.exports = {
  PRODUCT,
  FORMAT,
  ACTIVATION_PREFIX,
  COMPACT_ACTIVATION_PREFIX,
  INVITE_PREFIX,
  INVITE_REWARD_PREFIX,
  POINTS_CODE_PREFIX,
  MAX_INVITE_REWARD_DAYS,
  INVITE_REWARD_DAYS,
  MAX_POINTS_PER_CODE,
  EDITIONS,
  normalizeEdition,
  canonicalDeviceId,
  inviteCodeForDeviceId,
  deviceIdFromInviteCode,
  createDeviceId,
  issueActivationCode,
  encodeActivationCode,
  parseActivationCode,
  verifyActivationCode,
  issueInviteRewardCode,
  verifyInviteRewardCode,
  issuePointsCode,
  parsePointsCode,
  verifyPointsCode,
  issueLicense,
  verifyLicense,
  createActivationRequest
};
