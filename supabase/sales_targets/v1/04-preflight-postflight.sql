-- Read-only installation checks. Run before enabling the app or considering grants.
-- This draft intentionally makes NO grants and keeps capability disabled.
BEGIN;
SET LOCAL search_path='';
DO $$DECLARE item record; BEGIN
 IF (SELECT count(*) FROM private.sales_target_schema WHERE version=1 AND NOT enabled)<>1 THEN RAISE EXCEPTION 'Expected capability-off schema version 1'; END IF;
 FOR item IN SELECT c.oid::regclass object FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname LIKE 'sales_target_%' AND c.relkind IN('r','p') LOOP
  IF has_table_privilege('authenticated',item.object,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('anon',item.object,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected target table grants: %',item.object; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN('pilot_sales_dashboard_v3','pilot_sales_target_baseline_v1','pilot_sales_target_plan_v1','pilot_sales_target_command_v1','pilot_sales_target_reconcile_v1','pilot_sales_target_plans_v1','pilot_sales_targets_capability_v1')) AND
  (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'Unreviewed wrapper grant'; END IF;
END$$;
-- BEGIN CANONICAL SOURCE GUARD: exact d7 helper bodies and trigger metadata.
-- Read-only and fail closed: migration names/version columns alone prove nothing.
DO $$DECLARE source record; BEGIN
 FOR source IN SELECT * FROM (VALUES
 ('private.pilot_store_owner_guard_v1()','trigger','80a27148324cc5c69404c93ed80f968915ae07791de8d4faa497040eecf0681b'),
 ('private.demo_capture_credit(uuid)','jsonb','4d1f54a6f163d27485824c0de22c3841b247c2344598c15ae9eab31631b9ac7f'),
 ('private.demo_immutable_credit()','trigger','dac78da8d1f0f6acbf3aac9ccf4db87910057aaa205a188146992f9e8d11c479')
 ) s(signature,result_type,body_hash) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure(source.signature) AND l.lanname='plpgsql' AND p.prokind='f'
   AND p.prorettype=to_regtype(source.result_type) AND NOT p.prosecdef AND NOT p.proleakproof
   AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proretset
   AND p.proconfig=ARRAY['search_path=""'] AND p.proowner=(SELECT relowner FROM pg_class WHERE oid='public.customer_manager_assignments'::regclass)
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=source.body_hash
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE'))
  THEN RAISE EXCEPTION 'Canonical source helper drift: %',source.signature; END IF;
 END LOOP;
 FOR source IN SELECT * FROM (VALUES
 ('public.customer_manager_assignments','store_owner_guard_v1','private.pilot_store_owner_guard_v1()',23),
 ('public.purchase_orders','demo_credit_immutable','private.demo_immutable_credit()',19)
 ) s(relation,trigger_name,signature,trigger_type) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(source.relation) AND t.tgname=source.trigger_name
   AND t.tgfoid=to_regprocedure(source.signature) AND t.tgtype=source.trigger_type AND t.tgenabled='O'
   AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgconstraint=0
   AND t.tgnargs=0 AND t.tgattr=''::int2vector AND t.tgqual IS NULL)
  THEN RAISE EXCEPTION 'Canonical source trigger drift: %.%',source.relation,source.trigger_name; END IF;
 END LOOP;
END$$;
-- END CANONICAL SOURCE GUARD
-- Exact source fields are checked against repository contracts, not guessed aliases.
DO $$DECLARE source record; BEGIN
 FOR source IN SELECT * FROM (VALUES
 ('public.users','manager_id'),('public.users','is_active'),('public.customer_manager_assignments','version'),
 ('public.purchase_orders','sales_person_id_at_creation'),('public.purchase_orders','sales_attribution_state'),('public.purchase_orders','order_date'),
 ('public.surat_jalan','voided_at'),('public.surat_jalan','sj_date'),('private.co_delivery_heads','current_revision_id'),
 ('private.co_delivery_revisions','is_void'),('private.co_delivery_revision_lines','batch_id'),('private.co_stock_batches','sales_person_id_at_creation'),
 ('private.co_report_heads','report_month'),('private.co_report_revisions','coverage_through_date'),('private.co_report_revisions','is_partial_month'),
 ('private.co_sale_allocations','generation_id'),('private.co_customer_state','effective_generation_id'),
 ('public.outlet_visits','schedule_id'),('public.visit_requests','requester_id'),('public.visit_requests','status')) s(relation,column_name) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(source.relation) AND a.attname=source.column_name AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Source contract drift: %.%',source.relation,source.column_name; END IF;
 END LOOP;
END$$;
COMMIT;
