-- M16 (2/2): publishing lab reports and the notification outbox. Tables are Prisma-generated; rules
-- and RLS are hand-written.

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');



-- AlterTable
ALTER TABLE "lab_reports" ADD COLUMN     "final_file_id" UUID,
ADD COLUMN     "publish_note" TEXT,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_by_id" UUID;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "report_id" UUID NOT NULL,
    "client_name" TEXT NOT NULL,
    "vessel_name" TEXT,
    "sample_codes" TEXT[],
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "attachment_file_id" UUID,
    "skipped_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_report_id_idx" ON "notifications"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_id_tenant_id_key" ON "notifications"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_email_key" ON "notification_deliveries"("notification_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_final_file_id_key" ON "lab_reports"("final_file_id");

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_final_file_id_tenant_id_fkey" FOREIGN KEY ("final_file_id", "tenant_id") REFERENCES "files"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_report_id_tenant_id_fkey" FOREIGN KEY ("report_id", "tenant_id") REFERENCES "lab_reports"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attachment_file_id_tenant_id_fkey" FOREIGN KEY ("attachment_file_id", "tenant_id") REFERENCES "files"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_tenant_id_fkey" FOREIGN KEY ("notification_id", "tenant_id") REFERENCES "notifications"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Rules ──────────────────────────────────────────────────────────────────

-- A published report has its final file, time and publisher's note fields filled consistently.
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_published_chk"
    CHECK (("status" = 'PUBLISHED') = ("published_at" IS NOT NULL AND "final_file_id" IS NOT NULL));
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_sent_chk"
    CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL));
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempts_chk"
    CHECK ("attempts" >= 0);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Tenant users read notifications and can retry failed deliveries; the background worker
-- runs with system access and sends across tenants.

GRANT SELECT, INSERT ON "notifications" TO flux_app;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON "notification_deliveries" TO flux_app;
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_deliveries"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
