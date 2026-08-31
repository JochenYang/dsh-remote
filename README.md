<div align="center">

# dsh-remote — 手机上的 DeepSeek Harness

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/JochenYang/dsh-remote/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JochenYang/dsh-remote/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white&style=flat-square)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7-F69220?logo=pnpm&logoColor=white&style=flat-square)](https://pnpm.io/)
[![Protocol](https://img.shields.io/badge/tunnel_protocol-v1-4c6ef5?style=flat-square)](./docs/PROTOCOL.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-2ea44f?style=flat-square)](./README.md)

简体中文 | [English](README.en.md)

</div>

> 用手机浏览器完整操作 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面端：
> 自托管中继 + 桌面插件的点对点隧道，不改 dsh 内核与前端，
> 并为手机自动注入移动适配层。

## 组成

| 目录 | 角色 | 文档 |
|---|---|---|
| [`relay-server/`](./relay-server/) | 自托管中继：配对认证、HTTP 反向代理、WS 帧桥接、管理台。部署在公网 VPS（TLS 之后）。 | [简体中文](./relay-server/README.md) · [English](./relay-server/README.en.md) |
| [`dsh-remote/`](./dsh-remote/) | 桌面 host 插件：注册到中继，把手机流量桥接到本地 dsh web server；内置移动适配层与设置页。 | [简体中文](./dsh-remote/README.md) · [English](./dsh-remote/README.en.md) |
| [`docs/PROTOCOL.md`](./docs/PROTOCOL.md) | 两端共同遵守的隧道协议契约（v1）：帧格式、握手、安全边界。 | — |

## 架构

```
手机浏览器 ──HTTPS──> relay-server ──WS 帧──> dsh-remote 插件 ──HTTP/WS──> 本地 dsh web server
    │                    │  └─────────── 下行事件流透传（/events/*）────────────┘
    │                                                               (127.0.0.1:<port>)
    ├── 上行：/d/<deviceId>/* 全量反代，帧序即流序（SSE / blob 不受影响）
    ├── 配对：6 位配对码 + 一次性挑战-响应（HMAC-SHA256），HOST_TOKEN 为信任边界
    └── 安全：落盘只存 sha256 摘要；日志永不打印令牌与配对码
```

## 快速开始

1. **部署中继**（公网 VPS，Node ≥ 22 + caddy TLS）：
   `relay-server/` 内 `pnpm build` 后按其 README 的 systemd + caddy 步骤部署；
   CentOS/Rocky/Alma 可用自带 `deploy/install.sh <域名>` 一键完成。
2. **安装插件**（桌面 DSH，含 web profile）：
   从 [Releases](https://github.com/JochenYang/dsh-remote/releases) 下载 `dsh-remote-<ver>.tgz`，
   `dsh plugin --profile web add ./dsh-remote-<ver>.tgz` 并重启 DSH。
   从源码构建：`dsh-remote/` 内 `pnpm install && pnpm build && pnpm build:client && pnpm pack`。
3. **配对**：桌面 **设置 → 手机连接** 填中继地址与 `HOST_TOKEN`，
   手机扫二维码或在 `<relay>/pair` 输入 6 位配对码即可进入与桌面同源的操作界面。

## 移动适配（亮点）

dsh 自带 web 界面是纯桌面布局，本仓库在**隧道内**为手机补齐了完整移动体验：

- 聊天正文与输入卡片全宽（重定义布局 CSS 变量，非侵入）；
- 设置弹窗全屏化、导航横滑条；模型下拉视口钳制；
- 侧栏抽屉化（展开时悬浮，不再挤压聊天区）；
- 键盘不再遮挡输入框（`interactive-widget=resizes-content`）。

适配样式只注入隧道流量，桌面 / GUI 打开的界面零变化；锚点全部避开构建期
hash 类名，dsh 升级若结构变化则自动退回原生桌面布局，不会更糟。

## 安全模型

- `HOST_TOKEN` 是 relay 的唯一信任边界；配对走一次性挑战-响应，防重放。
- 中继落盘只存 `sha256(code)` / `sha256(token)`；日志脱敏。
- 手机经 HttpOnly 会话 cookie 认证；管理台独立口令与会话。
- 部署必须置于 TLS 之后（README 提供 systemd + caddy 完整示例）。

完整威胁模型与帧格式见 [docs/PROTOCOL.md](./docs/PROTOCOL.md)。

## 开发

两个包均为独立 pnpm 项目：

```sh
cd relay-server && pnpm install && pnpm build && pnpm typecheck
cd dsh-remote  && pnpm install && pnpm build && pnpm typecheck
```

> `dsh-remote` 的 tsconfig 类型映射指向本机的 deepseek-harness 检出
> （`../../deepseek-harness`），CI 只做构建与 `node --check`。

## License

[MIT](./LICENSE) © 2026 JochenYang
