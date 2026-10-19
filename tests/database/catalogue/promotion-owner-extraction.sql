-- Fictional public-source-derived assertions. The identity-bound runner must run
-- this file BEFORE applying the fragment (exact PCE01 missing-function RED), then
-- again AFTER applying it in the SAME fresh fixture job. Caller owns rollback.
-- This file neither starts a server nor identifies/authorizes a database target.
DO $preflight$
BEGIN
  IF current_user <> 'postgres'
    OR to_regclass('private.pilot_promotion_requests') IS NULL
    OR to_regclass('private.pilot_store_owner_audit_v1') IS NULL
    OR to_regclass('public.promotions') IS NULL THEN
    RAISE EXCEPTION 'CATALOGUE_PROMOTION_OWNER_FIXTURE_INVALID' USING ERRCODE = 'PCE00';
  END IF;
END $preflight$;
\echo CATALOGUE_PROMOTION_OWNER_FIXTURE_READY
DO $missing$
BEGIN
  IF to_regprocedure('private.catalog_extract_promotion_owner_event_v1(regclass,text,jsonb,jsonb)') IS NULL
    OR to_regprocedure('private.catalog_resolve_promotion_edges_v1(jsonb,jsonb)') IS NULL
    OR to_regprocedure('private.catalog_validate_promotion_owner_event_v1(regclass,text,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'CATALOGUE_PROMOTION_OWNER_MISSING_FUNCTION' USING ERRCODE = 'PCE01';
  END IF;
END $missing$;
CREATE FUNCTION pg_temp.po_equal(actual jsonb, expected jsonb, label text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Assertion failed: %; actual %, expected %', label, actual, expected; END IF;
END $$;
CREATE FUNCTION pg_temp.po_ref(kind text, label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('kind',kind,'id',md5(label)::uuid);
$$;
CREATE FUNCTION pg_temp.po_result(refs jsonb, edges jsonb, origins jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',refs,'edges',edges,'historicalNulls','[]'::jsonb,'origins',origins));
$$;
CREATE FUNCTION pg_temp.po_origin(kind text, label text, side text, path text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('ref',pg_temp.po_ref(kind,label),'rowSide',side,'path',path);
$$;
CREATE FUNCTION pg_temp.po_image() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'promotions/'||md5('fictional-admin')::uuid::text||'/'||md5('fictional-campaign')::uuid::text||'/'||md5('fictional-image-token')::uuid::text||'.png';
$$;
CREATE FUNCTION pg_temp.po_request(operation text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('actor_id',md5('fictional-admin')::uuid,'request_id',md5('fictional-request')::uuid,
    'operation',operation,'created_at','2026-02-03T04:05:06+00:00','abandoned',false,'result',NULL,
    'payload',CASE operation
      WHEN 'create_promotion' THEN jsonb_build_object('id',md5('fictional-campaign')::uuid,'product_id',md5('fictional-product')::uuid,
        'opening_quantity',0,'image_path',pg_temp.po_image(),'harga_pokok',NULL,'luar_kota',0,'dalam_kota',12.34,'depo_bangunan',NULL,'is_active',true)
      WHEN 'edit_promotion' THEN jsonb_build_object('promotion_id',md5('fictional-campaign')::uuid,'expected_stock_version',9007199254740993,
        'image_path',pg_temp.po_image(),'harga_pokok',NULL,'luar_kota',0,'dalam_kota',12.34,'depo_bangunan',NULL)
      WHEN 'adjust_stock' THEN jsonb_build_object('promotion_id',md5('fictional-campaign')::uuid,'expected_stock_version',9007199254740993,
        'quantity_delta',-1,'reason',md5('unrelated-uuid-shaped-reason')::uuid)
      WHEN 'set_active' THEN jsonb_build_object('promotion_id',md5('fictional-campaign')::uuid,'expected_stock_version',9007199254740993,'is_active',false)
    END);
$$;
CREATE FUNCTION pg_temp.po_campaign() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id',md5('fictional-campaign')::uuid,'product_id',md5('fictional-product')::uuid,
    'start_date','2026-02-03','end_date','2026-02-04','harga_pokok',NULL,'luar_kota',0,'dalam_kota',12.34,'depo_bangunan',NULL,
    'created_by',md5('fictional-admin')::uuid,'created_at','2026-02-03T04:05:06+00:00','is_active',true,'stock_managed',true,
    'remaining_quantity',0,'stock_version',9007199254740994,'image_path',pg_temp.po_image());
$$;
CREATE FUNCTION pg_temp.po_history(campaign jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('snapshots',jsonb_build_array(jsonb_build_object('source','public.promotions','row',campaign)));
$$;
CREATE FUNCTION pg_temp.po_assignment(version numeric, manager jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id',md5('fictional-assignment')::uuid,'customer_id',md5('fictional-customer')::uuid,
    'manager_id',manager,'assigned_by',md5('fictional-admin')::uuid,'assigned_at','2026-02-03T04:05:06+00:00','version',version);
$$;
CREATE FUNCTION pg_temp.po_owner() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id',md5('fictional-owner-audit')::uuid,'customer_id',md5('fictional-customer')::uuid,
    'changed_by',md5('fictional-admin')::uuid,'changed_at','2026-02-03T04:05:06+00:00',
    'before_assignment',pg_temp.po_assignment(9007199254740993,to_jsonb(md5('fictional-owner')::uuid)),
    'after_assignment',pg_temp.po_assignment(9007199254740994,'null'::jsonb));
$$;
CREATE FUNCTION pg_temp.po_refused(actual jsonb, code text, path text, label text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.po_equal(actual,jsonb_build_object('ok',false,'code',code,'path',path),label);
$$;
DO $contract$
DECLARE r jsonb; n jsonb; e jsonb; edge jsonb; origins jsonb; expected jsonb; h jsonb; bad jsonb; op text; side text; item jsonb;
  promotion regclass := 'private.pilot_promotion_requests'::regclass; owner_audit regclass := 'private.pilot_store_owner_audit_v1'::regclass;
BEGIN
  h := pg_temp.po_history(pg_temp.po_campaign());
  r := pg_temp.po_request('create_promotion');
  edge := jsonb_build_object('kind','promotion','id',md5('fictional-campaign')::uuid,'origin','NEW.payload.id',
    'expect',jsonb_build_object('productId',md5('fictional-product')::uuid));
  origins := jsonb_build_array(pg_temp.po_origin('product','fictional-product','NEW','NEW.payload.product_id'));
  expected := pg_temp.po_result(jsonb_build_array(pg_temp.po_ref('product','fictional-product')),jsonb_build_array(edge),origins);
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,r),expected,'create direct and bound edge');
  PERFORM pg_temp.po_equal(private.catalog_validate_promotion_owner_event_v1(promotion,'INSERT',NULL,r,h),
    pg_temp.po_result(expected#>'{extraction,refs}','[]',origins||jsonb_build_array(pg_temp.po_origin('product','fictional-product','NEW','NEW.payload.id'))),'frozen campaign resolves with provenance');
  FOR op IN SELECT unnest(ARRAY['edit_promotion','adjust_stock','set_active']) LOOP
    r := pg_temp.po_request(op);
    edge := jsonb_build_object('kind','promotion','id',md5('fictional-campaign')::uuid,'origin','NEW.payload.promotion_id','expect','{}'::jsonb);
    e := pg_temp.po_result('[]',jsonb_build_array(edge),'[]');
    PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,r),e,op||' only campaign is a reference');
    PERFORM pg_temp.po_equal(private.catalog_resolve_promotion_edges_v1(e,h),pg_temp.po_result(jsonb_build_array(pg_temp.po_ref('product','fictional-product')),'[]',
      jsonb_build_array(pg_temp.po_origin('product','fictional-product','NEW','NEW.payload.promotion_id'))),op||' frozen resolution');
  END LOOP;
  -- A completed result is a second occurrence of the campaign, never a product.
  r := pg_temp.po_request('set_active'); n := r||jsonb_build_object('result',jsonb_build_object('id',md5('fictional-campaign')::uuid,'stock_version',9007199254740994));
  e := private.catalog_extract_promotion_owner_event_v1(promotion,'UPDATE',r,n);
  PERFORM pg_temp.po_equal(e#>'{extraction,edges}',jsonb_build_array(
    jsonb_build_object('kind','promotion','id',md5('fictional-campaign')::uuid,'origin','OLD.payload.promotion_id','expect','{}'::jsonb),
    jsonb_build_object('kind','promotion','id',md5('fictional-campaign')::uuid,'origin','NEW.payload.promotion_id','expect','{}'::jsonb),
    jsonb_build_object('kind','promotion','id',md5('fictional-campaign')::uuid,'origin','NEW.result.id','expect','{}'::jsonb)),'OLD and NEW request occurrences');
  PERFORM pg_temp.po_equal(private.catalog_resolve_promotion_edges_v1(e,h),pg_temp.po_result(jsonb_build_array(pg_temp.po_ref('product','fictional-product')),'[]',jsonb_build_array(
    pg_temp.po_origin('product','fictional-product','OLD','OLD.payload.promotion_id'),pg_temp.po_origin('product','fictional-product','NEW','NEW.payload.promotion_id'),
    pg_temp.po_origin('product','fictional-product','NEW','NEW.result.id'))),'resolved OLD and NEW provenance');
  r := pg_temp.po_request('create_promotion');
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(promotion,'DELETE',r,NULL)#>'{extraction,origins}',
    jsonb_build_array(pg_temp.po_origin('product','fictional-product','OLD','OLD.payload.product_id')),'OLD removed product retained');
  -- Empty recovery tombstones and abandoned typed pending requests stay distinct.
  n := r||jsonb_build_object('operation','promotion_recovery_abandoned','payload','{}'::jsonb,'abandoned',true);
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n),pg_temp.po_result('[]','[]','[]'),'empty promotion tombstone');
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,r||'{"abandoned":true}')#>'{extraction,refs}',
    jsonb_build_array(pg_temp.po_ref('product','fictional-product')),'abandoned typed request preserves references');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n||'{"payload":{"extra":null}}'),'UNKNOWN_SHAPE','NEW.payload','tombstone cannot conceal payload');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,r||'{"operation":"future_operation"}'),'UNKNOWN_OPERATION','NEW.operation','unknown promotion operation');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1('public.products'::regclass,'INSERT',NULL,r),'UNKNOWN_RELATION','relation','unsupported relation');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',r,r),'INVALID_EVENT','event','INSERT OLD must be SQL null');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'UPDATE',NULL,r),'INVALID_EVENT','event','UPDATE requires OLD');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'DELETE',r,'null'),'INVALID_EVENT','event','DELETE NEW JSON null is not SQL null');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,r||'{"execution_version":1}'),'UNKNOWN_SHAPE','NEW','unknown request row version column');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,jsonb_set(r,'{payload,product_id}','"bad-id"')),'INVALID_UUID','NEW.payload.product_id','invalid product ID');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,jsonb_set(r,'{payload,extra}','null')),'UNKNOWN_SHAPE','NEW.payload','unknown payload keys');
  FOR bad IN SELECT value FROM jsonb_array_elements('[null,"9007199254740993",0,-1,1.5,9223372036854775808]') LOOP
    n := jsonb_set(pg_temp.po_request('set_active'),'{payload,expected_stock_version}',bad);
    PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n),'UNKNOWN_VERSION','NEW.payload.expected_stock_version','strict native stock versions');
  END LOOP;
  n := pg_temp.po_request('set_active')||jsonb_build_object('result',jsonb_build_object('id',md5('different-campaign')::uuid,'stock_version',9007199254740994));
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.result.id','receipt campaign binding');
  n := pg_temp.po_request('set_active')||jsonb_build_object('result',jsonb_build_object('id',md5('fictional-campaign')::uuid,'stock_version',9007199254740993));
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.result.stock_version','receipt version must increment exactly');
  n := pg_temp.po_request('create_promotion')||jsonb_build_object('result',jsonb_build_object('id',md5('fictional-campaign')::uuid,'stock_version',1));
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n)->'ok','true','created campaign receipt starts at one');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,jsonb_set(n,'{result,stock_version}','2')),'CONTRADICTORY_LINEAGE','NEW.result.stock_version','create receipt cannot invent version two');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n||'{"abandoned":true}'),'CONTRADICTORY_LINEAGE','NEW.abandoned','committed and abandoned are incompatible');
  FOR bad IN SELECT value FROM jsonb_array_elements('[null,{},[],false,123]') LOOP
    PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,jsonb_set(pg_temp.po_request('create_promotion'),'{payload,product_id}',bad)),'INVALID_UUID','NEW.payload.product_id','product ID requires UUID text');
  END LOOP;
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(promotion,'UPDATE',jsonb_set(r,'{payload,product_id}','"bad-id"'),r),'INVALID_UUID','OLD.payload.product_id','malformed OLD cannot be hidden by valid NEW');
  r := pg_temp.po_owner();
  origins := jsonb_build_array(pg_temp.po_origin('customer','fictional-customer','NEW','NEW.customer_id'),
    pg_temp.po_origin('customer','fictional-customer','NEW','NEW.before_assignment.customer_id'),pg_temp.po_origin('customer','fictional-customer','NEW','NEW.after_assignment.customer_id'));
  expected := pg_temp.po_result(jsonb_build_array(pg_temp.po_ref('customer','fictional-customer')),'[]',origins);
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,r),expected,'clear retains assignment; large numeric owner version');
  PERFORM pg_temp.po_equal(private.catalog_validate_promotion_owner_event_v1(owner_audit,'INSERT',NULL,r,'{"snapshots":[]}'),expected,'owner direct-only composition');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{after_assignment}','null')),'CONTRADICTORY_LINEAGE','NEW.after_assignment','clear cannot remove row');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{after_assignment,version}','9007199254740993')),'CONTRADICTORY_LINEAGE','NEW.after_assignment.version','clear version must advance');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{before_assignment,customer_id}',to_jsonb(md5('another-customer')::uuid))),'CONTRADICTORY_LINEAGE','NEW.before_assignment.customer_id','nested customer binding');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{after_assignment,id}',to_jsonb(md5('another-assignment')::uuid))),'CONTRADICTORY_LINEAGE','NEW.after_assignment.id','same retained assignment identity');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{before_assignment}','[]')),'UNKNOWN_SHAPE','NEW.before_assignment','owner snapshot wrong root');
  n := r||jsonb_build_object('before_assignment',NULL,'after_assignment',pg_temp.po_assignment(1,to_jsonb(md5('fictional-owner')::uuid)));
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,n)#>'{extraction,refs}',jsonb_build_array(pg_temp.po_ref('customer','fictional-customer')),'initial assignment version one');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(n,'{after_assignment,version}','2')),'CONTRADICTORY_LINEAGE','NEW.after_assignment.version','initial assignment cannot skip version');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{after_assignment,manager_id}',r#>'{before_assignment,manager_id}')),'CONTRADICTORY_LINEAGE','NEW.after_assignment.manager_id','no-op ownership change does not emit audit');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{after_assignment,assigned_by}',to_jsonb(md5('different-actor')::uuid))),'CONTRADICTORY_LINEAGE','NEW.after_assignment.assigned_by','owner actor binding');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{after_assignment,version}','"9007199254740994"')),'UNKNOWN_VERSION','NEW.after_assignment.version','owner version is native numeric');
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{before_assignment,assigned_at}','null'))->'ok','true','legacy nullable OLD assigned_at preserved');
  PERFORM pg_temp.po_refused(private.catalog_extract_promotion_owner_event_v1(owner_audit,'INSERT',NULL,jsonb_set(r,'{after_assignment,assigned_at}','null')),'UNKNOWN_SHAPE','NEW.after_assignment.assigned_at','current after assignment timestamp required');
  PERFORM pg_temp.po_equal(private.catalog_extract_promotion_owner_event_v1(owner_audit,'DELETE',r,NULL)#>'{extraction,origins}',jsonb_build_array(
    pg_temp.po_origin('customer','fictional-customer','OLD','OLD.customer_id'),pg_temp.po_origin('customer','fictional-customer','OLD','OLD.before_assignment.customer_id'),
    pg_temp.po_origin('customer','fictional-customer','OLD','OLD.after_assignment.customer_id')),'deleted audit preserves all OLD nested provenance');
  e := private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,pg_temp.po_request('create_promotion'));
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(jsonb_set(e,'{extraction,edges,0,expect}','{}'),h),'CONTRADICTORY_LINEAGE','extraction.edges[0].expect','create edge cannot drop expected product binding');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(jsonb_set(e,'{extraction,origins}','[]'),h),'CONTRADICTORY_LINEAGE','extraction.origins','direct product cannot drop provenance');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(e,'{"snapshots":[]}'),'MISSING_LINEAGE','NEW.payload.id','missing frozen promotion');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(e,pg_temp.po_history(jsonb_set(pg_temp.po_campaign(),'{product_id}',to_jsonb(md5('other-product')::uuid)))),'CONTRADICTORY_LINEAGE','NEW.payload.id','expected product mismatch');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(e,jsonb_build_object('snapshots',h->'snapshots'||(pg_temp.po_history(jsonb_set(pg_temp.po_campaign(),'{product_id}',to_jsonb(md5('other-product')::uuid)))->'snapshots'))),'CONTRADICTORY_LINEAGE','NEW.payload.id','contradictory frozen promotion');
  PERFORM pg_temp.po_equal(private.catalog_resolve_promotion_edges_v1(e,jsonb_build_object('snapshots',(h->'snapshots')||(h->'snapshots'))),private.catalog_resolve_promotion_edges_v1(e,h),'identical historical observations deduplicate');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(e,jsonb_set(h,'{snapshots,0,source}','"public.products"')),'UNKNOWN_RELATION','history.snapshots[0].source','unsupported history source');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(e,jsonb_set(h,'{snapshots,0,row,unknown}','null')),'UNKNOWN_SHAPE','history.snapshots[0].row','unknown frozen snapshot keys');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(e,NULL),'UNKNOWN_SHAPE','history','malformed history is not empty');
  n := pg_temp.po_request('create_promotion')||jsonb_build_object('result',jsonb_build_object('id',md5('fictional-campaign')::uuid,'stock_version',1));
  e := private.catalog_extract_promotion_owner_event_v1(promotion,'INSERT',NULL,n);
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(jsonb_set(e,'{extraction,edges,1,expect}','{}'),h),'CONTRADICTORY_LINEAGE','extraction.edges[1].expect','result cannot drop create expected product');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(jsonb_set(e,'{extraction,edges,1,id}',to_jsonb(md5('different-campaign')::uuid)),h),'CONTRADICTORY_LINEAGE','extraction.edges[1].id','result must retain payload campaign');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(jsonb_set(e,'{extraction,edges}',jsonb_build_array(e#>'{extraction,edges,1}')),h),'CONTRADICTORY_LINEAGE','extraction.edges[0].origin','result requires same-side payload counterpart');
  bad := jsonb_set(e,'{extraction,edges,0,kind}','"co_line"');
  PERFORM pg_temp.po_refused(private.catalog_resolve_promotion_edges_v1(bad,h),'UNKNOWN_RELATION','extraction.edges[0].kind','unsupported edge family');
END $contract$;
DO $acl$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND (p.proname LIKE 'catalog_po_%' OR p.proname IN (
      'catalog_extract_promotion_owner_event_v1','catalog_resolve_promotion_edges_v1','catalog_validate_promotion_owner_event_v1')) LOOP
    IF f.prosecdef OR f.provolatile<>'i' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR f.proowner<>'postgres'::regrole
      OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner)
      OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE')
      OR has_function_privilege('service_role',f.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'owner-only function ACL: %', f.proname;
    END IF;
  END LOOP;
END $acl$;
\echo CATALOGUE_PROMOTION_OWNER_CONTRACT_PASSED
