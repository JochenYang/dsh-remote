<div align="center">

# relay-server (dsh-remote-relay) — Self-hosted Mobile Relay

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white&style=flat-square)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7-F69220?logo=pnpm&logoColor=white&style=flat-square)](https://pnpm.io/)
[![Protocol](https://img.shields.io/badge/tunnel_protocol-v1-4c6ef5?style=flat-square)](../docs/PROTOCOL.md)
[![Version](https://img.shields.io/badge/version-0.1.2-4c6ef5?style=flat-square)](./package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-2ea44f?style=flat-square)](../README.md)

[简体中文](README.md) | English

</div>

> The self-hosted relay of the dsh-remote mobile tunnel: pairing auth, HTTP
> reverse proxy and WebSocket frame bridging. Single process, zero database
> (append-only JSONL), only sha256 digests ever hit the disk.

## Architecture

```
Phone browser ──HTTPS──> relay-server (this service) ──WS frames──> dsh-remote plugin ──> local dsh web server
    │                      │  └─────────── downstream event streams ──────────┘
    ├── /pair        pairing: 6-digit code + challenge-response (HMAC-SHA256)
    ├── /d/<id>/*    HTTP reverse proxy (order-preserving streaming)
    ├── /admin       admin console (enabled by --admin-token)
    └── /ws          host registration / phone handshake control plane
```

## Features

- **Pairing auth**: 6-digit code (10-minute TTL, 5 attempts/min per device+IP)
  exchanged for a one-shot challenge (60s); the WebSocket completes the
  challenge-response; token-bearing silent reconnect supported.
- **HTTP reverse proxy**: requests/responses move in ≤64 KiB frames — frame
  order is stream order (SSE/blob untouched); immediate 409 when the host is
  offline; 10s no-progress watchdog.
- **WebSocket passthrough**: `/events/*` upgrades are relayed as
  `ws-open/ws-frame/ws-close` frames.
- **Admin console**: device overview, pairing codes with countdown, token
  fingerprints, disconnect / revoke / remove, all/online/offline filters;
  single-active-token policy (re-pairing displaces the previous token).
- **Token hygiene**: one active token per device; orphaned tokens and tokens
  revoked over 30 days ago are pruned at load; device removal writes a real
  tombstone that survives restarts.
- **PWA manifest**: unauthenticated static `/manifest.webmanifest` (browsers
  fetch manifests without cookies, so it cannot ride the proxy).

## Requirements

- Node.js ≥ 22, pnpm 11.x.
- A public VPS behind TLS (caddy / nginx; the secure context also lifts
  phone-side `crypto.randomUUID` and other Secure Context API limits).
- The [dsh-remote](../dsh-remote/README.md) plugin on the desktop.

## Quick Start (local dev)

```sh
pnpm install && pnpm build
node dist/cli.js --host-token devtoken-0123456789abcdef --port 8787
# point the dsh-remote plugin at http://127.0.0.1:8787
```

## Production Deployment (VPS)

> **CentOS / Rocky / Alma one-shot**: the build ships `deploy/install.sh`
> (inside the npm tarball). Upload, unpack, run
> `sudo bash install.sh <your-domain>` — it installs Node 22, dependencies,
> the systemd service, the caddy TLS reverse proxy and firewall rules, and
> writes HOST_TOKEN / ADMIN_TOKEN to `/etc/dsh-remote-relay.env`.

### 1. Environment

```sh
sudo apt update && sudo apt install -y nodejs npm curl
node -v   # ≥ 22
sudo npm install -g pnpm

git clone <your-repo> ~/dsh-configure
cd ~/dsh-configure/packages/relay-server
pnpm install && pnpm build
```

### 2. Tokens

```sh
HOST_TOKEN=$(openssl rand -hex 32)    # desktop host registration
ADMIN_TOKEN=$(openssl rand -hex 16)   # admin console login
```

### 3. systemd service

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

> Listen on `127.0.0.1` inside systemd and let caddy terminate TLS — never
> expose the raw port on 0.0.0.0.

### 4. TLS reverse proxy (caddy, automatic certificates)

```caddyfile
relay.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
```

### 5. Firewall & desktop

```sh
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

Fill in the relay URL and `HOST_TOKEN` in the dsh-remote plugin
(**Settings → Phone Connection**); once it shows "online", pairing codes are
available.

## CLI Flags

| Flag | Required | Description |
|---|---|---|
| `--host-token <t>` | ✅ | shared host registration token (≥16 chars) |
| `--admin-token <t>` | — | admin console password (≥8 chars); /admin disabled when absent |
| `--port <n>` | — | listen port (default 8787) |
| `--host <addr>` | — | bind address (production: 127.0.0.1 + TLS proxy) |
| `--data-dir <dir>` | — | JSONL store directory (default `~/.dsh-remote-relay`) |
| `--quiet` | — | quiet mode |

## Routes

| Route | Purpose |
|---|---|
| `/` | landing page (pairing entry) |
| `/pair` | phone pairing (GET form / POST `{code}` for challenge + token) |
| `/manifest.webmanifest` | static PWA manifest (unauthenticated) |
| `/d/<deviceId>/*` | main proxy surface: assets & API forwarded, WS upgrades bridged |
| `/admin` | admin console (requires `--admin-token`) |
| `/ws?role=host\|phone` | host registration / phone handshake control plane |

## Admin Console (/admin)

- **Enable**: `--admin-token`; **login**: open `/admin`; sessions last 24h
  (HttpOnly + SameSite=Strict, dedicated 5/min rate limit).

| Capability | Description |
|---|---|
| Device overview | hostName, full deviceId, online state, last heartbeat, created at; all/online/offline filters |
| Pairing code | current 6-digit code with countdown (online hosts only) |
| Token fingerprints | sha256 prefixes with issue/revoke times; active first, older rows folded |
| Disconnect phones | drops current phone sessions only; tokens preserved |
| Revoke device | invalidates all tokens, disconnects phones, clears pairing codes, notifies the host |
| Remove device | offline devices only: erases registration, all tokens and pairings (irreversible) |

- **Reconnecting**: disconnect (light) → phone refreshes and re-pairs with the
  still-valid code; revoke (heavy) → refresh the code on the desktop and re-scan;
  remove → the desktop re-registers as a new device on its next hello.
- Token policy: one active token per device; re-pairing displaces the previous
  token (the old phone must re-pair).

## Security

- Challenge-response anti-replay (one-shot 60s challenges); 10-minute pairing
  codes with rate limits.
- Only `sha256(code)` / `sha256(token)` are persisted; challenge, response,
  token and code are never logged.
- `HOST_TOKEN` is the trust boundary: whoever holds it owns the host identity
  on this relay.
- Phone cookie sessions are HttpOnly + SameSite=Strict; the admin console has
  its own session store and rate limiting.
- Always deploy behind TLS (caddy/nginx examples above).

Wire formats, handshake flow and security parameters: [docs/PROTOCOL.md](../docs/PROTOCOL.md)
(carry the file along when publishing standalone).

## Development

```sh
pnpm build        # esbuild → dist/
pnpm typecheck    # tsc --noEmit
pnpm pack         # pack the tgz
```

## License

[MIT](./LICENSE) © 2026 JochenYang
