-- Fictional behavioral tests authored from the public CO stage01/02/03/04/08 producers.
-- For a future approved identity-bound synthetic PostgreSQL 17 job only:
-- run this unchanged before installation and require MISSING_RETIRED_CO_LINE_RESOLVER;
-- install the candidate fragment, then require this complete suite to pass.
-- No database startup, connection, fixture provisioning or install happens here.
-- The caller must own an explicit rollback-only transaction.
DO $$ BEGIN
 IF to_regprocedure('private.catalog_resolve_retired_co_line_v1(uuid,uuid,uuid,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'MISSING_RETIRED_CO_LINE_RESOLVER';
 END IF;
END $$;
CREATE FUNCTION pg_temp.rcl_assert(actual jsonb, expected jsonb, label text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, got %',label,expected,actual; END IF;
END $$;
CREATE FUNCTION pg_temp.rcl_code(history jsonb) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$
 SELECT private.catalog_resolve_retired_co_line_v1(
 '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',
 '71000000-0000-4000-8000-000000000003',history);
$$;
DO $behavior$
DECLARE
 c text := '71000000-0000-4000-8000-000000000001';
 o text := '71000000-0000-4000-8000-000000000002';
 l text := '71000000-0000-4000-8000-000000000003';
 k text := '71000000-0000-4000-8000-000000000004';
 p text := '71000000-0000-4000-8000-000000000005';
 other text := '71000000-0000-4000-8000-000000000099';
 line jsonb; order_row jsonb; order_image jsonb; audit jsonb; stock jsonb; history jsonb;
 changed jsonb; got jsonb; wanted jsonb; refs jsonb; sources jsonb; draft jsonb;
BEGIN
 line := jsonb_build_object('id',l,'co_id',o,'customer_id',c,'stock_key_id',k,
   'ordered_quantity',2,'resolved_undelivered_quantity',0,'unit_price',0,'created_at','2026-01-01T00:00:00Z');
 order_row := jsonb_build_object('id',o,'customer_id',c,'version',9007199254740993::bigint,
   'status','active','co_number','FICTIONAL-CO','order_date','2026-01-01',
   'expected_delivery_date',null,'notes',p,'created_by',other,'created_at','2026-01-01T00:00:00Z',
   'sales_person_id_at_creation',null,'sales_assignment_source_id',null,
   'sales_attributed_at','2026-01-01T00:00:00Z','sales_attribution_state','unassigned');
 order_image := jsonb_build_object('order',order_row,'lines',jsonb_build_array(line));
 audit := jsonb_build_object('id',other,'customer_id',c,'actor_id',other,'request_id',other,
   'operation','edit_co','reason',null,'before_state',order_image,
   'after_state',jsonb_build_object('order',order_row,'lines','[]'::jsonb),
   'delivery_revision_id',null,'report_revision_id',null,'return_revision_id',null,'generation_id',null,
   'created_at','2026-01-01T00:00:00Z');
 stock := jsonb_build_object('id',k,'customer_id',c,'display_sku','FICTIONAL-SKU',
   'normalized_sku','fictional-sku','product_id',p,'product_name','Fictional tile','created_at','2026-01-01T00:00:00Z');
 history := jsonb_build_object('snapshots',jsonb_build_array(
   jsonb_build_object('source','private.co_audit_events','row',audit),
   jsonb_build_object('source','private.co_stock_keys','row',stock)));
 refs := jsonb_build_array(jsonb_build_object('kind','customer','id',c),jsonb_build_object('kind','product','id',p));
 wanted := jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',refs,'edges','[]'::jsonb,
   'historicalNulls','[]'::jsonb,'origins',jsonb_build_array(
    jsonb_build_object('ref',refs->0,'rowSide','OLD','path','history.snapshots[0].row.customer_id'),
    jsonb_build_object('ref',refs->0,'rowSide','OLD','path','history.snapshots[0].row.before_state.order.customer_id'),
    jsonb_build_object('ref',refs->0,'rowSide','OLD','path','history.snapshots[0].row.before_state.lines[0].customer_id'),
    jsonb_build_object('ref',refs->0,'rowSide','OLD','path','history.snapshots[1].row.customer_id'),
    jsonb_build_object('ref',refs->1,'rowSide','OLD','path','history.snapshots[1].row.product_id'))));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(history),wanted,'frozen tuple resolves');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code('{"snapshots":[]}')->'code','"MISSING_LINEAGE"','missing history refuses');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,order,id}',to_jsonb(other));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CROSS_ORDER_LINEAGE"','wrong frozen order refuses');
 changed:=jsonb_set(history,'{snapshots,0,row,customer_id}',to_jsonb(other));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CROSS_CUSTOMER_LINEAGE"','wrong audit customer refuses');
 changed:=jsonb_set(history,'{snapshots}',history->'snapshots'||jsonb_build_array(
   jsonb_build_object('source','private.co_audit_events','row',jsonb_set(audit,'{before_state,lines,0,stock_key_id}',to_jsonb(other)))));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CONTRADICTORY_LINEAGE"','conflicting stock keys refuse');
 changed:=jsonb_set(jsonb_set(history,'{snapshots,1,row,product_id}','null'),'{snapshots,1,row,display_sku}',to_jsonb(p));
 got:=pg_temp.rcl_code(changed);
 PERFORM pg_temp.rcl_assert(got->'extraction'->'refs',jsonb_build_array(refs->0),'manual product null preserved');
 PERFORM pg_temp.rcl_assert(got->'extraction'->'historicalNulls','["history.snapshots[1].row.product_id"]','manual null evidence');
 PERFORM pg_temp.rcl_assert(got->'ok','true','manual null succeeds');
 changed:=jsonb_set(history,'{snapshots}',history->'snapshots'||jsonb_build_array(history->'snapshots'->0));
 got:=pg_temp.rcl_code(changed);
 PERFORM pg_temp.rcl_assert(got->'extraction'->'refs',refs,'consistent observations deduplicate');
 PERFORM pg_temp.rcl_assert(to_jsonb(jsonb_array_length(got->'extraction'->'origins')),'8','duplicate evidence occurrences retained');
 changed:=jsonb_set(history,'{snapshots,1,row,customer_id}',to_jsonb(other));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CROSS_CUSTOMER_LINEAGE"','cross-customer stock key refuses');
 -- Further semantic adversaries preserve the eight-case contract rather than replace it.
 changed:=history#-'{snapshots,1,row,product_id}';
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_SHAPE"','missing product field is not historical null');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,lines,0,co_id}',to_jsonb(other));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CROSS_ORDER_LINEAGE"','line order contradiction refuses');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,lines,0,customer_id}',to_jsonb(other));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CROSS_CUSTOMER_LINEAGE"','line customer contradiction refuses');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,order,customer_id}',to_jsonb(other));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CROSS_CUSTOMER_LINEAGE"','order customer contradiction refuses');
 changed:=jsonb_set(history,'{snapshots,1,source}','"public.products"');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_RELATION"','live master cannot supply frozen stock key');
 changed:=jsonb_set(history,'{snapshots,0,row,operation}','"unclassified_operation"');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_OPERATION"','unknown audit operation refuses');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,extra}',to_jsonb(other));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_SHAPE"','unknown snapshot field refuses');
 changed:=jsonb_set(history,'{snapshots,0,row}',audit||jsonb_build_object('operation','create_co','before_state',null,'after_state',order_image));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'extraction'->'refs',refs,'create CO NEW snapshot resolves');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,lines,0,id}','"not-a-uuid"');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"INVALID_UUID"','malformed UUID refuses');
 changed:=jsonb_set(history,'{snapshots}',jsonb_build_array(history->'snapshots'->0));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"MISSING_LINEAGE"','missing stock snapshot refuses');
 changed:=jsonb_set(history,'{snapshots}',history->'snapshots'||jsonb_build_array(
   jsonb_build_object('source','private.co_stock_keys','row',jsonb_set(stock,'{product_id}',to_jsonb(other)))));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CONTRADICTORY_LINEAGE"','product identity contradiction refuses');
 changed:=jsonb_set(changed,'{snapshots,2,row,product_id}','null');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CONTRADICTORY_LINEAGE"','null versus product contradiction refuses');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state}',jsonb_build_object('unrelated',order_image));
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_SHAPE"','nonregistered paths refuse');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,order,version}','9223372036854775808');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_SHAPE"','numeric version overflow refuses');
 changed:=jsonb_set(history,'{snapshots,0,row,before_state,lines,0,ordered_quantity}','2.5');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_SHAPE"','fractional integer refuses');
 -- NEW-only occurrence must survive too.
 changed:=jsonb_set(jsonb_set(history,'{snapshots,0,row,before_state,lines}','[]'),'{snapshots,0,row,after_state}',order_image);
 got:=pg_temp.rcl_code(changed);
 PERFORM pg_temp.rcl_assert(got->'extraction'->'refs',refs,'NEW line resolves');
 PERFORM pg_temp.rcl_assert(got->'extraction'->'origins'->1->'rowSide','"NEW"','NEW origin retained');
 -- Post-stage08 full draft, based on the public stage08-added evidence_id column.
 draft:=jsonb_build_object('id',other,'customer_id',c,'kind','sj','co_id',o,'version',1,
   'report_month',null,'payload',jsonb_build_object('sj_number','FICTIONAL-SJ','sj_date','2026-01-01',
   'received_date',null,'notes',null,'lines',jsonb_build_array(jsonb_build_object('co_line_id',l,'quantity',1)),
   'bound_co_version','9007199254740993','bound_customer_version','1','candidate_batch_ids',jsonb_build_object(l,other)),
   'eligible_set_fingerprint',null,'created_by',other,'created_at','2026-01-01T00:00:00Z','evidence_id',null);
 changed:=jsonb_set(history,'{snapshots,0,row}',audit||jsonb_build_object('operation','post_sj',
   'before_state',jsonb_build_object('co',order_image,'draft',draft),
   'after_state',jsonb_build_object('co',order_image,'delivery_head_id',other,'delivery_revision_id',other,'generation_id',other)));
 got:=pg_temp.rcl_code(changed);
 PERFORM pg_temp.rcl_assert(got->'extraction'->'refs',refs,'ordinary post_sj resolves both states');
 PERFORM pg_temp.rcl_assert(to_jsonb(jsonb_array_length(got->'extraction'->'origins')),'8','ordinary post_sj keeps before and after origins');
 changed:=jsonb_set(changed,'{snapshots,0,row,after_state}',order_image);
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"UNKNOWN_SHAPE"','mixed roots refuse');
 sources:=jsonb_build_object('customer_version','9007199254740993','orders',jsonb_build_array(
   jsonb_build_object('id',o,'version','9007199254740993','status','active')),
   'delivery_heads','[]'::jsonb,'return_heads','[]'::jsonb,'deliveries','[]'::jsonb,'returns','[]'::jsonb,
   'reports','[]'::jsonb,'order_lines',jsonb_build_array(line));
 changed:=jsonb_set(history,'{snapshots,0,row}',audit||jsonb_build_object('operation','correct_sj',
   'before_state',sources,'after_state',jsonb_build_object('sources',sources,'reopened','[]'::jsonb,
   'preview_fingerprint',repeat('a',64),'source_context_fingerprint',repeat('b',64))));
 got:=pg_temp.rcl_code(changed);
 PERFORM pg_temp.rcl_assert(got->'extraction'->'refs',refs,'reviewed sources resolve');
 PERFORM pg_temp.rcl_assert(to_jsonb(jsonb_array_length(got->'extraction'->'origins')),'6','reviewed sources preserve occurrences');
 changed:=jsonb_set(changed,'{snapshots,0,row,before_state,orders}','[]');
 PERFORM pg_temp.rcl_assert(pg_temp.rcl_code(changed)->'code','"CROSS_ORDER_LINEAGE"','missing orders membership refuses');
END $behavior$;
DO $permissions$
DECLARE role_name text; fn regprocedure;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='private' AND (p.proname='catalog_resolve_retired_co_line_v1' OR p.proname LIKE 'catalog_rcl_%') LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'API execution leaked: % %',role_name,fn; END IF;
  END LOOP;
 END LOOP;
END $permissions$;
