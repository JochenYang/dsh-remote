# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
each package versioned independently (semver).

## relay-server

### 0.1.3 - 2026-09-01

#### Fixed

- Host reconnect race no longer strands a device as offline: a displaced host
  socket's `close` (or heartbeat timeout) used to `unregisterHost(deviceId)`
  unconditionally, wiping the *newer* host that had just replaced it. With two
  desktop instances flapping on the same deviceId, the relay then had a healthy
  live host socket (ping/pong fine) that phone routes never reached — phone
  requests answered `409 host offline` indefinitely. Both teardown paths now
  only unregister when the closing socket is still the device's registered host.

### 0.1.2 - 2026-08-29

#### Added

- Admin device removal (`POST /admin/api/remove`): forget an offline device with
  all tokens and pairings; refused with 409 while the host is online.
- Admin console filter tabs (all/online/offline), online-first sorting,
  state-based actions and a folded token table with counts.
- Static unauthenticated `GET /manifest.webmanifest` (browsers fetch manifests
  with credentials omitted, so it can never ride the pairing cookie).

#### Changed

- One active token per device: re-pairing displaces the previous token
  (protocol §10 single-concurrent-phone default); the old phone must re-pair.
- Orphaned token rows and tokens revoked over 30 days ago are pruned at load.

#### Fixed

- `forgetDevice` tombstone: the previous row shape equalled a normal
  registration, so removed devices resurrected after a relay restart.

### 0.1.1 - 2026-08-29

#### Added

- Initial self-hosted relay: pairing (6-digit code + one-shot challenge-response),
  order-preserving HTTP reverse proxy, WebSocket frame bridging, cookie phone
  sessions, admin console, JSONL store (sha256-only on disk).

## dsh-remote

### 0.2.1 - 2026-09-12

#### Fixed

- The client half targeted `@deepseek-ai/dsh-client-runtime`, which no current
  dsh ships — the browser half failed to mount and the "手机连接" settings
  section never appeared. The client now targets the packages dsh 0.1.5-rc.2
  actually provides: `dsh-client-modules`, `dsh-client-ui-renderer` (the
  `ctx.slots` Context merge), and `dsh-client-ui-settings` (the
  `settings.section` SlotMap). `inject` in the manifest and the
  `tsconfig.client.json` paths were updated to match.

### 0.1.11 - 2026-08-31

#### Fixed

- Newer dsh builds guard the web app behind an authority-bound browser session
  cookie (browser token authentication): the index goes through
  `authorizeIndex`, and `/api/*` RPC plus the `/api/remote.mux` event WebSocket
  answer 401 for a trusted-but-unauthenticated request. The host plugin proxied
  the phone as a plain loopback client with no cookie, so every phone request
  hit that 401. The plugin now mints the loopback cookie in-process from the
  Connection launch token and attaches it to every upstream HTTP request and the
  local WebSocket dial; a 401 triggers one refresh-and-retry. The launch token
  never leaves the desktop. Older harness builds have no browser-auth service,
  so the auth owner stays a pass-through and behavior is unchanged.
- The local WebSocket dial now uses the `ws` client (to attach the cookie on the
  upgrade). `ws` stays an external runtime dependency and a `dependencies`
  entry — the plugin bundle is ESM, and bundling the CJS `ws` package turns its
  `require('events'/*)` builtins into unsupported dynamic requires. The relay
  ships the same `ws`-external pattern.
- Upstream bodies are read through the fetch layer, which transparently decodes
  gzip/deflate/br — the host previously forwarded the decoded bytes *with* the
  original `content-encoding` header, so every proxied response (index HTML
  included) failed decompression on the phone (`Z_DATA_ERROR`) and the page
  never rendered. The plane now requests `accept-encoding: identity` upstream
  and strips `content-encoding` from the response head, so forwarded frames are
  plain bytes end to end.
- Cookie minting called `connection.authorizeIndex` as a *detached* function —
  cordis-traced service methods lose `this` there (`this.browserAuth` /
  `this.launchToken` become undefined), which threw inside every proxied
  request: the host answered `http-err UPSTREAM_DOWN` and the phone saw a 502
  on every request. The mint now calls the methods receiver-bound on the raw
  `browserAuth` instance (unwrapped through the `cordis.original` symbol) and
  swallows a mint failure to pass-through instead of 502.

### 0.1.10 - 2026-08-31

#### Fixed

- Mobile settings sheet now scrolls: the content pane's default
  `min-height:auto` let it grow past the clamped full-screen panel, so the
  inner scroll region never received a bounded height and `overflow:hidden`
  clipped the rest; bounding the pane with `min-height:0` lets the existing
  inner scroll engage.

### 0.1.9 - 2026-08-29

#### Fixed

- Drawer content rows keep the desktop column's stored width behind a slot
  wrapper; the shim now stretches inline-width elements anywhere in the drawer
  subtree so header/workspace icons reach the drawer edge.

### 0.1.8 - 2026-08-29

#### Fixed

- Stretch the drawer's direct children as well (first stretch pass).

### 0.1.7 - 2026-08-29

#### Changed

- Drawer shadow made directional and tight (`10px 0 22px -10px`); the previous
  symmetric blur painted a wide dark band over the chat.

### 0.1.6 - 2026-08-29

#### Added

- Sidebar drawer (≤1023.98px, aligned with dsh's own narrow breakpoint): the
  re-expanded narrow sidebar floats above a full-width center column instead of
  squeezing it.

### 0.1.5 - 2026-08-29

#### Added

- Mobile adaptation layer: every proxied `text/html` response gets a responsive
  stylesheet injected (≤720px: chat width tokens re-declared full-bleed,
  settings dialog as a full-screen sheet, model menu viewport-clamped) plus a
  viewport meta with `interactive-widget=resizes-content` and
  `viewport-fit=cover`.

### 0.1.4 - 2026-08-29

#### Fixed

- Pair-code refresh now waits for the relay's reply (4s bound) instead of
  answering with the stale code; the client treats `ok:false` as failure.
- Copy button reports success/failure with an `execCommand` fallback.
- Expired codes render a red hint; the section re-renders on a 10s ticker.

### 0.1.3 - 2026-08-29

#### Added

- Settings unlock for tunnel sessions: the ui-settings client bundle is
  rewritten in transit to force host persistence for the settings mirror
  (model catalog, plugin config sections); marker-absent builds pass through
  unmodified.

#### Fixed

- tsconfig `@deepseek-ai/*` type mappings point at the deepseek-harness
  checkout beside the repository, so `pnpm typecheck` runs again.

### 0.1.2 - 2026-08-29

#### Added

- Initial public host plugin: relay registration, HTTP reverse proxy plane,
  WebSocket plane, pairing UI with QR, trust-header stripping.
