# 密钥与本地数据安全

更新日期：2026-10-19

## API Key 存储

- 引擎配置通过 Electron `safeStorage` 加密后写入用户数据目录的 `engines.enc.json`。
- Windows 下使用系统 DPAPI，加密内容与当前系统用户绑定。
- 首次启动会自动把旧版 `localStorage.gw_engines` 迁移到加密文件，迁移成功后删除明文 localStorage。
- 系统加密不可用时自动回退到 localStorage，并在设置 → 引擎页显示风险提示。
- 设置页只显示“系统安全存储 / 本地存储”状态，不显示密钥内容。

## 项目存档

- `Config/canvas.json` 使用临时文件 + fsync + 原子替换。
- 上一份有效主存档保留为 `canvas.json.bak`。
- 增量变更保存在 `Config/canvas.journal.jsonl`，按条数、体积和空闲时间自动合并。
- 主存档损坏时按主存档 → 备份 → 临时文件顺序恢复。

## 仍需注意

- 渲染进程为了调用接口仍会在内存中持有明文 Key；这是调用第三方 API 的必要条件。
- 如果电脑本身已被同一系统用户下的恶意程序控制，safeStorage 不能提供额外隔离。
- 项目素材和导出文件不加密，分享项目目录前需要自行检查内容。
