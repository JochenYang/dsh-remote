/**
 * dsh-remote protocol constants — the desktop agent side of the tunnel.
 *
 * These values MUST stay in sync with relay-server's counterpart
 * (`packages/relay-server/src/const.ts`) and the protocol contract
 * (docs/PROTOCOL.md v1). Any change here requires a contract bump first.
 */

export const T = {
  // hello / lifecycle
  HELLO: 'hello',
  HELLO_OK: 'hello-ok',
  HELLO_DENY: 'hello-deny',
  PEER: 'peer',
  REVOKE: 'revoke',
  REVOKED: 'revoked',
  PAIR_REFRESH: 'pair-refresh',
  PAIR: 'pair',
  // keepalive
  PING: 'ping',
  PONG: 'pong',
  // http proxy plane
  HTTP_REQ: 'http-req',
  HTTP_BODY: 'http-body',
  HTTP_BODY_END: 'http-body-end',
  HTTP_ABORT: 'http-abort',
  HTTP_HEAD: 'http-head',
  HTTP_CHUNK: 'http-chunk',
  HTTP_END: 'http-end',
  HTTP_ERR: 'http-err',
  // websocket tunnel plane
  WS_OPEN: 'ws-open',
  WS_OPEN_OK: 'ws-open-ok',
  WS_OPEN_ERR: 'ws-open-err',
  WS_FRAME: 'ws-frame',
  WS_CLOSE: 'ws-close',
} as const

export type FrameType = (typeof T)[keyof typeof T]

/** Protocol version carried by `hello`. */
export const PROTOCOL_VERSION = 1

/** Frame cap; the relay chunks anything larger into `http-body` frames. */
export const MAX_FRAME_BYTES = 64 * 1024

/** Heartbeat cadence (relay pings we answer) and death timer we enforce. */
export const PING_INTERVAL_MS = 30_000
export const PING_TIMEOUT_MS = 90_000

/** Reconnect backoff bounds (exponential, 1s → 2s → 4s … capped). */
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_MAX_MS = 60_000

/** Identity header the relay injects on forwarded upstream requests. */
export const TOKEN_HEADER = 'x-dsh-relay-token'

/** Response chunk size used by the HTTP plane (well under the frame cap). */
export const HTTP_CHUNK_BYTES = 32 * 1024