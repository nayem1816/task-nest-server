import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../../config/env.js';

export interface VisitorClaims {
  visitorId: string;
  channelId: string;
  organizationId: string;
}

const ISSUER = 'tasknest-api';
// A different audience from member access tokens, so neither kind of token is
// accepted where the other is expected, even though they share a signing key.
const AUDIENCE = 'tasknest-widget';
const TTL = '30d';

/**
 * Identifies an anonymous website visitor across page loads. It grants access
 * to that visitor's own chat on one channel and nothing else.
 */
@Injectable()
export class VisitorTokenService {
  private readonly key: Uint8Array;

  constructor(config: ConfigService<Env, true>) {
    this.key = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET', { infer: true }));
  }

  sign(claims: VisitorClaims): Promise<string> {
    return new SignJWT({ chn: claims.channelId, org: claims.organizationId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.visitorId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(TTL)
      .sign(this.key);
  }

  async verify(token: string): Promise<VisitorClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const { sub, chn, org } = payload;
      if (typeof sub !== 'string' || typeof chn !== 'string' || typeof org !== 'string') {
        return null;
      }
      return { visitorId: sub, channelId: chn, organizationId: org };
    } catch {
      return null;
    }
  }
}
