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
