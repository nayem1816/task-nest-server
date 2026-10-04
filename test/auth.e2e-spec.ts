import request from 'supertest';
import { createTestApp, refreshCookie, type TestApp, uniqueEmail } from './helpers/test-app.js';

const PASSWORD = 'correct horse battery';
const CSRF = { 'x-tasknest-csrf': '1' };

describe('auth (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.resetRateLimits();
  });

  afterAll(async () => {
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  async function signup(label = 'user') {
    const email = uniqueEmail(label);
    const res = await http()
      .post('/api/v1/auth/signup')
      .send({ name: 'Jordan Ellis', email, password: PASSWORD })
      .expect(201);
    return {
      email,
      accessToken: res.body.accessToken as string,
      refresh: refreshCookie(res.headers['set-cookie']),
    };
  }

  const refreshWith = (cookie: string) =>
    http().post('/api/v1/auth/refresh').set(CSRF).set('Cookie', `tn_refresh=${cookie}`);

  describe('signup', () => {
    it('creates an unverified user, signs them in and emails a verification link', async () => {
      const email = uniqueEmail('signup');
      const res = await http()
        .post('/api/v1/auth/signup')
        .send({ name: '  Jordan Ellis ', email, password: PASSWORD })
        .expect(201);

      expect(res.body.user).toMatchObject({ email, name: 'Jordan Ellis', emailVerified: false });
      expect(res.body.expiresIn).toBe(900);
      const cookie = [res.headers['set-cookie']].flat().join(';');
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(t.outbox.lastToken(email, 'email_verification')).toBeTruthy();
    });

    it('rejects an email that differs only in case', async () => {
      const { email } = await signup('case');

      const res = await http()
        .post('/api/v1/auth/signup')
        .send({ name: 'Copy', email: email.toUpperCase(), password: PASSWORD })
        .expect(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('rejects a short password and unknown fields', async () => {
      const res = await http()
        .post('/api/v1/auth/signup')
        .send({ name: 'Short', email: uniqueEmail('short'), password: 'abc', role: 'owner' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('login', () => {
    it('gives the same answer for a wrong password and an unknown email', async () => {
      const { email } = await signup('login');

      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'not the password' })
        .expect(401);
      const unknown = await http()
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('nobody'), password: PASSWORD })
        .expect(401);

      expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('blocks disabled accounts after the password check', async () => {
      const { email } = await signup('disabled');
      await t.prisma.user.update({ where: { email }, data: { status: 'DISABLED' } });

      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    });

    it('rate limits repeated attempts against one account', async () => {
      const { email } = await signup('brute');
      const attempts = [];
      for (let i = 0; i < 11; i++) {
        attempts.push(
          await http()
            .post('/api/v1/auth/login')
            .send({ email, password: `guess-${i}-attempt` }),
        );
      }

      expect(attempts.slice(0, 10).every((r) => r.status === 401)).toBe(true);
      expect(attempts[10]?.status).toBe(429);
      expect(attempts[10]?.body.error.code).toBe('RATE_LIMITED');
      expect(attempts[10]?.body.error.message).toBe(
        'Too many attempts. Wait a few minutes and try again.',
      );
    });
  });

  describe('access tokens', () => {
    it('protects routes by default', async () => {
      const res = await http().get('/api/v1/auth/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');

      await http().get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('returns the signed-in user', async () => {
      const { email, accessToken } = await signup('me');

      const res = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.email).toBe(email);
    });
  });

  describe('refresh', () => {
    it('requires the CSRF header', async () => {
      const { refresh } = await signup('csrf');

      const res = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', `tn_refresh=${refresh}`)
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_CHECK_FAILED');
    });

    it('rotates the refresh token on every use', async () => {
      const { refresh } = await signup('rotate');

      const res = await refreshWith(refresh).expect(200);
      const next = refreshCookie(res.headers['set-cookie']);

      expect(next).not.toBe(refresh);
      expect(res.body.accessToken).toEqual(expect.any(String));
      await refreshWith(next).expect(200);
    });

    it('treats an immediate second use as a race between tabs', async () => {
      const { refresh } = await signup('race');
      await refreshWith(refresh).expect(200);

      const res = await refreshWith(refresh).expect(409);
      expect(res.body.error.code).toBe('REFRESH_IN_PROGRESS');
    });

    it('revokes the whole session when a used token comes back later', async () => {
      const { refresh, accessToken } = await signup('reuse');
      const next = refreshCookie((await refreshWith(refresh).expect(200)).headers['set-cookie']);
      // Push the first use outside the grace window.
      await t.prisma.refreshToken.updateMany({
        where: { usedAt: { not: null }, session: { user: { email: { contains: 'reuse.' } } } },
        data: { usedAt: new Date(Date.now() - 60_000) },
      });

      const replay = await refreshWith(refresh).expect(401);
      expect(replay.body.error.code).toBe('SESSION_REVOKED');

      // The legitimate holder of the newer token is signed out too, and the
      // access token stops working immediately rather than at expiry.
      await refreshWith(next).expect(401);
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect(me.body.error.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('logout and sessions', () => {
    it('ends the session for both tokens', async () => {
      const { refresh, accessToken } = await signup('logout');

      await http()
        .post('/api/v1/auth/logout')
        .set(CSRF)
        .set('Cookie', `tn_refresh=${refresh}`)
        .expect(204);

      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
      await refreshWith(refresh).expect(401);
    });

    it('lists sessions and signs out another device', async () => {
      const { email, accessToken } = await signup('devices');
      const other = await http()
        .post('/api/v1/auth/login')
        .set('User-Agent', 'Mozilla/5.0 (iPhone)')
        .send({ email, password: PASSWORD })
        .expect(200);

      const list = await http()
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(list.body).toHaveLength(2);
      const sessions = list.body as { id: string; current: boolean; userAgent: string }[];
      const phone = sessions.find((s) => !s.current);
      expect(phone?.userAgent).toContain('iPhone');

      await http()
        .delete(`/api/v1/auth/sessions/${phone?.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(401);
    });

    it("cannot revoke another user's session", async () => {
      const alice = await signup('alice');
      const bob = await signup('bob');
      const bobSessions = await http()
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${bob.accessToken}`);

      await http()
        .delete(`/api/v1/auth/sessions/${(bobSessions.body as { id: string }[])[0]?.id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(404);
    });
  });

  describe('client address behind the web proxy', () => {
    async function loginAndReadIp(headers: Record<string, string>) {
      const { email } = await signup('proxy');
      const login = await http()
        .post('/api/v1/auth/login')
        .set(headers)
        .send({ email, password: PASSWORD })
        .expect(200);
      const list = await http()
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      return (list.body as { ip: string; current: boolean }[]).find((s) => s.current)?.ip;
    }

    it('records the forwarded address when the proxy proves itself', async () => {
      const ip = await loginAndReadIp({
        'x-tasknest-proxy-secret': process.env.EDGE_PROXY_SECRET!,
        'x-tasknest-client-ip': '203.0.113.42',
      });
      expect(ip).toBe('203.0.113.42');
    });

    it('ignores a forwarded address sent without the secret', async () => {
      const ip = await loginAndReadIp({ 'x-tasknest-client-ip': '203.0.113.42' });
      expect(ip).not.toBe('203.0.113.42');
    });
  });

  describe('email verification', () => {
    it('verifies once with the emailed token', async () => {
      const { email, accessToken } = await signup('verify');
      const token = t.outbox.lastToken(email, 'email_verification');

      await http().post('/api/v1/auth/email/verify').send({ token }).expect(204);
      const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(me.body.emailVerified).toBe(true);

      const again = await http().post('/api/v1/auth/email/verify').send({ token }).expect(400);
      expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_LINK');
    });
  });

  describe('password reset', () => {
    it('does not reveal whether an email has an account', async () => {
      const before = t.outbox.sent.length;
      await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email: uniqueEmail('ghost') })
        .expect(202);
      expect(t.outbox.sent.length).toBe(before);
    });

    it('sets the new password and signs out every session', async () => {
      const { email, refresh, accessToken } = await signup('reset');
      await http().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
      const token = t.outbox.lastToken(email, 'password_reset');

      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'a brand new passphrase' })
        .expect(204);

      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
      await refreshWith(refresh).expect(401);
      await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'a brand new passphrase' })
        .expect(200);
    });

    it('invalidates an older reset link when a new one is requested', async () => {
      const { email } = await signup('relink');
      await http().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
      const first = t.outbox.lastToken(email, 'password_reset');
      await http().post('/api/v1/auth/password/forgot').send({ email }).expect(202);

      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: first, password: 'another new passphrase' })
        .expect(400);
    });
  });

  describe('password change', () => {
    it('keeps the current session and signs out the others', async () => {
      const { email, accessToken } = await signup('change');
      const other = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      await http()
        .post('/api/v1/auth/password/change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'wrong one', newPassword: 'changed passphrase' })
        .expect(400);
      await http()
        .post('/api/v1/auth/password/change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: 'changed passphrase' })
        .expect(204);

      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(401);
    });
  });
});
