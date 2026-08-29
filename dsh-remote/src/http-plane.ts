/**
 * HTTP reverse-proxy plane (PROTOCOL §5) — the host side.
 *
 * Frames from the relay (`http-req/http-body/http-body-end/http-abort`) are
 * turned into a real request against the local dsh web server; the response
 * streams back as `http-head/http-chunk/http-end` (or `http-err`). One
 * in-flight request per relay id; chunk order is guaranteed by single-reader
 * consumption, so SSE and blob streams survive untouched.
 */

import { HTTP_CHUNK_BYTES, T } from './frames.js'
import type { Frame } from './agent.js'
import { injectMobileShim } from './mobile-shim.js'

export type Send = (frame: Frame) => void

const REQUEST_FORBIDDEN = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
  // `host` is rebuilt from the local origin; content-length from the assembled body.
  'host',
  'content-length',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
  // Browser-trust attestation must not leak to the local dsh server. Its /api
  // fence (client-connection api-request-trust) requires Origin to equal Host,
  // and the phone page's origin (192.168.5.2:8787) can never match the
  // loopback Host undici attaches here — leaking these makes every /api call
  // 403. Strip the markers so the upstream request reads as the identical
  // loopback client it actually is.
  'origin',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'referer',
])

const RESPONSE_FORBIDDEN = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // The response is re-chunked into frames, so a pre-announced length cannot hold.
  'content-length',
])

/**
 * Client-bundle rewrites applied to tunnel traffic only. The dsh web client
 * keys its settings mirror on `connection.isLoopback`, which reads the page
 * hostname — a phone behind the relay never qualifies, so every settings
 * surface (model provider catalog, plugin config sections) would stay
 * permanently disabled even though tunneled /api traffic passes the Host
 * fence and `settings.describe` answers redacted (secret-role fields never
 * ride the wire). Forcing the shared mirror to host persistence restores
 * those surfaces for tunnel sessions; desktop/GUI traffic never crosses this
 * plane. Marker-absent (a future dsh build changing that line) degrades to
 * pass-through.
 */
const CLIENT_BUNDLE_REWRITES: ReadonlyArray<{
  path: string
  from: string
  to: string
}> = [
  {
    path: '/plugins/@deepseek-ai/dsh-client-ui-settings/client.js',
    from: 'connection.isLoopback ? "host" : "memory"',
    to: '"host"',
  },
]

interface Pending {
  id: number
  method: string
  path: string
  query: string
  headers: Record<string, string>
  chunks: Buffer[]
  started: boolean
  controller: AbortController | undefined
}

export interface HttpPlaneOptions {
  /** Local dsh web origin, e.g. `http://127.0.0.1:5173`. */
  origin: () => string
  log: (message: string) => void
  send: Send
}

export class HttpPlane {
  private readonly pending = new Map<number, Pending>()
  /** Marker-miss warnings already logged, one per rewrite entry per process. */
  private readonly warnedRewriteMisses = new Set<string>()

  constructor(private readonly options: HttpPlaneOptions) {}

  /** Dispatch a relay frame belonging to the http plane. */
  handle(frame: Frame): void {
    const id = Number(frame.id)
    switch (frame.t) {
      case T.HTTP_REQ: {
        if (this.pending.has(id)) return
        const pending: Pending = {
          id,
          method: typeof frame.method === 'string' ? frame.method : 'GET',
          path: typeof frame.path === 'string' ? frame.path : '/',
          query: typeof frame.query === 'string' ? frame.query : '',
          headers: (frame.headers as Record<string, string>) ?? {},
          chunks: [],
          started: false,
          controller: undefined,
        }
        if (typeof frame.bodyBase64 === 'string' && frame.bodyBase64 !== '') {
          pending.chunks.push(Buffer.from(frame.bodyBase64, 'base64'))
        }
        this.pending.set(id, pending)
        break
      }
      case T.HTTP_BODY: {
        const pending = this.pending.get(id)
        if (pending === undefined || pending.started) break
        pending.chunks.push(Buffer.from(String(frame.dataBase64 ?? ''), 'base64'))
        break
      }
      case T.HTTP_BODY_END: {
        const pending = this.pending.get(id)
        if (pending === undefined || pending.started) break
        pending.started = true
        void this.run(pending)
        break
      }
      case T.HTTP_ABORT: {
        const pending = this.pending.get(id)
        if (pending === undefined) break
        this.pending.delete(id)
        if (pending.controller !== undefined) {
          try { pending.controller.abort() } catch { /* already aborted */ }
        }
        break
      }
      default:
        this.options.log(`http-plane: unexpected frame ${String(frame.t)}`)
    }
  }

  private async run(pending: Pending): Promise<void> {
    try {
      await this.perform(pending)
    } catch (error) {
      const aborted = pending.controller?.signal.aborted
      this.pending.delete(pending.id)
      if (aborted) return // phone is gone — nothing to answer
      this.options.log(`upstream request ${pending.id} failed: ${(error as Error).message}`)
      this.options.send({ t: T.HTTP_ERR, id: pending.id, code: 'UPSTREAM_DOWN', message: (error as Error).message })
    }
  }

  private async perform(pending: Pending): Promise<void> {
    const controller = new AbortController()
    pending.controller = controller

    const method = pending.method
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const body = hasBody
      ? (pending.chunks.length === 0 ? undefined : Buffer.concat(pending.chunks))
      : undefined

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(pending.headers)) {
      const lower = key.toLowerCase()
      if (REQUEST_FORBIDDEN.has(lower)) continue
      headers[lower] = value
    }

    const response = await fetch(this.options.origin() + pending.path + pending.query, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    })

    // Response head — hop-by-hop and length headers stripped for frame re-chunking.
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (RESPONSE_FORBIDDEN.has(lower)) return
      responseHeaders[lower] = value
    })
    this.options.send({ t: T.HTTP_HEAD, id: pending.id, status: response.status, headers: responseHeaders })

    if (response.body === null) {
      this.pending.delete(pending.id)
      this.options.send({ t: T.HTTP_END, id: pending.id })
      return
    }

    const rewrite = CLIENT_BUNDLE_REWRITES.find((entry) => entry.path === pending.path)
    if (rewrite !== undefined) {
      await this.streamRewritten(pending, rewrite, response.body)
      return
    }
    if ((responseHeaders['content-type'] ?? '').includes('text/html')) {
      await this.streamHtml(pending, response.body)
      return
    }

    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > 0) {
        this.sendBuffered(pending, Buffer.from(value))
      }
    }
    // Release the controller so a late abort after stream end is ignored.
    this.pending.delete(pending.id)
    this.options.send({ t: T.HTTP_END, id: pending.id })
  }

  /** Chunk one in-memory buffer to the relay in frame-sized pieces. */
  private sendBuffered(pending: Pending, body: Buffer): void {
    for (let offset = 0; offset < body.byteLength; offset += HTTP_CHUNK_BYTES) {
      const piece = body.subarray(offset, offset + HTTP_CHUNK_BYTES)
      this.options.send({ t: T.HTTP_CHUNK, id: pending.id, dataBase64: piece.toString('base64') })
    }
  }

  /**
   * Buffered send for the app shell: every text/html response is the SPA
   * index, small and static, so the whole body is read and the mobile shim
   * (viewport fix + responsive stylesheet) injected before it streams out.
   * Desktop/GUI traffic never crosses this plane, so the shim only ever
   * reaches tunnel sessions.
   */
  private async streamHtml(pending: Pending, stream: ReadableStream<Uint8Array>): Promise<void> {
    const chunks: Buffer[] = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > 0) chunks.push(Buffer.from(value))
    }
    const body = injectMobileShim(Buffer.concat(chunks).toString('utf8'))
    this.sendBuffered(pending, Buffer.from(body, 'utf8'))
    // Release the controller so a late abort after stream end is ignored.
    this.pending.delete(pending.id)
    this.options.send({ t: T.HTTP_END, id: pending.id })
  }

  /**
   * Buffered send for rewrite targets: these are bounded static bundles the
   * local server answers as one file, so the whole body is read, the marker
   * replacement applied, and the result re-chunked. A body without the marker
   * (dsh build drift) ships unmodified; the mismatch is logged once per entry.
   */
  private async streamRewritten(
    pending: Pending,
    rewrite: { path: string; from: string; to: string },
    stream: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const chunks: Buffer[] = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > 0) chunks.push(Buffer.from(value))
    }
    const original = Buffer.concat(chunks)
    let body = original
    if (original.includes(rewrite.from)) {
      body = Buffer.from(original.toString('utf8').replaceAll(rewrite.from, rewrite.to), 'utf8')
    } else if (!this.warnedRewriteMisses.has(rewrite.path)) {
      this.warnedRewriteMisses.add(rewrite.path)
      this.options.log(`http-plane: rewrite marker missing in ${rewrite.path}; serving unmodified`)
    }
    this.sendBuffered(pending, body)
    // Release the controller so a late abort after stream end is ignored.
    this.pending.delete(pending.id)
    this.options.send({ t: T.HTTP_END, id: pending.id })
  }
}