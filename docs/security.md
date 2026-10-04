# Security

## Authentication

### Tokens

| Token         | Format                     | Lifetime                  | Where it lives                                                           |
| ------------- | -------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Access token  | JWT (HS256), `sub` + `sid` | 15 minutes (configurable) | Client memory only. Sent as `Authorization: Bearer`                      |
| Refresh token | 256-bit random, opaque     | Until the session expires | `tn_refresh` cookie: httpOnly, SameSite=Lax, Secure, `Path=/api/v1/auth` |

The refresh cookie is scoped to the auth routes, so no other endpoint ever
receives it. The database stores only the SHA-256 of each refresh token; a leaked
`RefreshToken` table cannot be replayed.

### Sessions

A `Session` is one signed-in browser or device. It has an absolute expiry (30
days by default) that refreshing does not extend, so a stolen session cannot be
kept alive forever.

Access tokens are stateless, which normally means a logout only takes effect
when the token expires. To close that gap, revoking a session also writes
`tasknest:revoked-session:<id>` to Redis for the lifetime of an access token. The
global guard checks that key on every request: one `EXISTS` call, no database
read.

### Refresh token rotation and reuse detection

Every refresh consumes the presented token and issues a new one. The consume
step is a conditional `UPDATE ... WHERE usedAt IS NULL`, so of two concurrent
requests exactly one wins.

If a token that was already used is presented again:

- **Within 10 seconds**: almost always two tabs refreshing at once. The request
  gets `409 REFRESH_IN_PROGRESS` and the client retries with the cookie the other
  tab received.
- **Later**: the token was copied. The whole session is revoked, which signs out
  both the attacker and the legitimate user, and the event is logged.

### Passwords

- Hashed with argon2id (19 MiB memory, 2 iterations), the OWASP baseline.
- 10 to 128 characters. No composition rules; length matters more.
- Login runs a hash verification even for unknown emails, so timing does not
  reveal which emails have accounts. Unknown email and wrong password return the
  same error.
- Password reset and forgot-password responses do not reveal whether an account
  exists.
- A password reset signs out every session. A password change signs out every
  session except the current one.

### Email links

Verification and reset links carry single-use tokens, stored hashed. Requesting
a new one deletes any earlier unused token for the same purpose. Lifetimes: 48
hours for verification, 1 hour for reset.

## CSRF

The API authenticates with bearer tokens, which browsers never attach on their
own, so ordinary endpoints are not exposed to CSRF.

The two endpoints that read the refresh cookie (`/auth/refresh`, `/auth/logout`)
also require an `x-tasknest-csrf` header. A cross-site form cannot set custom
headers, and a cross-site `fetch` that tries triggers a CORS preflight, which the
API rejects for unknown origins.

## Rate limiting

Counters live in Redis, so limits hold across API replicas. The increment and
block check run in one Lua script.

| Route                     | Limit                          |
| ------------------------- | ------------------------------ |
| Everything                | 300 / minute per IP            |
| `POST /auth/login`        | 10 / 15 minutes per IP + email |
| `POST /auth/signup`       | 5 / 10 minutes per IP + email  |
| `POST /auth/password/*`   | 5 to 10 / 15 minutes           |
| Resend verification email | 3 / 15 minutes                 |

Keying sensitive routes on IP + email means an office behind one NAT does not
lock each other out, while a single account still cannot be brute-forced from
one address. Behind a proxy, set `TRUST_PROXY_HOPS` so `req.ip` is the client.

## Logging

Authorization headers, cookies, and any field named like a password, token or
secret are redacted by the logger before output. Email recipients are logged by
domain only.

## HTTP hardening

`helmet` defaults (HSTS, `nosniff`, same-origin framing and so on), strict CORS with an
explicit origin list, `X-Powered-By` removed, and request bodies validated with a
whitelist: unknown fields are rejected, not ignored.
