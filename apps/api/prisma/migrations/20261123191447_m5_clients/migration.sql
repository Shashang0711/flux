-- M5: clients (with addresses, contacts, billing parties) and per-tenant sequences.
-- Tables are Prisma-generated; single-primary/default rules and RLS are hand-written.

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('REGISTERED', 'BILLING', 'SHIPPING', 'OTHER');

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL,

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trading_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "tax_number" TEXT,
    "notes" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_addresses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_parties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "tax_number" TEXT,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_parties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_tenant_id_name_idx" ON "clients"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenant_id_code_key" ON "clients"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_id_tenant_id_key" ON "clients"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "client_addresses_client_id_idx" ON "client_addresses"("client_id");

-- CreateIndex
CREATE INDEX "client_addresses_tenant_id_idx" ON "client_addresses"("tenant_id");

-- CreateIndex
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts"("client_id");

-- CreateIndex
CREATE INDEX "client_contacts_tenant_id_idx" ON "client_contacts"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_parties_client_id_idx" ON "billing_parties"("client_id");

-- CreateIndex
CREATE INDEX "billing_parties_tenant_id_idx" ON "billing_parties"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_parties_id_tenant_id_key" ON "billing_parties"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_sequences" ADD CONSTRAINT "tenant_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_parties" ADD CONSTRAINT "billing_parties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_parties" ADD CONSTRAINT "billing_parties_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── One primary contact and one default billing party per client ───────────

CREATE UNIQUE INDEX "client_contacts_one_primary" ON "client_contacts" ("client_id") WHERE "is_primary";
CREATE UNIQUE INDEX "billing_parties_one_default" ON "billing_parties" ("client_id") WHERE "is_default";

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Clients and billing parties are never deleted (deactivate instead; vessels and invoices will
-- refer to them). Addresses and contacts may be removed.

GRANT SELECT, INSERT, UPDATE ON "tenant_sequences" TO flux_app;
ALTER TABLE "tenant_sequences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_sequences"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON "clients" TO flux_app;
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clients"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "client_addresses" TO flux_app;
ALTER TABLE "client_addresses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_addresses"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "client_contacts" TO flux_app;
ALTER TABLE "client_contacts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_contacts"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON "billing_parties" TO flux_app;
ALTER TABLE "billing_parties" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "billing_parties"
    USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
