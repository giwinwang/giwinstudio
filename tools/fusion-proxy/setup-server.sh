#!/usr/bin/env bash
# ============================================================================
# 极物融合 · 反代服务器一键部署
#
# 用法（在服务器上，root 执行）：
#   bash setup-server.sh
#
# 前置条件：
#   1. 域名 api.giwin.cn 的 A 记录已指向本机公网 IP（执行前请先确认解析生效）
#   2. 本机能访问外网（要装包 + 要连上游）
#
# 脚本做的事：
#   装 nginx + certbot → 临时 HTTP 配置 → 签 Let's Encrypt 证书
#   → 换完整配置 → 冒烟测试 → 装续期钩子
# ============================================================================
set -euo pipefail

DOMAIN="api.giwin.cn"
UPSTREAM_HOST="api.apilio.ai"
WEBROOT="/var/www/html"
CONF_DST="/etc/nginx/conf.d/api.giwin.cn.conf"

c_g() { printf '\033[32m%s\033[0m\n' "$*"; }
c_y() { printf '\033[33m%s\033[0m\n' "$*"; }
c_r() { printf '\033[31m%s\033[0m\n' "$*"; }
die() { c_r "✗ $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行（sudo bash $0）"

# ---------------------------------------------------------------- 1. 系统检查
c_g "==> 1/7 检查系统"
. /etc/os-release 2>/dev/null || die "读不到 /etc/os-release，未支持的系统"
case "$ID" in
  ubuntu|debian) PKG=apt ;;
  alinux|centos|rhel|rocky)
    if command -v dnf >/dev/null 2>&1; then PKG=dnf; else PKG=yum; fi ;;
  *) die "未支持的系统：$ID（本脚本只测过 Ubuntu/Debian）" ;;
esac
c_y "系统 $PRETTY_NAME（包管理器 $PKG）"

# ------------------------------------------------------------ 2. DNS 前置检查
c_g "==> 2/7 检查 DNS"
PUBIP="$(curl -s --max-time 8 https://api.ipify.org || curl -s --max-time 8 https://ifconfig.me || true)"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
c_y "本机公网 IP : ${PUBIP:-取不到}"
c_y "域名解析到  : ${RESOLVED:-无记录}"
if [ -z "$RESOLVED" ]; then
  die "域名 $DOMAIN 还没有 A 记录。请先到阿里云 DNS 添加 A 记录指向 ${PUBIP}，等 1~5 分钟再跑本脚本。"
fi
if [ -n "$PUBIP" ] && [ "$RESOLVED" != "$PUBIP" ]; then
  die "解析到的 $RESOLVED 与本机 IP $PUBIP 不一致。若不是走 CDN，请先修正 A 记录。"
fi
c_g "DNS 检查通过"

# ------------------------------------------------------------- 3. 连通性预检
c_g "==> 3/7 预检到上游的连通性"
UPCODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${UPSTREAM_HOST}/" || echo 000)"
c_y "https://${UPSTREAM_HOST}/ HTTP $UPCODE"
if [ "$UPCODE" = "000" ]; then
  die "本机连不上上游 $UPSTREAM_HOST。这台机器换了也没用，先解决出口连通性（换地域 / 换机房）。"
fi

# ---------------------------------------------------------------- 4. 装软件
c_g "==> 4/7 安装 nginx + certbot"
if [ "$PKG" = "apt" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nginx certbot python3-certbot-nginx curl ca-certificates
else
  $PKG install -y nginx certbot python3-certbot-nginx curl ca-certificates || die "装包失败"
fi
mkdir -p "$WEBROOT"
systemctl enable --now nginx

# -------------------------------------------------- 5. 临时 HTTP 配置 + 签证
c_g "==> 5/7 申请证书"
# 先只开 80 端口：此时还没有证书文件，不能直接上带 ssl_certificate 的配置。
cat > "$CONF_DST" <<TMPCONF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root ${WEBROOT}; }
    location / { return 200 'pending\n'; add_header Content-Type text/plain; }
}
TMPCONF
nginx -t -q || die "临时配置语法错误"
systemctl reload nginx

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  c_y "已有证书，跳过申请"
else
  certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring \
    || die "证书申请失败。常见原因：80 端口被安全组挡住、DNS 未生效。"
fi
c_g "证书就绪"

# ------------------------------------------------------------ 6. 完整配置
c_g "==> 6/7 写入正式配置"
# 配置文件由本脚本同目录的 nginx-api.giwin.cn.conf 提供；
# 若不存在则内联一份等价配置，保证单文件也能部署。
SRC_CONF="$(dirname "$0")/nginx-api.giwin.cn.conf"
if [ -f "$SRC_CONF" ]; then
  cp "$SRC_CONF" "$CONF_DST"
  sed -i "s/server_name api.giwin.cn;/server_name ${DOMAIN};/" "$CONF_DST"
else
  c_y "同目录未找到 nginx-api.giwin.cn.conf，使用内联配置"
  cat > "$CONF_DST" <<INLINECONF
limit_req_zone \$binary_remote_addr zone=fusion_api:10m rate=60r/m;
limit_conn_zone \$binary_remote_addr zone=fusion_conn:10m;
upstream fusion_upstream { server ${UPSTREAM_HOST}:443; keepalive 32; }
server {
    listen 80; listen [::]:80; server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root ${WEBROOT}; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2; listen [::]:443 ssl http2;
    server_name ${DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    client_max_body_size 80m;
    client_body_timeout 300s;
    limit_req zone=fusion_api burst=30 nodelay;
    limit_conn fusion_conn 16;
    access_log /var/log/nginx/fusion-api.access.log;
    location ~ ^/(v1/|files/|uploads/|p/)\$ {
        proxy_pass https://fusion_upstream;
        proxy_set_header Host ${UPSTREAM_HOST};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Authorization \$http_authorization;
        proxy_ssl_server_name on;
        proxy_ssl_name ${UPSTREAM_HOST};
        proxy_connect_timeout 20s; proxy_send_timeout 300s; proxy_read_timeout 300s;
        proxy_buffering off; proxy_request_buffering off; proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
    location = /__health { access_log off; add_header Content-Type text/plain; return 200 "fusion-proxy ok\n"; }
    location / { return 404; }
}
INLINECONF
fi

nginx -t || die "正式配置语法错误，已保留旧配置未重载"
systemctl reload nginx
c_g "配置已生效"

# ---------------------------------------------------------------- 7. 自检
c_g "==> 7/7 冒烟测试"
sleep 1
HEALTH="$(curl -s --max-time 10 "https://${DOMAIN}/__health" || echo FAIL)"
if [ "$HEALTH" = "fusion-proxy ok" ]; then
  c_g "✓ 健康检查通过"
else
  c_r "✗ 健康检查失败：$HEALTH"
fi

# 用假 key 打 /v1/models：预期 401 —— 说明已经打到上游了（只是鉴权失败）
MODELS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -H 'Authorization: Bearer sk-invalid-probe' "https://${DOMAIN}/v1/models" || echo 000)"
echo
c_y "https://${DOMAIN}/v1/models（假 Key）→ HTTP $MODELS"
if [ "$MODELS" = "401" ] || [ "$MODELS" = "403" ]; then
  c_g "✓ 反代链路通：请求已到上游，被鉴权拦下（这正是预期）"
elif [ "$MODELS" = "000" ]; then
  c_r "✗ 请求没回来，看 /var/log/nginx/fusion-api.error.log"
else
  c_y "… 返回 $MODELS，非预期的 401，请人工确认（可能是上游改了鉴权方式）"
fi

# 拒绝列表验证
BLOCK="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMAIN}/admin/whatever" || echo 000)"
c_y "路径白名单（/admin/whatever）→ HTTP $BLOCK（应为 404）"

# 续期钩子
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

echo
c_g "======================================================================"
c_g " 部署完成"
c_g "   反代地址： https://${DOMAIN}"
c_g "   上游    ： https://${UPSTREAM_HOST}"
c_g "   日志    ： /var/log/nginx/fusion-api.access.log"
c_g "   续期    ： certbot.timer 已接管（systemctl list-timers | grep certbot）"
c_g "======================================================================"
c_y "下一步：在客户端侧把 PROVIDERS.apollo.baseURL 切到 https://${DOMAIN}"
c_y "（改完先用 npm run fusion:probe 验证一把再发版）"
