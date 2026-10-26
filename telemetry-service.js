// 极物 GIWIN Studio · 崩溃上报服务（Sentry）
// 职责：捕获主进程异常与渲染进程/原生崩溃（minidump），匿名上报。
// 设计约束：
//  - 开关在 update-config.json：{ "telemetry": true, "sentryDsn": "https://…" }
//  - 未配置 DSN 或 telemetry=false 时完全不加载 SDK，零开销。
//  - 只收崩溃技术信息（错误堆栈、模块、版本、系统类型），不收任何项目数据。
//  - 上报失败静默，不影响任何主流程。

const fs = require('fs');
const path = require('path');

let initialized = false;

function readConfig(app) {
  try {
    const configPath = path.join(app.getAppPath(), 'update-config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
  } catch (error) {
    return {};
  }
}

function init(app) {
  if (initialized) return initialized;
  initialized = { enabled: false };

  const config = readConfig(app);
  if (config.telemetry === false) return initialized;
  const dsn = typeof config.sentryDsn === 'string' ? config.sentryDsn.trim() : '';
  if (!/^https:\/\/[^@]+@[^/]+\/\d+$/.test(dsn)) return initialized;

  try {
    // 兼容 @sentry/electron v4（主入口）与 v5+（/main 子入口）
    let Sentry;
    try { Sentry = require('@sentry/electron/main'); }
    catch (e) { Sentry = require('@sentry/electron'); }

    Sentry.init({
      dsn,
      release: 'giwin-studio@' + app.getVersion(),
      environment: 'production',
      sampleRate: 1.0,
      autoSessionTracking: true,      // 会话统计 → 活跃用户
      attachStacktrace: true,
      // 隐私兜底：不发送本机路径/用户名等敏感细节
      beforeSend(event) {
        try {
          if (event && event.request && event.request.url) {
            event.request.url = event.request.url.replace(/[A-Za-z]:\\Users\\[^\\]+/g, '<user>');
          }
        } catch (e) { /* ignore */ }
        return event;
      }
    });
    initialized = { enabled: true, sentry: Sentry };
  } catch (error) {
    // SDK 缺失或初始化失败：静默跳过，崩溃上报不阻断启动
  }
  return initialized;
}

module.exports = { init };
