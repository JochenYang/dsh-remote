<div align="center">

# dsh-remote — Mobile Remote (Desktop Host Side)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/JochenYang/dsh-remote/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JochenYang/dsh-remote/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white&style=flat-square)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7-F69220?logo=pnpm&logoColor=white&style=flat-square)](https://pnpm.io/)
[![Protocol](https://img.shields.io/badge/tunnel_protocol-v1-4c6ef5?style=flat-square)](../docs/PROTOCOL.md)
[![Version](https://img.shields.io/github/v/release/JochenYang/dsh-remote?style=flat-square&label=version)](https://github.com/JochenYang/dsh-remote/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-2ea44f?style=flat-square)](../README.md)

[简体中文](README.md) | English

</div>

> Operate DeepSeek Harness from a phone browser as if it were the desktop:
> a self-hosted `relay-server` shuttles traffic (HTTP reverse proxy + WebSocket
> frame bridging) with zero changes to the dsh core or frontend, and injects a
> mobile adaptation layer automatically.

## Architecture

```
Phone browser ──HTTPS──> relay-server ──WS frames──> dsh-remote (plugin) ──HTTP/WS──> local dsh web server
    │                     │  └────────── downstream event streams ──────────┘     (127.0.0.1:<port>)
    └── pairing: 6-digit code + challenge-response ──┘
```

## Features

- **Full tunnel**: every phone request under `/d/<deviceId>/*` is reverse-proxied
  to the local dsh web server; SSE/blob streams are re-chunked frame-by-frame in
  order; `/events/mux` and `/events/host` are bridged bidirectionally.
- **Trust-header stripping**: `origin` / `sec-fetch-*` / `referer` are removed
  before forwarding so tunneled traffic passes dsh's `/api` Host fence
  (otherwise every API call gets a 403).
- **Settings unlock**: the dsh web client gates its settings mirror on the page
  hostname, which never qualifies behind a relay. The plugin rewrites the single
  ui-settings client bundle in transit, restoring the model catalog, plugin
  config sections and every other settings surface (describe answers are
  redacted upstream; secret material never rides the wire).
- **Mobile adaptation layer**: a responsive stylesheet injected into tunnel
  HTML (`≤720px` full-width chat / full-screen settings sheet / clamped
  dropdowns; `≤1024px` overlay sidebar drawer). Desktop and GUI traffic never
  crosses the plugin, so it stays pixel-identical.
- **Pairing UX**: 6-digit pairing code + QR code; code refresh waits for the
  relay's reply before answering; copy feedback; expired codes flagged in red.
- **Session control**: one click revokes every paired phone session.

## Requirements

- [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness)
  desktop with the `web` profile (the plugin mounts its webServer).
- Node.js ≥ 22 (the agent uses the native global `WebSocket`).
- A deployed self-hosted relay (see [relay-server](../relay-server/README.md)).

## Install

Download `dsh-remote-<ver>.tgz` from [Releases](https://github.com/JochenYang/dsh-remote/releases), then:

```sh
# Install into the dsh web profile, then restart DSH
dsh plugin --profile web add ./dsh-remote-<ver>.tgz
```

Or build from source (inside this directory):

```sh
pnpm install
pnpm build            # host-side esbuild bundle
pnpm build:client     # settings-page client bundle
pnpm pack             # produces dsh-remote-<ver>.tgz
dsh plugin --profile web add ./dsh-remote-<ver>.tgz
```

## Configuration

Open **Settings → Phone Connection**:

| Option | Description |
|---|---|
| Relay URL | the relay's HTTPS address (e.g. `https://relay.example.com`) |
| Relay token | the `HOST_TOKEN` configured at relay deploy time |
| Auto-connect on startup | register with the relay as soon as DSH starts |

Settings persist at `<dshHome>/storages/dsh-remote/config.json`. Once online the
panel shows a 6-digit pairing code (10-minute TTL) and a QR code; pair by
scanning, or by entering the code at `<relay>/pair` on the phone.

## How It Works

- **Uplink**: phone request → relay → this plugin → local dsh web server, with
  the response streamed back frame-by-frame (frame order = stream order).
- **Downstream**: the two dsh event streams (`/events/mux`, `/events/host`) are
  WebSockets; the relay forwards `ws-open/ws-frame/ws-close` frames and the
  plugin mirrors them onto an equivalent local WebSocket.
- **Keepalive**: 30s ping/pong, 90s silence kill; reconnects back off
  exponentially (1s→60s).

Wire formats, handshake flow and security parameters: [docs/PROTOCOL.md](../docs/PROTOCOL.md)
(carry the file along when publishing standalone).

## Development

```sh
pnpm build            # host-side build (esbuild, no type checking)
pnpm typecheck        # host-side type gate
pnpm typecheck:client # settings-page client type gate
pnpm pack             # pack the tgz
```

> The tsconfig `@deepseek-ai/*` type mappings point at a local
> `deepseek-harness` checkout (`../../deepseek-harness`). CI only runs
> build + `node --check`.

## Security

- `HOST_TOKEN` is the relay's single trust boundary; the plugin adds no second
  auth layer and keeps the token local.
- Pairing codes live 10 minutes with one-shot 60s challenges; codes and tokens
  are never logged.
- To the local dsh server, tunneled traffic reads as the loopback client it
  physically is; the trust boundary lives in the relay's phone-session auth.

## License

[MIT](./LICENSE) © 2026 JochenYang
