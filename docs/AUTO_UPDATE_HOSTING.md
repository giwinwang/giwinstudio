# 自动更新：托管与发版操作

客户端能力已内置（检查 → 提示 → 下载 → SHA256 校验 → 静默安装 → 自动重启）。
本文档说明「文件放哪里、每次发版怎么做」。

## 一、托管结构（GitHub 免费方案）

| 内容 | 位置 | 稳定地址 |
|---|---|---|
| `version.json` | 仓库 `main` 分支，固定不变 | `https://raw.githubusercontent.com/<用户>/<仓库>/main/update/version.json` |
| 配图 `images/*.webp` | 仓库 `main` 分支 | 与 `version.json` 同目录（清单里写绝对地址） |
| 安装包 `*.exe` | Releases 附件 | 每个版本一个 tag，地址写进 `version.json` 的 `url` |

仓库必须是 **public**（私有仓库的 raw 地址需要 token，客户端拿不到）。

## 二、首次配置（只做一次）

1. 建仓库：GitHub → New repository → 名称 `giwin-updates` → **Public** → 勾选 Add a README。
2. 把 `<仓库地址>` 发给开发侧，写进 `update-config.json` 的 `manifestUrl`。
3. 仓库里建好 `update/` 目录（上传 `version.json` 与 `images/` 时自动创建）。

## 三、每次发版（四条命令 + 两次上传）

```bash
# 1. 升版本号（package.json / package-lock.json 两处）
# 2. 打包
npm run dist:win
npm run dist:installer          # 产出 release-branded/GIWIN-Studio-<版本>-Beta-Setup.exe

# 3. 生成清单（安装包地址填 Releases 里的直链）
npm run publish:update -- \
  --base-url https://raw.githubusercontent.com/<用户>/<仓库>/main/update \
  --asset-url https://github.com/<用户>/<仓库>/releases/download/v<版本>/GIWIN-Studio-<版本>-Beta-Setup.exe \
  --notes "要点一|要点二"
```

4. 上传 `update/version.json` 与 `update/images/` 到仓库 `main` 分支（网页拖拽即可）。
5. Releases → Draft a new release → tag `v<版本>` → 上传 `release-branded\GIWIN-Studio-<版本>-Beta-Setup.exe` → Publish。

> 顺序很重要：**先传安装包，再更新 version.json**。反过来的话，客户端会拿到一个还不存在的下载地址。

## 四、验证

- 浏览器打开 `manifestUrl`，应返回 JSON，且 `version` 比当前安装版大。
- 浏览器打开清单里的 `url`，应直接开始下载（GitHub Releases 会 302 到 CDN，属正常）。
- 客户端：用户菜单 →「检查更新」。

## 五、已知限制

- **GitHub Releases 在国内下载偏慢**，134MB 的包个别网络可能要几分钟或重试。兜底方案：同时把安装包放百度网盘，更新弹窗失败时会给出「手动下载」入口。
- GitHub 附件有 2GB 上限，当前 134MB 无压力。
- `raw.githubusercontent.com` 在国内部分地区不稳定。若发现清单拉取失败，可换 jsDelivr 镜像：
  `https://cdn.jsdelivr.net/gh/<用户>/<仓库>@main/update/version.json`
  （有约 12 小时缓存，发版后可访问 `https://purge.jsdelivr.net/gh/<用户>/<仓库>@main/update/version.json` 强制刷新）
- 发布通道：清单里 `channel` 为 `beta` 时，只有 beta/stable 客户端都会收到；正式版请用 `--channel stable`，避免内测包推给正式用户。

## 六、安装包版本约束

C# 安装器的 `AssemblyVersion` 只接受四段纯数字，因此 `package.json` 的版本必须是 `x.y.z`（不能带 `-dev.1` 之类后缀），否则 `npm run dist:installer` 会编译失败。
