-- One visible responsible person supplies field ownership and creation-time sales credit.
-- LOCAL CANDIDATE: hosted application requires the reviewed snapshot/counts and access approval.
-- Secondary sales-rep records remain intact but are no longer an ownership authority.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Serialize authority, PO creation, historical linkage and the one-time credit correction.
LOCK TABLE public.users IN SHARE MODE;
LOCK TABLE public.customer_manager_assignments IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.customer_sales_rep_assignments IN SHARE MODE;
LOCK TABLE public.purchase_orders,public.girard_orders IN ACCESS EXCLUSIVE MODE;
DO $preflight$ BEGIN
 IF auth.uid() IS NOT NULL OR current_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed database-owner migration required'; END IF;
 IF EXISTS(SELECT 1 FROM public.girard_orders WHERE po_id IS NOT NULL GROUP BY po_id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM public.girard_orders g JOIN public.purchase_orders p ON p.id=g.po_id WHERE p.customer_id<>g.customer_id)
 THEN RAISE EXCEPTION 'Ambiguous legacy PO linkage; review required, no rows changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.customer_manager_assignments GROUP BY customer_id HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Ambiguous responsible person; review required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.purchase_orders'::regclass AND tgname='demo_credit_immutable' AND tgenabled='O' AND tgfoid='private.demo_immutable_credit()'::regprocedure)
 THEN RAISE EXCEPTION 'Credit immutability trigger drift'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='demo_capture_credit') IS DISTINCT FROM '29e38a8cb7a0e053ebedd448961e29f5' THEN RAISE EXCEPTION 'Source drift: private.demo_capture_credit'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='pilot_insert_po') IS DISTINCT FROM '6d0d9985f94de35de893f19b4fdb6268' THEN RAISE EXCEPTION 'Source drift: private.pilot_insert_po'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='pilot_can_access_customer') IS DISTINCT FROM '99fcb3068345a21a38c85f7377e3e948' THEN RAISE EXCEPTION 'Source drift: private.pilot_can_access_customer'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='pilot_admin_sales_source_v1') IS DISTINCT FROM '37b7f95fc56f0bf03af7cb0a54ae4df3' THEN RAISE EXCEPTION 'Source drift: private.pilot_admin_sales_source_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='pilot_canonical_sales_source_v1') IS DISTINCT FROM '9f49e5a299cdf7b6347c3a89f48be379' THEN RAISE EXCEPTION 'Source drift: private.pilot_canonical_sales_source_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='pilot_admin_sales_start_v1') IS DISTINCT FROM '97698a7d6d063bfb96b6ec9e244c07ca' THEN RAISE EXCEPTION 'Source drift: private.pilot_admin_sales_start_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pilot_sales_report_months_v1') IS DISTINCT FROM 'c0afa767386540045aabe9dec8baee85' THEN RAISE EXCEPTION 'Source drift: public.pilot_sales_report_months_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pilot_manager_customers_v1') IS DISTINCT FROM '608ed8df2c5439c5565b75a83ac5c551' THEN RAISE EXCEPTION 'Source drift: public.pilot_manager_customers_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pilot_customer_performance_v1') IS DISTINCT FROM '8157031316eaf45176d2cdb255511b46' THEN RAISE EXCEPTION 'Source drift: public.pilot_customer_performance_v1'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
 ('private','demo_order_actor',true,'v',false),('private','demo_capture_credit',false,'v',false),('private','pilot_insert_po',false,'v',false),
 ('private','pilot_can_access_customer',true,'s',true),('private','pilot_admin_sales_source_v1',true,'s',true),
 ('private','pilot_canonical_sales_source_v1',false,'s',true),('private','pilot_admin_sales_start_v1',true,'s',true),
 ('public','pilot_sales_report_months_v1',false,'s',true),('public','pilot_manager_customers_v1',false,'s',true),
 ('public','pilot_customer_performance_v1',false,'s',true)) expected(schema_name,function_name,definer,volatility,client_execute)
 LEFT JOIN pg_namespace n ON n.nspname=expected.schema_name LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=expected.function_name
 WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef<>expected.definer OR p.provolatile<>expected.volatility::"char"
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR has_function_privilege('anon',p.oid,'EXECUTE')
 OR has_function_privilege('authenticated',p.oid,'EXECUTE')<>expected.client_execute)
 THEN RAISE EXCEPTION 'Existing function authority metadata drift'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.demo_order_actor()'::regprocedure) IS DISTINCT FROM '7e15767e5473ed47a9374ef30ff2a015' THEN RAISE EXCEPTION 'Source drift: private.demo_order_actor'; END IF;
END $preflight$;
CREATE TEMP TABLE store_owner_function_metadata ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname||'.'||p.proname IN ('private.demo_order_actor','private.demo_capture_credit','private.pilot_insert_po','private.pilot_can_access_customer',
 'private.pilot_admin_sales_source_v1','private.pilot_canonical_sales_source_v1','private.pilot_admin_sales_start_v1',
 'public.pilot_sales_report_months_v1','public.pilot_manager_customers_v1','public.pilot_customer_performance_v1');
CREATE TEMP TABLE store_owner_users_before ON COMMIT DROP AS SELECT id,to_jsonb(u) AS data FROM public.users u;
CREATE TEMP TABLE store_owner_assignments_before ON COMMIT DROP AS SELECT id,to_jsonb(a) AS data FROM public.customer_manager_assignments a;
CREATE TEMP TABLE store_owner_unchanged_po ON COMMIT DROP AS
 SELECT id,to_jsonb(p)-ARRAY['sales_person_id_at_creation','sales_assignment_source_id','sales_attributed_at','sales_attribution_state','updated_at'] AS data FROM public.purchase_orders p;
CREATE TEMP TABLE store_owner_details_before ON COMMIT DROP AS
 SELECT 'line'::text AS kind,id,to_jsonb(l) AS data FROM public.po_line_items l
 UNION ALL SELECT 'delivery',id,to_jsonb(d) FROM public.surat_jalan d
 UNION ALL SELECT 'delivery_line',id,to_jsonb(d) FROM public.sj_line_items d;
CREATE TEMP TABLE store_owner_secondary_before ON COMMIT DROP AS SELECT id,to_jsonb(a) AS data FROM public.customer_sales_rep_assignments a;
CREATE TEMP TABLE store_owner_legacy_before ON COMMIT DROP AS SELECT id,to_jsonb(g) AS data FROM public.girard_orders g;
CREATE TABLE private.pilot_store_credit_corrections_v1 (
 purchase_order_id uuid PRIMARY KEY, migration_key text NOT NULL CHECK(migration_key='unify_store_owner_credit_v1'),
 before_credit jsonb NOT NULL,after_credit jsonb NOT NULL,corrected_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE private.pilot_store_owner_audit_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL,changed_by uuid NOT NULL,
 before_assignment jsonb,after_assignment jsonb,changed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE private.pilot_store_credit_corrections_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.pilot_store_owner_audit_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pilot_store_credit_corrections_v1,private.pilot_store_owner_audit_v1 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER store_credit_audit_immutable BEFORE UPDATE OR DELETE ON private.pilot_store_credit_corrections_v1 FOR EACH ROW EXECUTE FUNCTION private.demo_immutable_evidence();
CREATE TRIGGER store_owner_audit_immutable BEFORE UPDATE OR DELETE ON private.pilot_store_owner_audit_v1 FOR EACH ROW EXECUTE FUNCTION private.demo_immutable_evidence();
ALTER TABLE public.customer_manager_assignments ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0), ALTER COLUMN manager_id DROP NOT NULL;
CREATE INDEX store_owner_manager_lookup_v1 ON public.customer_manager_assignments(manager_id,customer_id);

-- The existing column is retained to avoid a second source of truth or a second UI control.
COMMENT ON COLUMN public.customer_manager_assignments.manager_id IS 'Canonical responsible person: active salesperson or existing sales leadership role. Supervisor is resolved from users.manager_id, never copied here.';
CREATE FUNCTION private.pilot_store_owner_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.manager_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=NEW.manager_id AND u.is_active AND u.role IN('sales_person','sales_manager','sales_head','executive'))
 THEN RAISE EXCEPTION 'Active sales responsible person required' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN NEW.version:=OLD.version+1; ELSE NEW.version:=1; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.pilot_store_owner_guard_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER store_owner_guard_v1 BEFORE INSERT OR UPDATE ON public.customer_manager_assignments FOR EACH ROW EXECUTE FUNCTION private.pilot_store_owner_guard_v1();
REVOKE INSERT,UPDATE,DELETE ON public.customer_manager_assignments FROM authenticated;

CREATE FUNCTION public.pilot_assign_store_owner_v1(p_customer_id uuid,p_owner_id uuid,p_expected_assignment_id uuid,p_expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); previous public.customer_manager_assignments%ROWTYPE; next_row public.customer_manager_assignments%ROWTYPE;
BEGIN
 -- The same ordering as PO capture/visit writes prevents a mutable authority race.
 LOCK TABLE public.users IN SHARE MODE;
 IF actor IS NULL OR public.current_user_role() IS NULL OR public.current_user_role() NOT IN('sales_head','executive') THEN RAISE EXCEPTION 'Sales leadership assignment permission required' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.customer_manager_assignments IN SHARE ROW EXCLUSIVE MODE;
 IF p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Customer required' USING ERRCODE='22023'; END IF;
 IF (p_expected_assignment_id IS NULL)<>(p_expected_version IS NULL) OR p_expected_version<1 THEN RAISE EXCEPTION 'Complete expected assignment version required' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM public.customer_manager_assignments WHERE customer_id=p_customer_id FOR UPDATE;
 IF previous.id IS DISTINCT FROM p_expected_assignment_id OR previous.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Penanggung jawab berubah. Muat ulang sebelum menyimpan.' USING ERRCODE='40001'; END IF;
 IF p_owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_owner_id AND is_active AND role IN('sales_person','sales_manager','sales_head','executive')) THEN RAISE EXCEPTION 'Active sales responsible person required' USING ERRCODE='22023'; END IF;
 IF previous.manager_id IS NOT DISTINCT FROM p_owner_id THEN
  RETURN jsonb_build_object('customer_id',p_customer_id,'manager_id',previous.manager_id,'id',previous.id,'version',previous.version);
 END IF;
 IF p_owner_id IS NULL THEN
  -- Keep the row/version after clearing so empty -> assigned -> empty is not an ABA bypass.
  UPDATE public.customer_manager_assignments SET manager_id=NULL,assigned_by=actor,assigned_at=clock_timestamp() WHERE customer_id=p_customer_id RETURNING * INTO next_row;
 ELSIF previous.id IS NULL THEN
  INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by,assigned_at) VALUES(p_customer_id,p_owner_id,actor,clock_timestamp()) RETURNING * INTO next_row;
 ELSE
  UPDATE public.customer_manager_assignments SET manager_id=p_owner_id,assigned_by=actor,assigned_at=clock_timestamp() WHERE customer_id=p_customer_id RETURNING * INTO next_row;
 END IF;
 INSERT INTO private.pilot_store_owner_audit_v1(customer_id,changed_by,before_assignment,after_assignment)
 VALUES(p_customer_id,actor,CASE WHEN previous.id IS NOT NULL THEN to_jsonb(previous) END,CASE WHEN next_row.id IS NOT NULL THEN to_jsonb(next_row) END);
 RETURN jsonb_build_object('customer_id',p_customer_id,'manager_id',next_row.manager_id,'id',next_row.id,'version',next_row.version);
END $$;
REVOKE ALL ON FUNCTION public.pilot_assign_store_owner_v1(uuid,uuid,uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pilot_assign_store_owner_v1(uuid,uuid,uuid,bigint) TO authenticated;

CREATE FUNCTION private.pilot_store_in_manager_scope_v1(customer uuid,manager uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(auth.uid() IS NOT NULL AND public.current_user_role() IS NOT NULL
 AND (public.current_user_role() IN('po_admin','sales_head','executive') OR manager=auth.uid())
 AND EXISTS(SELECT 1 FROM public.customer_manager_assignments a JOIN public.users u ON u.id=a.manager_id
 WHERE a.customer_id=customer AND u.is_active AND (u.id=manager OR (u.role='sales_person' AND u.manager_id=manager))),false);
$$;
REVOKE ALL ON FUNCTION private.pilot_store_in_manager_scope_v1(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.pilot_store_in_manager_scope_v1(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION private.pilot_can_access_customer(customer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(public.current_user_role() IN ('po_admin','sales_head','executive')
 OR (public.current_user_role()='sales_manager' AND private.pilot_store_in_manager_scope_v1(customer,auth.uid()))
 OR (public.current_user_role()='sales_person' AND (
   EXISTS(SELECT 1 FROM public.customer_manager_assignments a WHERE a.customer_id=customer AND a.manager_id=auth.uid())
   OR EXISTS(SELECT 1 FROM public.sales_schedules s WHERE s.outlet_id=customer AND s.sales_person_id=auth.uid()))),false);
$$;
-- Keep restrictive policies and add only the matching owner/team read path.
CREATE POLICY store_owner_scoped_read_v1 ON public.customer_manager_assignments FOR SELECT TO authenticated USING(private.pilot_can_access_customer(customer_id));
CREATE POLICY store_owner_customer_read_v1 ON public.customers FOR SELECT TO authenticated USING(private.pilot_can_access_customer(id));

CREATE OR REPLACE FUNCTION private.demo_order_actor() RETURNS public.user_role LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role public.user_role;
BEGIN
 -- Acquire before the row lock: profile UPDATE takes ROW EXCLUSIVE before locking its row.
 LOCK TABLE public.users IN SHARE MODE;
 SELECT u.role INTO v_role FROM public.users u WHERE u.id=auth.uid() AND u.is_active FOR SHARE;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Active authenticated profile required' USING ERRCODE='42501'; END IF;
 RETURN v_role;
END $$;

CREATE OR REPLACE FUNCTION private.demo_capture_credit(customer uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE assignment record; credit jsonb;
BEGIN
 LOCK TABLE public.users IN SHARE MODE;
 LOCK TABLE public.customer_manager_assignments IN SHARE MODE;
 SELECT a.id,a.manager_id INTO assignment FROM public.customer_manager_assignments a
 JOIN public.users u ON u.id=a.manager_id WHERE a.customer_id=customer AND u.is_active AND u.role IN('sales_person','sales_manager','sales_head','executive');
 credit:=jsonb_build_object('sales_person_id_at_creation',assignment.manager_id,'sales_assignment_source_id',assignment.id);
 RETURN credit||jsonb_build_object('sales_attribution_state',CASE WHEN assignment.id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END,'sales_attributed_at',clock_timestamp());
END $$;

-- One-time correction under exclusive locks. No persistent bypass of snapshot immutability.
CREATE TEMP TABLE store_owner_credit_plan ON COMMIT DROP AS
 SELECT p.id,jsonb_build_object('sales_person_id_at_creation',p.sales_person_id_at_creation,'sales_assignment_source_id',p.sales_assignment_source_id,
 'sales_attributed_at',p.sales_attributed_at,'sales_attribution_state',p.sales_attribution_state) AS old_credit,
 private.demo_capture_credit(p.customer_id) AS new_credit FROM public.purchase_orders p;
INSERT INTO private.pilot_store_credit_corrections_v1(purchase_order_id,migration_key,before_credit,after_credit)
 SELECT id,'unify_store_owner_credit_v1',old_credit,new_credit FROM store_owner_credit_plan;
ALTER TABLE public.purchase_orders DISABLE TRIGGER demo_credit_immutable;
UPDATE public.purchase_orders p SET sales_person_id_at_creation=(c.new_credit->>'sales_person_id_at_creation')::uuid,
 sales_assignment_source_id=(c.new_credit->>'sales_assignment_source_id')::uuid,sales_attributed_at=(c.new_credit->>'sales_attributed_at')::timestamptz,
 sales_attribution_state=c.new_credit->>'sales_attribution_state' FROM store_owner_credit_plan c WHERE c.id=p.id;
ALTER TABLE public.purchase_orders ENABLE TRIGGER demo_credit_immutable;

-- Always capture the current owner, including approval of a pre-cutover pending order.
CREATE OR REPLACE FUNCTION private.pilot_insert_po(actor uuid,payload jsonb,items jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE po uuid; credit jsonb:=private.demo_capture_credit((payload->>'customer_id')::uuid);
BEGIN
 IF nullif(btrim(payload->>'po_number'),'') IS NULL THEN RAISE EXCEPTION 'PO number required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.purchase_orders(customer_id,created_by,po_number,status,order_date,expected_delivery_date,notes,
 sales_person_id_at_creation,sales_assignment_source_id,sales_attributed_at,sales_attribution_state)
 VALUES ((payload->>'customer_id')::uuid,actor,btrim(payload->>'po_number'),'confirm',coalesce((payload->>'order_date')::date,(clock_timestamp() AT TIME ZONE 'UTC')::date),(payload->>'expected_delivery_date')::date,nullif(payload->>'notes',''),
 (credit->>'sales_person_id_at_creation')::uuid,(credit->>'sales_assignment_source_id')::uuid,(credit->>'sales_attributed_at')::timestamptz,coalesce(credit->>'sales_attribution_state','legacy')) RETURNING id INTO po;
 INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,sku,quantity,unit_price)
 SELECT (x->>'id')::uuid,po,(x->>'product_id')::uuid,x->>'product_name',x->>'sku',(x->>'quantity')::integer,(x->>'unit_price')::numeric FROM jsonb_array_elements(items) x;
 RETURN po;
END $$;
-- A PO may have one legacy origin. Never multiply credit by joining duplicate lineage.
CREATE UNIQUE INDEX store_owner_one_legacy_po_v1 ON public.girard_orders(po_id) WHERE po_id IS NOT NULL;
CREATE OR REPLACE FUNCTION private.pilot_admin_sales_source_v1(p_from timestamptz,p_to timestamptz)
RETURNS TABLE(source_id uuid,customer_id uuid,sales_person_id uuid,created_at timestamptz,total_value numeric,revenue_eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role public.user_role:=public.current_user_role(); actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR v_role IS NULL OR v_role NOT IN('po_admin','sales_head','executive','sales_manager','sales_person') THEN RAISE EXCEPTION 'Active sales-report audience required' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN RAISE EXCEPTION 'Invalid canonical sales bounds' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT p.id,p.customer_id,p.sales_person_id_at_creation,coalesce(g.created_at,p.created_at),
 CASE WHEN g.id IS NULL THEN p.total_value ELSE g.total_value END,
 CASE WHEN g.id IS NULL THEN p.status IN('confirm','in_progress','complete') ELSE g.status='approved' END
 FROM public.purchase_orders p LEFT JOIN public.girard_orders g ON g.po_id=p.id
 WHERE p.sales_attribution_state IN('assigned','unassigned') AND coalesce(g.created_at,p.created_at) BETWEEN p_from AND p_to
 AND (v_role IN('po_admin','sales_head','executive') OR (p.sales_attribution_state='assigned' AND
 (p.sales_person_id_at_creation=actor OR (v_role='sales_manager' AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=p.sales_person_id_at_creation AND u.manager_id=actor)))));
END $$;
CREATE OR REPLACE FUNCTION private.pilot_canonical_sales_source_v1(p_from timestamptz,p_to timestamptz)
RETURNS TABLE(source_kind text,source_id uuid,customer_id uuid,sales_person_id uuid,created_at timestamptz,total_value numeric,revenue_eligible boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.pilot_read_guard_v1();
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN RAISE EXCEPTION 'Invalid canonical sales bounds' USING ERRCODE='22023'; END IF;
 -- Unconverted historical submissions retain their original actor and caller RLS.
 RETURN QUERY SELECT 'girard'::text,o.id,o.customer_id,o.submitted_by,o.created_at,o.total_value,o.status='approved'
 FROM public.girard_orders o WHERE o.po_id IS NULL AND o.created_at BETWEEN p_from AND p_to
 UNION ALL SELECT 'admin_po'::text,p.source_id,p.customer_id,p.sales_person_id,p.created_at,p.total_value,p.revenue_eligible
 FROM private.pilot_admin_sales_source_v1(p_from,p_to) p;
END $$;
CREATE OR REPLACE FUNCTION private.pilot_admin_sales_start_v1(p_manager_id uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result timestamptz;
BEGIN
 PERFORM private.pilot_performance_scope_v1(p_manager_id,'2000-01');
 SELECT min(p.created_at) INTO result FROM private.pilot_admin_sales_source_v1('0001-01-01T00:00:00Z','9999-12-31T23:59:59Z') p
 LEFT JOIN public.users u ON u.id=p.sales_person_id
 WHERE (p_manager_id IS NULL OR u.id=p_manager_id OR u.manager_id=p_manager_id)
 AND (p.sales_person_id IS NULL OR (u.is_active AND u.role IN('sales_person','sales_manager','sales_head','executive')));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_sales_report_months_v1(p_manager_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_performance_scope_v1(p_manager_id,'2000-01');
 WITH cohort AS MATERIALIZED (SELECT u.id FROM public.users u WHERE u.is_active
 AND u.role IN ('sales_person','sales_manager','sales_head','executive')
 AND (p_manager_id IS NULL OR u.id=p_manager_id OR u.manager_id=p_manager_id)),
 schedules AS (SELECT min(s.scheduled_date) AS first_date FROM public.sales_schedules s JOIN cohort c ON c.id=s.sales_person_id),
 legacy AS (SELECT min(o.created_at) AS first_at FROM public.girard_orders o JOIN cohort c ON c.id=o.submitted_by WHERE o.po_id IS NULL)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'earliest_schedule_date',s.first_date,
 'earliest_order_at',least(l.first_at,private.pilot_admin_sales_start_v1(p_manager_id))) INTO result FROM schedules s CROSS JOIN legacy l;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_manager_customers_v1(p_manager_id uuid,p_visit_from timestamptz,p_as_of timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size);
 IF p_manager_id IS NULL OR p_visit_from IS NULL OR p_as_of IS NULL OR NOT isfinite(p_visit_from) OR NOT isfinite(p_as_of) OR p_visit_from>p_as_of THEN RAISE EXCEPTION 'Invalid manager or visit bounds' USING ERRCODE='22023'; END IF;
 WITH cohort AS MATERIALIZED (SELECT c.id,c.name,c.address,c.city,c.last_visit_date,c.visit_frequency_days FROM public.customers c
  WHERE private.pilot_store_in_manager_scope_v1(c.id,p_manager_id)),
 visits AS (SELECT v.outlet_id,count(*) AS count FROM public.outlet_visits v JOIN cohort c ON c.id=v.outlet_id WHERE v.checked_in_at>=p_visit_from GROUP BY v.outlet_id),
 metrics_rows AS (SELECT c.*,coalesce(v.count,0) AS visits_this_period,ceil(30::numeric/c.visit_frequency_days)::bigint AS target_visits,
  coalesce(v.count,0)>=ceil(30::numeric/c.visit_frequency_days) AS on_track,
  c.last_visit_date IS NULL OR extract(epoch FROM (p_as_of-(c.last_visit_date::timestamp AT TIME ZONE 'UTC')))/86400>c.visit_frequency_days AS overdue
  FROM cohort c LEFT JOIN visits v ON v.outlet_id=c.id),
 rows AS MATERIALIZED (SELECT m.*,jsonb_build_object('id',id,'name',name,'address',address,'city',city,'last_visit_date',last_visit_date,
  'visit_frequency_days',visit_frequency_days,'visits_this_period',visits_this_period,'target_visits',target_visits,'on_track',on_track) AS data FROM metrics_rows m),
 page_rows AS (SELECT * FROM rows ORDER BY name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,'total',(SELECT count(*) FROM rows),
  'items',coalesce((SELECT jsonb_agg(data ORDER BY name,id) FROM page_rows),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object('on_track',count(*) FILTER(WHERE on_track),'overdue',count(*) FILTER(WHERE overdue),'total',count(*)) FROM rows)) INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.pilot_customer_performance_v1(p_manager_id uuid,p_year_month text,p_visit_from timestamptz,p_visit_until timestamptz,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; month_from date; month_until date;
BEGIN
 PERFORM private.pilot_read_page_guard_v1(p_page,p_page_size); PERFORM private.pilot_performance_scope_v1(p_manager_id,p_year_month);
 IF p_visit_from IS NULL OR p_visit_until IS NULL OR NOT isfinite(p_visit_from) OR NOT isfinite(p_visit_until) OR p_visit_from>=p_visit_until THEN RAISE EXCEPTION 'Invalid visit bounds' USING ERRCODE='22023'; END IF;
 month_from:=(p_year_month||'-01')::date; month_until:=(month_from+interval '1 month')::date;
 WITH cohort AS MATERIALIZED (SELECT c.id,c.name,c.visit_frequency_days FROM public.customers c
  WHERE p_manager_id IS NULL OR private.pilot_store_in_manager_scope_v1(c.id,p_manager_id)),
 visit_counts AS (SELECT v.outlet_id,count(*) FILTER(WHERE v.checked_in_at>=p_visit_from AND v.checked_in_at<p_visit_until) AS actual_visits,max(v.checked_in_at) AS last_visit_date FROM public.outlet_visits v JOIN cohort c ON c.id=v.outlet_id GROUP BY v.outlet_id),
 order_counts AS (SELECT p.customer_id,count(*) AS order_count FROM public.purchase_orders p JOIN cohort c ON c.id=p.customer_id WHERE p.order_date>=month_from AND p.order_date<month_until GROUP BY p.customer_id),
 delivery_values AS MATERIALIZED (SELECT d.surat_jalan_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value FROM public.sj_line_items d JOIN public.po_line_items l ON l.id=d.po_line_item_id GROUP BY d.surat_jalan_id),
 sales AS (SELECT p.customer_id,sum(d.value) AS value FROM public.purchase_orders p JOIN cohort c ON c.id=p.customer_id
  JOIN public.surat_jalan s ON s.purchase_order_id=p.id AND s.voided_at IS NULL AND s.sj_date>=month_from AND s.sj_date<month_until
  JOIN delivery_values d ON d.surat_jalan_id=s.id
  WHERE p.status IN ('in_progress','complete') GROUP BY p.customer_id),
 targets AS (SELECT DISTINCT ON(t.customer_id) t.customer_id,t.target_value FROM public.customer_targets t JOIN cohort c ON c.id=t.customer_id WHERE t.year_month<=p_year_month ORDER BY t.customer_id,t.year_month DESC,t.id),
 metrics_rows AS (SELECT c.id,c.name,CASE WHEN p_manager_id IS NULL THEN u.full_name ELSE NULL END AS manager_name,
  coalesce(v.actual_visits,0) AS actual_visits,ceil((month_until-month_from)::numeric/c.visit_frequency_days)::bigint AS target_visits,
  v.last_visit_date,coalesce(o.order_count,0) AS order_count,coalesce(s.value,0) AS total_sales,t.target_value AS sales_target
  FROM cohort c LEFT JOIN visit_counts v ON v.outlet_id=c.id LEFT JOIN order_counts o ON o.customer_id=c.id LEFT JOIN sales s ON s.customer_id=c.id
  LEFT JOIN targets t ON t.customer_id=c.id LEFT JOIN public.customer_manager_assignments a ON a.customer_id=c.id LEFT JOIN public.users u ON u.id=a.manager_id),
 rows AS MATERIALIZED (SELECT v.*,jsonb_build_object('id',id,'name',name,'manager_name',manager_name,'actual_visits',actual_visits,'target_visits',target_visits,
  'last_visit_date',last_visit_date,'order_count',order_count,'total_sales',total_sales::text,'sales_target',sales_target::text) AS data FROM metrics_rows v),
 page_rows AS (SELECT * FROM rows ORDER BY name,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT jsonb_build_object('version',1,'as_of',statement_timestamp(),'page',p_page,'page_size',p_page_size,
 'total',(SELECT count(*) FROM rows),'items',coalesce((SELECT jsonb_agg(data ORDER BY name,id) FROM page_rows),'[]'::jsonb),
 'summary',(SELECT jsonb_build_object('total_sales',coalesce(sum(total_sales),0)::text,'active_customers',count(*) FILTER(WHERE order_count>0),'total_customers',count(*),
  'total_visits',coalesce(sum(actual_visits),0),'total_target_visits',coalesce(sum(target_visits),0),
  'visit_percent',CASE WHEN sum(target_visits)>0 THEN round(100*sum(actual_visits)::numeric/sum(target_visits)) ELSE 0 END,
  'top_customer',(SELECT data FROM rows ORDER BY total_sales DESC,id LIMIT 1)) FROM rows)) INTO result;
 RETURN result;
END $$;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM store_owner_function_metadata b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM b.metadata)
 THEN RAISE EXCEPTION 'Existing function security/signature metadata changed'; END IF;
 IF EXISTS((SELECT * FROM store_owner_users_before EXCEPT SELECT id,to_jsonb(u) FROM public.users u)
 UNION ALL (SELECT id,to_jsonb(u) FROM public.users u EXCEPT SELECT * FROM store_owner_users_before))
 OR EXISTS((SELECT * FROM store_owner_assignments_before EXCEPT SELECT id,to_jsonb(a)-'version' FROM public.customer_manager_assignments a)
 UNION ALL (SELECT id,to_jsonb(a)-'version' FROM public.customer_manager_assignments a EXCEPT SELECT * FROM store_owner_assignments_before))
 THEN RAISE EXCEPTION 'User authority or current assignment data changed'; END IF;
 IF EXISTS((SELECT * FROM store_owner_unchanged_po EXCEPT SELECT id,to_jsonb(p)-ARRAY['sales_person_id_at_creation','sales_assignment_source_id','sales_attributed_at','sales_attribution_state','updated_at'] FROM public.purchase_orders p)
 UNION ALL (SELECT id,to_jsonb(p)-ARRAY['sales_person_id_at_creation','sales_assignment_source_id','sales_attributed_at','sales_attribution_state','updated_at'] FROM public.purchase_orders p EXCEPT SELECT * FROM store_owner_unchanged_po))
 THEN RAISE EXCEPTION 'PO business data changed; all changes rolled back'; END IF;
 IF EXISTS((SELECT * FROM store_owner_secondary_before EXCEPT SELECT id,to_jsonb(a) FROM public.customer_sales_rep_assignments a)
 UNION ALL (SELECT id,to_jsonb(a) FROM public.customer_sales_rep_assignments a EXCEPT SELECT * FROM store_owner_secondary_before))
 OR EXISTS((SELECT * FROM store_owner_legacy_before EXCEPT SELECT id,to_jsonb(g) FROM public.girard_orders g)
 UNION ALL (SELECT id,to_jsonb(g) FROM public.girard_orders g EXCEPT SELECT * FROM store_owner_legacy_before))
 THEN RAISE EXCEPTION 'Historical assignment/order records changed; all changes rolled back'; END IF;
 IF EXISTS((SELECT * FROM store_owner_details_before EXCEPT (SELECT 'line'::text,id,to_jsonb(l) FROM public.po_line_items l UNION ALL SELECT 'delivery',id,to_jsonb(d) FROM public.surat_jalan d UNION ALL SELECT 'delivery_line',id,to_jsonb(d) FROM public.sj_line_items d))
 UNION ALL ((SELECT 'line'::text,id,to_jsonb(l) FROM public.po_line_items l UNION ALL SELECT 'delivery',id,to_jsonb(d) FROM public.surat_jalan d UNION ALL SELECT 'delivery_line',id,to_jsonb(d) FROM public.sj_line_items d) EXCEPT SELECT * FROM store_owner_details_before))
 THEN RAISE EXCEPTION 'PO line or delivery evidence changed; all changes rolled back'; END IF;
 IF (SELECT count(*) FROM private.pilot_store_credit_corrections_v1)<>(SELECT count(*) FROM public.purchase_orders)
 OR EXISTS(SELECT 1 FROM public.purchase_orders p JOIN store_owner_credit_plan c ON c.id=p.id WHERE
 jsonb_build_object('sales_person_id_at_creation',p.sales_person_id_at_creation,'sales_assignment_source_id',p.sales_assignment_source_id,'sales_attributed_at',p.sales_attributed_at,'sales_attribution_state',p.sales_attribution_state) IS DISTINCT FROM c.new_credit)
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.purchase_orders'::regclass AND tgname='demo_credit_immutable' AND tgenabled='O' AND tgfoid='private.demo_immutable_credit()'::regprocedure)
 THEN RAISE EXCEPTION 'Credit correction or restored immutable guard verification failed'; END IF;
 IF has_table_privilege('authenticated','public.customer_manager_assignments','INSERT,UPDATE,DELETE')
 OR has_function_privilege('anon','public.pilot_assign_store_owner_v1(uuid,uuid,uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'Assignment ACL verification failed'; END IF;
END $postflight$;
NOTIFY pgrst,'reload schema';
COMMIT;
