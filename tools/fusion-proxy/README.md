# 极物融合 · API 反向代理

把客户端对上游算力的调用收拢到 `api.giwin.cn` 名下，让界面、日志、抓包里都只出现极物自己的域名。

```
客户端 ──▶ https://api.giwin.cn  ──▶  https://api.apilio.ai
             （我们控制）                （上游，客户不可见）
```

---

## 一、为什么必须新增一台服务器

`www.giwin.cn` 现在是纯 OSS 静态站（`CNAME → giwin-cn-web.oss-cn-hongkong.aliyuncs.com`），没有 CDN、没有 ECS、没有函数计算。

**OSS 的镜像回源只处理 GET/HEAD，AI 接口全是 POST，扛不住。** 所以没法复用，必须新增计算资源。

而且**必须放境外或香港**：上游在境外，用境内服务器反代等于把跨境流量落到境内节点，合规和稳定性都不划算；香港机器还有个好处是**不需要备案**。

---

## 二、需要你做的两件事

### 1. 开一台香港轻量应用服务器

| 项 | 建议 |
|---|---|
| 产品 | 阿里云 轻量应用服务器（香港） |
| 规格 | 2 核 1G 起，带宽 30Mbps 起 |
| 系统 | Ubuntu 24.04 |
| 流量 | 套餐自带 1TB/月起步 |

**流量够不够？** 反代只承载接口请求，不含图片本体（图片走上游直链下载）。单次生图上传参考图约 1–3MB，**1TB ≈ 30 万次以上生成**，远够用。真正要盯的是带宽峰值，不是总量。

开好后把**公网 IP** 给我。

### 2. 给我一把有 DNS 权限的 Key（或者你自己加一条解析）

到 **阿里云 RAM 控制台** → 新建一个用户 → 只勾 `AliyunDNSFullAccess` → 创建 AccessKey。

或者你自己在 DNS 控制台加一条记录也行：

```
记录类型：A      主机记录：api      记录值：<服务器公网 IP>      TTL：600
```

> 现有那把 OSS 用的 Key **没有 DNS 权限**（实测返回 `Forbidden.RAM`，子账号 `203418293036195773`）。把它给我也没用，必须是新授权的。

---

## 三、部署（我执行，或你照抄）

DNS 生效后，在服务器上以 root 执行：

```bash
scp -r tools/fusion-proxy root@<IP>:/root/
ssh root@<IP> "bash /root/fusion-proxy/setup-server.sh"
```

脚本会依次做：装 nginx + certbot → 校验 DNS 是否已指向本机 → **预检到上游的连通性**（这一步很关键：如果这台机器连不上 `api.apilio.ai`，换了也白换，脚本会直接停下）→ 临时 HTTP 配置 → 签 Let's Encrypt 证书 → 换正式配置 → 冒烟测试 → 装续期钩子。

DNS 记录也可以由脚本自动加：

```powershell
# 用有 DNS 权限的 Key
.\tools\fusion-proxy\add-dns-record.ps1 -Action Set -RR api -Value <服务器IP>
```

---

## 四、切换客户端（最后一步，别提前）

**顺序不能反。** 先把服务器验通，再改客户端；否则用户会被切到一个还不存在的地址上。

1. 改 `providers.js` 第 6 行：

   ```diff
   -      baseURL: 'https://api.apilio.ai',
   +      baseURL: 'https://api.giwin.cn',
   ```

   只改这一处就够了。`normalizedConfigs()` 会把极物融合的地址强制对齐到这个值，
   老用户存档里的旧地址不会生效（这是「改默认值对老用户不管用」的唯一解法）。

2. 跑验证：

   ```bash
   node tools/fusion-proxy/probe.mjs --via-cdp --compare
   ```

   `--via-cdp` 走调试桥接，用应用里已存的真实额度码发请求，**Key 不出应用**。
   全部 PASS 才算通。

3. 在软件里手点一次「测试连接」+ 真出一次图，确认端到端。

---

## 五、兜底设计

主线路挂掉时不会全断：

```js
// providers.js
mirrorCandidates('apollo', 'https://api.giwin.cn')
// → ['https://api.apilio.ai', 'https://apilio.ai/v1', 'https://apilio.ai']
```

但**只有「网络层没通」才会切**（`isNetFailure`）。生图超时不切线路——上游多半已经受理并计费了，再打一次就是重复下单、重复扣费。这条保护由 `tests/fusion-proxy.test.js` 守着。

---

## 六、安全与成本

**限流**：60 次/分钟 + 30 突发，单 IP 最多 16 个并发连接。
**路径白名单**：只放行 `/v1/`、`/files/`、`/uploads/`、`/p/`，其余 404 —— 免得这个域名被人当免费梯子刷。

**真正的风险方向变了**：以前是两个上游域名轮换，反代之后我们自己成了单点。我们的域名被打或被拦，全线断。所以兜底线路必须留着，别急着删。

---

## 七、文件说明

| 文件 | 用途 |
|---|---|
| `nginx-api.giwin.cn.conf` | Nginx 完整配置（含长超时、大 body、限流、白名单） |
| `setup-server.sh` | 服务器一键部署，含 DNS/连通性预检和证书申请 |
| `add-dns-record.ps1` | 免装 aliyun CLI，手写 RPC 签名直接管 DNS 记录 |
| `probe.mjs` | 链路验证：健康检查 / 白名单 / GET / POST / 域名泄露 / 上游对照 |

---

## 八、几个已经踩过的坑

1. **`isMirrorUrl` 必须按 host 相对判断。** 简单把 `api.apilio.ai` 加进兜底域名列表，会让主线路自身被当成兜底跳过（`isMirrorUrl=true` 且 `lastError` 为空 → `continue`），第一次请求就绕开主站。测试里有专门一条守着这个。

2. **响应体域名改写（`sub_filter`）默认关闭。** 改动后图片 URL 会变成 `api.giwin.cn/...`，而客户端拿到 URL 会自己再 fetch 一次下载（`providers.js` 约 2040 行）。如果路径不在白名单里就是 404，表现为「出图失败」。等 `probe.mjs --image` 打出真实路径格式、确认能命中白名单，再取消注释。

3. **Nginx 到上游必须显式设 `Host` 和 SNI。** new_api 网关按 Host 路由，不设就 404；`proxy_ssl_name` 不设会 TLS 握手失败。

4. **`proxy_read_timeout` 必须给到 300s。** 生图实测 40–180 秒，默认 60s 会把正常请求切断。

5. **证书申请要在临时 HTTP 配置下进行。** 直接上带 `ssl_certificate` 的配置，证书文件还不存在，`nginx -t` 会失败，整个部署卡住。
