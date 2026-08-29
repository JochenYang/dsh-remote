/**
 * dsh-remote HTTP surface (mounted on the dsh web server).
 *
 * Exposes the remote settings + live tunnel status to the browser settings
 * page through four read/action endpoints. No auth is added here: the web
 * server already binds loopback (the app shell pins 127.0.0.1), so the same
 * trust boundary as every other dsh plugin route applies.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { RelayAgent } from './agent.js'
import type { RemoteSettings } from './config.js'

interface RouteContext {
  agent: RelayAgent
  settings: RemoteSettings
  save: (next: RemoteSettings) => Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error as Error)
      }
    })
    req.on('error', reject)
  })
}

function register(
  server: WebServer,
  ctx: RouteContext,
  path: string,
  handler: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => Promise<void>,
): () => void {
  return server.register({
    kind: 'exact',
    path,
    handler: (req, res) => {
      void handler(req, res, ctx).catch((error: Error) => {
        sendJson(res, 500, { ok: false, error: error.message })
      })
    },
  })
}

export function registerRemoteRoutes(server: WebServer, ctx: RouteContext): () => void {
  const disposers = [
    register(server, ctx, '/_dsh/remote/status', async (_req, res, site) => {
      sendJson(res, 200, {
        ok: true,
        settings: site.settings,
        status: site.agent.getStatus(),
      })
    }),

    register(server, ctx, '/_dsh/remote/config', async (req, res, site) => {
      const body = (await readJsonBody(req)) as { value?: Partial<RemoteSettings> }
      const value = body.value ?? {}
      const next: RemoteSettings = {
        relayUrl: typeof value.relayUrl === 'string' ? value.relayUrl : site.settings.relayUrl,
        hostToken: typeof value.hostToken === 'string' ? value.hostToken : site.settings.hostToken,
        autoConnect: typeof value.autoConnect === 'boolean' ? value.autoConnect : site.settings.autoConnect,
      }
      if (next.relayUrl.trim() === '' && next.autoConnect) {
        sendJson(res, 400, { ok: false, error: 'relay URL 不能为空' })
        return
      }
      site.settings = next
      await site.save(next)
      site.agent.applySettings(next.relayUrl, next.hostToken, next.autoConnect)
      sendJson(res, 200, { ok: true, settings: next, status: site.agent.getStatus() })
    }),

    register(server, ctx, '/_dsh/remote/pair-refresh', async (_req, res, site) => {
      // Wait for the relay's `pair` reply so the response (and the status
      // refresh the settings page issues afterwards) carries the fresh code
      // instead of the expired one; the agent bounds the wait internally.
      const pair = await site.agent.refreshPair()
      sendJson(res, 200, { ok: pair !== null, status: site.agent.getStatus() })
    }),

    register(server, ctx, '/_dsh/remote/revoke', async (_req, res, site) => {
      site.agent.revoke()
      sendJson(res, 200, { ok: true, status: site.agent.getStatus() })
    }),
  ]

  return () => {
    for (const dispose of disposers) dispose()
  }
}