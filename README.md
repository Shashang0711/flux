# FLUX – Fluid & Laboratory Unified eXchange

Multi-tenant SaaS platform for marine fluid-sampling laboratories: client and vessel master data,
kit receiving, batch registration, testing, Admin review and report publishing. Each subscribing
company is a **tenant** with its own users, data and licensed modules.

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

There is no self-registration. Set `FLUX_ADMIN_EMAIL` and `FLUX_ADMIN_PASSWORD` (8+ characters)
in `apps/api/.env`, then run `npm run db:seed`. The seed creates that **platform admin** only if
the email does not exist yet; re-running it never changes an existing account. Change the password
after first sign-in (`POST /api/v1/auth/change-password`).

The platform admin then creates tenants, each with its first tenant admin, via
`POST /api/v1/platform/tenants`. That first user holds the tenant's built-in Administrator role
and manages the organisation's users and roles from there.

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
- **`@RequirePlatformAdmin()`** guards platform endpoints. **`@RequirePermission('x.y')`** guards
  tenant endpoints (see "Roles and permissions").
- **Passwords** are hashed with argon2id. The policy lives in `@flux/shared` so the API and forms
  agree. Login answers "Invalid email or password" for every failure, and is rate-limited per IP
  (`LOGIN_RATE_LIMIT`) and per account (`LOGIN_ACCOUNT_RATE_LIMIT`).
- **Web → API.** Browser code calls same-origin `/api/v1/*`; the Route Handler
  `apps/web/src/app/api/v1/[...path]` forwards to `API_BASE_URL`, read at request time, so one
  build works in every environment. Server Components call the API directly via
  `serverApiFetch`, forwarding the session cookie, and protect pages with `requireSession()`.
  `src/proxy.ts` only redirects requests without a cookie to `/login`.
- **Behind a proxy**, set `TRUST_PROXY` so the API sees real client IPs (the default `loopback`
  covers a Next.js server on the same host).

## Web app

Signed-in pages live under `apps/web/src/app/(app)/`. Its layout validates the session once and
renders the shell: a sidebar built from `lib/navigation.ts`, showing only what the user may access.

| Path                    | Who                | Purpose                                    |
| ----------------------- | ------------------ | ------------------------------------------ |
| `/`                     | Everyone signed in | Dashboard                                  |
| `/account`              | Everyone signed in | Profile and change password                |
| `/platform/tenants/...` | Platform admins    | Tenants: list, create, modules, suspend    |
| `/admin/users/...`      | `user.view`        | Users: list, create, roles, disable, reset |
| `/admin/roles/...`      | `role.view`        | Roles: tabs from the spec, clone           |

Conventions for new screens:

- Pages are Server Components that load data with `loadOrNotFound()` and check access with
  `sessionWithPermission()` (render `<Forbidden />` if not allowed). The API enforces the same
  permissions regardless.
- Mutations are small Client Components using `useMutation()` + `apiFetch()`; field errors from
  the API appear next to their inputs automatically (`fieldErrors()`).
- Add the screen to `NAVIGATION` with the permission that gates it.
- Styling: CSS variables and shared classes in `globals.css` (`.btn`, `.card`, `.table`, `.field`,
  `.badge`, …), CSS modules for anything page-specific; light and dark themes follow the OS.

## Tenancy

Users belong to exactly one tenant, except **platform admins**, who belong to none
(a database CHECK enforces this). Email addresses are unique across the platform.

**Isolation: row-level security.** Tenant data lives in shared tables with a `tenant_id` column.
Postgres RLS, not application code, guarantees a tenant only sees its own rows:

- `TenantDb.run(tenantId, tx => ...)` opens a transaction, switches to the restricted `flux_app`
  role and sets `app.tenant_id`. Inside it, every query is filtered by the table's policy, even
  with no `where` clause, and writes into another tenant fail.
- Get `tenantId` from `@CurrentTenant()`, which rejects callers without a tenant.
- The plain `PrismaService` bypasses RLS. It is only for system code: login, sessions and
  platform administration.
- Tests in `apps/api/test/tenant-isolation.e2e-spec.ts` prove the guarantee and fail if RLS is
  switched off.

**Every new tenant-owned table must, in its migration:**

1. have `tenant_id UUID NOT NULL REFERENCES tenants(id)` and an index on it;
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY tenant_isolation ON ...
USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())`;
3. `GRANT` to `flux_app` only the privileges the app needs (usually no `DELETE`);
4. if it references other tenant-owned rows, use a composite foreign key `(…_id, tenant_id)` to
   that table's `(id, tenant_id)`, so a row can never link records of two tenants;
5. be accessed only through `TenantDb.run`, and get an isolation test.

**Modules.** The catalogue is `MODULES` in `@flux/shared`. Core modules are always available;
optional ones are licensed per tenant by the platform admin. Guard endpoints with
`@RequireModule('<key>')`; unlicensed tenants get `403 MODULE_NOT_ENABLED`.

**Suspension.** A suspended tenant's users are signed out at once and cannot sign in
(`403 TENANT_SUSPENDED`, shown only after a correct password).

**Production database roles.** Migrations create `flux_app` (no login) and grant it to the
migrating role. The API must connect as the role that owns the tables, so system queries bypass
RLS while tenant queries switch to `flux_app`.

## Roles and permissions

- **Catalogue in code.** `PERMISSIONS` and `PORTALS` in `@flux/shared` (e.g. `vessel.view`,
  `sample.register`, `report.publish`), each permission belonging to a module. Tenants combine
  them into their own roles; they cannot invent keys. Keys are stored in the database: add or
  retire, never rename.
- **Roles** (per tenant) have the tabs from the specification: Portal Access, Module Access,
  Role Permissions and Assigned Users, and can be cloned with copy options. Roles are deactivated,
  never deleted.
- **Effective access** is the union over the user's active roles. A permission counts only if its
  module is granted by the same role **and** licensed to the tenant; "manage" implies "view".
  It is computed on every request, so changes take effect immediately.
- **Administrator** is a built-in role in every tenant: everything licensed, all internal portals.
  It cannot be edited or deactivated, and the tenant always keeps at least one active user in it.
- **No privilege escalation.** Nobody can grant permissions they do not hold, whether by editing a
  role or by assigning one (including the Administrator role).
- Guard endpoints with `@RequirePermission('<key>')` (all listed keys required). Combine with
  `@RequireModule` where the whole controller belongs to an optional module.

## Reference data

Hybrid lists (vessel types, classification societies, vessel relationship types, …) live in one
generic table, `reference_items`; the lists themselves are `REFERENCE_LISTS` in `@flux/shared`.
**Adding a list needs no migration**: add it to the catalogue and seed its defaults.

- **FLUX defaults** (`tenant_id` NULL) are managed by platform admins (Platform → Reference data)
  and visible to every tenant. `prisma/reference-defaults.ts` holds the seeded defaults; the seed
  only creates missing items and never overwrites edits.
- **Tenant items** are each organisation's own additions (Admin → Reference data,
  `reference-data.manage`). Tenants can also **hide** a FLUX default they don't use; hiding is
  per tenant. Defaults themselves can never be changed by a tenant (RLS: tenants may read
  defaults but write only their own rows; a trigger allows hiding only defaults).
- Codes are unique per list within each scope, ignoring case, and a tenant item may not reuse a
  default's code.
- Items are deactivated, never deleted. `GET /reference-data/:list` returns active, non-hidden
  items for dropdowns; `?view=all` returns everything for management screens.
- A list is available to a tenant only if its module is licensed.
- Domain tables should reference items with a composite foreign key `(…_id, list_key)` →
  `reference_items (id, list_key)` so a vessel can only point at a vessel type.
- Tenant changes go to the tenant's audit log; changes to defaults go to the **platform audit
  log** (`audit_logs.tenant_id` NULL, invisible to tenants; Platform → Audit log).

## Audit log

Every significant change is recorded in `audit_logs`: actor, action, record, request ID, IP and
field-level changes (`{ field: {from, to} }` or `{ list: {added, removed} }`). Never secrets.

- **Append-only.** The app role may only `SELECT`/`INSERT`; a trigger rejects `UPDATE` and
  `DELETE` for everyone, including the table owner.
- **Atomic.** `recordAudit(tx, …)` writes with the caller's transaction, so an entry exists if and
  only if the change was committed. Rejected changes leave nothing behind.
- **Per-record history.** `relatedIds` lists other records an entry affected (e.g. the roles in a
  user's role change), so `GET /audit-logs?entityId=…` returns everything touching that record.
- **Platform actions** on a tenant (creation, modules, suspension) appear in the tenant's log as
  "FLUX platform"; operators see their own names in the platform view of the tenant.

When adding a feature that changes data:

1. add its action key and label to `AUDIT_ACTIONS` in `@flux/shared` (never rename keys);
2. call `recordAudit(tx, …)` in the same transaction as the change, with `fieldChanges()` /
   `listChange()` for the diff, and only when something actually changed;
3. add an e2e test asserting the entry and its changes.

### Endpoints

| Method and path                               | Access         | Purpose                                                                 |
| --------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `POST /api/v1/auth/login`                     | Public         | Sign in; sets the session cookie                                        |
| `POST /api/v1/auth/logout`                    | Public         | Revoke the session and clear the cookie                                 |
| `GET /api/v1/auth/me`                         | Signed in      | Current user                                                            |
| `POST /api/v1/auth/change-password`           | Signed in      | Change own password; ends other sessions                                |
| `GET /api/v1/users`                           | `user.view`    | List own tenant's users (`page`, `pageSize`, `q`, `status`)             |
| `POST /api/v1/users`                          | `user.manage`  | Create a user (optionally with `roleIds`)                               |
| `GET /api/v1/users/:id`                       | `user.view`    | Read user                                                               |
| `PATCH /api/v1/users/:id`                     | `user.manage`  | Update name, email or status                                            |
| `PUT /api/v1/users/:id/roles`                 | `user.manage`  | Replace the user's roles                                                |
| `POST /api/v1/users/:id/reset-password`       | `user.manage`  | Set a new password; ends their sessions                                 |
| `GET /api/v1/access/catalogue`                | `role.view`    | Licensed modules, portals and permissions                               |
| `GET /api/v1/roles`                           | `role.view`    | List roles (`q`, `isActive`)                                            |
| `POST /api/v1/roles`                          | `role.manage`  | Create role with portals, modules, permissions                          |
| `GET /api/v1/roles/:id`                       | `role.view`    | Read role and its access                                                |
| `PATCH /api/v1/roles/:id`                     | `role.manage`  | Name, description, default portal, active                               |
| `PUT /api/v1/roles/:id/portals`               | `role.manage`  | Portal Access tab                                                       |
| `PUT /api/v1/roles/:id/modules`               | `role.manage`  | Module Access tab                                                       |
| `PUT /api/v1/roles/:id/permissions`           | `role.manage`  | Role Permissions tab                                                    |
| `POST /api/v1/roles/:id/clone`                | `role.manage`  | Clone with copy options                                                 |
| `GET /api/v1/roles/:id/users`                 | `role.view`    | Assigned Users tab                                                      |
| `POST /api/v1/roles/:id/users`                | `user.manage`  | Assign users                                                            |
| `DELETE /api/v1/roles/:id/users/:userId`      | `user.manage`  | Unassign a user                                                         |
| `GET /api/v1/audit-logs`                      | `audit.view`   | Audit log (`action`, `entityType`, `entityId`, `actorId`, `from`, `to`) |
| `GET /api/v1/platform/tenants/:id/audit-logs` | Platform admin | Organisation-level history of a tenant                                  |
| `GET /api/v1/platform/modules`                | Platform admin | Module catalogue                                                        |
| `GET /api/v1/platform/tenants`                | Platform admin | List tenants (`q`, `status`)                                            |
| `POST /api/v1/platform/tenants`               | Platform admin | Create tenant + modules + first admin                                   |
| `GET /api/v1/platform/tenants/:id`            | Platform admin | Read tenant                                                             |
| `PATCH /api/v1/platform/tenants/:id`          | Platform admin | Rename, suspend or reactivate                                           |
| `PUT /api/v1/platform/tenants/:id/modules`    | Platform admin | Set licensed optional modules                                           |

## Database conventions

- UUID primary keys; human-readable business codes (client code, batch number) as separate
  `@unique` columns.
- Workflow states are Prisma enums, never free-text strings. Display colours (red/yellow/green)
  are computed from state and never stored.
- `snake_case` tables and columns via `@@map`/`@map`; camelCase in TypeScript.
- The seed is idempotent (upserts only).
