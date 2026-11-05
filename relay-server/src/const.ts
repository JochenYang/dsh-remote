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

/** Heartbeat cadence: relay pings every 15s, 45s of silence kills. The shipped
 * deployment terminates at a CDN whose WebSocket idle timeout is 30s (measured),
 * so the relay's own keepalive has to sit well under it — 30s was a race. */
export const PING_INTERVAL_MS = 15_000
export const PING_TIMEOUT_MS = 45_000

/** Pairing code lifetime (10 minutes). */
export const PAIR_CODE_TTL_MS = 10 * 60_000

/** Challenge-response: one-shot challenge, 60s TTL. */
export const CHALLENGE_TTL_MS = 60_000

/** Rate limit on POST /pair: 5 attempts / minute / client address. */
export const PAIR_RATE_WINDOW_MS = 60_000
export const PAIR_RATE_MAX = 5

/** Consecutive failures that lock one client address out of pairing, and for
 * how long. The per-minute window alone leaves a slow guesser unbounded. */
export const PAIR_FAIL_LOCKOUT_MAX = 20
export const PAIR_FAIL_LOCKOUT_MS = 15 * 60_000

/** Relay-wide ceiling on failed pairing attempts per window. Per-address limits
 * cannot stop a distributed guess from burning the whole 6-digit space, and a
 * single legitimate pairing must still get through. */
export const PAIR_GLOBAL_FAIL_MAX = 60

/** Cap on a body the relay itself parses (`/pair`, `/admin/*`). */
export const MAX_CONTROL_BODY_BYTES = 4 * 1024

/** Wire-level guard for one WebSocket message in either direction.
 *
 * The protocol's 64 KiB cap applies to `http-*` frames, which the planes
 * chunk themselves. A `ws-frame` is different: it carries one whole dsh
 * WebSocket message (base64 + JSON envelope, no fragmentation), and dsh's own
 * event/RPC messages are not bounded by our protocol — a single live event can
 * be hundreds of kilobytes. Applying the 64 KiB cap here dropped the host
 * connection with 1009 mid-stream, which reads as "host offline" to every
 * phone. This bound only stops a runaway payload. */
export const MAX_WIRE_FRAME_BYTES = 16 * 1024 * 1024

/** A bridged socket must be confirmed by the host within this window; the phone
 * may have queued data meanwhile, and an unanswered `ws-open` would pin the
 * bridge (and its queue) for the process lifetime. */
export const WS_OPEN_TIMEOUT_MS = 15_000

/** Frames a bridge buffers before the host confirms `ws-open`. */
export const MAX_PENDING_FRAMES = 256

/** Phone send-buffer ceiling: a slow phone must not grow relay memory when the
 * host streams events faster than the radio drains them. */
export const MAX_PHONE_BUFFER_BYTES = 4 * 1024 * 1024

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