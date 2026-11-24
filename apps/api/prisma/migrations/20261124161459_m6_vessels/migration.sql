-- M6: vessel master records with typed references to reference data.
-- Table is Prisma-generated; list pinning, the scope trigger and RLS are hand-written.

-- CreateEnum
CREATE TYPE "VesselStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "vessels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imo_number" TEXT,
    "previous_name" TEXT,
    "call_sign" TEXT,
    "vessel_type_id" UUID,
    "vessel_type_list" TEXT NOT NULL DEFAULT 'vessel-type',
    "classification_society_id" UUID,
    "classification_society_list" TEXT NOT NULL DEFAULT 'classification-society',
    "year_built" INTEGER,
    "gross_tonnage" INTEGER,
    "deadweight" INTEGER,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "status" "VesselStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vessels_tenant_id_name_idx" ON "vessels"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vessels_tenant_id_code_key" ON "vessels"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "vessels_tenant_id_imo_number_key" ON "vessels"("tenant_id", "imo_number");

-- CreateIndex
CREATE UNIQUE INDEX "vessels_id_tenant_id_key" ON "vessels"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_vessel_type_id_vessel_type_list_fkey" FOREIGN KEY ("vessel_type_id", "vessel_type_list") REFERENCES "reference_items"("id", "list_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_classification_society_id_classification_society_l_fkey" FOREIGN KEY ("classification_society_id", "classification_society_list") REFERENCES "reference_items"("id", "list_key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Typed references ───────────────────────────────────────────────────────
-- The list-key columns are constants, so the composite FKs (id, list_key) can only point at
-- items of the right list (a vessel type can never be a classification society).
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_vessel_type_list_chk"
    CHECK ("vessel_type_list" = 'vessel-type');
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_classification_society_list_chk"
    CHECK ("classification_society_list" = 'classification-society');
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_custom_fields_is_object"
    CHECK (jsonb_typeof("custom_fields") = 'object');

-- Foreign-key checks ignore row-level security, so also require referenced items to be FLUX
-- defaults or the vessel's own tenant's items (never another tenant's).
CREATE FUNCTION vessels_reference_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM reference_items r
        WHERE r.id IN (NEW.vessel_type_id, NEW.classification_society_id)
          AND r.tenant_id IS NOT NULL
          AND r.tenant_id <> NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'Vessel references reference data of another organisation'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER vessels_reference_scope
    BEFORE INSERT OR UPDATE OF vessel_type_id, classification_society_id, tenant_id ON "vessels"
    FOR EACH ROW EXECUTE FUNCTION vessels_reference_scope();

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Vessels are deactivated, never deleted (relationships, samples and reports will refer to them).

GRANT SELECT, INSERT, UPDATE ON "vessels" TO flux_app;
ALTER TABLE "vessels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vessels"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
