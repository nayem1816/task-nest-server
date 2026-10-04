import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { CookieOptions, Request } from 'express';
import { AuthErrors } from './auth.errors.js';

export const REFRESH_COOKIE = 'tn_refresh';

/** Sent only to auth routes; the rest of the API never sees the refresh token. */
const COOKIE_PATH = '/api/v1/auth';

export function refreshCookieOptions(secure: boolean, expires?: Date): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: COOKIE_PATH, expires };
}

export function readRefreshCookie(req: Request): string | null {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const CSRF_HEADER = 'x-tasknest-csrf';

/**
 * Routes authenticated by the refresh cookie require a custom header. A
 * cross-site form or image cannot set one, and a cross-site fetch that tries
 * is stopped by the CORS preflight, so the cookie alone is never enough.
 */
@Injectable()
export class CsrfHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.headers[CSRF_HEADER]) throw AuthErrors.csrfHeaderMissing();
    return true;
  }
}
