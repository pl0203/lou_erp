-- Synthetic rollback-only compatibility proof. This does not certify future gen2 cutover.
BEGIN;
SET LOCAL search_path='';
DO $$ BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 THEN RAISE EXCEPTION 'Fresh CO fixture required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=1 AND NOT tracking_ready)
 THEN RAISE EXCEPTION 'Generation one required'; END IF;
END $$;
-- Authored graph is independent of the production frozen history allowlist.
DO $graph$
DECLARE actual jsonb; expected jsonb:=$edges$[["private.co_stock_key_unit_declarations",["declared_by"],"public.users",["id"],"a","a","s",false,false,true],["private.co_stock_key_unit_declarations",["stock_key_id","customer_id"],"private.co_stock_keys",["id","customer_id"],"a","a","s",false,false,true],["private.co_stock_key_unit_declarations",["declared_by","request_id"],"private.co_commands",["actor_id","request_id"],"a","a","s",false,false,true],["private.co_evidence_manual_workbook_checks",["evidence_id"],"private.co_evidence",["id"],"a","a","s",false,false,true],["private.co_evidence_manual_workbook_checks",["verified_by"],"public.users",["id"],"a","a","s",false,false,true],["private.co_evidence_manual_workbook_checks",["evidence_id","customer_id"],"private.co_evidence",["id","customer_id"],"a","a","s",false,false,true],["private.co_import_manifests",["created_by"],"public.users",["id"],"a","a","s",false,false,true],["private.co_import_manifests",["draft_id","customer_id"],"private.co_drafts",["id","customer_id"],"a","a","s",false,false,true],["private.co_import_manifests",["evidence_id","draft_id","customer_id"],"private.co_evidence",["id","draft_id","customer_id"],"a","a","s",false,false,true],["private.co_import_manifests",["created_by","request_id"],"private.co_commands",["actor_id","request_id"],"a","a","s",false,false,true],["private.co_draft_import_origins",["import_id","draft_id","customer_id"],"private.co_import_manifests",["id","draft_id","customer_id"],"a","a","s",false,false,true],["private.co_import_prepare_results",["import_id"],"private.co_import_manifests",["id"],"a","a","s",false,false,true],["private.co_import_prepare_results",["actor_id","request_id"],"private.co_commands",["actor_id","request_id"],"a","a","s",false,false,true],["private.co_report_imports",["report_revision_id","report_head_id","customer_id"],"private.co_report_revisions",["id","head_id","customer_id"],"a","a","s",false,false,true],["private.co_report_imports",["import_id","customer_id"],"private.co_import_manifests",["id","customer_id"],"a","a","s",false,false,true],["private.co_import_return_coverage",["import_id","customer_id"],"private.co_import_manifests",["id","customer_id"],"a","a","s",false,false,true],["private.co_import_return_coverage",["return_line_id","return_revision_id","customer_id","stock_key_id","batch_id"],"private.co_return_revision_lines",["id","revision_id","customer_id","stock_key_id","batch_id"],"a","a","s",false,false,true],["private.co_import_selections",["draft_id","customer_id"],"private.co_drafts",["id","customer_id"],"a","a","s",false,false,true],["private.co_import_selections",["predecessor_id","draft_id","customer_id"],"private.co_import_selections",["id","draft_id","customer_id"],"a","a","s",false,false,true],["private.co_import_selections",["import_id","draft_id","customer_id"],"private.co_import_manifests",["id","draft_id","customer_id"],"a","a","s",false,false,true],["private.co_import_selections",["actor_id","request_id"],"private.co_commands",["actor_id","request_id"],"a","a","s",false,false,true],["private.co_import_post_requests",["import_id","customer_id"],"private.co_import_manifests",["id","customer_id"],"a","a","s",false,false,true],["private.co_import_post_requests",["actor_id","request_id"],"private.co_commands",["actor_id","request_id"],"a","a","s",true,true,true]]$edges$;
 names text[]:=ARRAY['private.co_draft_import_origins','private.co_evidence_manual_workbook_checks','private.co_import_manifests','private.co_import_post_requests','private.co_import_prepare_results','private.co_import_return_coverage','private.co_import_selections','private.co_report_imports','private.co_stock_key_unit_declarations'];
BEGIN
 SELECT jsonb_agg(x.edge ORDER BY x.edge::text) INTO actual FROM (
  SELECT jsonb_build_array(c.conrelid::regclass::text,
   ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY u(n,o) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.n ORDER BY u.o),
   c.confrelid::regclass::text,
   ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY u(n,o) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=u.n ORDER BY u.o),
   c.confdeltype::text,c.confupdtype::text,c.confmatchtype::text,c.condeferrable,c.condeferred,c.convalidated) edge
  FROM pg_catalog.pg_constraint c WHERE c.contype='f'
   AND (c.conrelid::regclass::text=ANY(names) OR c.confrelid::regclass::text=ANY(names))
 ) x;
 SELECT jsonb_agg(value ORDER BY value::text) INTO expected FROM jsonb_array_elements(expected);
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Exact 23-edge import graph mismatch'; END IF;
END $graph$;
-- Existing frozen history must refuse this unsupported future generation-two topology.
DO $$ DECLARE detail text; rejected boolean:=false; BEGIN
 BEGIN PERFORM private.catalog_history_foreign_keys_v1();
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
  rejected:=detail='CATALOG_TRACKING_INCOMPLETE';
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Unsupported future cutover falsely certified'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE rejected boolean:=false; BEGIN
 IF public.pilot_catalog_delete_access_v1() IS DISTINCT FROM jsonb_build_object('version',1,'actor_id',auth.uid(),'customer_delete',false,'product_delete',false)
 THEN RAISE EXCEPTION 'Generation-one guarded delete unexpectedly available'; END IF;
 BEGIN PERFORM public.pilot_catalog_transaction_v1(md5('workspace-history-guarded')::uuid,'delete_unused',
  jsonb_build_object('kind','product','id',md5('workspace-history-missing')::uuid,'expected_version','1'));
 EXCEPTION WHEN SQLSTATE '55000' THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Generation-one guarded delete must remain unavailable'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.products(id,name,sku) VALUES(md5('workspace-history-product')::uuid,'Synthetic history product','SYNTHETIC-HISTORY-PRODUCT');
INSERT INTO public.customers(id,name) VALUES(md5('workspace-history-customer')::uuid,'Synthetic history customer');
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; receipt jsonb; BEGIN
 FOREACH kind IN ARRAY ARRAY['product','customer'] LOOP
  receipt:=public.pilot_catalog_transaction_v1(md5('workspace-history-status-'||kind)::uuid,'set_enabled',
   jsonb_build_object('kind',kind,'id',md5('workspace-history-'||kind)::uuid,'expected_version','1','is_enabled',false));
  IF receipt->>'operation' IS DISTINCT FROM 'set_enabled' OR receipt->'after'->>'is_enabled' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'Generation-one lifecycle receipt missing'; END IF;
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer; BEGIN
 DELETE FROM public.products WHERE id=md5('workspace-history-product')::uuid;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Existing native product deletion failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.products WHERE id=md5('workspace-history-product')::uuid)
 OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=md5('workspace-history-customer')::uuid AND NOT is_enabled)
 OR NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=1 AND NOT tracking_ready)
 THEN RAISE EXCEPTION 'Generation-one compatibility state mismatch'; END IF;
END $$;
SELECT 'CO_WORKSPACE_CURRENT_HISTORY_PASSED';
ROLLBACK;
