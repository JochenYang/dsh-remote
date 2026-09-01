/**
 * dsh-remote — 手机远程连接插件（主机端）。
 *
 * 自托管中继的桌面端 agent（契约见 ../docs/PROTOCOL.md）：持有稳定的
 * deviceId 注册到 relay，把手机浏览器经由 relay 转发的 HTTP 反向代理帧与
 * WebSocket 透传帧桥接到本地 dsh web server（127.0.0.1:<webServer.port>），
 * 使手机端像桌面端一样操作（dsh 前端以 location.origin 为 API base，零改写）。
 *
 * 运行时配置（设置 → 手机连接）持久化于
 * `<dshHome>/storages/dsh-remote/config.json`，覆盖 cordis.patch.yml 默认值。
 */

import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { RelayAgent, type Frame } from './agent.js'
import { RemoteSettingsSchema, loadSettings, saveSettings, type RemoteSettings } from './config.js'
import { T } from './frames.js'
import { HttpPlane } from './http-plane.js'
import { loadIdentity } from './identity.js'
import { registerRemoteRoutes } from './routes.js'
import { createUpstreamCookieAuth, type BrowserConnectionAuthorizer } from './upstream-auth.js'
import { WsPlane } from './ws-plane.js'

/** Cordis plugin name. */
export const name = 'dsh-remote'

/** Schemastery configuration (defaults, mirror of cordis.patch.yml). */
export const Config = RemoteSettingsSchema

/** Services the fiber waits for before apply. */
export const inject = ['webServer']

/**
 * Assemble the host agent: identity + settings from disk, the relay client,
 * the two data planes, and the settings/status routes.
 */
export async function apply(ctx: Context, config: RemoteSettings): Promise<void> {
  const log = ctx.logger(name)
  const dir = join(resolveDshHome(), 'storages', 'dsh-remote')

  const identity = await loadIdentity(dir)
  const settings = await loadSettings(dir, {
    relayUrl: config.relayUrl,
    hostToken: config.hostToken,
    autoConnect: config.autoConnect,
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const origin = (): string => `http://127.0.0.1:${webCtx.webServer.port}`
      const logWarn = (message: string): void => log.warn(message)

      // Modern dsh guards its web API behind an authority-bound browser cookie
      // (see src/upstream-auth.ts). Bridge it so the phone's tunneled requests
      // authenticate as the loopback client they actually are; on older harness
      // builds the auth owner is a pass-through and nothing changes.
      const auth = createUpstreamCookieAuth(origin, () => {
        // `ctx.get` returns a cordis tracing proxy whose wrapped service methods
        // lose `this` (they read `this.browserAuth` against the proxy and get
        // undefined). The proxy's `cordis.original` symbol yields the raw
        // service; its `browserAuth` instance owns the launch token + secret.
        const service = webCtx.get('connection')
        if (service === undefined || service === null) return undefined
        const raw = service[Symbol.for('cordis.original')] ?? service
        return (raw as { browserAuth?: BrowserConnectionAuthorizer }).browserAuth
      })

      const agent = new RelayAgent({
        deviceId: identity.deviceId,
        relayUrl: settings.relayUrl,
        hostToken: settings.hostToken,
        hostName: hostname(),
        log: (message) => log.info(message),
      })

      const httpPlane = new HttpPlane({ origin, log: logWarn, send: (frame) => agent.sendFrame(frame), auth })
      const wsPlane = new WsPlane({ origin, log: logWarn, send: (frame) => agent.sendFrame(frame), auth })

      // Route data-plane frames to the matching plane (control plane lives in
      // the agent; unknown types are ignored there and surface here).
      agent.setFrameSink((frame: Frame) => {
        switch (frame.t) {
          case T.HTTP_REQ:
          case T.HTTP_BODY:
          case T.HTTP_BODY_END:
          case T.HTTP_ABORT:
            httpPlane.handle(frame)
            break
          case T.WS_OPEN:
          case T.WS_FRAME:
          case T.WS_CLOSE:
            wsPlane.handle(frame)
            break
          default:
            log.warn(`unhandled relay frame: ${String(frame.t)}`)
        }
      })

      const disposeRoutes = registerRemoteRoutes(webCtx.webServer, {
        agent,
        settings,
        save: (next) => saveSettings(dir, next),
      })

      if (settings.autoConnect && settings.relayUrl.trim() !== '') agent.start()

      return () => {
        disposeRoutes()
        agent.dispose()
      }
    }, 'dsh-remote: host agent')
  })
}