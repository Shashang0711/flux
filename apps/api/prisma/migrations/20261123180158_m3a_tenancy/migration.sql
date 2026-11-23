-- M3a: multi-tenancy foundation.
-- Hand-written (Prisma's draft would have dropped is_system_admin and lost data).

-- ─── Tenants ────────────────────────────────────────────────────────────────

CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

CREATE TABLE "tenant_modules" (
    "tenant_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("tenant_id", "module_key")
);
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Users: tenant membership ───────────────────────────────────────────────

-- M2's system admins become platform admins; the column is reused for the temporary
-- tenant-admin flag (replaced by roles in M3b).
ALTER TABLE "users" RENAME COLUMN "is_system_admin" TO "is_tenant_admin";
ALTER TABLE "users"
    ADD COLUMN "tenant_id" UUID,
    ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "is_platform_admin" = true, "is_tenant_admin" = false
WHERE "is_tenant_admin" = true;

-- Any other pre-existing users move into a default tenant.
INSERT INTO "tenants" ("id", "slug", "name", "updated_at")
SELECT gen_random_uuid(), 'default', 'Default organisation', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users" WHERE NOT "is_platform_admin");

UPDATE "users" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'default')
WHERE NOT "is_platform_admin";

-- Platform admins have no tenant; everyone else has exactly one.
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_xor_platform_chk"
    CHECK (("tenant_id" IS NULL) = "is_platform_admin");
ALTER TABLE "users" ADD CONSTRAINT "users_platform_not_tenant_admin_chk"
    CHECK (NOT ("is_platform_admin" AND "is_tenant_admin"));

CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Row-level security ─────────────────────────────────────────────────────
--
-- Tenant-scoped requests run inside a transaction that does
--   SET LOCAL ROLE flux_app;  SELECT set_config('app.tenant_id', '<uuid>', true);
-- flux_app is not a superuser or table owner, so the policies below always apply to it.
-- System code (login, session lookup, platform admin) uses the owning connection role,
-- which bypasses RLS. Without app.tenant_id set, flux_app sees no rows at all.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux_app') THEN
        CREATE ROLE flux_app NOLOGIN;
    END IF;
END
$$;
-- The connecting role must be a member of flux_app to SET ROLE to it.
GRANT flux_app TO CURRENT_USER;

CREATE FUNCTION app_current_tenant() RETURNS UUID
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA public TO flux_app;

-- tenants: a tenant can read only itself. Changes are platform-admin only.
GRANT SELECT ON "tenants" TO flux_app;
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants" USING ("id" = app_current_tenant());

-- tenant_modules: read-only to tenants. Licensing is platform-admin only.
GRANT SELECT ON "tenant_modules" TO flux_app;
ALTER TABLE "tenant_modules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_modules" USING ("tenant_id" = app_current_tenant());

-- users: full isolation; WITH CHECK stops writing a row into another tenant. No DELETE.
GRANT SELECT, INSERT, UPDATE ON "users" TO flux_app;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
    USING ("tenant_id" = app_current_tenant())
    WITH CHECK ("tenant_id" = app_current_tenant());

-- sessions: visible only for users of the current tenant (the subquery is itself
-- filtered by the users policy). Needed to revoke sessions when disabling a user.
GRANT SELECT, UPDATE ON "sessions" TO flux_app;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sessions"
    USING (EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "sessions"."user_id"));
