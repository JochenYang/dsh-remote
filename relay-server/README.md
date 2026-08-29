<div align="center">

# relay-server（dsh-remote-relay）— 自托管手机中继

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white&style=flat-square)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7-F69220?logo=pnpm&logoColor=white&style=flat-square)](https://pnpm.io/)
[![Protocol](https://img.shields.io/badge/tunnel_protocol-v1-4c6ef5?style=flat-square)](../docs/PROTOCOL.md)
[![Version](https://img.shields.io/badge/version-0.1.2-4c6ef5?style=flat-square)](./package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-2ea44f?style=flat-square)](../README.md)

简体中文 | [English](README.en.md)

</div>

> dsh-remote 手机隧道的自托管中继：配对认证、HTTP 反向代理与 WebSocket 帧桥接。
> 单进程、零数据库（JSONL 追加存储），落盘只存 sha256 摘要。

## 架构

```
手机浏览器 ──HTTPS──> relay-server（本服务）──WS 帧──> dsh-remote 插件 ──> 本地 dsh web server
    │                     │  └───────── 下行事件流透传 ─────────┘
    ├── /pair        配对：6 位配对码 + 挑战-响应（HMAC-SHA256）
    ├── /d/<id>/*    HTTP 反向代理（流式保序）
    ├── /admin       管理台（--admin-token 启用）
    └── /ws          host 注册 / 手机握手 控制面
```

## 功能特性

- **配对认证**：6 位配对码（10 分钟 TTL、设备+IP 限速 5 次/分钟）换一次性挑战
  （60s），WebSocket 完成挑战-响应；支持持令牌静默重连。
- **HTTP 反向代理**：请求/响应按 ≤64KiB 帧搬运，帧序即流序（SSE / blob 不受影响）；
  host 离线立即 409；10s 无进度防悬挂。
- **WebSocket 透传**：`/events/*` upgrade 透传为 `ws-open/ws-frame/ws-close` 帧。
- **管理台**：设备总览、配对码与有效期、令牌指纹、断开手机 / 吊销设备 / 删除设备、
  全部/在线/离线筛选；单活跃令牌策略（重新配对自动替换旧令牌）。
- **令牌卫生**：单设备仅一个活跃令牌；孤儿与 30 天前已吊销的令牌加载时自动清理；
  删除设备写入真墓碑，重启不复活。
- **PWA manifest**：无鉴权静态 `/manifest.webmanifest`（浏览器拉取 manifest 不带
  cookie，无法走代理）。

## 前置要求

- Node.js ≥ 22、pnpm 11.x。
- 公网 VPS + TLS 反代（caddy / nginx；安全上下文顺带解决手机端
  `crypto.randomUUID` 等 Secure Context API 限制）。
- 桌面端安装 [dsh-remote](../dsh-remote/README.md) 插件。

## 快速开始（本地联调）

```sh
pnpm install && pnpm build
node dist/cli.js --host-token devtoken-0123456789abcdef --port 8787
# 桌面端 dsh-remote 设置内连接 http://127.0.0.1:8787
```

## 生产部署（VPS）

> **CentOS / Rocky / Alma 一键部署**：构建产物自带 `deploy/install.sh`
> （npm tarball 内），上传解包后 `sudo bash install.sh <你的域名>` 即可——
> 自动装 Node 22、依赖、systemd 服务、caddy TLS 反代与防火墙放行，并生成
> HOST_TOKEN / ADMIN_TOKEN 到 `/etc/dsh-remote-relay.env`。

### 1. 环境与代码

```sh
sudo apt update && sudo apt install -y nodejs npm curl
node -v   # ≥ 22
sudo npm install -g pnpm

git clone <你的仓库地址> ~/dsh-configure
cd ~/dsh-configure/packages/relay-server
pnpm install && pnpm build
```

### 2. 生成令牌

```sh
HOST_TOKEN=$(openssl rand -hex 32)    # 桌面端 host 注册用
ADMIN_TOKEN=$(openssl rand -hex 16)   # 管理台登录用
```

### 3. systemd 服务

```ini
# /etc/systemd/system/dsh-remote-relay.service
[Unit]
Description=dsh-remote relay server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/root/dsh-configure/packages/relay-server
ExecStart=/usr/bin/env pnpm start -- --host-token <HOST_TOKEN> --admin-token <ADMIN_TOKEN> --host 127.0.0.1 --port 8787 --data-dir /var/lib/dsh-remote-relay
Restart=always
RestartSec=3
NoNewPrivileges=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```sh
sudo install -o www-data -d /var/lib/dsh-remote-relay
sudo systemctl daemon-reload && sudo systemctl enable --now dsh-remote-relay
journalctl -u dsh-remote-relay -f
```

> systemd 内仅监听 `127.0.0.1`，公网流量由 caddy 终结 TLS 后转发——不要裸跑 0.0.0.0。

### 4. TLS 反代（caddy，自动证书）

```caddyfile
relay.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
```

### 5. 防火墙与桌面端

```sh
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

桌面端 dsh-remote「设置 → 手机连接」填入中继地址与 `HOST_TOKEN`，
显示"在线"后即可获取配对码。

## CLI 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--host-token <t>` | ✅ | host 注册共享令牌（≥16 字符） |
| `--admin-token <t>` | — | 管理台口令（≥8 字符）；缺省禁用 /admin |
| `--port <n>` | — | 监听端口（默认 8787） |
| `--host <addr>` | — | 监听地址（生产建议 127.0.0.1 + TLS 反代） |
| `--data-dir <dir>` | — | JSONL 存储目录（默认 `~/.dsh-remote-relay`） |
| `--quiet` | — | 静默模式 |

## 路由总览

| 路由 | 作用 |
|---|---|
| `/` | 首页（配对入口） |
| `/pair` | 手机配对（GET 表单页 / POST `{code}` 换挑战+令牌） |
| `/manifest.webmanifest` | 静态 PWA manifest（无鉴权） |
| `/d/<deviceId>/*` | 主代理入口：静态资源与 API 一律转发，WS upgrade 透传 |
| `/admin` | 管理台（需 `--admin-token`） |
| `/ws?role=host\|phone` | host 注册 / 手机握手 控制面 |

## 管理台（/admin）

- **启用**：`--admin-token`；**登录**：浏览器访问 `/admin`，登录态 24h
  （HttpOnly + SameSite=Strict，独立限速 5 次/分钟）。

| 能力 | 说明 |
|---|---|
| 设备总览 | hostName、完整 deviceId、在线状态、最后心跳、注册时间；全部/在线/离线筛选 |
| 配对码 | 当前有效 6 位配对码及剩余有效期（在线主机才有） |
| 令牌指纹 | 每设备令牌 sha256 前缀 + 签发/吊销时间；活跃优先、超出 6 条折叠 |
| 断开手机 | 只断当前手机会话，令牌保留 |
| 吊销设备 | 作废全部令牌 + 断开手机 + 清配对码，并通知在线 host |
| 删除设备 | 仅离线设备可删：清除注册信息、全部令牌与配对记录（不可恢复） |

- **重新连接**：断开手机（轻）→ 手机刷新用仍有效的配对码重配；吊销设备（重）→
  桌面端刷新配对码后重新扫码；删除设备 → 桌面端重连后以新设备身份重新注册。
- 令牌策略：单设备仅一个活跃令牌，重新配对自动替换旧令牌（旧手机需重配）。

## 安全

- 挑战-响应防重放（challenge 60s 一次性）；配对码 10 分钟 TTL + 限速。
- 落盘仅存 `sha256(code)` / `sha256(token)`；日志永不打印 challenge/response/token/code。
- `HOST_TOKEN` 即信任边界：谁持有它谁可注册/接管该 relay 上的 host 身份。
- 手机 cookie 会话 HttpOnly + SameSite=Strict；管理台独立会话与限速。
- 部署必须置于 TLS 之后（文档示例 caddy/nginx）。

协议帧格式、握手流程与安全参数见 [docs/PROTOCOL.md](../docs/PROTOCOL.md)
（独立发布时请随仓库携带该文件）。

## 开发

```sh
pnpm build        # esbuild 产出 dist/
pnpm typecheck    # tsc --noEmit
pnpm pack         # 打包 tgz
```

## License

[MIT](./LICENSE) © 2026 JochenYang
