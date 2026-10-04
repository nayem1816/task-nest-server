# Architecture

TaskNest is split into two deployables, each in its own repository:

| Repository         | What it is                                                                       | Runs on (planned) |
| ------------------ | -------------------------------------------------------------------------------- | ----------------- |
| `task-nest-server` | NestJS API, WebSocket gateway and BullMQ workers. Owns the database.             | Railway or a VPS  |
| `task-nest-client` | Next.js app: marketing site, authenticated workspace, and the embeddable widget. | Vercel            |

```
             ┌──────────────────────┐
 Browser ───▶│ Next.js (client)     │
             └──────────┬───────────┘
                        │ REST /api/v1 + WebSocket
             ┌──────────▼───────────┐       ┌────────────────┐
 Widget ────▶│ NestJS API           │──────▶│ AI providers   │
             │ (modular monolith)   │       └────────────────┘
             └───┬──────────┬───────┘
                 │          │ enqueue
        ┌────────▼───┐  ┌───▼────────┐     ┌─────────────────┐
        │ PostgreSQL │  │ Redis      │◀────│ BullMQ worker   │
        │ + pgvector │  │ queues/pub │     │ (same codebase) │
        └────────────┘  └────────────┘     └─────────────────┘
```

The API and the workers are built from the same codebase. They differ only in
which Nest modules are bootstrapped, so a worker can be scaled independently
without a second repository.

## Source layout

```
src/
  config/           environment schema, validated at boot
  common/           cross-cutting HTTP concerns: error envelope, request ids
  infrastructure/   adapters to things outside the process (Postgres, Redis, logging)
  modules/          business domains, one folder each
  generated/        Prisma client (git-ignored, produced by `prisma generate`)
```

Rules that keep the monolith modular:

- A domain module exposes a service through its module's `exports`. Other modules
  never import its repositories or Prisma models directly.
- Controllers translate HTTP into a service call and back. No queries, no
  business rules.
- Provider SDKs (AI, Stripe, messaging) are reached only through an interface owned
  by the domain that needs them. Business code never imports an SDK.
- Cross-domain side effects (notify, audit, update analytics) go through events,
  not direct calls, so the emitting module does not depend on its listeners.

## HTTP conventions

- Every route lives under `/api/v1`. Versioning is URI-based so a v2 can run beside v1.
- Errors always have this shape. Clients branch on `code`, never on `message`:

  ```json
  {
    "error": {
      "code": "VALIDATION_FAILED",
      "message": "Some fields are missing or invalid.",
      "details": ["email must be an email"],
      "requestId": "0b6c7c64-5f39-4bd7-a3c5-1b0b3e1c4f7e"
    }
  }
  ```

- Unexpected errors return `INTERNAL_ERROR` with a generic message. The stack
  trace is logged with the request id, never sent to the client.
- Every response carries `x-request-id`. An upstream id is reused only if it
  matches `[A-Za-z0-9._-]{8,64}`; anything else is replaced.

## Tenancy and authorization

Every request passes three global guards, in this order:

1. **Rate limit**: counted in Redis per client address (and per address + email
   on routes that take an email).
2. **Access token**: every route needs a valid bearer token unless it is marked
   `@Public()`. A forgotten decorator fails closed.
3. **Tenant**: routes marked `@RequirePermissions(...)` act inside one
   organization.

The client chooses the organization with the `x-organization-id` header, but the
header is only a selector. The guard looks up the membership for the
authenticated user and that organization, and rejects the request unless it is
active and its role grants every required permission. Services receive the
resolved context (`@CurrentTenant()` / `@Actor()`) and never read the header
or trust an organization id from a request body.

"Not a member" and "no such organization" return the same `403
ORGANIZATION_ACCESS_DENIED`, so other tenants' ids cannot be probed. Records are
loaded with `organizationId` in the `where` clause, so an id from another
tenant is a `404`, never someone else's data.

Collections that can grow (the audit log) are paginated with a cursor and
return `{ data, nextCursor }`. Small bounded collections (roles, teams,
sessions) return a plain array.

## Audit log

Changes that matter to an admin (roles, membership, invitations, teams,
workspace settings) write an `AuditLog` row in the same transaction as the
change, so an entry exists exactly when the change committed. The actor is
stored as an id plus a name snapshot, so old entries still read correctly after
someone is renamed or removed. Entries are never updated.

## Configuration

`src/config/env.ts` is the single source of truth for environment variables.
The app refuses to start if any value is missing or malformed and lists every
problem at once.

## Logging

Structured JSON logs via pino. Each line carries the request id. Credentials are
redacted at the logger level (auth headers, cookies, and any field named
`password`, `token`, `secret`, etc.), so a careless `logger.info(dto)` cannot leak
them. Health-check requests are not logged.

## Health

- `GET /api/v1/health/live`: the process is up.
- `GET /api/v1/health/ready`: Postgres and Redis respond within 2s; otherwise `503`.
