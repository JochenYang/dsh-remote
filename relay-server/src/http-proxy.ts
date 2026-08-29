/**
 * HTTP reverse-proxy plane (PROTOCOL §5). Phone-browser requests hitting
 * `/d/<deviceId>/...` are forwarded to the device's host session over frame
 * pairs; the host answers with `http-head/http-chunk/http-end` which we write
 * straight onto the phone response in arrival order (frame order = stream
 * order, so SSE and blob streams survive untouched).
 *
 * Request bodies are always chunked (`http-req` then `http-body` frames,
 * each ≤ 64 KiB, finished by `http-body-end`); the host treats a missing
 * `bodyBase64` on `http-req` as "body comes in follow-up frames".
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  HTTP_IDLE_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_REQUEST_BODY_BYTES,
  T,
} from './const.ts'
import type { HostSession } from './sessions.ts'

type Frame = Record<string, unknown>

// Non-secure contexts (plain http:// over the LAN) have no
// `crypto.randomUUID` even in modern browsers — it is a secure-context API
// (MDN). The dsh web UI calls it while loading its reminder store, so the
// mobile UI crashes on plain-http relays. getRandomValues, by contrast,
// is available everywhere; inject a tiny polyfill into any forwarded
// text/html stream. Under a TLS termination relay the polyfill is a no-op.
const UUID_POLYFILL = `<script>(function(){if(typeof crypto!=='undefined'&&typeof crypto.randomUUID!=='function'){crypto.randomUUID=function(){var b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=b[6]&15|64;b[8]=b[8]&63|128;return Array.from(b,function(x){return x.toString(16).padStart(2,'0')}).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5')}}})()<\/script>\n`

/** Prepend the polyfill right after the upstream `<!doctype html>`, which the
 * dsh web UI emits on its first line; falls back to a raw prepend. */
function withHtmlPolyfill(chunk: Buffer): Buffer<ArrayBuffer> {
  const text = chunk.toString('utf8')
  const start = text.toLowerCase().indexOf('<!doctype')
  if (start >= 0) {
    const end = text.indexOf('>', start)
    if (end >= 0) {
      return Buffer.concat([
        Buffer.from(text.slice(0, end + 1), 'utf8'),
        Buffer.from(UUID_POLYFILL, 'utf8'),
        Buffer.from(text.slice(end + 1), 'utf8'),
      ])
    }
  }
  return Buffer.concat([Buffer.from(UUID_POLYFILL, 'utf8'), chunk])
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

interface PendingHttp {
  /** Target host of this request — every response frame routes through it. */
  host: HostSession
  res: ServerResponse
  headSent: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  /** Upstream answered text/html: the first chunk carries the UUID polyfill. */
  htmlPending: boolean
  /** Set once the polyfill has been injected into the stream. */
  injected: boolean
}

function splitPathQuery(raw: string): { path: string; query: string } {
  const index = raw.indexOf('?')
  if (index === -1) return { path: raw, query: '' }
  return { path: raw.slice(0, index), query: raw.slice(index) }
}

/** Forwardable upstream headers: lowercase, hop-by-hop and relay-owned stripped. */
function gatherHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    if (lower === 'host' || lower.startsWith('sec-websocket-') || lower.startsWith('x-forwarded-')) continue
    if (value === undefined) continue
    out[lower] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

export class HttpProxy {
  private nextId = 1
  private readonly pending = new Map<number, PendingHttp>()

  constructor(private readonly log: (message: string) => void) {}

  /** Push a frame onto the host socket; throws when the host went away. */
  private sendTo(host: HostSession, frame: Frame): void {
    host.ws.send(JSON.stringify(frame))
  }

  private armIdleKill(pending: PendingHttp, id: number): void {
    if (pending.timer !== undefined) clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      pending.timer = undefined
      this.pending.delete(id)
      pending.res.destroy()
    }, HTTP_IDLE_TIMEOUT_MS)
  }

  private clearIdleKill(pending: PendingHttp): void {
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer)
      pending.timer = undefined
    }
  }

  /**
   * Relay side of one phone HTTP request. Pushes frames to the host and wires
   * the host's response frames back through {@link onHostFrame}.
   */
  handlePhoneHttp(
    req: IncomingMessage,
    res: ServerResponse,
    host: HostSession,
    restPath: string,
  ): void {
    const id = this.nextId++
    const pending: PendingHttp = { host, res, headSent: false, timer: undefined, htmlPending: false, injected: false }
    this.pending.set(id, pending)
    this.armIdleKill(pending, id)

    const sendSafe = (frame: Frame): void => {
      try {
        this.sendTo(host, frame)
      } catch (error) {
        this.log(`http-proxy: send failed for #${id}: ${String((error as Error).message ?? error)}`)
        this.abort(id, pending)
      }
    }
    const abort = (): void => this.abort(id, pending)

    const { path, query } = splitPathQuery(restPath)
    sendSafe({
      t: T.HTTP_REQ,
      id,
      method: req.method ?? 'GET',
      path,
      query,
      headers: gatherHeaders(req),
    })

    // Stream the body in ≤64 KiB frames; terminate with http-body-end.
    let buffered: Buffer[] = []
    let bufferedBytes = 0
    let bodyEnded = false

    const flush = (): void => {
      if (buffered.length === 0) return
      const merged = Buffer.concat(buffered, bufferedBytes)
      buffered = []
      bufferedBytes = 0
      for (let offset = 0; offset < merged.length; offset += MAX_FRAME_BYTES) {
        const piece = merged.subarray(offset, offset + MAX_FRAME_BYTES)
        sendSafe({ t: T.HTTP_BODY, id, dataBase64: piece.toString('base64') })
        this.armIdleKill(pending, id)
      }
    }

    req.on('data', (chunk: Buffer) => {
      if (bodyEnded) return
      bufferedBytes += chunk.length
      if (bufferedBytes > MAX_REQUEST_BODY_BYTES) {
        bodyEnded = true
        sendSafe({ t: T.HTTP_ABORT, id })
        this.abort(id, pending)
        return
      }
      buffered.push(chunk)
      if (bufferedBytes >= MAX_FRAME_BYTES) flush()
    })
    req.on('end', () => {
      if (bodyEnded) return
      bodyEnded = true
      flush()
      sendSafe({ t: T.HTTP_BODY_END, id })
      this.armIdleKill(pending, id)
    })
    req.on('error', (error: Error) => {
      this.log(`http-proxy: phone req error for #${id}: ${error.message}`)
      if (!bodyEnded) {
        bodyEnded = true
        sendSafe({ t: T.HTTP_ABORT, id })
      }
    })
    // Phone-disconnect detection lives on the response: IncomingMessage
    // 'close' now fires as soon as the request body is fully read (Node
    // >=17.6), which would abort every healthy request. `writableEnded`
    // distinguishes the normal finish from a dropped phone.
    res.on('close', () => {
      if (!res.writableEnded && this.pending.has(id)) {
        this.log(`http-proxy: phone res close for #${id} (pending=${this.pending.has(id)})`)
        this.abort(id, pending)
      }
    })
  }

  private abort(id: number, pending: PendingHttp): void {
    if (!this.pending.has(id)) return
    this.pending.delete(id)
    this.clearIdleKill(pending)
    try { this.sendTo(pending.host, { t: T.HTTP_ABORT, id }) } catch { /* dead host */ }
    pending.res.destroy()
  }

  /** Handle a host→relay response frame for an in-flight request. */
  onHostFrame(frame: Frame): void {
    const id = Number(frame.id)
    const pending = this.pending.get(id)
    if (pending === undefined) return
    switch (frame.t) {
      case T.HTTP_HEAD: {
        const headHeaders = (frame.headers as Record<string, string>) ?? {}
        if (!pending.headSent) {
          pending.res.writeHead(Number(frame.status) || 502, headHeaders)
          pending.headSent = true
        }
        pending.htmlPending = String(headHeaders['content-type'] ?? '').toLowerCase().includes('text/html')
        this.armIdleKill(pending, id)
        break
      }
      case T.HTTP_CHUNK: {
        if (pending.headSent) {
          let chunk = Buffer.from(frame.dataBase64 as string, 'base64')
          if (pending.htmlPending && !pending.injected) {
            pending.injected = true
            chunk = withHtmlPolyfill(chunk)
          }
          pending.res.write(chunk)
          this.armIdleKill(pending, id)
        }
        break
      }
      case T.HTTP_END: {
        if (!pending.headSent) {
          pending.res.writeHead(502, {})
          pending.headSent = true
        }
        this.clearIdleKill(pending)
        pending.res.end()
        this.pending.delete(id)
        break
      }
      case T.HTTP_ERR: {
        this.clearIdleKill(pending)
        if (pending.headSent) {
          pending.res.destroy()
        } else {
          pending.res.writeHead(502, { 'X-Dsh-Relay-Error': String(frame.code ?? 'UPSTREAM_ERROR') })
          pending.res.end()
        }
        this.pending.delete(id)
        break
      }
      default:
        this.log(`http-proxy: dropped frame ${String(frame.t)} for #${id}`)
    }
  }

  /** Drop every in-flight phone request of a specific (now-gone) host. */
  purgeHost(host: HostSession): void {
    for (const [id, pending] of [...this.pending]) {
      if (pending.host !== host) continue
      this.pending.delete(id)
      this.clearIdleKill(pending)
      try { this.sendTo(host, { t: T.HTTP_ABORT, id }) } catch { /* dead host */ }
      pending.res.destroy()
    }
  }
}