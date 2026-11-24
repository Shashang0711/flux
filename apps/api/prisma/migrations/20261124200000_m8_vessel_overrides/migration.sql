-- M8: client notification rules and vessel-level overrides (billing party, contacts, notifications).
-- Tables are Prisma-generated; business rules and RLS are hand-written.

-- CreateTable
CREATE TABLE "client_notification_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "extra_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_notification_rule_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,

    CONSTRAINT "client_notification_rule_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_billing_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "billing_party_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_billing_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_hidden_client_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vessel_hidden_client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_notification_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "custom_recipients" BOOLEAN NOT NULL DEFAULT false,
    "extra_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_notification_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_notification_override_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "override_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,

    CONSTRAINT "vessel_notification_override_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_notification_override_vessel_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "override_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "vessel_contact_id" UUID NOT NULL,

    CONSTRAINT "vessel_notification_override_vessel_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_notification_rules_client_id_event_key" ON "client_notification_rules"("client_id", "event");

-- CreateIndex
CREATE UNIQUE INDEX "client_notification_rules_id_client_id_key" ON "client_notification_rules"("id", "client_id");

-- CreateIndex
CREATE INDEX "client_notification_rule_contacts_contact_id_idx" ON "client_notification_rule_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_notification_rule_contacts_rule_id_contact_id_key" ON "client_notification_rule_contacts"("rule_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_billing_overrides_relationship_id_key" ON "vessel_billing_overrides"("relationship_id");

-- CreateIndex
CREATE INDEX "vessel_billing_overrides_billing_party_id_idx" ON "vessel_billing_overrides"("billing_party_id");

-- CreateIndex
CREATE INDEX "vessel_contacts_relationship_id_idx" ON "vessel_contacts"("relationship_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_contacts_id_relationship_id_key" ON "vessel_contacts"("id", "relationship_id");

-- CreateIndex
CREATE INDEX "vessel_hidden_client_contacts_contact_id_idx" ON "vessel_hidden_client_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_hidden_client_contacts_relationship_id_contact_id_key" ON "vessel_hidden_client_contacts"("relationship_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_notification_overrides_relationship_id_event_key" ON "vessel_notification_overrides"("relationship_id", "event");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_notification_overrides_id_relationship_id_client_id_key" ON "vessel_notification_overrides"("id", "relationship_id", "client_id");

-- CreateIndex
CREATE INDEX "vessel_notification_override_contacts_contact_id_idx" ON "vessel_notification_override_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_notification_override_contacts_override_id_contact_i_key" ON "vessel_notification_override_contacts"("override_id", "contact_id");

-- CreateIndex
CREATE INDEX "vessel_notification_override_vessel_contacts_vessel_contact_idx" ON "vessel_notification_override_vessel_contacts"("vessel_contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_notification_override_vessel_contacts_override_id_ve_key" ON "vessel_notification_override_vessel_contacts"("override_id", "vessel_contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_parties_id_client_id_key" ON "billing_parties"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_contacts_id_client_id_key" ON "client_contacts"("id", "client_id");

-- AddForeignKey
ALTER TABLE "client_notification_rules" ADD CONSTRAINT "client_notification_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notification_rules" ADD CONSTRAINT "client_notification_rules_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notification_rule_contacts" ADD CONSTRAINT "client_notification_rule_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notification_rule_contacts" ADD CONSTRAINT "client_notification_rule_contacts_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notification_rule_contacts" ADD CONSTRAINT "client_notification_rule_contacts_rule_id_client_id_fkey" FOREIGN KEY ("rule_id", "client_id") REFERENCES "client_notification_rules"("id", "client_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_notification_rule_contacts" ADD CONSTRAINT "client_notification_rule_contacts_contact_id_client_id_fkey" FOREIGN KEY ("contact_id", "client_id") REFERENCES "client_contacts"("id", "client_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_billing_overrides" ADD CONSTRAINT "vessel_billing_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_billing_overrides" ADD CONSTRAINT "vessel_billing_overrides_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_billing_overrides" ADD CONSTRAINT "vessel_billing_overrides_relationship_id_vessel_id_client__fkey" FOREIGN KEY ("relationship_id", "vessel_id", "client_id") REFERENCES "vessel_client_relationships"("id", "vessel_id", "client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_billing_overrides" ADD CONSTRAINT "vessel_billing_overrides_billing_party_id_client_id_fkey" FOREIGN KEY ("billing_party_id", "client_id") REFERENCES "billing_parties"("id", "client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_contacts" ADD CONSTRAINT "vessel_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_contacts" ADD CONSTRAINT "vessel_contacts_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_contacts" ADD CONSTRAINT "vessel_contacts_relationship_id_vessel_id_client_id_fkey" FOREIGN KEY ("relationship_id", "vessel_id", "client_id") REFERENCES "vessel_client_relationships"("id", "vessel_id", "client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_hidden_client_contacts" ADD CONSTRAINT "vessel_hidden_client_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_hidden_client_contacts" ADD CONSTRAINT "vessel_hidden_client_contacts_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_hidden_client_contacts" ADD CONSTRAINT "vessel_hidden_client_contacts_relationship_id_vessel_id_cl_fkey" FOREIGN KEY ("relationship_id", "vessel_id", "client_id") REFERENCES "vessel_client_relationships"("id", "vessel_id", "client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_hidden_client_contacts" ADD CONSTRAINT "vessel_hidden_client_contacts_contact_id_client_id_fkey" FOREIGN KEY ("contact_id", "client_id") REFERENCES "client_contacts"("id", "client_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_notification_overrides" ADD CONSTRAINT "vessel_notification_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_notification_overrides" ADD CONSTRAINT "vessel_notification_overrides_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_notification_overrides" ADD CONSTRAINT "vessel_notification_overrides_relationship_id_vessel_id_cl_fkey" FOREIGN KEY ("relationship_id", "vessel_id", "client_id") REFERENCES "vessel_client_relationships"("id", "vessel_id", "client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_contacts" ADD CONSTRAINT "vessel_notification_override_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_contacts" ADD CONSTRAINT "vessel_notification_override_contacts_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_contacts" ADD CONSTRAINT "vessel_notification_override_contacts_override_id_relation_fkey" FOREIGN KEY ("override_id", "relationship_id", "client_id") REFERENCES "vessel_notification_overrides"("id", "relationship_id", "client_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_contacts" ADD CONSTRAINT "vessel_notification_override_contacts_contact_id_client_id_fkey" FOREIGN KEY ("contact_id", "client_id") REFERENCES "client_contacts"("id", "client_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_vessel_contacts" ADD CONSTRAINT "vessel_notification_override_vessel_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_vessel_contacts" ADD CONSTRAINT "vessel_notification_override_vessel_contacts_client_id_ten_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_vessel_contacts" ADD CONSTRAINT "vessel_notification_override_vessel_contacts_override_id_r_fkey" FOREIGN KEY ("override_id", "relationship_id", "client_id") REFERENCES "vessel_notification_overrides"("id", "relationship_id", "client_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vessel_notification_override_vessel_contacts" ADD CONSTRAINT "vessel_notification_override_vessel_contacts_vessel_contac_fkey" FOREIGN KEY ("vessel_contact_id", "relationship_id") REFERENCES "vessel_contacts"("id", "relationship_id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ─── Override rules ─────────────────────────────────────────────────────────

-- An override row must change something; extra emails only count with custom recipients.
ALTER TABLE "vessel_notification_overrides" ADD CONSTRAINT "vno_changes_something_chk"
    CHECK ("enabled" IS NOT NULL OR "custom_recipients");
ALTER TABLE "vessel_notification_overrides" ADD CONSTRAINT "vno_emails_need_custom_chk"
    CHECK ("custom_recipients" OR cardinality("extra_emails") = 0);
ALTER TABLE "client_notification_rules" ADD CONSTRAINT "cnr_emails_max_chk"
    CHECK (cardinality("extra_emails") <= 20);
ALTER TABLE "vessel_notification_overrides" ADD CONSTRAINT "vno_emails_max_chk"
    CHECK (cardinality("extra_emails") <= 20);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Overrides are configuration: removing one restores the client default, so DELETE is allowed.
-- Change history lives in the audit log.

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'client_notification_rules',
        'client_notification_rule_contacts',
        'vessel_billing_overrides',
        'vessel_contacts',
        'vessel_hidden_client_contacts',
        'vessel_notification_overrides',
        'vessel_notification_override_contacts',
        'vessel_notification_override_vessel_contacts'
    ] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO flux_app', t);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = app_current_tenant()) '
            'WITH CHECK ("tenant_id" = app_current_tenant())', t);
    END LOOP;
END
$$;
