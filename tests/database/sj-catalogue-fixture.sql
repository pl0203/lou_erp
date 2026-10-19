-- Disposable synthetic-only installed-catalogue contract. No hosted data or writes.
-- The caller must already verify the final unpatched CO fixture server identity.
-- This file owns no transaction. Its assembly commits atomically with catalogue.
DO $guard$
BEGIN
 IF current_user <> 'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 -- Same private IPv4 envelope as the caller's coBindFixtureServer; Docker CI
 -- may report its bridge address rather than the loopback connection endpoint.
 OR inet_server_addr() IS NULL OR NOT (inet_server_addr() <<= '127.0.0.0/8'::cidr
  OR inet_server_addr() <<= '10.0.0.0/8'::cidr OR inet_server_addr() <<= '172.16.0.0/12'::cidr
  OR inet_server_addr() <<= '192.168.0.0/16'::cidr)
 OR (SELECT count(*) FROM public.pilot_fixture_marker) <> 1
 OR NOT EXISTS (SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR to_regclass('private.catalog_cutover_v1') IS NOT NULL
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure) <> '0b1e19441a499ae9c864b2d21aef28ba'
 THEN RAISE EXCEPTION 'Fresh unpatched disposable CO baseline required'; END IF;
END $guard$;

-- Finite native identity/policy differences already reviewed for the staged
-- catalogue installer. This is fixture preparation, never candidate rewriting.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
DROP POLICY fixture_read ON public.customers;
DROP POLICY fixture_write ON public.customers;
CREATE POLICY customers_read ON public.customers FOR SELECT TO public USING (auth.uid() IS NOT NULL);
CREATE POLICY customers_write ON public.customers FOR ALL TO public
 USING (public.current_user_role() = ANY (ARRAY['po_admin'::public.user_role, 'executive'::public.user_role]))
 WITH CHECK (public.current_user_role() = ANY (ARRAY['po_admin'::public.user_role, 'executive'::public.user_role]));
DROP POLICY fixture_read ON public.products;
DROP POLICY fixture_write ON public.products;
CREATE POLICY products_read ON public.products FOR SELECT TO public USING (auth.uid() IS NOT NULL);
CREATE POLICY products_write ON public.products FOR ALL TO public
 USING (public.current_user_role() = ANY (ARRAY['po_admin'::public.user_role, 'executive'::public.user_role]));
DROP POLICY fixture_read ON public.customer_targets;
CREATE POLICY customer_targets_read ON public.customer_targets FOR SELECT TO public USING(auth.uid() IS NOT NULL);
ALTER POLICY customer_targets_write ON public.customer_targets TO public;

-- Retained disposable master: catalogue race tests reuse it, never create/delete
-- a master identity whose required tombstone would invalidate exact cleanup.
INSERT INTO public.customers(id,name) VALUES(md5('sj-catalogue-race-parent')::uuid,'SJ catalogue reserved race parent');

-- SJ_NATIVE_AUDIT_FIXTURE
-- Native SJ auditing is deliberately NOT enhanced: its sj_updated text omits
-- the received date. Assert date-specific evidence from the request receipt.
CREATE OR REPLACE FUNCTION public.log_sj_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  actor uuid;
begin
  actor := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000');
  if TG_OP = 'INSERT' then
    insert into po_audit_log (purchase_order_id, changed_by, field_changed, old_value, new_value)
    values (new.purchase_order_id, actor, 'sj_created', null, 'SJ ' || new.sj_number || ' (' || new.sj_date::text || ')');
  elsif TG_OP = 'DELETE' then
    insert into po_audit_log (purchase_order_id, changed_by, field_changed, old_value, new_value)
    values (old.purchase_order_id, actor, 'sj_deleted', 'SJ ' || old.sj_number || ' (' || old.sj_date::text || ')', null);
  elsif TG_OP = 'UPDATE' then
    insert into po_audit_log (purchase_order_id, changed_by, field_changed, old_value, new_value)
    values (new.purchase_order_id, actor, 'sj_updated', 'SJ ' || old.sj_number || ' (' || old.sj_date::text || ')', 'SJ ' || new.sj_number || ' (' || new.sj_date::text || ')');
  end if;
  return coalesce(new, old);
end;
$function$
;
REVOKE ALL ON FUNCTION public.log_sj_changes() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.log_sj_changes() TO service_role;
ALTER TRIGGER fixture_log_sj ON public.surat_jalan RENAME TO trg_log_sj_changes;
