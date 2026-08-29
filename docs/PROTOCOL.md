# dsh-remote 隧道协议 v1（契约）

> **本文件是 `dsh-remote`（桌面插件 / agent）与 `relay-server`（中继）两端共同遵守的唯一契约。**
> 任何一端改动帧格式、握手流程或安全参数，必须先改本文件，再同步两端实现。

## 1. 拓扑与数据平面

```
手机浏览器 ──HTTP(S)──> relay-server ──WS(JSON 帧)──> dsh-remote 插件(host) ──HTTP──> 127.0.0.1:dshWebPort
     │                       │  ─────────── 下行 WS 透传帧 ──────────>        ──WS──> 127.0.0.1:dshWebPort
     └─────WS(upgrade)──────>                         (events/mux, events/host)
```

- **控制平面**：所有会话（host 注册 / 手机认证 / 心跳 / 吊销）走 WebSocket 文本帧（JSON）。
- **数据平面一（HTTP）**：手机浏览器对 `/d/<deviceId>/*` 发起的全部 HTTP 请求，由 relay 转发给 host 会话；
  host 请求本地 dsh web server，把响应按帧流式回传。dsh 前端以 `location.origin` 为 API base
  （`packages/client/connection/src/client/rpc.ts` `resolveBase()`），因此中继后**零改写**即可工作。
- **数据平面二（WebSocket 下行）**：dsh 前端开销最少两条下行事件流
  （`/events/mux`、`/events/host`，见 `web-api-client.ts`）。手机对同路径的 upgrade
  由 relay 透传为 `ws-open/ws-frame/ws-close` 帧，host 在本地建立等价 WS 后双向搬运。

## 2. 通用规则

- 所有帧均为 UTF-8 JSON 文本，必含字段 `t`（type）。未知帧类型一律忽略并记日志。
- 每个 WebSocket 连接生命周期：`hello` 认证 → 业务帧 → `ping/pong` 保活 → 关闭。
- 字节数组统一 `dataBase64`（Base64 字符串）。
- 编解码双方约定：WebSocket 每帧 ≤ 64 KiB；HTTP 大 body 分帧，见 §5。

## 3. Host 注册（桌面端 → relay）

URI：`wss://<relay>/ws?role=host`

```json
{ "t": "hello", "v": 1, "role": "host",
  "deviceId": "32-hex",
  "hostToken": "部署时在 relay 配置的共享令牌" }
```

| 方向 | 帧 | 说明 |
|---|---|---|
| relay→host | `{ "t":"hello-ok", "deviceId":"…", "hostName":"…", "pair": { "code":"123456", "expiresAt":1787914800000 } \| null }` | 认证成功；`pair` 为当前有效配对码（可能为 null，表示未生成或已过期） |
| relay→host | `{ "t":"hello-deny", "reason":"BAD_TOKEN" \| "UNKNOWN_DEVICE" }` 后关闭 | 认证失败 |

配套：host 主动换码 `{ "t":"pair-refresh" }` → `{ "t":"pair", "code":"…", "expiresAt":… }`。

错误码：`BAD_TOKEN`（hostToken 不符）、`UNKNOWN_DEVICE`（relay 未注册该 deviceId，首次需先用 token 注册——`register` 见 §9）。

## 4. 手机认证（挑战-响应 + 长令牌）

**Step 1 — 取挑战（HTTP）**：手机 POST `https://<relay>/pair`，body `{ "code": "123456" }`。
relay 校验配对码（10 分钟 TTL、设备/IP 5 次/分钟限速），成功返回：

```json
{ "ok": true, "deviceId": "…", "challenge": "random-32-byte-hex", "challengeTtlMs": 60000, "token": "random-32-byte-hex" }
```

**Step 2 — WebSocket 完成握手**：`wss://<relay>/ws?role=phone`

```json
{ "t": "hello", "v": 1, "role": "phone",
  "deviceId": "…",
  "challenge": "…", "response": "…",
  "token": "…" }
```

- `response = HMAC-SHA256( key = SHA256(code), msg = challenge )`，hex。
- relay 校验顺序：challenge 存在且未过期（一次性）→ `response` 相等 → token 绑定该 deviceId。
- 成功：`{ "t":"hello-ok", "peer": { "online": true, "hostName": "…" } }`，并通知 host
  `{ "t":"peer", "state":"online", "ua": "…" }`。

**已配对重连**：手机已持有 token 时，Step 1 可跳过，直接 `hello` 带 `token`（不带 `challenge`）即可。

**吊销**：host 发 `{ "t":"revoke" }` → relay 删除该 deviceId 全部 token 与配对码、断开在线手机，回 `{ "t":"revoked" }`。

## 5. HTTP 反向代理帧

手机浏览器请求 `https://<relay>/d/<deviceId>/<...rest>`（含 query）时，relay 剥离 `/d/<deviceId>` 前缀，
为其分配单调递增 `id`，并按顺序转发（host 离线→立即 `409 X-Dsh-Relay: host offline`）。

| 方向 | 帧 | 说明 |
|---|---|---|
| relay→host | `{ "t":"http-req", "id":3, "method":"POST", "path":"/api/chat", "query":"?a=1", "headers":{…}, "bodyBase64":"…"\|null }` | `headers` 为小写 key 的 plain 对象；body ≤ 64 KiB 时内联 |
| relay→host | `{ "t":"http-body", "id":3, "dataBase64":"…" }` | 大 body 分帧，可多条 |
| relay→host | `{ "t":"http-body-end", "id":3 }` | body 结束 |
| relay→host | `{ "t":"http-abort", "id":3 }` | 手机侧连接中止 |
| host→relay | `{ "t":"http-head", "id":3, "status":200, "headers":{…} }` | 响应头；host 转发时删 hop-by-hop 头（connection/keep-alive/transfer-encoding…） |
| host→relay | `{ "t":"http-chunk", "id":3, "dataBase64":"…" }` | 响应体分块，逐块 flush |
| host→relay | `{ "t":"http-end", "id":3 }` | 响应结束（relay 侧结束手机响应流） |
| host→relay | `{ "t":"http-err", "id":3, "code":"UPSTREAM_DOWN", "message":"…" }` | 上游错误；relay 侧以 502/504 结束 |

**流式与背压（关键语义）**：
- relay 收到 `http-head` 后立刻向手机 `writeHead`，随后每个 `http-chunk` 顺序 `write`——**保持帧序即保持流序**，
  dsh 前端的 `text/event-stream` / blob 流不受影响。
- 两端各维护每请求待处理缓冲区，`http-body/http-chunk` 都待前帧落发后再发下一帧（简单串行），MVP 不做滑动窗口；
  10 秒无 `http-*` 进度则 relay 断手机连接（防悬挂）。
- host 转发上游请求时：`Host` 重写为 `127.0.0.1:<dshWebPort>`，并移除 `sec-websocket-*`（见 §6）与 X-Forwarded-*（由 host 由自身补 `X-Dsh-Relay` 标头）。

## 6. WebSocket 下行透传帧

手机对 `/d/<deviceId>/events/*` 发起 upgrade 时：

| 方向 | 帧 | 说明 |
|---|---|---|
| relay→host | `{ "t":"ws-open", "id":7, "path":"/events/mux", "headers":{ "sec-websocket-protocol":"…" } }` | relay 已接受 upgrade，等待 host 建立本地 WS |
| host→relay | `{ "t":"ws-open-ok", "id":7 }`；失败 `{ "t":"ws-open-err", "id":7, "reason":"…" }` → relay 关闭手机侧 socket | |
| 双向 | `{ "t":"ws-frame", "id":7, "opcode":1\|2, "dataBase64":"…" }` | `1`=text、`2`=binary；顺序透传 |
| 双向 | `{ "t":"ws-close", "id":7, "code":1000, "reason":"…" }` | 任一方向触发后全链路关闭 |

host 在本地使用 Node 原生 `WebSocket`（globalThis，Node 22+）连接
`ws://127.0.0.1:<dshWebPort><path>`，建立成功回 `ws-open-ok` 后开始搬运。

## 7. 心跳与断线

- 每 30 秒 `{ "t":"ping" }`，对端回 `{ "t":"pong" }`；90 秒无响应判死关闭。
- host 断线：指数退避重连（1s→2s→4s…上限 60s），重连后重发 `hello`。
- relay 向手机的 HTTP 请求在 host 离线时立即失败（见 §5），前端自带 `connection stream loop` 重连逻辑，无需额外处理。

## 8. 手机端页面（relay 托管）

| 路由 | 说明 |
|---|---|
| `/` | 首页（项目名 + 二维码/配对码入口） |
| `/pair` | 配对页：GET 表单页，POST `{code}` 换挑战，成功后保存 token 到 localStorage 并 `302 → /d/<deviceId>/` |
| `/manifest.webmanifest` | 静态 PWA manifest（无鉴权；浏览器拉取 manifest 时 `credentials: 'omit'`，永远到不了 cookie 回退） |
| `/d/<deviceId>/*` | 主代理入口：静态资源 + API 一律转发；用户受持 token 会话保护（页面内 WS 握手带 token 在上行请求头 `x-dsh-relay-token` 中） |

> 手机端 WS 认证：前端 WS 连接不带 query token（避免 URL 泄露），改用上行 HTTP 请求头
> `x-dsh-relay-token`；relay 以该标头识别手机身份并校验其排序（§4 token）。
> dsh 前端对 WS 路径发 upgrade 时无自定义头——因此**必须**由 relay 在已知
> 手机 token 的前提下，用 token → 会话映射注入 `x-dsh-relay-token` 之后再转发给 host。
> 简化实现：relay 在代理层维护 `cookie/phrase → session`，页面首载 GET（带 token 头）成功后
> 下发 HttpOnly cookie `dsh-relay=<sessionId>`，后续浏览器对同一 origin 自动携带该 cookie，
> relay 由 cookie 识别手机身份并把 `x-dsh-relay-token` 附加到此手机发起的全部
> upgrade / fetch 转发中。（实现细节以 relay-server 为准，契约只约束「身份可追溯到手机会话」这一语义。）

## 9. Relay 数据存储（JSONL，原子追加）

`<dataDir>/relay.jsonl`（默认 `~/.dsh-remote-relay/relay.jsonl`）：

```json
{ "type": "device", "deviceId": "…", "hostName": "…", "createdAt": 1787914800000 }
{ "type": "pairing", "deviceId": "…", "codeSha": "sha256(code) hex", "expiresAt": … }
{ "type": "token",  "deviceId": "…", "tokenSha": "…", "createdAt": …, "revokedAt": null }
```

host 首次注册（`hello` 带 `hostToken` 且 deviceId 未知）→ 自动注册 device（写 device 行）。

## 10. 安全边界（明确承诺）

- relay 必须部署于 TLS 之后（文档给出 caddy/nginx 反代示例）；帧内无明文密钥。
- `HOST_TOKEN` 是 relay 侧唯一信任边界：谁持有它谁可注册/接管该 relay 上的 host 身份（自托管前提）。
- 挑战-响应防重放：challenge 一次性、60s TTL；code 10 分钟 TTL、限速 5 次/分/设备+IP。
- 仓库内不存 code 明文（存 sha256）；token 落盘只存 sha256。
- 默认每 deviceId 仅允许 1 个并发手机；重新配对（再次 POST `/pair`）会自动替换该设备上一个活跃令牌，旧手机需重新配对；host 可随时 `revoke`。
- 日志脱敏：永不打印 challenge/response/token/code。