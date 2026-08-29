<div align="center">
# dsh-remote — 手机远程连接（桌面 host 端）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white&style=flat-square)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7-F69220?logo=pnpm&logoColor=white&style=flat-square)](https://pnpm.io/)
[![Protocol](https://img.shields.io/badge/tunnel_protocol-v1-4c6ef5?style=flat-square)](../docs/PROTOCOL.md)
[![Version](https://img.shields.io/badge/version-0.1.9-4c6ef5?style=flat-square)](./package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-2ea44f?style=flat-square)](../README.md)

简体中文 | [English](README.en.md)

</div>

> 让手机浏览器像桌面端一样操作 DeepSeek Harness：
> 通过自托管 `relay-server` 中转（HTTP 反向代理 + WebSocket 帧桥接），
> 无需改 dsh 内核与前端，并自动为手机注入移动适配层。

## 架构

```
手机浏览器 ──HTTPS──> relay-server ──WS 帧──> dsh-remote（本插件）──HTTP/WS──> 本地 dsh web server
    │                    │  └──────── 下行事件流透传 ────────┘        (127.0.0.1:<port>)
    └── 配对：6 位配对码 + 挑战-响应 ──┘
```

## 功能特性

- **完整隧道**：手机对 `/d/<deviceId>/*` 的全部请求反代到本地 dsh web server，
  SSE / blob 流式响应逐帧保序回传；`/events/mux`、`/events/host` 双向 WS 桥接。
- **信任头剥离**：转发前剥离 `origin` / `sec-fetch-*` / `referer` 等浏览器信任头，
  让隧道流量通过 dsh 的 `/api` Host 防线（否则所有 API 调用 403）。
- **settings 解锁**：dsh 前端按页面 hostname 判定 settings 可用性，隧道会话会被
  判为"不可用"；插件在转发时对唯一的 ui-settings 客户端 bundle 做定点改写，
  恢复模型目录、插件配置等全部设置面（响应本身已脱敏，密钥材料从不上线）。
- **移动适配层**：向隧道 HTML 注入响应式样式（`≤720px` 聊天全宽 / 设置弹窗全屏化 /
  下拉钳制，`≤1024px` 侧栏抽屉化）——桌面与 GUI 流量不经过插件，零影响。
- **配对体验**：6 位配对码 + 二维码扫码直达；刷新配对码等待中继回包后即返回新码；
  复制带成功/失败反馈；过期码红字提示。
- **会话管控**：一键吊销全部手机会话（relay 侧作废令牌并断开在线手机）。

## 前置要求

- [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 桌面端，
  含 `web` profile（本插件挂载其 webServer）。
- Node.js ≥ 22（agent 使用原生全局 `WebSocket`）。
- 一个已部署的自托管 relay（见 [relay-server](../relay-server/README.md)）。

## 安装

```sh
# 在本包目录构建打包
pnpm install
pnpm build            # host 端 esbuild 产物
pnpm build:client     # 设置页 client bundle
pnpm pack             # 产出 dsh-remote-<ver>.tgz

# 装入 dsh 的 web profile 并重启 DSH
dsh plugin --profile web add ./dsh-remote-<ver>.tgz
```

## 配置

打开 **设置 → 手机连接**：

| 配置项 | 说明 |
|---|---|
| 中继地址 | relay 的 HTTPS 地址（如 `https://relay.example.com`） |
| 中继令牌 | relay 部署时配置的 `HOST_TOKEN`（自托管信任边界） |
| 启动时自动连接 | DSH 启动后自动注册到 relay |

配置持久化于 `<dshHome>/storages/dsh-remote/config.json`。连接成功后面板展示
6 位配对码（10 分钟有效）与二维码，手机扫码或访问 `<relay>/pair` 输码即完成配对。

## 工作原理

- **上行**：手机对 `/d/<deviceId>/*` 的 HTTP 请求 → relay → host（本插件）
  → 本地 dsh web server，响应按帧流式回传（帧序即流序）。
- **下行**：dsh 前端的两条事件流（`/events/mux`、`/events/host`）为 WebSocket，
  relay 透传 `ws-open/ws-frame/ws-close` 帧，本插件在本地建立等价 WS 双向搬运。
- **保活**：30s ping/pong，90s 静默判死；断线指数退避重连（1s→60s）。

协议帧格式、握手流程与安全参数见 [docs/PROTOCOL.md](../docs/PROTOCOL.md)
（独立发布时请随仓库携带该文件）。

## 开发

```sh
pnpm build            # host 端构建（esbuild，不做类型检查）
pnpm typecheck        # host 端类型门
pnpm typecheck:client # 设置页 client 类型门
pnpm pack             # 打包 tgz
```

> tsconfig 的 `@deepseek-ai/*` 类型映射指向本机 `D:\codes\deepseek-harness`
> 检出（`../../deepseek-harness`）；CI 只做构建与 `node --check`。

## 安全

- `HOST_TOKEN` 是 relay 侧唯一信任边界；本插件不做二次鉴权，令牌只存本机。
- 配对码 10 分钟 TTL、一次性挑战（60s）；日志不打印 code/token。
- 隧道流量对本地 dsh 而言等同回环客户端，信任边界在 relay 的手机会话认证。

## License

[MIT](./LICENSE) © 2026 JochenYang
