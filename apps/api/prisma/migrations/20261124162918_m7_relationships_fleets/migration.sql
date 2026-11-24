-- M7: vessel–client relationships and client fleets.
-- Tables are Prisma-generated; business rules, the scope trigger and RLS are hand-written.

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "FleetStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "vessel_client_relationships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "relationship_type_id" UUID NOT NULL,
    "relationship_type_list" TEXT NOT NULL DEFAULT 'vessel-relationship-type',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_client_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FleetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_vessels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fleet_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "fleet_vessels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vessel_client_relationships_vessel_id_idx" ON "vessel_client_relationships"("vessel_id");

-- CreateIndex
CREATE INDEX "vessel_client_relationships_client_id_idx" ON "vessel_client_relationships"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_client_relationships_id_tenant_id_key" ON "vessel_client_relationships"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_client_relationships_id_vessel_id_client_id_key" ON "vessel_client_relationships"("id", "vessel_id", "client_id");

-- CreateIndex
CREATE INDEX "fleets_client_id_idx" ON "fleets"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleets_tenant_id_code_key" ON "fleets"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fleets_id_client_id_key" ON "fleets"("id", "client_id");

-- CreateIndex
CREATE INDEX "fleet_vessels_fleet_id_idx" ON "fleet_vessels"("fleet_id");

-- CreateIndex
CREATE INDEX "fleet_vessels_relationship_id_idx" ON "fleet_vessels"("relationship_id");

-- AddForeignKey
ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vessel_client_relationships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vessel_client_relationships_vessel_id_tenant_id_fkey" FOREIGN KEY ("vessel_id", "tenant_id") REFERENCES "vessels"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vessel_client_relationships_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vessel_client_relationships_relationship_type_id_relations_fkey" FOREIGN KEY ("relationship_type_id", "relationship_type_list") REFERENCES "reference_items"("id", "list_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vessels" ADD CONSTRAINT "fleet_vessels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vessels" ADD CONSTRAINT "fleet_vessels_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vessels" ADD CONSTRAINT "fleet_vessels_fleet_id_client_id_fkey" FOREIGN KEY ("fleet_id", "client_id") REFERENCES "fleets"("id", "client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fleet_vessels" ADD CONSTRAINT "fleet_vessels_relationship_id_vessel_id_client_id_fkey" FOREIGN KEY ("relationship_id", "vessel_id", "client_id") REFERENCES "vessel_client_relationships"("id", "vessel_id", "client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- ─── Relationship rules ─────────────────────────────────────────────────────

ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vcr_relationship_type_list_chk"
    CHECK ("relationship_type_list" = 'vessel-relationship-type');
ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vcr_dates_chk"
    CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vcr_ended_has_end_date_chk"
    CHECK ("status" <> 'ENDED' OR "end_date" IS NOT NULL);
ALTER TABLE "vessel_client_relationships" ADD CONSTRAINT "vcr_ended_not_primary_chk"
    CHECK ("status" <> 'ENDED' OR NOT "is_primary");

-- At most one active primary relationship per vessel.
CREATE UNIQUE INDEX "vcr_one_active_primary" ON "vessel_client_relationships" ("vessel_id")
    WHERE "is_primary" AND "status" = 'ACTIVE';
-- No duplicate active link of the same type between the same vessel and client.
CREATE UNIQUE INDEX "vcr_no_duplicate_active" ON "vessel_client_relationships"
    ("vessel_id", "client_id", "relationship_type_id") WHERE "status" = 'ACTIVE';

-- Relationship types must be FLUX defaults or this tenant's own items. SECURITY DEFINER so the
-- lookup sees every row (as flux_app, RLS would hide another tenant's item and let it pass).
CREATE FUNCTION vcr_reference_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM reference_items r
        WHERE r.id = NEW.relationship_type_id AND r.tenant_id IS NOT NULL AND r.tenant_id <> NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'Relationship references reference data of another organisation'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION vcr_reference_scope() FROM PUBLIC;
CREATE TRIGGER vcr_reference_scope
    BEFORE INSERT OR UPDATE OF relationship_type_id, tenant_id ON "vessel_client_relationships"
    FOR EACH ROW EXECUTE FUNCTION vcr_reference_scope();

-- ─── Fleet rules ────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "fleets_client_lower_name_key" ON "fleets" ("client_id", lower("name"));
-- A vessel is in at most one fleet per client at a time.
CREATE UNIQUE INDEX "fleet_vessels_one_active_per_client" ON "fleet_vessels" ("client_id", "vessel_id")
    WHERE "removed_at" IS NULL;

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Nothing here is deleted: relationships end, fleets deactivate, memberships get removed_at.

GRANT SELECT, INSERT, UPDATE ON "vessel_client_relationships" TO flux_app;
ALTER TABLE "vessel_client_relationships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vessel_client_relationships"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON "fleets" TO flux_app;
ALTER TABLE "fleets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fleets"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON "fleet_vessels" TO flux_app;
ALTER TABLE "fleet_vessels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fleet_vessels"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
