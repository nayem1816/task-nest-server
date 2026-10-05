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

## Domain events

Modules publish what happened through `@nestjs/event-emitter` after their
transaction commits (for example `inbox.message.created`). The realtime gateway,
and later automation and analytics, subscribe to these instead of being called
by the inbox. Internal notes carry `internal: true` so no listener can forward
them to a customer by accident.

## Realtime

The web app keeps one Socket.IO connection per tab, opened for one workspace.
The handshake (`auth: { token, organizationId }`) runs the same checks as the
HTTP guards: a valid access token, a session that has not been revoked, and an
active membership. Rejections carry a code in `err.data.code`
(`UNAUTHENTICATED`, `SESSION_EXPIRED`, `ORGANIZATION_REQUIRED`,
`ORGANIZATION_ACCESS_DENIED`).

Each socket joins a few rooms: the workspace, its session, its membership, and
the workspace inbox if the role has `conversation.read`. The gateway forwards
domain events to those rooms:

| Server → client        | Payload                                             |
| ---------------------- | --------------------------------------------------- |
| `message.created`      | `conversationId`, `messageId`, `internal`, `sender` |
| `conversation.updated` | `conversationId`, `changes`                         |
| `typing`               | `conversationId`, `memberId`, `name`                |

Events carry ids only. The client refetches through REST, so every field it
shows has passed the same permission checks as a normal request, and a socket
can never become a way around them.

Clients send `typing` (`{ conversationId }`, at most once a second; the
conversation must belong to the workspace) and `auth.renew`
(`{ token }`, acknowledged with `{ ok }`) after refreshing their access token.
A connection is closed when its token expires without renewal, when its
session is revoked (logout, password change, refresh-token reuse), and when the
member is removed, disabled or given another role. The client then reconnects,
and the handshake decides again.

Socket.IO runs over the Redis adapter, so a broadcast or a forced disconnect
from one API instance reaches sockets held by another. Events raised in a
separate worker process (AI replies, later) will need the Redis emitter, since
the worker has no gateway of its own.

The global HTTP guards skip socket messages: the handshake is where a socket is
authenticated.

## Website chat

A website chat channel has a public key (`wk_…`) that goes into the install
snippet. The widget runs in an iframe served by the web app and calls the
public `/api/v1/widget` routes:

1. `POST /widget/session` with the key, the page's origin and, on a return
   visit, the previous visitor token. It answers with a visitor token (30 days,
   kept in the widget's storage), the greeting and colors, and what is known
   about the visitor.
2. `GET /widget/messages` returns the visitor's current conversation: their own
   messages, team replies and AI replies. Internal notes and system lines are
   never included.
3. `POST /widget/messages` sends a message. The first one creates the contact
   (identity `WEBSITE_CHAT` + visitor id) and the conversation, through the
   same `receiveInbound` path every channel uses.

The widget listens on the `/widget` Socket.IO namespace with its visitor token
and refetches when told a message arrived. That namespace only has per-visitor
rooms, so a visitor token cannot hear anything but its own chat.

**Allowed sites.** When a channel lists allowed sites, sessions only start for
those origins. The origin comes from the loader script running on the page, so
this keeps the widget off sites it was not installed on. It does not stop
someone calling the API directly with a forged origin; nothing a browser sends
can. The visitor can only ever reach their own chat, so there is nothing more
to gain that way.

**Emails typed into the chat are claims, not proof.** See ADR-012.

## AI provider

Everything that talks to a model goes through `AiService`
(`src/modules/ai`). Callers use provider-neutral types (`AiMessage`,
`AiTool`, `GenerateResult`); the Gemini adapter is the only file that imports
the vendor SDK.

`AiService` adds, for every call:

- a timeout (`AI_TIMEOUT_MS`, default 30s),
- one retry with a short pause for rate limits, 5xx and timeouts (not for
  rejected requests),
- errors translated into our codes (`AI_NOT_CONFIGURED`, `AI_TIMEOUT`,
  `AI_RATE_LIMITED`, `AI_BAD_REQUEST`, `AI_UNAVAILABLE`) with a message a
  user can read; the vendor's detail goes to the logs only,
- an `AiUsage` row (feature, model, tokens, latency, ok or error code). Prompts
  and replies are not stored there.

Model names live in configuration (`AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`),
because providers retire models on their own schedule. Embeddings are 768
dimensions and normalized, since the knowledge base's vector column has that
size. Without `GEMINI_API_KEY` the API still starts and `GET /ai/status`
says AI is not set up.

Tool calls carry an opaque `signature` that must be sent back with the call
on the next turn (Gemini's thought signature). Agent code passes the model's
`message` back into the history unchanged rather than rebuilding it.

Tests never call a real model: the test app replaces the provider with a
scripted one. `npx tsx scripts/ai-smoke.ts` checks the real adapter (plain
reply, tool round trip, embedding) with the key in `.env`.

## Knowledge base

Sources are written articles, public web pages, or uploaded files (PDF, Word,
text, Markdown, HTML; up to 10 MB, originals kept in private object storage).
Adding or editing one bumps its `revision` and queues an indexing job on the
`knowledge` queue. The worker (`KnowledgeIndexer`):

1. reads the text (pages through `fetchPublicPage`, files through the
   extractors), keeping headings and lists as markdown,
2. splits it into passages of about 600 tokens that never cross a section and
   carry their heading path ("Shipping > International"), with a short overlap
   when a long section is cut,
3. embeds the passages through `AiService` (feature `knowledge.embed`),
4. swaps the passages in, in one transaction, only if the source's revision is
   still the one the job was queued for.

Status moves PENDING → PROCESSING → READY or FAILED, with a message written for
the person who added the source. Transient AI errors are retried by the queue;
the source only fails on the last attempt. On start, the worker queues sources
still waiting (for example, ones the seed script added).

Search is hybrid: the nearest passages by embedding (HNSW index, cosine) and
the best keyword matches (a generated `tsvector` with the `simple`
configuration, so product names and order numbers match as written) are
ordered by cosine similarity, with a small bonus for keyword matches (the best
keyword match +0.05, the next +0.025, …). Reciprocal rank fusion was the first
version; it ignores how close the semantic matches are, and a passage that
only shared a word with the question ("ship") outranked the one that answered
it. Each result carries its cosine similarity so the
agent can decline to answer when nothing is close enough. Failed sources are
never searched.

**Fetching pages safely.** `fetchPublicPage` only allows http(s), no
credentials in the URL, text/html or text/plain, up to 2 MB and 15 seconds. The
address check runs at connect time on the address actually dialled, for the
first request and every redirect, and refuses loopback, private, link-local
(cloud metadata), CGNAT, multicast and reserved ranges, IPv4-mapped IPv6
included.

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
