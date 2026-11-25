-- M9: laboratory master data (categories, service types, registration fields, bottle types, kits,
-- variants, bottle configurations). Tables are Prisma-generated; rules and RLS are hand-written.

-- CreateEnum
CREATE TYPE "RegistrationFieldScope" AS ENUM ('BATCH', 'SAMPLE');

-- CreateTable
CREATE TABLE "lab_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_type_fields" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "scope" "RegistrationFieldScope" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "help_text" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_type_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bottle_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "volume_ml" INTEGER NOT NULL,
    "material" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bottle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_service_types" (
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,

    CONSTRAINT "product_service_types_pkey" PRIMARY KEY ("product_id","service_type_id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_bottle_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "bottle_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "product_bottle_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_bottle_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "bottle_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "variant_bottle_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_categories_tenant_id_code_key" ON "lab_categories"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lab_categories_id_tenant_id_key" ON "lab_categories"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "service_types_category_id_idx" ON "service_types"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_types_tenant_id_code_key" ON "service_types"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "service_types_id_tenant_id_key" ON "service_types"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_type_fields_service_type_id_key_key" ON "service_type_fields"("service_type_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "bottle_types_tenant_id_code_key" ON "bottle_types"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bottle_types_id_tenant_id_key" ON "bottle_types"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_code_key" ON "products"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_tenant_id_key" ON "products"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "product_service_types_service_type_id_idx" ON "product_service_types"("service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_code_key" ON "product_variants"("product_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_tenant_id_key" ON "product_variants"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "product_bottle_configs_bottle_type_id_idx" ON "product_bottle_configs"("bottle_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_bottle_configs_product_id_bottle_type_id_key" ON "product_bottle_configs"("product_id", "bottle_type_id");

-- CreateIndex
CREATE INDEX "variant_bottle_configs_bottle_type_id_idx" ON "variant_bottle_configs"("bottle_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_bottle_configs_variant_id_bottle_type_id_key" ON "variant_bottle_configs"("variant_id", "bottle_type_id");

-- AddForeignKey
ALTER TABLE "lab_categories" ADD CONSTRAINT "lab_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_category_id_tenant_id_fkey" FOREIGN KEY ("category_id", "tenant_id") REFERENCES "lab_categories"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_fields" ADD CONSTRAINT "service_type_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_fields" ADD CONSTRAINT "service_type_fields_service_type_id_tenant_id_fkey" FOREIGN KEY ("service_type_id", "tenant_id") REFERENCES "service_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bottle_types" ADD CONSTRAINT "bottle_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_service_types" ADD CONSTRAINT "product_service_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_service_types" ADD CONSTRAINT "product_service_types_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_service_types" ADD CONSTRAINT "product_service_types_service_type_id_tenant_id_fkey" FOREIGN KEY ("service_type_id", "tenant_id") REFERENCES "service_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_bottle_configs" ADD CONSTRAINT "product_bottle_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_bottle_configs" ADD CONSTRAINT "product_bottle_configs_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_bottle_configs" ADD CONSTRAINT "product_bottle_configs_bottle_type_id_tenant_id_fkey" FOREIGN KEY ("bottle_type_id", "tenant_id") REFERENCES "bottle_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_bottle_configs" ADD CONSTRAINT "variant_bottle_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_bottle_configs" ADD CONSTRAINT "variant_bottle_configs_variant_id_tenant_id_fkey" FOREIGN KEY ("variant_id", "tenant_id") REFERENCES "product_variants"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_bottle_configs" ADD CONSTRAINT "variant_bottle_configs_bottle_type_id_tenant_id_fkey" FOREIGN KEY ("bottle_type_id", "tenant_id") REFERENCES "bottle_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Rules ──────────────────────────────────────────────────────────────────

-- Business codes are stored upper-case: "WATER", "BW-UV".
ALTER TABLE "lab_categories" ADD CONSTRAINT "lab_categories_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "bottle_types" ADD CONSTRAINT "bottle_types_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "products" ADD CONSTRAINT "products_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "service_type_fields" ADD CONSTRAINT "service_type_fields_key_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,49}$');

ALTER TABLE "bottle_types" ADD CONSTRAINT "bottle_types_volume_chk" CHECK ("volume_ml" BETWEEN 1 AND 100000);
ALTER TABLE "product_bottle_configs" ADD CONSTRAINT "product_bottle_configs_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 100);
ALTER TABLE "variant_bottle_configs" ADD CONSTRAINT "variant_bottle_configs_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 100);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Master records are deactivated, never deleted; only link and bottle-line rows can be deleted.

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'lab_categories', 'service_types', 'service_type_fields', 'bottle_types', 'products',
        'product_variants'
    ] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO flux_app', t);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = app_current_tenant()) '
            'WITH CHECK ("tenant_id" = app_current_tenant())', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['product_service_types', 'product_bottle_configs', 'variant_bottle_configs'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO flux_app', t);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = app_current_tenant()) '
            'WITH CHECK ("tenant_id" = app_current_tenant())', t);
    END LOOP;
END
$$;
