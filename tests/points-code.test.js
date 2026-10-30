"use strict";
// GIWIN4 积分码：license-core 单测 + 签发工具端到端
// 用法: node tests/points-code.test.js
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const licenseCore = require(path.join(root, "license-core.js"));
const adminTool = path.join(root, "..", "license-admin", "license-admin.mjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("PASS", name);
}

// ---------- 准备临时密钥 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "giwin-points-test-"));
const keyDir = path.join(tmp, "keys");
execFileSync("node", [adminTool, "init", "--key-dir", keyDir, "--force"], { encoding: "utf8" });
const privateKey = fs.readFileSync(path.join(keyDir, "private-key.pem"), "utf8");
const publicKey = fs.readFileSync(path.join(keyDir, "public-key.pem"), "utf8");

const DEVICE_A = "GW-AAAA-BBBB-CCCC-DDDD";
const DEVICE_B = "GW-1111-2222-3333-4444";

// ---------- license-core 基础功能 ----------
test("签发并验证：绑定设备的有效积分码", () => {
  const code = licenseCore.issuePointsCode({ privateKey, deviceId: DEVICE_A, points: 40, validDays: 90, holder: "测试", now: Date.now() });
  assert.equal(code.split(".")[0], "GIWIN4");
  const result = licenseCore.verifyPointsCode(code, { publicKey, deviceId: DEVICE_A });
  assert.equal(result.ok, true);
  assert.equal(result.credit.points, 40);
  assert.equal(result.credit.deviceId, DEVICE_A);
  assert.match(result.credit.id, /^points-[0-9a-f]{8}$/);
});

test("绑定设备的码在其它设备上被拒绝", () => {
  const code = licenseCore.issuePointsCode({ privateKey, deviceId: DEVICE_A, points: 10, now: Date.now() });
  const result = licenseCore.verifyPointsCode(code, { publicKey, deviceId: DEVICE_B });
  assert.equal(result.ok, false);
  assert.equal(result.code, "device_mismatch");
});

test("未绑定设备的码任何设备可兑", () => {
  const code = licenseCore.issuePointsCode({ privateKey, points: 5, now: Date.now() });
  const a = licenseCore.verifyPointsCode(code, { publicKey, deviceId: DEVICE_A });
  const b = licenseCore.verifyPointsCode(code, { publicKey, deviceId: DEVICE_B });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test("过期兑换码被拒绝", () => {
  const code = licenseCore.issuePointsCode({ privateKey, deviceId: DEVICE_A, points: 10, validDays: 1, now: Date.now() - 3 * 24 * 60 * 60 * 1000 });
  const result = licenseCore.verifyPointsCode(code, { publicKey, deviceId: DEVICE_A });
  assert.equal(result.ok, false);
  assert.equal(result.code, "expired");
});

test("篡改面额后签名失效", () => {
  const code = licenseCore.issuePointsCode({ privateKey, deviceId: DEVICE_A, points: 10, now: Date.now() });
  const parts = code.split(".");
  const data = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  data.p = 99999;
  const tampered = parts[0] + "." + Buffer.from(JSON.stringify(data), "utf8").toString("base64url") + "." + parts[2];
  const result = licenseCore.verifyPointsCode(tampered, { publicKey, deviceId: DEVICE_A });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_signature");
});

test("面额越界被拒绝", () => {
  assert.throws(() => licenseCore.issuePointsCode({ privateKey, points: 0 }), /面额无效/);
  assert.throws(() => licenseCore.issuePointsCode({ privateKey, points: 999999 }), /面额无效/);
});

// ---------- 签发工具端到端 ----------
test("license-admin points 签发 + inspect 验证 + 台账登记", () => {
  const out = path.join(tmp, "batch.txt");
  const ledger = path.join(tmp, "credit-ledger.csv");
  const run = JSON.parse(execFileSync("node", [
    adminTool, "points",
    "--app-dir", root,
    "--key-dir", keyDir,
    "--device-id", DEVICE_A,
    "--points", "40",
    "--count", "3",
    "--valid-days", "90",
    "--holder", "测试用户",
    "--amount", "50",
    "--note", "加油包批次A",
    "--out", out,
    "--ledger", ledger
  ], { encoding: "utf8" }));
  assert.equal(run.ok, true);
  assert.equal(run.codes.length, 3);
  assert.equal(run.ledgerRowAppended, true);
  const codes = fs.readFileSync(out, "utf8").trim().split("\n");
  assert.equal(codes.length, 3);
  // inspect 每一张
  for (const code of codes) {
    const inspection = JSON.parse(execFileSync("node", [
      adminTool, "inspect", "--app-dir", root, "--key-dir", keyDir, "--points-code", code
    ], { encoding: "utf8" }));
    assert.equal(inspection.ok, true, "inspect 应通过: " + JSON.stringify(inspection));
    assert.equal(inspection.credit.points, 40);
  }
  // 台账：表头 + 3 行，金额/面额/通道正确
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^日期,客户昵称/);
  assert.match(lines[1], /积分码 40 积分,50,40,points-code/);
  // 三张码 id 不重复
  const ids = codes.map(code => licenseCore.parsePointsCode(code).data.id);
  assert.equal(new Set(ids).size, 3, "码 id 应唯一");
});

test("与激活码格式互不干扰", () => {
  const activationCode = licenseCore.issueActivationCode({ privateKey, deviceId: DEVICE_A, days: 1, now: Date.now() });
  // 激活码不是积分码：parsePointsCode 应抛错
  assert.throws(() => licenseCore.parsePointsCode(activationCode), /格式不正确/);
  // 积分码走 verifyActivationCode：签名能过但版本 v=4 !== 2，必须被拒绝
  const pointsCode = licenseCore.issuePointsCode({ privateKey, points: 1, now: Date.now() });
  const verifyResult = licenseCore.verifyActivationCode(pointsCode, { publicKey, deviceId: DEVICE_A });
  assert.equal(verifyResult.ok, false);
  assert.ok(["invalid_format", "wrong_product"].includes(verifyResult.code), "积分码不得作为激活码通过");
});

// ---------- 手机签发端：订阅档位快捷面额 ----------
// 面额来源 docs/积分体系设计方案-v1.md「档位改写」：体验包 36 / 标准 120·360·1200 / 高级 340·1020·3400 / 加油包 230
test("手机端快捷面额与订阅档位定稿一致", () => {
  const issuerHtml = path.join(root, "..", "license-issuer-android", "app", "src", "main", "assets", "index.html");
  if (!fs.existsSync(issuerHtml)) {
    console.log("  跳过：未找到手机签发端工程");
    return;
  }
  const html = fs.readFileSync(issuerHtml, "utf8");
  const buttons = html.match(/<button class="denom"[^>]*>/g) || [];
  const amounts = buttons.map(tag => Number((tag.match(/data-points-amount="(\d+)"/) || [])[1]));
  assert.deepEqual(
    amounts.slice().sort((a, b) => a - b),
    [36, 120, 230, 340, 360, 1020, 1200, 3400],
    "八个档位面额必须与定稿一致"
  );
  // 每个按钮都要带有效期，否则填了面额却发成永久有效
  buttons.forEach(tag => {
    assert.match(tag, /data-points-expiry="(month|\d+)"/, "档位缺少有效期: " + tag);
  });
  // 兑换截止必须是正整数天
  buttons.forEach(tag => {
    assert.match(tag, /data-points-days="\d+"/, "档位缺少兑换截止: " + tag);
  });
  // 档位价必须与定价文档一致（季付 ¥156 这类，发码时要用它跟实收对账）
  const priceByAmount = { 36: "18", 120: "58", 360: "156", 1200: "580", 340: "168", 1020: "450", 3400: "1680", 230: "100 起" };
  buttons.forEach(tag => {
    const amount = Number((tag.match(/data-points-amount="(\d+)"/) || [])[1]);
    const price = (tag.match(/data-points-price="([^"]+)"/) || [])[1];
    assert.equal(price, priceByAmount[amount], "档位价不符: " + amount + " → " + price);
    assert.match(tag, /data-points-label="[^"]+"/, "档位缺少名称: " + tag);
  });
  // 面额不得超过单码上限，否则点下去直接被核心拒绝
  amounts.forEach(points => {
    assert.ok(points >= 1 && points <= licenseCore.MAX_POINTS_PER_CODE, "面额越界: " + points);
  });
});

// ---------- 清理 ----------
fs.rmSync(tmp, { recursive: true, force: true });
console.log("\n全部通过：" + passed + " 项");
