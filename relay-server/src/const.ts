/**
 * Shared relay protocol constants (docs/PROTOCOL.md v1).
 *
 * These values MUST stay in sync with the dsh-remote plugin's counterpart
 * (`packages/dsh-remote/src/frames.ts`) and the protocol contract. The frame
 * types, sizing limits, and timing defaults below are the only numbers the
 * two ends ever exchange.
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

/** Frame cap; anything larger must be chunked into `http-body` frames. */
export const MAX_FRAME_BYTES = 64 * 1024

/** Heartbeat cadence: relay pings every 30s, 90s of silence kills. */
export const PING_INTERVAL_MS = 30_000
export const PING_TIMEOUT_MS = 90_000

/** Pairing code lifetime (10 minutes). */
export const PAIR_CODE_TTL_MS = 10 * 60_000

/** Challenge-response: one-shot challenge, 60s TTL. */
export const CHALLENGE_TTL_MS = 60_000

/** Rate limit on POST /pair: 5 attempts / minute / device + IP. */
export const PAIR_RATE_WINDOW_MS = 60_000
export const PAIR_RATE_MAX = 5

/** A proxied request with no http-* progress for this long is torn down. */
export const HTTP_IDLE_TIMEOUT_MS = 10_000

/** Absolute cap on an upstream request body buffered by the relay (defense). */
export const MAX_REQUEST_BODY_BYTES = 128 * 1024 * 1024

/** Admin console session cookie (management page, independent of phone sessions). */
export const ADMIN_COOKIE = 'dsh-relay-admin'

/** Admin console login lifetime (24h fixed; not sliding). */
export const ADMIN_SESSION_TTL_MS = 24 * 3_600_000

/** Browser session cookie name (see PROTOCOL §8). */
export const SESSION_COOKIE = 'dsh-relay'

/** Identity header the relay injects on forwarded upstream requests. */
export const TOKEN_HEADER = 'x-dsh-relay-token'

/** Phone browser session lifetime (7 days, refreshed on each visit). */
export const SESSION_TTL_MS = 7 * 24 * 3_600_000