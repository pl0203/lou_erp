-- PROPOSED: local-tested pilot containment. Apply only after explicit deployment approval.
-- Preserves observed permissive policies except specific broad write policies below;
-- restrictive policies close bypasses without pretending existing RLS was absent.
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.users WHERE id = auth.uid() AND is_active;
$$;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

CREATE FUNCTION private.pilot_can_access_actor(actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE(public.current_user_role() IN ('po_admin','sales_head','executive')
 OR (public.current_user_role() IS NOT NULL AND actor=auth.uid())
 OR (public.current_user_role()='sales_manager' AND EXISTS (
   SELECT 1 FROM public.users u WHERE u.id=actor AND u.manager_id=auth.uid())),false);
$$;
CREATE FUNCTION private.pilot_can_access_customer(customer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE(public.current_user_role() IN ('po_admin','sales_head','executive')
 OR (public.current_user_role()='sales_manager' AND EXISTS (SELECT 1 FROM public.customer_manager_assignments a WHERE a.customer_id=customer AND a.manager_id=auth.uid()))
 OR (public.current_user_role()='sales_person' AND (
   EXISTS (SELECT 1 FROM public.customer_sales_rep_assignments a WHERE a.customer_id=customer AND a.sales_rep_id=auth.uid())
   OR EXISTS (SELECT 1 FROM public.sales_schedules s WHERE s.outlet_id=customer AND s.sales_person_id=auth.uid()))),false);
$$;
CREATE FUNCTION private.pilot_can_read_po(po uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE(public.current_user_role() IN ('po_admin','sales_head','executive')
 OR EXISTS (SELECT 1 FROM public.girard_orders o WHERE o.po_id=po AND private.pilot_can_access_actor(o.submitted_by))
 OR EXISTS (SELECT 1 FROM public.orders o WHERE o.purchase_order_id=po AND private.pilot_can_access_actor(o.sales_person_id)),false);
$$;
CREATE FUNCTION private.pilot_can_schedule(customer uuid, actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id=actor AND u.is_active AND (
 (public.current_user_role()='executive' AND u.role IN ('sales_person','sales_manager','sales_head','executive'))
 OR (public.current_user_role()='sales_head' AND u.role IN ('sales_person','sales_manager','sales_head'))
 OR (public.current_user_role()='sales_manager' AND (u.id=auth.uid() OR u.manager_id=auth.uid())
     AND u.role IN ('sales_person','sales_manager','sales_head','executive') AND private.pilot_can_access_customer(customer))));
$$;
REVOKE ALL ON FUNCTION private.pilot_can_access_actor(uuid), private.pilot_can_access_customer(uuid), private.pilot_can_read_po(uuid), private.pilot_can_schedule(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.pilot_can_access_actor(uuid), private.pilot_can_access_customer(uuid), private.pilot_can_read_po(uuid), private.pilot_can_schedule(uuid,uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customer_manager_assignments','customer_sales_rep_assignments','customer_targets','customers','girard_order_items','girard_orders','order_line_items','orders','outlet_visits','outlets','po_audit_log','po_line_items','products','promotions','purchase_orders','sales_schedules','sales_targets','sj_line_items','surat_jalan','users','visit_photos'] LOOP
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon',t);
   EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.%I FROM authenticated',t);
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY pilot_active_profile ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_role() IS NOT NULL) WITH CHECK (public.current_user_role() IS NOT NULL)',t);
 END LOOP;
END $$;

-- User identity/scope must never be writable by the user whose authority it controls.
CREATE FUNCTION private.pilot_guard_user_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- trusted service maintenance only; client RLS denies missing identity
 IF public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Active profile required' USING ERRCODE='42501'; END IF;
 IF ROW(NEW.id,NEW.email,NEW.created_at,NEW.invited_at) IS DISTINCT FROM ROW(OLD.id,OLD.email,OLD.created_at,OLD.invited_at) THEN
   RAISE EXCEPTION 'Identity metadata is immutable through profile updates' USING ERRCODE='42501';
 END IF;
 IF (OLD.id=auth.uid() OR public.current_user_role()<>'executive') AND
    ROW(NEW.role,NEW.manager_id,NEW.is_active) IS DISTINCT FROM ROW(OLD.role,OLD.manager_id,OLD.is_active) THEN
   RAISE EXCEPTION 'Only an executive may change another user authority' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pilot_guard_user_update BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION private.pilot_guard_user_update();
REVOKE ALL ON FUNCTION private.pilot_guard_user_update() FROM PUBLIC,anon,authenticated;

-- Only safe directory columns are directly exposed. Full profiles have bounded RPCs.
REVOKE SELECT ON public.users FROM authenticated;
GRANT SELECT(id,full_name,role,manager_id,is_active) ON public.users TO authenticated;
CREATE FUNCTION public.pilot_my_profile() RETURNS TABLE(id uuid,full_name text,email text,role public.user_role,is_active boolean,manager_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT u.id,u.full_name,u.email,u.role,u.is_active,u.manager_id FROM public.users u WHERE u.id=auth.uid() AND u.is_active;
$$;
CREATE FUNCTION public.pilot_list_users() RETURNS SETOF public.users
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF public.current_user_role() IS DISTINCT FROM 'executive'::public.user_role THEN RAISE EXCEPTION 'Executive role required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT u.* FROM public.users u ORDER BY u.full_name;
END $$;
REVOKE ALL ON FUNCTION public.pilot_my_profile(),public.pilot_list_users() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_my_profile(),public.pilot_list_users() TO authenticated;
CREATE POLICY pilot_user_visibility ON public.users AS RESTRICTIVE FOR SELECT TO authenticated USING (
 private.pilot_can_access_actor(id) OR (public.current_user_role()='sales_person' AND id=(SELECT p.manager_id FROM public.pilot_my_profile() p)));

-- Preserve UI contact cards only for scoped management roles; DOB never returned.
CREATE FUNCTION public.pilot_team_directory() RETURNS TABLE(id uuid,full_name text,email text,phone text,role public.user_role,manager_id uuid,is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF public.current_user_role() IS NULL OR public.current_user_role() NOT IN ('sales_manager','sales_head','executive') THEN RAISE EXCEPTION 'Management role required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT u.id,u.full_name,u.email,u.phone,u.role,u.manager_id,u.is_active FROM public.users u WHERE private.pilot_can_access_actor(u.id);
END $$;
REVOKE ALL ON FUNCTION public.pilot_team_directory() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_team_directory() TO authenticated;
-- No UI delete workflow exists for these identity/master/history rows.
REVOKE DELETE ON public.users,public.customers,public.outlets FROM authenticated;
-- Current UI does not write these legacy order tables; history remains scoped-readable.
REVOKE INSERT,UPDATE,DELETE ON public.orders,public.order_line_items FROM authenticated;

-- Constrain broad observed write policies to the current UI's role model.
ALTER POLICY promotions_write ON public.promotions USING (public.current_user_role() IN ('sales_head','executive')) WITH CHECK (public.current_user_role() IN ('sales_head','executive'));
ALTER POLICY customer_targets_write ON public.customer_targets USING (public.current_user_role() IN ('sales_head','executive')) WITH CHECK (public.current_user_role() IN ('sales_head','executive') AND set_by=auth.uid());
ALTER POLICY sales_targets_write ON public.sales_targets USING (public.current_user_role() IN ('sales_manager','sales_head','executive') AND private.pilot_can_access_actor(user_id)) WITH CHECK (public.current_user_role() IN ('sales_manager','sales_head','executive') AND private.pilot_can_access_actor(user_id) AND set_by=auth.uid());
-- Unused current UI table: preserve reads, disable client assignment mutation pending defined workflow.
REVOKE INSERT,UPDATE,DELETE ON public.customer_sales_rep_assignments FROM authenticated;
ALTER POLICY cma_head_all ON public.customer_manager_assignments USING (public.current_user_role() IN ('sales_head','executive')) WITH CHECK (public.current_user_role() IN ('sales_head','executive') AND assigned_by=auth.uid());
ALTER POLICY sched_manager_all ON public.sales_schedules USING (private.pilot_can_schedule(outlet_id,sales_person_id)) WITH CHECK (private.pilot_can_schedule(outlet_id,sales_person_id));

CREATE FUNCTION private.pilot_guard_actor_fields() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Record identity is immutable' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='promotions' THEN
   IF TG_OP='INSERT' AND NEW.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid creator' USING ERRCODE='42501'; END IF;
   IF TG_OP='UPDATE' AND ROW(NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Creator is immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='sales_schedules' THEN
   IF TG_OP='INSERT' AND NEW.assigned_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid assigner' USING ERRCODE='42501'; END IF;
   IF TG_OP='UPDATE' AND ROW(NEW.assigned_by,NEW.created_at,NEW.outlet_id) IS DISTINCT FROM ROW(OLD.assigned_by,OLD.created_at,OLD.outlet_id) THEN RAISE EXCEPTION 'Schedule origin is immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='sales_targets' THEN
   IF NEW.set_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid setter' USING ERRCODE='42501'; END IF;
   IF TG_OP='UPDATE' AND ROW(NEW.user_id,NEW.year_month,NEW.created_at) IS DISTINCT FROM ROW(OLD.user_id,OLD.year_month,OLD.created_at) THEN RAISE EXCEPTION 'Target scope is immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='customer_targets' THEN
   IF NEW.set_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid setter' USING ERRCODE='42501'; END IF;
   IF TG_OP='UPDATE' AND ROW(NEW.customer_id,NEW.year_month,NEW.created_at) IS DISTINCT FROM ROW(OLD.customer_id,OLD.year_month,OLD.created_at) THEN RAISE EXCEPTION 'Target scope is immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='customer_manager_assignments' THEN
   IF NEW.assigned_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid assigner' USING ERRCODE='42501'; END IF;
   IF TG_OP='UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'Assignment customer is immutable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.pilot_guard_actor_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER pilot_guard_actor_fields BEFORE INSERT OR UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION private.pilot_guard_actor_fields();
CREATE TRIGGER pilot_guard_actor_fields BEFORE INSERT OR UPDATE ON public.sales_schedules FOR EACH ROW EXECUTE FUNCTION private.pilot_guard_actor_fields();
CREATE TRIGGER pilot_guard_actor_fields BEFORE INSERT OR UPDATE ON public.sales_targets FOR EACH ROW EXECUTE FUNCTION private.pilot_guard_actor_fields();
CREATE TRIGGER pilot_guard_actor_fields BEFORE INSERT OR UPDATE ON public.customer_targets FOR EACH ROW EXECUTE FUNCTION private.pilot_guard_actor_fields();
CREATE TRIGGER pilot_guard_actor_fields BEFORE INSERT OR UPDATE ON public.customer_manager_assignments FOR EACH ROW EXECUTE FUNCTION private.pilot_guard_actor_fields();

-- Restrictive read policies apply even when an old permissive ALL policy remains.
CREATE POLICY pilot_customer_visibility ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_customer(id));
CREATE POLICY pilot_customer_visibility ON public.customer_manager_assignments AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_customer(customer_id));
CREATE POLICY pilot_customer_visibility ON public.customer_sales_rep_assignments AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_customer(customer_id));
CREATE POLICY pilot_customer_visibility ON public.customer_targets AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_customer(customer_id));
CREATE POLICY pilot_actor_visibility ON public.sales_targets AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_actor(user_id));
CREATE POLICY pilot_actor_visibility ON public.sales_schedules AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_actor(sales_person_id));
CREATE POLICY pilot_actor_visibility ON public.girard_orders AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_actor(submitted_by));
CREATE POLICY pilot_parent_visibility ON public.girard_order_items AS RESTRICTIVE FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.girard_orders o WHERE o.id=order_id));
CREATE POLICY pilot_actor_visibility ON public.outlet_visits AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_actor(sales_person_id));
CREATE POLICY pilot_parent_visibility ON public.visit_photos AS RESTRICTIVE FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.id=visit_id));
CREATE POLICY pilot_actor_visibility ON public.orders AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_access_actor(sales_person_id));
CREATE POLICY pilot_head_read ON public.orders FOR SELECT TO authenticated USING(public.current_user_role() IN ('sales_head','po_admin'));
CREATE POLICY pilot_parent_visibility ON public.order_line_items AS RESTRICTIVE FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id));
CREATE POLICY pilot_legacy_outlet_visibility ON public.outlets AS RESTRICTIVE FOR SELECT TO authenticated USING(public.current_user_role() IN ('po_admin','sales_head','executive') OR EXISTS(SELECT 1 FROM public.orders o WHERE o.outlet_id=outlets.id));
CREATE POLICY pilot_po_visibility ON public.purchase_orders AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_read_po(id));
CREATE POLICY pilot_po_visibility ON public.po_line_items AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_read_po(purchase_order_id));
CREATE POLICY pilot_po_visibility ON public.po_audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_read_po(purchase_order_id));
CREATE POLICY pilot_po_visibility ON public.surat_jalan AS RESTRICTIVE FOR SELECT TO authenticated USING(private.pilot_can_read_po(purchase_order_id));
CREATE POLICY pilot_parent_visibility ON public.sj_line_items AS RESTRICTIVE FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.surat_jalan sj WHERE sj.id=surat_jalan_id));
COMMIT;
