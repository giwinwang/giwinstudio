// 极物 · 引擎适配层（M2）：模型无关配方 → 各家提示词渲染 → OpenAI 兼容调用
(function () {
  const PROVIDERS = {
    apollo: {
      label: '阿波罗（中转站）',
      baseURL: 'https://api.apilio.ai',
      model: 'gemini-3-pro-image',
      visionModel: 'gpt-4o',
      price: 0.15,
      template: 'banana',
      sizes: ['auto', '1K', '2K'],
      hint: 'NanoBanana / GPT Image 等走这里，key 在阿波罗控制台获取'
    },
    volc: {
      label: '火山方舟（豆包官方）',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seedream-5-0-pro-260628',
      price: 0.6,
      template: 'doubao',
      sizes: ['auto', '1K', '1.5K', '2K'],
      hint: '豆包 Seedream 官方直连，国内免代理，火山控制台开通'
    },
    runninghub: {
      label: 'RunningHub（豆包/Topaz 等）',
      baseURL: 'https://www.runninghub.ai',
      model: 'doubao-seedream-5-0-pro-250930',
      price: 0.5,
      template: 'banana',
      sizes: ['auto', '1K', '2K'],
      hint: 'RunningHub 当前接入 Seedream 5 Pro 图生图；Topaz/视频工作流后续补'
    },
    replicate: {
      label: 'Replicate（LaMa 局部修复）',
      baseURL: 'https://api.replicate.com/v1',
      model: 'allenhooo/lama',
      price: 0,
      template: 'banana',
      sizes: ['auto'],
      aspects: ['auto'],
      image: false,
      hint: '用于全景极点 LaMa 局部修复。API Token 在 Replicate Account → API Tokens 获取。'
    },
    bailian: {
      label: '阿里云百炼（万相全景修复）',
      baseURL: 'https://dashscope.aliyuncs.com/api/v1',
      model: 'wanx2.1-imageedit',
      price: 0.14,
      template: 'doubao',
      sizes: ['auto', '2K'],
      aspects: ['auto', '2:1'],
      image: false,
      hint: '国内支付宝/阿里云余额充值。使用万相 2.1 遮罩局部重绘修复全景上下极点，按成功图片计费。'
    },
    topaz302: {
      label: '302.AI（Topaz 图片增强）',
      baseURL: 'https://api.302.ai',
      model: 'Standard V2',
      price: 0.15,
      template: 'banana',
      sizes: ['auto'],
      aspects: ['auto'],
      image: false,
      hint: '用于高清放大、降噪和锐化。在 302.AI 控制台充值并创建 API Key；按图片和积分计费。'
    },
    custom: {
      label: '自定义（OpenAI 兼容）',
      baseURL: '',
      model: '',
      price: 0,
      template: 'banana',
      sizes: ['auto', '1K', '2K'],
      hint: '任何 OpenAI 兼容接口（其他中转/自建服务）'
    },
    openai: {
      label: 'OpenAI（GPT 视觉识别）',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5',
      price: 0,
      template: 'banana',
      sizes: ['auto'],
      aspects: ['auto'],
      image: false,
      hint: '只用于空间材质视觉识别，不用于生图。填写 OpenAI API Key，识别模型可改成账号可用的 GPT 视觉模型。'
    },
    deepseek: {
      label: 'DeepSeek（对话 / 视觉）',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      visionModel: 'deepseek-flash',
      price: 0,
      template: 'banana',
      sizes: ['auto'],
      aspects: ['auto'],
      image: false,
      hint: '对话默认 deepseek-v4-pro；视觉识别默认 deepseek-flash。两者均已验证可接收图片，模型名仍可按你的接口修改。'
    }
  };

  let engineConfigCache = null;
  let secureEngineStorage = false;
  function readLocalConfigs() {
    try { return JSON.parse(localStorage.getItem('gw_engines') || '{}'); } catch (e) { return {}; }
  }
  function cloneConfigs(all) {
    try { return JSON.parse(JSON.stringify(all || {})); } catch (e) { return {}; }
  }
  function normalizedConfigs(all) {
    const cfgs = cloneConfigs(all);
    if (cfgs.apollo && !cfgs.apollo.visionModel) {
      cfgs.apollo.visionModel = PROVIDERS.apollo.visionModel;
    }
    if (cfgs.deepseek) {
      if (!cfgs.deepseek.model || /^deepseek-chat$/i.test(cfgs.deepseek.model)) {
        cfgs.deepseek.model = PROVIDERS.deepseek.model;
      }
      if (!cfgs.deepseek.visionModel || /^(deepseek-vl2|deepseek-v4-pro)$/i.test(cfgs.deepseek.visionModel)) {
        cfgs.deepseek.visionModel = PROVIDERS.deepseek.visionModel;
      }
    }
    return cfgs;
  }
  function electronBridge() {
    try {
      if (window.require) return window.require('electron');
    } catch (e) {}
    return null;
  }
  function loadConfigs() {
    if (engineConfigCache) return normalizedConfigs(engineConfigCache);
    const bridge = electronBridge();
    if (bridge && bridge.ipcRenderer) {
      try {
        const stored = bridge.ipcRenderer.sendSync('engines:loadSync');
        if (stored && typeof stored === 'object') {
          engineConfigCache = stored;
          secureEngineStorage = true;
          return normalizedConfigs(engineConfigCache);
        }
      } catch (e) {}
    }
    const local = readLocalConfigs();
    engineConfigCache = local;
    if (bridge && bridge.ipcRenderer && Object.keys(local).length) {
      try {
        const result = bridge.ipcRenderer.sendSync('engines:saveSync', local);
        if (result && result.ok) {
          secureEngineStorage = true;
          try { localStorage.removeItem('gw_engines'); } catch (e) {}
        }
      } catch (e) {}
    }
    return normalizedConfigs(engineConfigCache);
  }
  function saveConfig(id, cfg) {
    const all = loadConfigs();
    all[id] = cfg;
    engineConfigCache = all;
    const bridge = electronBridge();
    if (bridge && bridge.ipcRenderer) {
      try {
        const result = bridge.ipcRenderer.sendSync('engines:saveSync', all);
        if (result && result.ok) {
          secureEngineStorage = true;
          try { localStorage.removeItem('gw_engines'); } catch (e) {}
          return;
        }
      } catch (e) {}
    }
    try { localStorage.setItem('gw_engines', JSON.stringify(all)); } catch (e) {}
  }
  function storageMode() {
    if (!engineConfigCache) loadConfigs();
    return secureEngineStorage ? 'encrypted' : 'local';
  }



  // ===== 单一模型登记表 =====
  // 新增模型只改 MODEL_REGISTRY：engine / id / alias / sizes / aspects / note / idPattern。
  // 显示名、真实 ID 反查、内置模型清单、尺寸、比例和设置页说明都会自动派生。
  const CAP_GEMINI_3_PRO = { sizes: ['auto', '1K', '2K', '4K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16', '2:1'] };
  const CAP_GEMINI_3_FLASH = { sizes: ['auto', '1K', '2K', '4K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16', '2:1'] };
  const CAP_GEMINI_2_5 = { sizes: ['auto', '1K', '2K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16', '2:1'] };
  const CAP_GEMINI_2_0 = { sizes: ['auto', '1K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16'] };
  const CAP_GPT_IMAGE_2 = { sizes: ['auto', '1K', '2K'], aspects: ['auto', '1:1', '3:2', '2:3'] };
  const CAP_GPT_IMAGE_1 = { sizes: ['auto', '1K'], aspects: ['auto', '1:1', '3:2', '2:3'] };
  const CAP_DALLE3 = { sizes: ['auto', '1K', '2K'], aspects: ['auto', '1:1', '16:9', '9:16'] };
  const CAP_VOLC_5 = { sizes: ['auto', '1K', '1.5K', '2K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16'] };
  const CAP_VOLC_45 = { sizes: ['auto', '2K', '4K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16'] };
  const CAP_VOLC_40 = { sizes: ['auto', '1K', '2K', '4K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16'] };
  const CAP_RH_5 = { sizes: ['auto', '1K', '2K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16'] };
  const CAP_FLUX = { sizes: ['auto', '1K', '2K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16', '2:1'] };
  const CAP_GENERIC = { sizes: ['auto', '1K', '2K'], aspects: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16', '2:1'] };
  const VENDORS = {
    google: { label: 'Google', logo: 'logos/google.svg' },
    openai: { label: 'OpenAI', logo: 'logos/openai.svg' },
    anthropic: { label: 'Anthropic', logo: 'logos/anthropic.svg' },
    deepseek: { label: 'DeepSeek', logo: 'logos/deepseek.svg' },
    volc: { label: '火山引擎', logo: 'logos/volc.svg' },
    flux: { label: 'Black Forest Labs', logo: 'logos/flux.svg' },
    alibaba: { label: '阿里巴巴', logo: 'logos/alibaba.svg' },
    stability: { label: 'Stability AI', logo: 'logos/stability.svg' },
    kuaishou: { label: '可灵', logo: 'logos/kuaishou.svg' },
    tencent: { label: '腾讯混元', logo: 'logos/tencent.svg' },
    topaz: { label: 'Topaz Labs', logo: 'logos/generic.svg' },
    zhipu: { label: '智谱', logo: 'logos/zhipu.svg' },
    xai: { label: 'xAI', logo: 'logos/xai.svg' },
    midjourney: { label: 'Midjourney', logo: 'logos/midjourney.svg' },
    generic: { label: '其他', logo: 'logos/generic.svg' }
  };

  const MODEL_REGISTRY = [
    { engine: 'apollo', id: 'nano-banana-pro', alias: 'NanoBanana Pro', vendor: 'google', type: 'generate', default: true,
      sizes: CAP_GEMINI_3_PRO.sizes, aspects: CAP_GEMINI_3_PRO.aspects,
      note: '✔ 阿波罗聚合生图模型。支持图生图和 4K 档位。' },
    { engine: 'apollo', id: 'nano-banana-2', alias: 'NanoBanana 2', vendor: 'google', type: 'generate',
      sizes: CAP_GEMINI_3_FLASH.sizes, aspects: CAP_GEMINI_3_FLASH.aspects,
      note: '✔ 阿波罗聚合生图模型。速度快、成本低。' },
    { engine: 'apollo', id: 'seedream-v5-pro', alias: 'Seedream 5.0 Pro', aliases: ['Seedream 5 Pro', '豆包 Seedream 5.0 Pro', 'seedream-v5-pro'], vendor: 'volc', type: 'generate',
      idPattern: /^seedream-v5-pro/, sizes: CAP_VOLC_5.sizes, aspects: CAP_VOLC_5.aspects,
      note: '✔ 阿波罗中转的 Seedream 5.0 Pro 图生图模型，支持 1K / 1.5K / 2K。' },
    { engine: 'apollo', id: 'gemini-3-pro-image', alias: 'Gemini 3 Pro Image', vendor: 'google', type: 'generate',
      idPattern: /^gemini-3(?:\.0)?-pro-image/, sizes: CAP_GEMINI_3_PRO.sizes, aspects: CAP_GEMINI_3_PRO.aspects,
      note: '✅ 支持生图。质感天花板但有创作欲会加料 → 结构保持≥85 并附禁止增物条款；中文亲和' },
    { engine: 'apollo', id: 'gemini-3.1-flash-image', alias: 'Gemini 3.1 Flash Image', vendor: 'google', type: 'generate',
      idPattern: /^gemini-3\.1-flash-image/, sizes: CAP_GEMINI_3_FLASH.sizes, aspects: CAP_GEMINI_3_FLASH.aspects,
      note: '✅ 支持生图。速度快、成本低，适合快速迭代' },
    { engine: 'apollo', id: 'gemini-2.5-flash-image', alias: 'NanoBanana（经典）', vendor: 'google', type: 'generate',
      idPattern: /^gemini-2\.5-flash-image/, sizes: CAP_GEMINI_2_5.sizes, aspects: CAP_GEMINI_2_5.aspects,
      note: '✅ 支持生图。平衡型，质量与速度兼顾' },
    { engine: 'apollo', id: 'gemini-2.0-flash-exp-image-generation', alias: 'NanoBanana（旧版）', vendor: 'google', type: 'generate',
      idPattern: /^gemini-2\.0-flash-exp-image-generation/, sizes: CAP_GEMINI_2_0.sizes, aspects: CAP_GEMINI_2_0.aspects,
      note: '✅ 支持生图。兼容老中转的旧版图像模型，稳定性一般' },
    { engine: 'apollo', id: 'gpt-image-2', alias: 'GPT Image 2', vendor: 'openai', type: 'generate',
      idPattern: /^gpt-image-2/, sizes: CAP_GPT_IMAGE_2.sizes, aspects: CAP_GPT_IMAGE_2.aspects,
      note: '✅ 支持生图。文字渲染最强 → 图上标注/物料；按 token 计费偏贵，小场景用' },
    { engine: 'apollo', id: 'gpt-image-1', alias: 'GPT Image 1', vendor: 'openai', type: 'generate',
      idPattern: /^gpt-image-1(?!-mini)/, sizes: CAP_GPT_IMAGE_1.sizes, aspects: CAP_GPT_IMAGE_1.aspects,
      note: '✅ 支持生图。OpenAI 官方 DALL-E 3 级别' },
    { engine: 'apollo', id: 'gpt-image-1-mini', alias: 'GPT Image 1 Mini', vendor: 'openai', type: 'generate',
      idPattern: /^gpt-image-1-mini/, sizes: CAP_GPT_IMAGE_1.sizes, aspects: CAP_GPT_IMAGE_1.aspects,
      note: '✅ 支持生图。轻量快速版，适合草稿迭代' },
    { engine: 'apollo', id: 'dall-e-3', alias: 'DALL·E 3', aliases: ['DALL-E 3'], vendor: 'openai', type: 'generate',
      idPattern: /^dall-e-3/, sizes: CAP_DALLE3.sizes, aspects: CAP_DALLE3.aspects,
      note: '✅ 支持生图。OpenAI 官方，创意丰富但结构保持较弱' },
    { engine: 'openai', id: 'gpt-5', alias: 'GPT-5 Vision', aliases: ['GPT-5 视觉识别'], vendor: 'openai', type: 'vision',
      idPattern: /^gpt-(5|4\.1|4o)/, sizes: ['auto'], aspects: ['auto'],
      note: '视觉识别模型，用于空间材质分析，不用于生图。模型名可在设置中修改。' },
    { engine: 'openai', id: 'gpt-4.1', alias: 'GPT-4.1 Vision', vendor: 'openai', type: 'vision',
      idPattern: /^gpt-4\.1/, sizes: ['auto'], aspects: ['auto'],
      note: 'OpenAI 视觉识别备选模型，适合图片内容与清单提取。' },
    { engine: 'openai', id: 'gpt-4o', alias: 'GPT-4o Vision', vendor: 'openai', type: 'vision',
      idPattern: /^gpt-4o/, sizes: ['auto'], aspects: ['auto'],
      note: 'OpenAI 多模态视觉模型，适合图片内容与清单提取。' },
    { engine: 'deepseek', id: 'deepseek-v4-pro', alias: 'DeepSeek V4 Pro', vendor: 'deepseek', type: 'chat',
      sizes: ['auto'], aspects: ['auto'], note: 'DeepSeek 对话/推理模型，用于后续对话系统；实测不接收图片输入。' },
    { engine: 'deepseek', id: 'deepseek-flash', alias: 'DeepSeek Flash', vendor: 'deepseek', type: 'vision',
      sizes: ['auto'], aspects: ['auto'], note: 'DeepSeek 快速视觉模型；已实测可识别室内图与地面/墙面/柜体材质，默认用于空间材质识别。' },

    { engine: 'volc', id: 'doubao-seedream-5-0-pro-260628', alias: '豆包 Seedream 5.0 Pro', aliases: ['豆包 Seedream 5 Pro', 'Seedream 5 Pro'], vendor: 'volc', type: 'generate', default: true,
      idPattern: /^doubao-seedream-5-0-pro/, sizes: CAP_VOLC_5.sizes, aspects: CAP_VOLC_5.aspects,
      note: '✅ 支持生图。参考图模式保真度高、多视角一致性好 → 底稿/多视角首选' },
    { engine: 'volc', id: 'doubao-seedream-5-0-flash-260915', alias: '豆包 Seedream 5.0 Flash', aliases: ['豆包 Seedream 5 Flash', 'Seedream 5 Flash'], vendor: 'volc', type: 'generate',
      idPattern: /^doubao-seedream-5-0-flash/, sizes: CAP_VOLC_5.sizes, aspects: CAP_VOLC_5.aspects,
      note: '✅ 支持生图。速度快、成本低，适合快速迭代' },
    { engine: 'volc', id: 'doubao-seedream-4-5', alias: '豆包 Seedream 4.5', vendor: 'volc', type: 'generate',
      idPattern: /^doubao-seedream-4-5/, sizes: CAP_VOLC_45.sizes, aspects: CAP_VOLC_45.aspects,
      note: '✅ 支持生图。平衡型，质量与速度兼顾' },
    { engine: 'volc', id: 'doubao-seedream-4-0-250828', alias: '豆包 Seedream 4.0', vendor: 'volc', type: 'generate',
      idPattern: /^doubao-seedream-4-0/, sizes: CAP_VOLC_40.sizes, aspects: CAP_VOLC_40.aspects,
      note: '✅ 支持生图。基础版，适合简单场景' },

    { engine: 'runninghub', id: 'doubao-seedream-5-0-pro-250930', alias: '豆包 Seedream 5.0 Pro', aliases: ['豆包 Seedream 5 Pro', 'Seedream 5 Pro'], vendor: 'volc', type: 'generate', default: true,
      idPattern: /^(doubao-)?seedream-(5-0-pro|v5-pro|5-pro)/, sizes: CAP_RH_5.sizes, aspects: CAP_RH_5.aspects,
      note: '✅ 支持生图。RunningHub 当前接入的 Seedream 5 Pro 图生图通道' },

    { engine: 'replicate', id: 'allenhooo/lama', alias: 'LaMa', vendor: 'generic', type: 'generate', default: true,
      sizes: ['auto'], aspects: ['auto'],
      note: '全景极点专用局部修复；输入图片和遮罩，不支持提示词生成。' },

    { engine: 'bailian', id: 'wanx2.1-imageedit', alias: '万相 2.1 局部重绘', vendor: 'alibaba', type: 'generate', default: true,
      sizes: ['auto', '2K'], aspects: ['auto', '2:1'],
      note: '全景极点智能修复专用；支持原图与黑白遮罩局部重绘，国内按图片计费。' },

    { engine: 'topaz302', id: 'Standard V2', alias: 'Topaz Standard V2', vendor: 'topaz', type: 'generate', default: true,
      sizes: ['auto'], aspects: ['auto'],
      note: '通过 302.AI 调用 Topaz 图片增强，用于高清放大、降噪与锐化。' },

    { engine: 'any', id: 'flux-1.1-pro', alias: 'FLUX 1.1 Pro', vendor: 'flux', type: 'generate', idPattern: /^flux-1\.1-pro/, sizes: CAP_FLUX.sizes, aspects: CAP_FLUX.aspects,
      note: '写实空间与材质表现均衡，适合概念探索和高质量效果图；需通过自定义兼容接口调用。' },
    { engine: 'any', id: 'flux-pro', alias: 'FLUX Pro', vendor: 'flux', type: 'generate', idPattern: /^flux-pro/, sizes: CAP_FLUX.sizes, aspects: CAP_FLUX.aspects,
      note: '偏高质量的通用图像模型，细节稳定，适合正式方案输出；需通过自定义兼容接口调用。' },
    { engine: 'any', id: 'flux-dev', alias: 'FLUX Dev', vendor: 'flux', type: 'generate', idPattern: /^flux-dev/, sizes: CAP_FLUX.sizes, aspects: CAP_FLUX.aspects,
      note: '开放权重开发版，适合自建服务和参数调试；需通过兼容接口调用。' },
    { engine: 'any', id: 'flux-schnell', alias: 'FLUX Schnell', vendor: 'flux', type: 'generate', idPattern: /^flux-schnell/, sizes: CAP_FLUX.sizes, aspects: CAP_FLUX.aspects,
      note: '低延迟轻量版，适合草图和快速方案迭代；需通过兼容接口调用。' },
    { engine: 'any', id: 'qwen-image', alias: '通义万相', vendor: 'alibaba', type: 'generate', idPattern: /^(qwen-image|wanx)/, sizes: CAP_GENERIC.sizes, aspects: CAP_GENERIC.aspects,
      note: '中文语义理解较好，适合商业空间、版式文字和本土审美场景；需通过兼容接口调用。' },
    { engine: 'any', id: 'imagen-3.0-generate-002', alias: 'Imagen 3', vendor: 'google', type: 'generate', idPattern: /^imagen-3/, sizes: CAP_GENERIC.sizes, aspects: CAP_GENERIC.aspects,
      note: '提示词遵循和写实风格稳定，适合建筑与室内基础概念；需可用的 Google 兼容通道。' },
    { engine: 'any', id: 'imagen-4.0-generate-001', alias: 'Imagen 4', vendor: 'google', type: 'generate', idPattern: /^imagen-4/, sizes: CAP_GENERIC.sizes, aspects: CAP_GENERIC.aspects,
      note: '在细节、材质和画面文字表现上进一步增强，适合正式概念图；需可用的 Google 兼容通道。' },
    { engine: 'any', id: 'stable-diffusion-3.5-large', alias: 'SD 3.5 Large', vendor: 'stability', type: 'generate', idPattern: /^(stable-diffusion-3\.5|sd3)/, sizes: CAP_GENERIC.sizes, aspects: CAP_GENERIC.aspects,
      note: '适合写实与艺术化空间表达，参数控制空间较大；需自建或第三方兼容服务。' },
    { engine: 'any', id: 'kolors', alias: '可灵图片', vendor: 'kuaishou', type: 'generate', idPattern: /^kolors/, sizes: CAP_GENERIC.sizes, aspects: CAP_GENERIC.aspects,
      note: '中文消费场景和人物表现较好，适合生活方式类画面；需通过兼容接口调用。' },
    { engine: 'any', id: 'hunyuan-image', alias: '混元图片', vendor: 'tencent', type: 'generate', idPattern: /^hunyuan-image/, sizes: CAP_GENERIC.sizes, aspects: CAP_GENERIC.aspects,
      note: '面向中文语义和商业空间的通用图像模型；需通过兼容接口调用。' },
    { engine: 'any', id: 'cogview-4', alias: 'CogView 4', vendor: 'zhipu', type: 'generate', idPattern: /^cogview-4/, sizes: CAP_GENERIC.sizes, aspects: CAP_GENERIC.aspects,
      note: '双语理解和中文画面文字表现较好，适合方案封面与概念表达；需通过兼容接口调用。' }
  ];

  MODEL_REGISTRY.push(
    { engine: 'apollo', id: 'gpt-5', alias: 'GPT-5 Vision', aliases: ['GPT-5 视觉识别', 'Apollo GPT-5 Vision'], vendor: 'openai', type: 'vision',
      idPattern: /^gpt-5/, sizes: ['auto'], aspects: ['auto'],
      note: '阿波罗中转视觉识别模型，适合图片理解、软装提取和方案文案。' },
    { engine: 'apollo', id: 'gpt-4.1', alias: 'GPT-4.1 Vision', aliases: ['Apollo GPT-4.1 Vision'], vendor: 'openai', type: 'vision',
      idPattern: /^gpt-4\.1/, sizes: ['auto'], aspects: ['auto'],
      note: '阿波罗中转视觉识别模型，适合结构化识图和长文本输出。' },
    { engine: 'apollo', id: 'gpt-4o', alias: 'GPT-4o Vision', aliases: ['Apollo GPT-4o Vision'], vendor: 'openai', type: 'vision',
      idPattern: /^gpt-4o/, sizes: ['auto'], aspects: ['auto'],
      note: '阿波罗中转多模态视觉模型，速度与图片理解能力均衡。' },
    { engine: 'apollo', id: 'gemini-2.5-pro', alias: 'Gemini 2.5 Pro Vision', aliases: ['Apollo Gemini 2.5 Pro Vision'], vendor: 'google', type: 'vision',
      idPattern: /^gemini-2\.5-pro/, sizes: ['auto'], aspects: ['auto'],
      note: '阿波罗中转 Gemini 视觉模型，适合多图理解和室内设计语义分析。' },
    { engine: 'apollo', id: 'gemini-2.5-flash', alias: 'Gemini 2.5 Flash Vision', aliases: ['Apollo Gemini 2.5 Flash Vision'], vendor: 'google', type: 'vision',
      idPattern: /^gemini-2\.5-flash(?!-image)/, sizes: ['auto'], aspects: ['auto'],
      note: '阿波罗中转 Gemini 快速视觉模型，适合批量识图与页面文案。' },
    { engine: 'apollo', id: 'gemini-3-pro-preview', alias: 'Gemini 3 Pro Vision', aliases: ['Apollo Gemini 3 Pro Vision'], vendor: 'google', type: 'vision',
      idPattern: /^gemini-3-pro(?:-preview)?$/, sizes: ['auto'], aspects: ['auto'],
      note: '阿波罗中转 Gemini 3 Pro 视觉模型，适合复杂空间与多图一致性分析。' },
    { engine: 'apollo', id: 'claude-sonnet-4-20250514', alias: 'Claude Sonnet 4 Vision', aliases: ['Apollo Claude Sonnet 4 Vision'], vendor: 'anthropic', type: 'vision',
      idPattern: /^claude-(?:sonnet-4|4-sonnet)/, sizes: ['auto'], aspects: ['auto'],
      note: '阿波罗中转 Claude 视觉模型，擅长图像描述、设计概念和结构化文案。' }
  );

  const MODEL_ALIASES = {};
  const MODEL_PATTERNS = [];
  const ENGINE_MODEL_IDS = {};
  const GLOBAL_ALIAS_IDS = {};
  MODEL_REGISTRY.forEach(e => {
    MODEL_ALIASES[e.id] = e.alias;
    if (e.idPattern) MODEL_PATTERNS.push([e.idPattern, e.alias]);
    if (e.engine !== 'any') {
      ENGINE_MODEL_IDS[e.engine] = ENGINE_MODEL_IDS[e.engine] || {};
      ENGINE_MODEL_IDS[e.engine][e.alias] = e.id;
      (e.aliases || []).forEach(a => { ENGINE_MODEL_IDS[e.engine][a] = e.id; });
    }
    GLOBAL_ALIAS_IDS[e.alias] = GLOBAL_ALIAS_IDS[e.alias] || e.id;
    (e.aliases || []).forEach(a => { GLOBAL_ALIAS_IDS[a] = GLOBAL_ALIAS_IDS[a] || e.id; });
  });
  Object.keys(PROVIDERS).forEach(eng => {
    const d = MODEL_REGISTRY.find(e => e.engine === eng && e.default);
    if (d) PROVIDERS[eng].model = d.id;
  });
  const BUILTIN_MODELS = {};
  MODEL_REGISTRY.forEach(e => {
    const eng = e.engine === 'any' ? 'custom' : e.engine;
    (BUILTIN_MODELS[eng] = BUILTIN_MODELS[eng] || []).push(e.id);
  });
  const NOTES = MODEL_REGISTRY.filter(e => e.note).map(e => ({ engine: e.engine, model: e.alias, id: e.id, type: e.type || 'generate', note: e.note }));
  const MODEL_CATALOG_PREFIX = 'gw_models_';

  function readModelCatalog(engineId) {
    try {
      const list = JSON.parse(localStorage.getItem(MODEL_CATALOG_PREFIX + engineId) || '[]');
      return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }
  function modelCatalogStatus(engineId) {
    let meta = null;
    try {
      meta = JSON.parse(localStorage.getItem(MODEL_CATALOG_PREFIX + engineId + '_meta') || 'null');
    } catch (error) {}
    const models = readModelCatalog(engineId);
    return {
      count: models.length,
      syncedAt: Number(meta && meta.syncedAt) || 0,
      source: meta && meta.source || '',
      models
    };
  }
  function modelsForEngine(engineId) {
    const seen = new Set();
    return (BUILTIN_MODELS[engineId] || []).concat(readModelCatalog(engineId))
      .map(model => String(model || '').trim())
      .filter(model => {
        const key = model.toLowerCase();
        if (!model || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  async function syncModels(engineId, configOverride) {
    const def = PROVIDERS[engineId];
    if (!def) throw new Error('未知引擎：' + engineId);
    const cfg = Object.assign({}, loadConfigs()[engineId] || {}, configOverride || {});
    if (!cfg.apiKey) throw new Error('请先填写「' + def.label + '」的 API Key');
    const baseURL = String(cfg.baseURL || def.baseURL || '').replace(/\/+$/, '');
    if (!baseURL) throw new Error('请先填写接口地址（Base URL）');
    let lastError = null;
    for (const candidate of urlCandidates(engineId, baseURL)) {
      const endpoint = candidate.replace(/\/+$/, '') + '/models';
      try {
        const response = await fetch(endpoint, {
          headers: { Authorization: 'Bearer ' + cfg.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(30000)
        });
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch (error) {}
        if (!response.ok) {
          const detail = data && (data.error?.message || data.message || data.msg) || text;
          lastError = new Error(def.label + ' 模型目录返回 ' + response.status + '：' + String(detail || '').slice(0, 240));
          if (response.status === 404) continue;
          throw lastError;
        }
        const rows = Array.isArray(data && data.data) ? data.data :
          (Array.isArray(data && data.models) ? data.models : []);
        const models = Array.from(new Set(rows
          .map(item => String(item && (item.id || item.name) || item || '').trim())
          .filter(Boolean)));
        if (!models.length) throw new Error(def.label + ' 模型目录为空');
        const syncedAt = Date.now();
        localStorage.setItem(MODEL_CATALOG_PREFIX + engineId, JSON.stringify(models));
        localStorage.setItem(MODEL_CATALOG_PREFIX + engineId + '_meta', JSON.stringify({
          version: 1,
          syncedAt,
          source: endpoint
        }));
        return { ok: true, count: models.length, models, syncedAt };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(def.label + ' 模型目录同步失败');
  }
  function modelAvailability(engineId, model) {
    const catalog = readModelCatalog(engineId);
    const real = realIdOf(model, engineId);
    if (!real) return { status: 'unset', model: '', message: '请先在右侧生成面板选择模型（引擎页这栏只显示当前模型）' };
    if (!catalog.length) return { status: 'unknown', model: real, message: '尚未同步模型目录' };
    const found = catalog.some(item => String(item).toLowerCase() === String(real).toLowerCase());
    return found
      ? { status: 'available', model: real, message: '模型目录中可用' }
      : { status: 'missing', model: real, message: '当前模型不在最近同步的模型目录中，请同步模型或检查模型名称' };
  }

  function aliasOf(id) {  // 真实ID → 界面友好名
    const raw = String(id || '').trim();
    if (!raw) return '';
    if (raw === 'DALL-E 3') return 'DALL·E 3';
    if (MODEL_ALIASES[raw]) return MODEL_ALIASES[raw];
    const low = raw.toLowerCase();
    for (const [re, name] of MODEL_PATTERNS) if (re.test(low)) return name;
    return raw;  // 未登记模型保留原 ID，避免误改
  }
  function realIdOf(value, engineId) {  // 友好名 → 当前引擎的真实ID
    const raw = String(value || '').trim();
    if (!raw) return '';
    let normalized = raw;
    const tierSuffix = raw.match(/^(.*?)-(1k|1\.5k|2k|4k)$/i);
    if (tierSuffix) {
      const base = tierSuffix[1];
      if (findModelEntry(engineId, base)) normalized = base;
    }
    if (engineId === 'apollo') {
      if (/^gemini-3(?:\.0)?-pro-image/i.test(normalized)) return 'nano-banana-pro';
      if (/^gemini-3\.1-flash-image/i.test(normalized)) return 'nano-banana-2';
    }
    const byEngine = ENGINE_MODEL_IDS[engineId] || {};
    if (byEngine[normalized]) return byEngine[normalized];
    const engineDefault = PROVIDERS[engineId] && PROVIDERS[engineId].model;
    if (MODEL_ALIASES[normalized]) {
      // 已知真实 ID：只允许归属于当前引擎，或 engine=any 的通用模型
      return findModelEntry(engineId, normalized) ? normalized : (engineDefault || normalized);
    }
    if (GLOBAL_ALIAS_IDS[normalized]) {
      const globalId = GLOBAL_ALIAS_IDS[normalized];
      return findModelEntry(engineId, globalId) ? globalId : (engineDefault || globalId);
    }
    return normalized;  // 用户手填的未知真实ID
  }
  function findModelEntry(engineId, model) {
    const real = String(model || '').toLowerCase();
    if (!real) return null;
    let fallback = null;
    for (const e of MODEL_REGISTRY) {
      if (e.engine !== 'any' && e.engine !== engineId) continue;
      if (e.id.toLowerCase() === real) return e;
      if (e.idPattern && e.idPattern.test(real)) {
        if (e.engine === engineId) return e;
        if (!fallback) fallback = e;
      }
    }
    return fallback;
  }
  function isRegisteredModel(engineId, model) {
    return !!findModelEntry(engineId, realIdOf(model, engineId));
  }
  function vendorOf(engineId, model) {
    const entry = findModelEntry(engineId, realIdOf(model, engineId));
    return entry && entry.vendor ? entry.vendor : 'generic';
  }
  function vendorMeta(engineId, model) {
    const id = vendorOf(engineId, model);
    const v = VENDORS[id] || VENDORS.generic;
    return { id, label: v.label, logo: v.logo };
  }
  function validateModelRegistry() {
    const problems = [];
    const ids = new Set();
    const aliasKeys = new Set();
    const knownSizes = new Set(['auto', '1K', '1.5K', '2K', '4K']);
    const knownAspects = new Set(['auto', '1:1', '2:3', '3:4', '4:3', '3:2', '4:5', '5:4', '16:9', '9:16', '2:1', '21:9']);
    MODEL_REGISTRY.forEach(e => {
      if (!e.engine || !e.id || !e.alias) problems.push('缺少 engine/id/alias: ' + e.id);
      const modelKey = e.engine + '|' + e.id;
      if (ids.has(modelKey)) problems.push(e.id + ': 同一引擎内 id 重复');
      ids.add(modelKey);
      if (!Array.isArray(e.sizes) || !e.sizes.length) problems.push(e.id + ': sizes 为空');
      if (!Array.isArray(e.aspects) || !e.aspects.length) problems.push(e.id + ': aspects 为空');
      if (Array.isArray(e.sizes) && !e.sizes.includes('auto')) problems.push(e.id + ': 缺少 auto 尺寸');
      if (Array.isArray(e.aspects) && !e.aspects.includes('auto')) problems.push(e.id + ': 缺少 auto 比例');
      (e.sizes || []).forEach(size => { if (!knownSizes.has(size)) problems.push(e.id + ': 未知尺寸 ' + size); });
      (e.aspects || []).forEach(aspect => { if (!knownAspects.has(aspect)) problems.push(e.id + ': 未知比例 ' + aspect); });
      [e.alias].concat(e.aliases || []).forEach(name => {
        const key = e.engine + '|' + name;
        if (aliasKeys.has(key)) problems.push(key + ': 别名重复');
        aliasKeys.add(key);
      });
      if (e.engine !== 'any' && !PROVIDERS[e.engine]) problems.push(e.id + ': 未知引擎 ' + e.engine);
    });
    Object.keys(PROVIDERS).forEach(engineId => {
      const model = PROVIDERS[engineId].model;
      if (model && !findModelEntry(engineId, realIdOf(model, engineId))) {
        problems.push(engineId + ': 默认模型未登记 ' + model);
      }
    });
    if (problems.length) {
      window.__modelRegistryProblems = problems;
      console.warn('[model-registry]', problems.join(' | '));
    }
  }
  validateModelRegistry();

  // #89 路径自适应：先试原地址，404/网页自动补 /v1 重试，通路记忆
  function urlCandidates(engineId, baseURL) {
    const saved = localStorage.getItem('gw_urlpath_' + engineId) || '';
    const b = (baseURL || '').replace(/\/+$/, '');
    const list = [];
    if (saved) list.push(b + saved);
    if (!/\/(v1|v1beta)$/i.test(b)) list.push(b + '/v1');
    list.push(b);
    return list.filter((v, i, a) => a.indexOf(v) === i);
  }

  function getCapabilities(engineId, model) {
    const entry = findModelEntry(engineId, realIdOf(model || '', engineId));
    if (entry) return { sizes: entry.sizes, aspects: entry.aspects };
    if (engineId === 'runninghub') return CAP_RH_5;
    if (engineId === 'volc') return CAP_VOLC_5;
    if (engineId === 'apollo') return CAP_GEMINI_3_PRO;
    return CAP_GENERIC;
  }
  function inpaintRouteFor(engineId, model) {
    const real = realIdOf(model || '', engineId);
    const entry = findModelEntry(engineId, real);
    if (!real || (entry && entry.type && entry.type !== 'generate')) return 'unsupported';
    if (engineId === 'runninghub') {
      return /seedream|doubao/i.test(real) ? 'reference' : 'unsupported';
    }
    if (/^gpt-image-(1|2)/i.test(real)) return 'mask';
    if (/^dall-e-3/i.test(real)) return 'unsupported';
    return 'reference';
  }
  function getSizes(engineId, model) { return getCapabilities(engineId, model).sizes.slice(); }


  // #96 生图模型过滤：生图槽只留能生图的，LLM 挡门
  // engineId 传 'custom' 时用宽松规则：自接中转的模型名不可预测（step-1x / ideogram / recraft / hidream…），
  // 只排除明显不是生图的模型，带 image 字样的一律保留（避免误杀 chatgpt-image-latest 这类）。
  function filterImageModels(list, engineId) {
    const inc = /image|seedream|seededit|dall-e|flux|banana|imagen|stable-diffusion|sd3|midjourney|paint|pix|qwen-image|wanx|kolors|hunyuan-image|cogview/i;
    const exc = /instruct|embedding|transcrib|tts|vision|chat|o1|o3|glm|llama|deepseek|moonshot-v|layer-decomposition|layer-decompose/i;
    const looseInc = /image|seedream|seededit|dall-e|flux|banana|imagen|stable-diffusion|sd3|sd-|midjourney|paint|pix|wanx|kolors|cogview|step-|ideogram|recraft|hidream|photon|playground|grok-image|sora|dream/i;
    const looseExc = /embedding|transcrib|tts|whisper|audio|speech|rerank|moderation|vision|chat|o1|o3|glm|llama|deepseek|moonshot|instruct|layer-decomp/i;
    const loose = engineId === 'custom';
    return (list || []).filter(m => {
      if (!m) return false;
      if (!loose) return inc.test(m) && !exc.test(m);
      if (!looseInc.test(m)) return false;
      return /image/i.test(m) || !looseExc.test(m);
    });
  }
  function preferredUpscaleEngine(configs) {
    const cfgs = configs || loadConfigs();
    return ['topaz302', 'runninghub'].find(id => cfgs[id] && String(cfgs[id].apiKey || '').trim()) || 'topaz302';
  }
  function visionModelsForEngine(engineId) {
    const result = [];
    const seen = new Set();
    const add = (id, label) => {
      const real = realIdOf(id, engineId);
      if (!real || seen.has(real)) return;
      seen.add(real);
      result.push({ id: real, alias: label || aliasOf(real) });
    };
    const cfg = loadConfigs()[engineId] || {};
    MODEL_REGISTRY
      .filter(entry => entry.engine === engineId && entry.type === 'vision')
      .forEach(entry => add(entry.id, entry.alias));
    readModelCatalog(engineId)
      .filter(id => /gpt-[45]|gemini|claude|qwen.*vl|vision/i.test(id) && !/image|seedream|banana|embedding/i.test(id))
      .forEach(id => add(id));
    if (engineId === 'apollo') {
      add(cfg.visionModel || PROVIDERS.apollo.visionModel);
    } else if (engineId === 'openai') {
      add(cfg.model || PROVIDERS.openai.model);
    } else if (engineId === 'deepseek') {
      add(cfg.visionModel || PROVIDERS.deepseek.visionModel);
    }
    return result;
  }

  // 下拉框按友好名去重：同一个大众名只保留当前选中的真实 ID，避免出现两个同名字选项。
  function dedupeModels(list, engineId, preferred) {
    const out = [];
    const seen = new Set();
    const pref = realIdOf(preferred || '', engineId);
    if (pref) { out.push(pref); seen.add(aliasOf(pref)); }
    (list || []).forEach(item => {
      const real = realIdOf(item, engineId);
      const label = aliasOf(real);
      if (!real || seen.has(label)) return;
      seen.add(label);
      out.push(real);
    });
    return out;
  }


  function getAspects(engineId, model) { return getCapabilities(engineId, model).aspects.slice(); }

  function promptFlavorForModel(engineId, model) {
    try {
      if (window.GWModelTuning && window.GWModelTuning.promptFlavorFor) {
        return window.GWModelTuning.promptFlavorFor(engineId, model);
      }
    } catch (error) {}
    const name = String(model || '').toLowerCase();
    if (/doubao|seedream/.test(name)) return 'keyword';
    if (/nano-banana|gemini/.test(name)) return 'natural';
    if (/gpt-image/.test(name)) return 'structured';
    if (/flux|stable-diffusion|sdxl/.test(name)) return 'concise';
    return 'structured';
  }

  function composePromptSections(engineId, model, task, sections) {
    const flavor = promptFlavorForModel(engineId, model);
    let list = (sections || [])
      .map(section => ({
        title: String(section && section.title || '').trim(),
        value: String(section && section.value || '').trim().replace(/[。；]+$/, ''),
        priority: Number(section && section.priority) || 0
      }))
      .filter(section => section.value);
    if (flavor === 'keyword' || flavor === 'concise') {
      list = list.slice().sort((a, b) => b.priority - a.priority);
    }
    if (!list.length) return '';
    if (flavor === 'concise') return list.map(section => section.value).join('；') + '。';
    if (flavor === 'keyword') {
      return list.map(section => (section.title ? '【' + section.title + '】' : '') + section.value + '；').join('\n');
    }
    if (flavor === 'structured') {
      return list.map(section => (section.title ? '【' + section.title + '】\n' : '') + section.value).join('\n');
    }
    return list.map(section => (section.title ? section.title + '：' : '') + section.value + '。').join('\n');
  }

  function weatherPromptRule(weather, styleReferenceFirst) {
    const prefix = styleReferenceFirst
      ? '天气指定（仅调整窗外天气、自然光色温和空气氛围，不覆盖参考图确定的室内材质、主色和主光）'
      : '天气氛围';
    const rules = {
      '阴天': '阴天柔和漫射光，低反差，室内保持干燥且不引入雨雪。',
      '雨天': '阴雨天气形成冷灰天空和柔和漫射天光；不表现雨滴、水珠、雨丝、水幕、积水或湿面。室外可见景象严格服从用户外景参考；全部室内区域必须干燥，玻璃隔断也不得出现水珠、水痕或湿反光。天气只改变自然光色温、照度、柔和阴影和环境反射。',
      '雪天': '窗外为积雪景象和清冽自然光；全部室内区域保持干燥，玻璃和室内表面不得出现积雪、飘雪、水珠或融水。',
      '黄昏': '黄昏低角度暖光，仅改变窗外景象、自然光色温和室内环境反射，不改变建筑结构。',
      '夜晚': '夜间低照度环境，仅改变窗外景象、自然光比例和室内环境反射，不增加天气粒子。'
    };
    return prefix + '：' + weather + '；' + String(rules[weather] || weather).replace(/[。；]+$/, '') + '。';
  }

  function renderWeatherPrompt(engineId, model, weather, styleReferenceFirst) {
    if (!weather || weather === '晴天') return '';
    return composePromptSections(engineId, model, 'weather', [{
      title: styleReferenceFirst ? '天气边界' : '天气氛围',
      value: weatherPromptRule(weather, styleReferenceFirst),
      priority: 90
    }]);
  }

  const LIGHT_FIXTURE_GROUPS = Object.freeze([
    { id: 'ceiling', label: '顶面照明', prompt: '筒灯、射灯和吸顶灯' },
    { id: 'cove', label: '灯带灯槽', prompt: '天花灯带、柜底灯和洗墙灯' },
    { id: 'decor', label: '装饰灯', prompt: '落地灯、台灯和壁灯' }
  ]);

  function normalizeLightState(config) {
    const light = Object.assign({}, config || {});
    const mode = ['auto', 'on', 'off'].includes(light.lightingMode) ? light.lightingMode : 'auto';
    const allowed = new Set(LIGHT_FIXTURE_GROUPS.map(item => item.id));
    let groups = Array.isArray(light.lightingGroups)
      ? light.lightingGroups.filter(id => allowed.has(id))
      : LIGHT_FIXTURE_GROUPS.map(item => item.id);
    if (!groups.length) groups = LIGHT_FIXTURE_GROUPS.map(item => item.id);
    return { light, mode, groups };
  }

  function renderLightPrompt(engineId, model, config, options = {}) {
    if (!config) return '';
    const state = normalizeLightState(config);
    const light = state.light;
    const included = LIGHT_FIXTURE_GROUPS.filter(item => state.groups.includes(item.id));
    const excluded = LIGHT_FIXTURE_GROUPS.filter(item => !state.groups.includes(item.id));
    const lightState = state.mode === 'off'
      ? '所有人工照明关闭；结构图中已有的灯具实体、数量和位置全部保留，但不得发光、投射光斑、形成灯带辉光或家具底部溢光。室内只保留窗边自然光和少量环境反射，并保持空间细节可辨识。'
      : state.mode === 'on'
        ? '人工照明开启，只点亮' + included.map(item => item.prompt).join('、') + '；' +
          (excluded.length ? excluded.map(item => item.prompt).join('、') + '保持关闭且不产生光照。' : '不得新增灯具或改变灯具位置。')
        : '人工照明状态与原图及当前时段自然匹配；原图已明确开启的灯具保持开启，原图未明确的灯具按场景需要适度补光。不得新增、删除、移动或重塑任何灯具。';
    const sections = [];
    if (options.includeWeather !== false) {
      sections.push({
        title: '天气与自然光',
        value: weatherPromptRule(light.weather || '晴天', false),
        priority: 100
      });
    }
    sections.push({
      title: '自然采光',
      value: (light.name || '自然日光') + '，色温约' + (light.temperature || 5600) + 'K，整体照度' +
        (light.intensity == null ? 65 : light.intensity) + '%，阴影柔度' + (light.softness == null ? 55 : light.softness) +
        '%，主光方向为' + (light.direction || '窗侧主光') + '。',
      priority: 70
    });
    sections.push({
      title: '人工灯光',
      value: lightState + '不同机位必须保持同一灯光开关状态、色温、明暗层次和材质反射。',
      priority: 110
    });
    if (light.exterior && light.exterior.src) {
      sections.push({
        title: '窗外外景',
        value: '严格参考用户提供的外景图替换窗洞外部视野。' +
          (light.exteriorAffectLight === false
            ? '不改变室内自然光、人工灯、阴影和环境反射。'
            : '外景色温、明暗和环境色只影响窗边自然光、室内阴影和环境反射。') +
          '不得改变门窗、梁柱、吊顶、灯槽、家具位置、灯具参数或相机角度。',
        priority: 95
      });
    } else if (light.exteriorPrompt) {
      sections.push({
        title: '窗外外景',
        value: light.exteriorPrompt + '只替换窗外视野，不改变室内结构、灯具和相机角度。',
        priority: 80
      });
    }
    if (light.note) {
      sections.push({ title: '补充要求', value: light.note, priority: 120 });
    }
    return composePromptSections(engineId, model, 'light', sections);
  }

  // 画幅词表：doubao 分支与 sections 分支共用，避免两处描述不一致
  const ASPECT_WORDS = Object.freeze({
    '1:1': '正方形 1:1 画幅', '4:3': '4:3 横幅画幅', '3:2': '3:2 横幅画幅',
    '16:9': '16:9 宽银幕横幅画幅', '9:16': '9:16 竖幅画幅', '2:1': '2:1 超宽全景画幅',
    '2:3': '2:3 竖幅画幅', '3:4': '3:4 竖幅画幅', '4:5': '4:5 竖幅画幅',
    '5:4': '5:4 横幅画幅', '21:9': '21:9 超宽全景画幅'
  });

  function aspectPhrase(aspect) {
    if (!aspect || aspect === 'auto') return '';
    return '输出' + (ASPECT_WORDS[aspect] || aspect) + '，按此宽高比构图';
  }

  // 结构锁定强度 → 各口味共用的四档表述（doubao 分支此前只有一句固定话术，滑块无效）
  function structureLockLevel(strength, structureLocked) {
    if (strength >= 0.95 || (structureLocked && strength >= 0.85)) return 'absolute';
    if (strength >= 0.85) return 'strict';
    if (strength >= 0.4) return 'basic';
    return 'free';
  }

  // 提示词渲染：配方（结构化）→ 目标模型口味的自然提示词
  function renderPrompt(engineId, recipe) {
    const cfg = loadConfigs()[engineId] || {};
    const def = PROVIDERS[engineId] || PROVIDERS.apollo;
    const model = recipe.model || cfg.model || def.model || '';
    const flavor = promptFlavorForModel(engineId, model);
    const tpl = cfg.template || (flavor === 'keyword' ? 'doubao' : def.template);
    const style = recipe.styleName;
    const blocks = (recipe.blocks || []).filter(b => b.on);
    const cons = (recipe.constraint || '').trim();
    const strength = recipe.strength != null ? recipe.strength : 0.7;
    const styleReferenceFirst = !!recipe.styleReferenceFirst;
    const materialTakeover = styleReferenceFirst && recipe.referenceMode !== 'atmosphere';
    const lockLevel = structureLockLevel(strength, recipe.structureLocked);

    if (tpl === 'doubao') {
      // 豆包口味：关键词结构化、参考图模式保真
      const base = recipe.structureLocked ? '图1' : '参考图';
      const p = styleReferenceFirst
        ? (materialTakeover
          ? [
              '以图1为唯一空间结构、相机角度、物理造型、天花吊顶和灯槽位置基准',
              '以用户外观参考图（图2；若为横向拼图则为右半）为唯一外观依据，匹配其材质、颜色、纹理、灯光和软装表面气质',
              '不启用方案预设，不引入预设材质、配色、软装或默认场景描述；参考图没有定义的部分保持图1原有内容或做自然补全'
            ]
          : [
              '以图1为唯一空间结构、相机角度、物理造型、天花吊顶和灯槽位置基准',
              '图2只提供光影、色温、曝光、对比、环境色和空气氛围',
              '保留图1的材质种类、纹理和表面颜色，不得通过更换材质来模拟参考图光照；不启用方案预设'
            ])
        : [`将${base}转换为${style}风格的写实室内效果图`];
      const active = blocks.filter(b => b.key !== 'weather');
      if (recipe.weather && recipe.weather !== '晴天') {
        p.push(weatherPromptRule(recipe.weather, styleReferenceFirst).replace(/。$/, ''));
      }
      if (!styleReferenceFirst && active.length) p.push(active.map(b => b.value).join('，'));
      if (cons) p.push('保留：' + cons);
      if (lockLevel === 'absolute') {
        p.push(`${base}的户型结构、墙体位置、相机角度、所有物体的形状尺寸与位置完全不得改变，不得添加删除或移动任何物体，仅优化材质质感光影与色彩`);
      } else if (lockLevel === 'strict') {
        p.push(`严格保持${base}的户型结构、墙体位置、相机角度和所有物体完全不变，仅调整材质软装与配色，绝对不得添加删除或移动任何物体`);
      } else if (lockLevel === 'basic') {
        p.push(`保持${base}的基本构图、空间结构与视角不变，重点改造氛围软装材质与光影表现`);
      } else {
        p.push(`可以大胆改造空间氛围与装饰风格，仅保留${base}的基本构图关系`);
      }
      if (recipe.structureLocked) p.push('图2和材质参考图只提供材质、颜色与光影，不得改变图1构图');
      if (styleReferenceFirst) p.push('预设方案、天气和色板不得覆盖用户外观参考图中已经明确表达的材质、颜色、纹理和灯光关系');
      if (recipe.aspect && recipe.aspect !== 'auto') p.push(aspectPhrase(recipe.aspect));
      p.push('写实室内摄影，材质真实细腻，光影层次丰富');
      return p.join('，');
    }

    // Banana / GPT / Flux 共用语义段，由模型适配层决定最终组织方式。
    const sections = [];
    const base = recipe.structureLocked ? '图1' : '参考图';
    if (recipe.structureLocked) {
      sections.push({
        title: '结构基准',
        value: '以图1为唯一空间结构、透视关系和相机角度基准，输出与图1同一机位的写实效果图',
        priority: 130
      });
    }
    if (styleReferenceFirst) {
      if (materialTakeover) {
        sections.push({
          title: '外观参考',
          value: '以图2（若输入为横向拼图则取右半）作为用户指定的唯一外观依据，匹配其中的材质、颜色、纹理、灯光氛围和软装表面气质',
          priority: 125
        });
        sections.push({
          title: '参考图边界',
          value: '不启用方案预设，不引入预设材质、配色、软装或默认场景描述；参考图没有定义的部分保持图1原有内容或做自然补全',
          priority: 115
        });
      } else {
        sections.push({
          title: '氛围参考',
          value: '以图2（若输入为横向拼图则取右半）只迁移光影、色温、曝光、对比和环境色；保留图1的材质种类、纹理和表面颜色',
          priority: 120
        });
        sections.push({
          title: '材质边界',
          value: '不得用更换材质或表面颜色的方式模拟参考图光照；不启用方案预设',
          priority: 125
        });
      }
    } else {
      sections.push({
        title: '生成任务',
        value: `将${base}改造为${style}风格的室内空间，输出写实摄影级效果图`,
        priority: 80
      });
    }
    if (recipe.weather && recipe.weather !== '晴天') {
      sections.push({
        title: '天气',
        value: weatherPromptRule(recipe.weather, styleReferenceFirst),
        priority: 110
      });
    }
    const desc = blocks.map(b => `${b.name}：${b.value}`).join('；');
    if (!styleReferenceFirst && desc) {
      sections.push({ title: '场景与氛围', value: desc, priority: 70 });
    }
    if (cons) {
      sections.push({ title: '硬装约束（必须保留）', value: cons, priority: 140 });
    }
    if (lockLevel === 'absolute') {
      sections.push({
        title: '绝对锁定',
        value: `${base}的户型结构、墙体位置、相机角度、所有物体的形状、尺寸与位置完全不得改变；不得添加、删除或移动任何物体；仅优化材质质感、光影与色彩。${recipe.structureLocked ? '图2与材质参考图只提供表面信息，不得改变图1的构图。' : ''}`,
        priority: 160
      });
    } else if (lockLevel === 'strict') {
      sections.push({
        title: '结构保持',
        value: `严格保持${base}的户型结构、墙体位置、相机角度和所有物体完全不变，仅调整材质、软装与配色；绝对不得添加、删除或移动任何物体`,
        priority: 150
      });
    } else if (lockLevel === 'basic') {
      sections.push({
        title: '结构保持',
        value: `保持${base}的基本构图、空间结构与视角不变，重点改造氛围、软装、材质与光影表现`,
        priority: 140
      });
    } else {
      sections.push({
        title: '改造范围',
        value: '可以大胆改造空间氛围与装饰风格，仅保留原图的基本构图关系',
        priority: 100
      });
    }
    if (recipe.aspect && recipe.aspect !== 'auto') {
      sections.push({
        title: '画幅',
        value: aspectPhrase(recipe.aspect),
        priority: 40
      });
    }
    sections.push({
      title: '画面要求',
      value: '写实室内摄影质感，光影柔和有层次，材质细节丰富，色彩过渡自然，无渲染感',
      priority: 20
    });
    return composePromptSections(engineId, model, 'render', sections);
  }

  function readImageSize(dataURL) {
    return new Promise(resolve => {
      dataURL = normalizeImageDataURL(dataURL);
      if (!dataURL || !/^data:image\//.test(dataURL)) return resolve(null);
      const byHeader = imageSizeFromDataURLHeader(dataURL);
      if (byHeader && byHeader.w > 0 && byHeader.h > 0) return resolve(byHeader);
      const comma = dataURL.indexOf(',');
      if (comma < 0) return resolve(null);
      const b64 = normalizeBase64(dataURL.slice(comma + 1));
      const img = new Image();
      let settled = false;
      const finish = size => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(size);
      };
      const timeout = setTimeout(() => finish(null), 8000);
      img.onload = () => finish({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
      img.onerror = () => finish(null);
      img.src = dataURL.slice(0, comma + 1) + b64;
    });
  }
  function closestAspect(target, aspects) {
    let best = 'auto', bestDiff = Infinity;
    (aspects || []).forEach(a => {
      if (a === 'auto') return;
      const [w, h] = a.split(':').map(Number);
      if (!w || !h) return;
      const diff = Math.abs(Math.log((w / h) / target));
      if (diff < bestDiff) { bestDiff = diff; best = a; }
    });
    return best;
  }
  function aspectValue(a) {
    const [w, h] = String(a || '').split(':').map(Number);
    return w && h ? w / h : 0;
  }
  function closestSizeTier(w, h, sizes) {
    const px = { '1K': 1024, '1.5K': 1536, '2K': 2048, '4K': 4096 };
    const tiers = (sizes || []).filter(s => px[s]).sort((a, b) => px[a] - px[b]);
    if (!tiers.length) return 'auto';
    const long = Math.max(w || 0, h || 0);
    const fit = tiers.filter(s => px[s] <= long);
    return fit.length ? fit[fit.length - 1] : tiers[0];
  }
  function normalizeBase64(value) {
    let b64 = String(value || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return b64;
  }
  function imageMimeFromBase64(b64) {
    let bytes;
    try { bytes = Buffer.from(String(b64 || '').slice(0, 48), 'base64'); } catch (error) { return ''; }
    if (!bytes || bytes.length < 4) return '';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
    if (bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (bytes.slice(0, 2).toString('ascii') === 'BM') return 'image/bmp';
    const brand = bytes.slice(4, 12).toString('ascii').toLowerCase();
    if (brand.startsWith('ftypavif') || brand.startsWith('ftypavis')) return 'image/avif';
    if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) return 'image/heic';
    return '';
  }
  function normalizeImageDataURL(raw) {
    let value = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
    if (!value) return '';
    const lastData = value.lastIndexOf('data:image/');
    if (lastData > 0) value = value.slice(lastData);
    if (/^https?:\/\//i.test(value)) return value;
    if (/^data:image\//i.test(value)) {
      const comma = value.indexOf(',');
      if (comma < 0) return value;
      const b64 = normalizeBase64(value.slice(comma + 1));
      const actualMime = imageMimeFromBase64(b64);
      return 'data:' + (actualMime || value.slice(5, comma).split(';')[0] || 'image/png') + ';base64,' + b64;
    }
    const b64 = normalizeBase64(value);
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return value;
    const mime = imageMimeFromBase64(b64);
    return mime ? 'data:' + mime + ';base64,' + b64 : value;
  }
  function imageDataURLSignatureValid(dataURL) {
    const value = normalizeImageDataURL(dataURL);
    if (!/^data:image\//i.test(value)) return false;
    const comma = value.indexOf(',');
    if (comma < 0) return false;
    return !!imageMimeFromBase64(value.slice(comma + 1));
  }
  function imageSizeFromDataURLHeader(dataURL) {
    const value = normalizeImageDataURL(dataURL);
    if (!/^data:image\//i.test(value)) return null;
    const comma = value.indexOf(',');
    if (comma < 0) return null;
    const b64 = normalizeBase64(value.slice(comma + 1));
    const headChars = Math.floor(Math.min(b64.length, 350000) / 4) * 4;
    let bytes;
    try { bytes = Buffer.from(b64.slice(0, headChars), 'base64'); } catch (error) { return null; }
    if (!bytes || bytes.length < 10) return null;
    try {
      if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
        return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
      }
      if (bytes.slice(0, 4).toString('ascii') === 'GIF8') {
        return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
      }
      if (bytes.slice(0, 2).toString('ascii') === 'BM' && bytes.length >= 26) {
        return { w: Math.abs(bytes.readInt32LE(18)), h: Math.abs(bytes.readInt32LE(22)) };
      }
      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        let offset = 2;
        while (offset + 8 < bytes.length) {
          if (bytes[offset] !== 0xff) { offset++; continue; }
          while (offset < bytes.length && bytes[offset] === 0xff) offset++;
          const marker = bytes[offset++];
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
          if (offset + 2 > bytes.length) break;
          const length = bytes.readUInt16BE(offset);
          if (length < 2 || offset + length > bytes.length) break;
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            if (offset + 7 > bytes.length) break;
            return { w: bytes.readUInt16BE(offset + 5), h: bytes.readUInt16BE(offset + 3) };
          }
          offset += length;
        }
      }
      if (bytes.length >= 30 && bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP') {
        const kind = bytes.slice(12, 16).toString('ascii');
        if (kind === 'VP8X') return { w: 1 + bytes.readUIntLE(24, 3), h: 1 + bytes.readUIntLE(27, 3) };
        if (kind === 'VP8 ') return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
        if (kind === 'VP8L' && bytes.length >= 25) {
          const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
          return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
        }
      }
    } catch (error) {}
    return null;
  }

  const SEEDREAM_PIXEL_SIZES = {
    '1K': {
      '1:1': '1024x1024', '16:9': '1376x768', '9:16': '768x1376',
      '4:3': '1152x864', '3:2': '1248x832', '2:3': '832x1248',
      '2:1': '1440x720', '21:9': '1600x688'
    },
    '1.5K': {
      '1:1': '1536x1536', '16:9': '2048x1152', '9:16': '1152x2048',
      '4:3': '1728x1296', '3:2': '1872x1248', '2:3': '1248x1872',
      '2:1': '2160x1080', '21:9': '2400x1024'
    },
    '2K': {
      '1:1': '2048x2048', '16:9': '2752x1536', '9:16': '1536x2752',
      '4:3': '2304x1728', '3:2': '2496x1664', '2:3': '1664x2496',
      '2:1': '2880x1440', '21:9': '3200x1376'
    },
    '4K': {
      '1:1': '4096x4096', '16:9': '5464x3072', '9:16': '3072x5464',
      '4:3': '4608x3456', '3:2': '4992x3328', '2:3': '3328x4992',
      '2:1': '5760x2880', '21:9': '6400x2752'
    }
  };
  function seedreamRequestSize(size, aspect) {
    const tier = SEEDREAM_PIXEL_SIZES[String(size || '').toUpperCase()];
    if (!tier) return '';
    return tier[aspect && aspect !== 'auto' ? aspect : '1:1'] || tier['1:1'];
  }
  function seedreamResolutionGate(size, measured) {
    const minimum = {
      '1K': { long: 1024, short: 576 },
      '1.5K': { long: 1536, short: 864 },
      '2K': { long: 2048, short: 1024 },
      '4K': { long: 3840, short: 2160 }
    }[String(size || '').toUpperCase()];
    if (!minimum || !measured || !measured.w || !measured.h) return true;
    return Math.max(measured.w, measured.h) >= minimum.long &&
      Math.min(measured.w, measured.h) >= minimum.short;
  }

  // 统一调用：#111 图像路由自动探测（images/generations ↔ chat 多模态）+ #89 路径自适应
  // ---------- quota-router（2026-10-29）：阿波罗算力通道自动扣积分 ----------
  // 规则：engineId==='apollo'（我们发的算力 Key）成功出图后扣积分；失败不扣。
  // 其它引擎 = 客户自有 API，不扣。消耗顺序（订阅月积分→加油包）由 main.js spendPoints 保证。
  // 倍率与 apilio 实付严格对齐：seedream 1K/1.5K ¥0.27=1分，2K ¥0.54=2分，nano-banana ¥0.20 暂定 1 分。
  function quotaCostFor(model, size) {
    const m = String(model || '');
    if (/nano-banana/i.test(m)) return 1;
    if (/seedream|doubao/i.test(m)) return String(size || '').toUpperCase() === '2K' ? 2 : 1;
    return 1;
  }
  function apolloIpc() {
    try { if (window.require) return window.require('electron').ipcRenderer; } catch (_) {}
    return null;
  }
  async function quotaPrecheck(engineId, model, size) {
    if (engineId !== 'apollo') return;
    const ipc = apolloIpc(); if (!ipc) return;
    const cost = quotaCostFor(model, size);
    let res = null;
    try { res = await ipc.invoke('points:quotaCheck', { points: cost }); } catch (_) { return; } // 状态读不到不拦生成
    if (res && res.ok && res.enough === false) {
      throw new Error('积分余额不足：本次出图需要 ' + cost + ' 积分，当前余额 ' + res.balance +
        '。请到「订阅与授权」兑换积分码充值，或在引擎设置里改用自己的 API Key（自有 API 不扣积分）。');
    }
  }
  async function quotaSpendOnSuccess(engineId, model, size) {
    if (engineId !== 'apollo') return;
    await quotaSpendExplicit(engineId, quotaCostFor(model, size), model + '@' + String(size || 'auto'), 'generate');
  }
  // 显式积分变体：图层拆分按拆出层数计费——与“1 积分 = 1 张图”口径一致（1K 每层 1 分、2K 每层 2 分，上限 13 层与画布一致）。
  // ⚠ apilio 该模型同时有 按次价(model_price 0.9) 与 按张倍率(0.27/0.54) 两组字段；生成模型已被证实按张计费，
  // 分解模型建议用一次真实调用对照 apilio 消费日志核实：若确认按次打包，改回固定 4 分/次即可。
  const DECOMPOSE_CAP = 13;
  async function quotaPrecheckPoints(engineId, cost) {
    if (engineId !== 'apollo') return;
    const ipc = apolloIpc(); if (!ipc) return;
    let res = null;
    try { res = await ipc.invoke('points:quotaCheck', { points: cost }); } catch (_) { return; } // 状态读不到不拦生成
    if (res && res.ok && res.enough === false) {
      throw new Error('积分余额不足：图层拆分按拆出层数扣分（2K 每层 2 分），至少需要 ' + cost + ' 积分，当前余额 ' + res.balance +
        '。请到「订阅与授权」兑换积分码充值，或改用自己的火山引擎 Key（自有 API 不扣积分）。');
    }
  }
  async function quotaSpendExplicit(engineId, points, model, kind) {
    if (engineId !== 'apollo' || !(points > 0)) return;
    const ipc = apolloIpc(); if (!ipc) return;
    try {
      await ipc.invoke('points:spend', {
        taskId: (kind || 'gen') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
        points,
        kind: kind || 'generate',
        model: String(model || '')
      });
    } catch (e) { console.warn('[quota] 积分扣减失败（不影响本次出图）:', e && e.message); }
  }

  async function generate(engineId, { prompt, imageDataURL, styleReferenceDataURL, composedReferenceDataURL, materialReferenceDataURL, exteriorReferenceDataURL, additionalReferenceDataURLs, planReferenceDataURLs, maskDataURL, inpaintOverlayDataURL, size, aspect, model: requestedModel, sourceSize, signal, planMode }) {
    const def = PROVIDERS[engineId];
    const cfg = loadConfigs()[engineId] || {};
    if (!cfg.apiKey) throw new Error('请先在 设置 → 引擎 里填写「' + def.label + '」的 API Key');
    const baseURL = cfg.baseURL || def.baseURL || '';
    if (!baseURL) throw new Error('请先在 设置 → 引擎 里填写接口地址（Base URL）');
    let model = realIdOf(requestedModel || cfg.model || def.model, engineId);  // 友好名 → 当前引擎真实ID
    if (!model) throw new Error(engineId === 'custom'
      ? '还没有选模型：先去右侧生成面板的「模型」里挑一个（自定义引擎的模型在那边切换，设置页这栏只显示）'
      : '还没有选模型：请先在右侧生成面板的「模型」里挑一个');
    const availability = modelAvailability(engineId, model);
    if (availability.status === 'missing') throw new Error(availability.message);
    const caps = getCapabilities(engineId, model);
    let refSize = null;
    if (imageDataURL) {
      refSize = (sourceSize && sourceSize.w && sourceSize.h) ? sourceSize : await readImageSize(imageDataURL);
    }
    const effectiveAspect = (aspect && aspect !== 'auto') ? aspect : (refSize ? closestAspect(refSize.w / refSize.h, caps.aspects) : 'auto');
    const effectiveSize = (size && size !== 'auto') ? size : (refSize ? closestSizeTier(refSize.w, refSize.h, caps.sizes) : 'auto');
    if (engineId === 'apollo' && /^nano-banana-(pro|2)$/.test(model)) {
      if (effectiveSize === '4K') model += '-4k';
      else if (effectiveSize === '2K') model += '-2k';
    }
    await quotaPrecheck(engineId, model, effectiveSize); // 阿波罗通道：余额不足提前拦截，不白跑上游
    const inpaintRoute = inpaintRouteFor(engineId, model);
    if (inpaintRoute === 'unsupported' && (maskDataURL || inpaintOverlayDataURL)) {
      throw new Error('当前模型不支持局部重绘。请改用 GPT Image 系列，或支持参考图编辑的 NanoBanana / 豆包 Seedream 模型。');
    }
    if (imageDataURL) {
      window.__logBoot && window.__logBoot('[image] 跟随原图 → 参考 ' + (refSize ? refSize.w + '×' + refSize.h : '未知') + ' · 比例 ' + effectiveAspect + ' · 尺寸 ' + effectiveSize);
    }
    if (engineId === 'runninghub' && maskDataURL) {
      throw new Error('RunningHub 当前生图通道不支持遮罩重绘。请改用支持 images/edits + mask 的 OpenAI 兼容模型（如 GPT Image）。');
    }
    if (engineId === 'runninghub') {
      if (!window.require) throw new Error('当前应用无法启动 RunningHub 官方模型接口');
      const { ipcRenderer } = window.require('electron');
      const runtimeImage = inpaintRoute === 'reference' && inpaintOverlayDataURL ? inpaintOverlayDataURL : imageDataURL;
      return ipcRenderer.invoke('runninghub:generate', { baseURL, apiKey: cfg.apiKey, prompt, imageDataURL: runtimeImage, size: effectiveSize, aspect: effectiveAspect });
    }    // #132-2 模型类型检查：仅拦截明确标注为 vision 的模型（如纯 LLM）
    const note = NOTES.find(n => n.id === model);
    if (note && note.type === 'vision') {
      throw new Error('「' + (MODEL_ALIASES[model] || model) + '」是识图模型，不支持生成图片。请换用「豆包 Seedream」或「GPT Image」系列。');
    }
    // 有参考图时必须走“带图”的通道；禁止回退到无参考图的纯文生图，否则结果会和原图完全无关。
    const hasRef = !!imageDataURL;
    const extraRefs = (additionalReferenceDataURLs || []).filter(ref => typeof ref === 'string' && ref);
    const hasExtraRefs = extraRefs.length > 0;
    const planRefs = (planReferenceDataURLs || []).filter(ref => typeof ref === 'string' && ref);
    const hasPlanRefs = planRefs.length > 0;
    const hasMask = !!maskDataURL && inpaintRoute === 'mask';
    const hasInpaintOverlay = !!inpaintOverlayDataURL;
    const hasStyleRef = !!styleReferenceDataURL;
    const separatePlanStyleRef = !!(planMode && hasStyleRef && imageDataURL);
    const hasMaterialRef = !!materialReferenceDataURL;
    const hasExteriorRef = !!exteriorReferenceDataURL;
    const isSeedreamModel = /seedream|doubao/i.test(model);
    const singleRef = hasStyleRef && !separatePlanStyleRef
      ? (composedReferenceDataURL || imageDataURL)
      : imageDataURL;
    const inpaintRefRoutes = /nano-banana/.test(model)
      ? ['edits-multi', 'chat', 'edits', 'edits-plain']
      : ['chat', 'edits-multi', 'edits', 'edits-plain'];
    const refRoutes = hasInpaintOverlay
      ? (isSeedreamModel
        ? ['edits-multi', 'edits', 'chat', 'edits-plain']
        : inpaintRefRoutes)
      : (hasStyleRef
        ? (isSeedreamModel
          ? ['edits-multi', 'edits', 'chat', 'edits-plain', 'images-ref', 'images-ref-b64']
          : (/nano-banana/.test(model)
            ? ['edits-multi', 'edits', 'chat', 'edits-plain', 'images-ref', 'images-ref-b64']
            : ['chat', 'edits-multi', 'edits', 'edits-plain', 'images-ref', 'images-ref-b64']))
        : (isSeedreamModel
          ? ['edits', 'edits-plain', 'chat', 'images-ref', 'images-ref-b64']
          : (/nano-banana/.test(model)
            ? ['edits', 'edits-plain', 'chat', 'images-ref', 'images-ref-b64']
            : ['chat', 'edits', 'edits-plain', 'images-ref', 'images-ref-b64'])));
    const textRoutes = ['images', 'chat'];
    const preferredRoute = localStorage.getItem('gw_route_' + engineId);
    const defaultRoutes = hasMask ? ['edits'] : (hasInpaintOverlay ? inpaintRefRoutes : (hasRef ? refRoutes : textRoutes));
    // 记住的只是优先顺序；首选通道只回文字时仍要继续试另一条通道。
    // 有独立风格图时优先尝试真正的多图编辑，避免历史记住的单图通道抢先执行。
    const routes = (hasExtraRefs || hasPlanRefs || hasExteriorRef || hasMaterialRef)
      ? ['edits-multi', 'chat', 'images-ref', 'images-ref-b64', 'edits', 'edits-plain']
      : isSeedreamModel
      ? (hasInpaintOverlay
        ? ['edits-multi', 'edits', 'chat', 'edits-plain']
        : hasStyleRef && defaultRoutes.includes('edits-multi')
        ? ['edits-multi', 'edits', 'chat', 'edits-plain', 'images-ref', 'images-ref-b64']
        : ['edits', 'edits-plain', 'chat', 'images-ref', 'images-ref-b64'])
      : (hasStyleRef && defaultRoutes.includes('edits-multi'))
      ? ['edits-multi', ...defaultRoutes.filter(r => r !== 'edits-multi')]
      : (preferredRoute && defaultRoutes.includes(preferredRoute)
        ? [preferredRoute, ...defaultRoutes.filter(r => r !== preferredRoute)]
        : defaultRoutes);

    // #170 将 size + aspect 转换为 API 能理解的 WxH 像素尺寸
    // #171 模型适配：Gemini / 豆包 不支持 OpenAI 非正方尺寸，比例已写入 prompt
    function resolveImageSize(sz, asp, mdl) {
      const isGemini = /gemini/.test(mdl || '');
      const isDoubao = /seedream|doubao/.test(mdl || '');
      const isGpt = /^gpt-image/.test(mdl || '');
      const isDalle = /^dall-e-3/.test(mdl || '');
      if (isGemini) {
        if ((!sz || sz === 'auto') && (!asp || asp === 'auto')) return null;
        return '1024x1024';  // Gemini 的比例靠 aspect_ratio 控制
      }
      if (isDoubao) {
        return seedreamRequestSize(sz, asp) || null;
      }
      if (isGpt) {
        if (asp === '1:1') return '1024x1024';
        if (['2:3', '3:4', '4:5', '9:16'].includes(asp)) return '1024x1536';
        if (['3:2', '4:3', '5:4', '16:9', '2:1', '21:9'].includes(asp)) return '1536x1024';
        if (sz === '2K') return '1536x1024';
        return '1024x1024';
      }
      if (isDalle) {
        if (asp === '1:1') return '1024x1024';
        if (['2:3', '3:4', '4:5', '9:16'].includes(asp)) return '1024x1792';
        if (['3:2', '4:3', '5:4', '16:9', '2:1', '21:9'].includes(asp)) return '1792x1024';
        if (sz === '2K') return '1792x1024';
        return '1024x1024';
      }
      const aspectMap = {
        '1:1':  '1024x1024',
        '16:9': '1792x1024',
        '9:16': '1024x1792',
        '4:3':  '1024x1024',
        '3:2':  '1024x1024',
        '2:1':  '1792x1024',
        '2:3':  '1024x1536',
        '3:4':  '1024x1536',
        '4:5':  '1024x1536',
        '5:4':  '1536x1024',
        '21:9': '1792x1024',
      };
      if (asp && asp !== 'auto') return aspectMap[asp] || '1024x1024';
      if (sz === '1K' || sz === 'auto') return '1024x1024';
      if (sz === '2K') return '1024x1024';
      if (sz === '4K') return '1024x1024';
      if (sz === '1.5K') return '1024x1024';
      return sz;
    }

    const resolvedSize = resolveImageSize(effectiveSize, effectiveAspect, model);
    const isGeminiModel = /gemini/.test(model);
    const isDoubaoModel = /seedream|doubao/.test(model);
    const isNanoBananaModel = /nano-banana/.test(model);
    const mkBodyImages = (refMode) => {
      let promptWithSize = prompt;
      if (effectiveSize && effectiveSize !== 'auto') promptWithSize += '（输出' + effectiveSize + '分辨率）';
      if (effectiveAspect && effectiveAspect !== 'auto') promptWithSize += '（' + effectiveAspect + '画幅）';
      // GPT Image 系列（官方）不接受 response_format：带上它会返回 200 但 data 为空，必须按模型省略
      const b = { model, prompt: promptWithSize };
      if (!/^(gpt-image|chatgpt-image)/i.test(model)) b.response_format = 'b64_json';
      if (isDoubaoModel) {
        if (resolvedSize) b.size = resolvedSize;
        if (effectiveSize !== 'auto') b.image_size = effectiveSize;
        if (effectiveAspect !== 'auto') b.aspect_ratio = effectiveAspect;
      } else if (!isGeminiModel && !isNanoBananaModel && resolvedSize) {
        b.size = resolvedSize;
      }
      const bodyRefs = [singleRef]
        .concat(separatePlanStyleRef ? [styleReferenceDataURL] : [], extraRefs, planRefs, exteriorReferenceDataURL || [], materialReferenceDataURL || [])
        .filter(Boolean);
      if (refMode === 'data' && bodyRefs.length) b.image = bodyRefs.length === 1 ? bodyRefs[0] : bodyRefs;
      if (refMode === 'b64' && bodyRefs.length) {
        const b64Refs = bodyRefs.map(ref => String(ref).split(',')[1]);
        b.image = b64Refs.length === 1 ? b64Refs[0] : b64Refs;
      }
      if (refMode === 'url' && bodyRefs.length) b.image_url = bodyRefs.length === 1 ? bodyRefs[0] : bodyRefs;
      return b;
    };
    const mkBodyChat = () => {
      // #174 chat 路径没有原生 size 参数，把尺寸要求追加到 prompt 里
      let promptWithSize = prompt;
      if (effectiveSize && effectiveSize !== 'auto') {
        promptWithSize += '（输出' + effectiveSize + '分辨率）';
      }
      if (effectiveAspect && effectiveAspect !== 'auto') promptWithSize += '（' + effectiveAspect + '画幅）';
      const content = [{ type: 'text', text: promptWithSize }];
      if (imageDataURL) {
        if (hasStyleRef) content.push({ type: 'text', text: '图1：结构参考。严格保持它的墙体、门窗、家具布局与相机角度。' });
        content.push({ type: 'image_url', image_url: { url: imageDataURL } });
      }
      if (inpaintOverlayDataURL) {
        content.push({ type: 'text', text: '图2是在原图上标出的待修改区域，红色半透明区域就是唯一允许改变的范围。未标红区域必须保持原图像素、构图、透视、家具位置和光影不变。' });
        content.push({ type: 'image_url', image_url: { url: inpaintOverlayDataURL } });
      }
      if (styleReferenceDataURL) {
        content.push({ type: 'text', text: '图2：风格参考。只继承它的材质、色彩、灯光、色温和软装气质，不要复制它的构图。' });
        content.push({ type: 'image_url', image_url: { url: styleReferenceDataURL } });
      }
      (additionalReferenceDataURLs || []).forEach((ref, index) => {
        if (!ref) return;
        content.push({ type: 'text', text: '图' + (index + 3) + '：同组已确认结果，只用于统一材质、色彩、光影和软装气质，不得复制它的空间结构或相机角度。' });
        content.push({ type: 'image_url', image_url: { url: ref } });
      });
      planRefs.forEach((ref, index) => {
        content.push({ type: 'text', text: '图组中的其他楼层平面参考 ' + (index + 1) + '：只用于核对楼梯、电梯、设备井、外墙轮廓和上下层墙体关系，不得把它作为本次输出楼层，也不得复制它的户型。' });
        content.push({ type: 'image_url', image_url: { url: ref } });
      });
      if (exteriorReferenceDataURL) {
        content.push({ type: 'text', text: '这张图只作为窗外外景参考。严格按参考图替换窗洞外部可见的景物、天气、天空和远景，不得改变室内结构、家具、材质、室内灯光或相机角度。' });
        content.push({ type: 'image_url', image_url: { url: exteriorReferenceDataURL } });
      }
      if (materialReferenceDataURL) {
        content.push({ type: 'text', text: '最后一张图片只作为材质、色彩和表面质感参考，不复制它的构图、家具位置或相机角度。图中每个带类别标签的材质只作用于对应类别；未列出的吊顶、墙面、地面、柜体、家具等必须保持图1原材质，禁止把某一材质扩散到其他表面。' });
        content.push({ type: 'image_url', image_url: { url: materialReferenceDataURL } });
      }
      const b = { model, messages: [{ role: 'user', content }] };
      // 部分中转站 chat 路径也支持 size 字段（如 GPT-Image / Seedream）
      if (isDoubaoModel) {
        if (resolvedSize) b.size = resolvedSize;
        if (effectiveSize !== 'auto') b.image_size = effectiveSize;
        if (effectiveAspect !== 'auto') b.aspect_ratio = effectiveAspect;
      } else if (!isGeminiModel && !isNanoBananaModel && resolvedSize) {
        b.size = resolvedSize;
      }
      // Gemini/中转的图像模型只有在明确请求 image 模态时才会返回图片。
      if (hasRef) b.modalities = ['text', 'image'];
      return b;
    };
    const appendImagePart = (form, dataURL, fieldName, filename) => {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataURL || '');
      if (!m) throw new Error('参考图不是有效的 base64 图片');
      let b64 = m[2].replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bytes = Buffer.from(b64, 'base64');
      const ext = /jpeg/i.test(m[1]) ? 'jpg' : (m[1].split('/')[1] || 'png');
      form.append(fieldName, new Blob([bytes], { type: m[1] }), filename + '.' + ext);
    };
    const mkEditsForm = (withAspect, multi) => {
      const primary = multi ? imageDataURL : singleRef;
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(primary || '');
      if (!m) throw new Error('参考图不是有效的 base64 图片');
      const form = new FormData();
      form.append('model', model);
      let promptWithSize = prompt;
      if (effectiveSize && effectiveSize !== 'auto') promptWithSize += '（输出' + effectiveSize + '分辨率）';
      if (effectiveAspect && effectiveAspect !== 'auto') promptWithSize += '（' + effectiveAspect + '画幅）';
      form.append('prompt', promptWithSize);
      appendImagePart(form, primary, multi ? 'image[]' : 'image', 'structure');
      if (multi && inpaintOverlayDataURL) appendImagePart(form, inpaintOverlayDataURL, 'image[]', 'inpaint_region');
      if (multi && styleReferenceDataURL) appendImagePart(form, styleReferenceDataURL, 'image[]', 'style');
      if (multi) (additionalReferenceDataURLs || []).forEach((ref, index) => {
        if (ref) appendImagePart(form, ref, 'image[]', 'consistency_' + (index + 1));
      });
      if (multi) planRefs.forEach((ref, index) => {
        appendImagePart(form, ref, 'image[]', 'floor_reference_' + (index + 1));
      });
      if (multi && exteriorReferenceDataURL) appendImagePart(form, exteriorReferenceDataURL, 'image[]', 'exterior');
      if (multi && materialReferenceDataURL) appendImagePart(form, materialReferenceDataURL, 'image[]', 'material');
      if (hasMask) {
        const mk = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(maskDataURL || '');
        if (!mk) throw new Error('遮罩不是有效的 base64 图片');
        const maskBytes = Buffer.from(mk[2], 'base64');
        form.append('mask', new Blob([maskBytes], { type: mk[1] }), 'mask.png');
      }
      form.append('n', '1');
      if (!/^(gpt-image|chatgpt-image)/i.test(model)) form.append('response_format', 'b64_json');
      if (isDoubaoModel) {
        if (resolvedSize) form.append('size', resolvedSize);
        if (effectiveAspect !== 'auto') form.append('aspect_ratio', effectiveAspect);
        if (effectiveSize !== 'auto') form.append('image_size', effectiveSize);
      } else {
        if (!isGeminiModel && !isNanoBananaModel && resolvedSize) form.append('size', resolvedSize);
      }
      if (withAspect && (isGeminiModel || isNanoBananaModel)) {
        if (effectiveAspect !== 'auto') form.append('aspect_ratio', effectiveAspect);
        if (effectiveSize !== 'auto') form.append('image_size', effectiveSize);
      }
      return form;
    };
    const parseChatImage = (data) => {
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      if (!msg) return null;
      if (msg.images && msg.images[0] && msg.images[0].image_url) return msg.images[0].image_url.url;
      const c = msg.content;
      if (Array.isArray(c)) {
        for (const p of c) {
          if (p && p.type === 'image_url' && p.image_url) return p.image_url.url;
          if (p && (p.type === 'image' || p.type === 'output_image')) {
            if (p.image_url) return typeof p.image_url === 'string' ? p.image_url : p.image_url.url;
            if (p.url) return p.url;
            if (p.data) return normalizeImageDataURL('data:' + (p.mime_type || p.mimeType || 'image/png') + ';base64,' + p.data);
          }
          const inline = p && (p.inlineData || p.inline_data);
          if (inline && inline.data) return normalizeImageDataURL('data:' + (inline.mimeType || inline.mime_type || 'image/png') + ';base64,' + inline.data);
          if (p && p.b64_json) return normalizeImageDataURL(p.b64_json);
        }
      }
      if (typeof c === 'string') {
        const mm = c.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/);
        if (mm) return normalizeImageDataURL(mm[0]);
        // 有些中转只回裸 base64，且可能是 URL-safe 字符集。
        const raw = c.trim();
        if (raw.length > 500 && /^[A-Za-z0-9+/=_-]+$/.test(raw)) {
          const normalized = normalizeImageDataURL(raw);
          if (/^data:image\//.test(normalized)) return normalized;
        }
      }
      if (msg.image && msg.image.url) return msg.image.url;
      return null;
    };

    const cands = urlCandidates(engineId, baseURL);
    let lastErr = null;
    let authErr = null;
    let aspectAttempts = 0;
    const requestStartedAt = Date.now();
    const requestBudgetMs = 120000;
    const fetchSignal = timeoutMs => {
      const timeoutSignal = AbortSignal.timeout(Math.max(1000, timeoutMs));
      if (!signal) return timeoutSignal;
      return AbortSignal.any ? AbortSignal.any([signal, timeoutSignal]) : signal;
    };

    const parseImagesResponse = (data) => {
      const arr = data && (Array.isArray(data.data) ? data.data : (data.data ? [data.data] : (Array.isArray(data.images) ? data.images : [])));
      const item = arr && arr[0];
      if (item) {
        if (typeof item === 'string') return item;
        if (item.b64_json) return normalizeImageDataURL(item.b64_json);
        if (item.url) return item.url;
        if (item.image_url && item.image_url.url) return item.image_url.url;
      }
      return parseChatImage(data);
    };
    const readError = async (resp) => {
      const t = await resp.text();
      let msg = t;
      try {
        const j = JSON.parse(t);
        msg = (j.error && (j.error.message || j.error)) || j.message || j.msg || t;
      } catch (e) {}
      return String(msg).slice(0, 220);
    };
    const noteFail = (route, err) => {
      const next = err instanceof Error ? err : new Error(String(err));
      const nextIsHtml = /网页不是接口/.test(next.message);
      const prevIsUseful = lastErr && !/网页不是接口/.test(lastErr.message);
      if (!(nextIsHtml && prevIsUseful)) lastErr = next;
      window.__logBoot && window.__logBoot('[image] 尝试=' + route + ' 失败：' + lastErr.message.slice(0, 160));
    };
    const checkAspect = async (route, dataURL) => {
      if (!imageDataURL || effectiveAspect === 'auto') return true;
      if (String(dataURL).indexOf('data:image/') !== 0) return true;
      const measured = await readImageSize(dataURL);
      if (!measured || !measured.w || !measured.h) return true;
      const target = aspectValue(effectiveAspect);
      const actual = measured.w / measured.h;
      if (target && Math.abs(actual - target) / target > 0.06) {
        if (!aspect || aspect === 'auto') {
          window.__logBoot && window.__logBoot('[image] 跟随原图比例偏差，接受服务商输出 ' + measured.w + '×' + measured.h);
          return true;
        }
        if (aspectAttempts > 0) {
          window.__logBoot && window.__logBoot('[image] 比例仍未匹配，接受最后一张 ' + measured.w + '×' + measured.h);
          return true;
        }
        aspectAttempts++;
        noteFail(route, new Error('输出比例 ' + measured.w + '×' + measured.h + '，与参考图 ' + effectiveAspect + ' 不符'));
        return false;
      }
      window.__logBoot && window.__logBoot('[image] 比例校验通过 ' + route + ' ' + measured.w + '×' + measured.h);
      return true;
    };
    const checkResolution = async (route, dataURL) => {
      if (!isSeedreamModel || !effectiveSize || effectiveSize === 'auto') return true;
      if (String(dataURL).indexOf('data:image/') !== 0) return true;
      const measured = await readImageSize(dataURL);
      if (!measured || !measured.w || !measured.h) return true;
      if (seedreamResolutionGate(effectiveSize, measured)) {
        window.__logBoot && window.__logBoot('[image] 尺寸校验通过 ' + route + ' ' + measured.w + '×' + measured.h + ' · 请求 ' + effectiveSize);
        return true;
      }
      const expected = resolvedSize || effectiveSize;
      noteFail(route, new Error('输出尺寸 ' + measured.w + '×' + measured.h + ' 未达到请求的 ' + effectiveSize + '（目标 ' + expected + '）'));
      return false;
    };

    routeLoop:
    for (const route of routes) {
      for (let ci = 0; ci < cands.length; ci++) {
        if (signal && signal.aborted) throw new DOMException('全景修复已取消', 'AbortError');
        if (Date.now() - requestStartedAt > requestBudgetMs) {
          noteFail(route, new Error('生成请求超过 120 秒，已停止继续重试'));
          break routeLoop;
        }
        const isChat = route === 'chat';
        const isEdits = route === 'edits' || route === 'edits-plain' || route === 'edits-multi';
        const path = isChat ? '/chat/completions' : isEdits ? '/images/edits' : '/images/generations';
        const url = cands[ci] + path;
        let resp;
        try {
          const headers = { Authorization: 'Bearer ' + cfg.apiKey };
          let body;
          if (isEdits) {
            body = mkEditsForm(route === 'edits' || route === 'edits-multi', route === 'edits-multi');
          } else {
            headers['Content-Type'] = 'application/json';
            const refMode = route === 'images-ref' ? 'data' : route === 'images-ref-b64' ? 'b64' : null;
            body = JSON.stringify(isChat ? mkBodyChat() : mkBodyImages(refMode));
          }
          resp = await fetch(url, {
            method: 'POST',
            headers,
            body,
            signal: fetchSignal(Math.max(5000, Math.min(90000, requestBudgetMs - (Date.now() - requestStartedAt))))
          });
        } catch (e) {
          if (signal && signal.aborted) throw new DOMException('全景修复已取消', 'AbortError');
          noteFail(route, e);
          continue;
        }
        const ct = resp.headers.get('content-type') || '';
        if (resp.ok && ct.indexOf('json') < 0) { noteFail(route, new Error('地址返回的是网页不是接口')); continue; }
        if (resp.status === 404) { noteFail(route, new Error('404 路径不存在：' + path)); continue; }
        if (!resp.ok) {
          const msg = await readError(resp);
          const err = new Error(def.label + ' 返回 ' + resp.status + '：' + msg);
          if (resp.status === 401 || resp.status === 403) authErr = err;
          noteFail(route, err);
          continue;
        }
        let data;
        try { data = await resp.json(); }
        catch (e) { noteFail(route, new Error('接口返回的不是 JSON')); continue; }
        console.log('[generate] 路由=' + route + ' 路径=' + path + ' 模型=' + model + ' 响应 keys:', Object.keys(data).join(','), '| data[0] keys:', Object.keys(data.data && data.data[0] || {}).join(','), '| choices keys:', Object.keys(data.choices && data.choices[0] || {}).join(','));  // #125 #132-2 调试
        let out = isChat ? parseChatImage(data) : parseImagesResponse(data);
        out = normalizeImageDataURL(out);
        if (!out) {
          // #131b 检测是不是返回了纯文本（模型不支持生图）
          const msgText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (msgText && typeof msgText === 'string' && msgText.length > 10) {
            noteFail(route, new Error('该通道只返回了文字，没有返回图片'));
            continue;
          }
          noteFail(route, new Error('模型未返回图片（可能内容被审核拦截）')); continue;
        }
        localStorage.setItem('gw_route_' + engineId, route);  // #111 记住通路
        const suffix = cands[ci].replace(baseURL.replace(/\/+$/, ''), '');
        localStorage.setItem('gw_urlpath_' + engineId, suffix);
        window.__logBoot && window.__logBoot('[image] 路由=' + route + ' 返回=' + (out.indexOf('http') === 0 ? ('URL ' + out.slice(0, 90)) : ('dataURL ' + out.length + ' 字符')));
        if (out.indexOf('data:image/') === 0) {
          const measured = await readImageSize(out);
          if (!measured || !measured.w || !measured.h) {
            if (imageDataURLSignatureValid(out)) {
              window.__logBoot && window.__logBoot('[image] 图片头校验通过，解码测量失败，交给保存阶段继续验证 · ' + out.slice(0, 32));
            } else {
              noteFail(route, new Error('生成结果数据不完整或格式无法识别：' + out.slice(0, 42)));
              continue;
            }
          }
        }
        if (out.indexOf('http') === 0) {  // 返回URL需再取
          const ir = await fetch(out, { signal: fetchSignal(60000) });
          if (!ir.ok) { noteFail(route, new Error('生成图片下载失败：HTTP ' + ir.status)); continue; }
          const ict = (ir.headers.get('content-type') || '').toLowerCase();
          if (ict && !ict.startsWith('image/') && !ict.includes('octet-stream')) {
            const text = await ir.text();
            noteFail(route, new Error('图片地址返回的不是图片（' + (ict || '未知类型') + '）：' + String(text).slice(0, 120)));
            continue;
          }
          const ib = await ir.arrayBuffer();
          const b64 = Buffer.from(ib).toString('base64');
          const dataURL = 'data:' + (ict.split(';')[0] || 'image/png') + ';base64,' + b64;
          if (!(await checkAspect(route, dataURL))) continue;
          if (!(await checkResolution(route, dataURL))) continue;
          await quotaSpendOnSuccess(engineId, model, effectiveSize); // 成功出图才扣分
          return dataURL;
        }
        if (!(await checkAspect(route, out))) continue;
        if (!(await checkResolution(route, out))) continue;
        await quotaSpendOnSuccess(engineId, model, effectiveSize); // 成功出图才扣分
        return out;
      }
    }
    if (hasRef) {
      const base = authErr ? authErr.message : (lastErr ? lastErr.message : '未知错误');
      if (hasMask) throw new Error('局部重绘失败：' + base + '。请确认当前模型支持 images/edits 的 mask 参数（GPT Image 系列通常支持）。');
      throw new Error('参考图生成失败：' + base + '。已尝试 chat 多模态、images/edits 和带图 images 通道；该引擎可能不支持图生图，请换用豆包 Seedream / RunningHub 或支持参考图的模型。');
    }
    throw new Error('连接失败：' + (lastErr ? lastErr.message : '未知') + '——检查 Base URL 与模型名（可参考 UW 的配法）');
  }

  async function decomposeLayers({ engineId, imageDataURL, prompt, resolution = '2K' } = {}) {
    if (!imageDataURL) throw new Error('缺少需要分层的图片');
    const res = String(resolution || '2K').toUpperCase() === '1K' ? '1K' : '2K';
    const cfgs = loadConfigs();
    const engineIds = Array.from(new Set([
      engineId,
      'apollo',
      'volc'
    ].filter(Boolean)));
    const rawPrompt = String(prompt || '').trim() || '自动分离主要元素';
    const finalPrompt = rawPrompt.indexOf('将以下内容进行拆分') === 0
      ? rawPrompt
      : ('将以下内容进行拆分，' + rawPrompt);
    let lastError = null;
    for (const currentEngine of engineIds) {
      const cfg = cfgs[currentEngine] || {};
      if (!cfg.apiKey) continue;
      if (currentEngine === 'apollo') {
        // 阿波罗算力：余额不够最少 2 层就跳过，落到自有火山 Key；都没有则在末尾报错提示充值
        try { await quotaPrecheckPoints(currentEngine, (res === '2K' ? 2 : 1) * 2); }
        catch (e) { lastError = e; continue; }
      }
      const def = PROVIDERS[currentEngine] || {};
      const baseURL = String(cfg.baseURL || def.baseURL || '').replace(/\/+$/, '');
      if (!baseURL) continue;
      const model = currentEngine === 'apollo'
        ? 'seedream-v5-pro/layer-decomposition'
        : (res === '1K'
          ? 'doubao-seedream-5-0-pro-layer-1k'
          : 'doubao-seedream-5-0-pro-layer-2k');
      const availability = modelAvailability(currentEngine, model);
      if (availability.status === 'missing') {
        lastError = new Error(availability.message);
        continue;
      }
      for (const candidate of urlCandidates(currentEngine, baseURL)) {
        const endpoint = candidate.replace(/\/+$/, '') +
          (candidate.replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1') +
          '/images/generations';
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + cfg.apiKey,
              Accept: 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model,
              prompt: finalPrompt,
              image: [imageDataURL],
              size: res,
              layer_decomposition: true,
              watermark: false,
              response_format: 'url'
            }),
            signal: AbortSignal.timeout(300000)
          });
          const text = await response.text();
          let data = {};
          try { data = JSON.parse(text); } catch (error) {}
          if (!response.ok) {
            const msg = (data && (data.error?.message || data.message || data.msg)) || text.slice(0, 180);
            lastError = new Error((PROVIDERS[currentEngine]?.label || currentEngine) + ' 图层分离返回 ' + response.status + '：' + msg);
            continue;
          }
          const items = Array.isArray(data.data) ? data.data : [];
          if (items.length < 2) {
            lastError = new Error('图层分离接口没有返回背景和元素层：' + JSON.stringify(data).slice(0, 240));
            continue;
          }
          const images = [];
          for (let index = 0; index < items.length; index++) {
            const item = items[index] || {};
            let dataURL = item.b64_json ? normalizeImageDataURL(item.b64_json) : '';
            if (!dataURL && item.url) {
              if (/^data:image\//i.test(item.url)) dataURL = normalizeImageDataURL(item.url);
              else {
                const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
                if (!imageResponse.ok) throw new Error('图层图片下载失败：HTTP ' + imageResponse.status);
                const type = (imageResponse.headers.get('content-type') || 'image/png').split(';')[0];
                const bytes = Buffer.from(await imageResponse.arrayBuffer());
                dataURL = 'data:' + type + ';base64,' + bytes.toString('base64');
              }
            }
            if (!dataURL) throw new Error('图层图片没有有效地址');
            const dims = String(item.size || '').split('x').map(Number);
            images.push({
              dataURL,
              name: item.name || (index === 0 ? '背景' : '图层 ' + index),
              size: dims.length === 2 ? { w: dims[0], h: dims[1] } : null,
              zIndex: item.z_index == null ? index : Number(item.z_index),
              bbox: item.bounding_box || null,
              background: index === 0
            });
          }
          if (currentEngine === 'apollo') {
            const layers = Math.min(images.length, DECOMPOSE_CAP);
            await quotaSpendExplicit(currentEngine, layers * (res === '2K' ? 2 : 1),
              model + '@' + res + 'x' + layers + '层', 'decompose'); // 按拆出层数扣，与“1积分=1张图”同口径
          }
          return { engineId: currentEngine, model, resolution: res, prompt: finalPrompt, images };
        } catch (error) {
          lastError = error;
        }
      }
    }
    const base = lastError ? lastError.message : '没有配置可用的图层分离平台';
    throw new Error('图层分离失败：' + base + '。请确认阿波罗或火山已开通 Seedream 图层分解模型。');
  }
  async function chat(engineId, { messages, model: requestedModel, maxTokens } = {}) {
    const def = PROVIDERS[engineId];
    if (!def) throw new Error('未知引擎：' + engineId);
    const cfg = loadConfigs()[engineId] || {};
    if (!cfg.apiKey) throw new Error('请先在 设置 → 引擎 里填写「' + def.label + '」的 API Key');
    const baseURL = cfg.baseURL || def.baseURL || '';
    if (!baseURL) throw new Error('请先填写接口地址（Base URL）');
    const model = realIdOf(requestedModel || cfg.model || def.model, engineId);
    let lastError = null;
    for (const base of urlCandidates(engineId, baseURL)) {
      try {
        const body = { model, messages, stream: false };
        if (maxTokens) {
          const budget = Math.max(1, Number(maxTokens) || 1);
          if (/^(gpt-5|o[134]|gpt-4\.1)/i.test(model)) body.max_completion_tokens = budget;
          else body.max_tokens = budget;
        }
        const resp = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000)
        });
        if (resp.status === 404) { lastError = new Error('对话接口不存在（404）'); continue; }
        const text = await resp.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) {}
        if (!resp.ok) throw new Error(def.label + ' 返回 ' + resp.status + '：' + String(data && (data.error && data.error.message || data.message) || text).slice(0, 220));
        const choice = data && data.choices && data.choices[0];
        const message = choice && choice.message;
        const content = message && (message.content != null ? message.content : (message.text || message.reasoning_content));
        if (Array.isArray(content)) {
          const joined = content.map(p => (p && (p.text || p.content)) || '').filter(Boolean).join('\n');
          if (joined.trim()) return joined;
        }
        if (typeof content === 'string' && content.trim()) return content;
        const outputText = data && (data.output_text || data.text);
        if (typeof outputText === 'string' && outputText.trim()) return outputText;
        const finish = choice && choice.finish_reason;
        if (finish === 'length') throw new Error('模型输出被截断，请减少图片数量或缩短提示词后重试');
        throw new Error('模型没有返回文字内容' + (finish ? '（finish_reason=' + finish + '）' : ''));
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('对话请求失败');
  }

  // 高清放大：与画室相同的 RunningHub AI App 通道。
  // 注意：放大只支持 runninghub / topaz302，均为用户自填 Key（自有 API），不参与积分扣减。
  async function upscale(engineId, { imageDataURL, resolution = '2k' } = {}) {
    if (!imageDataURL) throw new Error('缺少需要放大的图片');
    const def = PROVIDERS[engineId];
    if (!def || !['runninghub', 'topaz302'].includes(engineId)) {
      throw new Error('当前高清放大只支持 RunningHub 或 302.AI Topaz');
    }
    const cfg = loadConfigs()[engineId] || {};
    if (!cfg.apiKey) throw new Error('请先在设置中填写 ' + def.label + ' API Key');
    const bridge = electronBridge();
    if (!bridge || !bridge.ipcRenderer) throw new Error('当前应用无法启动高清放大接口');
    if (engineId === 'topaz302') {
      return bridge.ipcRenderer.invoke('topaz302:upscale', {
        baseURL: cfg.baseURL || def.baseURL,
        apiKey: cfg.apiKey,
        imageDataURL,
        resolution: String(resolution || '2k').toLowerCase(),
        targetShortEdge: { '1k': 1024, '2k': 2048, '4k': 4096 }[String(resolution || '2k').toLowerCase()] || 2048,
        model: cfg.model || def.model
      });
    }
    return bridge.ipcRenderer.invoke('runninghub:upscale', {
      baseURL: cfg.baseURL || def.baseURL,
      apiKey: cfg.apiKey,
      imageDataURL,
      resolution: String(resolution || '2k').toLowerCase()
    });
  }

  window.GWProviders = { PROVIDERS, loadConfigs, saveConfig, storageMode, renderPrompt, renderWeatherPrompt, renderLightPrompt, composePromptSections, promptFlavorForModel, LIGHT_FIXTURE_GROUPS, generate, decomposeLayers, upscale, preferredUpscaleEngine, chat, NOTES, BUILTIN_MODELS, modelsForEngine, syncModels, modelCatalogStatus, modelAvailability, getSizes, getAspects, getCapabilities, inpaintRouteFor, MODEL_ALIASES, MODEL_REGISTRY, VENDORS, aliasOf, realIdOf, isRegisteredModel, vendorOf, vendorMeta, urlCandidates, filterImageModels, visionModelsForEngine, dedupeModels, normalizeImageDataURL, imageDataURLSignatureValid, seedreamRequestSize, seedreamResolutionGate };
})();
