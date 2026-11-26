-- M15: Admin review decisions on lab reports. Table is Prisma-generated; rules and RLS are
-- hand-written.

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('REJECTED', 'READY_TO_PUBLISH', 'REOPENED');

-- CreateTable
CREATE TABLE "lab_report_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "reviewer_id" UUID,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_report_reviews_report_id_decided_at_idx" ON "lab_report_reviews"("report_id", "decided_at");

-- AddForeignKey
ALTER TABLE "lab_report_reviews" ADD CONSTRAINT "lab_report_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_reviews" ADD CONSTRAINT "lab_report_reviews_report_id_tenant_id_fkey" FOREIGN KEY ("report_id", "tenant_id") REFERENCES "lab_reports"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_reviews" ADD CONSTRAINT "lab_report_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Rules ──────────────────────────────────────────────────────────────────

-- Rejecting and sending back need a written reason (design pack: the comment is preserved).
ALTER TABLE "lab_report_reviews" ADD CONSTRAINT "lab_report_reviews_comment_chk"
    CHECK ("decision" = 'READY_TO_PUBLISH' OR length(trim(coalesce("comment", ''))) > 0);
ALTER TABLE "lab_report_reviews" ADD CONSTRAINT "lab_report_reviews_version_chk" CHECK ("version" >= 1);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Review history is append-only for the application.

GRANT SELECT, INSERT ON "lab_report_reviews" TO flux_app;
ALTER TABLE "lab_report_reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lab_report_reviews"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
