/**
 * RelayAgent — desktop-side tunnel client (PROTOCOL §3, §7).
 *
 * Owns the WebSocket link to the relay: `hello` registration, ping/pong
 * keepalive, exponential reconnect, and status surface for the UI. Data-plane
 * frames (http-*, ws-*) are not interpreted here — they are dispatched to the
 * planes via `onFrame` so this class stays a pure control-plane client.
 *
 * The upstream socket is the Node 22+ global `WebSocket` (PROTOCOL §6); no
 * third-party WS dependency is needed on the host side.
 */

import { PING_INTERVAL_MS, PING_TIMEOUT_MS, PROTOCOL_VERSION, RECONNECT_BASE_MS, RECONNECT_MAX_MS, T } from './frames.js'

export type Frame = Record<string, unknown>

export type ConnState = 'idle' | 'connecting' | 'online' | 'error'

export interface PairInfo {
  code: string
  expiresAt: number
}

/** One in-flight `pair-refresh`: the reply resolves every waiter. */
interface PairWaiter {
  promise: Promise<PairInfo | null>
  settle: (pair: PairInfo | null) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface PeerInfo {
  online: boolean
  ua?: string
}

export interface AgentStatus {
  state: ConnState
  deviceId: string
  relayUrl: string
  hostName: string
  pair: PairInfo | null
  peer: PeerInfo | null
  lastError: string | null
  connectedAt: number | null
  /** Next reconnect attempt in milliseconds (non-null while scheduling). */
  retryInMs: number | null
}

export interface AgentOptions {
  deviceId: string
  relayUrl: string
  hostToken: string
  hostName: string
  log: (message: string) => void
  onStatus?: (status: AgentStatus) => void
}

export class RelayAgent {
  private ws: WebSocket | null = null
  private state: ConnState = 'idle'
  private pair: PairInfo | null = null
  private peer: PeerInfo | null = null
  private lastError: string | null = null
  private connectedAt: number | null = null
  private retryInMs: number | null = null
  private stopped = true
  private retryAttempt = 0
  private lastRx = 0
  private frameSink: ((frame: Frame) => void) | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private tickTimer: ReturnType<typeof setInterval> | undefined
  private pairWaiter: PairWaiter | undefined

  constructor(private readonly options: AgentOptions) {}

  /** Install the data-plane frame dispatcher (http-* / ws-* frames). */
  setFrameSink(sink: (frame: Frame) => void): void {
    this.frameSink = sink
  }

  /** Current public status. */
  getStatus(): AgentStatus {
    return {
      state: this.state,
      deviceId: this.options.deviceId,
      relayUrl: this.options.relayUrl,
      hostName: this.options.hostName,
      pair: this.pair,
      peer: this.peer,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      retryInMs: this.retryInMs,
    }
  }

  /** Apply settings, dropping any live connection so the next cycle re-arms. */
  applySettings(relayUrl: string, hostToken: string, autoConnect: boolean): void {
    this.options.relayUrl = relayUrl
    this.options.hostToken = hostToken
    this.stop()
    if (autoConnect && relayUrl.trim() !== '') {
      this.start()
    } else {
      this.setState('idle')
    }
  }

  /** Open the tunnel (no-op when already connected or no target configured). */
  start(): void {
    if (this.stopped === false) return
    if (this.options.relayUrl.trim() === '') {
      this.setState('idle')
      return
    }
    this.stopped = false
    this.connect()
  }

  /** Close the tunnel and cancel timers. */
  stop(): void {
    this.stopped = true
    this.settlePair(null)
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    if (this.tickTimer !== undefined) {
      clearInterval(this.tickTimer)
      this.tickTimer = undefined
    }
    this.closeSocket(null)
    this.connectedAt = null
    this.retryInMs = null
  }

  /**
   * Ask the relay for a fresh pairing code and wait for the answer.
   * @returns the fresh pair from the relay's `pair` reply, or null when the
   * relay did not answer in time (offline, rate-limited, or reconnecting).
   * The reply also lands in {@link getStatus}, so callers may just re-read
   * status after awaiting.
   */
  refreshPair(): Promise<PairInfo | null> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve(null)
    const wait = this.pairWaiter
    if (wait !== undefined) return wait.promise
    let settle: (pair: PairInfo | null) => void = () => {}
    const promise = new Promise<PairInfo | null>((resolve) => { settle = resolve })
    const waiter: PairWaiter = { promise, settle, timer: undefined }
    this.pairWaiter = waiter
    waiter.timer = setTimeout(() => this.settlePair(null), 4000)
    this.sendFrame({ t: T.PAIR_REFRESH })
    return promise
  }

  /** Revoke every token & pairing code; relay disconnects online phones. */
  revoke(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.sendFrame({ t: T.REVOKE })
  }

  /** Dispose without reconnection (plugin teardown). */
  dispose(): void {
    this.stop()
  }

  // ---------------------------------------------------------------- internals

  private connect(): void {
    if (this.stopped) return
    const wsUrl = this.buildWsUrl()
    if (wsUrl === '') {
      this.setState('idle')
      return
    }
    this.setState('connecting')
    this.lastRx = Date.now()

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (error) {
      this.fail(`无法连接中继：${(error as Error).message}`)
      return
    }
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    ws.addEventListener('open', () => this.onOpen())
    ws.addEventListener('message', (event) => this.onMessage(event))
    ws.addEventListener('close', () => this.onClose())
    ws.addEventListener('error', () => {
      // `close` always follows `error` on the WebSocket API — status updated there.
      this.log('relay socket error')
    })
  }

  private buildWsUrl(): string {
    const { relayUrl } = this.options
    const trimmed = relayUrl.trim().replace(/\/+$/, '')
    if (/^wss?:\/\//i.test(trimmed)) return `${trimmed}/ws?role=host`
    if (/^https?:\/\//i.test(trimmed)) {
      const protocol = /^https/i.test(trimmed) ? 'wss' : 'ws'
      return `${trimmed.replace(/^https?/i, protocol)}/ws?role=host`
    }
    return `ws://${trimmed}/ws?role=host`
  }

  private onOpen(): void {
    this.log('relay connected')
    this.connectedAt = Date.now()
    this.retryAttempt = 0
    this.retryInMs = null
    this.sendFrame({
      t: T.HELLO,
      v: PROTOCOL_VERSION,
      role: 'host',
      deviceId: this.options.deviceId,
      hostToken: this.options.hostToken,
    })
    this.setState('connecting')
    if (this.tickTimer === undefined) {
      this.tickTimer = setInterval(() => this.tick(), 10_000)
    }
  }

  private onMessage(event: MessageEvent): void {
    this.lastRx = Date.now()
    if (typeof event.data !== 'string') return // control plane is JSON text only
    let frame: Frame
    try {
      frame = JSON.parse(event.data) as Frame
    } catch {
      this.log('ignoring non-JSON relay frame')
      return
    }
    this.handleFrame(frame)
  }

  private onClose(): void {
    if (this.tickTimer !== undefined) {
      clearInterval(this.tickTimer)
      this.tickTimer = undefined
    }
    this.ws = null
    this.settlePair(null)
    if (this.stopped) return
    this.setState('error')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.retryAttempt, RECONNECT_MAX_MS)
    this.retryAttempt += 1
    this.retryInMs = delay
    this.log(`reconnecting in ${Math.round(delay / 1000)}s`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.retryInMs = null
      this.connect()
    }, delay)
  }

  /** Keepalive tick: ping the relay; tear down on partner silence (PROTOCOL §7). */
  private tick(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    if (Date.now() - this.lastRx > PING_TIMEOUT_MS) {
      this.log('relay silent too long; reconnecting')
      this.closeSocket('remote silence')
      return
    }
    this.sendFrame({ t: T.PING })
  }

  private handleFrame(frame: Frame): void {
    switch (frame.t) {
      case T.HELLO_OK:
        this.pair = frame.pair !== null && frame.pair !== undefined
          ? frame.pair as PairInfo
          : null
        this.lastError = null
        this.setState('online')
        this.log(`relay hello-ok (pair ${this.pair ? 'armed' : 'none'})`)
        break
      case T.HELLO_DENY:
        this.fail(`relay 拒绝认证：${String(frame.reason ?? 'UNKNOWN')}`)
        break
      case T.PAIR:
        this.pair = { code: String(frame.code), expiresAt: Number(frame.expiresAt) }
        this.settlePair(this.pair)
        this.setState(this.state) // keep current state; surface new pair
        this.log('pair code refreshed')
        break
      case T.PEER:
        this.peer = {
          online: frame.state === 'online',
          ua: typeof frame.ua === 'string' ? frame.ua : undefined,
        }
        this.log(`peer ${this.peer.online ? 'online' : 'offline'}`)
        break
      case T.REVOKED:
        this.pair = null
        this.peer = null
        this.log('all tokens & pairings revoked')
        break
      case T.PING:
        this.sendFrame({ t: T.PONG })
        break
      case T.PONG:
        // Keepalive only; alive-ness already tracked via lastRx.
        break
      default:
        if (typeof frame.t === 'string') this.frameSink?.(frame)
        else this.log(`ignoring malformed relay frame: ${JSON.stringify(frame).slice(0, 120)}`)
    }
  }

  private fail(message: string): void {
    this.lastError = message
    this.setState('error')
    this.log(message)
    this.closeSocket('failed')
  }

  /** Resolve (or cancel) a pending pair-refresh; safe to call with none pending. */
  private settlePair(pair: PairInfo | null): void {
    const waiter = this.pairWaiter
    if (waiter === undefined) return
    this.pairWaiter = undefined
    if (waiter.timer !== undefined) clearTimeout(waiter.timer)
    waiter.settle(pair)
  }

  private closeSocket(reason: string | null): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close(1000, reason ?? undefined)
      } catch {
        // socket already gone
      }
    }
  }

  /** Send any frame to the relay (no-op while the socket is not open). */
  sendFrame(frame: Frame): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(frame))
    } catch (error) {
      this.log(`send failed: ${(error as Error).message}`)
      this.closeSocket('send error')
    }
  }

  private setState(state: ConnState): void {
    this.state = state
    this.options.onStatus?.(this.getStatus())
  }

  private readonly log = (message: string): void => {
    this.options.log(`[relay] ${message}`)
  }
}