-- M10: receiving (airway bills and received kits). Tables are Prisma-generated; rules and RLS are
-- hand-written.

-- CreateEnum
CREATE TYPE "AirwayBillStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "KitCondition" AS ENUM ('OK', 'DAMAGED', 'LEAKING', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "ReceivedKitStatus" AS ENUM ('PENDING_REGISTRATION', 'REGISTERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "airway_bills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "courier" TEXT,
    "origin" TEXT,
    "received_on" DATE NOT NULL,
    "notes" TEXT,
    "status" "AirwayBillStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airway_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "received_kits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "airway_bill_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "serial_number" TEXT,
    "service_type_id" UUID,
    "client_id" UUID,
    "vessel_id" UUID,
    "condition" "KitCondition" NOT NULL DEFAULT 'OK',
    "condition_notes" TEXT,
    "status" "ReceivedKitStatus" NOT NULL DEFAULT 'PENDING_REGISTRATION',
    "cancel_reason" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "received_kits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "airway_bills_tenant_id_status_idx" ON "airway_bills"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "airway_bills_tenant_id_number_key" ON "airway_bills"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "airway_bills_id_tenant_id_key" ON "airway_bills"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "received_kits_tenant_id_status_idx" ON "received_kits"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "received_kits_airway_bill_id_idx" ON "received_kits"("airway_bill_id");

-- CreateIndex
CREATE INDEX "received_kits_vessel_id_idx" ON "received_kits"("vessel_id");

-- CreateIndex
CREATE INDEX "received_kits_client_id_idx" ON "received_kits"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "received_kits_tenant_id_code_key" ON "received_kits"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "received_kits_id_tenant_id_key" ON "received_kits"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_product_id_key" ON "product_variants"("id", "product_id");

-- AddForeignKey
ALTER TABLE "airway_bills" ADD CONSTRAINT "airway_bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_airway_bill_id_tenant_id_fkey" FOREIGN KEY ("airway_bill_id", "tenant_id") REFERENCES "airway_bills"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_service_type_id_tenant_id_fkey" FOREIGN KEY ("service_type_id", "tenant_id") REFERENCES "service_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_vessel_id_tenant_id_fkey" FOREIGN KEY ("vessel_id", "tenant_id") REFERENCES "vessels"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Rules ──────────────────────────────────────────────────────────────────

ALTER TABLE "airway_bills" ADD CONSTRAINT "airway_bills_number_chk" CHECK ("number" ~ '^[A-Z0-9-]{1,40}$');
ALTER TABLE "airway_bills" ADD CONSTRAINT "airway_bills_closed_chk"
    CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));
-- Cancelled kits carry their reason; others none.
ALTER TABLE "received_kits" ADD CONSTRAINT "received_kits_cancel_chk"
    CHECK (("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL));
-- A serial identifies one live kit per organisation; a cancelled kit frees its serial.
CREATE UNIQUE INDEX "received_kits_serial_live_key" ON "received_kits" ("tenant_id", "serial_number")
    WHERE "serial_number" IS NOT NULL AND "status" <> 'CANCELLED';

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Nothing is deleted: AWBs close, kits are registered or cancelled.

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['airway_bills', 'received_kits'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO flux_app', t);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = app_current_tenant()) '
            'WITH CHECK ("tenant_id" = app_current_tenant())', t);
    END LOOP;
END
$$;
