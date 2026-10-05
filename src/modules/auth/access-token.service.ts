import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../../config/env.js';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  /** Epoch milliseconds; long-lived connections close when it passes. */
  expiresAt: number;
}

const ISSUER = 'tasknest-api';
const AUDIENCE = 'tasknest-web';

@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;
  readonly ttlSeconds: number;

  constructor(config: ConfigService<Env, true>) {
    this.key = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET', { infer: true }));
    this.ttlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  sign({ userId, sessionId }: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  /** Returns null for anything that is not a valid, unexpired token we issued. */
  async verify(token: string): Promise<VerifiedAccessToken | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || !payload.exp) {
        return null;
      }
      return { userId: payload.sub, sessionId: payload.sid, expiresAt: payload.exp * 1000 };
    } catch {
      return null;
    }
  }
}
