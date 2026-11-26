-- M18: client portal users. A user with client_id is a client portal user: they belong to that
-- client (same tenant, through the composite FK) and see only its records.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "client_id" UUID;

-- CreateIndex
CREATE INDEX "users_client_id_idx" ON "users"("client_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_tenant_id_fkey" FOREIGN KEY ("client_id", "tenant_id") REFERENCES "clients"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- The composite FK is not checked when tenant_id is NULL, so require a tenant explicitly.
ALTER TABLE "users" ADD CONSTRAINT "users_client_user_tenant_chk"
    CHECK ("client_id" IS NULL OR ("tenant_id" IS NOT NULL AND NOT "is_platform_admin"));

-- A user's client is fixed at creation: staff never become client users or the reverse.
CREATE FUNCTION users_client_fixed() RETURNS trigger
    LANGUAGE plpgsql SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        RAISE EXCEPTION 'A user''s client cannot change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION users_client_fixed() FROM PUBLIC;
CREATE TRIGGER users_client_fixed
    BEFORE UPDATE OF "client_id" ON "users"
    FOR EACH ROW EXECUTE FUNCTION users_client_fixed();

-- Client portal users have fixed access and never hold roles.
CREATE FUNCTION user_roles_staff_only() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.client_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Client portal users cannot be given roles' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION user_roles_staff_only() FROM PUBLIC;
CREATE TRIGGER user_roles_staff_only
    BEFORE INSERT OR UPDATE ON "user_roles"
    FOR EACH ROW EXECUTE FUNCTION user_roles_staff_only();
