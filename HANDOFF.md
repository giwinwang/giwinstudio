# HANDOFF — 分支讨论交接单

> 用途：需要从主线"分叉"出去单独讨论时，先让 Agent 把当前状态写到这份文件，再新开任务读它接着聊。
> 新任务开场白建议：`读仓库根的 HANDOFF.md，我们接着聊 <主题>`。
> 规矩：本文件只写**已确认的事实**，不写猜测；每次分叉重写，不追加历史。

**最后更新**：2026-10-27 17:00

---

## 1. 当前进展（已完成、已上线）

### 0.4.32 已全量发布
| 通道 | 状态 |
|---|---|
| 更新清单 `www.giwin.cn/update/version.json` | 0.4.32，155,981,312 B，SHA256 `EF59EAA5…213D321`，含 manualUrl |
| OSS 直连 | `www.giwin.cn/downloads/GIWIN-Studio-0.4.32-Beta-Setup.exe` 实测 200 / 206 |
| GitHub Release | `releases/tag/v0.4.32` 附件 state=uploaded，gh-proxy 镜像 206，`releases/latest` 302 正确 |
| 百度网盘 | `pan.baidu.com/s/1LdApVnrZelcKjo5fm_03NA?pwd=rwyw`（16:09 上传，148.8M，确认是 0.4.32） |
| 官网 | v0.4.32 四处、直连/网盘两按钮均指向新包，全站 Cache-Control:no-cache |

本地包路径：`release-branded\GIWIN-Studio-0.4.32-Beta-Setup.exe`

### 本版 UI 改造（已全部落地，137 项测试通过）
- 画布层：节点宽 240/430 两档，预览高按底图比例夹 240~360，旧节点用 `inlinePreview` 存档防错位；Konva 字号收敛五档；⚡/▦ 改矢量绘制
- 全局层：z-index 31 个 token；表单 28/32 两档 + 统一 focus 光晕；tooltip 三份合公共基类；数字等宽；空状态两级归并
- 图标层：`--ic-stroke 1.65 / --ic-stroke-fine 1.42` + 按 sqrt(16/N) 光学补偿；静态 ×/＋/▾ 换内联 SVG（修掉加粗变豆腐块）
- 关于页「检查更新」从硬编码 disabled 占位改为真实调用 `update:check`

### 发版链路修复
- `deploy.sh` 改为上传前自动从源码同步进 `dist/`（此前只传旧 dist，导致源码改动从未上线）
- 上传后对 index/main/styles/site-config/privacy/terms 全部 set-meta no-cache
- 打包绕开 safe-delete：electron-builder 输出到 `release2/`、`release3/`，再用 `build-installer.ps1 -PayloadDir` 重打品牌包

---

## 2. 已定决策（别再推翻）

- **更新主源 = 阿里云 OSS**（直连 2.1MB/s），GitHub raw / jsdelivr 仅作清单备用，gh-proxy 作包镜像，SHA256 兜底校验
- **官网 = OSS bucket `giwin-cn-web` 直出**，无 CDN；任何"官网没更新"先查浏览器缓存与 dist 是否同步
- **网盘用单文件分享**，每版需重传并重新分享，改两处：`update/version.json` 的 manualUrl + 官网 `index.html` 的 dl-baidu
- **工作空间统一用仓库根**，项目记忆在 `.workbuddy/memory/`（已 gitignore）
- 设计语言：V2 克制排版（真实截图 + 1px 描边 + 编辑式留白）；"大气"= 放大尺度，不是换风格

---

## 3. 否决过的方案（省得再试一遍）

| 方案 | 为什么不行 |
|---|---|
| 官网部署到 Cloudflare Pages | README 里是错的，实际在阿里云 OSS（DNS 万网） |
| `overflow:hidden` 裁圆角 | 圆角边缘无抗锯齿，出毛刺 |
| 用 `border` 叠 `border-radius` 描边 | 1px 边在圆弧上叠乘发暗，与直线深浅不一 |
| `U+00B7 (·)` 做分隔符 | 加粗后渲染成空心方块/豆腐块，改 `U+2022 (•)` |
| 靠 0.4.29 自动升级到 0.4.32 | 0.4.29 的 app.asar 里没有 update-service.js，**只能手动装一次** |
| `node scripts/release-push.mjs` 上传附件 | Node fetch 打 uploads.github.com 必 `fetch failed`，改用 curl POST |

---

## 4. 待决策 / 待办

1. **本机升级**：D:\GIWIN Studio 仍是 0.4.29，需退干净进程后手动装一次 0.4.32，之后才进自动更新轨道
2. **GitHub token 长期方案**：现在靠临时 token，建议建专用 token 存本机环境变量，别再贴聊天（GitHub secret scanning 扫到会自动作废）
3. **Sentry 验证**：崩溃上报随 0.4.32+ 生效，需要有真实崩溃样本才能确认链路通
4. **Copilot 对话分支（未决策）**：是否给极物做"选中文字 → 右侧就地追问 → 主流程不中断"。属会话模型改造（消息树 + 节点绑定），不是纯 UI，需先出交互稿
