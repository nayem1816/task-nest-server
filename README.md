# TaskNest API

Backend for TaskNest, a multi-tenant workspace where support and sales teams handle
customer conversations from every channel, with an AI agent that answers from the
company's own knowledge and hands off to a human when it is unsure.

The web client lives in [task-nest-client](https://github.com/nayem1816/task-nest-client).

## Stack

NestJS 12 (ESM) · PostgreSQL 17 + pgvector · Prisma 7 · Redis + BullMQ · pino ·
Vitest · Docker Compose

Why these and not the alternatives: [docs/decisions.md](docs/decisions.md).

## Running locally

Requirements: Node 22.12+, Docker.

```bash
cp .env.example .env
npm install          # also generates the Prisma client
npm run infra:up     # Postgres, Redis, object storage, Mailpit
npm run db:migrate
npm run dev
```

| Service         | URL                                       |
| --------------- | ----------------------------------------- |
| API             | http://localhost:4100/api/v1              |
| API docs        | http://localhost:4100/api/docs            |
| Readiness       | http://localhost:4100/api/v1/health/ready |
| Mailpit (email) | http://localhost:8025                     |
| Storage console | http://localhost:9001/rustfs/console/     |

Postgres and Redis are published on 5433 and 6380 so they don't clash with
instances already running on your machine.

## Scripts

| Command              | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | API with file watching                      |
| `npm test`           | Unit tests                                  |
| `npm run test:e2e`   | HTTP tests against real Postgres and Redis  |
| `npm run lint`       | ESLint with type-aware rules                |
| `npm run typecheck`  | `tsc --noEmit`                              |
| `npm run db:migrate` | Create and apply a migration in development |

## Documentation

- [Architecture](docs/architecture.md)
- [Decisions](docs/decisions.md)
- [Roadmap](docs/roadmap.md)
