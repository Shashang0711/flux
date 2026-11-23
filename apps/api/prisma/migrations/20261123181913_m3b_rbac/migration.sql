-- M3b: roles and permissions (RBAC).
-- Tables are Prisma-generated; data conversion, constraints and RLS are hand-written.

-- CreateEnum
CREATE TYPE "Portal" AS ENUM ('ADMIN', 'LAB', 'CLIENT', 'FINANCE');


-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_portal" "Portal" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_portals" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "portal" "Portal" NOT NULL,

    CONSTRAINT "role_portals_pkey" PRIMARY KEY ("role_id","portal")
);

-- CreateTable
CREATE TABLE "role_modules" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,

    CONSTRAINT "role_modules_pkey" PRIMARY KEY ("role_id","module_key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateIndex
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_id_tenant_id_key" ON "roles"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "role_portals_tenant_id_idx" ON "role_portals"("tenant_id");

-- CreateIndex
CREATE INDEX "role_modules_tenant_id_idx" ON "role_modules"("tenant_id");

-- CreateIndex
CREATE INDEX "role_permissions_tenant_id_idx" ON "role_permissions"("tenant_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_idx" ON "user_roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_tenant_id_key" ON "users"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_portals" ADD CONSTRAINT "role_portals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_portals" ADD CONSTRAINT "role_portals_role_id_tenant_id_fkey" FOREIGN KEY ("role_id", "tenant_id") REFERENCES "roles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_modules" ADD CONSTRAINT "role_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_modules" ADD CONSTRAINT "role_modules_role_id_tenant_id_fkey" FOREIGN KEY ("role_id", "tenant_id") REFERENCES "roles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_tenant_id_fkey" FOREIGN KEY ("role_id", "tenant_id") REFERENCES "roles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_tenant_id_fkey" FOREIGN KEY ("role_id", "tenant_id") REFERENCES "roles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Integrity rules Prisma cannot express ──────────────────────────────────

-- Role names are unique per tenant, ignoring case.
CREATE UNIQUE INDEX "roles_tenant_id_lower_name_key" ON "roles" ("tenant_id", lower("name"));
-- Exactly one built-in Administrator role per tenant (created below and on tenant creation).
CREATE UNIQUE INDEX "roles_one_system_role_per_tenant" ON "roles" ("tenant_id") WHERE "is_system";
-- The Administrator role can never be deactivated.
ALTER TABLE "roles" ADD CONSTRAINT "roles_system_role_active_chk" CHECK (NOT "is_system" OR "is_active");

-- ─── Data: replace the temporary is_tenant_admin flag ───────────────────────

INSERT INTO "roles" ("id", "tenant_id", "name", "description", "default_portal", "is_system", "updated_at")
SELECT gen_random_uuid(), t."id", 'Administrator',
       'Built-in role with full access to every module licensed to the organisation',
       'ADMIN', true, CURRENT_TIMESTAMP
FROM "tenants" t;

INSERT INTO "user_roles" ("tenant_id", "user_id", "role_id")
SELECT u."tenant_id", u."id", r."id"
FROM "users" u
JOIN "roles" r ON r."tenant_id" = u."tenant_id" AND r."is_system"
WHERE u."is_tenant_admin";

ALTER TABLE "users" DROP CONSTRAINT "users_platform_not_tenant_admin_chk";
ALTER TABLE "users" DROP COLUMN "is_tenant_admin";

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Same pattern as M3a: policy on tenant_id, explicit grants to flux_app.
-- Child tables are replaced wholesale by the app, hence DELETE; roles are never deleted
-- (deactivate instead), so roles get no DELETE. UPDATE on roles also allows SELECT … FOR UPDATE.

GRANT SELECT, INSERT, UPDATE ON "roles" TO flux_app;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roles"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, DELETE ON "role_portals" TO flux_app;
ALTER TABLE "role_portals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_portals"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, DELETE ON "role_modules" TO flux_app;
ALTER TABLE "role_modules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_modules"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, DELETE ON "role_permissions" TO flux_app;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_permissions"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, DELETE ON "user_roles" TO flux_app;
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_roles"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
