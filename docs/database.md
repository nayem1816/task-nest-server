# Database

PostgreSQL 17 with the `citext` and `vector` extensions. The Prisma schema in
`prisma/schema.prisma` is the source of truth; migrations in `prisma/migrations`
are generated from it and committed.

## Conventions

- **Primary keys** are UUIDv7 (`@default(uuid(7))`). They are time-ordered, so
  B-tree inserts stay append-mostly like a serial id, and they can be generated
  by the app or a worker without a round trip.
- **Tenant ownership.** Every tenant-owned table has a non-null `organizationId`
  with `ON DELETE CASCADE` from `Organization`. Queries filter on it first, so
  composite indexes start with `organizationId`.
- **Emails** are `citext`. `Ana@x.com` and `ana@x.com` are the same account at the
  database level, not only in application code.
- **Timestamps** are `createdAt` / `updatedAt` on every mutable table. Soft delete
  (`deletedAt`) is used only where data must survive a grace period.
- **Enums** are Postgres enums for closed sets the code switches on (statuses).
  Open-ended values (business type, tags) are plain text.

## Identity and tenancy

```
User ─────────┐
              │ 1..n
              ▼
      OrganizationMember ──── n..1 ──▶ Role (permissions: text[])
              │  ▲                       │
              │  └──── n..1 ─────────────┘── belongs to ─▶ Organization
              │ n..n (TeamMember)
              ▼
            Team ──── belongs to ─▶ Organization
```

| Table                | Notes                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| `User`               | Global. Has no `organizationId`; access is always through a membership.        |
| `Organization`       | The tenant. Unique `slug` for URLs.                                            |
| `Role`               | Per organization, unique on `(organizationId, key)`. Six system roles per org. |
| `OrganizationMember` | Unique on `(organizationId, userId)`. Role reference is `RESTRICT`.            |
| `Team`               | Unique name per organization.                                                  |
| `TeamMember`         | Composite key `(teamId, memberId)`; references the membership, not the user.   |

`TeamMember` points at `OrganizationMember` rather than `User` on purpose: only
people with a membership can be on a team, and removing someone from the
organization removes them from its teams in the same cascade. That the team and
the membership belong to the _same_ organization is checked by the teams service,
not by a foreign key.

Constraints the code relies on are covered by `test/tenancy-schema.e2e-spec.ts`.

## Seed data

`npm run db:seed` creates the **Northstar Coffee** demo workspace: seven members
across all six system roles and two teams. It is idempotent and refuses to run
with `NODE_ENV=production`.
