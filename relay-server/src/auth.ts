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
}