-- M4: hybrid reference data (FLUX defaults + tenant items) and platform-level audit entries.
-- Tables are Prisma-generated; uniqueness, the hide rule and RLS are hand-written.

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "reference_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "list_key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_item_hidden" (
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "hidden_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_item_hidden_pkey" PRIMARY KEY ("tenant_id","item_id")
);

-- CreateIndex
CREATE INDEX "reference_items_list_key_tenant_id_idx" ON "reference_items"("list_key", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reference_items_id_list_key_key" ON "reference_items"("id", "list_key");

-- AddForeignKey
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_item_hidden" ADD CONSTRAINT "reference_item_hidden_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_item_hidden" ADD CONSTRAINT "reference_item_hidden_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "reference_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Uniqueness: one code per list, per scope, ignoring case ────────────────

CREATE UNIQUE INDEX "reference_items_platform_code_key"
    ON "reference_items" ("list_key", lower("code")) WHERE "tenant_id" IS NULL;
CREATE UNIQUE INDEX "reference_items_tenant_code_key"
    ON "reference_items" ("tenant_id", "list_key", lower("code")) WHERE "tenant_id" IS NOT NULL;

-- ─── Only FLUX defaults can be hidden by a tenant ───────────────────────────

CREATE FUNCTION reference_item_hidden_only_platform() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM reference_items WHERE id = NEW.item_id AND tenant_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Only FLUX default reference items can be hidden'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER reference_item_hidden_only_platform
    BEFORE INSERT OR UPDATE ON "reference_item_hidden"
    FOR EACH ROW EXECUTE FUNCTION reference_item_hidden_only_platform();

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Tenants READ FLUX defaults (tenant_id IS NULL) and their own items, but can only WRITE their
-- own. FLUX defaults are written by platform admins through the owner connection.

GRANT SELECT, INSERT, UPDATE ON "reference_items" TO flux_app;
ALTER TABLE "reference_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_defaults_and_own ON "reference_items" FOR SELECT
    USING ("tenant_id" IS NULL OR "tenant_id" = app_current_tenant());
CREATE POLICY insert_own ON "reference_items" FOR INSERT
    WITH CHECK ("tenant_id" = app_current_tenant());
CREATE POLICY update_own ON "reference_items" FOR UPDATE
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, DELETE ON "reference_item_hidden" TO flux_app;
ALTER TABLE "reference_item_hidden" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reference_item_hidden"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

-- audit_logs: platform-level entries (tenant_id NULL) are invisible to tenants and cannot be
-- written by them: the existing policy compares tenant_id = app_current_tenant(), never NULL.
