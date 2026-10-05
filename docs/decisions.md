# Architecture decisions

Short records of decisions that shape the codebase. Each one says what was
chosen, what was rejected, and what we accept as the cost.

---

## ADR-001: Modular monolith, not microservices

**Decision.** One NestJS application with strict module boundaries. Workers run the
same code with a different entry module.

**Why.** The domains (conversations, AI, knowledge, workflows) change together
while the product is young. Separate services would add network calls, distributed
transactions and deployment overhead with no scaling benefit at this size.

**Cost.** Discipline is enforced by convention and review, not by the network.
The rules in `architecture.md` exist so a module can be extracted later without
rewriting its callers.

---

## ADR-002: PostgreSQL as the only primary datastore

**Decision.** PostgreSQL holds relational data, JSONB metadata, and vector
embeddings (pgvector). No separate document store or vector database.

**Why.** Tenant data must stay consistent: a deleted knowledge source must stop
being retrievable in the same transaction. Keeping vectors next to the rows they
describe makes that a single `DELETE`. Postgres also gives full-text search for
global search and row-level security if we decide to add it.

**Rejected.** MongoDB (the data is relational: org → member → conversation →
message). A hosted vector DB (a second copy of tenant data to keep in sync and to
isolate per tenant).

**Cost.** Very large vector workloads would eventually want a dedicated index. With
HNSW indexes in pgvector that point is far beyond this product's scale.

---

## ADR-003: Prisma over TypeORM

**Decision.** Prisma 7 with the `pg` driver adapter.

**Why.** Generated types follow the schema exactly, including relations and
selected fields, which removes a whole class of "relation was not loaded" bugs.
Migrations are generated from a declarative schema and are reviewable SQL.

**Rejected.** TypeORM: weaker inference on query results, migration generation
that drifts on enums and indexes, and entity classes that invite business logic
into persistence models.

**Cost.** Prisma has no native pgvector type. Vector columns are declared as
`Unsupported("vector(n)")` and read or written through a small repository that
uses `$queryRaw` with tagged templates (still parameterised). That raw SQL is kept
in one place per domain.

---

## ADR-004: Redis + BullMQ for background work

**Decision.** Anything slow, retryable or triggered by an external system runs as a
BullMQ job: document processing, embeddings, AI replies, webhooks, notifications.

**Why.** Requests stay fast, and failures get retries with backoff instead of a 500
to the user. BullMQ gives retries, delays, rate limits, repeatable jobs and
inspection on top of Redis, which we already need for WebSocket fan-out.

**Cost.** Redis becomes critical infrastructure. It runs with `appendonly yes` and
`maxmemory-policy noeviction`, because evicting a queue key would silently lose jobs.

---

## ADR-005: Two repositories, typed through OpenAPI

**Decision.** Client and server live in separate repositories. The client's API
types are generated from the server's OpenAPI document.

**Why.** The two deploy to different platforms on different schedules. Generating
types from the published contract means the client can only rely on what the API
actually documents.

**Cost.** A breaking API change needs a coordinated change in both repositories.
The `/api/v1` prefix and additive changes keep that rare.

---

## ADR-006: ESM and strict TypeScript

**Decision.** The server is an ES module (`"type": "module"`, `nodenext`
resolution) with `strict` and `noUncheckedIndexedAccess`.

**Why.** It is the default for NestJS 12 and for the libraries we depend on.
`noUncheckedIndexedAccess` forces handling of the missing-key case on records and
arrays, which matters in multi-tenant lookups.

**Cost.** Relative imports carry a `.js` extension.

---

## ADR-007: RustFS for local object storage

**Decision.** Local development uses RustFS behind the S3 API. Production uses S3
or Cloudflare R2.

**Why.** MinIO stopped publishing container images. Code talks to storage through
the S3 protocol only, so the local server is replaceable without code changes.

---

## ADR-008: Permissions are defined in code, roles in the database

**Decision.** The permission catalog is a TypeScript constant
(`src/modules/authorization/permissions.ts`). Roles are rows per organization and
store the permission keys they grant as a `text[]`.

**Why.** A permission only means something if a guard checks it, and guards are
code. Keeping the catalog in code means a typo in a guard is a compile error,
and a role can never grant a capability the code does not know about. Roles are
data because tenants will want custom ones.

**Rejected.** `Permission` and `RolePermission` tables. They would need to be
kept in sync with the code on every deploy and add a join to every
authorization check, without letting anyone create a permission the code honours.

**Cost.** Renaming or removing a permission needs a data migration over
`Role.permissions`. Writes to that column are validated against the catalog.

---

## ADR-009: Short-lived JWTs plus rotating opaque refresh tokens, without Passport

**Decision.** Access tokens are 15-minute JWTs verified with `jose`. Refresh
tokens are random strings stored hashed and rotated on every use. A small global
guard does the checking; Passport is not used.

**Why.** JWT access tokens let every request authenticate without a database
read, which matters once WebSocket connections and workers authenticate too.
Their weakness, staying valid after logout, is closed by a Redis revocation key
per session. Refresh tokens do not need to be self-describing, so an opaque
value we can look up, revoke and detect reuse of is strictly better than a
second JWT.

Passport's strategy abstraction pays off with many login methods. With one
method today and OAuth planned behind the same session layer, the guard is about
40 lines and keeps the security-relevant logic in plain sight.

**Cost.** OAuth providers will need their own callback handling rather than an
off-the-shelf strategy. The session layer they end in stays the same.

---

## ADR-010: The workspace is chosen per request by header, authorized by membership

**Decision.** Tenant routes read the organization from an `x-organization-id`
header. A global guard resolves the caller's membership for that organization on
every request and attaches the role's permissions.

**Why.** A user can belong to several workspaces and have two open in different
tabs. Putting the organization in the access token would mean re-issuing tokens
on every switch and would let a role change linger until the token expires.
Looking up the membership per request (one indexed query on a unique key)
means removing someone or changing their role takes effect on their next
request.

**Rejected.** Organization in the URL path (`/orgs/:id/members`): equivalent
security, but noisier routes and every client call needs the id threaded
through. Postgres row-level security as the primary control: worth adding as a
second layer later, but it needs a per-transaction `SET` with Prisma's pooled
connections and does not replace permission checks.

**Cost.** One extra query per tenant request. If it shows up in profiles, the
membership can be cached in Redis for a few seconds and invalidated on change.

---

## ADR-011: Realtime events carry ids, and the client refetches

**Decision.** The Socket.IO gateway pushes small notices (`message.created`
with a conversation and message id, `conversation.updated` with what changed).
The client invalidates the matching React Query caches and loads the data over
REST.

**Why.** The REST layer already decides, per role, what a member may see. If
sockets carried records, every listener would have to repeat that filtering,
and the first one that forgot would leak data (an internal note, a contact
field). With ids only, the worst a mistake can expose is that something
happened. It also keeps the client simple: one source of truth for data, the
socket only says when to look again.

**Rejected.** Pushing full records: one fewer round trip per event, but a
second, parallel authorization path. Server-sent events: fine for one-way
pushes, but typing indicators need the client to talk back, and Socket.IO's
Redis adapter solves multi-instance fan-out without extra work.

**Cost.** An extra request per event per open tab. Inbox traffic per workspace
is small enough that this is cheap, and React Query deduplicates refetches for
the same key.

---

## ADR-012: An email given in the chat widget is not linked to an existing customer

**Decision.** When a visitor types an email that is new to the workspace, it is
saved on their contact. When it already belongs to another contact, the visitor
keeps a separate contact and the claim is written to its timeline
(`contact.email_unverified`) for the team to check.

**Why.** Anyone can type any address. Linking on a match would put a stranger's
messages on a real customer's profile and, once the AI can look up orders,
answer questions about that customer's orders to whoever claimed the email.

**Rejected.** Linking automatically (the common shortcut). Emailing a
verification code before chatting: right for order lookups, so it comes with
the AI tools, but too much friction for "do you ship to Canada?".

**Cost.** Returning customers who chat from a new browser show up as a second
contact until someone merges them, or until verification exists.
