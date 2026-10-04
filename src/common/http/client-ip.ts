import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

export const CLIENT_IP_HEADER = 'x-tasknest-client-ip';
export const PROXY_SECRET_HEADER = 'x-tasknest-proxy-secret';

/**
 * The web app reaches the API through its own server (Next rewrites), so the
 * socket address is the web server, not the person. The web server passes the
 * real address in a header, and proves it is the web server with a shared
 * secret. Without the secret the header is ignored, so a client calling the API
 * directly cannot pick its own IP for rate limiting or session records.
 */
export function resolveClientIp(req: Request, proxySecret: string | undefined): string | undefined {
  if (!proxySecret) return req.ip;

  const presented = req.headers[PROXY_SECRET_HEADER];
  if (typeof presented !== 'string' || !sameSecret(presented, proxySecret)) return req.ip;

  const forwarded = req.headers[CLIENT_IP_HEADER];
  const ip = typeof forwarded === 'string' ? forwarded.trim() : '';
  return isIP(ip) ? ip : req.ip;
}

export function clientIpMiddleware(proxySecret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.clientIp = resolveClientIp(req, proxySecret);
    next();
  };
}

// Hash both sides first so the comparison is constant-time regardless of length.
function sameSecret(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
