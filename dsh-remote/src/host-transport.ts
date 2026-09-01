/**
 * Host transport ownership shim (tunnel-only). The dsh web client computes
 * `connection.isLoopback` from `window.__DSH_TRANSPORT__?.ownsHost` first and
 * the page hostname only when that flag is absent. A phone behind the relay
 * sees a LAN/relay hostname, so every surface gated on `isLoopback` — the
 * settings describe mirror (`persistence: "memory"` is permanently
 * unavailable), the general-settings document store, the api-gateway
 * connection flag, produced-file open — stays disabled even though tunneled
 * /api traffic passes the Host fence and `settings.describe` answers
 * redacted over the wire.
 *
 * The relay page IS served by the dsh host through the tunnel, so declaring
 * host ownership states the fact rather than spoofing a boundary: `ownsHost:
 * true` flips `isLoopback` on while leaving the transport's other optional
 * capabilities (fetch/openStream/loadBundle) untouched when a host provides
 * them. The http plane injects this into every text/html response it
 * proxies, so tunnel sessions get a fully local page; desktop/GUI traffic —
 * which never crosses the plane — is untouched.
 */

const TRANSPORT_MARKER = 'data-dsh-remote="transport"'

/** Declare host ownership before the app module (deferred) runs; a plain
 * `{}` target keeps any host-provided transport capabilities intact. */
const TRANSPORT_SCRIPT =
  `<script ${TRANSPORT_MARKER}>window.__DSH_TRANSPORT__=Object.assign({},window.__DSH_TRANSPORT__,{ownsHost:true})</script>`

/**
 * Inject the transport ownership declaration into one proxied HTML document.
 * Idempotent (skips documents that already carry the marker).
 *
 * The script lands at the very top of `<head>` (or the document when there is
 * no head) so it always runs before any app script — the SPA entry is a
 * deferred `type="module"` bundle, but a plain synchronous script at head-top
 * is guaranteed to have run by the time the bundle executes.
 */
export function injectHostTransport(html: string): string {
  if (html.includes(TRANSPORT_MARKER)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${TRANSPORT_SCRIPT}`)
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${TRANSPORT_SCRIPT}`)
  }
  return TRANSPORT_SCRIPT + html
}
