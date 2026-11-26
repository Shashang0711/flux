-- M14: stored files, lab reports (versions, covered samples) and sample attachments. Tables are
-- Prisma-generated; rules and RLS are hand-written.

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('LAB_REPORT', 'RESULT_ATTACHMENT');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'READY');

-- CreateEnum
CREATE TYPE "LabReportStatus" AS ENUM ('SUBMITTED', 'REJECTED', 'READY_TO_PUBLISH');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content_type" TEXT,
    "sha256" TEXT,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "status" "LabReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "note" TEXT,
    "uploaded_by_id" UUID,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_samples" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "sample_id" UUID NOT NULL,

    CONSTRAINT "lab_report_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sample_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_tenant_id_status_idx" ON "files"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "files_id_tenant_id_key" ON "files"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "lab_reports_tenant_id_status_idx" ON "lab_reports"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "lab_reports_batch_id_idx" ON "lab_reports"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_tenant_id_code_key" ON "lab_reports"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_id_tenant_id_key" ON "lab_reports"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_id_batch_id_key" ON "lab_reports"("id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_report_versions_file_id_key" ON "lab_report_versions"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_report_versions_report_id_version_key" ON "lab_report_versions"("report_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "lab_report_samples_sample_id_key" ON "lab_report_samples"("sample_id");

-- CreateIndex
CREATE INDEX "lab_report_samples_report_id_idx" ON "lab_report_samples"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "sample_attachments_file_id_key" ON "sample_attachments"("file_id");

-- CreateIndex
CREATE INDEX "sample_attachments_sample_id_idx" ON "sample_attachments"("sample_id");

-- CreateIndex
CREATE UNIQUE INDEX "samples_id_batch_id_key" ON "samples"("id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "samples_id_tenant_id_key" ON "samples"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_batch_id_service_type_id_fkey" FOREIGN KEY ("batch_id", "service_type_id") REFERENCES "registration_batches"("id", "service_type_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_service_type_id_tenant_id_fkey" FOREIGN KEY ("service_type_id", "tenant_id") REFERENCES "service_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_versions" ADD CONSTRAINT "lab_report_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_versions" ADD CONSTRAINT "lab_report_versions_report_id_tenant_id_fkey" FOREIGN KEY ("report_id", "tenant_id") REFERENCES "lab_reports"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_versions" ADD CONSTRAINT "lab_report_versions_file_id_tenant_id_fkey" FOREIGN KEY ("file_id", "tenant_id") REFERENCES "files"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_samples" ADD CONSTRAINT "lab_report_samples_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_samples" ADD CONSTRAINT "lab_report_samples_report_id_batch_id_fkey" FOREIGN KEY ("report_id", "batch_id") REFERENCES "lab_reports"("id", "batch_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lab_report_samples" ADD CONSTRAINT "lab_report_samples_sample_id_batch_id_fkey" FOREIGN KEY ("sample_id", "batch_id") REFERENCES "samples"("id", "batch_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sample_attachments" ADD CONSTRAINT "sample_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_attachments" ADD CONSTRAINT "sample_attachments_sample_id_tenant_id_fkey" FOREIGN KEY ("sample_id", "tenant_id") REFERENCES "samples"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_attachments" ADD CONSTRAINT "sample_attachments_file_id_tenant_id_fkey" FOREIGN KEY ("file_id", "tenant_id") REFERENCES "files"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Rules ──────────────────────────────────────────────────────────────────

ALTER TABLE "files" ADD CONSTRAINT "files_size_chk" CHECK ("size" BETWEEN 1 AND 26214400);
ALTER TABLE "files" ADD CONSTRAINT "files_ready_chk"
    CHECK ("status" <> 'READY' OR ("content_type" IS NOT NULL AND "sha256" IS NOT NULL AND "uploaded_at" IS NOT NULL));
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_code_chk" CHECK ("code" ~ '^LR[0-9]{2}-[0-9]{5,}$');
ALTER TABLE "lab_report_versions" ADD CONSTRAINT "lab_report_versions_version_chk" CHECK ("version" >= 1);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Files, reports and versions are kept (history); attachments can be removed while the sample is
-- not yet in a report.

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['files', 'lab_reports', 'lab_report_versions', 'lab_report_samples'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO flux_app', t);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = app_current_tenant()) '
            'WITH CHECK ("tenant_id" = app_current_tenant())', t);
    END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON "sample_attachments" TO flux_app;
ALTER TABLE "sample_attachments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sample_attachments"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
