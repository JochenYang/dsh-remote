<div align="center">

# dsh-remote — DeepSeek Harness in Your Pocket

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/JochenYang/dsh-remote/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JochenYang/dsh-remote/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white&style=flat-square)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7-F69220?logo=pnpm&logoColor=white&style=flat-square)](https://pnpm.io/)
[![Protocol](https://img.shields.io/badge/tunnel_protocol-v1-4c6ef5?style=flat-square)](./docs/PROTOCOL.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-2ea44f?style=flat-square)](./README.md)

[简体中文](README.md) | English

</div>

> Operate the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
> desktop from a phone browser: a self-hosted relay plus a desktop plugin form a
> point-to-point tunnel with zero changes to the dsh core or frontend — and a
> mobile adaptation layer is injected automatically.

## Components

| Directory | Role | Docs |
|---|---|---|
| [`relay-server/`](./relay-server/) | Self-hosted relay: pairing auth, HTTP reverse proxy, WS frame bridging, admin console. Runs on a public VPS behind TLS. | [简体中文](./relay-server/README.md) · [English](./relay-server/README.en.md) |
| [`dsh-remote/`](./dsh-remote/) | Desktop host plugin: registers with the relay and bridges phone traffic to the local dsh web server; ships the mobile adaptation layer and settings page. | [简体中文](./dsh-remote/README.md) · [English](./dsh-remote/README.en.md) |
| [`docs/PROTOCOL.md`](./docs/PROTOCOL.md) | The tunnel protocol contract (v1) shared by both ends: frames, handshake, security boundaries. | — |

## Architecture

```
Phone browser ──HTTPS──> relay-server ──WS frames──> dsh-remote plugin ──HTTP/WS──> local dsh web server
    │                     │  └──────── downstream event streams (/events/*) ────────┘
    │                                                                   (127.0.0.1:<port>)
    ├── uplink: everything under /d/<deviceId>/* is proxied; frame order = stream order
    ├── pairing: 6-digit code + one-shot challenge-response (HMAC-SHA256); HOST_TOKEN is the trust boundary
    └── security: only sha256 digests hit the disk; tokens and codes never reach the logs
```

## Quick Start

1. **Deploy the relay** (public VPS, Node ≥ 22 + caddy TLS):
   `pnpm build` inside `relay-server/`, then follow its README's systemd +
   caddy steps; on CentOS/Rocky/Alma the bundled
   `deploy/install.sh <domain>` does it in one shot.
2. **Install the plugin** (desktop DSH with the web profile):
   inside `dsh-remote/` run `pnpm build && pnpm build:client && pnpm pack`,
   then `dsh plugin --profile web add ./dsh-remote-<ver>.tgz` and restart DSH.
3. **Pair**: fill the relay URL and `HOST_TOKEN` under
   **Settings → Phone Connection**; scan the QR code on the phone, or enter the
   6-digit code at `<relay>/pair` to get the same workspace as the desktop.

## Mobile Adaptation (highlight)

The stock dsh web UI is desktop-only; this repo fills in a complete mobile
experience **inside the tunnel**:

- full-width chat text and composer (layout custom properties re-declared,
  non-invasively);
- full-screen settings sheet with a horizontal nav strip; viewport-clamped
  model dropdown;
- sidebar as an overlay drawer (no more squeezing the chat);
- the keyboard no longer covers the composer
  (`interactive-widget=resizes-content`).

The stylesheet is injected into tunnel traffic only — desktop / GUI rendering
is untouched. Every anchor avoids build-time class hashes; if a dsh upgrade
changes the structure the shim degrades back to the stock desktop layout.

## Security Model

- `HOST_TOKEN` is the relay's single trust boundary; pairing uses one-shot
  challenge-response with anti-replay.
- Only `sha256(code)` / `sha256(token)` are persisted; logs are scrubbed.
- Phones authenticate via HttpOnly session cookies; the admin console has its
  own password and session store.
- Always deploy behind TLS (full systemd + caddy examples in the READMEs).

Full threat model and wire formats: [docs/PROTOCOL.md](./docs/PROTOCOL.md).

## Development

Both packages are standalone pnpm projects:

```sh
cd relay-server && pnpm install && pnpm build && pnpm typecheck
cd dsh-remote  && pnpm install && pnpm build && pnpm typecheck
```

> The dsh-remote tsconfig type mappings point at a local deepseek-harness
> checkout (`../../deepseek-harness`). CI only runs build + `node --check`.

## License

[MIT](./LICENSE) © 2026 JochenYang
