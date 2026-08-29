/**
 * WebSocket tunnel plane (PROTOCOL §6) — the host side.
 *
 * `ws-open` makes us dial the same path on the local dsh web server; after
 * `ws-open-ok`, `ws-frame` traffic flows both ways and `ws-close` tears the
 * full link down. The local socket is the Node 22+ global `WebSocket`
 * (sub-protocols forwarded from the phone's handshake).
 */

import { T } from './frames.js'
import type { Frame } from './agent.js'
import type { Send } from './http-plane.js'

interface Bridge {
  ws: WebSocket | null
  open: boolean
  /** Phone closed first — don't echo the close back to the relay. */
  phoneClosed: boolean
}

export interface WsPlaneOptions {
  origin: () => string
  log: (message: string) => void
  send: Send
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
        if (ws === undefined || ws === null || ws.readyState !== WebSocket.OPEN) break
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
        if (bridge.ws !== null && bridge.ws.readyState === WebSocket.OPEN) {
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

    let ws: WebSocket
    try {
      ws = protocols.length > 0
        ? new WebSocket(this.options.origin().replace(/^http/, 'ws') + path, protocols)
        : new WebSocket(this.options.origin().replace(/^http/, 'ws') + path)
    } catch (error) {
      this.bridges.delete(id)
      this.options.send({ t: T.WS_OPEN_ERR, id, reason: (error as Error).message })
      return
    }

    bridge.ws = ws
    ws.binaryType = 'arraybuffer'

    // Dial errors before the upgrade completes surface on `error`, not `close`.
    ws.addEventListener('error', () => {
      if (bridge.open) return
      if (this.bridges.has(id)) this.bridges.delete(id)
      this.options.send({ t: T.WS_OPEN_ERR, id, reason: 'upstream connection failed' })
    })

    ws.addEventListener('open', () => {
      bridge.open = true
      this.options.send({ t: T.WS_OPEN_OK, id })
    })

    ws.addEventListener('message', (event) => {
      if (!bridge.open) return
      const data = event.data
      if (typeof data === 'string') {
        this.options.send({ t: T.WS_FRAME, id, opcode: 1, dataBase64: Buffer.from(data, 'utf8').toString('base64') })
        return
      }
      if (data instanceof ArrayBuffer) {
        this.options.send({ t: T.WS_FRAME, id, opcode: 2, dataBase64: Buffer.from(data).toString('base64') })
        return
      }
      // Blob (only when binaryType is not arraybuffer — defensive).
      void data.arrayBuffer().then((buffer: ArrayBuffer) => {
        this.options.send({ t: T.WS_FRAME, id, opcode: 2, dataBase64: Buffer.from(buffer).toString('base64') })
      })
    })

    ws.addEventListener('close', (event) => {
      this.bridges.delete(id)
      if (bridge.phoneClosed) return
      this.options.send({ t: T.WS_CLOSE, id, code: event.code === 1006 ? 1011 : event.code, reason: event.reason ?? 'peer closed' })
    })
  }
}