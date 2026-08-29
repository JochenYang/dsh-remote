/**
 * dsh-remote client config source: an HTTP-backed reactive store over
 * /_dsh/remote/status (+ config writes). Mirrors the dsh-pet config-source
 * pattern so the settings page stays identical to the host's snapshot.
 */

const STATUS_ROUTE = '/_dsh/remote/status'
const CONFIG_ROUTE = '/_dsh/remote/config'
const PAIR_REFRESH_ROUTE = '/_dsh/remote/pair-refresh'
const REVOKE_ROUTE = '/_dsh/remote/revoke'

export interface RemoteSettingsClient {
  relayUrl: string
  hostToken: string
  autoConnect: boolean
}

export interface RemoteStatusClient {
  state: 'idle' | 'connecting' | 'online' | 'error'
  deviceId: string
  relayUrl: string
  hostName: string
  pair: { code: string; expiresAt: number } | null
  peer: { online: boolean; ua?: string } | null
  lastError: string | null
  connectedAt: number | null
  retryInMs: number | null
}

export interface RemoteSnapshot {
  status: 'loading' | 'ready' | 'error'
  settings: RemoteSettingsClient | undefined
  remote: RemoteStatusClient | undefined
}

export interface RemoteConfigSource {
  getSnapshot(): RemoteSnapshot
  subscribe(fn: () => void): () => void
  /** Persist one scalar field (or the whole config) and reconcile. */
  set(field: string, value: unknown): Promise<void>
  refreshPair(): Promise<boolean>
  revoke(): Promise<boolean>
  refresh(): Promise<boolean>
}

function defaultSettings(): RemoteSettingsClient {
  return { relayUrl: '', hostToken: '', autoConnect: true }
}

export function createRemoteConfigSource(): RemoteConfigSource {
  let snapshot: RemoteSnapshot = { status: 'loading', settings: undefined, remote: undefined }
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const fn of [...listeners]) {
      try { fn() } catch { /* contain subscriber failures */ }
    }
  }
  const publish = (next: RemoteSnapshot): void => {
    if (next !== snapshot) {
      snapshot = next
      emit()
    }
  }

  function fail(): boolean {
    publish({ status: 'error', settings: undefined, remote: undefined })
    return false
  }

  async function refresh(): Promise<boolean> {
    try {
      const response = await fetch(STATUS_ROUTE, { credentials: 'same-origin' })
      const body = await response.json() as {
        ok?: boolean
        settings?: RemoteSettingsClient
        status?: RemoteStatusClient
      }
      if (response.ok && body.ok === true) {
        publish({
          status: 'ready',
          settings: body.settings ?? defaultSettings(),
          remote: body.status ?? undefined,
        })
        return true
      }
      return fail()
    } catch {
      return fail()
    }
  }

  async function write(next: RemoteSettingsClient): Promise<void> {
    // Optimistic publish, then reconcile with the host response.
    publish({ status: 'ready', settings: next, remote: snapshot.remote })
    try {
      const response = await fetch(CONFIG_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next }),
      })
      const body = await response.json() as {
        ok?: boolean
        settings?: RemoteSettingsClient
        status?: RemoteStatusClient
      }
      if (response.ok && body.ok === true) {
        publish({
          status: 'ready',
          settings: body.settings ?? next,
          remote: body.status ?? snapshot.remote,
        })
      } else {
        void refresh()
      }
    } catch {
      // Network failure: keep the optimistic value; a later refresh reconciles.
    }
  }

  async function postAction(route: string): Promise<boolean> {
    try {
      const response = await fetch(route, { method: 'POST', credentials: 'same-origin' })
      if (!response.ok) return false
      // An action can fail politely (ok:false on 200) — e.g. pair-refresh
      // timing out without a relay reply; surface that as a failure.
      const body = await response.json() as { ok?: boolean }
      if (body.ok === false) return false
      return await refresh()
    } catch {
      return false
    }
  }

  void refresh()

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    async set(field, value) {
      const base = { ...(snapshot.settings ?? defaultSettings()) }
      base[field as keyof RemoteSettingsClient] = value as never
      await write(base)
    },
    refreshPair: () => postAction(PAIR_REFRESH_ROUTE),
    revoke: () => postAction(REVOKE_ROUTE),
    refresh: () => refresh(),
  }
}