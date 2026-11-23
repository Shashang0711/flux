# FLUX – Fluid & Laboratory Unified eXchange

Multi-portal (Admin, Lab, Client, Finance) platform for marine fluid sampling: client and vessel
master data, kit receiving, batch registration, testing, Admin review and report publishing.

## Repository layout

```
apps/
  api/        NestJS REST API (Prisma + PostgreSQL), served at /api/v1
  web/        Next.js (App Router) frontend for all portals
packages/
  shared/     Contracts used by both apps: response envelope, error codes, pagination
```

npm workspaces; Node 20.19+ (`.nvmrc`).

## Getting started

1. **Database.** Either `docker compose up -d` (Postgres 16 on host port **5433**, user/password/db
   `flux`), or create a database on an existing Postgres server and set `DATABASE_URL` accordingly.
2. **Environment.**
   ```bash
   cp apps/api/.env.example apps/api/.env   # set DATABASE_URL if not using Docker
   cp apps/web/.env.example apps/web/.env
   ```
3. **Install, migrate, seed, run.**
   ```bash
   npm install          # also builds packages/shared and generates the Prisma client
   npm run db:migrate
   npm run db:seed
   npm run dev          # API on :4000, web on :3000
   ```
   Open http://localhost:3000. The home page shows live API and database status, from
   `GET /api/v1/health`.

## Scripts (from the repo root)

| Script                            | What it does                                         |
| --------------------------------- | ---------------------------------------------------- |
| `npm run dev`                     | API (watch) and web (dev server) together            |
| `npm run build`                   | Production build of shared → api → web               |
| `npm run lint` / `typecheck`      | ESLint and TypeScript across all workspaces          |
| `npm run format` / `format:check` | Prettier                                             |
| `npm test`                        | Unit + HTTP-pipeline tests (no database needed)      |
| `npm run test:e2e`                | API end-to-end tests against the real `DATABASE_URL` |
| `npm run db:migrate` / `db:seed`  | Prisma migrations (dev) and idempotent seed          |

## API conventions

Every module added from M2 onwards must follow these; they are enforced by global
infrastructure in `apps/api/src/common`.

- **URLs** are versioned: `/api/v1/<resource>`.
- **Success** responses are `{ "data": ... }`. Lists return `Paginated` from the handler and
  are rendered as `{ "data": [...], "meta": { page, pageSize, total, totalPages } }`. Page
  parameters are `?page=1&pageSize=20` (max 100), parsed with `pageQuerySchema`.
- **Errors** are `{ "error": { code, message, details?, requestId } }`. Throw `AppException`
  (`AppException.notFound(...)`, `.conflict(...)`, ...). Codes are listed in
  `packages/shared/src/api/errors.ts`. Prisma unique violations become `409 CONFLICT`
  automatically, and unknown errors become `500 INTERNAL_ERROR` without leaking details.
- **Validation** uses Zod schemas via `ZodValidationPipe`. Failures return
  `400 VALIDATION_ERROR` with per-field `details`.
- **Correlation**: every response has an `x-request-id` header (an inbound value is honoured).
  The same ID appears in logs and error bodies.
- **Configuration** is validated at boot (`src/config/env.ts`). The API refuses to start with
  a bad environment.
- Opt out of the envelope (file downloads, exports) with `@RawResponse()`.

## Database conventions

- UUID primary keys; human-readable business codes (client code, batch number) as separate
  `@unique` columns.
- Workflow states are Prisma enums, never free-text strings. Display colours (red/yellow/green)
  are computed from state and never stored.
- `snake_case` tables and columns via `@@map`/`@map`; camelCase in TypeScript.
- The seed is idempotent (upserts only).
