/**
 * relay-server entry: a single HTTP(S) listener multiplexing (PROTOCOL §1):
 *
 * - /ws?role=host   host registration WebSocket (desktop dsh-remote plugin)
 * - /ws?role=phone  phone handshake WebSocket (challenge-response auth)
 * - /pair           pairing page + code→challenge+ticket exchange
 * - /d/<deviceId>/* phone proxy surface: every request/upgrade on it is
 *                   forwarded to the device's host through the two planes
 *
 * Cookie-based identity (§8): after `/pair` the phone claims an HttpOnly
 * `dsh-relay` cookie via `/d/<id>/__claim`, and the relay derives the phone
 * session from that cookie on every later request — the host then receives
 * `x-dsh-relay-token` on all forwarded traffic.
 */

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { ChallengeStore, makePairCode, sha256Hex } from './auth.ts'
import {
  PAIR_CODE_TTL_MS,
  PAIR_RATE_MAX,
  PAIR_RATE_WINDOW_MS,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  PROTOCOL_VERSION,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_MS,
  T,
  TOKEN_HEADER,
} from './const.ts'
import { HttpProxy } from './http-proxy.ts'
import { adminHtml, indexHtml, manifestJson, pairHtml } from './pages.ts'
import type { HostSession, PhoneSession } from './sessions.ts'
import { Sessions } from './sessions.ts'
import { JsonlStore } from './store.ts'
import { WsBridge } from './ws-bridge.ts'

const DEVICE_PREFIX = '/d/'

export interface RelayOptions {
  /** Shared token the desktop plugin must present in `hello` (single trust boundary, PROTOCOL §10). */
  hostToken: string
  /** Password for the admin console (/admin). When null/empty, /admin is disabled. */
  adminToken: string | null
  /** Directory for the JSONL store; default `~/.dsh-remote-relay`. */
  dataDir: string
}

interface HostCtx {
  session: HostSession
  alive: boolean
  rate: number[] // pair-refresh attempts in the window
}

export class RelayServer {
  private readonly sessions = new Sessions()
  private readonly store: JsonlStore
  private readonly challenges = new ChallengeStore()
  private readonly proxy: HttpProxy
  private readonly bridge: WsBridge
  private readonly hosts = new Map<WebSocket, HostCtx>()
  private readonly phoneRate = new Map<string, number[]>()
  /** Admin console cookie sessionId → expiry (ms). Memory-only, like phones. */
  private readonly admins = new Map<string, number>()
  private readonly adminRate = new Map<string, number[]>()

  private readonly server = createServer((req, res) => void this.onRequest(req, res))
  private readonly wss = new WebSocketServer({ noServer: true })
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly options: RelayOptions, private readonly log: (message: string) => void) {
    this.store = new JsonlStore(options.dataDir, this.log)
    this.proxy = new HttpProxy(this.log)
    this.bridge = new WsBridge(this.sessions, this.log, this.wss)

    this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head))
  }

  /** Optional hook invoked once the listener is up (used by the CLI banner). */
  onServing: (() => void) | null = null

  async start(port: number, host = '0.0.0.0'): Promise<void> {
    await this.store.load()
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, host, () => {
        this.server.removeListener('error', reject)
        this.log(`relay listening on http://${host}:${port}`)
        this.onServing?.()
        resolve()
      })
    })
    this.heartbeatTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS)
    this.heartbeatTimer.unref()
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer)
    for (const ctx of this.hosts.values()) {
      try { ctx.session.ws.close(1001, 'relay shutting down') } catch { /* gone */ }
    }
    this.bridge.closeAll()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  // -- routing ---------------------------------------------------------------

  private onRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'

    if (url.pathname === '/' || url.pathname === '') {
      // Already identified visitors land straight on their device.
      const deviceId = this.deviceFromCookie(req)
      if (deviceId !== null) return this.redirect(res, `/d/${encodeURIComponent(deviceId)}/`)
      return this.html(res, 200, indexHtml())
    }

    if (url.pathname === '/pair') {
      if (method === 'GET') return this.html(res, 200, pairHtml())
      if (method === 'POST') return this.onPair(req, res)
      return this.plain(res, 405, 'method not allowed')
    }

    // The dsh web UI references the manifest root-absolute, and browsers fetch
    // it with credentials omitted — before the device routes and without any
    // cookie, so it cannot be proxied; answer with the static relay manifest.
    if (url.pathname === '/manifest.webmanifest') {
      if (method !== 'GET' && method !== 'HEAD') return this.plain(res, 405, 'method not allowed')
      const bytes = Buffer.from(manifestJson())
      res.writeHead(200, {
        'Content-Type': 'application/manifest+json',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-cache',
      })
      res.end(bytes)
      return
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/login' || url.pathname === '/admin/logout'
      || url.pathname === '/admin/api/state' || url.pathname === '/admin/api/revoke'
      || url.pathname === '/admin/api/disconnect' || url.pathname === '/admin/api/remove') {
      return this.onAdminRequest(req, res, url, method)
    }

    if (url.pathname.startsWith(DEVICE_PREFIX)) {
      const rest = url.pathname.slice(DEVICE_PREFIX.length)
      const slash = rest.indexOf('/')
      const deviceId = slash === -1 ? rest : rest.slice(0, slash)
      const restPath = slash === -1 || slash === rest.length - 1 ? '/' : rest.slice(slash)
      if (deviceId === '' || !/^[a-f0-9]{32}$/.test(deviceId)) {
        return this.plain(res, 400, 'bad device id')
      }
      return this.onDeviceRequest(req, res, deviceId, restPath, url.search)
    }

    // Raw-path fallback: the dsh web UI loads its assets with root-absolute
    // URLs (`/plugins/...`, `/assets/...`) and later issues runtime fetches
    // like `/api/...` — all of them bypass the `/d/<id>/` prefix. Route such
    // requests to the device the phone cookie belongs to, so the mobile UI
    // works without rewriting the upstream HTML.
    const cookiePhone = this.phoneFromCookie(req)
    if (cookiePhone !== null) {
      return this.onDeviceRequest(req, res, cookiePhone.deviceId, url.pathname, url.search)
    }

    this.plain(res, 404, 'not found')
  }

  private onUpgrade(
    req: IncomingMessage,
    socket: Parameters<typeof this.wss.handleUpgrade>[1],
    head: Buffer,
  ): void {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/ws') {
      const role = url.searchParams.get('role')
      if (role === 'host') return this.acceptHost(req, socket, head)
      if (role === 'phone') return this.acceptPhone(req, socket, head)
      socket.destroy()
      return
    }

    if (url.pathname.startsWith(DEVICE_PREFIX)) {
      const rest = url.pathname.slice(DEVICE_PREFIX.length)
      const slash = rest.indexOf('/')
      const deviceId = slash === -1 ? rest : rest.slice(0, slash)
      const restPath = slash === -1 ? '/' : rest.slice(slash)
      if (deviceId === '' || !/^[a-f0-9]{32}$/.test(deviceId)) {
        socket.destroy()
        return
      }
      const phone = this.resolvePhone(req, deviceId)
      if (phone === null) {
        this.log(`upgrade rejected: no phone session for ${deviceId}`)
        socket.destroy()
        return
      }
      // Pass the raw query along: ws pieces like /events/mux carry it too.
      this.bridge.handleUpgrade(req, socket, head, phone, deviceId, restPath + url.search)
      return
    }

    // Raw-path upgrade fallback: dsh UI scripts open root-absolute
    // WebSocket/SSE endpoints (e.g. `/events/mux`) — bridge them through the
    // phone's device just like /d/<id> upgrades.
    const cookieDevice = this.deviceFromCookie(req)
    if (cookieDevice !== null) {
      const cookiePhone = this.resolvePhone(req, cookieDevice)
      if (cookiePhone !== null) {
        this.bridge.handleUpgrade(req, socket, head, cookiePhone, cookieDevice, url.pathname + url.search)
        return
      }
    }

    socket.destroy()
  }

  // -- pairing + claim (HTTP) ------------------------------------------------

  private onPair(req: IncomingMessage, res: ServerResponse): void {
    const remote = req.socket.remoteAddress ?? 'unknown'
    const key = `${sha256Hex(remote)}:${req.socket.remotePort}`

    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      let code: unknown
      try {
        code = (JSON.parse(body) as { code?: unknown }).code
      } catch {
        return this.json(res, 400, { ok: false, error: { code: 'BAD_BODY', message: '请求格式错误' } })
      }
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return this.json(res, 400, { ok: false, error: { code: 'BAD_CODE', message: '配对码应为 6 位数字' } })
      }
      if (!this.allowPairAttempt(key)) {
        return this.json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' } })
      }

      const device = this.store.findDeviceByCode(code)
      if (device === null) {
        return this.json(res, 404, { ok: false, error: { code: 'BAD_CODE', message: '配对码无效或已过期' } })
      }

      const token = randomBytes(32).toString('hex')
      this.store.addToken(device.deviceId, token)
      const issued = this.challenges.issue(device.deviceId, code, token)
      this.log(`pair ok: device=${device.deviceId.slice(0, 8)}… (code never logged)`)
      this.json(res, 200, {
        ok: true,
        deviceId: device.deviceId,
        challenge: issued.challenge,
        challengeTtlMs: issued.ttlMs,
        token,
      })
    })
    req.on('error', () => this.plain(res, 400, 'bad request'))
  }

  // -- device proxy surface (HTTP + claim) -----------------------------------

  private onDeviceRequest(
    req: IncomingMessage,
    res: ServerResponse,
    deviceId: string,
    restPath: string,
    query: string,
  ): void {
    // Claim: exchange the pairing token for an HttpOnly session cookie.
    if (restPath === '/__claim') {
      const phone = this.createPhoneFromToken(req, deviceId)
      if (phone === null) return this.plain(res, 401, 'bad token')
      this.setSessionCookie(res, phone)
      this.log(`claim ok: device=${deviceId.slice(0, 8)}…`)
      return this.json(res, 200, { ok: true })
    }

    const phone = this.resolvePhone(req, deviceId)
    if (phone === null) {
      // Not identified: friendlier to bounce to /pair than to leak 401s.
      return this.redirect(res, '/pair')
    }

    const host = this.sessions.getHost(deviceId)
    if (host === null) {
      res.setHeader('X-Dsh-Relay', 'host offline')
      return this.plain(res, 409, '主机离线')
    }

    // Tag forwarded traffic with the phone identity (§8).
    req.headers[TOKEN_HEADER] = phone.token
    this.proxy.handlePhoneHttp(req, res, host, `${restPath}${query}`)
  }

  // -- host registration (WebSocket) -----------------------------------------

  private acceptHost(
    req: IncomingMessage,
    socket: Parameters<typeof this.wss.handleUpgrade>[1],
    head: Buffer,
  ): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data: Buffer) => this.onHostMessage(ws, data.toString('utf8')))
      ws.on('close', () => this.onHostClosed(ws))
      ws.on('error', () => this.onHostClosed(ws))
    })
  }

  private onHostMessage(ws: WebSocket, raw: string): void {
    let frame: { t?: unknown } & Record<string, unknown>
    try {
      frame = JSON.parse(raw) as typeof frame
    } catch {
      return
    }
    if (frame.t === undefined) return

    const ctx = this.hosts.get(ws)
    if (ctx === undefined) {
      // First frame must be a well-formed host hello.
      if (frame.t !== T.HELLO) {
        this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'NO_HELLO' })
        ws.close()
        return
      }
      return this.onHostHello(ws, frame)
    }

    ctx.session.lastSeen = Date.now()
    this.log(`relay host-frame: ${String(frame.t)}${frame.id !== undefined ? ` #${String(frame.id)}` : ''}`)
    switch (frame.t) {
      case T.PONG:
        break
      case T.PAIR_REFRESH:
        this.refreshPairCode(ws, ctx)
        break
      case T.REVOKE:
        this.revokeDevice(ws, ctx)
        break
      case T.HTTP_HEAD:
      case T.HTTP_CHUNK:
      case T.HTTP_END:
      case T.HTTP_ERR:
        this.proxy.onHostFrame(frame)
        break
      case T.WS_OPEN_OK:
      case T.WS_OPEN_ERR:
      case T.WS_FRAME:
      case T.WS_CLOSE:
        this.bridge.onHostFrame(frame)
        break
      default:
        this.log(`host: dropped frame ${String(frame.t)}`)
    }
  }

  private onHostHello(ws: WebSocket, frame: Record<string, unknown>): void {
    if (frame.v !== PROTOCOL_VERSION) {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'BAD_VERSION' })
      ws.close()
      return
    }
    if (frame.role !== 'host') {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'BAD_ROLE' })
      ws.close()
      return
    }
    const token = frame.hostToken
    const deviceId = frame.deviceId
    if (typeof token !== 'string' || typeof deviceId !== 'string' || !/^[a-f0-9]{32}$/.test(deviceId)) {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'BAD_HELLO' })
      ws.close()
      return
    }
    if (!this.constantsTokenEquals(token)) {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'BAD_TOKEN' })
      this.log(`host deny: bad token for ${deviceId.slice(0, 8)}…`)
      ws.close()
      return
    }

    // First contact auto-registers the device (PROTOCOL §9).
    const hostName = typeof frame.hostName === 'string' ? frame.hostName : 'DSH Desktop'
    const device = this.store.upsertDevice(deviceId, hostName)

    const session: HostSession = {
      deviceId,
      ws,
      hostName: device.hostName,
      connectedAt: Date.now(),
      pair: null,
      lastSeen: Date.now(),
    }
    this.sessions.registerHost(deviceId, ws, device.hostName)
    this.hosts.set(ws, { session, alive: true, rate: [] })

    // Always serve a fresh pairing code for the settings page (§3).
    this.refreshPairCode(ws, this.hosts.get(ws)!)
    const pair = this.hosts.get(ws)?.session.pair ?? null
    this.sendRaw(ws, {
      t: T.HELLO_OK,
      deviceId,
      hostName: session.hostName,
      pair: pair === null ? null : { code: pair.code, expiresAt: pair.expiresAt },
    })

    this.log(`host online: ${deviceId.slice(0, 8)}… (${session.hostName})`)
  }

  private refreshPairCode(ws: WebSocket, ctx: HostCtx): void {
    const now = Date.now()
    const recent = ctx.rate.filter((stamp) => now - stamp < PAIR_RATE_WINDOW_MS)
    if (recent.length >= PAIR_RATE_MAX) {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'RATE_LIMITED' })
      return
    }
    recent.push(now)
    ctx.rate = recent

    const code = makePairCode()
    const expiresAt = Date.now() + PAIR_CODE_TTL_MS
    this.store.upsertPairing(ctx.session.deviceId, code, expiresAt)
    ctx.session.pair = { code, expiresAt }
    this.sendRaw(ws, { t: T.PAIR, code, expiresAt })
  }

  private revokeDevice(ws: WebSocket, ctx: HostCtx): void {
    const deviceId = ctx.session.deviceId
    this.store.revokeDeviceToken(deviceId)
    this.sessions.disposeDevicePhones(deviceId)
    this.bridge.purgeDevice(deviceId)
    ctx.session.pair = null
    this.sendRaw(ws, { t: T.REVOKED })
    this.log(`revoke: all phone tokens dropped for ${deviceId.slice(0, 8)}…`)
  }

  private onHostClosed(ws: WebSocket): void {
    const ctx = this.hosts.get(ws)
    if (ctx === undefined) return
    this.hosts.delete(ws)
    this.sessions.unregisterHost(ctx.session.deviceId)
    this.proxy.purgeHost(ctx.session)
    this.bridge.purgeDevice(ctx.session.deviceId)
    this.log(`host offline: ${ctx.session.deviceId.slice(0, 8)}…`)
  }

  // -- phone handshake (WebSocket) -------------------------------------------

  private acceptPhone(
    req: IncomingMessage,
    socket: Parameters<typeof this.wss.handleUpgrade>[1],
    head: Buffer,
  ): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data: Buffer) => this.onPhoneMessage(ws, data.toString('utf8')))
      ws.on('close', () => { /* nothing to bookkeep */ })
      ws.on('error', () => ws.close())
    })
  }

  private onPhoneMessage(ws: WebSocket, raw: string): void {
    let frame: { t?: unknown } & Record<string, unknown>
    try {
      frame = JSON.parse(raw) as typeof frame
    } catch {
      return
    }
    if (frame.t === undefined) return

    if (frame.t === T.HELLO) {
      return this.onPhoneHello(ws, frame)
    }
    if (frame.t === T.PONG) return
    this.log(`phone: dropped frame ${String(frame.t)}`)
  }

  private onPhoneHello(ws: WebSocket, frame: Record<string, unknown>): void {
    if (frame.v !== PROTOCOL_VERSION || frame.role !== 'phone') {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'BAD_HELLO' })
      ws.close()
      return
    }
    const deviceId = frame.deviceId
    const token = frame.token
    if (typeof deviceId !== 'string' || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(deviceId)) {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'BAD_HELLO' })
      ws.close()
      return
    }

    let tokenSha: string | null = null
    const challenge = frame.challenge
    const response = frame.response
    if (typeof challenge === 'string' && typeof response === 'string') {
      // Fresh pairing: consume the one-shot challenge (PROTOCOL §4).
      tokenSha = this.challenges.consume(challenge, deviceId, response)
    } else {
      const sha = sha256Hex(token)
      const row = this.store.findTokenBySha(sha)
      if (row !== null && row.deviceId === deviceId && this.store.isTokenActive(sha) && row.revokedAt === null) {
        tokenSha = sha
      }
    }
    if (tokenSha === null) {
      this.sendRaw(ws, { t: T.HELLO_DENY, reason: 'AUTH_FAILED' })
      ws.close()
      return
    }

    const host = this.sessions.getHost(deviceId)
    this.sendRaw(ws, {
      t: T.HELLO_OK,
      peer: {
        online: host !== null,
        hostName: host?.hostName ?? null,
      },
    })
  }

  // -- admin console --------------------------------------------------------

  private onAdminRequest(req: IncomingMessage, res: ServerResponse, url: URL, method: string): void {
    const adminToken = this.options.adminToken
    if (adminToken === null || adminToken === '') return this.plain(res, 404, 'not found')

    if (url.pathname === '/admin' || url.pathname === '/admin/login') {
      if (url.pathname === '/admin' && method === 'GET') return this.html(res, 200, adminHtml())
      if (url.pathname === '/admin/login' && method === 'POST') return this.onAdminLogin(req, res)
      return this.plain(res, 405, 'method not allowed')
    }

    if (url.pathname === '/admin/logout' && method === 'POST') return this.onAdminLogout(req, res)
    if (!this.adminAuthorized(req)) return this.json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } })

    switch (url.pathname) {
      case '/admin/api/state':
        if (method !== 'GET') break
        return this.json(res, 200, this.adminState())
      case '/admin/api/revoke':
        if (method !== 'POST') break
        return this.onAdminRevoke(req, res, false)
      case '/admin/api/disconnect':
        if (method !== 'POST') break
        return this.onAdminRevoke(req, res, true)
      case '/admin/api/remove':
        if (method !== 'POST') break
        return this.onAdminRemove(req, res)
    }
    this.plain(res, 405, 'method not allowed')
  }

  /**
   * Remove a device and every trace of it (tokens, pairings, sessions). Only
   * allowed while its host is offline: a live host would re-register itself
   * on the next hello (§9), making the removal a no-op that comes back.
   */
  private onAdminRemove(req: IncomingMessage, res: ServerResponse): void {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      let deviceId: unknown
      try {
        deviceId = (JSON.parse(body) as { deviceId?: unknown }).deviceId
      } catch {
        return this.json(res, 400, { ok: false, error: { code: 'BAD_BODY', message: '请求格式错误' } })
      }
      if (typeof deviceId !== 'string' || !/^[a-f0-9]{32}$/.test(deviceId)) {
        return this.json(res, 400, { ok: false, error: { code: 'BAD_DEVICE', message: '设备标识无效' } })
      }
      if (this.sessions.getHost(deviceId) !== null) {
        return this.json(res, 409, {
          ok: false,
          error: { code: 'HOST_ONLINE', message: '设备在线：请先在桌面端退出 dsh-remote 连接（或断网）后再删除' },
        })
      }
      this.sessions.disposeDevicePhones(deviceId)
      this.bridge.purgeDevice(deviceId)
      this.store.forgetDevice(deviceId)
      this.log(`admin remove: device ${deviceId.slice(0, 8)}… forgotten (tokens, pairings, sessions)`)
      this.json(res, 200, { ok: true })
    })
    req.on('error', () => this.plain(res, 400, 'bad request'))
  }

  private onAdminLogin(req: IncomingMessage, res: ServerResponse): void {
    const remote = req.socket.remoteAddress ?? 'unknown'
    const key = this.adminRateKey(remote)
    if (!this.allowAdminAttempt(key)) {
      return this.json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' } })
    }
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      let password: unknown
      try {
        password = (JSON.parse(body) as { password?: unknown }).password
      } catch {
        return this.json(res, 400, { ok: false, error: { code: 'BAD_BODY', message: '请求格式错误' } })
      }
      if (typeof password !== 'string' || !constantTimeEquals(password, this.options.adminToken ?? '')) {
        return this.json(res, 401, { ok: false, error: { code: 'BAD_PASSWORD', message: '口令错误' } })
      }
      const sessionId = randomBytes(16).toString('hex')
      const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS
      this.admins.set(sessionId, expiresAt)
      const cookie = `${ADMIN_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`
      res.setHeader('Set-Cookie', [cookie])
      this.log('admin login ok')
      this.json(res, 200, { ok: true })
    })
    req.on('error', () => this.plain(res, 400, 'bad request'))
  }

  private onAdminLogout(req: IncomingMessage, res: ServerResponse): void {
    const sessionId = readCookie(req.headers.cookie, ADMIN_COOKIE)
    if (sessionId !== null) this.admins.delete(sessionId)
    res.setHeader('Set-Cookie', [`${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`])
    this.json(res, 200, { ok: true })
  }

  private adminAuthorized(req: IncomingMessage): boolean {
    const sessionId = readCookie(req.headers.cookie, ADMIN_COOKIE)
    if (sessionId === null) return false
    const expiresAt = this.admins.get(sessionId)
    if (expiresAt === undefined) return false
    if (Date.now() > expiresAt) {
      this.admins.delete(sessionId)
      return false
    }
    return true
  }

  private adminState(): unknown {
    const now = Date.now()
    const devices = this.store.listDevices().map((device) => {
      const host = this.sessions.getHost(device.deviceId)
      const online = host !== null
      const pair = host?.pair ?? null
      // Token list hygiene: active first, then the newest revoked ones; the
      // rest are folded into a count so a long pairing history stays readable.
      const all = this.store.listTokens(device.deviceId)
      const active = all.filter((row) => row.revokedAt === null)
      const revokedDesc = all.filter((row) => row.revokedAt !== null).reverse()
      const shown = [...active, ...revokedDesc].slice(0, 6)
      return {
        deviceId: device.deviceId,
        hostName: device.hostName,
        createdAt: device.createdAt,
        online,
        connectedAt: host?.connectedAt ?? null,
        lastSeen: host?.lastSeen ?? null,
        pairActive: pair !== null && pair.expiresAt > now,
        pairCode: pair !== null && pair.expiresAt > now ? pair.code : null,
        pairExpiresAt: pair !== null && pair.expiresAt > now ? pair.expiresAt : null,
        phoneSessions: this.sessions.phoneCountFor(device.deviceId),
        tokens: shown.map((row) => ({
          sha: row.tokenSha.slice(0, 12),
          createdAt: row.createdAt,
          revokedAt: row.revokedAt,
        })),
        tokenTotal: all.length,
        tokenActive: active.length,
      }
    })
    // Dead devices sink: online hosts first, then by freshest heartbeat.
    devices.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return (b.lastSeen ?? b.createdAt) - (a.lastSeen ?? a.createdAt)
    })
    return { ok: true, now, devices }
  }

  private onAdminRevoke(req: IncomingMessage, res: ServerResponse, disconnectOnly: boolean): void {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      let deviceId: unknown
      try {
        deviceId = (JSON.parse(body) as { deviceId?: unknown }).deviceId
      } catch {
        return this.json(res, 400, { ok: false, error: { code: 'BAD_BODY', message: '请求格式错误' } })
      }
      if (typeof deviceId !== 'string' || !/^[a-f0-9]{32}$/.test(deviceId)) {
        return this.json(res, 400, { ok: false, error: { code: 'BAD_DEVICE', message: '设备标识无效' } })
      }
      if (disconnectOnly) {
        this.sessions.disposeDevicePhones(deviceId)
        this.bridge.purgeDevice(deviceId)
        this.log(`admin disconnect: phones dropped for ${deviceId.slice(0, 8)}…`)
      } else {
        this.store.revokeDeviceToken(deviceId)
        this.sessions.disposeDevicePhones(deviceId)
        this.bridge.purgeDevice(deviceId)
        // Tell the live host so its settings page drops the stale pair code.
        for (const [ws, ctx] of [...this.hosts]) {
          if (ctx.session.deviceId !== deviceId) continue
          ctx.session.pair = null
          this.sendRaw(ws, { t: T.REVOKED })
          break
        }
        this.log(`admin revoke: all tokens dropped for ${deviceId.slice(0, 8)}…`)
      }
      this.json(res, 200, { ok: true })
    })
    req.on('error', () => this.plain(res, 400, 'bad request'))
  }

  private adminRateKey(remote: string): string {
    return `admin:${sha256Hex(remote)}`
  }

  private allowAdminAttempt(key: string): boolean {
    const now = Date.now()
    const recent = (this.adminRate.get(key) ?? []).filter((stamp) => now - stamp < PAIR_RATE_WINDOW_MS)
    if (recent.length >= PAIR_RATE_MAX) {
      this.adminRate.set(key, recent)
      return false
    }
    recent.push(now)
    this.adminRate.set(key, recent)
    return true
  }

  // -- helpers ---------------------------------------------------------------

  /** Identity from the session cookie, if it names a live phone session. */
  private deviceFromCookie(req: IncomingMessage): string | null {
    const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE)
    if (sessionId === null) return null
    const phone = this.sessions.getPhoneByCookie(sessionId)
    return phone === null ? null : phone.deviceId
  }

  /** Phone session backed by the request cookie, or null when unidentified. */
  private phoneFromCookie(req: IncomingMessage): PhoneSession | null {
    const deviceId = this.deviceFromCookie(req)
    if (deviceId === null) return null
    return this.resolvePhone(req, deviceId)
  }

  /** Resolve identity from cookie, refreshing its sliding TTL. */
  private resolvePhone(req: IncomingMessage, deviceId: string): PhoneSession | null {
    const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE)
    if (sessionId === null) return null
    const phone = this.sessions.getPhoneByCookie(sessionId)
    if (phone === null || phone.deviceId !== deviceId) return null
    this.sessions.touchPhone(phone)
    return phone
  }

  /** Mint a fresh cookie session from a `x-dsh-relay-token` request header. */
  private createPhoneFromToken(req: IncomingMessage, deviceId: string): PhoneSession | null {
    const token = req.headers[TOKEN_HEADER]
    if (typeof token !== 'string') return null
    const sha = sha256Hex(token)
    const row = this.store.findTokenBySha(sha)
    if (row === null || row.deviceId !== deviceId || row.revokedAt !== null) return null
    const sessionId = randomBytes(16).toString('hex')
    const phone = this.sessions.createPhone(sessionId, deviceId, token)
    return phone
  }

  private setSessionCookie(res: ServerResponse, phone: PhoneSession): void {
    // HttpOnly + SameSite=Strict so the cookie is a proof-of-identity, not
    // something a cross-site <img>/<form> can forcibly attach (PROTOCOL §10).
    const expires = new Date(Date.now() + SESSION_TTL_MS).toUTCString()
    res.setHeader('Set-Cookie', [
      `${SESSION_COOKIE}=${phone.sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Expires=${expires}`,
    ])
  }

  private allowPairAttempt(key: string): boolean {
    const now = Date.now()
    const recent = (this.phoneRate.get(key) ?? []).filter((stamp) => now - stamp < PAIR_RATE_WINDOW_MS)
    if (recent.length >= PAIR_RATE_MAX) {
      this.phoneRate.set(key, recent)
      return false
    }
    recent.push(now)
    this.phoneRate.set(key, recent)
    return true
  }

  private heartbeat(): void {
    const now = Date.now()
    for (const [ws, ctx] of [...this.hosts]) {
      if (now - ctx.session.lastSeen > PING_TIMEOUT_MS) {
        this.log(`host timeout: ${ctx.session.deviceId.slice(0, 8)}…`)
        this.hosts.delete(ws)
        this.sessions.unregisterHost(ctx.session.deviceId)
        this.proxy.purgeHost(ctx.session)
        this.bridge.purgeDevice(ctx.session.deviceId)
        try { ws.close(4001, 'timeout') } catch { /* gone */ }
        continue
      }
      this.sendRaw(ws, { t: T.PING })
    }
    // Sliding window eviction for phone cookie sessions.
    for (const sessionId of this.sessions.evictExpiredPhones(now, SESSION_TTL_MS)) {
      this.log(`phone session expired: ${sessionId.slice(0, 8)}…`)
    }
  }

  private constantsTokenEquals(token: string): boolean {
    return constantTimeEquals(token, this.options.hostToken)
  }

  private sendRaw(ws: WebSocket, frame: unknown): void {
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      // socket already closed; close handler cleans up
    }
  }

  private html(res: ServerResponse, status: number, markup: string): void {
    const bytes = Buffer.from(markup)
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length })
    res.end(bytes)
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const bytes = Buffer.from(JSON.stringify(body))
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
    })
    res.end(bytes)
  }

  private plain(res: ServerResponse, status: number, message: string): void {
    const bytes = Buffer.from(message)
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': bytes.length })
    res.end(bytes)
  }

  private redirect(res: ServerResponse, to: string): void {
    res.writeHead(302, { Location: to })
    res.end()
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name && rest.length > 0) return rest.join('=').trim()
  }
  return null
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}