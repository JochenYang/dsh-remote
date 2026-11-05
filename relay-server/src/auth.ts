/**
 * Auth primitives: SHA-256, HMAC-SHA256, one-shot challenges, and the
 * 6-digit pairing code factory. Challenge-verification uses the HMAC
 * expected value computed at issue time (the raw pairing code never lives on
 * disk — only `sha256(code)` is persisted, see PROTOCOL §9/§10).
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { CHALLENGE_TTL_MS } from './const.ts'

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Hex HMAC-SHA256 tags are compared constant-time, never with `===`. */
export function hmacSha256Hex(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex')
}

function hexEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Generate a fresh 6-digit numeric pairing code. */
export function makePairCode(): string {
  return String(randomInt(1_000_000)).padStart(6, '0')
}

export interface IssuedChallenge {
  /** random 32-byte hex, sent to the phone. */
  challenge: string
  /** echoed TTL so the phone page can display it. */
  ttlMs: number
}

interface StoredChallenge {
  deviceId: string
  /** Hex HMAC-SHA256(SHA256(code), challenge); constant-time compared. */
  expected: string
  /** SHA-256 of the token tied to this pairing, burned on successful verify. */
  tokenSha: string
  expiresAt: number
}

/**
 * One-shot challenge store. A challenge can be consumed exactly once, which
 * together with the 60s TTL makes replay impossible (PROTOCOL §4, §10).
 */
export class ChallengeStore {
  private readonly challenges = new Map<string, StoredChallenge>()

  issue(deviceId: string, code: string, token: string): IssuedChallenge {
    const challenge = randomBytes(32).toString('hex')
    const key = Buffer.from(sha256Hex(code), 'hex')
    this.challenges.set(challenge, {
      deviceId,
      expected: hmacSha256Hex(key, challenge),
      tokenSha: sha256Hex(token),
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    })
    return { challenge, ttlMs: CHALLENGE_TTL_MS }
  }

  /**
   * Verify and burn a challenge. Returns the token SHA on success, null on
   * any mismatch (unknown / expired / already consumed / wrong device).
   */
  consume(challenge: string, deviceId: string, response: string): string | null {
    const entry = this.challenges.get(challenge)
    if (entry === undefined) return null
    this.challenges.delete(challenge)
    if (entry.deviceId !== deviceId) return null
    if (entry.expiresAt < Date.now()) return null
    if (!hexEquals(entry.expected, response)) return null
    return entry.tokenSha
  }

  /**
   * Drop expired challenges. `consume` only removes the entry it is asked
   * about, so an abandoned or forged challenge would otherwise stay in memory
   * for the process lifetime — the heartbeat sweeps instead.
   */
  sweep(now = Date.now()): number {
    let dropped = 0
    for (const [challenge, entry] of this.challenges) {
      if (entry.expiresAt > now) continue
      this.challenges.delete(challenge)
      dropped += 1
    }
    return dropped
  }
}

interface AttemptRow {
  /** Attempt stamps inside the current window, oldest first. */
  stamps: number[]
  /** Consecutive failures since the last success. */
  failures: number
  /** Epoch ms before which the key is refused outright. */
  blockedUntil: number
}

/**
 * Per-key attempt limiter: a sliding window plus a consecutive-failure lockout.
 *
 * The window alone bounds the *rate* of attempts but not their number over
 * time, and `POST /pair` guards a 6-digit secret with a 10-minute TTL — a
 * slow, repeated guesser has to be locked out, not merely slowed. Keys are
 * caller-chosen (the real client address here, see `clientAddress`); the
 * heartbeat sweeps idle rows so a scattered attack cannot grow the table.
 */
export class AttemptLimiter {
  private readonly rows = new Map<string, AttemptRow>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly lockoutMax: number,
    private readonly lockoutMs: number,
  ) {}

  /** Reserve one attempt for `key`; false when the window or lockout refuses it. */
  tryAttempt(key: string, now = Date.now()): boolean {
    const row = this.row(key, now)
    if (row.blockedUntil > now) return false
    if (row.stamps.length >= this.max) return false
    row.stamps.push(now)
    return true
  }

  /** Count a failed attempt; the `lockoutMax`-th consecutive failure locks the key. */
  noteFailure(key: string, now = Date.now()): void {
    const row = this.row(key, now)
    row.failures += 1
    if (row.failures < this.lockoutMax) return
    row.failures = 0
    row.stamps = []
    row.blockedUntil = now + this.lockoutMs
  }

  /** Clear the failure streak after a valid attempt. */
  noteSuccess(key: string): void {
    const row = this.rows.get(key)
    if (row !== undefined) row.failures = 0
  }

  /** Drop rows that are neither locked nor inside their window. */
  sweep(now = Date.now()): number {
    let dropped = 0
    for (const [key, row] of this.rows) {
      if (row.blockedUntil > now) continue
      const last = row.stamps[row.stamps.length - 1]
      if (last !== undefined && now - last <= this.windowMs) continue
      this.rows.delete(key)
      dropped += 1
    }
    return dropped
  }

  private row(key: string, now: number): AttemptRow {
    const existing = this.rows.get(key)
    if (existing === undefined) {
      const fresh: AttemptRow = { stamps: [], failures: 0, blockedUntil: 0 }
      this.rows.set(key, fresh)
      return fresh
    }
    const cutoff = now - this.windowMs
    if (existing.stamps.length > 0 && existing.stamps[0] <= cutoff) {
      existing.stamps = existing.stamps.filter((stamp) => stamp > cutoff)
    }
    return existing
  }
}