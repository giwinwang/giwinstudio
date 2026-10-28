(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GWModelTuning = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULT_PROFILE = Object.freeze({
    defaultReferenceMode: "material",
    supportedReferenceModes: ["atmosphere", "material"],
    referenceStrength: Object.freeze({ atmosphere: .32, material: .62 }),
    structureGuard: "standard",
    promptFlavor: "structured",
    role: "general",
    notes: ""
  });

  const MODEL_PROFILES = {
    "nano-banana-2": {
      defaultReferenceMode: "material",
      supportedReferenceModes: ["atmosphere", "material"],
      referenceStrength: { atmosphere: .24, material: .42 },
      structureGuard: "strong",
      promptFlavor: "natural",
      role: "appearance-sensitive",
      notes: "参考图响应强，降低颜色迁移与建筑造型发挥，防止新增吊顶、墙面和地面拼花。"
    },
    "nano-banana-pro": {
      defaultReferenceMode: "material",
      supportedReferenceModes: ["atmosphere", "material"],
      referenceStrength: { atmosphere: .26, material: .46 },
      structureGuard: "strong",
      promptFlavor: "natural",
      role: "appearance-sensitive",
      notes: "外观表现力强，需要加强物理结构锁定。"
    },
    "seedream-v5-pro": {
      defaultReferenceMode: "material",
      supportedReferenceModes: ["atmosphere", "material"],
      referenceStrength: { atmosphere: .4, material: .78 },
      structureGuard: "standard",
      promptFlavor: "keyword",
      role: "structure-conservative",
      notes: "结构通常稳定，但容易忽略参考图材质，需要提高参考迁移强度。"
    },
    "doubao-seedream-5-0-pro-250930": {
      defaultReferenceMode: "material",
      supportedReferenceModes: ["atmosphere", "material"],
      referenceStrength: { atmosphere: .4, material: .78 },
      structureGuard: "standard",
      promptFlavor: "keyword",
      role: "structure-conservative",
      notes: "结构通常稳定，但容易忽略参考图材质，需要提高参考迁移强度。"
    },
    "gemini-3-pro-image": {
      defaultReferenceMode: "material",
      supportedReferenceModes: ["atmosphere", "material"],
      referenceStrength: { atmosphere: .28, material: .48 },
      structureGuard: "strong",
      promptFlavor: "natural",
      role: "appearance-sensitive",
      notes: "外观联想较强，优先锁定吊顶、灯槽和固定构造。"
    },
    "gpt-image-2": {
      defaultReferenceMode: "material",
      supportedReferenceModes: ["atmosphere", "material"],
      referenceStrength: { atmosphere: .30, material: .55 },
      structureGuard: "strong",
      promptFlavor: "structured",
      role: "text-accurate",
      notes: "文字与标注渲染最准，适合图上尺寸标注、物料说明和标识；会自行补充细节，必须锁定吊顶、灯槽、灯具与固定构造。"
    },
    "gpt-image-1": {
      defaultReferenceMode: "material",
      supportedReferenceModes: ["atmosphere", "material"],
      referenceStrength: { atmosphere: .28, material: .50 },
      structureGuard: "strong",
      promptFlavor: "structured",
      role: "general",
      notes: "OpenAI 上一代图像模型，文字能力弱于 gpt-image-2；同样需要显式禁止新增物体。"
    }
  };

  function normalizeMode(mode) {
    return mode === "atmosphere" ? "atmosphere" : "material";
  }

  function profileFor(engineId, model) {
    const name = String(model || "").toLowerCase();
    const exact = MODEL_PROFILES[name];
    if (exact) return Object.assign({}, DEFAULT_PROFILE, exact, {
      referenceStrength: Object.assign({}, DEFAULT_PROFILE.referenceStrength, exact.referenceStrength)
    });
    if (/gpt-image/.test(name)) return profileFor(engineId, /gpt-image-2/.test(name) ? "gpt-image-2" : "gpt-image-1");
    if (/banana/.test(name)) return profileFor(engineId, name.includes("pro") ? "nano-banana-pro" : "nano-banana-2");
    if (/seedream|doubao/.test(name)) {
      return profileFor(engineId, name.includes("5-0") ? "doubao-seedream-5-0-pro-250930" : "seedream-v5-pro");
    }
    return Object.assign({}, DEFAULT_PROFILE, {
      referenceStrength: Object.assign({}, DEFAULT_PROFILE.referenceStrength)
    });
  }

  function referenceStrength(engineId, model, mode) {
    const profile = profileFor(engineId, model);
    return profile.referenceStrength[normalizeMode(mode)];
  }

  function promptFlavorFor(engineId, model) {
    const name = String(model || "").toLowerCase();
    if (/doubao|seedream/.test(name)) return "keyword";
    if (/gpt-image/.test(name)) return "structured";
    if (/nano-banana|gemini/.test(name)) return "natural";
    if (/flux|stable-diffusion|sdxl/.test(name)) return "concise";
    return profileFor(engineId, model).promptFlavor || "structured";
  }

  return {
    DEFAULT_PROFILE,
    MODEL_PROFILES,
    normalizeMode,
    profileFor,
    referenceStrength,
    promptFlavorFor
  };
});
