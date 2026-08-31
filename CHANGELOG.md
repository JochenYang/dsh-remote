# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
each package versioned independently (semver).

## relay-server

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
