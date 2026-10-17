SAVEPOINT guarded_delete_history_fixture;
-- Authored public-source fictional semantics. No connection/startup/installation.
-- Run in the composed owner's rollback-only transaction after new09/new10/new11.
-- Static Node success is NOT evidence these PostgreSQL assertions executed.
DO $history_dependency$ BEGIN
 IF current_user<>'postgres' OR to_regprocedure('private.catalog_assert_no_links_v1(text,uuid)') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_HISTORY_FIXTURE_MISSING' USING ERRCODE='PHH01';
 END IF;
END $history_dependency$;
CREATE FUNCTION pg_temp.history_domain_v1(p_kind text,p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE detail text;message text;
BEGIN
 PERFORM private.catalog_assert_no_links_v1(p_kind,p_id);RETURN 'NO_LINKS';
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL,message=MESSAGE_TEXT;
 PERFORM pg_temp.foundation_assert(SQLSTATE='23514' AND detail IN('CATALOG_DELETE_BLOCKED','CATALOG_TRACKING_INCOMPLETE') AND message IN('Catalogue deletion is blocked','Catalogue history cannot be certified'),'stable private domain envelope');
 RETURN detail;
END $fn$;
SAVEPOINT trusted_history_fixture;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) VALUES(md5('trusted-history-actor')::uuid);
INSERT INTO public.users(id,full_name,email,role,is_active)
 VALUES(md5('trusted-history-actor')::uuid,'Fictional history owner','history-owner@example.invalid','executive',true);
INSERT INTO public.customers(id,name,customer_category)
 VALUES(md5('trusted-history-customer')::uuid,'Fictional history customer','perorangan');
INSERT INTO public.products(id,name,sku) VALUES
 (md5('trusted-history-old-product')::uuid,'Fictional retired product','TRUSTED-HISTORY-OLD'),
 (md5('trusted-history-unrelated')::uuid,'Fictional unrelated product','TRUSTED-HISTORY-UNRELATED');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number)
 VALUES(md5('trusted-history-po')::uuid,md5('trusted-history-customer')::uuid,md5('trusted-history-actor')::uuid,'TRUSTED-HISTORY-PO');
INSERT INTO public.po_audit_log(id,purchase_order_id,changed_by,field_changed,old_value,new_value)
 VALUES(md5('trusted-history-audit')::uuid,md5('trusted-history-po')::uuid,md5('trusted-history-actor')::uuid,'po_items_revised',
 jsonb_build_array(jsonb_build_object('id',md5('trusted-history-removed-line')::uuid,'purchase_order_id',md5('trusted-history-po')::uuid,
  'product_id',md5('trusted-history-old-product')::uuid,'product_name','Fictional retired product','sku','TRUSTED-HISTORY-OLD','quantity',1,'unit_price',0,'line_total',0))::text,'[]');
SELECT pg_temp.foundation_assert(pg_temp.history_domain_v1('product',md5('trusted-history-old-product')::uuid)='CATALOG_DELETE_BLOCKED','OLD_ONLY_PO_ITEMS');
SELECT pg_temp.foundation_assert(pg_temp.history_domain_v1('product',md5('trusted-history-unrelated')::uuid)='NO_LINKS','UNRELATED_IDENTITY');
-- Both malformed and syntactically valid but unknown known-text grammar refuse.
DO $malformed$
DECLARE value text;
BEGIN
 FOREACH value IN ARRAY ARRAY['not json','null','{}','[{"product_id":"not-a-uuid"}]'] LOOP
  UPDATE public.po_audit_log SET old_value=value WHERE id=md5('trusted-history-audit')::uuid;
  PERFORM pg_temp.foundation_assert(pg_temp.history_domain_v1('product',md5('trusted-history-unrelated')::uuid)='CATALOG_TRACKING_INCOMPLETE','MALFORMED_KNOWN_TEXT');
 END LOOP;
END $malformed$;
ROLLBACK TO SAVEPOINT trusted_history_fixture;
RELEASE SAVEPOINT trusted_history_fixture;

-- Exact adapter validation cannot erase execution metadata before checking it.
DO $execution_version$
DECLARE row_data jsonb;failed boolean:=false;
BEGIN
 row_data:=jsonb_build_object('actor_id',md5('history-version-actor')::uuid,'request_id',md5('history-version-request')::uuid,
  'operation','recovery_abandoned','payload','{}'::jsonb,'result',NULL,'abandoned',true,'created_at','2026-10-14T00:00:00Z','execution_version',9);
 BEGIN PERFORM private.catalog_history_extract_v1('private.pilot_order_requests',row_data);
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 PERFORM pg_temp.foundation_assert(failed,'UNKNOWN_EXECUTION_VERSION');
 failed:=false;
 BEGIN PERFORM private.catalog_history_extract_v1('private.pilot_order_requests',row_data-'execution_version');
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 PERFORM pg_temp.foundation_assert(failed,'MISSING_EXECUTION_VERSION');
 row_data:=row_data||jsonb_build_object('execution_version',2,'operation','create_po','abandoned',false,'payload',jsonb_build_object('customer_id',md5('history-version-customer')::uuid,'po_number','HISTORY-V2','items',jsonb_build_array(jsonb_build_object('product_name','Fictional V2','quantity',1,'unit_price',0))));
 PERFORM pg_temp.foundation_assert(private.catalog_history_extract_v1('private.pilot_order_requests',row_data)->'ok'='true'::jsonb,'EXPLICIT_CURRENT_V2_PRODUCER');
END $execution_version$;

SAVEPOINT trusted_history_topology;
CREATE TABLE public.catalogue_fictional_unreviewed_history_edge(id uuid PRIMARY KEY,product_id uuid REFERENCES public.products(id));
SELECT pg_temp.foundation_assert(pg_temp.history_domain_v1('product',md5('history-topology-unrelated')::uuid)='CATALOG_TRACKING_INCOMPLETE','UNKNOWN_TOPOLOGY');
ROLLBACK TO SAVEPOINT trusted_history_topology;
RELEASE SAVEPOINT trusted_history_topology;

SAVEPOINT trusted_history_removed_visit;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) VALUES(md5('trusted-history-visit-actor')::uuid);
INSERT INTO public.users(id,full_name,email,role,is_active)
 VALUES(md5('trusted-history-visit-actor')::uuid,'Fictional visit owner','history-visit@example.invalid','executive',true);
INSERT INTO public.customers(id,name,customer_category)
 VALUES(md5('trusted-history-visit-customer')::uuid,'Fictional removed schedule customer','perorangan');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date)
 VALUES(md5('trusted-history-schedule')::uuid,md5('trusted-history-visit-customer')::uuid,md5('trusted-history-visit-actor')::uuid,md5('trusted-history-visit-actor')::uuid,'2026-10-14');
INSERT INTO private.pilot_visit_workflow_audit(actor_id,request_id,operation,resource_id,old_value,new_value)
 SELECT md5('trusted-history-visit-actor')::uuid,md5('trusted-history-visit-delete')::uuid,'delete_schedule',id,to_jsonb(s),NULL
 FROM public.sales_schedules s WHERE id=md5('trusted-history-schedule')::uuid;
DELETE FROM public.sales_schedules WHERE id=md5('trusted-history-schedule')::uuid;
SELECT pg_temp.foundation_assert(pg_temp.history_domain_v1('customer',md5('trusted-history-visit-customer')::uuid)='CATALOG_DELETE_BLOCKED','REMOVED_VISIT_PARENT');
ROLLBACK TO SAVEPOINT trusted_history_removed_visit;
RELEASE SAVEPOINT trusted_history_removed_visit;

-- RETIRED_CO_LINE: exercise the trusted current collector after a supported
-- create/edit removes a line, without fabricating a caller history collection.
SAVEPOINT trusted_history_retired_co;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) VALUES(md5('trusted-history-co-actor')::uuid);
INSERT INTO public.users(id,full_name,email,role,is_active)
 VALUES(md5('trusted-history-co-actor')::uuid,'Fictional CO owner','history-co@example.invalid','co_admin',true);
INSERT INTO public.customers(id,name,customer_category)
 VALUES(md5('trusted-history-co-customer')::uuid,'Fictional CO history customer','perorangan');
INSERT INTO public.products(id,name,sku) VALUES
 (md5('trusted-history-co-product-a')::uuid,'Fictional CO A','TRUSTED-HISTORY-CO-A'),
 (md5('trusted-history-co-product-b')::uuid,'Fictional CO B','TRUSTED-HISTORY-CO-B');
DO $retired_co$
DECLARE created jsonb;edited jsonb;order_id uuid;kept uuid;oldline uuid;receipt jsonb;actor uuid:=md5('trusted-history-co-actor')::uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 created:=private.catalog_co_legacy_transaction_v1(md5('trusted-history-co-create')::uuid,'create_co',
  jsonb_build_object('customer_id',md5('trusted-history-co-customer')::uuid,'expected_customer_version','1','co_number','TRUSTED-HISTORY-CO','order_date','2026-10-14',
   'lines',jsonb_build_array(jsonb_build_object('id',md5('trusted-history-co-line-a')::uuid,'product_id',md5('trusted-history-co-product-a')::uuid,'sku','TRUSTED-HISTORY-CO-A','product_name','Fictional CO A','ordered_quantity',1,'unit_price','0'),
                           jsonb_build_object('id',md5('trusted-history-co-line-b')::uuid,'product_id',md5('trusted-history-co-product-b')::uuid,'sku','TRUSTED-HISTORY-CO-B','product_name','Fictional CO B','ordered_quantity',1,'unit_price','0'))));
 order_id:=(created->>'id')::uuid;
 SELECT l.id INTO kept FROM private.co_order_lines l JOIN private.co_stock_keys k ON k.id=l.stock_key_id WHERE l.co_id=order_id AND k.product_id=md5('trusted-history-co-product-b')::uuid;
 SELECT l.id INTO oldline FROM private.co_order_lines l JOIN private.co_stock_keys k ON k.id=l.stock_key_id WHERE l.co_id=order_id AND k.product_id=md5('trusted-history-co-product-a')::uuid;
 receipt:=private.catalog_co_legacy_transaction_v1(md5('trusted-history-co-draft')::uuid,'save_sj_draft',
  jsonb_build_object('co_id',order_id,'expected_co_version',created->>'version','expected_customer_version',created->>'customer_version',
   'sj_number','TRUSTED-HISTORY-SJ','sj_date','2026-10-14','lines',jsonb_build_array(jsonb_build_object('co_line_id',oldline,'quantity',1))));
 edited:=private.catalog_co_legacy_transaction_v1(md5('trusted-history-co-edit')::uuid,'edit_co',
  jsonb_build_object('co_id',order_id,'expected_co_version',created->>'version','expected_customer_version',receipt->>'customer_version','lines',
   jsonb_build_array(jsonb_build_object('id',kept,'ordered_quantity',1))));
 PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.co_order_lines WHERE id=oldline),'retired CO line is not current');
 PERFORM pg_temp.foundation_assert(pg_temp.history_domain_v1('product',md5('trusted-history-co-product-a')::uuid)='CATALOG_DELETE_BLOCKED','RETIRED_CO_LINE');
END $retired_co$;
ROLLBACK TO SAVEPOINT trusted_history_retired_co;
RELEASE SAVEPOINT trusted_history_retired_co;

DO $history_private$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND (p.proname LIKE 'catalog_history_%_v1' OR p.proname IN('catalog_assert_no_links_v1','catalog_assert_history_contract_v1')) LOOP
  PERFORM pg_temp.foundation_assert(f.proowner='postgres'::regrole AND f.proconfig=ARRAY['search_path=""']
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner),'OWNER_PRIVATE');
 END LOOP;
END $history_private$;
SELECT 'CATALOGUE_GUARDED_DELETE_HISTORY_PASSED' AS result;

ROLLBACK TO SAVEPOINT guarded_delete_history_fixture;
RELEASE SAVEPOINT guarded_delete_history_fixture;
