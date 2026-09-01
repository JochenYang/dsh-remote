/**
 * WebSocket tunnel plane (PROTOCOL §6) — the host side.
 *
 * `ws-open` makes us dial the same path on the local dsh web server; after
 * `ws-open-ok`, `ws-frame` traffic flows both ways and `ws-close` tears the
 * full link down. The local socket is the `ws` client so the upstream
 * browser-session cookie (modern dsh authentication) can be attached on the
 * upgrade; sub-protocols are forwarded from the phone's handshake.
 */

import { WebSocket as WsClient } from 'ws'
import { T } from './frames.js'
import type { Frame } from './agent.js'
import type { Send } from './http-plane.js'
import type { UpstreamCookieAuth } from './upstream-auth.js'

interface Bridge {
  ws: WsClient | null
  open: boolean
  /** Phone closed first — don't echo the close back to the relay. */
  phoneClosed: boolean
}

export interface WsPlaneOptions {
  origin: () => string
  log: (message: string) => void
  send: Send
  /**
   * Upstream browser-session cookie owner. When present, its cookie is attached
   * to the local upgrade (modern dsh demands it). Absent (older harness) = no
   * cookie, matching the previous pass-through dial.
   */
  auth?: UpstreamCookieAuth
}

export class WsPlane {
  private readonly bridges = new Map<number, Bridge>()

  constructor(private readonly options: WsPlaneOptions) {}

  /** Dispatch a relay frame belonging to the ws plane. */
  handle(frame: Frame): void {
    const id = Number(frame.id)
    switch (frame.t) {
      case T.WS_OPEN:
        this.open(id, String(frame.path ?? '/'), (frame.headers as Record<string, string>) ?? {})
        break
      case T.WS_FRAME: {
        const bridge = this.bridges.get(id)
        const ws = bridge?.ws
        if (ws === undefined || ws === null || ws.readyState !== WsClient.OPEN) break
        const opcode = frame.opcode === 2 ? 2 : 1
        const bytes = Buffer.from(String(frame.dataBase64 ?? ''), 'base64')
        try {
          ws.send(opcode === 2 ? bytes : bytes.toString('utf8'))
        } catch (error) {
          this.options.log(`bridge ${id} send failed: ${(error as Error).message}`)
        }
        break
      }
      case T.WS_CLOSE: {
        const bridge = this.bridges.get(id)
        if (bridge === undefined) break
        bridge.phoneClosed = true
        if (bridge.ws !== null && bridge.ws.readyState === WsClient.OPEN) {
          try {
            const code = Number(frame.code) || 1000
            const reason = typeof frame.reason === 'string' ? frame.reason : undefined
            bridge.ws.close(code, reason)
          } catch {
            // already closing
          }
        }
        break
      }
      default:
        this.options.log(`ws-plane: unexpected frame ${String(frame.t)}`)
    }
  }

  private open(id: number, path: string, headers: Record<string, string>): void {
    if (this.bridges.has(id)) return
    const bridge: Bridge = { ws: null, open: false, phoneClosed: false }
    this.bridges.set(id, bridge)

    const protocols = (headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map(part => part.trim())
      .filter(part => part !== '')

    const cookie = this.options.auth?.cookie()
    const address = this.options.origin().replace(/^http/, 'ws') + path

    let ws: WsClient
    try {
      ws = cookie === undefined
        ? new WsClient(address, protocols)
        : new WsClient(address, protocols, { headers: { cookie } })
    } catch (error) {
      this.bridges.delete(id)
      this.options.send({ t: T.WS_OPEN_ERR, id, reason: (error as Error).message })
      return
    }

    bridge.ws = ws

    // Dial errors before the upgrade completes surface on `error`, not `close`.
    ws.on('error', (error) => {
      if (bridge.open) return
      this.options.log(`bridge ${id} dial error: ${error.message}`)
      if (this.bridges.has(id)) this.bridges.delete(id)
      this.options.send({ t: T.WS_OPEN_ERR, id, reason: 'upstream connection failed' })
    })

    ws.on('open', () => {
      bridge.open = true
      this.options.send({ t: T.WS_OPEN_OK, id })
    })

    ws.on('message', (data, isBinary) => {
      if (!bridge.open) return
      const bytes = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data)
      this.options.send({
        t: T.WS_FRAME,
        id,
        opcode: isBinary ? 2 : 1,
        dataBase64: bytes.toString('base64'),
      })
    })

    ws.on('close', (code, reason) => {
      this.bridges.delete(id)
      if (bridge.phoneClosed) return
      this.options.send({ t: T.WS_CLOSE, id, code: code === 1006 ? 1011 : code, reason: reason ?? 'peer closed' })
    })
  }
}
