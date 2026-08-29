/**
 * In-memory session tables. The relay holds three families of state:
 *
 * - host sessions: one live WebSocket per registered deviceId (the desktop
 *   dsh-remote plugin). `pair` carries the currently-valid pairing code that
 *   this host minted via `pair-refresh`.
 * - phone browser sessions: one per current cookie session, keyed by
 *   `sessionId` and by deviceId (1 concurrent phone per device, PROTOCOL §10).
 *   The plaintext token lives here ONLY — the store persists its sha256.
 *
 * Everything in here dies with the process; durable state is the JSONL store.
 */
import type { WebSocket } from 'ws'

export interface HostPair {
  code: string
  expiresAt: number
}

export interface HostSession {
  deviceId: string
  ws: WebSocket
  hostName: string
  connectedAt: number
  /** Current valid pairing code, or null when none is minted. */
  pair: HostPair | null
  /** Latency keepalive bookkeeping (ms epoch of last inbound frame). */
  lastSeen: number
}

export interface PhoneSession {
  sessionId: string
  deviceId: string
  /** Plaintext token — memory only, refreshed when it is a fresh pairing. */
  token: string
  createdAt: number
  lastSeen: number
}

export class Sessions {
  /** deviceId → host session (single host per device). */
  readonly hosts = new Map<string, HostSession>()
  /** cookie sessionId → phone browser session. */
  readonly phonesByCookie = new Map<string, PhoneSession>()
  /** deviceId → live phone session (1 concurrent phone per device). */
  readonly phonesByDeviceId = new Map<string, PhoneSession>()

  /** Register (or replace) a host; the previous socket is returned when displaced. */
  registerHost(deviceId: string, ws: WebSocket, hostName: string): HostSession {
    const previous = this.hosts.get(deviceId)
    if (previous !== undefined && previous !== null && previous.ws !== ws) {
      // Displace the older socket safely (close outside the caller's walk).
      queueMicrotask(() => previous.ws.close(1012, 'host reconnected'))
    }
    const session: HostSession = {
      deviceId,
      ws,
      hostName,
      connectedAt: Date.now(),
      pair: null,
      lastSeen: Date.now(),
    }
    this.hosts.set(deviceId, session)
    return session
  }

  getHost(deviceId: string): HostSession | null {
    return this.hosts.get(deviceId) ?? null
  }

  unregisterHost(deviceId: string): HostSession | null {
    const current = this.hosts.get(deviceId)
    if (current !== undefined) this.hosts.delete(deviceId)
    return current ?? null
  }

  /** Create a phone cookie session; the previous device session is displaced. */
  createPhone(sessionId: string, deviceId: string, token: string, now = Date.now()): PhoneSession {
    const previous = this.phonesByDeviceId.get(deviceId)
    if (previous !== undefined && previous.sessionId !== sessionId) {
      this.phonesByCookie.delete(previous.sessionId)
    }
    const session: PhoneSession = { sessionId, deviceId, token, createdAt: now, lastSeen: now }
    this.phonesByCookie.set(sessionId, session)
    this.phonesByDeviceId.set(deviceId, session)
    return session
  }

  getPhoneByCookie(sessionId: string): PhoneSession | null {
    return this.phonesByCookie.get(sessionId) ?? null
  }

  touchPhone(session: PhoneSession, now = Date.now()): void {
    session.lastSeen = now
  }

  async disconnectPhone(sessionId: string): Promise<void> {
    const session = this.phonesByCookie.get(sessionId)
    if (session === undefined) return
    this.phonesByCookie.delete(sessionId)
    if (this.phonesByDeviceId.get(session.deviceId)?.sessionId === sessionId) {
      this.phonesByDeviceId.delete(session.deviceId)
    }
  }

  /** Drop every live phone of a device (used by `revoke`). */
  disposeDevicePhones(deviceId: string): void {
    for (const session of [...this.phonesByCookie.values()]) {
      if (session.deviceId !== deviceId) continue
      this.phonesByCookie.delete(session.sessionId)
    }
    this.phonesByDeviceId.delete(deviceId)
  }

  /** Number of live phone sessions currently bound to a device. */
  phoneCountFor(deviceId: string): number {
    let count = 0
    for (const session of this.phonesByCookie.values()) {
      if (session.deviceId === deviceId) count++
    }
    return count
  }

  /** Sweep phone sessions past their sliding TTL; returns the evicted ids. */
  evictExpiredPhones(now: number, ttlMs: number): string[] {
    const evicted: string[] = []
    for (const [id, session] of this.phonesByCookie) {
      if (now - session.lastSeen <= ttlMs) continue
      this.phonesByCookie.delete(id)
      if (this.phonesByDeviceId.get(session.deviceId)?.sessionId === id) {
        this.phonesByDeviceId.delete(session.deviceId)
      }
      evicted.push(id)
    }
    return evicted
  }
}