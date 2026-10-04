import type { Request } from 'express';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, resolveClientIp } from './client-ip.js';

const SECRET = 's'.repeat(40);

function req(headers: Record<string, string>, ip = '10.0.0.5'): Request {
  return { ip, headers } as unknown as Request;
}

describe('resolveClientIp', () => {
  it('uses the forwarded address when the proxy secret matches', () => {
    const ip = resolveClientIp(
      req({ [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: '203.0.113.7' }),
      SECRET,
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('ignores the forwarded address without the right secret', () => {
    expect(resolveClientIp(req({ [CLIENT_IP_HEADER]: '203.0.113.7' }), SECRET)).toBe('10.0.0.5');
    expect(
      resolveClientIp(
        req({ [PROXY_SECRET_HEADER]: 'guess', [CLIENT_IP_HEADER]: '203.0.113.7' }),
        SECRET,
      ),
    ).toBe('10.0.0.5');
  });

  it('ignores the header entirely when no secret is configured', () => {
    expect(
      resolveClientIp(
        req({ [PROXY_SECRET_HEADER]: '', [CLIENT_IP_HEADER]: '203.0.113.7' }),
        undefined,
      ),
    ).toBe('10.0.0.5');
  });

  it('falls back when the forwarded value is not an IP address', () => {
    const ip = resolveClientIp(
      req({ [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: '203.0.113.7, 10.1.1.1' }),
      SECRET,
    );
    expect(ip).toBe('10.0.0.5');
  });

  it('accepts IPv6', () => {
    const ip = resolveClientIp(
      req({ [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: '2001:db8::1' }),
      SECRET,
    );
    expect(ip).toBe('2001:db8::1');
  });
});
