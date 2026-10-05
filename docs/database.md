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

## Invitations and audit

| Table        | Notes                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invitation` | Token stored hashed. Pending = not accepted, not revoked, not expired. Re-inviting an address revokes its pending invitation.                        |
| `AuditLog`   | Append-only. Indexed on `(organizationId, createdAt DESC)` for the log view and on `(organizationId, entityType, entityId)` for an entity's history. |

Accepting an invitation is a conditional `UPDATE ... WHERE acceptedAt IS NULL`,
so a double-click cannot create two memberships.

## Contacts

| Table             | Notes                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Contact`         | Unique `(organizationId, email)`; NULL emails never collide. `stage` is VISITOR, LEAD or CUSTOMER.                                                                                        |
| `ContactIdentity` | How a contact is known on one channel. Unique `(organizationId, channel, externalId)`, which is what inbound messages are matched on. Kept in step when the email or phone field changes. |
| `Tag`             | Workspace-wide, unique by name. Colour is a palette key, not a hex value, so the UI controls contrast.                                                                                    |
| `ContactNote`     | Internal only. Author is a membership and is set to NULL if that person leaves.                                                                                                           |
| `ContactActivity` | The timeline. Other domains append here in their own transactions instead of the contact page joining every table.                                                                        |

Search uses `pg_trgm` GIN indexes on `name` and `email`, so `ILIKE '%marc%'`
stays an index scan as the table grows. Lists are keyset-paginated on the
UUIDv7 id, newest first.

## Products and orders

| Table       | Notes                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Product`   | Price in integer cents with an ISO currency per row. Unique SKU per workspace. Archived products cannot be ordered.                                                 |
| `Order`     | `number` is what customers quote ("#10482"), sequential per workspace and unique on `(organizationId, number)`. Deleting a contact keeps their orders (`SET NULL`). |
| `OrderItem` | Name, SKU and unit price are copied from the product when the order is placed, so catalogue edits never rewrite past orders.                                        |

**Order numbers.** The next number is `max + 1` inside the creating transaction.
Two orders created at the same instant can pick the same number; the unique index
rejects one and the service retries with the next number. That keeps numbers
gap-free without a separate counter row that every order would lock.

**Revenue.** "Spent" counts paid, fulfilled, shipped and delivered orders only.
Refunded and cancelled orders still appear in the order count.

## Inbox

| Table              | Notes                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Channel`          | Where conversations arrive (website chat, email, Telegram). `settings` holds only non-secret display values.                                                                                                                                                                                                     |
| `Conversation`     | `status` (OPEN, PENDING, RESOLVED, CLOSED) and `handler` (AI_HANDLING, HUMAN_HANDLING, AI_ESCALATED) are separate on purpose: who is answering is a different question from whether it is done. Denormalised `lastMessageAt`, `lastMessagePreview` and `lastInboundAt` keep the inbox list to one indexed query. |
| `Message`          | `sender` is CONTACT, MEMBER, AI or SYSTEM. `internal` marks notes, which never leave the team. System messages record assignment and status changes in the thread itself.                                                                                                                                        |
| `ConversationRead` | One row per member per conversation. Unread = customer messages newer than `lastReadAt`, counted for a whole page in one grouped query.                                                                                                                                                                          |
| `ConversationTag`  | Reuses workspace tags, so "Wholesale" means the same thing on a contact and a conversation.                                                                                                                                                                                                                      |

The inbox list is keyset-paginated on `(lastMessageAt, id)` so new messages
reordering the list do not cause skipped or repeated rows between pages.

## Seed data

`npm run db:seed` creates the **Northstar Coffee** demo workspace: seven members
across all six system roles, two teams, and 24 customers, wholesale accounts and
leads with tags and notes, a 12-product catalogue, 32 orders (#10455 to #10486), and 13 conversations across website chat and email. Every demo user signs in with `northstar-demo`. It is idempotent and refuses to run
with `NODE_ENV=production`.
