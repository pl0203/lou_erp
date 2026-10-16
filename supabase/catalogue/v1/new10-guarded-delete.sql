-- Inactive assembled catalogue completion. Source-only; production remains
-- generation 1 / tracking_ready=false. No master ACL/RLS or readiness change.
-- The integration owner composes the actual master AFTER INSERT/DELETE hooks.

-- BEGIN frozen trusted history collector.
-- Inactive source-only trusted history collector. No data/gate/grant mutation.
-- Caller must already hold the catalogue target in its final master mode, and
-- shared generation admission. This checker adds no master/evidence/advisory locks.
-- Complete retained rows are server-collected, never supplied by an API caller.
-- Version adapters below validate exact current producer contracts before projection.
CREATE FUNCTION private.catalog_history_require_v1(p_ok boolean) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 IF p_ok IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Catalogue history cannot be certified' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE';
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_require_v1(boolean) FROM PUBLIC,anon,authenticated,service_role;

-- This is an authored finite public-fixture schema manifest, not runtime discovery.
CREATE FUNCTION private.catalog_history_relations_v1() RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT $manifest${"private.catalog_target_requests_v1":{"actor_id":"uuid","fingerprint":"jsonb","receipt":"jsonb","request_id":"uuid","status":"text"},"private.co_audit_events":{"actor_id":"uuid","after_state":"jsonb","before_state":"jsonb","created_at":"timestamptz","customer_id":"uuid","delivery_revision_id":"uuid","generation_id":"uuid","id":"uuid","operation":"text","reason":"text","report_revision_id":"uuid","request_id":"uuid","return_revision_id":"uuid"},"private.co_commands":{"actor_id":"uuid","created_at":"timestamptz","execution_version":"smallint","operation":"text","payload_fingerprint":"text","receipt":"jsonb","request_id":"uuid","status":"text"},"private.co_customer_state":{"customer_id":"uuid","effective_generation_id":"uuid","version":"bigint"},"private.co_delivery_heads":{"co_id":"uuid","created_at":"timestamptz","created_by":"uuid","current_revision_id":"uuid","customer_id":"uuid","id":"uuid","original_creation_order":"bigint","version":"bigint"},"private.co_delivery_revision_lines":{"batch_id":"uuid","co_id":"uuid","co_line_id":"uuid","customer_id":"uuid","head_id":"uuid","id":"uuid","quantity":"integer","revision_id":"uuid","stock_key_id":"uuid"},"private.co_delivery_revisions":{"co_id":"uuid","created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","head_id":"uuid","id":"uuid","is_void":"boolean","notes":"text","reason":"text","received_date":"date","revision_no":"bigint","sj_date":"date","sj_number":"text"},"private.co_drafts":{"co_id":"uuid","created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","eligible_set_fingerprint":"text","evidence_id":"uuid","id":"uuid","kind":"text","payload":"jsonb","report_month":"date","version":"bigint"},"private.co_evidence":{"bound_report_revision_id":"uuid","byte_size":"bigint","created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","customer_version":"bigint","draft_id":"uuid","draft_version":"bigint","finalized_draft_version":"bigint","id":"uuid","mime_type":"text","report_month":"date","request_id":"uuid","sha256":"text","source_context_fingerprint":"text","version":"bigint"},"private.co_evidence_verifications":{"byte_size":"bigint","evidence_id":"uuid","mime_type":"text","object_id":"uuid","object_version":"text","sha256":"text","verified_at":"timestamptz","verified_by":"uuid"},"private.co_order_lines":{"co_id":"uuid","created_at":"timestamptz","customer_id":"uuid","id":"uuid","ordered_quantity":"integer","resolved_undelivered_quantity":"integer","stock_key_id":"uuid","unit_price":"numeric"},"private.co_orders":{"co_number":"text","created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","expected_delivery_date":"date","id":"uuid","notes":"text","order_date":"date","sales_assignment_source_id":"uuid","sales_attributed_at":"timestamptz","sales_attribution_state":"text","sales_person_id_at_creation":"uuid","status":"text","version":"bigint"},"private.co_replay_generations":{"algorithm_version":"text","created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","id":"uuid","version":"bigint"},"private.co_report_draft_lines":{"customer_id":"uuid","draft_id":"uuid","kind":"text","sold_quantity":"integer","stock_key_id":"uuid"},"private.co_report_evidence":{"customer_id":"uuid","evidence_id":"uuid","report_head_id":"uuid","report_revision_id":"uuid"},"private.co_report_heads":{"created_at":"timestamptz","created_by":"uuid","current_revision_id":"uuid","customer_id":"uuid","id":"uuid","report_month":"date","version":"bigint"},"private.co_report_revision_lines":{"customer_id":"uuid","head_id":"uuid","id":"uuid","revision_id":"uuid","sold_quantity":"integer","stock_key_id":"uuid"},"private.co_report_revisions":{"coverage_through_date":"date","created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","head_id":"uuid","id":"uuid","is_partial_month":"boolean","notes":"text","reason":"text","received_date":"date","report_reference":"text","revision_no":"bigint"},"private.co_return_heads":{"created_at":"timestamptz","created_by":"uuid","current_revision_id":"uuid","customer_id":"uuid","id":"uuid","version":"bigint"},"private.co_return_revision_lines":{"batch_id":"uuid","customer_id":"uuid","head_id":"uuid","id":"uuid","quantity":"integer","revision_id":"uuid","stock_key_id":"uuid"},"private.co_return_revisions":{"created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","head_id":"uuid","id":"uuid","is_void":"boolean","notes":"text","reason":"text","reference":"text","return_date":"date","revision_no":"bigint"},"private.co_sale_allocations":{"amount":"numeric","batch_id":"uuid","customer_id":"uuid","generation_id":"uuid","id":"uuid","quantity":"integer","report_revision_id":"uuid","report_revision_line_id":"uuid","sales_assignment_source_id":"uuid","sales_attributed_at":"timestamptz","sales_attribution_state":"text","sales_person_id_at_creation":"uuid","stock_key_id":"uuid","unit_price":"numeric"},"private.co_stock_batches":{"co_id":"uuid","co_line_id":"uuid","customer_id":"uuid","delivery_head_id":"uuid","id":"uuid","original_delivery_created_order":"bigint","original_delivery_line_id":"uuid","sales_assignment_source_id":"uuid","sales_attributed_at":"timestamptz","sales_attribution_state":"text","sales_person_id_at_creation":"uuid","stock_key_id":"uuid","unit_price":"numeric"},"private.co_stock_keys":{"created_at":"timestamptz","customer_id":"uuid","display_sku":"text","id":"uuid","normalized_sku":"text","product_id":"uuid","product_name":"text"},"private.co_stock_movements":{"batch_id":"uuid","customer_id":"uuid","delivery_revision_line_id":"uuid","effective_date":"date","generation_id":"uuid","id":"uuid","kind":"text","quantity_delta":"numeric","report_revision_line_id":"uuid","return_revision_line_id":"uuid","stock_key_id":"uuid"},"private.pilot_order_requests":{"abandoned":"boolean","actor_id":"uuid","created_at":"timestamptz","execution_version":"smallint","operation":"text","payload":"jsonb","request_id":"uuid","result":"jsonb"},"private.pilot_promo_movements":{"actor_id":"uuid","created_at":"timestamptz","event_kind":"text","id":"bigint","line_id":"uuid","promotion_id":"uuid","purchase_order_id":"uuid","quantity_delta":"bigint","reason":"text","request_id":"uuid","slice_id":"bigint"},"private.pilot_promo_slices":{"actor_id":"uuid","created_at":"timestamptz","id":"bigint","line_id":"uuid","product_id":"uuid","promotion_id":"uuid","purchase_order_id":"uuid","quantity":"bigint","request_id":"uuid"},"private.pilot_promotion_requests":{"abandoned":"boolean","actor_id":"uuid","created_at":"timestamptz","execution_version":"smallint","operation":"text","payload":"jsonb","request_id":"uuid","result":"jsonb"},"private.pilot_schedule_requests":{"abandoned":"boolean","actor_id":"uuid","authority":"jsonb","created_at":"timestamptz","execution_version":"smallint","operation":"text","payload":"jsonb","request_id":"uuid","result":"jsonb"},"private.pilot_store_credit_corrections_v1":{"after_credit":"jsonb","before_credit":"jsonb","corrected_at":"timestamptz","migration_key":"text","purchase_order_id":"uuid"},"private.pilot_store_owner_audit_v1":{"after_assignment":"jsonb","before_assignment":"jsonb","changed_at":"timestamptz","changed_by":"uuid","customer_id":"uuid","id":"uuid"},"private.pilot_visit_requests":{"abandoned":"boolean","actor_id":"uuid","created_at":"timestamptz","execution_version":"smallint","operation":"text","payload":"jsonb","request_id":"uuid","result":"jsonb"},"private.pilot_visit_workflow_audit":{"actor_id":"uuid","changed_at":"timestamptz","id":"uuid","new_value":"jsonb","old_value":"jsonb","operation":"text","request_id":"uuid","resource_id":"uuid"},"public.customer_manager_assignments":{"assigned_at":"timestamptz","assigned_by":"uuid","customer_id":"uuid","id":"uuid","manager_id":"uuid","version":"bigint"},"public.customer_sales_rep_assignments":{"assigned_by":"uuid","customer_id":"uuid","id":"uuid","sales_rep_id":"uuid"},"public.customer_targets":{"created_at":"timestamptz","customer_id":"uuid","id":"uuid","set_by":"uuid","target_value":"numeric","updated_at":"timestamptz","year_month":"text"},"public.girard_order_items":{"id":"uuid","is_promo":"boolean","order_id":"uuid","product_id":"uuid","product_name":"text","promotion_id":"uuid","quantity":"integer","sku":"text","unit_price":"numeric"},"public.girard_orders":{"created_at":"timestamptz","customer_id":"uuid","id":"uuid","po_id":"uuid","rejection_note":"text","reviewed_by":"uuid","source":"text","status":"text","submitted_by":"uuid","total_value":"numeric","updated_at":"timestamptz","visit_id":"uuid"},"public.order_line_items":{"id":"uuid","order_id":"uuid"},"public.orders":{"id":"uuid","outlet_id":"uuid","purchase_order_id":"uuid","sales_person_id":"uuid"},"public.outlet_visits":{"checked_in_at":"timestamptz","id":"uuid","lat":"numeric","lng":"numeric","note_version":"integer","notes":"text","outlet_id":"uuid","sales_person_id":"uuid","schedule_id":"uuid"},"public.po_audit_log":{"changed_at":"timestamptz","changed_by":"uuid","field_changed":"text","id":"uuid","new_value":"text","old_value":"text","purchase_order_id":"uuid"},"public.po_line_items":{"id":"uuid","line_total":"numeric","product_id":"uuid","product_name":"text","purchase_order_id":"uuid","quantity":"integer","sku":"text","unit_price":"numeric"},"public.promotions":{"created_at":"timestamptz","created_by":"uuid","dalam_kota":"numeric","depo_bangunan":"numeric","end_date":"date","harga_pokok":"numeric","id":"uuid","image_path":"text","is_active":"boolean","luar_kota":"numeric","product_id":"uuid","remaining_quantity":"bigint","start_date":"date","stock_managed":"boolean","stock_version":"bigint"},"public.purchase_orders":{"completed_at":"timestamptz","created_at":"timestamptz","created_by":"uuid","customer_id":"uuid","expected_delivery_date":"date","id":"uuid","notes":"text","order_date":"date","po_number":"text","sales_assignment_source_id":"uuid","sales_attributed_at":"timestamptz","sales_attribution_state":"text","sales_person_id_at_creation":"uuid","status":"public.po_status","total_value":"numeric","updated_at":"timestamptz"},"public.sales_schedules":{"assigned_by":"uuid","created_at":"timestamptz","id":"uuid","notes":"text","outlet_id":"uuid","sales_person_id":"uuid","scheduled_date":"date","status":"public.schedule_status","version":"integer"},"public.sj_line_items":{"id":"uuid","po_line_item_id":"uuid","quantity_delivered":"integer","surat_jalan_id":"uuid"},"public.surat_jalan":{"created_at":"timestamptz","created_by":"uuid","id":"uuid","purchase_order_id":"uuid","sj_date":"date","sj_date_received":"date","sj_date_returned":"date","sj_number":"text","void_reason":"text","voided_at":"timestamptz","voided_by":"uuid"},"public.visit_photos":{"id":"uuid","lat":"numeric","lng":"numeric","storage_path":"text","taken_at":"timestamptz","visit_id":"uuid"},"public.visit_requests":{"approved_schedule_id":"uuid","base_version":"integer","created_at":"timestamptz","customer_id":"uuid","decided_at":"timestamptz","id":"uuid","kind":"text","notes":"text","requester_id":"uuid","reviewer_id":"uuid","scheduled_date":"date","source_schedule_id":"uuid","status":"text","version":"integer"}}$manifest$::jsonb;
$fn$;
REVOKE ALL ON FUNCTION private.catalog_history_relations_v1() FROM PUBLIC,anon,authenticated,service_role;


CREATE FUNCTION private.catalog_history_required_v1() RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT $required${"private.catalog_target_requests_v1":["actor_id","fingerprint","request_id","status"],"private.co_audit_events":["actor_id","created_at","customer_id","id","operation"],"private.co_commands":["actor_id","created_at","execution_version","request_id","status"],"private.co_customer_state":["customer_id","version"],"private.co_delivery_heads":["co_id","created_at","created_by","customer_id","id","original_creation_order","version"],"private.co_delivery_revision_lines":["batch_id","co_id","co_line_id","customer_id","head_id","id","quantity","revision_id","stock_key_id"],"private.co_delivery_revisions":["co_id","created_at","created_by","customer_id","head_id","id","is_void","revision_no","sj_date","sj_number"],"private.co_drafts":["created_at","created_by","customer_id","id","kind","payload","version"],"private.co_evidence":["byte_size","created_at","created_by","customer_id","customer_version","draft_id","draft_version","id","mime_type","report_month","request_id","sha256","version"],"private.co_evidence_verifications":["byte_size","evidence_id","mime_type","object_id","sha256","verified_at","verified_by"],"private.co_order_lines":["co_id","created_at","customer_id","id","ordered_quantity","resolved_undelivered_quantity","stock_key_id","unit_price"],"private.co_orders":["co_number","created_at","created_by","customer_id","id","order_date","sales_attributed_at","sales_attribution_state","status","version"],"private.co_replay_generations":["algorithm_version","created_at","created_by","customer_id","id","version"],"private.co_report_draft_lines":["customer_id","draft_id","kind","stock_key_id"],"private.co_report_evidence":["customer_id","evidence_id","report_head_id","report_revision_id"],"private.co_report_heads":["created_at","created_by","customer_id","id","report_month","version"],"private.co_report_revision_lines":["customer_id","head_id","id","revision_id","sold_quantity","stock_key_id"],"private.co_report_revisions":["coverage_through_date","created_at","created_by","customer_id","head_id","id","is_partial_month","revision_no"],"private.co_return_heads":["created_at","created_by","customer_id","id","version"],"private.co_return_revision_lines":["batch_id","customer_id","head_id","id","quantity","revision_id","stock_key_id"],"private.co_return_revisions":["created_at","created_by","customer_id","head_id","id","is_void","return_date","revision_no"],"private.co_sale_allocations":["batch_id","customer_id","generation_id","id","quantity","report_revision_id","report_revision_line_id","sales_attributed_at","sales_attribution_state","stock_key_id","unit_price"],"private.co_stock_batches":["co_id","co_line_id","customer_id","delivery_head_id","id","original_delivery_created_order","original_delivery_line_id","sales_attributed_at","sales_attribution_state","stock_key_id","unit_price"],"private.co_stock_keys":["created_at","customer_id","display_sku","id","product_name"],"private.co_stock_movements":["batch_id","customer_id","effective_date","generation_id","id","kind","quantity_delta","stock_key_id"],"private.pilot_order_requests":["abandoned","actor_id","created_at","execution_version","operation","payload","request_id"],"private.pilot_promo_movements":["actor_id","created_at","event_kind","id","promotion_id","quantity_delta","request_id"],"private.pilot_promo_slices":["actor_id","created_at","id","line_id","product_id","promotion_id","purchase_order_id","quantity","request_id"],"private.pilot_promotion_requests":["abandoned","actor_id","created_at","execution_version","operation","payload","request_id"],"private.pilot_schedule_requests":["abandoned","actor_id","authority","created_at","execution_version","operation","payload","request_id"],"private.pilot_store_credit_corrections_v1":["after_credit","before_credit","corrected_at","migration_key","purchase_order_id"],"private.pilot_store_owner_audit_v1":["changed_at","changed_by","customer_id","id"],"private.pilot_visit_requests":["abandoned","actor_id","created_at","execution_version","operation","payload","request_id"],"private.pilot_visit_workflow_audit":["actor_id","changed_at","id","operation","request_id","resource_id"],"public.customer_manager_assignments":["assigned_by","customer_id","id","version"],"public.customer_sales_rep_assignments":["customer_id","id","sales_rep_id"],"public.customer_targets":["customer_id","id","set_by","year_month"],"public.girard_order_items":["id","is_promo","order_id","product_name","quantity","unit_price"],"public.girard_orders":["created_at","customer_id","id","source","status","submitted_by","total_value","updated_at"],"public.order_line_items":["id"],"public.orders":["id"],"public.outlet_visits":["checked_in_at","id","note_version","outlet_id","sales_person_id"],"public.po_audit_log":["changed_at","changed_by","field_changed","id","purchase_order_id"],"public.po_line_items":["id","product_name","purchase_order_id","quantity","unit_price"],"public.promotions":["created_by","end_date","id","is_active","product_id","remaining_quantity","start_date","stock_managed","stock_version"],"public.purchase_orders":["created_at","created_by","customer_id","id","order_date","po_number","sales_attribution_state","status","total_value","updated_at"],"public.sales_schedules":["assigned_by","id","outlet_id","sales_person_id","scheduled_date","status","version"],"public.sj_line_items":["id","po_line_item_id","quantity_delivered","surat_jalan_id"],"public.surat_jalan":["created_by","id","purchase_order_id","sj_date","sj_number"],"public.visit_photos":["id","storage_path","taken_at","visit_id"],"public.visit_requests":["created_at","customer_id","id","kind","requester_id","scheduled_date","status","version"]}$required$::jsonb;
$fn$;
REVOKE ALL ON FUNCTION private.catalog_history_required_v1() FROM PUBLIC,anon,authenticated,service_role;

-- Native to_jsonb rows must have every column, including explicit SQL-null fields.
CREATE FUNCTION private.catalog_history_row_v1(p_source text,p_row jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE fields jsonb:=private.catalog_history_relations_v1()->p_source; pair record; v jsonb;
BEGIN
 PERFORM private.catalog_history_require_v1(fields IS NOT NULL AND jsonb_typeof(p_row)='object');
 PERFORM private.catalog_history_require_v1((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(fields) k)=(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_row) k));
 FOR pair IN SELECT key,value#>>'{}' AS typ FROM jsonb_each(fields) LOOP
  v:=p_row->pair.key;
  IF v='null'::jsonb THEN
   PERFORM private.catalog_history_require_v1(NOT (private.catalog_history_required_v1()->p_source)?pair.key);
   CONTINUE;
  END IF;
  IF pair.typ='uuid' THEN PERFORM private.catalog_po_uuid_v1(v,'history');
  ELSIF pair.typ IN('bigint','integer','smallint') THEN
   PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='number' AND (v#>>'{}')::numeric=trunc((v#>>'{}')::numeric));
  ELSIF pair.typ='numeric' THEN PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='number');
  ELSIF pair.typ='boolean' THEN PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='boolean');
  ELSIF pair.typ='jsonb' THEN NULL;
  ELSIF pair.typ='date' THEN
   PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='string' AND isfinite((v#>>'{}')::date));
  ELSIF pair.typ='timestamptz' THEN
   PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='string' AND isfinite((v#>>'{}')::timestamptz));
  ELSIF pair.typ='public.schedule_status' THEN
   PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='string' AND v#>>'{}' IN('pending','completed','missed'));
  ELSIF pair.typ='public.po_status' THEN
   PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='string' AND v#>>'{}' IN('draft','confirmed','shipped','delivered','delayed','cancelled','confirm','in_progress','complete'));
  ELSE PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='string');
  END IF;
 END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_row_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_history_topology_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE entry record; observed jsonb; expected jsonb; fk record; admitted text[]:='{}'; k text;
BEGIN
 -- Column/type parity is checked even on empty tables. A new reference-bearing
 -- column cannot become silently untracked merely because there are no rows yet.
 FOR entry IN SELECT key,value FROM jsonb_each(private.catalog_history_relations_v1()) LOOP
  PERFORM private.catalog_history_require_v1(to_regclass(entry.key) IS NOT NULL);
  PERFORM private.catalog_history_require_v1(EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=to_regclass(entry.key) AND c.relkind='r' AND NOT c.relispartition AND c.relpersistence='p' AND c.relowner='postgres'::regrole)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=to_regclass(entry.key) OR i.inhparent=to_regclass(entry.key)));
  SELECT jsonb_object_agg(a.attname,CASE WHEN t.typnamespace='pg_catalog'::regnamespace THEN t.typname ELSE n.nspname||'.'||t.typname END)
   INTO observed FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
   WHERE a.attrelid=to_regclass(entry.key) AND a.attnum>0 AND NOT a.attisdropped;
  SELECT jsonb_object_agg(e.key,CASE e.value#>>'{}' WHEN 'bigint' THEN 'int8' WHEN 'integer' THEN 'int4' WHEN 'smallint' THEN 'int2' WHEN 'boolean' THEN 'bool' ELSE e.value#>>'{}' END)
   INTO expected FROM jsonb_each(entry.value) e;
  PERFORM private.catalog_history_require_v1(observed=expected);
 END LOOP;
 -- Exactly two supported fictional product-FK profiles: baseline NO ACTION,
 -- or the independently authored promotion-only CASCADE constraint.
 FOR fk IN SELECT c.*,c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS target,
   ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY u(n,o) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.n ORDER BY u.o) AS child_columns,
   ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY u(n,o) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=u.n ORDER BY u.o) AS parent_columns
  FROM pg_catalog.pg_constraint c WHERE c.contype='f' AND c.confrelid IN('public.customers'::regclass,'public.products'::regclass) LOOP
  k:=fk.source||':'||array_to_string(fk.child_columns,',')||':'||fk.target;
  PERFORM private.catalog_history_require_v1(k=ANY(ARRAY[
   'public.customer_targets:customer_id:public.customers','public.customer_manager_assignments:customer_id:public.customers',
   'public.customer_sales_rep_assignments:customer_id:public.customers','public.purchase_orders:customer_id:public.customers',
   'public.girard_orders:customer_id:public.customers','public.sales_schedules:outlet_id:public.customers',
   'public.outlet_visits:outlet_id:public.customers','public.visit_requests:customer_id:public.customers',
   'private.co_customer_state:customer_id:public.customers','public.po_line_items:product_id:public.products',
   'public.girard_order_items:product_id:public.products','public.promotions:product_id:public.products',
   'private.pilot_promo_slices:product_id:public.products']) AND NOT k=ANY(admitted));
  PERFORM private.catalog_history_require_v1(fk.parent_columns=ARRAY['id']::text[] AND fk.confupdtype='a' AND fk.confmatchtype='s'
   AND fk.convalidated AND NOT fk.condeferrable AND NOT fk.condeferred
   AND ((fk.confdeltype='a' AND (k<>'public.promotions:product_id:public.products' OR fk.conname='promotions_product_id_fkey')) OR (k='public.promotions:product_id:public.products' AND fk.confdeltype='c' AND fk.conname='catalogue_fictional_promotion_product_cascade_v2')));
  admitted:=array_append(admitted,k);
 END LOOP;
 PERFORM private.catalog_history_require_v1(cardinality(admitted)=13);
 PERFORM private.catalog_history_producers_v1();
 FOR entry IN SELECT key,value FROM jsonb_each(private.catalog_history_required_v1()) LOOP
  SELECT coalesce(jsonb_agg(a.attname::text ORDER BY a.attname),'[]'::jsonb) INTO observed
   FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass(entry.key) AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull;
  PERFORM private.catalog_history_require_v1(observed=entry.value);
 END LOOP;
 FOR entry IN SELECT key,value FROM jsonb_each($primary${"private.catalog_target_requests_v1":["actor_id","request_id"],"private.co_audit_events":["id"],"private.co_commands":["actor_id","request_id"],"private.co_customer_state":["customer_id"],"private.co_delivery_heads":["id"],"private.co_delivery_revision_lines":["id"],"private.co_delivery_revisions":["id"],"private.co_drafts":["id"],"private.co_evidence":["id"],"private.co_evidence_verifications":["evidence_id"],"private.co_order_lines":["id"],"private.co_orders":["id"],"private.co_replay_generations":["id"],"private.co_report_draft_lines":["draft_id","stock_key_id"],"private.co_report_evidence":["report_revision_id"],"private.co_report_heads":["id"],"private.co_report_revision_lines":["id"],"private.co_report_revisions":["id"],"private.co_return_heads":["id"],"private.co_return_revision_lines":["id"],"private.co_return_revisions":["id"],"private.co_sale_allocations":["id"],"private.co_stock_batches":["id"],"private.co_stock_keys":["id"],"private.co_stock_movements":["id"],"private.pilot_order_requests":["actor_id","request_id"],"private.pilot_promo_movements":["id"],"private.pilot_promo_slices":["id"],"private.pilot_promotion_requests":["actor_id","request_id"],"private.pilot_schedule_requests":["actor_id","request_id"],"private.pilot_store_credit_corrections_v1":["purchase_order_id"],"private.pilot_store_owner_audit_v1":["id"],"private.pilot_visit_requests":["actor_id","request_id"],"private.pilot_visit_workflow_audit":["id"],"public.customer_manager_assignments":["id"],"public.customer_sales_rep_assignments":["id"],"public.customer_targets":["id"],"public.girard_order_items":["id"],"public.girard_orders":["id"],"public.order_line_items":["id"],"public.orders":["id"],"public.outlet_visits":["id"],"public.po_audit_log":["id"],"public.po_line_items":["id"],"public.promotions":["id"],"public.purchase_orders":["id"],"public.sales_schedules":["id"],"public.sj_line_items":["id"],"public.surat_jalan":["id"],"public.visit_photos":["id"],"public.visit_requests":["id"]}$primary$::jsonb) LOOP
  SELECT jsonb_agg(a.attname::text ORDER BY u.o) INTO observed FROM pg_catalog.pg_constraint c
   CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY u(n,o)
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.n
   WHERE c.contype='p' AND c.conrelid=to_regclass(entry.key) AND c.convalidated AND NOT c.condeferrable;
  PERFORM private.catalog_history_require_v1(observed=entry.value);
 END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_topology_v1() FROM PUBLIC,anon,authenticated,service_role;

-- An adapter is explicit about which field is projected and why. The entire
-- original native row is validated first; absent/unknown execution_version fails.
CREATE FUNCTION private.catalog_history_extract_v1(p_source text,p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE r jsonb:=p_row; result jsonb; version integer;
 profile constant jsonb:='{"sourceCommit":"c38b14fd122fc5dd08080f9a48adce254e4c3e52","schemaProfile":"public-po-source-20261014","producerPinsSha256":"8085f8784fb1071ef91f994bb962af9731ea8c9a2aa61023fcf88b7b8be20cb1"}';
BEGIN
 PERFORM private.catalog_history_row_v1(p_source,r);
 IF p_source='private.pilot_order_requests' THEN
  PERFORM private.catalog_history_require_v1(jsonb_typeof(r->'execution_version')='number' AND r->>'execution_version' IN('0','1','2'));
  version:=(r->>'execution_version')::integer;
  IF version=2 THEN
   PERFORM private.catalog_history_require_v1(r->>'operation' IN('create_po','edit_po','approve_sales','reject_sales','save_delivery','void_delivery','cancel_po','edit_sj_returned_date'));
   -- Exact v2 body pins establish this one schema equivalence to execution 1.
   r:=jsonb_set(r,'{execution_version}','1');
  END IF;
  result:=private.catalog_por_extract_event_v1(p_source::regclass,'INSERT',NULL,r,profile);
 ELSIF p_source='public.po_audit_log' THEN
  -- These two exact empty fictional fixture producers carry only the parent PO.
  -- Their bodies are separately pinned; arbitrary inherited audit fields refuse.
  IF r->>'field_changed' IN('fixture_line_write','fixture_delivery_write') THEN
   PERFORM private.catalog_history_require_v1(r->'old_value'='null'::jsonb AND r->'new_value'='null'::jsonb);
   r:=jsonb_set(r,'{field_changed}','"status"');
  END IF;
  -- po_items_revised parses BOTH old_value and new_value text, including OLD-only.
  result:=private.catalog_por_extract_event_v1(p_source::regclass,'INSERT',NULL,r,profile);
 ELSIF p_source IN('private.pilot_promotion_requests','private.pilot_schedule_requests','private.pilot_visit_requests','private.co_commands') THEN
  PERFORM private.catalog_history_require_v1(jsonb_typeof(r->'execution_version')='number' AND r->>'execution_version' IN('1','2'));
  r:=r-'execution_version';
  IF p_source='private.pilot_promotion_requests' THEN result:=private.catalog_extract_promotion_owner_event_v1(p_source::regclass,'INSERT',NULL,r);
  ELSIF p_source='private.co_commands' THEN result:=private.catalog_extract_co_command_event_v1(p_source::regclass,'INSERT',NULL,r);
  ELSE result:=private.catalog_extract_visit_reference_event_v1(p_source::regclass,'INSERT',NULL,r); END IF;
 ELSIF p_source='private.pilot_store_owner_audit_v1' THEN
  result:=private.catalog_extract_promotion_owner_event_v1(p_source::regclass,'INSERT',NULL,r);
 ELSIF p_source='private.pilot_visit_workflow_audit' THEN
  result:=private.catalog_extract_visit_reference_event_v1(p_source::regclass,'INSERT',NULL,r);
 ELSE PERFORM private.catalog_history_require_v1(false);
 END IF;
 PERFORM private.catalog_history_require_v1(result->'ok'='true'::jsonb);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_extract_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_history_edge_v1(p_kind text,p_id jsonb,p_customer uuid DEFAULT NULL,p_order uuid DEFAULT NULL,p_expect jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE key text;
BEGIN
 IF p_id='null'::jsonb THEN RETURN '[]'; END IF;
 key:=private.catalog_po_uuid_v1(p_id,'history.edge');
 RETURN jsonb_build_array(jsonb_build_object('kind',p_kind,'id',key,'expect',p_expect,'origin','OLD.trustedHistory')
  ||CASE WHEN p_customer IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('customerId',p_customer::text) END
  ||CASE WHEN p_order IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('orderId',p_order::text) END);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_edge_v1(text,jsonb,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Finite CO JSON grammar. The discriminator comes from a pinned server producer,
-- never a recursive search for UUID-looking strings or a caller-selected profile.
-- Output rows are retained native observations; edges bind compressed snapshots.
CREATE FUNCTION private.catalog_history_co_collect_v1(p_form text,p_value jsonb,p_customer uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE v jsonb:=p_value; r jsonb; item jsonb; part jsonb; payload jsonb; pair record;
 rows jsonb:='[]'; edges jsonb:='[]'; fields text[]; key text; source text; operation text; side text; ord uuid;
BEGIN
 PERFORM private.catalog_history_require_v1(jsonb_typeof(v)='object' AND p_customer IS NOT NULL);
 IF p_form LIKE 'private.co_%' THEN
  PERFORM private.catalog_history_row_v1(p_form,v);
  IF v?'customer_id' THEN PERFORM private.catalog_history_require_v1(v->>'customer_id'=p_customer::text); END IF;
  rows:=jsonb_build_array(jsonb_build_object('source',p_form,'row',v));
  IF p_form='private.co_drafts' THEN
   IF v->>'kind' IN('sj','return') THEN
    part:=private.catalog_extract_co_draft_event_v1('private.co_drafts'::regclass,'INSERT',NULL,v,'source-stage08');
    PERFORM private.catalog_history_require_v1(part->'ok'='true'::jsonb); edges:=part->'extraction'->'edges';
   ELSE
    PERFORM private.catalog_history_require_v1(v->>'kind'='report' AND v->'co_id'='null'::jsonb);
    PERFORM private.catalog_co_decimal_version_v1(to_jsonb(v->>'version'),'history.draft.version');
    PERFORM private.catalog_vr_date_v1(v->'report_month','history.draft.month');
    payload:=v->'payload';
    fields:=ARRAY['report_reference','received_date','notes','coverage_through_date','is_partial_month','bound_report_head_id','bound_report_revision_id','bound_customer_version'];
    IF payload?'source_context' THEN fields:=fields||ARRAY['source_context']; END IF;
    IF payload?'posted_report_head_id' OR payload?'posted_report_revision_id' THEN fields:=fields||ARRAY['posted_report_head_id','posted_report_revision_id']; END IF;
    PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(payload,fields));
    PERFORM private.catalog_co_decimal_version_v1(payload->'bound_customer_version','history.draft.customer_version');
    PERFORM private.catalog_vr_date_v1(payload->'coverage_through_date','history.draft.coverage');
    PERFORM private.catalog_history_require_v1(jsonb_typeof(payload->'is_partial_month')='boolean');
    FOREACH key IN ARRAY ARRAY['report_reference','received_date','notes'] LOOP
     PERFORM private.catalog_history_require_v1(jsonb_typeof(payload->key) IN('null','string'));
    END LOOP;
    FOREACH key IN ARRAY ARRAY['bound_report_head_id','posted_report_head_id'] LOOP
     IF payload?key THEN edges:=edges||private.catalog_history_edge_v1('co_report_head',payload->key,p_customer); END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['bound_report_revision_id','posted_report_revision_id'] LOOP
     IF payload?key THEN edges:=edges||private.catalog_history_edge_v1('co_report_revision',payload->key,p_customer); END IF;
    END LOOP;
    IF payload?'source_context' THEN
     part:=private.catalog_history_co_collect_v1('source_context',payload->'source_context',p_customer);
     rows:=rows||(part->'rows'); edges:=edges||(part->'edges');
    END IF;
    edges:=edges||private.catalog_history_edge_v1('co_evidence',v->'evidence_id',p_customer,NULL,jsonb_build_object('draftId',v->>'id'));
   END IF;
  END IF;
 ELSIF p_form='order_snapshot' THEN
  PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,ARRAY['order','lines']) AND jsonb_typeof(v->'lines')='array');
  part:=private.catalog_history_co_collect_v1('private.co_orders',v->'order',p_customer);rows:=rows||(part->'rows');
  ord:=(v->'order'->>'id')::uuid;
  FOR item IN SELECT e.value FROM jsonb_array_elements(v->'lines') e LOOP
   PERFORM private.catalog_history_require_v1(item->>'co_id'=ord::text);
   part:=private.catalog_history_co_collect_v1('private.co_order_lines',item,p_customer); rows:=rows||(part->'rows');
  END LOOP;
 ELSIF p_form='report_draft_snapshot' THEN
  fields:=ARRAY['lines']; IF v?'report_head_id' OR v?'report_revision_id' OR v?'generation_id' THEN fields:=fields||ARRAY['report_head_id','report_revision_id','generation_id']; END IF;
  r:=v-fields; PERFORM private.catalog_history_require_v1(v?&fields);
  part:=private.catalog_history_co_collect_v1('private.co_drafts',r,p_customer);rows:=rows||(part->'rows');edges:=edges||(part->'edges');
  PERFORM private.catalog_history_require_v1(r->>'kind'='report' AND jsonb_typeof(v->'lines') IN('array','null'));
  IF v->'lines'<>'null'::jsonb THEN
   FOR item IN SELECT e.value FROM jsonb_array_elements(v->'lines') e LOOP
    PERFORM private.catalog_history_require_v1(item->>'draft_id'=r->>'id');
    part:=private.catalog_history_co_collect_v1('private.co_report_draft_lines',item,p_customer);rows:=rows||(part->'rows');
   END LOOP;
  END IF;
  FOREACH key IN ARRAY ARRAY['report_head_id','report_revision_id','generation_id'] LOOP
   IF v?key THEN edges:=edges||private.catalog_history_edge_v1(CASE key WHEN 'report_head_id' THEN 'co_report_head' WHEN 'report_revision_id' THEN 'co_report_revision' ELSE 'co_generation' END,v->key,p_customer); END IF;
  END LOOP;
 ELSIF p_form='sources_snapshot' THEN
  PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,ARRAY['customer_version','orders','delivery_heads','return_heads','deliveries','returns','reports','order_lines']));
  PERFORM private.catalog_co_decimal_version_v1(v->'customer_version','history.sources.customer_version');
  FOREACH key IN ARRAY ARRAY['orders','delivery_heads','return_heads','deliveries','returns','reports','order_lines'] LOOP
   PERFORM private.catalog_history_require_v1(jsonb_typeof(v->key)='array');
   FOR item IN SELECT e.value FROM jsonb_array_elements(v->key) e LOOP
    IF key='orders' THEN
     PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(item,ARRAY['id','version','status']) AND item->>'status' IN('active','closed','cancelled'));
     PERFORM private.catalog_co_decimal_version_v1(item->'version','history.sources.order.version');
     edges:=edges||private.catalog_history_edge_v1('co_order',item->'id',p_customer);
    ELSIF key IN('delivery_heads','return_heads','order_lines') THEN
     source:='private.co_'||key;part:=private.catalog_history_co_collect_v1(source,item,p_customer);rows:=rows||(part->'rows');
    ELSIF key IN('deliveries','returns') THEN
     fields:=ARRAY['batch_id','stock_key_id','date','quantity','line_ref','revision_id'];
     IF key='deliveries' THEN fields:=fields||ARRAY['co_id','original_creation_order','unit_price','sales_person_id_at_creation','sales_assignment_source_id','sales_attributed_at','sales_attribution_state']; END IF;
     PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(item,fields));
     PERFORM private.catalog_vr_date_v1(item->'date','history.sources.date');
     PERFORM private.catalog_co_decimal_version_v1(item->'quantity','history.sources.quantity');
     edges:=edges||private.catalog_history_edge_v1('co_batch',item->'batch_id',p_customer)
      ||private.catalog_history_edge_v1('co_stock',item->'stock_key_id',p_customer)
      ||private.catalog_history_edge_v1(CASE key WHEN 'deliveries' THEN 'co_delivery_revision' ELSE 'co_return_revision' END,item->'revision_id',p_customer)
      ||private.catalog_history_edge_v1(CASE key WHEN 'deliveries' THEN 'co_delivery_line' ELSE 'co_return_line' END,item->'line_ref',p_customer);
     IF key='deliveries' THEN
      edges:=edges||private.catalog_history_edge_v1('co_order',item->'co_id',p_customer);
      PERFORM private.catalog_co_decimal_version_v1(item->'original_creation_order','history.sources.creation_order');
      PERFORM private.catalog_history_require_v1(jsonb_typeof(item->'unit_price')='string' AND (item->>'unit_price')::numeric>=0);
     END IF;
    ELSE
     PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(item,ARRAY['ref','head_id','head_version','revision_id','month','coverage','is_partial_month','report_reference','received_date','notes','lines']) AND item->'ref'=item->'revision_id');
     PERFORM private.catalog_co_decimal_version_v1(item->'head_version','history.sources.report_version');
     PERFORM private.catalog_vr_date_v1(item->'month','history.sources.month');PERFORM private.catalog_vr_date_v1(item->'coverage','history.sources.coverage');
     PERFORM private.catalog_history_require_v1(jsonb_typeof(item->'is_partial_month')='boolean' AND jsonb_typeof(item->'lines')='array');
     edges:=edges||private.catalog_history_edge_v1('co_report_head',item->'head_id',p_customer)
      ||private.catalog_history_edge_v1('co_report_revision',item->'revision_id',p_customer,NULL,jsonb_build_object('headId',item->>'head_id'));
     FOR r IN SELECT e.value FROM jsonb_array_elements(item->'lines') e LOOP
      PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(r,ARRAY['ref','stock_key_id','sold_quantity']));
      PERFORM private.catalog_po_number_v1(r->'sold_quantity',0,2147483647,true,'UNKNOWN_SHAPE','history.sources.sold');
      edges:=edges||private.catalog_history_edge_v1('co_stock',r->'stock_key_id',p_customer)
       ||private.catalog_history_edge_v1('co_report_line',r->'ref',p_customer);
     END LOOP;
    END IF;
   END LOOP;
  END LOOP;
 ELSIF p_form='source_context' THEN
  PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,ARRAY['operation','payload','source_context_fingerprint']) AND v->>'source_context_fingerprint' ~ '^[a-f0-9]{64}$');
  operation:=v->>'operation'; payload:=v->'payload';
  IF operation IN('post_sj','post_return') THEN
   fields:=ARRAY['draft_id','expected_draft_version','expected_customer_version'];IF operation='post_sj' THEN fields:=fields||ARRAY['expected_co_version'];END IF;
   PERFORM private.catalog_history_require_v1(private.catalog_por_allowed_v1(payload,fields,ARRAY['reason']));
  ELSIF operation IN('correct_sj','correct_return') THEN
   key:=CASE operation WHEN 'correct_sj' THEN 'delivery' ELSE 'return' END;
   fields:=ARRAY[key||'_head_id','original_revision_id','expected_'||key||'_version','expected_customer_version','action','reason'];
   IF operation='correct_sj' THEN fields:=fields||ARRAY['expected_co_version']; END IF;
   PERFORM private.catalog_history_require_v1(payload->>'action' IN('replace','void'));
   IF payload->>'action'='replace' THEN fields:=fields||CASE operation WHEN 'correct_sj' THEN ARRAY['draft_id','expected_draft_version'] ELSE ARRAY['return_date','lines'] END; END IF;
   PERFORM private.catalog_history_require_v1(private.catalog_por_allowed_v1(payload,fields,CASE WHEN operation='correct_return' AND payload->>'action'='replace' THEN ARRAY['reference','notes'] ELSE '{}'::text[] END));
  ELSIF operation='correct_report' THEN
   PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(payload,ARRAY['report_head_id','original_revision_id','expected_report_version','expected_customer_version','draft_id','expected_draft_version','eligible_set_fingerprint','reason']));
  ELSE PERFORM private.catalog_history_require_v1(false); END IF;
  FOR pair IN SELECT e.key,e.value FROM jsonb_each(payload) e LOOP
   IF pair.key LIKE 'expected_%_version' THEN PERFORM private.catalog_co_decimal_version_v1(pair.value,'history.context.version');
   ELSIF pair.key IN('draft_id','delivery_head_id','return_head_id','report_head_id','original_revision_id') THEN
    source:=CASE pair.key WHEN 'draft_id' THEN 'co_draft' WHEN 'delivery_head_id' THEN 'co_delivery_head' WHEN 'return_head_id' THEN 'co_return_head' WHEN 'report_head_id' THEN 'co_report_head'
     ELSE CASE operation WHEN 'correct_sj' THEN 'co_delivery_revision' WHEN 'correct_return' THEN 'co_return_revision' ELSE 'co_report_revision' END END;
    edges:=edges||private.catalog_history_edge_v1(source,pair.value,p_customer);
   ELSIF pair.key='lines' THEN
    PERFORM private.catalog_history_require_v1(jsonb_typeof(pair.value)='array');
    FOR item IN SELECT e.value FROM jsonb_array_elements(pair.value) e LOOP
     PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(item,ARRAY['batch_id','quantity']));
     PERFORM private.catalog_po_number_v1(item->'quantity',1,2147483647,true,'UNKNOWN_SHAPE','history.context.quantity');
     edges:=edges||private.catalog_history_edge_v1('co_batch',item->'batch_id',p_customer);
    END LOOP;
   ELSE PERFORM private.catalog_history_require_v1(jsonb_typeof(pair.value) IN('string','null')); END IF;
  END LOOP;
 ELSE PERFORM private.catalog_history_require_v1(false);
 END IF;
 RETURN jsonb_build_object('rows',rows,'edges',edges);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_co_collect_v1(text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_history_co_audit_v1(p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE r jsonb:=p_row; v jsonb; part jsonb; item jsonb; rows jsonb:='[]';edges jsonb:='[]';
 customer uuid; operation text; side text; form text; key text;
BEGIN
 PERFORM private.catalog_history_row_v1('private.co_audit_events',r);
 customer:=(r->>'customer_id')::uuid;operation:=r->>'operation';
 FOREACH side IN ARRAY ARRAY['before_state','after_state'] LOOP
  v:=r->side;
  IF v='null'::jsonb THEN
   PERFORM private.catalog_history_require_v1(side='before_state' AND operation IN('create_co','save_sj_draft','save_return_draft','save_report_draft'));
   CONTINUE;
  END IF;
  form:=NULL;
  IF operation IN('create_co','edit_co','cancel_co','resolve_undelivered','close_co') THEN form:='order_snapshot';
  ELSIF operation IN('save_sj_draft','save_return_draft') THEN form:='private.co_drafts';
  ELSIF operation IN('save_report_draft','post_report') THEN form:='report_draft_snapshot';
  ELSIF operation='post_sj' AND r->'before_state'?'co' THEN
   PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,CASE side WHEN 'before_state' THEN ARRAY['co','draft'] ELSE ARRAY['co','delivery_head_id','delivery_revision_id','generation_id'] END));
   part:=private.catalog_history_co_collect_v1('order_snapshot',v->'co',customer);rows:=rows||(part->'rows');edges:=edges||(part->'edges');
   IF side='before_state' THEN
    part:=private.catalog_history_co_collect_v1('private.co_drafts',v->'draft',customer);rows:=rows||(part->'rows');edges:=edges||(part->'edges');
   ELSE
    FOREACH key IN ARRAY ARRAY['delivery_head_id','delivery_revision_id','generation_id'] LOOP
     edges:=edges||private.catalog_history_edge_v1(CASE key WHEN 'delivery_head_id' THEN 'co_delivery_head' WHEN 'delivery_revision_id' THEN 'co_delivery_revision' ELSE 'co_generation' END,v->key,customer);
    END LOOP;
   END IF;
  ELSIF operation IN('post_sj','post_return','correct_sj','correct_report','correct_return') THEN
   IF side='after_state' THEN
    PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,ARRAY['sources','reopened','preview_fingerprint','source_context_fingerprint'])
     AND jsonb_typeof(v->'reopened')='array' AND v->>'preview_fingerprint' ~ '^[a-f0-9]{64}$' AND v->>'source_context_fingerprint' ~ '^[a-f0-9]{64}$');
    FOR item IN SELECT e.value FROM jsonb_array_elements(v->'reopened') e LOOP
     PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(item,ARRAY['co_id','expected_co_version','remaining_quantity','pending_quantity','missing_month_count']));
     PERFORM private.catalog_co_decimal_version_v1(item->'expected_co_version','history.reopened.version');
     FOREACH key IN ARRAY ARRAY['remaining_quantity','pending_quantity','missing_month_count'] LOOP
      PERFORM private.catalog_history_require_v1(jsonb_typeof(item->key)='string' AND item->>key ~ '^[0-9]+$');
     END LOOP;
     edges:=edges||private.catalog_history_edge_v1('co_order',item->'co_id',customer);
    END LOOP;
    v:=v->'sources';
   END IF;
   form:='sources_snapshot';
  ELSIF operation IN('register_evidence','finalize_evidence') THEN
   IF side='before_state' THEN
    PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,ARRAY['evidence_id']));
    edges:=edges||private.catalog_history_edge_v1('co_evidence',v->'evidence_id',customer);
   ELSE
    PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,ARRAY['id','version','customer_id','customer_version','draft_id','draft_version','report_month','filename','mime_type','byte_size','state','finalized_draft_version'])
     AND v->>'customer_id'=customer::text AND v->>'state' IN('pending','verified','finalized'));
    FOREACH key IN ARRAY ARRAY['version','customer_version','draft_version'] LOOP PERFORM private.catalog_co_decimal_version_v1(v->key,'history.evidence.version'); END LOOP;
    IF v->'finalized_draft_version'<>'null'::jsonb THEN PERFORM private.catalog_co_decimal_version_v1(v->'finalized_draft_version','history.evidence.finalized_version'); END IF;
    edges:=edges||private.catalog_history_edge_v1('co_evidence',v->'id',customer,NULL,jsonb_build_object('draftId',v->>'draft_id'))
     ||private.catalog_history_edge_v1('co_draft',v->'draft_id',customer);
   END IF;
  ELSIF operation='system_replay' THEN
   PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(v,CASE side WHEN 'before_state' THEN ARRAY['original_revision_id'] ELSE ARRAY['initiating_operation','report_ref','report_revision_id'] END));
   IF side='before_state' THEN edges:=edges||private.catalog_history_edge_v1('co_report_revision',v->'original_revision_id',customer);
   ELSE
    PERFORM private.catalog_history_require_v1(v->>'initiating_operation' IN('post_sj','post_return','correct_sj','correct_report','correct_return') AND jsonb_typeof(v->'report_ref')='string');
    -- report_ref is the pinned producer's ephemeral draft/report plan label,
    -- not an inferred master identity. The persisted revision is mandatory.
    edges:=edges||private.catalog_history_edge_v1('co_report_revision',v->'report_revision_id',customer);
   END IF;
  ELSE PERFORM private.catalog_history_require_v1(false);
  END IF;
  IF form IS NOT NULL THEN
   part:=private.catalog_history_co_collect_v1(form,v,customer);rows:=rows||(part->'rows');edges:=edges||(part->'edges');
  END IF;
 END LOOP;
 RETURN jsonb_build_object('rows',rows,'edges',edges);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_co_audit_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Typed relation-to-lineage map, deliberately not a generic ID/key crawler.
CREATE FUNCTION private.catalog_history_native_edges_v1(p_source text,p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE edges jsonb:='[]';mapping jsonb;pair record;customer uuid;ord uuid;
BEGIN
 customer:=CASE WHEN p_row?'customer_id' THEN (p_row->>'customer_id')::uuid ELSE NULL END;
 ord:=CASE WHEN p_row?'co_id' THEN (p_row->>'co_id')::uuid WHEN p_row?'purchase_order_id' THEN (p_row->>'purchase_order_id')::uuid ELSE NULL END;
 mapping:=CASE p_source
 WHEN 'public.po_line_items' THEN '{"purchase_order_id":"po"}'
 WHEN 'public.po_audit_log' THEN '{"purchase_order_id":"po"}'
 WHEN 'public.girard_orders' THEN '{"po_id":"po","visit_id":"visit"}'
 WHEN 'public.girard_order_items' THEN '{"order_id":"girard_order","promotion_id":"promotion"}'
 WHEN 'public.surat_jalan' THEN '{"purchase_order_id":"po"}'
 WHEN 'public.sj_line_items' THEN '{"surat_jalan_id":"delivery","po_line_item_id":"po_line"}'
 WHEN 'public.orders' THEN '{"purchase_order_id":"po"}'
 WHEN 'public.order_line_items' THEN '{"order_id":"legacy_order"}'
 WHEN 'public.visit_photos' THEN '{"visit_id":"visit"}'
 WHEN 'private.pilot_promo_slices' THEN '{"promotion_id":"promotion","purchase_order_id":"po","line_id":"po_line"}'
 WHEN 'private.pilot_promo_movements' THEN '{"promotion_id":"promotion","purchase_order_id":"po","line_id":"po_line"}'
 WHEN 'private.pilot_store_credit_corrections_v1' THEN '{"purchase_order_id":"po"}'
 WHEN 'private.co_customer_state' THEN '{"effective_generation_id":"co_generation"}'
 WHEN 'private.co_order_lines' THEN '{"co_id":"co_order","stock_key_id":"co_stock"}'
 WHEN 'private.co_drafts' THEN '{"co_id":"co_order","evidence_id":"co_evidence"}'
 WHEN 'private.co_report_draft_lines' THEN '{"draft_id":"co_draft","stock_key_id":"co_stock"}'
 WHEN 'private.co_delivery_heads' THEN '{"co_id":"co_order","current_revision_id":"co_delivery_revision"}'
 WHEN 'private.co_delivery_revisions' THEN '{"co_id":"co_order","head_id":"co_delivery_head"}'
 WHEN 'private.co_delivery_revision_lines' THEN '{"co_id":"co_order","head_id":"co_delivery_head","revision_id":"co_delivery_revision","co_line_id":"co_line","stock_key_id":"co_stock","batch_id":"co_batch"}'
 WHEN 'private.co_report_heads' THEN '{"current_revision_id":"co_report_revision"}'
 WHEN 'private.co_report_revisions' THEN '{"head_id":"co_report_head"}'
 WHEN 'private.co_report_revision_lines' THEN '{"revision_id":"co_report_revision","head_id":"co_report_head","stock_key_id":"co_stock"}'
 WHEN 'private.co_return_heads' THEN '{"current_revision_id":"co_return_revision"}'
 WHEN 'private.co_return_revisions' THEN '{"head_id":"co_return_head"}'
 WHEN 'private.co_return_revision_lines' THEN '{"head_id":"co_return_head","revision_id":"co_return_revision","batch_id":"co_batch","stock_key_id":"co_stock"}'
 WHEN 'private.co_stock_batches' THEN '{"co_id":"co_order","co_line_id":"co_line","stock_key_id":"co_stock","delivery_head_id":"co_delivery_head","original_delivery_line_id":"co_delivery_line"}'
 WHEN 'private.co_stock_movements' THEN '{"generation_id":"co_generation","batch_id":"co_batch","stock_key_id":"co_stock","delivery_revision_line_id":"co_delivery_line","return_revision_line_id":"co_return_line","report_revision_line_id":"co_report_line"}'
 WHEN 'private.co_sale_allocations' THEN '{"generation_id":"co_generation","report_revision_id":"co_report_revision","report_revision_line_id":"co_report_line","batch_id":"co_batch","stock_key_id":"co_stock"}'
 WHEN 'private.co_audit_events' THEN '{"delivery_revision_id":"co_delivery_revision","report_revision_id":"co_report_revision","return_revision_id":"co_return_revision","generation_id":"co_generation"}'
 WHEN 'private.co_evidence' THEN '{"draft_id":"co_draft","bound_report_revision_id":"co_report_revision"}'
 WHEN 'private.co_evidence_verifications' THEN '{"evidence_id":"co_evidence"}'
 WHEN 'private.co_report_evidence' THEN '{"report_revision_id":"co_report_revision","report_head_id":"co_report_head","evidence_id":"co_evidence"}'
 ELSE '{}'::jsonb END;
 FOR pair IN SELECT e.key,e.value#>>'{}' AS kind FROM jsonb_each(mapping) e LOOP
  edges:=edges||private.catalog_history_edge_v1(pair.kind,p_row->pair.key,customer,
   CASE WHEN pair.kind IN('po_line','delivery','co_line','co_delivery_head','co_delivery_revision','co_batch') THEN ord END);
 END LOOP;
 RETURN edges;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_native_edges_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Resolve every typed edge against the complete server-frozen collection. All
-- matching observations remain present; no current-row preference drops OLD use.
CREATE FUNCTION private.catalog_history_resolve_v1(p_edge jsonb,p_rows jsonb,p_visit_history jsonb,p_co_history jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE e jsonb:=p_edge; item jsonb;r jsonb;matches integer:=0;source text;kind text;key text;wanted jsonb;actual jsonb;scope text;part jsonb;ord text;expect jsonb;
BEGIN
 kind:=e->>'kind';expect:=e->'expect';
 PERFORM private.catalog_history_require_v1(jsonb_typeof(e)='object' AND e?&ARRAY['kind','id','expect','origin']
  AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE NOT k=ANY(ARRAY['kind','id','expect','origin','customerId','orderId']))
  AND jsonb_typeof(expect)='object');
 PERFORM private.catalog_po_uuid_v1(e->'id','history.edge.id');
 IF kind IN('schedule','visit','visit_request') THEN
  PERFORM private.catalog_history_require_v1(NOT e?'orderId');
  part:=private.catalog_resolve_nonco_frozen_v1(jsonb_build_object('refs','[]'::jsonb,'edges',jsonb_build_array(e),'origins','[]'::jsonb,'historicalNulls','[]'::jsonb),p_visit_history);
  PERFORM private.catalog_history_require_v1(part->'ok'='true'::jsonb);RETURN;
 END IF;
 source:=CASE kind WHEN 'po' THEN 'public.purchase_orders' WHEN 'po_line' THEN 'public.po_line_items' WHEN 'girard_order' THEN 'public.girard_orders'
  WHEN 'delivery' THEN 'public.surat_jalan' WHEN 'delivery_line' THEN 'public.sj_line_items' WHEN 'promotion' THEN 'public.promotions' WHEN 'legacy_order' THEN 'public.orders'
  WHEN 'co_order' THEN 'private.co_orders' WHEN 'co_line' THEN 'private.co_order_lines' WHEN 'co_stock' THEN 'private.co_stock_keys' WHEN 'co_batch' THEN 'private.co_stock_batches'
  WHEN 'co_draft' THEN 'private.co_drafts' WHEN 'co_evidence' THEN 'private.co_evidence' WHEN 'co_generation' THEN 'private.co_replay_generations'
  WHEN 'co_delivery_head' THEN 'private.co_delivery_heads' WHEN 'co_delivery_revision' THEN 'private.co_delivery_revisions' WHEN 'co_delivery_line' THEN 'private.co_delivery_revision_lines'
  WHEN 'co_report_head' THEN 'private.co_report_heads' WHEN 'co_report_revision' THEN 'private.co_report_revisions' WHEN 'co_report_line' THEN 'private.co_report_revision_lines'
  WHEN 'co_return_head' THEN 'private.co_return_heads' WHEN 'co_return_revision' THEN 'private.co_return_revisions' WHEN 'co_return_line' THEN 'private.co_return_revision_lines' END;
 PERFORM private.catalog_history_require_v1(source IS NOT NULL);
 FOR item IN SELECT x.value FROM jsonb_array_elements(p_rows) x
  WHERE (x.value->>'source'=source OR (kind='promotion' AND x.value->>'source'='promotion_identity')) AND x.value->'row'->>'id'=e->>'id' LOOP
  actual:=NULL;wanted:=NULL;
  r:=item->'row';scope:=r->>'customer_id';ord:=coalesce(r->>'co_id',r->>'purchase_order_id');
  IF kind='po' OR kind='co_order' THEN ord:=r->>'id'; END IF;
  IF scope IS NULL AND ord IS NOT NULL AND kind IN('po_line','delivery') THEN
   SELECT q.value->'row'->>'customer_id' INTO scope FROM jsonb_array_elements(p_rows) q
    WHERE q.value->>'source'='public.purchase_orders' AND q.value->'row'->>'id'=ord LIMIT 1;
  END IF;
  IF e?'customerId' AND scope IS DISTINCT FROM e->>'customerId' THEN CONTINUE; END IF;
  IF e?'orderId' AND ord IS DISTINCT FROM e->>'orderId' THEN CONTINUE; END IF;
  FOR key,wanted IN SELECT q.key,q.value FROM jsonb_each(expect) q LOOP
   actual:=CASE key WHEN 'productId' THEN r->'product_id' WHEN 'poId' THEN r->'po_id' WHEN 'visitId' THEN r->'visit_id'
    WHEN 'headId' THEN r->'head_id' WHEN 'draftId' THEN r->'draft_id' WHEN 'draftKind' THEN r->'kind' WHEN 'poLineId' THEN r->'po_line_item_id' ELSE NULL END;
   PERFORM private.catalog_history_require_v1(actual IS NOT NULL);
   EXIT WHEN actual IS DISTINCT FROM wanted;
  END LOOP;
  IF actual IS DISTINCT FROM wanted THEN CONTINUE; END IF;
  matches:=matches+1;
 END LOOP;
 -- A removed CO line is never resolved by current SKU/label or candidate batch.
 -- The reviewed frozen resolver checks every supported audit state and key tuple.
 IF kind='co_line' AND NOT EXISTS(SELECT 1 FROM private.co_order_lines l WHERE l.id=(e->>'id')::uuid) THEN
  SELECT x.value->'row' INTO r FROM jsonb_array_elements(p_rows) x
   WHERE x.value->>'source'='private.co_order_lines' AND x.value->'row'->>'id'=e->>'id' LIMIT 1;
  PERFORM private.catalog_history_require_v1(r IS NOT NULL);
  part:=private.catalog_resolve_retired_co_line_v1((r->>'customer_id')::uuid,(r->>'co_id')::uuid,(e->>'id')::uuid,p_co_history);
  PERFORM private.catalog_history_require_v1(part->'ok'='true'::jsonb);
 END IF;
 PERFORM private.catalog_history_require_v1(matches>0);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_resolve_v1(jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_assert_no_links_v1(p_kind text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE source text;entry jsonb;r jsonb;part jsonb;item jsonb;value jsonb;side text;key text;kind text;customer uuid;
 rows jsonb:='[]';extra_rows jsonb:='[]';edges jsonb:='[]';refs jsonb:='[]';visit_rows jsonb:='[]';promo_rows jsonb:='[]';co_rows jsonb:='[]';
 blocked boolean:=false;domain text;profile constant jsonb:='{"sourceCommit":"c38b14fd122fc5dd08080f9a48adce254e4c3e52","schemaProfile":"public-po-source-20261014","producerPinsSha256":"8085f8784fb1071ef91f994bb962af9731ea8c9a2aa61023fcf88b7b8be20cb1"}';
BEGIN
 PERFORM private.catalog_history_require_v1(p_kind IN('customer','product') AND p_id IS NOT NULL);
 PERFORM private.catalog_assert_history_contract_v1();
 -- Exactly these trusted relations, no caller history or arbitrary relation input.
 FOR source IN SELECT k FROM jsonb_object_keys(private.catalog_history_relations_v1()) k ORDER BY k LOOP
  FOR r IN EXECUTE format('SELECT to_jsonb(t) FROM %s t',source::regclass) LOOP
   PERFORM private.catalog_history_row_v1(source,r);
   rows:=rows||jsonb_build_array(jsonb_build_object('source',source,'row',r));
  END LOOP;
 END LOOP;
 FOR entry IN SELECT e.value FROM jsonb_array_elements(rows) e LOOP
  source:=entry->>'source';r:=entry->'row';
  IF source IN('private.pilot_order_requests','public.po_audit_log','private.pilot_promotion_requests','private.pilot_store_owner_audit_v1','private.pilot_schedule_requests','private.pilot_visit_requests','private.pilot_visit_workflow_audit','private.co_commands') THEN
   part:=private.catalog_history_extract_v1(source,r);
   refs:=refs||(part->'extraction'->'refs');edges:=edges||(part->'extraction'->'edges');
  END IF;
  IF source='public.promotions' THEN promo_rows:=promo_rows||jsonb_build_array(entry);
  ELSIF source='private.pilot_promotion_requests' AND r->>'operation'='create_promotion' THEN
   -- Validated creation payload is a retained identity binding even after a
   -- permitted native product/promotion delete. It is not fabricated row data.
   extra_rows:=extra_rows||jsonb_build_array(jsonb_build_object('source','promotion_identity','row',jsonb_build_object('id',r->'payload'->'id','product_id',r->'payload'->'product_id')));
  ELSIF source IN('public.sales_schedules','public.outlet_visits','public.visit_requests') THEN
   kind:=CASE source WHEN 'public.sales_schedules' THEN 'schedule' WHEN 'public.outlet_visits' THEN 'visit' ELSE 'visit_request' END;
   part:=private.catalog_vr_snapshot_v1(kind,r,'OLD.trustedHistory','OLD');
   refs:=refs||(part->'refs');edges:=edges||(part->'edges');visit_rows:=visit_rows||jsonb_build_array(entry);
  ELSIF source='private.pilot_visit_workflow_audit' THEN
   FOREACH side IN ARRAY ARRAY['old_value','new_value'] LOOP
    value:=r->side;IF value='null'::jsonb THEN CONTINUE; END IF;
    IF r->>'operation'='approve_request' THEN
     FOREACH key IN ARRAY ARRAY['request','schedule'] LOOP
      item:=value->key;
      IF item='null'::jsonb OR (jsonb_typeof(item)='object' AND NOT EXISTS(SELECT 1 FROM jsonb_each(item) f WHERE f.value<>'null'::jsonb)) THEN CONTINUE; END IF;
      visit_rows:=visit_rows||jsonb_build_array(jsonb_build_object('source',CASE key WHEN 'request' THEN 'public.visit_requests' ELSE 'public.sales_schedules' END,'row',item));
     END LOOP;
    ELSE
     visit_rows:=visit_rows||jsonb_build_array(jsonb_build_object('source',CASE WHEN r->>'operation' IN('propose_visit','amend_visit','reject_request','withdraw_request') THEN 'public.visit_requests' WHEN r->>'operation'='edit_visit_note' THEN 'public.outlet_visits' ELSE 'public.sales_schedules' END,'row',value));
    END IF;
   END LOOP;
  ELSIF source='public.po_audit_log' AND r->>'field_changed' IN('po_items_revised','sj_lines_revised') THEN
   -- Extractor already validates text JSON and exact OLD/NEW item grammar. These
   -- retained tuple observations resolve removed line IDs without current lookup.
   FOREACH side IN ARRAY ARRAY['old_value','new_value'] LOOP
    IF r->side='null'::jsonb THEN CONTINUE; END IF;
    FOR item IN SELECT e.value FROM jsonb_array_elements(private.catalog_por_text_array_v1(r->side,'history.audit')) e LOOP
     IF r->>'field_changed'='po_items_revised' AND item->>'id' IS NOT NULL THEN
      extra_rows:=extra_rows||jsonb_build_array(jsonb_build_object('source','public.po_line_items','row',item||jsonb_build_object('purchase_order_id',r->'purchase_order_id')));
     ELSIF r->>'field_changed'='sj_lines_revised' AND item->>'id' IS NOT NULL THEN
      extra_rows:=extra_rows||jsonb_build_array(jsonb_build_object('source','public.sj_line_items','row',item||jsonb_build_object('purchase_order_id',r->'purchase_order_id')));
     END IF;
    END LOOP;
   END LOOP;
  ELSIF source='private.co_audit_events' THEN
   part:=private.catalog_history_co_audit_v1(r);extra_rows:=extra_rows||(part->'rows');edges:=edges||(part->'edges');
   -- Unsupported resolver families are independently validated above, not erased.
   -- Only its exact accepted audit profiles enter the bounded retired-line resolver.
   IF r->>'operation' IN('create_co','edit_co','cancel_co','resolve_undelivered','close_co','post_sj','post_return','correct_sj','correct_report','correct_return') THEN co_rows:=co_rows||jsonb_build_array(entry); END IF;
  ELSIF source='private.co_stock_keys' THEN co_rows:=co_rows||jsonb_build_array(entry);
  ELSIF source='private.co_drafts' THEN
   part:=private.catalog_history_co_collect_v1(source,r,(r->>'customer_id')::uuid);edges:=edges||(part->'edges');
  ELSIF source='private.catalog_target_requests_v1' THEN
   PERFORM private.catalog_history_require_v1(r->>'status'='committed'
    AND private.catalog_po_keys_v1(r->'fingerprint',ARRAY['customer_id','year_month','target_value'])
    AND private.catalog_po_keys_v1(r->'receipt',ARRAY['version','request_id','actor_id','operation','customer_id','year_month','target_id','target_value','committed_at']));
   item:=r->'receipt';value:=r->'fingerprint';
   PERFORM private.catalog_history_require_v1(item->'version'='1'::jsonb AND item->>'operation'='upsert_target'
    AND item->'request_id'=r->'request_id' AND item->'actor_id'=r->'actor_id'
    AND item->'customer_id'=value->'customer_id' AND item->'year_month'=value->'year_month'
    AND jsonb_typeof(item->'year_month')='string' AND item->>'year_month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    AND jsonb_typeof(item->'committed_at')='string');
   PERFORM (item->>'committed_at')::timestamptz;
   PERFORM private.catalog_po_uuid_v1(item->'target_id','history.target.id');
   PERFORM private.catalog_history_require_v1((value->'target_value'='null'::jsonb AND item->'target_value'='null'::jsonb)
    OR (jsonb_typeof(value->'target_value')='number' AND jsonb_typeof(item->'target_value')='string'
     AND item->>'target_value' ~ '^[0-9]+(\.[0-9]{1,2})?$'
     AND (item->>'target_value')::numeric=(value->>'target_value')::numeric
     AND (item->>'target_value')::numeric BETWEEN 0 AND 999999999999.99));
   refs:=refs||jsonb_build_array(jsonb_build_object('kind','customer','id',private.catalog_po_uuid_v1(item->'customer_id','history.target.customer')));
  ELSIF source='private.pilot_store_credit_corrections_v1' THEN
   -- Exact historical creation-credit snapshots contain user/assignment identities,
   -- not master UUIDs. The mandatory purchase_order_id lineage is still checked.
   FOREACH side IN ARRAY ARRAY['before_credit','after_credit'] LOOP
    PERFORM private.catalog_history_require_v1(private.catalog_po_keys_v1(r->side,ARRAY['sales_person_id_at_creation','sales_assignment_source_id','sales_attributed_at','sales_attribution_state']));
   END LOOP;
  END IF;
 END LOOP;
 rows:=rows||extra_rows||visit_rows;
 -- Reuse reviewed promotion validator for every surviving full snapshot, even if
 -- no request names it. Retired request-only identities use the bounded map above.
 part:=private.catalog_resolve_promotion_edges_v1(jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs','[]'::jsonb,'edges','[]'::jsonb,'historicalNulls','[]'::jsonb,'origins','[]'::jsonb)),jsonb_build_object('snapshots',promo_rows));
 PERFORM private.catalog_history_require_v1(part->'ok'='true'::jsonb);
 -- Validate every retained visit snapshot and cross-version immutable binding.
 part:=private.catalog_resolve_nonco_frozen_v1(jsonb_build_object('refs','[]'::jsonb,'edges','[]'::jsonb,'historicalNulls','[]'::jsonb,'origins','[]'::jsonb),jsonb_build_object('snapshots',visit_rows));
 PERFORM private.catalog_history_require_v1(part->'ok'='true'::jsonb);
 FOR entry IN SELECT e.value FROM jsonb_array_elements(rows) e LOOP
  source:=entry->>'source';r:=entry->'row';
  IF source<>'promotion_identity' THEN edges:=edges||private.catalog_history_native_edges_v1(source,r); END IF;
  IF source IN('public.sales_schedules','public.outlet_visits') THEN key:='outlet_id'; ELSE key:='customer_id'; END IF;
  IF r?key AND r->key<>'null'::jsonb THEN refs:=refs||jsonb_build_array(jsonb_build_object('kind','customer','id',private.catalog_po_uuid_v1(r->key,'history.customer'))); END IF;
  IF r?'product_id' AND r->'product_id'<>'null'::jsonb THEN refs:=refs||jsonb_build_array(jsonb_build_object('kind','product','id',private.catalog_po_uuid_v1(r->'product_id','history.product'))); END IF;
 END LOOP;
 FOR item IN SELECT e.value FROM jsonb_array_elements(edges) e LOOP
  PERFORM private.catalog_history_resolve_v1(item,rows,jsonb_build_object('snapshots',visit_rows),jsonb_build_object('snapshots',co_rows));
 END LOOP;
 blocked:=refs @> jsonb_build_array(jsonb_build_object('kind',p_kind,'id',p_id::text));
 IF blocked THEN RAISE EXCEPTION 'Catalogue deletion is blocked' USING ERRCODE='23514',DETAIL='CATALOG_DELETE_BLOCKED'; END IF;
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS domain=PG_EXCEPTION_DETAIL;
 IF domain='CATALOG_DELETE_BLOCKED' THEN
  RAISE EXCEPTION 'Catalogue deletion is blocked' USING ERRCODE='23514',DETAIL='CATALOG_DELETE_BLOCKED';
 END IF;
 -- Parser paths, raw database messages, hidden links and malformed values never
 -- escape the owner boundary, including unexpected data/type/topology failures.
 RAISE EXCEPTION 'Catalogue history cannot be certified' USING ERRCODE='23514',DETAIL='CATALOG_TRACKING_INCOMPLETE';
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_assert_no_links_v1(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Exact prosrc pins authored from the approved public source files. No runtime
-- snapshot is promoted to a trusted baseline. Any parser/core/schema drift refuses.
CREATE FUNCTION private.catalog_history_producers_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE pin record; f record;
BEGIN
 FOR pin IN SELECT * FROM (VALUES
  ('private.catalog_por_require_v1(boolean,text,text)','6e964442a3e55f332377c1b3f1926aea','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_allowed_v1(jsonb,text[],text[])','50c77437cc07bbcc89c104dafbf712a4','["sql",false,"i",false,false,"u","boolean",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_keys_v1(jsonb,text[])','4b670b6fcd8e23caef7364d8fcfa906c','["sql",false,"i",false,false,"u","boolean",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_uuid_v1(jsonb,text,boolean,boolean)','39408a937fd084e767c7b600cc8b8e7d','["plpgsql",false,"i",false,false,"u","text",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_number_v1(jsonb,numeric,numeric,boolean,text)','8844e20f116eb2536992979e27792f13','["plpgsql",false,"i",false,false,"u","numeric",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_ref_v1(jsonb,text,text,text,text)','5ef7ffcdbfbe2dd6f918a39eac4b8911','["sql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_edge_v1(jsonb,text,text,text,text,text,jsonb)','56424ed53c56c2f8d8cc8baa23ad6b2f','["sql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_items_v1(jsonb,jsonb,text,text,text,text,text)','c43b36afbd2582fd31f98f2de404030e','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_ack_v1(jsonb,jsonb,text,text)','c8757404b2a64d47913ea689fe06b8f1','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_text_array_v1(jsonb,text)','5d0a16b11cfce4c68e9a8db1331c9086','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)','9678f1d6ebad54ab62755b3add49d347','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_require_v1(boolean,text,text)','f0ff0c06eee18a19d71681df6e296426','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_keys_v1(jsonb,text[])','45319f29ff30eb93ca46d51e996290a7','["sql",false,"i",false,false,"u","boolean",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_uuid_v1(jsonb,text,boolean)','bc16431e0b86cb9491e81bfc4f792ef5','["plpgsql",false,"i",false,false,"u","text",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_number_v1(jsonb,numeric,numeric,boolean,text,text,boolean)','7fe09799d46cc41743e0056d480165cf','["plpgsql",false,"i",false,false,"u","numeric",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_sorted_refs_v1(jsonb)','b67790e7bb7f8c364c3f4f5eac7ba064','["sql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_extract_promotion_owner_event_v1(regclass,text,jsonb,jsonb)','7a55f6644afe046fde8fa6acc7b994f0','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_resolve_promotion_edges_v1(jsonb,jsonb)','32847f96c16c90b1d7ce6892251c3e76','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_validate_promotion_owner_event_v1(regclass,text,jsonb,jsonb,jsonb)','56b2f401228aa9067fac45b392ac6486','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_co_decimal_version_v1(jsonb,text)','d9a569aaf6122f06737961af5ac8fa8b','["plpgsql",false,"i",false,false,"u","text",["search_path=\"\""]]'::jsonb),
  ('private.catalog_extract_co_command_event_v1(regclass,text,jsonb,jsonb)','a2d58316fe66ecf1da076d13b19d7baa','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_extract_co_draft_event_v1(regclass,text,jsonb,jsonb,text)','f0b7ea414b861ac18de13f4e2db20f52','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_rcl_fail_v1(text,text)','fca671ae2af8808624142ca7158307da','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_rcl_keys_v1(jsonb,text[],text)','2b74e9eb711fd92a3b913f51cf8d50ad','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_rcl_uuid_v1(jsonb,text,boolean)','f0cab86c13a9de0cbe65e5f6f11e132d','["plpgsql",false,"i",false,false,"u","uuid",["search_path=\"\""]]'::jsonb),
  ('private.catalog_rcl_text_v1(jsonb,text,boolean)','f2deee4c91950a5a22d5f60f8f47d4f9','["plpgsql",false,"i",false,false,"u","text",["search_path=\"\""]]'::jsonb),
  ('private.catalog_rcl_number_v1(jsonb,numeric,numeric,boolean,text)','ceeb985a0c9bd763af6f0e3f308cb998','["plpgsql",false,"i",false,false,"u","numeric",["search_path=\"\""]]'::jsonb),
  ('private.catalog_rcl_version_v1(jsonb,text)','13dfdfa7f3e8027e9e0a8e3f053cecfa','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_resolve_retired_co_line_v1(uuid,uuid,uuid,jsonb)','441108b609b25df1f4877e610aab09f7','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_require_v1(boolean,text,text)','99c2aad50f189f97a6a2a3a2c15f516a','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_keys_v1(jsonb,text[],text[])','50c77437cc07bbcc89c104dafbf712a4','["sql",false,"i",false,false,"u","boolean",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_uuid_v1(jsonb,text,boolean)','9ee58a79e0bc4ca317a48024aeff2177','["plpgsql",false,"i",false,false,"u","text",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_version_v1(jsonb,text,boolean)','555bbcdd3e2d70a46253c758a34fab6b','["plpgsql",false,"i",false,false,"u","numeric",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_text_v1(jsonb,text,boolean,integer)','fe98e788bf7bcac069bac2c763f8c185','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_date_v1(jsonb,text)','5d3e91d90e044efdb563dfa5d6790b99','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_coordinates_v1(jsonb,text)','d90abecb01d521eac3e6cd1025a0919c','["plpgsql",false,"i",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_edge_v1(text,text,text,jsonb,text)','ad023fe010ab923b441fb12929d4e520','["sql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_snapshot_v1(text,jsonb,text,text)','cd4a7a8aba553a7979acddd83a6033d1','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_vr_workflow_v1(text,jsonb,jsonb,text,text,text,text)','e04a0c476237ff8ac22668b66c8217a9','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_extract_visit_reference_event_v1(regclass,text,jsonb,jsonb)','71a7010dbdb0e3fcbd0680205de95492','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_resolve_nonco_frozen_v1(jsonb,jsonb)','33a36fb4c90da1fea9f3b2efd081a1dd','["plpgsql",false,"i",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_lines_v2(jsonb,uuid,uuid,uuid,uuid,boolean)','dfc5b2ca4950de63c1cd8615fb24e1aa','["plpgsql",false,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_insert_v2(uuid,jsonb,jsonb,jsonb)','5433b8afa16fcc4d482a230af13bff60','["plpgsql",false,"v",false,false,"u","uuid",["search_path=\"\""]]'::jsonb),
  ('private.catalog_po_transaction_core_v2(uuid,text,jsonb)','48e381a23cd97852c4a01cfff6318bf9','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_co_write_order_lines_v2(uuid,uuid,jsonb)','301ab7616e7965b38121b4fa5a9007ea','["plpgsql",false,"v",false,false,"u","void",["search_path=\"\""]]'::jsonb),
  ('private.catalog_co_orders_transaction_v2(uuid,text,jsonb)','e9eace2307f2ed603493d0ff0ad5977d','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_co_monthly_transaction_v2(uuid,text,jsonb)','eda424c35050ac82bf3edaaab9f96203','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_co_dispatch_v2(uuid,text,jsonb)','d0caaf16dfb16f204220a386b3e34cf9','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_promotion_core_v2(uuid,text,jsonb,boolean)','fa69820994edbf552eadce55128bd3e3','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_owner_core_v2(uuid,uuid,uuid,bigint,boolean)','ca1c2abfdb56824ee84ab3496d076b3e','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_schedule_core_v2(uuid,text,jsonb,boolean)','9238d97b7290ab7d2ad322b27271724f','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_visit_core_v2(uuid,text,jsonb,boolean)','bd2ba2040a5c54dbb5175ccdc47b5cbe','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_evidence_core_v2(uuid,text,jsonb,boolean)','a55e5279fb0f99ceb2d28f8c04be2238','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.catalog_attest_core_v2(uuid,uuid,uuid,text,bigint,text,text,boolean)','264f35842ee4480912f3d8b07c4b9ee4','["plpgsql",true,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.co_order_snapshot_v1(uuid)','687c2f37633867940d52b9da5a950868','["sql",false,"s",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.co_monthly_sources_v1(uuid)','06bbf9a6b1e89939b11d0955e8f0a87d','["sql",false,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.co_sources_v1(uuid)','a4a4665339222380a967c7cd6eaa709d','["sql",false,"v",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('private.co_evidence_json_v1(private.co_evidence)','8f344d71d208e5783a84be5a3b54e7be','["sql",false,"s",false,false,"u","jsonb",["search_path=\"\""]]'::jsonb),
  ('public.log_line_item_changes()','69835d6cd02dee7091433467c438b157','["plpgsql",true,"v",false,false,"u","trigger",["search_path=pg_catalog, public, pg_temp"]]'::jsonb),
  ('public.log_sj_changes()','3c9ff47a8b317a17afac55f99c3a8433','["plpgsql",true,"v",false,false,"u","trigger",["search_path=pg_catalog, public, pg_temp"]]'::jsonb)
 ) p(signature,body_md5,metadata) LOOP
  SELECT p.* INTO f FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(pin.signature);
  PERFORM private.catalog_history_require_v1(f.oid IS NOT NULL AND f.proowner='postgres'::regrole AND md5(f.prosrc)=pin.body_md5
   AND jsonb_build_array((SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=f.prolang),f.prosecdef,f.provolatile::text,f.proisstrict,f.proleakproof,f.proparallel::text,pg_catalog.pg_get_function_result(f.oid),to_jsonb(f.proconfig))=pin.metadata);
 END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_producers_v1() FROM PUBLIC,anon,authenticated,service_role;


-- Every FK touching the frozen lineage graph is finite and authored from public
-- DDL, including composite scopes and deferred revision/batch cycles.
CREATE FUNCTION private.catalog_history_foreign_keys_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actual jsonb;expected jsonb:=$fk$[["private.co_audit_events",["actor_id","request_id"],"private.co_commands",["actor_id","request_id"],"a","a","s",false,false,true],["private.co_audit_events",["customer_id"],"private.co_customer_state",["customer_id"],"a","a","s",false,false,true],["private.co_audit_events",["delivery_revision_id","customer_id"],"private.co_delivery_revisions",["id","customer_id"],"a","a","s",false,false,true],["private.co_audit_events",["generation_id","customer_id"],"private.co_replay_generations",["id","customer_id"],"a","a","s",false,false,true],["private.co_audit_events",["report_revision_id","customer_id"],"private.co_report_revisions",["id","customer_id"],"a","a","s",false,false,true],["private.co_audit_events",["return_revision_id","customer_id"],"private.co_return_revisions",["id","customer_id"],"a","a","s",false,false,true],["private.co_customer_state",["customer_id"],"public.customers",["id"],"a","a","s",false,false,true],["private.co_customer_state",["effective_generation_id","customer_id"],"private.co_replay_generations",["id","customer_id"],"a","a","s",false,false,true],["private.co_delivery_heads",["co_id","customer_id"],"private.co_orders",["id","customer_id"],"a","a","s",false,false,true],["private.co_delivery_heads",["current_revision_id","id","customer_id","co_id"],"private.co_delivery_revisions",["id","head_id","customer_id","co_id"],"a","a","s",false,false,true],["private.co_delivery_revision_lines",["batch_id","head_id","customer_id","co_id","co_line_id","stock_key_id"],"private.co_stock_batches",["id","delivery_head_id","customer_id","co_id","co_line_id","stock_key_id"],"a","a","s",true,true,true],["private.co_delivery_revision_lines",["co_line_id","co_id","customer_id","stock_key_id"],"private.co_order_lines",["id","co_id","customer_id","stock_key_id"],"a","a","s",false,false,true],["private.co_delivery_revision_lines",["revision_id","head_id","customer_id","co_id"],"private.co_delivery_revisions",["id","head_id","customer_id","co_id"],"a","a","s",false,false,true],["private.co_delivery_revisions",["head_id","customer_id","co_id"],"private.co_delivery_heads",["id","customer_id","co_id"],"a","a","s",false,false,true],["private.co_drafts",["co_id","customer_id"],"private.co_orders",["id","customer_id"],"a","a","s",false,false,true],["private.co_drafts",["customer_id"],"private.co_customer_state",["customer_id"],"a","a","s",false,false,true],["private.co_drafts",["evidence_id","id","customer_id"],"private.co_evidence",["id","draft_id","customer_id"],"a","a","s",false,false,true],["private.co_evidence",["bound_report_revision_id","customer_id"],"private.co_report_revisions",["id","customer_id"],"a","a","s",false,false,true],["private.co_evidence",["created_by","request_id"],"private.co_commands",["actor_id","request_id"],"a","a","s",false,false,true],["private.co_evidence",["created_by"],"public.users",["id"],"a","a","s",false,false,true],["private.co_evidence",["draft_id","customer_id"],"private.co_drafts",["id","customer_id"],"a","a","s",false,false,true],["private.co_evidence_verifications",["evidence_id"],"private.co_evidence",["id"],"a","a","s",false,false,true],["private.co_evidence_verifications",["verified_by"],"public.users",["id"],"a","a","s",false,false,true],["private.co_order_lines",["co_id","customer_id"],"private.co_orders",["id","customer_id"],"a","a","s",false,false,true],["private.co_order_lines",["stock_key_id","customer_id"],"private.co_stock_keys",["id","customer_id"],"a","a","s",false,false,true],["private.co_orders",["customer_id"],"private.co_customer_state",["customer_id"],"a","a","s",false,false,true],["private.co_replay_generations",["customer_id"],"private.co_customer_state",["customer_id"],"a","a","s",false,false,true],["private.co_report_draft_lines",["draft_id","customer_id","kind"],"private.co_drafts",["id","customer_id","kind"],"a","a","s",false,false,true],["private.co_report_draft_lines",["stock_key_id","customer_id"],"private.co_stock_keys",["id","customer_id"],"a","a","s",false,false,true],["private.co_report_evidence",["evidence_id","customer_id"],"private.co_evidence",["id","customer_id"],"a","a","s",false,false,true],["private.co_report_evidence",["report_revision_id","report_head_id","customer_id"],"private.co_report_revisions",["id","head_id","customer_id"],"a","a","s",false,false,true],["private.co_report_heads",["current_revision_id","id","customer_id"],"private.co_report_revisions",["id","head_id","customer_id"],"a","a","s",false,false,true],["private.co_report_heads",["customer_id"],"private.co_customer_state",["customer_id"],"a","a","s",false,false,true],["private.co_report_revision_lines",["revision_id","head_id","customer_id"],"private.co_report_revisions",["id","head_id","customer_id"],"a","a","s",false,false,true],["private.co_report_revision_lines",["stock_key_id","customer_id"],"private.co_stock_keys",["id","customer_id"],"a","a","s",false,false,true],["private.co_report_revisions",["head_id","customer_id"],"private.co_report_heads",["id","customer_id"],"a","a","s",false,false,true],["private.co_return_heads",["current_revision_id","id","customer_id"],"private.co_return_revisions",["id","head_id","customer_id"],"a","a","s",false,false,true],["private.co_return_heads",["customer_id"],"private.co_customer_state",["customer_id"],"a","a","s",false,false,true],["private.co_return_revision_lines",["batch_id","customer_id","stock_key_id"],"private.co_stock_batches",["id","customer_id","stock_key_id"],"a","a","s",false,false,true],["private.co_return_revision_lines",["revision_id","head_id","customer_id"],"private.co_return_revisions",["id","head_id","customer_id"],"a","a","s",false,false,true],["private.co_return_revisions",["head_id","customer_id"],"private.co_return_heads",["id","customer_id"],"a","a","s",false,false,true],["private.co_sale_allocations",["batch_id","customer_id","stock_key_id"],"private.co_stock_batches",["id","customer_id","stock_key_id"],"a","a","s",false,false,true],["private.co_sale_allocations",["generation_id","customer_id"],"private.co_replay_generations",["id","customer_id"],"a","a","s",false,false,true],["private.co_sale_allocations",["report_revision_line_id","report_revision_id","customer_id","stock_key_id"],"private.co_report_revision_lines",["id","revision_id","customer_id","stock_key_id"],"a","a","s",false,false,true],["private.co_stock_batches",["co_line_id","co_id","customer_id","stock_key_id"],"private.co_order_lines",["id","co_id","customer_id","stock_key_id"],"a","a","s",false,false,true],["private.co_stock_batches",["delivery_head_id","customer_id","co_id","original_delivery_created_order"],"private.co_delivery_heads",["id","customer_id","co_id","original_creation_order"],"a","a","s",false,false,true],["private.co_stock_batches",["original_delivery_line_id","delivery_head_id","customer_id","co_id","co_line_id","stock_key_id","id"],"private.co_delivery_revision_lines",["id","head_id","customer_id","co_id","co_line_id","stock_key_id","batch_id"],"a","a","s",true,true,true],["private.co_stock_keys",["customer_id"],"private.co_customer_state",["customer_id"],"a","a","s",false,false,true],["private.co_stock_movements",["batch_id","customer_id","stock_key_id"],"private.co_stock_batches",["id","customer_id","stock_key_id"],"a","a","s",false,false,true],["private.co_stock_movements",["delivery_revision_line_id","customer_id","stock_key_id","batch_id"],"private.co_delivery_revision_lines",["id","customer_id","stock_key_id","batch_id"],"a","a","s",false,false,true],["private.co_stock_movements",["generation_id","customer_id"],"private.co_replay_generations",["id","customer_id"],"a","a","s",false,false,true],["private.co_stock_movements",["report_revision_line_id","customer_id","stock_key_id"],"private.co_report_revision_lines",["id","customer_id","stock_key_id"],"a","a","s",false,false,true],["private.co_stock_movements",["return_revision_line_id","customer_id","stock_key_id","batch_id"],"private.co_return_revision_lines",["id","customer_id","stock_key_id","batch_id"],"a","a","s",false,false,true],["private.pilot_order_requests",["actor_id"],"public.users",["id"],"a","a","s",false,false,true],["private.pilot_promo_movements",["actor_id"],"public.users",["id"],"a","a","s",false,false,true],["private.pilot_promo_movements",["promotion_id"],"public.promotions",["id"],"a","a","s",false,false,true],["private.pilot_promo_movements",["purchase_order_id"],"public.purchase_orders",["id"],"a","a","s",false,false,true],["private.pilot_promo_movements",["slice_id"],"private.pilot_promo_slices",["id"],"a","a","s",false,false,true],["private.pilot_promo_slices",["actor_id"],"public.users",["id"],"a","a","s",false,false,true],["private.pilot_promo_slices",["product_id"],"public.products",["id"],"a","a","s",false,false,true],["private.pilot_promo_slices",["promotion_id"],"public.promotions",["id"],"a","a","s",false,false,true],["private.pilot_promo_slices",["purchase_order_id"],"public.purchase_orders",["id"],"a","a","s",false,false,true],["private.pilot_promotion_requests",["actor_id"],"public.users",["id"],"a","a","s",false,false,true],["private.pilot_schedule_requests",["actor_id"],"public.users",["id"],"a","a","s",false,false,true],["private.pilot_visit_requests",["actor_id"],"public.users",["id"],"a","a","s",false,false,true],["private.pilot_visit_workflow_audit",["actor_id"],"public.users",["id"],"a","a","s",false,false,true],["public.customer_manager_assignments",["assigned_by"],"public.users",["id"],"a","a","s",false,false,true],["public.customer_manager_assignments",["customer_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.customer_manager_assignments",["manager_id"],"public.users",["id"],"a","a","s",false,false,true],["public.customer_sales_rep_assignments",["assigned_by"],"public.users",["id"],"a","a","s",false,false,true],["public.customer_sales_rep_assignments",["customer_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.customer_sales_rep_assignments",["sales_rep_id"],"public.users",["id"],"a","a","s",false,false,true],["public.customer_targets",["customer_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.customer_targets",["set_by"],"public.users",["id"],"a","a","s",false,false,true],["public.girard_order_items",["order_id"],"public.girard_orders",["id"],"a","a","s",false,false,true],["public.girard_order_items",["product_id"],"public.products",["id"],"a","a","s",false,false,true],["public.girard_order_items",["promotion_id"],"public.promotions",["id"],"a","a","s",false,false,true],["public.girard_orders",["customer_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.girard_orders",["po_id"],"public.purchase_orders",["id"],"a","a","s",false,false,true],["public.girard_orders",["reviewed_by"],"public.users",["id"],"a","a","s",false,false,true],["public.girard_orders",["submitted_by"],"public.users",["id"],"a","a","s",false,false,true],["public.girard_orders",["visit_id"],"public.outlet_visits",["id"],"a","a","s",false,false,true],["public.order_line_items",["order_id"],"public.orders",["id"],"a","a","s",false,false,true],["public.orders",["outlet_id"],"public.outlets",["id"],"a","a","s",false,false,true],["public.orders",["purchase_order_id"],"public.purchase_orders",["id"],"a","a","s",false,false,true],["public.orders",["sales_person_id"],"public.users",["id"],"a","a","s",false,false,true],["public.outlet_visits",["outlet_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.outlet_visits",["sales_person_id"],"public.users",["id"],"a","a","s",false,false,true],["public.outlet_visits",["schedule_id"],"public.sales_schedules",["id"],"a","a","s",false,false,true],["public.po_audit_log",["changed_by"],"public.users",["id"],"a","a","s",false,false,true],["public.po_audit_log",["purchase_order_id"],"public.purchase_orders",["id"],"c","a","s",false,false,true],["public.po_line_items",["product_id"],"public.products",["id"],"a","a","s",false,false,true],["public.po_line_items",["purchase_order_id"],"public.purchase_orders",["id"],"c","a","s",false,false,true],["public.promotions",["created_by"],"public.users",["id"],"a","a","s",false,false,true],["public.promotions",["product_id"],"public.products",["id"],"a","a","s",false,false,true],["public.purchase_orders",["created_by"],"public.users",["id"],"a","a","s",false,false,true],["public.purchase_orders",["customer_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.purchase_orders",["sales_person_id_at_creation"],"public.users",["id"],"a","a","s",false,false,true],["public.sales_schedules",["assigned_by"],"public.users",["id"],"a","a","s",false,false,true],["public.sales_schedules",["outlet_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.sales_schedules",["sales_person_id"],"public.users",["id"],"a","a","s",false,false,true],["public.sj_line_items",["po_line_item_id"],"public.po_line_items",["id"],"a","a","s",false,false,true],["public.sj_line_items",["surat_jalan_id"],"public.surat_jalan",["id"],"c","a","s",false,false,true],["public.surat_jalan",["created_by"],"public.users",["id"],"a","a","s",false,false,true],["public.surat_jalan",["purchase_order_id"],"public.purchase_orders",["id"],"c","a","s",false,false,true],["public.surat_jalan",["voided_by"],"public.users",["id"],"a","a","s",false,false,true],["public.visit_photos",["visit_id"],"public.outlet_visits",["id"],"a","a","s",false,false,true],["public.visit_requests",["customer_id"],"public.customers",["id"],"a","a","s",false,false,true],["public.visit_requests",["requester_id"],"public.users",["id"],"a","a","s",false,false,true],["public.visit_requests",["reviewer_id"],"public.users",["id"],"a","a","s",false,false,true]]$fk$;
BEGIN
 SELECT coalesce(jsonb_agg(x.edge ORDER BY x.edge::text),'[]'::jsonb) INTO actual FROM (
  SELECT jsonb_build_array(c.conrelid::regclass::text,
   ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY u(n,o) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.n ORDER BY u.o),
   c.confrelid::regclass::text,
   ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY u(n,o) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=u.n ORDER BY u.o),
   CASE WHEN c.conrelid='public.promotions'::regclass AND c.confrelid='public.products'::regclass AND c.conname='catalogue_fictional_promotion_product_cascade_v2' AND c.confdeltype='c' THEN 'a' ELSE c.confdeltype::text END,
   c.confupdtype::text,c.confmatchtype::text,c.condeferrable,c.condeferred,c.convalidated) AS edge
  FROM pg_catalog.pg_constraint c WHERE c.contype='f' AND
   (private.catalog_history_relations_v1()?c.conrelid::regclass::text OR private.catalog_history_relations_v1()?c.confrelid::regclass::text)
 ) x;
 SELECT jsonb_agg(e.value ORDER BY e.value::text) INTO expected FROM jsonb_array_elements(expected) e;
 PERFORM private.catalog_history_require_v1(actual=expected);
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_history_foreign_keys_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.catalog_assert_history_contract_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
 PERFORM private.catalog_history_topology_v1();
 PERFORM private.catalog_product_delete_topology_v2();
 PERFORM private.catalog_history_foreign_keys_v1();
END $fn$;
REVOKE ALL ON FUNCTION private.catalog_assert_history_contract_v1() FROM PUBLIC,anon,authenticated,service_role;

DO $history_owner_acl$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND (p.proname LIKE 'catalog_history_%_v1' OR p.proname IN('catalog_assert_no_links_v1','catalog_assert_history_contract_v1')) LOOP
  IF f.proowner<>'postgres'::regrole OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner) THEN
   RAISE EXCEPTION 'Catalogue history helper authority drift' USING ERRCODE='42501';
  END IF;
 END LOOP;
END $history_owner_acl$;

-- END frozen trusted history collector.

ALTER TABLE private.catalog_requests_v1 DROP CONSTRAINT catalog_request_terminal_shape_v1,
  ADD CONSTRAINT catalog_request_terminal_shape_v1 CHECK ((
    (status='abandoned' AND binding IS NULL AND receipt IS NULL AND fingerprint IS NULL AND write_columns IS NULL)
    OR (status='committed' AND binding->>'operation'='set_enabled' AND jsonb_typeof(binding)='object'
      AND jsonb_typeof(receipt)='object' AND fingerprint IS NULL AND write_columns IS NULL)
    OR (binding->>'operation' IN ('create','edit') AND jsonb_typeof(binding)='object'
      AND fingerprint ~ '^[0-9a-f]{64}$' AND cardinality(write_columns)>0
      AND ((status='pending' AND receipt IS NULL) OR (status='committed' AND jsonb_typeof(receipt)='object')
        OR (status='abandoned' AND receipt IS NULL)))
    OR (binding->>'operation'='delete_unused' AND jsonb_typeof(binding)='object'
      AND fingerprint ~ '^[0-9a-f]{64}$' AND write_columns IS NULL
      AND ((status='pending' AND receipt IS NULL) OR (status='committed' AND jsonb_typeof(receipt)='object')
        OR (status='abandoned' AND receipt IS NULL)))) IS TRUE);

-- Owner-only, transaction-scoped create intent. A UUID by itself is not birth
-- evidence. Only the successful master AFTER INSERT hook may certify the event.
CREATE TABLE private.catalog_create_scope_v1 (
  backend_pid integer NOT NULL, transaction_id bigint NOT NULL,
  scope_id uuid NOT NULL, actor_id uuid NOT NULL, request_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('customer','product')), id uuid NOT NULL,
  birth_verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY(backend_pid,transaction_id)
);
ALTER TABLE private.catalog_create_scope_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.catalog_create_scope_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.catalog_create_scope_empty_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM private.catalog_create_scope_v1 s
    WHERE s.backend_pid=NEW.backend_pid AND s.transaction_id=NEW.transaction_id) THEN
    RAISE EXCEPTION 'Catalogue create scope is not terminal' USING ERRCODE='23514', DETAIL='CATALOG_TRACKING_INCOMPLETE';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_create_scope_empty_v1 AFTER INSERT ON private.catalog_create_scope_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.catalog_create_scope_empty_v1();

CREATE FUNCTION private.catalog_create_scope_enter_v1(p_request_id uuid,p_kind text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- new08 already holds shared admission before the final master phase. Do not
  -- take a new gate/master/evidence lock here, after those final master locks.
  IF NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=2 AND tracking_ready) THEN RETURN; END IF;
  IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('customer','product')
    OR NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 r WHERE r.actor_id=auth.uid() AND r.request_id=p_request_id
      AND r.status='pending' AND r.binding->>'operation'='create' AND r.binding->>'kind'=p_kind
      AND r.fingerprint ~ '^[0-9a-f]{64}$' AND cardinality(r.write_columns)>0) THEN
    RAISE EXCEPTION 'Catalogue create scope unavailable' USING ERRCODE='23514', DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  INSERT INTO private.catalog_create_scope_v1(backend_pid,transaction_id,scope_id,actor_id,request_id,kind,id)
    VALUES(pg_backend_pid(),txid_current(),gen_random_uuid(),auth.uid(),p_request_id,p_kind,p_id);
END $$;
CREATE FUNCTION private.catalog_create_scope_leave_v1() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM private.catalog_create_scope_v1 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current()
$$;

CREATE FUNCTION private.catalog_create_unused_allowed_v1(p_kind text,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope private.catalog_create_scope_v1%ROWTYPE; actual_version bigint;
BEGIN
  SELECT * INTO scope FROM private.catalog_create_scope_v1 s WHERE s.backend_pid=pg_backend_pid()
    AND s.transaction_id=txid_current() AND s.actor_id=auth.uid() AND s.kind=p_kind AND s.id=p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF scope.birth_verified OR NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=2 AND tracking_ready)
    OR NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 r WHERE r.actor_id=scope.actor_id AND r.request_id=scope.request_id
      AND r.status='pending' AND r.binding->>'operation'='create' AND r.binding->>'kind'=scope.kind)
    OR EXISTS(SELECT 1 FROM private.catalog_identity_v1 i WHERE i.kind=p_kind AND i.id=p_id) THEN
    RAISE EXCEPTION 'Catalogue birth proof unavailable' USING ERRCODE='23514', DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  -- The foundation AFTER trigger calls this only for a genuinely persisted row,
  -- after its absent-identity reservation. Discarded ON CONFLICT attempts never
  -- reach the hook, and any later statement failure rolls this private stamp back.
  IF p_kind='customer' THEN SELECT catalog_version INTO actual_version FROM public.customers WHERE id=p_id;
  ELSIF p_kind='product' THEN SELECT catalog_version INTO actual_version FROM public.products WHERE id=p_id;
  END IF;
  IF actual_version IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'Catalogue birth proof unavailable' USING ERRCODE='23514', DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  PERFORM private.catalog_assert_no_links_v1(p_kind,p_id);
  UPDATE private.catalog_create_scope_v1 SET birth_verified=true WHERE backend_pid=scope.backend_pid
    AND transaction_id=scope.transaction_id AND scope_id=scope.scope_id;
  RETURN true;
END $$;

CREATE FUNCTION private.catalog_create_birth_verified_v1(p_kind text,p_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM private.catalog_create_scope_v1 s JOIN private.catalog_requests_v1 r
    ON r.actor_id=s.actor_id AND r.request_id=s.request_id
    WHERE s.backend_pid=pg_backend_pid() AND s.transaction_id=txid_current() AND s.actor_id=auth.uid()
      AND s.kind=p_kind AND s.id=p_id AND s.birth_verified
      AND r.status='pending' AND r.binding->>'operation'='create' AND r.binding->>'kind'=p_kind)
$$;

-- Adapt only the reviewed monotone identity guard; unexpected installed source
-- must not silently acquire the new birth exception.
DO $catalog_identity_birth_preflight$
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc
    WHERE oid='private.catalog_identity_guard_v1()'::regprocedure) IS DISTINCT FROM 'fb2200481e82325c3d91355299f6b20fc00a2978294ab6584f3cc4e454562a8d' THEN
    RAISE EXCEPTION 'Catalogue identity guard source drift' USING ERRCODE='55000', DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
END $catalog_identity_birth_preflight$;

CREATE OR REPLACE FUNCTION private.catalog_identity_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Catalogue identity evidence is retained' USING ERRCODE = '23514', DETAIL = 'CATALOG_IDENTITY_CONFLICT';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifetime_state = 'unused' AND (NEW.last_version<>1 OR NEW.deleted_at IS NOT NULL
      OR NOT private.catalog_create_birth_verified_v1(NEW.kind,NEW.id)) THEN
      RAISE EXCEPTION 'Catalogue tracking is incomplete' USING ERRCODE = '23514', DETAIL = 'CATALOG_TRACKING_INCOMPLETE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.last_version < OLD.last_version
     OR (OLD.lifetime_state = 'used' AND NEW.lifetime_state <> 'used')
     OR (OLD.lifetime_state = 'unknown' AND NEW.lifetime_state NOT IN ('unknown', 'used'))
     OR (OLD.lifetime_state = 'unused' AND NEW.lifetime_state NOT IN ('unused', 'used'))
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'Catalogue identity evidence cannot regress' USING ERRCODE = '23514', DETAIL = 'CATALOG_IDENTITY_CONFLICT';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION private.catalog_delete_unused_v1(p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; target_kind text; target_id uuid; expected_version bigint; prior private.catalog_requests_v1%ROWTYPE;
  identity_row private.catalog_identity_v1%ROWTYPE; binding jsonb; digest text; old_row jsonb; result jsonb; affected integer;
BEGIN
  actor := private.catalog_authorize_v1(NULL,NULL);
  -- Stored action reauthorization precedes parsing, metadata and every replay.
  PERFORM private.catalog_reauthorize_request_v1(p_request_id);
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'kind' IS NULL
    OR p_payload->>'kind' NOT IN ('customer','product') THEN
    RAISE EXCEPTION 'Invalid catalogue command' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT'; END IF;
  target_kind:=p_payload->>'kind';
  binding:=p_payload||jsonb_build_object('operation','delete_unused');
  PERFORM private.catalog_authorize_bound_v1(binding,NULL);
  digest:=encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array('delete_unused',p_payload)::text,'UTF8')),'hex');
  -- The wrapper acquired this exact actor/request reservation before dispatch.
  SELECT * INTO prior FROM private.catalog_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF prior.binding IS NOT NULL THEN PERFORM private.catalog_authorize_bound_v1(prior.binding,prior.write_columns); END IF;
    IF prior.status='abandoned' THEN
      RAISE EXCEPTION 'Catalogue request was abandoned' USING ERRCODE='22023', DETAIL='CATALOG_REQUEST_ABANDONED'; END IF;
    IF prior.binding IS DISTINCT FROM binding OR prior.fingerprint IS DISTINCT FROM digest OR prior.write_columns IS NOT NULL THEN
      RAISE EXCEPTION 'Catalogue request binding differs' USING ERRCODE='22023', DETAIL='CATALOG_REQUEST_CONFLICT'; END IF;
    IF prior.status<>'committed' THEN
      RAISE EXCEPTION 'Catalogue request is pending' USING ERRCODE='55P03', DETAIL='CATALOG_REQUEST_BUSY'; END IF;
    -- Exact replay never rereads a deleted target, gate, history or evidence.
    RETURN prior.receipt;
  END IF;
  IF NOT p_payload ?& ARRAY['kind','id','expected_version'] OR p_payload-ARRAY['kind','id','expected_version']<>'{}'::jsonb
    OR jsonb_typeof(p_payload->'kind') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
    OR p_payload->>'id' !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    OR jsonb_typeof(p_payload->'expected_version') IS DISTINCT FROM 'string'
    OR p_payload->>'expected_version' !~ '^[1-9][0-9]*$' OR length(p_payload->>'expected_version')>19 THEN
    RAISE EXCEPTION 'Invalid catalogue command' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT'; END IF;
  IF (p_payload->>'expected_version')::numeric>9223372036854775807 THEN
    RAISE EXCEPTION 'Invalid catalogue version' USING ERRCODE='22023', DETAIL='CATALOG_INVALID_INPUT'; END IF;
  target_id:=(p_payload->>'id')::uuid; expected_version:=(p_payload->>'expected_version')::bigint;
  INSERT INTO private.catalog_requests_v1(actor_id,request_id,status,binding,fingerprint,write_columns)
    VALUES(actor,p_request_id,'pending',binding,digest,NULL);
  PERFORM private.catalog_writer_admit_v2();
  -- Mandatory final master phase: the native root DELETE trigger only reenters
  -- this ALREADY HELD relation mode. No late relation/tuple upgrade after evidence.
  IF target_kind='product' THEN
    LOCK TABLE public.products IN EXCLUSIVE MODE NOWAIT;
    SELECT to_jsonb(p) INTO old_row FROM public.products p WHERE id=target_id FOR UPDATE NOWAIT;
  ELSE
    LOCK TABLE public.customers IN ROW EXCLUSIVE MODE NOWAIT;
    SELECT to_jsonb(c) INTO old_row FROM public.customers c WHERE id=target_id FOR UPDATE NOWAIT;
  END IF;
  IF old_row IS NULL THEN
    RAISE EXCEPTION 'Catalogue target not found' USING ERRCODE='P0002', DETAIL='CATALOG_NOT_FOUND'; END IF;
  PERFORM private.catalog_assert_write_policy_v1(target_kind);
  PERFORM private.catalog_assert_write_row_v1(target_kind,old_row);
  IF (old_row->>'catalog_version')::bigint<>expected_version THEN
    RAISE EXCEPTION 'Catalogue version changed' USING ERRCODE='40001', DETAIL='CATALOG_VERSION_CONFLICT'; END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'catalog_identity_v1:'||target_kind||':'||target_id::text,1801427913)) THEN
    RAISE EXCEPTION 'Catalogue identity is busy' USING ERRCODE='55P03', DETAIL='CATALOG_IDENTITY_BUSY'; END IF;
  LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT;
  SELECT * INTO identity_row FROM private.catalog_identity_v1 WHERE kind=target_kind AND id=target_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR identity_row.last_version<>expected_version OR identity_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Catalogue tracking is incomplete' USING ERRCODE='23514', DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  IF identity_row.lifetime_state<>'unused' THEN
    RAISE EXCEPTION 'Catalogue deletion is blocked' USING ERRCODE='23514', DETAIL='CATALOG_DELETE_BLOCKED'; END IF;
  PERFORM private.catalog_assert_no_links_v1(target_kind,target_id);
  -- No child delete/update, cascading adapter or FK-action change is authorized.
  -- Zero complete links and the held final target lock precede the actual DELETE.
  BEGIN
    IF target_kind='customer' THEN DELETE FROM public.customers WHERE id=target_id;
    ELSE DELETE FROM public.products WHERE id=target_id; END IF;
    GET DIAGNOSTICS affected=ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'Catalogue deletion is blocked' USING ERRCODE='23514', DETAIL='CATALOG_DELETE_BLOCKED';
  END;
  IF affected<>1 THEN
    RAISE EXCEPTION 'Catalogue delete was not applied' USING ERRCODE='23514', DETAIL='CATALOG_IDENTITY_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE kind=target_kind AND id=target_id
    AND lifetime_state='unused' AND last_version=expected_version AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Catalogue tombstone is missing' USING ERRCODE='23514', DETAIL='CATALOG_TRACKING_INCOMPLETE'; END IF;
  result:=jsonb_build_object('version',1,'request_id',p_request_id,'actor_id',actor,'operation','delete_unused','kind',target_kind,'id',target_id,
    'before',jsonb_build_object('catalog_version',old_row->>'catalog_version','is_enabled',old_row->'is_enabled'),
    'after',NULL,'committed_at',statement_timestamp());
  UPDATE private.catalog_requests_v1 SET status='committed',receipt=result WHERE actor_id=actor AND request_id=p_request_id AND status='pending';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Catalogue receipt missing' USING ERRCODE='23514', DETAIL='CATALOG_REQUEST_CONFLICT'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION private.catalog_create_scope_empty_v1(),
  private.catalog_create_scope_enter_v1(uuid,text,uuid),private.catalog_create_scope_leave_v1(),
  private.catalog_create_unused_allowed_v1(text,uuid),private.catalog_create_birth_verified_v1(text,uuid),
  private.catalog_identity_guard_v1(),private.catalog_delete_unused_v1(uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

DO $catalog_guarded_delete_acl_postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
    pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN ('private.catalog_create_scope_empty_v1()'::regprocedure,
      'private.catalog_create_scope_enter_v1(uuid,text,uuid)'::regprocedure,
      'private.catalog_create_scope_leave_v1()'::regprocedure,
      'private.catalog_create_unused_allowed_v1(text,uuid)'::regprocedure,
      'private.catalog_create_birth_verified_v1(text,uuid)'::regprocedure,
      'private.catalog_identity_guard_v1()'::regprocedure,
      'private.catalog_delete_unused_v1(uuid,jsonb)'::regprocedure) AND a.grantee<>p.proowner)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL
      pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid='private.catalog_create_scope_v1'::regclass AND a.grantee<>c.relowner) THEN
    RAISE EXCEPTION 'Unexpected catalogue deletion ACL' USING ERRCODE='42501'; END IF;
END $catalog_guarded_delete_acl_postflight$;

-- Narrow guarded-delete readiness, separate from the existing v2 eligibility
-- modes. It exposes no gate state, history, dependency, or raw DELETE authority.
CREATE FUNCTION public.pilot_catalog_delete_access_v1() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; customer_allowed boolean:=false; product_allowed boolean:=false;
BEGIN
  actor:=private.catalog_authorize_v1(NULL,NULL);
  IF public.current_user_role()='co_admin' AND EXISTS(SELECT 1 FROM private.catalog_cutover_v1
      WHERE singleton AND execution_generation=2 AND tracking_ready) THEN
    BEGIN
      PERFORM private.catalog_authorize_bound_v1('{"operation":"delete_unused","kind":"customer"}'::jsonb,NULL);
      customer_allowed:=true;
    EXCEPTION WHEN insufficient_privilege THEN customer_allowed:=false;
    END;
    BEGIN
      PERFORM private.catalog_authorize_bound_v1('{"operation":"delete_unused","kind":"product"}'::jsonb,NULL);
      product_allowed:=true;
    EXCEPTION WHEN insufficient_privilege THEN product_allowed:=false;
    END;
  END IF;
  RETURN jsonb_build_object('version',1,'actor_id',actor,'customer_delete',customer_allowed,'product_delete',product_allowed);
END $$;
REVOKE ALL ON FUNCTION public.pilot_catalog_delete_access_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pilot_catalog_delete_access_v1() TO authenticated;
DO $catalog_delete_access_acl_postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
    pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid='public.pilot_catalog_delete_access_v1()'::regprocedure AND a.grantee<>p.proowner
      AND NOT(a.grantee='authenticated'::regrole::oid AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)) THEN
    RAISE EXCEPTION 'Unexpected catalogue readiness ACL' USING ERRCODE='42501'; END IF;
END $catalog_delete_access_acl_postflight$;
