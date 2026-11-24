-- M5b: tenant-defined custom fields (definitions + JSON values on clients).

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "help_text" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_field_definitions_tenant_id_entity_idx" ON "custom_field_definitions"("tenant_id", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_tenant_id_entity_key_key" ON "custom_field_definitions"("tenant_id", "entity", "key");

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Values must always be a JSON object.
ALTER TABLE "clients" ADD CONSTRAINT "clients_custom_fields_is_object"
    CHECK (jsonb_typeof("custom_fields") = 'object');

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Definitions are deactivated, never deleted (stored values keep their meaning).

GRANT SELECT, INSERT, UPDATE ON "custom_field_definitions" TO flux_app;
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custom_field_definitions"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
