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
import {
  MAX_PENDING_FRAMES,
  MAX_PHONE_BUFFER_BYTES,
  MAX_WIRE_FRAME_BYTES,
  T,
  TOKEN_HEADER,
  WS_OPEN_TIMEOUT_MS,
} from './const.ts'
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
  /** Fires when the host never answers `ws-open`; see {@link failBridge}. */
  openTimer: ReturnType<typeof setTimeout> | undefined
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
      const bridge: Bridge = {
        id,
        deviceId,
        host,
        phone: phoneWs,
        ready: false,
        pending: [],
        closed: false,
        openTimer: undefined,
      }
      this.bridges.set(id, bridge)
      // An unanswered `ws-open` would pin the bridge (and whatever the phone
      // queued) for the life of the process, so the handshake gets a deadline.
      bridge.openTimer = setTimeout(() => {
        this.log(`ws-bridge: host did not confirm ws-open #${id} within ${WS_OPEN_TIMEOUT_MS}ms`)
        this.failBridge(bridge, 1011, 'host handshake timeout')
      }, WS_OPEN_TIMEOUT_MS)

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
        // `ws-frame` carries one whole dsh WebSocket message — the 64 KiB
        // protocol cap covers `http-*` frames, not these. Only a runaway
        // payload is refused, and the host must not have to defend against it.
        if (data.length > MAX_WIRE_FRAME_BYTES) {
          this.log(`ws-bridge: phone frame ${data.length}B exceeds ${MAX_WIRE_FRAME_BYTES}B on #${id}; closing`)
          this.failBridge(bridge, 1009, 'frame too large')
          return
        }
        const payload: string | Buffer = isBinary ? data : data.toString('utf8')
        if (!bridge.ready) {
          // Cap the pre-handshake queue so a stuck host cannot buffer forever.
          if (bridge.pending.length >= MAX_PENDING_FRAMES) {
            this.failBridge(bridge, 1013, 'host handshake stalled')
            return
          }
          bridge.pending.push({ opcode: isBinary ? 2 : 1, payload })
          return
        }
        this.sendToHost(bridge.host, { t: T.WS_FRAME, id, opcode: isBinary ? 2 : 1, dataBase64: toBase64(payload) })
      })
      phoneWs.on('close', (code: number, reason: Buffer) => {
        // A close we initiated (timeout, cap, backpressure, purge) already told
        // the host; only a phone-initiated close needs forwarding.
        const notifyHost = bridge.ready && !bridge.closed
        bridge.closed = true
        this.clearOpenTimer(bridge)
        if (notifyHost) {
          this.sendToHost(bridge.host, { t: T.WS_CLOSE, id, code, reason: reason.toString('utf8') })
        }
        this.bridges.delete(id)
      })
      phoneWs.on('error', (error: Error) => {
        this.log(`ws-bridge: phone ws error #${id}: ${error.message}`)
        this.failBridge(bridge, 1011, 'phone socket error')
      })
    })

    return true
  }

  /**
   * Tear a bridge down once, whichever side noticed first. The phone closes
   * with the reason, the host is told, and every timer the bridge owns is
   * released — a closed bridge must not resurface through its own timeout.
   */
  private failBridge(bridge: Bridge, code: number, reason: string): void {
    if (bridge.closed) return
    bridge.closed = true
    this.clearOpenTimer(bridge)
    this.bridges.delete(bridge.id)
    this.sendToHost(bridge.host, { t: T.WS_CLOSE, id: bridge.id, code, reason })
    try { bridge.phone.close(code, reason) } catch { /* socket already gone */ }
  }

  private clearOpenTimer(bridge: Bridge): void {
    if (bridge.openTimer === undefined) return
    clearTimeout(bridge.openTimer)
    bridge.openTimer = undefined
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
        this.clearOpenTimer(bridge)
        for (const item of bridge.pending) {
          this.sendToHost(bridge.host, { t: T.WS_FRAME, id, opcode: item.opcode, dataBase64: toBase64(item.payload) })
        }
        bridge.pending = []
        break
      }
      case T.WS_OPEN_ERR: {
        // The host refused the upgrade it was asked to open: tear down without
        // echoing a `ws-close` back at it.
        bridge.closed = true
        this.clearOpenTimer(bridge)
        this.bridges.delete(id)
        try { bridge.phone.close(1011, String(frame.reason ?? 'host refused')) } catch { /* gone */ }
        break
      }
      case T.WS_FRAME: {
        // `send` buffers what the socket cannot drain; a phone on a weak link
        // with a host streaming events must lose the bridge, not grow the heap.
        if (bridge.phone.bufferedAmount > MAX_PHONE_BUFFER_BYTES) {
          this.log(`ws-bridge: phone buffer ${bridge.phone.bufferedAmount}B over ${MAX_PHONE_BUFFER_BYTES}B on #${id}; closing`)
          this.failBridge(bridge, 1013, 'phone too slow')
          break
        }
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
        this.clearOpenTimer(bridge)
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
      this.clearOpenTimer(bridge)
      this.bridges.delete(id)
      bridge.phone.close(1012, 'device offline')
    }
  }

  closeAll(): void {
    for (const bridge of this.bridges.values()) {
      bridge.closed = true
      this.clearOpenTimer(bridge)
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