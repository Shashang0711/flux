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

### Option A: everything in Docker

```bash
docker compose up -d --build
```

This starts Postgres (host port **5433**), the API (**4000**, applies migrations on start) and the
web app (**3000**). Open http://localhost:3000. Seed the database once with
`docker compose exec api npx prisma db seed`. Ports can be changed with `POSTGRES_PORT`,
`API_PORT` and `WEB_PORT`. Stop any local `npm run dev` first, or the ports will clash.

### Option B: apps on the host

1. **Database.** Either `docker compose up -d postgres` (Postgres 16 on host port **5433**,
   user/password/db `flux`), or create a database on an existing Postgres server and set
   `DATABASE_URL` accordingly.
2. **Environment.**
   ```bash
   cp apps/api/.env.example apps/api/.env   # set DATABASE_URL if not using Docker
   cp apps/web/.env.example apps/web/.env
   ```
3. **Install, migrate, seed, run.**
   ```bash
   npm install          # also builds packages/shared and generates the Prisma client
   npm run db:migrate
   npm run db:seed      # creates the bootstrap admin (see below)
   npm run dev          # API on :4000, web on :3000, shared package in watch mode
   ```
   Open http://localhost:3000 and sign in.

### Bootstrap admin

There is no self-registration. Set `FLUX_ADMIN_EMAIL` and `FLUX_ADMIN_PASSWORD` (12+ characters)
in `apps/api/.env`, then run `npm run db:seed`. The seed creates that system admin only if the
email does not exist yet; re-running it never changes an existing account. Change the password
after first sign-in (`POST /api/v1/auth/change-password`).

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

## Authentication

- **Sessions** are server-side (`sessions` table). The browser holds a random token in the
  httpOnly, SameSite=Lax cookie `flux_session`; the database stores only its SHA-256 hash.
  Sessions end on logout, after `SESSION_IDLE_MINUTES` of inactivity, or after
  `SESSION_TTL_HOURS`. Disabling a user or resetting their password revokes their sessions at once.
- **Deny by default.** A global guard requires a valid session on every route. Mark exceptions
  with `@Public()`. Get the caller with `@CurrentUser()`.
- **`@RequireSystemAdmin()`** (user management) is temporary; M3 replaces it with role permissions.
- **Passwords** are hashed with argon2id. The policy lives in `@flux/shared` so the API and forms
  agree. Login answers "Invalid email or password" for every failure, and is rate-limited per IP
  (`LOGIN_RATE_LIMIT`) and per account (`LOGIN_ACCOUNT_RATE_LIMIT`).
- **Web → API.** Browser code calls same-origin `/api/v1/*`; the Route Handler
  `apps/web/src/app/api/v1/[...path]` forwards to `API_BASE_URL`, read at request time, so one
  build works in every environment. Server Components call the API directly via
  `serverApiFetch`, forwarding the session cookie, and protect pages with `requireUser()`.
  `src/proxy.ts` only redirects requests without a cookie to `/login`.
- **Behind a proxy**, set `TRUST_PROXY` so the API sees real client IPs (the default `loopback`
  covers a Next.js server on the same host).

### Endpoints (M2)

| Method and path                         | Access       | Purpose                                  |
| --------------------------------------- | ------------ | ---------------------------------------- |
| `POST /api/v1/auth/login`               | Public       | Sign in; sets the session cookie         |
| `POST /api/v1/auth/logout`              | Public       | Revoke the session and clear the cookie  |
| `GET /api/v1/auth/me`                   | Signed in    | Current user                             |
| `POST /api/v1/auth/change-password`     | Signed in    | Change own password; ends other sessions |
| `GET /api/v1/users`                     | System admin | List (`page`, `pageSize`, `q`, `status`) |
| `POST /api/v1/users`                    | System admin | Create user                              |
| `GET /api/v1/users/:id`                 | System admin | Read user                                |
| `PATCH /api/v1/users/:id`               | System admin | Update name, email, status or admin flag |
| `POST /api/v1/users/:id/reset-password` | System admin | Set a new password; ends their sessions  |

## Database conventions

- UUID primary keys; human-readable business codes (client code, batch number) as separate
  `@unique` columns.
- Workflow states are Prisma enums, never free-text strings. Display colours (red/yellow/green)
  are computed from state and never stored.
- `snake_case` tables and columns via `@@map`/`@map`; camelCase in TypeScript.
- The seed is idempotent (upserts only).
