/**
 * Device identity: a stable 32-hex deviceId persisted under the plugin's
 * storage dir. The relay registers hosts by this id; losing it would strand
 * every paired phone, so we only ever write after a successful read.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const IDENTITY_FILE = 'identity.json'

export interface Identity {
  deviceId: string
}

/** Load the persisted identity, or create and persist a fresh one. */
export async function loadIdentity(dir: string): Promise<Identity> {
  const file = join(dir, IDENTITY_FILE)
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Identity>
    if (typeof parsed.deviceId === 'string' && /^[0-9a-f]{32}$/.test(parsed.deviceId)) {
      return { deviceId: parsed.deviceId }
    }
    // Fall through: corrupt file — generate a new identity below.
  } catch {
    // Not present yet (or unreadable): generate below.
  }

  const identity: Identity = { deviceId: randomBytes(16).toString('hex') }
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${JSON.stringify(identity, null, 2)}\n`, 'utf8')
  return identity
}