#!/usr/bin/env bash
# dsh-remote-relay one-shot installer for CentOS / Rocky / Alma.
# Usage: sudo bash install.sh <your.domain.com>
#
# Installs: Node 22 (NodeSource), production deps (ws), systemd unit,
#           caddy reverse proxy with automatic TLS, firewalld rules.
# Tokens are generated, saved to /etc/dsh-remote-relay.env (chmod 600),
# and printed at the end for the desktop plugin + admin console.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "用法: sudo bash install.sh <你的域名>" >&2
  echo "例如: sudo bash install.sh relay.example.com" >&2
  exit 1
fi

INSTALL_DIR="/opt/dsh-remote-relay"
DATA_DIR="/var/lib/dsh-remote-relay"
ENV_FILE="/etc/dsh-remote-relay.env"

echo "==> 检测包管理器 (CentOS/Rocky/Alma)"
if command -v dnf >/dev/null 2>&1; then
  PKG="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG="yum"
else
  echo "错误: 仅支持 CentOS/Rocky/Alma (dnf/yum)" >&2
  exit 1
fi
echo "    使用: $PKG"

echo "==> 检查域名解析到本机"
PUBLIC_IP=$(curl -4 -fsSL --max-time 10 https://api.ipify.org || true)
RESOLVED_IP=$(getent ahostsv4 "$DOMAIN" | awk '{ print $1; exit }' || true)
if [[ -n "$PUBLIC_IP" && -n "$RESOLVED_IP" ]]; then
  if [[ "$PUBLIC_IP" == "$RESOLVED_IP" ]]; then
    echo "    ✔ $DOMAIN -> $RESOLVED_IP (匹配本机公网 IP)"
  else
    echo "    ⚠ $DOMAIN -> $RESOLVED_IP，本机公网 IP 为 $PUBLIC_IP，请先把 A 记录指过来" >&2
    echo "    继续安装，但证书签发可能失败" >&2
  fi
else
  echo "    ⚠ 无法自动校验解析（无出网或被防火墙拦截），继续安装" >&2
fi

echo "==> 安装 Node 22 (NodeSource)"
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
$PKG install -y nodejs openssl

NODE_VERSION=$(node -v)
echo "    Node $NODE_VERSION"

echo "==> 部署文件到 $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
cp -r dist package.json "$INSTALL_DIR/"
if [[ -f README.md ]]; then
  cp README.md "$INSTALL_DIR/" || true
fi

echo "==> 安装生产依赖 (ws)"
cd "$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1

echo "==> 生成令牌"
HOST_TOKEN=$(openssl rand -hex 32)
ADMIN_TOKEN=$(openssl rand -hex 16)
umask 077
cat > "$ENV_FILE" <<EOF
HOST_TOKEN=$HOST_TOKEN
ADMIN_TOKEN=$ADMIN_TOKEN
EOF
chmod 600 "$ENV_FILE"

echo "==> 写入 systemd 服务"
cat > /etc/systemd/system/dsh-remote-relay.service <<UNIT
[Unit]
Description=dsh-remote relay server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/env node dist/cli.js --host-token \${HOST_TOKEN} --admin-token \${ADMIN_TOKEN} --host 127.0.0.1 --port 8787 --data-dir $DATA_DIR
Restart=always
RestartSec=3
NoNewPrivileges=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now dsh-remote-relay

echo "==> 安装 caddy (TLS 反代)"
if ! command -v caddy >/dev/null 2>&1; then
  $PKG install -y 'dnf-command(copr)' || true
  $PKG copr enable -y '@caddy/caddy'
  $PKG install -y caddy
fi

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
CADDY

systemctl enable --now caddy

echo "==> 防火墙放行 80/443"
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

echo ""
echo "================================================================"
echo "✔ 部署完成"
echo "================================================================"
echo "  中继监听: 127.0.0.1:8787 (仅本机，公网流量走 caddy TLS)"
echo "  管理台:   https://$DOMAIN/admin"
echo ""
echo "  桌面端 dsh-remote 插件 → 设置 → 手机连接:"
echo "    中继地址: https://$DOMAIN"
echo "    中继令牌: $HOST_TOKEN"
echo ""
echo "  管理台口令: $ADMIN_TOKEN"
echo ""
echo "  (令牌已存 $ENV_FILE，可随时 cat 查看)"
echo ""
echo "  排障:"
echo "    journalctl -u dsh-remote-relay -f    中继日志"
echo "    journalctl -u caddy -f               caddy/证书日志"
echo "    若证书签发失败: 确认域名 A 记录已指向本机 IP、80/443 放行"
echo "================================================================"