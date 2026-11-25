-- M13: test parameters and sample results. Tables are Prisma-generated; rules and RLS are
-- hand-written.

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('NUMBER', 'TEXT', 'PASS_FAIL', 'CHOICE');

-- CreateEnum
CREATE TYPE "ResultFlag" AS ENUM ('NORMAL', 'CAUTION', 'CRITICAL');

-- AlterTable
ALTER TABLE "samples" ADD COLUMN     "results_completed_at" TIMESTAMP(3),
ADD COLUMN     "testing_started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "test_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "type" "ParameterType" NOT NULL,
    "decimals" INTEGER,
    "method" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "caution_min" DOUBLE PRECISION,
    "caution_max" DOUBLE PRECISION,
    "critical_min" DOUBLE PRECISION,
    "critical_max" DOUBLE PRECISION,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sample_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "value_number" DOUBLE PRECISION,
    "value_text" TEXT,
    "value_boolean" BOOLEAN,
    "flag" "ResultFlag",
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entered_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sample_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_parameters_service_type_id_key_key" ON "test_parameters"("service_type_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "test_parameters_id_service_type_id_tenant_id_key" ON "test_parameters"("id", "service_type_id", "tenant_id");

-- CreateIndex
CREATE INDEX "sample_results_parameter_id_idx" ON "sample_results"("parameter_id");

-- CreateIndex
CREATE UNIQUE INDEX "sample_results_sample_id_parameter_id_key" ON "sample_results"("sample_id", "parameter_id");

-- CreateIndex
CREATE UNIQUE INDEX "samples_id_service_type_id_key" ON "samples"("id", "service_type_id");

-- AddForeignKey
ALTER TABLE "test_parameters" ADD CONSTRAINT "test_parameters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_parameters" ADD CONSTRAINT "test_parameters_service_type_id_tenant_id_fkey" FOREIGN KEY ("service_type_id", "tenant_id") REFERENCES "service_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_results" ADD CONSTRAINT "sample_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_results" ADD CONSTRAINT "sample_results_sample_id_service_type_id_fkey" FOREIGN KEY ("sample_id", "service_type_id") REFERENCES "samples"("id", "service_type_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sample_results" ADD CONSTRAINT "sample_results_parameter_id_service_type_id_tenant_id_fkey" FOREIGN KEY ("parameter_id", "service_type_id", "tenant_id") REFERENCES "test_parameters"("id", "service_type_id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sample_results" ADD CONSTRAINT "sample_results_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Rules ──────────────────────────────────────────────────────────────────

ALTER TABLE "test_parameters" ADD CONSTRAINT "test_parameters_key_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,49}$');
ALTER TABLE "test_parameters" ADD CONSTRAINT "test_parameters_decimals_chk"
    CHECK ("decimals" IS NULL OR "decimals" BETWEEN 0 AND 6);
-- Limits only on numbers; each range ordered; the caution range inside the critical range.
ALTER TABLE "test_parameters" ADD CONSTRAINT "test_parameters_limits_chk" CHECK (
    ("type" = 'NUMBER' OR ("caution_min" IS NULL AND "caution_max" IS NULL
                          AND "critical_min" IS NULL AND "critical_max" IS NULL))
    AND ("caution_min" IS NULL OR "caution_max" IS NULL OR "caution_min" <= "caution_max")
    AND ("critical_min" IS NULL OR "critical_max" IS NULL OR "critical_min" <= "critical_max")
    AND ("critical_min" IS NULL OR "caution_min" IS NULL OR "caution_min" >= "critical_min")
    AND ("critical_max" IS NULL OR "caution_max" IS NULL OR "caution_max" <= "critical_max")
);
-- Exactly one value column is set.
ALTER TABLE "sample_results" ADD CONSTRAINT "sample_results_one_value_chk" CHECK (
    (("value_number" IS NOT NULL)::int + ("value_text" IS NOT NULL)::int + ("value_boolean" IS NOT NULL)::int) = 1
);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Parameters are deactivated, never deleted; a result is deleted when its value is cleared.

GRANT SELECT, INSERT, UPDATE ON "test_parameters" TO flux_app;
ALTER TABLE "test_parameters" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "test_parameters"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "sample_results" TO flux_app;
ALTER TABLE "sample_results" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sample_results"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
