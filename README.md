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

| Script                              | What it does                                          |
| ----------------------------------- | ----------------------------------------------------- |
| `npm run dev`                       | API (watch) and web (dev server) together             |
| `npm run build`                     | Production build of shared → api → web                |
| `npm run lint` / `typecheck`        | ESLint and TypeScript across all workspaces           |
| `npm run format` / `format:check`   | Prettier                                              |
| `npm test`                          | Unit + HTTP-pipeline tests (no database needed)       |
| `npm run test:e2e`                  | API end-to-end tests against `<DATABASE_URL db>_test` |
| `npm run db:migrate` / `db:seed`    | Prisma migrations (dev) and idempotent seed           |
| `npm run test:browser -w @flux/web` | Browser tests against a running stack (see below)     |

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

| Path                             | Who                                     | Purpose                                                                                               |
| -------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/`                              | Everyone signed in                      | Dashboard                                                                                             |
| `/account`                       | Everyone signed in                      | Profile and change password                                                                           |
| `/platform/tenants/...`          | Platform admins                         | Tenants: list, create, modules, suspend                                                               |
| `/admin/users/...`               | `user.view`                             | Users: list, create, roles, disable, reset                                                            |
| `/admin/roles/...`               | `role.view`                             | Roles: tabs from the spec, clone                                                                      |
| `/admin/vessels/...`             | `vessel.view`                           | Vessels: list, create (duplicate-IMO guidance), Overview, Audit                                       |
| `/admin/vessels/:id?tab=clients` | `vessel.view`                           | Vessel’s client relationships: link, primary, fleet, end                                              |
| `/admin/clients/...`             | `client.view`                           | Clients: grid, create, Overview / Addresses / Contacts / Billing Parties / Notifications / Audit tabs |
| `/admin/vessels/:id?tab=billing` | `vessel.view`                           | Vessel's Billing / Contacts / Notifications overrides, per client link (`&link=`)                     |
| `/admin/reference-data`          | `reference-data.manage`                 | Hide FLUX defaults, add own items                                                                     |
| `/admin/custom-fields`           | `custom-field.manage`                   | Define custom fields per record type                                                                  |
| `/admin/lab/service-types/...`   | `lab-setup.view`                        | Categories and service types; General / Registration fields / Preview / Kits / Audit                  |
| `/admin/lab/kits/...`            | `lab-setup.view`                        | Kits: service types, bottles, variants (own bottles), audit                                           |
| `/admin/lab/bottles`             | `lab-setup.view`                        | Bottle types                                                                                          |
| `/lab/receiving/...`             | `receiving.view`                        | Airway bills; receive kits one by one (scanner-friendly), edit, cancel                                |
| `/lab/registration-queue`        | `receiving.view`                        | Kits awaiting registration: all / vessel linked / unlinked                                            |
| `/lab/receive-register`          | `receiving.receive` + `sample.register` | Receive a package and register its kits in one step                                                   |
| `/lab/batches/new?kits=…`        | `sample.register`                       | Register batch: batch fields once, vessel/client and sample fields per kit                            |
| `/lab/batches/...`               | `sample.view`                           | Batches and their samples                                                                             |
| `/lab/samples/...`               | `sample.view`                           | Samples with status colour, kit, AWB and registration details                                         |
| `/lab/testing`                   | `sample.view`                           | Under testing: Batch view and Sample view of open work                                                |
| `/lab/batches/:id/results`       | `sample.view` (`sample.test` to edit)   | Results grid, CSV template download and upload with preview                                           |
| `/lab/reports/...`               | `report.view`                           | Lab reports: list, versions, download, replace file; upload from the batch page                       |
| `/admin/audit`                   | `audit.view`                            | Audit log with filters                                                                                |
| `/platform/reference-data`       | Platform admins                         | Manage FLUX default reference data                                                                    |
| `/platform/audit`                | Platform admins                         | Platform-level audit log                                                                              |

Conventions for new screens:

- Pages are Server Components that load data with `loadOrNotFound()` and check access with
  `sessionWithPermission()` (render `<Forbidden />` if not allowed). The API enforces the same
  permissions regardless.
- Mutations are small Client Components using `useMutation()` + `apiFetch()`; field errors from
  the API appear next to their inputs automatically (`fieldErrors()`).
- Add the screen to `NAVIGATION` with the permission and an icon (`components/icons.tsx`).

### Design system and responsive layout

Every screen must work from a 360px phone to a wide desktop without sideways scrolling.

- **Tokens**: colours, radii, shadows and sizes are CSS variables on `:root` in `globals.css`
  (`--brand`, `--surface`, `--border`, `--muted`, `--ok`/`--bad`/`--warn`, …), with dark-theme
  overrides. Use the tokens; never hard-code colours. Shared classes: `.btn` (`.btn-primary`,
  `.btn-danger`), `.input`/`.select`/`.textarea`, `.field`, `.form`, `.card`, `.alert-*`,
  `.badge-*`, `.stack`, `.row`, `.grid-2` (one column on phones). CSS modules hold anything
  page-specific.
- **Breakpoints**: below 1024px the sidebar becomes a drawer opened from the top bar
  (`shell-frame.tsx`: Esc/backdrop closes it, focus moves in and back, the closed drawer is
  `inert`). Below 640px, tables become cards and controls grow to 44px touch targets.
- **Tables**: always use `<DataTable columns rows rowKey label empty />`. Mark the title column
  `primary` and the buttons column `actions`; on phones each row becomes a card with the column
  headers as labels, so no column is ever hidden.
- **Editing inside a row**: use `<EditDialog title>` (native modal `<dialog>`; a bottom sheet on
  phones) instead of inline forms.
- **Filters**: `<form className="toolbar">`; it wraps, and stacks on phones.
- **Page headers and tabs**: `PageHeader` actions go full-width on phones; `ListTabs` scroll
  sideways instead of wrapping.

### Browser tests

`apps/web/e2e` holds Playwright tests that run every page at 390px (phone), 768px (tablet) and
1280px (desktop): no sideways scrolling, content starting right under the top bar, the drawer
and navigation, edit dialogs, and core flows (create a client and edit a contact, duplicate IMO,
sign out). Global setup creates a demo tenant (`owner@oceanic.test`) through the API, so the
database only needs the platform admin seed. CI runs them in the `browser` job.

```bash
# with the API and web running (e.g. npm run dev) and FLUX_ADMIN_* seeded:
npx playwright install chromium        # once (or set CHROME_PATH=/usr/bin/google-chrome)
E2E_BASE_URL=http://localhost:3000 \
E2E_OPERATOR_EMAIL=<FLUX_ADMIN_EMAIL> E2E_OPERATOR_PASSWORD=<FLUX_ADMIN_PASSWORD> \
  npm run test:browser -w @flux/web
```

Add every new page to `e2e/responsive.spec.ts`.

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
6. foreign keys and trigger checks run **outside** row-level security reasoning: an FK accepts a
   guessed ID from another tenant, and a trigger running as `flux_app` cannot see other tenants'
   rows. Use composite FKs with `tenant_id` where possible; a trigger that must verify other
   tenant-owned rows has to be `SECURITY DEFINER` with `SET search_path` (see
   `vessels_reference_scope`), or fail closed when it cannot see the row.

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

## Clients

Clients (module `clients`, permissions `client.view` / `client.manage`) follow section 4 of the
design pack: the client master is kept separate from its **addresses**, **contacts** and
**billing parties** (Billing Party Grid + Add). No Industry field; the pricing scheme waits for
Parts & Pricing.

- **Client ID** is generated per tenant: `CL-00001`, `CL-00002`, … (`formatClientCode`).
- At most one **primary contact** and one **default billing party** per client (partial unique
  indexes; setting a new one clears the old). An inactive billing party is never the default.
- Clients and billing parties are deactivated, never deleted (vessels and invoices will refer to
  them); addresses and contacts can be removed.
- Every change, including sub-records, is audited on the client's history.

## Vessels

Vessel master records (module `vessels`, `vessel.view` / `vessel.manage`) follow §5 and §14 of the
design pack. The vessel is independent of clients: client relationships and fleets attach to it
(M7), so one physical ship is never duplicated per client.

- **Vessel code** `VS-00001` per tenant (`nextSequence`, key `vessel`).
- **IMO number** is optional, validated with the IMO check digit (`normaliseImoNumber`), stored as
  7 digits and unique per tenant. A duplicate returns `409` with `details.existingVessel`, and the
  form links to that vessel instead of creating a copy.
- **Vessel type** and **classification society** are typed references to reference data:
  composite FKs `(id, list_key)` with the list key pinned by a CHECK, plus a `SECURITY DEFINER`
  trigger that rejects another tenant's items. New choices must be active and not hidden; a
  vessel keeps a value that is hidden later.
- Custom fields (entity `vessel`), deactivation instead of deletion, and a full audit trail.

## Vessel–client relationships and fleets

Design pack §14: one vessel master, linked to clients through `vessel_client_relationships`
(type from the `vessel-relationship-type` list, optional start date, active/ended). Fleets belong
to a client (`FL-00001`) and a vessel joins a fleet **through** its relationship with that client.

- A vessel can have several active client relationships; **at most one is primary** (partial
  unique index), and the same vessel–client–type link cannot be active twice.
- A vessel is in **at most one fleet per client** at a time (`fleet_vessels`, partial unique on
  `(client_id, vessel_id)` while not removed). Composite FKs pin a membership to a fleet _and_ a
  relationship of the same client, so cross-client assignments are impossible in the database.
- Relationships are ended, never deleted (end date ≥ start date, enforced by a CHECK); ending one
  removes the vessel from that client's fleet. Fleets with vessels cannot be deactivated.
- New vessels can be linked to a client and fleet in the same transaction (`relationship` in the
  create body), matching the Client and Fleet dropdowns on Create New Ship.
- Requires the Vessels and Clients modules; `vessel.manage` links, `fleet.manage` manages fleets.
  Changes are audited on the vessel, with the client and fleet as related records.

## Notifications and vessel overrides

Design pack §15: the **client's settings are the default**; a vessel stores only what is
different, in explicit override records. Overrides belong to a **vessel–client relationship**, so
a vessel managed by one client and owned by another can bill and notify each differently.

| Setting       | Client default                                     | Vessel override (per relationship)                                                                  | Effective value                                                      |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Billing       | The client's default billing party                 | One of the client's active billing parties (`vessel_billing_overrides`)                             | The chosen party while active, else the client default               |
| Contacts      | The client's contacts                              | Vessel-only contacts (`vessel_contacts`); client contacts hidden for the vessel                     | Client contacts not hidden **plus** vessel contacts (supplement)     |
| Notifications | One rule per event: on/off, contacts, extra emails | `vessel_notification_overrides`: on/off (null = as client) and/or own recipients (null = as client) | Override parts where set, else the client rule minus hidden contacts |

- Events are a code catalogue (`NOTIFICATION_EVENTS` in `@flux/shared`): sample received, report
  published, critical result, sample delayed. Keys are stored: add, never rename. M8 stores who
  receives what; delivery comes with the sample workflow.
- No data is copied from the client: a client changing its rule, default party or contacts flows
  through to every vessel that has not overridden that part.
- Composite FKs pin every override row to the relationship's client: a vessel cannot pick another
  client's billing party or contacts, even through direct SQL. An override that changes nothing is
  rejected by a CHECK; deleting a contact removes it from rules and overrides (cascade).
- Overrides of ended relationships are kept and shown read-only.
- `GET /relationships/:id/settings` returns client default, override and effective value (with
  its source) for each setting; the vessel's Billing, Contacts and Notifications tabs use it.
- Client rules need `client.manage`; vessel overrides `vessel.manage` (plus both modules). Every
  change is audited (client rules on the client; overrides on the vessel, related to the client).

## Laboratory master data

Design pack §7: **Category → Service Type → Kit (product) → Variant → Bottles**, owned by each
organisation (module Laboratory Setup; `lab-setup.view` / `lab-setup.manage`).

- **Categories** own their **service types** (Water → Ballast Water). A **kit** is used for one or
  more service types (many-to-many: one water kit can serve Potable and Grey Water).
- **Registration fields** belong to a service type and are entered **once per batch** (e.g. port
  of sampling) or **for each sample** (e.g. sampling point, date sampled). Types as custom fields
  (text, number, date, yes/no, dropdown) with required flag and order; key, type and scope never
  change. `POST /lab/service-types/:id/registration-check` validates values exactly as sample
  registration will (M11) and saves nothing; the service type's Preview tab uses it.
- **Bottle types** are a tenant-wide list. A kit lists its bottles with quantities; a **variant**
  (UV, Electrolysis, Ozone…) uses the kit's bottles unless it has its own list, which replaces
  them.
- Codes (`WATER`, `BW`, `BWK`, `PET-1000`) are upper-case and unique per organisation (variants:
  per kit). Records are **deactivated, never deleted**, so samples keep stable references;
  inactive items stay on existing kits but cannot be newly added.
- **FLUX starter catalogue**: `POST /lab/starter-catalogue` copies example categories, service
  types with fields, bottle types and kits into the organisation. Matching is by code, so
  importing again only adds what is missing and never overwrites edits.
- Every relation is a composite FK including `tenant_id`; all tables have RLS. Changes are
  audited on the category, service type, bottle type or kit.

## Receiving

Design pack §8, Bulk Receiving (module Sample Receiving; `receiving.view` / `receiving.receive`).
Receiving is a separate business event from registration.

- An **Airway Bill** (AWB) is the shipment: number (normalised: upper case, no spaces; unique per
  organisation), courier, origin, date received. It is **OPEN** while kits are received one by one
  and **CLOSED** when done; it can be reopened.
- Each **received kit** gets a system ID (`RK-000001`) and an optional **serial** printed on the
  kit, unique among kits that are not cancelled. The kit type (and variant, when the kit has
  variants) is required; **vessel, client and service type are optional** and can be completed
  until registration. A vessel fills in its primary client; a kit used for a single service type
  gets it automatically. A client must be linked to the chosen vessel.
- The kit's **condition on arrival** (OK, damaged, leaking, incomplete) and a note are recorded;
  flagged kits stay in the queue for the lab to decide.
- Kits are `PENDING_REGISTRATION` until registered (M11), or **cancelled** with a reason (never
  deleted; a cancelled kit frees its serial).
- The **registration queue** lists pending kits, vessel-linked and unlinked, with what is still
  missing; filters for link, service type, client, AWB, condition and search.
- `GET /receiving/options` gives the receiving form its kits, clients and vessels, so receiving
  staff need no client, vessel or lab-setup permissions.
- Composite tenant FKs (a variant must belong to the kit's product), RLS, and an audit trail on the
  kit that also shows in the AWB's, vessel's and client's history.

## Batch registration

Design pack §8/§16/§20 (module Sample Management; `sample.view` / `sample.register`). Kits are
selected in the registration queue and registered as a **batch** in one step.

- A batch has **one service type** (its registration form); its kits may come from different
  vessels and clients, and each sample keeps its own. **One kit becomes one sample.**
- The form asks the service type's batch fields once and its sample fields per kit, and lets the
  lab complete or change each kit's vessel and client. Every sample needs a **client**; a
  **vessel** is required only for service types marked _Vessel required_ (Lab setup → service
  type). All problems come back together, keyed `batch.<field>` / `samples.<n>.<field>`.
- IDs are per organisation and **year**: batch `B26-00001`, sample `S26-000001` (gapless
  sequences `batch:<year>` / `sample:<year>`).
- **Atomic and race-safe:** one transaction validates, claims each kit with a conditional update
  (`PENDING_REGISTRATION` → `REGISTERED`; a second user gets 409), creates the batch and samples,
  and audits. `samples.received_kit_id` is unique, and a deferred trigger refuses a sample whose kit
  is not registered.
- A new sample is `REGISTERED` (🔴 on the Sample Update scale; the colour is computed by
  `sampleColour()`, never stored). Testing, reports and publishing move it on in later
  milestones.
- Batch and sample values are stored as JSON by field key and shown with the service type's
  field definitions (keys never change).

### Receive & Register

The second workflow of design pack §8: a package is received **and** its kits registered together
(needs `receiving.receive` and `sample.register`). One form: the airway bill (new, or an open
one), the service type and batch details, then per kit its serial, kit/variant, vessel/client,
condition and sample fields. It reuses the receiving and registration services inside **one
transaction** (`createAirwayBillInTx`, `receiveKitInTx`, `registerInTx`): everything is checked
first — AWB, kit links, client/vessel rules, serials already in use or repeated, registration
values — and reported together (`samples.<n>.<field>`); nothing is saved unless all is valid. The
result is the same as receiving then registering: an AWB, received kits (now registered), a batch
and its samples, with the same audit entries.

## Testing and results

Design pack §8 Under Testing (module Sample Management; `sample.view` / `sample.test`).

- **Test parameters** are defined per service type (Lab setup → service type → Parameters):
  name, unit, type (number, text, pass/fail, choice), decimals, method, order, required. Key and
  type never change. The starter catalogue adds typical parameters (ballast water per IMO D-2,
  lube oil, fuel oil, potable and grey water); importing it again adds missing parameters to
  existing service types.
- **Limits** (numbers): caution and critical min/max bound the acceptable range. Results are
  flagged **Normal / Caution / Critical** when saved (a failed pass/fail is Critical); each sample
  shows its worst flag. Ranges are checked in the API and by a CHECK constraint (caution inside
  critical, min ≤ max, limits only on numbers).
- **Results** are one value per sample and parameter (`sample_results`; composite FKs pin the
  parameter to the sample's service type and tenant). Values are parsed and flagged by the shared
  `parseResultValue` / `flagFor`, so the browser preview and the API agree. A cleared value
  deletes the result.
- **States:** saving a result moves a sample `REGISTERED → UNDER_TESTING` (a batch can also be
  started explicitly); **Complete results** needs every required active parameter and moves it to
  `RESULTS_ENTERED`, locking the results until **reopened**. Every change is audited with
  before/after values.
- **Views:** _Under testing_ has the **Batch view** (open batches with progress → results grid)
  and the **Sample view** (open samples with status and worst flag); each sample page has a
  Results section.
- **CSV upload** ("uploading batch-view results"): download the batch template (`sample`, `kit`,
  `serial`, `vessel`, then parameter keys, pre-filled with current values), fill it in, upload.
  It is matched by sample ID and sent with `?dryRun=true`: the server saves inside a transaction,
  reads the result back and rolls back, so the preview shows exactly what saving would. Saving is
  all or nothing; errors come back as `samples.<n>.<parameter key>`.

## Files, lab reports and attachments

Design pack §8, §9, §20 (lab reports: module Reports, `report.view` / `report.upload`;
attachments: `sample.view` / `sample.test`).

- **Staged uploads** (`files`): `POST /files` (purpose, name, size) → `PUT /files/:id/content`
  with the raw bytes → the API checks the size (max 25 MB) and the **type from the content**
  (PDF, PNG, JPEG, CSV, Excel — reports must be PDF), stores a SHA-256 and marks the file READY →
  a feature attaches it (`FilesService.claim`: READY, right purpose, uploaded by this user, not
  attached yet). The database keeps metadata and the object key (`<tenant>/<file>`).
- **Storage** (`STORAGE_DRIVER`): `local` (folder `STORAGE_LOCAL_DIR`, default
  `apps/api/storage`; used by tests) or `s3` (any S3-compatible service: `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`;
  `S3_CREATE_BUCKET=true` creates the bucket at start-up, for local use). Docker Compose runs
  SeaweedFS's S3 gateway (`seaweedfs`, port 8333, credentials in `docker/seaweedfs-s3.json`, local
  only). Buckets stay private.
- **Downloads**: features issue a short-lived link (`GET …/download-link` after their permission
  check) to `/files/:id/download?expires=…&token=…`, an HMAC signature with `FILE_URL_SECRET`
  (required in production) valid for 5 minutes; files are sent as attachments with
  `nosniff`.
- **Lab reports** (`LR26-00001`): a PDF covering **one sample or several samples of one batch**
  whose results are complete; a sample is in one report (unique join row; composite FKs pin the
  samples to the report's batch). Uploading submits it for Admin review (M15) and turns its
  samples **yellow**; replacing the file adds a version (history kept). Once reported, a sample's
  results cannot be reopened and its attachments cannot change.
- **Attachments**: supporting files on a sample (printouts, photos, instrument exports) until it
  is in a report.

## Custom fields

Tenants add their own fields to records (Admin → Custom fields, `custom-field.manage`). Record
types are `CUSTOM_FIELD_ENTITIES` in `@flux/shared` (clients now; add vessels, samples, … there).

- Types: short text, long text, number, date, yes/no, dropdown (options). Each field has a label,
  help text, required flag, sort order and active flag.
- **Key and type never change** after creation, so stored values stay valid. Label, options,
  required and order can change; fields are deactivated, never deleted, and values are kept.
- Values are stored in the record's `custom_fields` JSON column and validated on the server by
  `validateCustomFieldValues` (shared, unit-tested): unknown or inactive fields are rejected;
  **required** is enforced on create and a required value can never be cleared (records created
  before a field became required are not blocked until someone edits that field).
- Value changes are audited under the field's label, with option labels for dropdowns.
- To support a new record type: add it to `CUSTOM_FIELD_ENTITIES`, add a `custom_fields JSONB`
  column, call `CustomFieldsService.resolveValues` in its create/update, and render
  `<CustomFieldInputs>` on its forms.

## Numbering

`nextSequence(tx, tenantId, key)` (`apps/api/src/database/sequences.ts`) returns the next number
of a per-tenant counter inside the caller's transaction. Concurrent creates get distinct numbers,
and a rolled-back transaction gives its number back, so codes have no gaps. Use it for every
human-readable code (clients now; vessels, batches and samples later) with its own `key`.

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

| Method and path                                                                                           | Access                                  | Purpose                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/auth/login`                                                                                 | Public                                  | Sign in; sets the session cookie                                                                            |
| `POST /api/v1/auth/logout`                                                                                | Public                                  | Revoke the session and clear the cookie                                                                     |
| `GET /api/v1/auth/me`                                                                                     | Signed in                               | Current user                                                                                                |
| `POST /api/v1/auth/change-password`                                                                       | Signed in                               | Change own password; ends other sessions                                                                    |
| `GET /api/v1/users`                                                                                       | `user.view`                             | List own tenant's users (`page`, `pageSize`, `q`, `status`)                                                 |
| `POST /api/v1/users`                                                                                      | `user.manage`                           | Create a user (optionally with `roleIds`)                                                                   |
| `GET /api/v1/users/:id`                                                                                   | `user.view`                             | Read user                                                                                                   |
| `PATCH /api/v1/users/:id`                                                                                 | `user.manage`                           | Update name, email or status                                                                                |
| `PUT /api/v1/users/:id/roles`                                                                             | `user.manage`                           | Replace the user's roles                                                                                    |
| `POST /api/v1/users/:id/reset-password`                                                                   | `user.manage`                           | Set a new password; ends their sessions                                                                     |
| `GET /api/v1/access/catalogue`                                                                            | `role.view`                             | Licensed modules, portals and permissions                                                                   |
| `GET /api/v1/roles`                                                                                       | `role.view`                             | List roles (`q`, `isActive`)                                                                                |
| `POST /api/v1/roles`                                                                                      | `role.manage`                           | Create role with portals, modules, permissions                                                              |
| `GET /api/v1/roles/:id`                                                                                   | `role.view`                             | Read role and its access                                                                                    |
| `PATCH /api/v1/roles/:id`                                                                                 | `role.manage`                           | Name, description, default portal, active                                                                   |
| `PUT /api/v1/roles/:id/portals`                                                                           | `role.manage`                           | Portal Access tab                                                                                           |
| `PUT /api/v1/roles/:id/modules`                                                                           | `role.manage`                           | Module Access tab                                                                                           |
| `PUT /api/v1/roles/:id/permissions`                                                                       | `role.manage`                           | Role Permissions tab                                                                                        |
| `POST /api/v1/roles/:id/clone`                                                                            | `role.manage`                           | Clone with copy options                                                                                     |
| `GET /api/v1/roles/:id/users`                                                                             | `role.view`                             | Assigned Users tab                                                                                          |
| `POST /api/v1/roles/:id/users`                                                                            | `user.manage`                           | Assign users                                                                                                |
| `DELETE /api/v1/roles/:id/users/:userId`                                                                  | `user.manage`                           | Unassign a user                                                                                             |
| `GET /api/v1/audit-logs`                                                                                  | `audit.view`                            | Audit log (`action`, `entityType`, `entityId`, `actorId`, `from`, `to`)                                     |
| `GET /api/v1/platform/tenants/:id/audit-logs`                                                             | Platform admin                          | Organisation-level history of a tenant                                                                      |
| `GET /api/v1/platform/modules`                                                                            | Platform admin                          | Module catalogue                                                                                            |
| `GET /api/v1/platform/tenants`                                                                            | Platform admin                          | List tenants (`q`, `status`)                                                                                |
| `POST /api/v1/platform/tenants`                                                                           | Platform admin                          | Create tenant + modules + first admin                                                                       |
| `GET /api/v1/platform/tenants/:id`                                                                        | Platform admin                          | Read tenant                                                                                                 |
| `PATCH /api/v1/platform/tenants/:id`                                                                      | Platform admin                          | Rename, suspend or reactivate                                                                               |
| `PUT /api/v1/platform/tenants/:id/modules`                                                                | Platform admin                          | Set licensed optional modules                                                                               |
| `GET /api/v1/platform/audit-logs`                                                                         | Platform admin                          | Platform-level audit entries                                                                                |
| `GET/POST /api/v1/platform/reference-data/:list`                                                          | Platform admin                          | List / add FLUX defaults                                                                                    |
| `PATCH /api/v1/platform/reference-data/:list/:id`                                                         | Platform admin                          | Edit / deactivate a FLUX default                                                                            |
| `GET /api/v1/reference-data`                                                                              | Signed in (tenant)                      | Lists available to the organisation                                                                         |
| `GET /api/v1/reference-data/:list`                                                                        | Signed in (tenant)                      | Items (`view=usable` default, or `all`)                                                                     |
| `POST /api/v1/reference-data/:list`                                                                       | `reference-data.manage`                 | Add an own item                                                                                             |
| `PATCH /api/v1/reference-data/:list/:id`                                                                  | `reference-data.manage`                 | Edit / deactivate an own item                                                                               |
| `PUT /api/v1/reference-data/:list/:id/visibility`                                                         | `reference-data.manage`                 | Hide or show a FLUX default                                                                                 |
| `GET /api/v1/clients`                                                                                     | `client.view`                           | List (`q`, `status`)                                                                                        |
| `POST /api/v1/clients`                                                                                    | `client.manage`                         | Create (Client ID generated; `customFields`)                                                                |
| `GET /api/v1/clients/:id`                                                                                 | `client.view`                           | Read with addresses, contacts, billing parties                                                              |
| `PATCH /api/v1/clients/:id`                                                                               | `client.manage`                         | Update, (de)activate, `customFields`                                                                        |
| `POST /api/v1/clients/:id/addresses`                                                                      | `client.manage`                         | Add address                                                                                                 |
| `PATCH/DELETE /api/v1/clients/:id/addresses/:addressId`                                                   | `client.manage`                         | Edit / remove address                                                                                       |
| `POST /api/v1/clients/:id/contacts`                                                                       | `client.manage`                         | Add contact                                                                                                 |
| `PATCH/DELETE /api/v1/clients/:id/contacts/:contactId`                                                    | `client.manage`                         | Edit / remove contact                                                                                       |
| `GET /api/v1/clients/:id/billing-parties`                                                                 | `client.view`                           | Billing Party Grid                                                                                          |
| `POST /api/v1/clients/:id/billing-parties`                                                                | `client.manage`                         | Billing Party Add                                                                                           |
| `PATCH /api/v1/clients/:id/billing-parties/:partyId`                                                      | `client.manage`                         | Edit, default, (de)activate                                                                                 |
| `GET /api/v1/vessels`                                                                                     | `vessel.view`                           | List (`q`: name, previous name, IMO, code; `status`; `vesselTypeId`)                                        |
| `POST /api/v1/vessels`                                                                                    | `vessel.manage`                         | Create (code generated; IMO checked; `customFields`)                                                        |
| `GET /api/v1/vessels/:id`                                                                                 | `vessel.view`                           | Read with type and class society                                                                            |
| `PATCH /api/v1/vessels/:id`                                                                               | `vessel.manage`                         | Update, (de)activate                                                                                        |
| `GET/POST /api/v1/vessels/:id/relationships`                                                              | `vessel.view` / `vessel.manage`         | List (`status`) / link a client                                                                             |
| `PATCH /api/v1/relationships/:id`                                                                         | `vessel.manage`                         | Primary flag, start date                                                                                    |
| `POST /api/v1/relationships/:id/end`                                                                      | `vessel.manage`                         | End (`endDate`, default today)                                                                              |
| `PUT /api/v1/relationships/:id/fleet`                                                                     | `fleet.manage`                          | Put in / move between / remove from the client’s fleets                                                     |
| `GET /api/v1/clients/:id/notification-rules`                                                              | `client.view`                           | The client's rule per notification event                                                                    |
| `PUT /api/v1/clients/:id/notification-rules/:event`                                                       | `client.manage`                         | Set on/off, contacts and extra emails for one event                                                         |
| `GET /api/v1/relationships/:id/settings`                                                                  | `vessel.view`                           | Resolved billing, contacts and notifications for one vessel–client link                                     |
| `PUT /api/v1/relationships/:id/billing`                                                                   | `vessel.manage`                         | Choose a client billing party for the vessel (`null` = client default)                                      |
| `POST /api/v1/relationships/:id/contacts`, `PATCH`/`DELETE /api/v1/vessel-contacts/:id`                   | `vessel.manage`                         | Vessel-only contacts                                                                                        |
| `PUT /api/v1/relationships/:id/client-contacts/:contactId`                                                | `vessel.manage`                         | Hide/show a client contact for the vessel                                                                   |
| `PUT /api/v1/relationships/:id/notifications/:event`                                                      | `vessel.manage`                         | Notification override (both parts `null` removes it)                                                        |
| `GET/POST /api/v1/lab/categories`, `PATCH /api/v1/lab/categories/:id`                                     | `lab-setup.view` / `.manage`            | Categories                                                                                                  |
| `GET/POST /api/v1/lab/service-types`, `GET/PATCH /api/v1/lab/service-types/:id`                           | `lab-setup.view` / `.manage`            | Service types (`?view=active&categoryId=&q=`)                                                               |
| `POST /api/v1/lab/service-types/:id/fields`, `PATCH /api/v1/lab/registration-fields/:id`                  | `lab-setup.manage`                      | Registration fields                                                                                         |
| `POST /api/v1/lab/service-types/:id/registration-check`                                                   | `lab-setup.view`                        | Validate `{batch, samples[]}` values; saves nothing                                                         |
| `GET/POST /api/v1/lab/bottle-types`, `PATCH /api/v1/lab/bottle-types/:id`                                 | `lab-setup.view` / `.manage`            | Bottle types                                                                                                |
| `GET/POST /api/v1/lab/products`, `GET/PATCH /api/v1/lab/products/:id`                                     | `lab-setup.view` / `.manage`            | Kits (`?serviceTypeId=&q=`)                                                                                 |
| `PUT /api/v1/lab/products/:id/bottles`, `PUT /api/v1/lab/variants/:id/bottles`                            | `lab-setup.manage`                      | Bottle lines (`[]` on a variant = kit's bottles)                                                            |
| `POST /api/v1/lab/products/:id/variants`, `PATCH /api/v1/lab/variants/:id`                                | `lab-setup.manage`                      | Variants                                                                                                    |
| `POST /api/v1/lab/starter-catalogue`                                                                      | `lab-setup.manage`                      | Import the FLUX starter catalogue (idempotent)                                                              |
| `GET /api/v1/receiving/options`                                                                           | `receiving.view`                        | Kits (variants, service types), clients and vessels for the receiving form                                  |
| `GET/POST /api/v1/receiving/airway-bills`, `GET/PATCH /api/v1/receiving/airway-bills/:id`                 | `receiving.view` / `.receive`           | Airway bills (`?status=&q=`, paginated)                                                                     |
| `POST /api/v1/receiving/airway-bills/:id/close`, `/reopen`                                                | `receiving.receive`                     | Close or reopen an AWB                                                                                      |
| `POST /api/v1/receiving/airway-bills/:id/kits`                                                            | `receiving.receive`                     | Receive a kit (AWB must be open)                                                                            |
| `GET/PATCH /api/v1/receiving/kits/:id`, `POST /api/v1/receiving/kits/:id/cancel`                          | `receiving.view` / `.receive`           | Complete, correct or cancel a pending kit                                                                   |
| `GET /api/v1/receiving/registration-queue`                                                                | `receiving.view`                        | Pending kits; filters `link` (linked/unlinked), `serviceTypeId`, `clientId`, `airwayBillId`, `flagged`, `q` |
| `GET /api/v1/samples/registration-draft?kitIds=a,b`                                                       | `sample.register`                       | Chosen kits, service types they share (with fields), clients and vessels                                    |
| `POST /api/v1/samples/batches`                                                                            | `sample.register`                       | Register kits as a batch (one transaction; 409 if a kit was taken)                                          |
| `GET /api/v1/samples/receive-register-options`                                                            | `receiving.receive` + `sample.register` | Service types (with fields), kits, clients, vessels, open AWBs                                              |
| `POST /api/v1/samples/receive-and-register`                                                               | `receiving.receive` + `sample.register` | Receive & Register in one transaction                                                                       |
| `GET /api/v1/samples/batches`, `GET /api/v1/samples/batches/:id`                                          | `sample.view`                           | Batches (paginated) and one batch with samples                                                              |
| `GET /api/v1/samples`, `GET /api/v1/samples/:id`                                                          | `sample.view`                           | Samples (filters: `status`, `serviceTypeId`, `clientId`, `vesselId`, `batchId`, `q`)                        |
| `POST /api/v1/lab/service-types/:id/parameters`, `PATCH /api/v1/lab/parameters/:id`                       | `lab-setup.manage`                      | Test parameters                                                                                             |
| `GET/PUT /api/v1/samples/:id/results`                                                                     | `sample.view` / `sample.test`           | One sample's results (PUT: `{results: [{parameterId, value}]}`)                                             |
| `POST /api/v1/samples/:id/complete-results`, `/reopen-results`                                            | `sample.test`                           | Complete (lock) or reopen a sample's results                                                                |
| `GET/PUT /api/v1/samples/batches/:id/results`                                                             | `sample.view` / `sample.test`           | Batch grid; PUT `?dryRun=true` previews without saving                                                      |
| `POST /api/v1/samples/batches/:id/start-testing`, `/complete-results`                                     | `sample.test`                           | Start testing a batch; complete all its samples                                                             |
| `POST /api/v1/files`, `PUT /api/v1/files/:id/content`                                                     | Signed in (tenant)                      | Staged upload: intent, then raw bytes (checked type and size)                                               |
| `GET /api/v1/files/:id/download?expires=&token=`                                                          | Signed link                             | Download (links come from the features' `download-link` endpoints)                                          |
| `GET/POST /api/v1/lab-reports`, `GET /api/v1/lab-reports/:id`                                             | `report.view` / `report.upload`         | Lab reports (`?status=&batchId=&q=`)                                                                        |
| `POST /api/v1/lab-reports/:id/versions`                                                                   | `report.upload`                         | Replace the report file (new version)                                                                       |
| `GET /api/v1/lab-reports/:id/download-link`, `…/versions/:n/download-link`                                | `report.view`                           | Short-lived download links                                                                                  |
| `GET/POST /api/v1/samples/:id/attachments`, `DELETE …/:attachmentId`, `GET …/:attachmentId/download-link` | `sample.view` / `sample.test`           | Sample attachments                                                                                          |
| `GET /api/v1/clients/:id/vessels`                                                                         | `vessel.view`                           | Vessels linked to a client                                                                                  |
| `GET /api/v1/clients/:id/fleets`                                                                          | `vessel.view`                           | A client’s fleets with current vessels                                                                      |
| `POST /api/v1/fleets`, `PATCH /api/v1/fleets/:id`, `GET /api/v1/fleets/:id`                               | `fleet.manage` / `vessel.view`          | Fleets                                                                                                      |
| `GET /api/v1/custom-fields/entities`                                                                      | Signed in (tenant)                      | Record types available to the organisation                                                                  |
| `GET /api/v1/custom-fields?entity=client`                                                                 | Signed in (tenant)                      | Field definitions (`view=all` includes inactive)                                                            |
| `POST /api/v1/custom-fields`                                                                              | `custom-field.manage`                   | Define a field                                                                                              |
| `PATCH /api/v1/custom-fields/:id`                                                                         | `custom-field.manage`                   | Edit label, options, required, order, active                                                                |

## Database conventions

- UUID primary keys; human-readable business codes (client code, batch number) as separate
  `@unique` columns.
- Workflow states are Prisma enums, never free-text strings. Display colours (red/yellow/green)
  are computed from state and never stored.
- `snake_case` tables and columns via `@@map`/`@map`; camelCase in TypeScript.
- The seed is idempotent (upserts only).
