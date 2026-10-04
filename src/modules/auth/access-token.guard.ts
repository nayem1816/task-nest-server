import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessTokenService } from './access-token.service.js';
import { IS_PUBLIC } from './auth.decorators.js';
import { AuthErrors } from './auth.errors.js';
import { SessionService } from './session.service.js';

/**
 * Registered globally: every route requires a valid access token unless it is
 * marked @Public(). Secure by default means a forgotten decorator fails closed.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) throw AuthErrors.unauthenticated();

    const claims = await this.accessTokens.verify(token);
    if (!claims) throw AuthErrors.unauthenticated();
    if (await this.sessions.isAccessRevoked(claims.sessionId)) throw AuthErrors.sessionExpired();

    req.auth = claims;
    return true;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
