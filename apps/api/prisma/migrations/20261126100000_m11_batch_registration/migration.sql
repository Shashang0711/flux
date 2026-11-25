-- M11: batch registration (registration batches and samples; vessel-required flag on service
-- types). Tables are Prisma-generated; rules and RLS are hand-written.

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('REGISTERED', 'UNDER_TESTING', 'RESULTS_ENTERED');

-- AlterTable
ALTER TABLE "service_types" ADD COLUMN     "vessel_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "registration_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "service_type_id" UUID NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "samples" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "received_kit_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "vessel_id" UUID,
    "values" JSONB NOT NULL DEFAULT '{}',
    "status" "SampleStatus" NOT NULL DEFAULT 'REGISTERED',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registration_batches_tenant_id_registered_at_idx" ON "registration_batches"("tenant_id", "registered_at");

-- CreateIndex
CREATE UNIQUE INDEX "registration_batches_tenant_id_code_key" ON "registration_batches"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "registration_batches_id_tenant_id_key" ON "registration_batches"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_batches_id_service_type_id_key" ON "registration_batches"("id", "service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "samples_received_kit_id_key" ON "samples"("received_kit_id");

-- CreateIndex
CREATE INDEX "samples_batch_id_idx" ON "samples"("batch_id");

-- CreateIndex
CREATE INDEX "samples_tenant_id_status_idx" ON "samples"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "samples_client_id_idx" ON "samples"("client_id");

-- CreateIndex
CREATE INDEX "samples_vessel_id_idx" ON "samples"("vessel_id");

-- CreateIndex
CREATE UNIQUE INDEX "samples_tenant_id_code_key" ON "samples"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "registration_batches" ADD CONSTRAINT "registration_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_batches" ADD CONSTRAINT "registration_batches_service_type_id_tenant_id_fkey" FOREIGN KEY ("service_type_id", "tenant_id") REFERENCES "service_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_batches" ADD CONSTRAINT "registration_batches_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_batch_id_service_type_id_fkey" FOREIGN KEY ("batch_id", "service_type_id") REFERENCES "registration_batches"("id", "service_type_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_service_type_id_tenant_id_fkey" FOREIGN KEY ("service_type_id", "tenant_id") REFERENCES "service_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_received_kit_id_tenant_id_fkey" FOREIGN KEY ("received_kit_id", "tenant_id") REFERENCES "received_kits"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_vessel_id_tenant_id_fkey" FOREIGN KEY ("vessel_id", "tenant_id") REFERENCES "vessels"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Rules ──────────────────────────────────────────────────────────────────

ALTER TABLE "registration_batches" ADD CONSTRAINT "registration_batches_code_chk"
    CHECK ("code" ~ '^B[0-9]{2}-[0-9]{5,}$');
ALTER TABLE "samples" ADD CONSTRAINT "samples_code_chk" CHECK ("code" ~ '^S[0-9]{2}-[0-9]{6,}$');

-- A sample's kit must be registered (set in the same transaction that creates the sample).
CREATE FUNCTION samples_kit_registered() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM received_kits k
        WHERE k.id = NEW.received_kit_id AND k.tenant_id = NEW.tenant_id AND k.status = 'REGISTERED'
    ) THEN
        RAISE EXCEPTION 'Sample % refers to a kit that is not registered', NEW.code
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION samples_kit_registered() FROM PUBLIC;
-- Deferred: checked at commit, after the kit is marked registered in the same transaction.
CREATE CONSTRAINT TRIGGER samples_kit_registered
    AFTER INSERT ON "samples" DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION samples_kit_registered();

-- ─── Row-level security ─────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['registration_batches', 'samples'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO flux_app', t);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = app_current_tenant()) '
            'WITH CHECK ("tenant_id" = app_current_tenant())', t);
    END LOOP;
END
$$;
