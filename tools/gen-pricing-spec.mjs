// 把 pricing-spec.json 生成浏览器可用的 pricing-spec.js（window.GW_PRICING）
// 用途：画布客户端（app.js / providers.js）不能直接读文件，用这份生成产物保持与真源一致。
// 改了 pricing-spec.json 之后必须跑：node tools/gen-pricing-spec.mjs（或 npm run pricing:sync）
// tests/pricing-spec.test.js 会校验生成产物没有过期。
"use strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const SPEC_PATH = path.join(root, "pricing-spec.json");
export const OUT_PATH = path.join(root, "pricing-spec.js");

export function buildBrowserSpec() {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  return [
    "// 自动生成，请勿手改。真源：pricing-spec.json（node tools/gen-pricing-spec.mjs 重新生成）",
    "// 口径说明：金额是软件使用费；积分是随订阅赠送的额度，不做元↔积分的对价换算。",
    "(function (global) {",
    "  \"use strict\";",
    "  global.GW_PRICING = " + JSON.stringify(spec, null, 2).replace(/\n/g, "\n  ") + ";",
    "})(typeof window !== \"undefined\" ? window : globalThis);",
    ""
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = buildBrowserSpec();
  fs.writeFileSync(OUT_PATH, code, "utf8");
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  console.log("✓ 已生成 pricing-spec.js（" + spec.plans.length + " 档，" + code.length + " 字节）");
}
