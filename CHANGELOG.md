# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
each package versioned independently (semver).

## relay-server

### 0.1.6 - 2026-11-05

#### Fixed

- Keepalive cadence sat exactly on the deployment's WebSocket idle timeout.
  The shipped relay runs behind a CDN that kills an idle WebSocket after 30s
  (measured: an idle connection through it closed at 30.0s with 1006), and the
  relay only pinged every 30s — a race that dropped phone sockets and made the
  web client reconnect. The relay now pings every 15s and declares a silent
  host dead after 45s (was 90s), and it answers a host-initiated `ping` with
  `pong` so the origin→client direction also carries traffic.
- A replaced host socket stayed silent in the log, so a reconnect storm looked
  like "host online" with no matching "host offline". Host closes now log the
  close code, the socket's age and the reason, both for a displaced socket
  (`host displaced: … code=… after Ns`) and a real loss (`host offline: …`),
  and a hello that replaces a live host logs how long the previous one lived.
  The close code identifies the culprit: 1006 = path died without a close
  frame (CDN/NAT), 1009 = oversized frame, 1012 = displaced, 4001 = heartbeat
  timeout, 1000 = the plugin closed on purpose.

### 0.1.5 - 2026-11-05

#### Fixed

- `ws-frame` is not an `http-*` frame: it carries one whole dsh WebSocket
  message with no fragmentation, so the 64 KiB protocol cap does not apply to
  it. 0.1.4 enforced that cap as `maxPayload` and closed the **host** socket
  with 1009 whenever dsh emitted a larger message — the relay then reported the
  device offline, every phone API call answered 409 and the web client
  reconnected in a loop. The wire guard is now 16 MiB (runaway payloads only)
  and the phone-side close-on-oversize is gone.
- The web manifest is also served on `/d/<deviceId>/manifest.webmanifest`. dsh
  links it relatively and browsers fetch manifests without credentials, so the
  request fell through to device routing, answered 302 `/pair`, and the console
  reported a manifest syntax error.

### 0.1.4 - 2026-11-05

#### Fixed

- Pairing attempts were rate-limited per TCP connection, not per client: the
  limiter key carried `remotePort`, so every fresh connection reset the bucket
  (and behind the shipped caddy deployment every phone also shares the loopback
  peer address). A 6-digit code could therefore be guessed for its whole
  10-minute TTL. Limits now key on the real client address (`X-Forwarded-For`,
  honoured only on a loopback peer and only for its last hop), lock the address
  for 15 minutes after 20 consecutive failures, and keep a relay-wide
  failed-attempt budget as a distributed-guess backstop.
- `/pair` and the admin endpoints buffered an unbounded request body
  (`body += chunk`), so one connection could exhaust the relay's memory.
  Control-plane bodies are capped at 4 KiB and answered with 413.
- The 64 KiB frame cap was not enforced on the phone→host direction: the check
  only logged and the WebSocket server had no `maxPayload` (ws defaults to
  100 MB). An oversized phone frame now closes the bridge with 1009.
- Bridged sockets could be pinned or grow unbounded: an unanswered `ws-open`
  had no deadline, the pre-handshake queue silently dropped frames past 256
  (breaking frame order), and a slow phone let the relay's send buffer grow
  with no ceiling. The handshake now times out after 15s, queue overflow fails
  the link instead of dropping frames, and a phone send buffer past 4 MiB
  closes the bridge.

#### Changed

- Unconsumed challenges, attempt-limiter rows and revoked token rows are swept
  from memory by the heartbeat (`load` used to be the only sweep). A relay that
  stayed up accumulated a challenge per pairing attempt and grew its revoked
  token table until the next restart; both are now bounded in time, and
  challenge rows no longer outlive their TTL at all.

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

### 0.2.3 - 2026-11-05

#### Fixed

- Reconnect backoff reset on `open`, so a link that died right after the
  handshake reconnected every second forever — a storm that hammered the relay
  and the CDN (and produced the 409/502 bursts). The backoff now resets only
  after a connection has stayed up for 30s; shorter lives escalate
  1s→2s→…→60s.
- Keepalive now runs on the same budget as the relay (ping every 10s, silence
  death at 45s instead of 90s), and the relay answers those pings since 0.1.6,
  so a dead path is noticed in seconds rather than a minute and a half.

### 0.2.2 - 2026-11-05

#### Changed

- The mobile shim now defers to dsh's own responsive layout. Since 0.2.2 the
  client turns the sidebar into a real drawer below 768px
  (`data-sidebar-drawer` + a backdrop), gives the settings panel a full-screen
  mobile layout with a scrollable horizontal nav, and clamps portaled menus to
  the visual viewport — so the previous mobile stylesheet fought it. The
  blanket `--dsh-chat-content-width` override and the viewport meta hints stay;
  every rule aimed at the old desktop markup is gone.

#### Fixed

- Expanded sidebar on a phone showed a dimmed band and clipped rows: the
  `> :first-child` float landed on the new drawer backdrop instead of the
  sidebar column (315px instead of the full width), and the
  `[role=dialog][aria-modal]` rules also matched the sidebar root — which is
  itself `role=dialog > nav` while its drawer is open — widening it to 100vw
  (clipped at the 280px column) and turning its panel list into a clipped row.
- The settings sheet lost its navigation and its scroll: the
  `> nav > div:first-child { display: none }` rule hid the nav list, the only
  child of the new nav, and the width/height overrides replaced the shipped
  mobile grid so the content pane stopped scrolling.

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
