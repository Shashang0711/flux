-- Fix: vessels_reference_scope must see ALL reference items.
-- As SECURITY INVOKER it ran as flux_app, so row-level security hid other tenants' items from
-- its own lookup and a foreign item passed the check. Run it with the owner's rights instead,
-- with a fixed search_path so the function cannot be redirected.
ALTER FUNCTION vessels_reference_scope() SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION vessels_reference_scope() FROM PUBLIC;
