/**
 * WebSocket tunnel plane (PROTOCOL §6). Phone-browser upgrades on
 * `/d/<deviceId>/*` are framed to the host: `ws-open` asks the host to open a
 * local WebSocket against the same path, then `ws-frame` frames flow both
 * ways and `ws-close` tears the full link down.
 *
 * Frames are ordered per bridge, so voice/event streams stay in order. A
 * phone may send data before the host confirms — those frames are queued on
 * the bridge until `ws-open-ok` arrives (or dropped on `ws-open-err`).
 */

import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { MAX_FRAME_BYTES, T, TOKEN_HEADER } from './const.ts'
import type { HostSession, PhoneSession, Sessions } from './sessions.ts'

type Frame = Record<string, unknown>

interface Bridge {
  id: number
  deviceId: string
  /** Host this bridge forwards to — every frame routes through it. */
  host: HostSession
  phone: WebSocket
  ready: boolean
  /** Phone data received before `ws-open-ok`; replayed in order on ready. */
  pending: Array<{ opcode: 1 | 2; payload: string | Buffer }>
  closed: boolean
}

export class WsBridge {
  private nextId = 1
  private readonly bridges = new Map<number, Bridge>()

  constructor(
    private readonly sessions: Sessions,
    private readonly log: (message: string) => void,
    private readonly wss: WebSocketServer,
  ) {}

  /**
   * Accept a phone upgrade and forward it to the device's host. Returns false
   * (and destroys the socket) when the host is offline or identity is missing.
   */
  handleUpgrade(
    req: IncomingMessage,
    socket: Parameters<typeof this.wss.handleUpgrade>[1],
    head: Buffer,
    phone: PhoneSession | null,
    deviceId: string,
    restPath: string,
  ): boolean {
    const host = this.sessions.getHost(deviceId)
    if (host === null || phone === null) {
      socket.destroy()
      return false
    }

    const id = this.nextId++
    const { path } = splitPathQuery(restPath)

    // Complete the phone-side handshake first; the browser then streams in.
    this.wss.handleUpgrade(req, socket, head, (phoneWs) => {
      const bridge: Bridge = { id, deviceId, host, phone: phoneWs, ready: false, pending: [], closed: false }
      this.bridges.set(id, bridge)

      // Pass the phone's handshake headers (plus our identity marker) so the
      // host can mirror cookie/protocol negotiation on its local connection.
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        if (Array.isArray(value)) continue
        headers[key.toLowerCase()] = value
      }
      headers[TOKEN_HEADER] = phone.token

      this.sendToHost(host, {
        t: T.WS_OPEN,
        id,
        path,
        headers,
      })

      phoneWs.on('message', (data: Buffer, isBinary: boolean) => {
        if (bridge.closed) return
        this.checkFrameSize(data.length)
        const payload: string | Buffer = isBinary ? data : data.toString('utf8')
        if (!bridge.ready) {
          // Cap the pre-handshake queue so a stuck host cannot buffer forever.
          if (bridge.pending.length < 256) bridge.pending.push({ opcode: isBinary ? 2 : 1, payload })
          return
        }
        this.sendToHost(bridge.host, { t: T.WS_FRAME, id, opcode: isBinary ? 2 : 1, dataBase64: toBase64(payload) })
      })
      phoneWs.on('close', (code: number, reason: Buffer) => {
        bridge.closed = true
        if (bridge.ready) {
          this.sendToHost(bridge.host, { t: T.WS_CLOSE, id, code, reason: reason.toString('utf8') })
        }
        this.bridges.delete(id)
      })
      phoneWs.on('error', (error: Error) => {
        this.log(`ws-bridge: phone ws error #${id}: ${error.message}`)
        bridge.closed = true
        this.bridges.delete(id)
        phoneWs.close()
      })
    })

    return true
  }

  private checkFrameSize(bytes: number): void {
    if (bytes > MAX_FRAME_BYTES) {
      this.log(`ws-bridge: oversized frame ${bytes}B (cap ${MAX_FRAME_BYTES}B) dropped`)
    }
  }

  /** Push a frame onto the host socket; silently drops when the host died. */
  private sendToHost(host: HostSession, frame: Frame): void {
    try {
      host.ws.send(JSON.stringify(frame))
    } catch {
      // Host link died mid-bridge; the phone's close handler cleans up.
    }
  }

  /** Handle a host→relay frame for a bridged socket. */
  onHostFrame(frame: Frame): void {
    const id = Number(frame.id)
    const bridge = this.bridges.get(id)
    if (bridge === undefined || bridge.closed) return
    switch (frame.t) {
      case T.WS_OPEN_OK: {
        if (bridge.ready) return
        bridge.ready = true
        for (const item of bridge.pending) {
          this.sendToHost(bridge.host, { t: T.WS_FRAME, id, opcode: item.opcode, dataBase64: toBase64(item.payload) })
        }
        bridge.pending = []
        break
      }
      case T.WS_OPEN_ERR: {
        bridge.closed = true
        this.bridges.delete(id)
        bridge.phone.close(1011, String(frame.reason ?? 'host refused'))
        break
      }
      case T.WS_FRAME: {
        const opcode = frame.opcode === 2 ? 2 : 1
        const data = Buffer.from(frame.dataBase64 as string, 'base64')
        if (opcode === 2) {
          bridge.phone.send(data, { binary: true })
        } else {
          bridge.phone.send(data.toString('utf8'), { binary: false })
        }
        break
      }
      case T.WS_CLOSE: {
        bridge.closed = true
        this.bridges.delete(id)
        bridge.phone.close(Number(frame.code) || 1000, String(frame.reason ?? ''))
        break
      }
      default:
        this.log(`ws-bridge: dropped frame ${String(frame.t)} for #${id}`)
    }
  }

  /** Close every bridge owned by a device (revoke or host-gone event). */
  purgeDevice(deviceId: string): void {
    for (const [id, bridge] of [...this.bridges]) {
      if (bridge.deviceId !== deviceId) continue
      bridge.closed = true
      this.bridges.delete(id)
      bridge.phone.close(1012, 'device offline')
    }
  }

  closeAll(): void {
    for (const bridge of this.bridges.values()) {
      bridge.closed = true
      bridge.phone.close(1001, 'relay shutting down')
    }
    this.bridges.clear()
  }
}

function splitPathQuery(raw: string): { path: string; query: string } {
  const index = raw.indexOf('?')
  if (index === -1) return { path: raw, query: '' }
  return { path: raw.slice(0, index), query: raw.slice(index) }
}

function toBase64(payload: string | Buffer): string {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  return data.toString('base64')
}