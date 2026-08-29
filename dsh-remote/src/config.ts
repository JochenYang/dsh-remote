/**
 * Runtime settings for dsh-remote.
 *
 * The cordis patch provides defaults (relayUrl/hostToken/autoConnect); the
 * settings page writes through to `<storageDir>/config.json`, which overrides
 * the defaults per PROTOCOL-independent runtime-config rules. Writing is
 * atomic (tmp + rename) so a crash never truncates the file.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

export interface RemoteSettings {
  /** Relay base URL, e.g. `https://relay.example.com` (http(s)/ws(s) accepted). */
  relayUrl: string
  /** Shared host token the relay was deployed with. */
  hostToken: string
  /** Connect to the relay when (re-)configuring / on boot. */
  autoConnect: boolean
}

/** Schemastery schema mirrored by `cordis.patch.yml`. */
export const RemoteSettingsSchema: z<RemoteSettings> = z.object({
  relayUrl: z.string().default(''),
  hostToken: z.string().default(''),
  autoConnect: z.boolean().default(true),
})

const CONFIG_FILE = 'config.json'

/** Coerce a user-supplied relay URL into a ws(s) WebSocket URL. */
export function toWsUrl(relayUrl: string): string {
  const trimmed = relayUrl.trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  if (/^wss?:\/\//i.test(trimmed)) return trimmed
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https/i, 'wss')
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http/i, 'ws')
  // Bare host:port — assume http → ws.
  return `ws://${trimmed}`
}

/** Load persisted settings; falls back to the patch-provided defaults. */
export async function loadSettings(dir: string, defaults: RemoteSettings): Promise<RemoteSettings> {
  try {
    const raw = await readFile(join(dir, CONFIG_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RemoteSettings>
    return {
      relayUrl: typeof parsed.relayUrl === 'string' ? parsed.relayUrl : defaults.relayUrl,
      hostToken: typeof parsed.hostToken === 'string' ? parsed.hostToken : defaults.hostToken,
      autoConnect: typeof parsed.autoConnect === 'boolean' ? parsed.autoConnect : defaults.autoConnect,
    }
  } catch {
    return defaults
  }
}

/** Persist settings atomically. */
export async function saveSettings(dir: string, settings: RemoteSettings): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, CONFIG_FILE)
  const tmp = `${target}.tmp`
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await rename(tmp, target)
}