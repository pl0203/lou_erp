-- Fictional generation-one compatibility observation, not global tracking proof.
-- Run only in the source-bound target runtime's single rollback transaction.
-- Its earlier target-only variant has a nullable SET NULL customer FK; this
-- fragment leaves that fixture variant intact and changes no production FK.
-- Independently authored values and public fixture behavior only. No hosted data.
-- The one explicit service table grant below is a fictional test-only variant;
-- the runner verifies its absence again after rolling back this whole session.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton),'raw compatibility requires inactive generation one');
INSERT INTO auth.users(id) SELECT md5('raw-compat-actor-'||n)::uuid FROM generate_series(1,4)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT md5('raw-compat-actor-'||n)::uuid,'Fictional raw actor '||n,'raw-compat-'||n||'@example.invalid',
 (ARRAY['executive','po_admin','sales_person','sales_head'])[n]::public.user_role,true FROM generate_series(1,4)n;

-- Representative Girard customer and offline bulk-import column interfaces.
-- Use an executive for these writes; this does not certify salesperson write
-- authorization on any hosted policy. Sales actors below only own/visit stores.
-- Authenticated writes remain direct, without RPC migration or server columns.
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.customers(id,name,address,city,phone,email,pricing_tier,visit_frequency_days,customer_category) VALUES
 (md5('raw-compat-import-customer')::uuid,'Fictional Import Store','1 Example Lane','Example City','000-000','store@example.invalid','luar_kota',7,'perorangan');
UPDATE public.customers SET name='Fictional Import Store Revised',visit_frequency_days=14,last_visit_date='2096-01-01' WHERE id=md5('raw-compat-import-customer')::uuid;
INSERT INTO public.products(id,name,sku,size,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan) VALUES
 (md5('raw-compat-import-product')::uuid,'Fictional Import Product','RAW-COMPAT-IMPORT','small',0,NULL,0,NULL,0),
 (md5('raw-compat-delete-executive')::uuid,'Fictional Executive Delete','RAW-COMPAT-DELETE-EXEC','small',0,0,0,0,0),
 (md5('raw-compat-delete-po')::uuid,'Fictional PO Delete','RAW-COMPAT-DELETE-PO','small',0,0,0,0,0);
UPDATE public.products SET name='Fictional Import Product Revised',unit_price=7,luar_kota=NULL WHERE id=md5('raw-compat-import-product')::uuid;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.customers(id,name,visit_frequency_days,customer_category) VALUES(md5('raw-compat-girard-customer')::uuid,'Fictional Girard Store',7,'perorangan');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(md5('raw-compat-girard-customer')::uuid,md5('raw-compat-actor-3')::uuid,md5('raw-compat-actor-1')::uuid);
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
UPDATE public.customers SET name='Fictional Girard Store Revised',visit_frequency_days=21 WHERE id=md5('raw-compat-girard-customer')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=3 AND bool_and(catalog_version=2) FROM (
 SELECT catalog_version FROM public.customers WHERE id IN(md5('raw-compat-import-customer')::uuid,md5('raw-compat-girard-customer')::uuid)
 UNION ALL SELECT catalog_version FROM public.products WHERE id=md5('raw-compat-import-product')::uuid) x),'authenticated raw master writes retain automatic versions');
SELECT pg_temp.foundation_assert((SELECT count(*)=3 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1 WHERE
 (kind='customer' AND id IN(md5('raw-compat-import-customer')::uuid,md5('raw-compat-girard-customer')::uuid))
 OR (kind='product' AND id=md5('raw-compat-import-product')::uuid)),'raw master creation and edits do not invent unused provenance');

-- Existing customer_targets upsert, then true privileged OLD/NEW reparent.
INSERT INTO public.customers(id,name) SELECT md5('raw-compat-'||label)::uuid,'Fictional '||label FROM unnest(ARRAY[
 'target-old','target-new','girard-old','girard-new','po-old','po-new','visit-old','visit-new','request-old','request-new','unrelated']) label;
INSERT INTO public.products(id,name,sku) SELECT md5('raw-compat-'||label)::uuid,'Fictional '||label,'RAW-COMPAT-'||label FROM unnest(ARRAY['girard-product-old','girard-product-new','po-product-old','po-product-new']) label;
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO public.customer_targets(id,customer_id,year_month,target_value,set_by) VALUES(md5('raw-compat-target')::uuid,md5('raw-compat-target-old')::uuid,'2096-02',3,auth.uid())
 ON CONFLICT(customer_id,year_month) DO UPDATE SET target_value=excluded.target_value,set_by=excluded.set_by;
INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by) VALUES(md5('raw-compat-target-old')::uuid,'2096-02',17,auth.uid())
 ON CONFLICT(customer_id,year_month) DO UPDATE SET target_value=excluded.target_value,set_by=excluded.set_by;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT target_value=17 FROM public.customer_targets WHERE id=md5('raw-compat-target')::uuid),'authenticated customer target upsert retains conflict semantics');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('raw-compat-target-new')::uuid),'reparent destination is unknown before actual service event');
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN IF current_user<>'service_role' OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Actual null-JWT service role required'; END IF; END $$;
UPDATE public.customer_targets SET customer_id=md5('raw-compat-target-new')::uuid,set_by=md5('raw-compat-actor-4')::uuid WHERE id=md5('raw-compat-target')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT customer_id=md5('raw-compat-target-new')::uuid AND set_by=md5('raw-compat-actor-4')::uuid FROM public.customer_targets WHERE id=md5('raw-compat-target')::uuid),'actual service target UPDATE reaches NEW customer and explicit setter');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('raw-compat-target-old')::uuid,md5('raw-compat-target-new')::uuid)),'service target reparent OLD and NEW are marked by UPDATE before DELETE');
SET LOCAL ROLE service_role;
DELETE FROM public.customer_targets WHERE id=md5('raw-compat-target')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('raw-compat-target-old')::uuid,md5('raw-compat-target-new')::uuid)),'service target reparent OLD and NEW both retain use after DELETE');

-- This public fixture creates visit_requests after its broad service grant.
-- Preserve that baseline denial, then add only a rollback-owned fictional variant.
SELECT pg_temp.foundation_assert(NOT has_table_privilege('service_role','public.visit_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'service visit request variant starts without effective privileges');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN INSERT INTO public.visit_requests(requester_id,kind,customer_id,scheduled_date) VALUES(md5('raw-compat-actor-3')::uuid,'new',md5('raw-compat-request-old')::uuid,'2096-03-01'); RAISE EXCEPTION 'Expected baseline denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.visit_requests TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO public.visit_requests(id,requester_id,kind,customer_id,scheduled_date) VALUES(md5('raw-compat-request')::uuid,md5('raw-compat-actor-3')::uuid,'new',md5('raw-compat-request-old')::uuid,'2096-03-01');
UPDATE public.visit_requests SET customer_id=md5('raw-compat-request-new')::uuid WHERE id=md5('raw-compat-request')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT customer_id=md5('raw-compat-request-new')::uuid FROM public.visit_requests WHERE id=md5('raw-compat-request')::uuid),'fictional service request reparent reaches actual NEW customer');
SET LOCAL ROLE service_role;
DELETE FROM public.visit_requests WHERE id=md5('raw-compat-request')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM public.visit_requests WHERE id=md5('raw-compat-request')::uuid),'fictional granted service visit request insert update delete interface survives');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('raw-compat-request-old')::uuid,md5('raw-compat-request-new')::uuid)),'raw visit request OLD and NEW remain unknown: activation blocker');

-- Raw service Girard reparent is permitted with no JWT. No v2 context is forged.
SET LOCAL ROLE service_role;
INSERT INTO public.girard_orders(id,customer_id,submitted_by) VALUES
 (md5('raw-compat-girard-order-old')::uuid,md5('raw-compat-girard-old')::uuid,md5('raw-compat-actor-3')::uuid),
 (md5('raw-compat-girard-order-new')::uuid,md5('raw-compat-girard-new')::uuid,md5('raw-compat-actor-3')::uuid);
INSERT INTO public.girard_order_items(id,order_id,product_id,product_name,quantity,unit_price) VALUES(md5('raw-compat-girard-line')::uuid,md5('raw-compat-girard-order-old')::uuid,md5('raw-compat-girard-product-old')::uuid,'Fictional line',1,7);
UPDATE public.girard_orders SET customer_id=md5('raw-compat-girard-new')::uuid WHERE id=md5('raw-compat-girard-order-old')::uuid;
UPDATE public.girard_order_items SET order_id=md5('raw-compat-girard-order-new')::uuid,product_id=md5('raw-compat-girard-product-new')::uuid WHERE id=md5('raw-compat-girard-line')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT customer_id=md5('raw-compat-girard-new')::uuid FROM public.girard_orders WHERE id=md5('raw-compat-girard-order-old')::uuid)
 AND (SELECT order_id=md5('raw-compat-girard-order-new')::uuid AND product_id=md5('raw-compat-girard-product-new')::uuid FROM public.girard_order_items WHERE id=md5('raw-compat-girard-line')::uuid),'service raw order and line reparent changes both actual destination keys');
SELECT pg_temp.foundation_assert((SELECT count(*)=4 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1 WHERE
 (kind='customer' AND id IN(md5('raw-compat-girard-old')::uuid,md5('raw-compat-girard-new')::uuid)) OR
 (kind='product' AND id IN(md5('raw-compat-girard-product-old')::uuid,md5('raw-compat-girard-product-new')::uuid))),'raw Girard OLD and NEW remain unknown: activation blocker');

-- The inherited PO audit needs a real actor even for service DML. Exercise that
-- contract separately from null-JWT service writes; preserve its failure mode.
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-1')::uuid::text,true);
SET LOCAL ROLE service_role;
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status) VALUES
 (md5('raw-compat-po-old')::uuid,md5('raw-compat-po-old')::uuid,md5('raw-compat-actor-1')::uuid,'RAW-COMPAT-PO-OLD','draft'),
 (md5('raw-compat-po-new')::uuid,md5('raw-compat-po-new')::uuid,md5('raw-compat-actor-1')::uuid,'RAW-COMPAT-PO-NEW','draft');
INSERT INTO public.po_line_items(id,purchase_order_id,product_id,product_name,quantity,unit_price) VALUES(md5('raw-compat-po-line')::uuid,md5('raw-compat-po-old')::uuid,md5('raw-compat-po-product-old')::uuid,'Fictional PO line',2,7);
UPDATE public.po_line_items SET purchase_order_id=md5('raw-compat-po-new')::uuid,product_id=md5('raw-compat-po-product-new')::uuid,quantity=3 WHERE id=md5('raw-compat-po-line')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT total_value=21 FROM public.purchase_orders WHERE id=md5('raw-compat-po-new')::uuid),'nested PO total update reaches NEW parent');
SELECT pg_temp.foundation_assert((SELECT total_value=14 FROM public.purchase_orders WHERE id=md5('raw-compat-po-old')::uuid),'public fixture coalesce recalculation leaves OLD parent stale: inherited compatibility limitation');
SELECT pg_temp.foundation_assert((SELECT count(*)=4 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1 WHERE
 (kind='customer' AND id IN(md5('raw-compat-po-old')::uuid,md5('raw-compat-po-new')::uuid)) OR
 (kind='product' AND id IN(md5('raw-compat-po-product-old')::uuid,md5('raw-compat-po-product-new')::uuid))),'raw PO OLD and NEW remain unknown: activation blocker');
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE failed_schema text; failed_table text; failed_column text; BEGIN
 BEGIN UPDATE public.po_line_items SET quantity=4 WHERE id=md5('raw-compat-po-line')::uuid; RAISE EXCEPTION 'Expected actor-required audit failure';
 EXCEPTION WHEN not_null_violation THEN
  GET STACKED DIAGNOSTICS failed_schema=SCHEMA_NAME,failed_table=TABLE_NAME,failed_column=COLUMN_NAME;
  IF ROW(failed_schema,failed_table,failed_column) IS DISTINCT FROM ROW('public'::text,'po_audit_log'::text,'changed_by'::text) THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT quantity=3 FROM public.po_line_items WHERE id=md5('raw-compat-po-line')::uuid),'null-JWT service PO audit failure rolls back the line write');

-- Existing delivery CASCADE removes the child; audit/history and master identity
-- remain. This is not a newly invented catalogue cascade or delete API.
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-1')::uuid::text,true);
SET LOCAL ROLE service_role;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES(md5('raw-compat-sj')::uuid,md5('raw-compat-po-new')::uuid,'RAW-COMPAT-SJ','2096-04-01',md5('raw-compat-actor-1')::uuid);
INSERT INTO public.sj_line_items(id,surat_jalan_id,po_line_item_id,quantity_delivered) VALUES(md5('raw-compat-sj-line')::uuid,md5('raw-compat-sj')::uuid,md5('raw-compat-po-line')::uuid,1);
SET CONSTRAINTS ALL IMMEDIATE;
DELETE FROM public.surat_jalan WHERE id=md5('raw-compat-sj')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM public.sj_line_items WHERE id=md5('raw-compat-sj-line')::uuid)
 AND EXISTS(SELECT 1 FROM public.po_audit_log WHERE purchase_order_id=md5('raw-compat-po-new')::uuid AND field_changed='fixture_delivery_write'),'existing delivery cascade preserves parent audit history');
SET CONSTRAINTS ALL DEFERRED;

-- Photo completion performs real nested customer/schedule updates. Reparent the
-- unvisited schedule first; historical OLD and live NEW customers are distinct.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES(md5('raw-compat-schedule')::uuid,md5('raw-compat-visit-old')::uuid,md5('raw-compat-actor-3')::uuid,md5('raw-compat-actor-1')::uuid,'2096-05-01');
UPDATE public.sales_schedules SET outlet_id=md5('raw-compat-visit-new')::uuid WHERE id=md5('raw-compat-schedule')::uuid;
INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id,schedule_id,checked_in_at) VALUES(md5('raw-compat-visit')::uuid,md5('raw-compat-visit-new')::uuid,md5('raw-compat-actor-3')::uuid,md5('raw-compat-schedule')::uuid,'2096-05-01T12:00:00Z');
INSERT INTO public.visit_photos(id,visit_id,storage_path) VALUES(md5('raw-compat-photo')::uuid,md5('raw-compat-visit')::uuid,'visits/fictional-raw-compat/photo.png');
DO $$ BEGIN
 BEGIN DELETE FROM public.sales_schedules WHERE id=md5('raw-compat-schedule')::uuid; RAISE EXCEPTION 'Expected visited-history refusal';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT last_visit_date='2096-05-01' AND catalog_version=2 FROM public.customers WHERE id=md5('raw-compat-visit-new')::uuid)
 AND (SELECT last_visit_date IS NULL AND catalog_version=1 FROM public.customers WHERE id=md5('raw-compat-visit-old')::uuid)
 AND (SELECT status='completed' FROM public.sales_schedules WHERE id=md5('raw-compat-schedule')::uuid),'nested photo completion updates only actual NEW customer and retains visited schedule');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('raw-compat-visit-old')::uuid,md5('raw-compat-visit-new')::uuid)),'raw visit OLD and NEW remain unknown: activation blocker');

-- Direct deletion stays available to PO/Executive without CO unused provenance.
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
DELETE FROM public.products WHERE id=md5('raw-compat-delete-executive')::uuid;
SELECT pg_temp.foundation_raises($q$DELETE FROM public.products WHERE id=md5('raw-compat-po-product-new')::uuid$q$,'23503','original product FK restriction survives');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('raw-compat-actor-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
DELETE FROM public.products WHERE id=md5('raw-compat-delete-po')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='unknown' AND deleted_at IS NOT NULL) FROM private.catalog_identity_v1 WHERE kind='product' AND id IN(md5('raw-compat-delete-executive')::uuid,md5('raw-compat-delete-po')::uuid)),'direct product delete retains tombstone without changing lifetime provenance');

-- Business TRUNCATE has no row events: it preserves the raw table operation but
-- cannot stand in for lifetime enforcement. Master truncation still fails closed.
SET CONSTRAINTS ALL IMMEDIATE;
CREATE TEMP TABLE raw_compat_identity_before_truncate ON COMMIT DROP AS SELECT * FROM private.catalog_identity_v1;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO public.visit_requests(id,requester_id,kind,customer_id,scheduled_date) VALUES(md5('raw-compat-truncate-request')::uuid,md5('raw-compat-actor-3')::uuid,'new',md5('raw-compat-request-old')::uuid,'2096-06-01');
TRUNCATE public.customer_targets,public.visit_requests;
RESET ROLE;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM public.customer_targets) AND NOT EXISTS(SELECT 1 FROM public.visit_requests),'fictional service business TRUNCATE succeeds');
SELECT pg_temp.foundation_assert(NOT EXISTS((SELECT * FROM private.catalog_identity_v1 EXCEPT SELECT * FROM pg_temp.raw_compat_identity_before_truncate)
 UNION ALL (SELECT * FROM pg_temp.raw_compat_identity_before_truncate EXCEPT SELECT * FROM private.catalog_identity_v1)),'business TRUNCATE is not lifetime certification: identity evidence unchanged');
SELECT pg_temp.foundation_raises($q$TRUNCATE public.products CASCADE$q$,'23514','master TRUNCATE remains refused by retained identity boundary');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('raw-compat-unrelated')::uuid),'unrelated identity never becomes falsely used');
SELECT pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton),'legacy raw compatibility does not activate incomplete tracking');
SET CONSTRAINTS ALL DEFERRED;
