import { createHash, randomBytes } from 'node:crypto';

/** 256 bits of randomness, URL-safe so it can go straight into a link or cookie. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Opaque tokens are looked up by hash, so a database leak does not hand out
 * working tokens. SHA-256 is enough here: the input is random, not a password,
 * so there is nothing to brute-force.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
