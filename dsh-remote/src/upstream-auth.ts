/**
 * Upstream browser-session authentication for the tunnel (dsh BrowserAuth bridge).
 *
 * Modern dsh (`client-connection`) guards the web app behind an authority-bound
 * browser cookie: the index goes through `authorizeIndex`, and every `/api` RPC
 * plus the `/api/remote.mux` event WebSocket pass `requestRejection`, which
 * answers 401 for a trusted-but-unauthenticated request. The host plugin proxies
 * the phone as a plain loopback client, so its requests carry no cookie and the
 * upstream answers 401 — the phone's whole session is dead on arrival.
 *
 * This mints, caches, and refreshes the cookie for the loopback authority
 * (`127.0.0.1:<port>`) from the process launch token, in-process, so the token
 * never leaves the desktop. When the running dsh has no browser-auth service
 * (older harness builds) every accessor returns `undefined` and proxied traffic
 * stays a pass-through — unchanged behavior.
 */

/** Structural view of the Connection browser-auth surface the host plugin needs. */
export interface BrowserConnectionAuthorizer {
  /** Add the process launch token to an ordinary Web origin. */
  authenticatedUrl?(baseUrl: string): string
  /** Authenticate a frontend index request; a token exchange writes the cookie. */
  authorizeIndex?(
    request: {
      method?: string | undefined
      url?: string | undefined
      headers: Readonly<Record<string, string | readonly string[] | undefined>> | Headers
    },
    response: {
      writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
      end(body?: string): unknown
    },
  ): boolean
}

export interface UpstreamCookieAuth {
  /** The current upstream browser cookie, or undefined when none applies. */
  cookie(): string | undefined
  /** Re-mint the cookie (used after an upstream 401). */
  refresh(): void
}

/**
 * Create the upstream cookie owner for a loopback origin.
 * @param origin - resolves the local dsh web origin, e.g. `http://127.0.0.1:5173`.
 * @param connection - resolves the Connection service, absent on older harnesses.
 * @returns the cookie accessor/refresher (a no-op pass-through when unauthenticated).
 */
export function createUpstreamCookieAuth(
  origin: () => string,
  connection: () => BrowserConnectionAuthorizer | undefined,
): UpstreamCookieAuth {
  let cached: string | undefined

  const mint = (): string | undefined => {
    try {
      const auth = connection()
      if (auth === undefined) return undefined
      const tokenUrl = auth.authenticatedUrl?.(origin())
      if (typeof tokenUrl !== 'string') return undefined

      let url: URL
      try {
        url = new URL(tokenUrl)
      } catch {
        return undefined
      }

      let cookie: string | undefined
      // Call as a method (receiver-bound): a cordis-traced service method loses
      // `this` (and its `browserAuth`/`launchToken` reads) when detached —
      // the detach itself was the original 502 failure.
      auth.authorizeIndex?.(
        { method: 'GET', url: url.pathname + url.search, headers: { host: url.host } },
        {
          writeHead(_status, headers) {
            const value = headers?.['set-cookie']
            // Keep only the `name=value` pair: Set-Cookie attributes (Path,
            // HttpOnly, SameSite, ...) are not valid Cookie-header parts.
            if (typeof value === 'string' && value !== '') {
              const pair = value.split(';', 1)[0].trim()
              if (pair !== '') cookie = pair
            }
          },
          end() {
            // token exchange handled by writeHead; nothing to drain
          },
        },
      )
      return cookie
    } catch {
      // Mint failure degrades to pass-through (upstream answers 401 itself);
      // never let the proxy die with an http-err just because auth is absent.
      return undefined
    }
  }

  return {
    cookie(): string | undefined {
      // Retry until minted: the Connection service may race the first proxied
      // request during plugin activation.
      if (cached === undefined) cached = mint()
      return cached
    },
    refresh(): void {
      cached = mint()
    },
  }
}
