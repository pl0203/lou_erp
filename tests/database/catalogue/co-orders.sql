-- Fictional rollback-only actual-role probes. No production global activation.
SELECT pg_temp.foundation_assert((SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex')='2fe1a0188e2d64eaadce590c947e4358ac6e620117b5470abde87eb8dd6fdace' FROM pg_proc WHERE oid='private.catalog_co_legacy_transaction_v1(uuid,text,jsonb)'::regprocedure),'final composed CO gen1 body remains exact');
SELECT pg_temp.foundation_assert((SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex')='0442408fd2b5cee0326495e155f75f62ae96a30bd02e1888fcebdb3204ddf61f' FROM pg_proc WHERE oid='private.co_monthly_transaction_v1(uuid,text,jsonb)'::regprocedure),'stage08 monthly evidence hook remains intact');
CREATE FUNCTION pg_temp.catalog_co_test_call(request uuid,operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.catalog_co_transaction_core_v2(request,operation,payload); END $$;
CREATE FUNCTION pg_temp.catalog_co_test_gate(request uuid,operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.catalog_co_transaction_v2(request,operation,payload); END $$;
CREATE FUNCTION pg_temp.catalog_co_binding(co uuid,lines jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('co_id',o.id,'expected_co_version',o.version::text,'expected_customer_version',s.version::text,
 'lines',coalesce(lines,(SELECT jsonb_agg(jsonb_build_object('id',l.id,'ordered_quantity',l.ordered_quantity) ORDER BY l.id) FROM private.co_order_lines l WHERE l.co_id=o.id)))
 FROM private.co_orders o JOIN private.co_customer_state s ON s.customer_id=o.customer_id WHERE o.id=co
$$;
REVOKE ALL ON FUNCTION pg_temp.catalog_co_test_call(uuid,text,jsonb),pg_temp.catalog_co_test_gate(uuid,text,jsonb),pg_temp.catalog_co_binding(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.catalog_co_test_call(uuid,text,jsonb),pg_temp.catalog_co_test_gate(uuid,text,jsonb),pg_temp.catalog_co_binding(uuid,jsonb) TO authenticated;
CREATE TEMP TABLE catalogue_co_results(label text PRIMARY KEY,request_id uuid,operation text,payload jsonb,result jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON pg_temp.catalogue_co_results TO authenticated;
-- The earlier role suite intentionally leaves its CO actor inactive and
-- reassigned to PO. This suite owns a separate actor, including revocation tests.
INSERT INTO auth.users(id) VALUES(md5('co-guard-actor')::uuid);
INSERT INTO public.users(id,full_name,email,role,is_active)
VALUES(md5('co-guard-actor')::uuid,'Fictional CO guard actor','co-guard@example.invalid','co_admin',true);
SELECT pg_temp.foundation_assert((SELECT role='co_admin' AND is_active FROM public.users WHERE id=md5('co-guard-actor')::uuid),'dedicated CO fixture starts active with CO authority');
INSERT INTO public.customers(id,name,customer_category) VALUES(md5('co-guard-customer')::uuid,'Fictional CO guard customer','perorangan'),(md5('co-guard-other')::uuid,'Fictional second CO customer','perorangan');
INSERT INTO public.products(id,name,sku) VALUES(md5('co-guard-product-a')::uuid,'Saved catalogue A','CO-GUARD-A'),(md5('co-guard-product-b')::uuid,'Saved catalogue B','CO-GUARD-B');
SELECT set_config('request.jwt.claim.sub',md5('co-guard-actor')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT private.catalog_co_transaction_core_v2(md5('co-direct-core')::uuid,'create_co','{}')$q$,'42501','authenticated cannot call admitted CO core');
SELECT pg_temp.foundation_raises($q$SELECT private.catalog_co_command_begin_v2(md5('co-direct-begin')::uuid,'create_co','{}')$q$,'42501','authenticated cannot call v2 begin');
SELECT pg_temp.foundation_raises($q$INSERT INTO private.catalog_co_active_v2 VALUES(pg_backend_pid(),txid_current())$q$,'42501','authenticated cannot establish CO scope');
SELECT pg_temp.foundation_assert(NOT private.catalog_co_active_v2(),'context predicate false outside CO core');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_test_gate(md5('co-production-gate')::uuid,'create_co','{}')$q$,'55000','CO production admission remains unavailable');
DO $$ DECLARE payload jsonb; bad jsonb; result jsonb; n integer; BEGIN
 payload:=jsonb_build_object('customer_id',md5('co-guard-customer')::uuid,'expected_customer_version','1','co_number','FICTIONAL-CO-GUARD','order_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,
 'lines',(SELECT jsonb_agg(j ORDER BY j->>'product_id' DESC) FROM (VALUES
 (jsonb_build_object('id',md5('co-guard-line-a')::uuid,'product_id',md5('co-guard-product-a')::uuid,'sku','CO-GUARD-A','product_name','Document A','ordered_quantity',4,'unit_price','0')),
 (jsonb_build_object('id',md5('co-guard-line-b')::uuid,'product_id',md5('co-guard-product-b')::uuid,'sku','CO-GUARD-B','product_name','Document B','ordered_quantity',3,'unit_price','12.50'))) x(j)));
 FOR n IN 1..5 LOOP
  bad:=CASE n WHEN 1 THEN jsonb_set(payload,'{lines,0,product_id}','null') WHEN 2 THEN jsonb_set(payload,'{lines,0,product_id}',to_jsonb(md5('co-missing-product')::uuid)) WHEN 3 THEN jsonb_set(payload,'{lines,0,sku}','"WRONG"') WHEN 4 THEN jsonb_set(payload,'{lines,0}',jsonb_build_object('id',md5('fabricated-historical-line')::uuid,'ordered_quantity',1)) ELSE payload||'{"generation":2}'::jsonb END;
  PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-invalid-'||n)::uuid,'create_co',bad),CASE n WHEN 2 THEN '23514' ELSE '22023' END,'new null missing canonical SKU fabricated historical and client hint refused');
 END LOOP;
 result:=pg_temp.catalog_co_test_call(md5('co-create')::uuid,'create_co',payload);
 INSERT INTO pg_temp.catalogue_co_results VALUES('create',md5('co-create')::uuid,'create_co',payload,result);
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT execution_version=2 FROM private.co_commands WHERE request_id=md5('co-create')::uuid),'new CO admitted core explicitly writes generation two');
SELECT pg_temp.foundation_assert((SELECT unit_price=0 FROM private.co_order_lines WHERE id=md5('co-guard-line-a')::uuid),'CO agreed zero price retained');
SELECT pg_temp.foundation_assert((SELECT count(*)=3 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1 WHERE (kind='customer' AND id=md5('co-guard-customer')::uuid) OR (kind='product' AND id IN(md5('co-guard-product-a')::uuid,md5('co-guard-product-b')::uuid))),'reverse product input marks complete CO customer products');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id IN(SELECT md5('co-invalid-'||n)::uuid FROM generate_series(1,5)n)),'failed catalogue guards leave no CO admission');
UPDATE public.customers SET is_enabled=false WHERE id=md5('co-guard-customer')::uuid;
UPDATE public.products SET is_enabled=false,sku='CO-A-RENAMED' WHERE id=md5('co-guard-product-a')::uuid;
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_assert((SELECT public.pilot_co_transaction_v1(request_id,operation,payload)=result FROM pg_temp.catalogue_co_results WHERE label='create'),'exact committed public CO replay precedes mutable targets');
SELECT pg_temp.foundation_assert((SELECT pg_temp.catalog_co_test_gate(request_id,operation,payload)=result FROM pg_temp.catalogue_co_results WHERE label='create'),'exact CO receipt recovery precedes inactive generation gate');
DO $$ DECLARE o uuid; payload jsonb; BEGIN
 SELECT (result->>'id')::uuid INTO o FROM pg_temp.catalogue_co_results WHERE label='create';
 payload:=pg_temp.catalog_co_binding(o,jsonb_build_array(jsonb_build_object('id',md5('co-guard-line-a')::uuid,'ordered_quantity',4),jsonb_build_object('id',md5('co-guard-line-b')::uuid,'ordered_quantity',3)));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-disabled-increase')::uuid,'edit_co',jsonb_set(payload,'{lines,0,ordered_quantity}','5')),'23514','disabled customer caps each persisted line');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-pooling')::uuid,'edit_co',jsonb_set(jsonb_set(payload,'{lines,0,ordered_quantity}','5'),'{lines,1,ordered_quantity}','2')),'23514','disabled quantities cannot pool across lines');
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-relabel')::uuid,'edit_co',jsonb_set(payload,'{lines,0,product_name}','"Changed"')),'22023','persisted CO key label and price are not editable');
 PERFORM pg_temp.catalog_co_test_call(md5('co-disabled-retain')::uuid,'edit_co',payload);
END $$;
RESET ROLE;
UPDATE public.customers SET is_enabled=true WHERE id=md5('co-guard-customer')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'),jsonb_build_array(jsonb_build_object('id',md5('co-guard-line-a')::uuid,'ordered_quantity',5),jsonb_build_object('id',md5('co-guard-line-b')::uuid,'ordered_quantity',3)));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-product-cap')::uuid,'edit_co',payload),'23514','disabled product own cap survives enabled customer');
END $$;
RESET ROLE;
UPDATE public.products SET is_enabled=true,name='Current catalogue A' WHERE id=md5('co-guard-product-a')::uuid;
SET LOCAL ROLE authenticated;
SELECT pg_temp.catalog_co_test_call(md5('co-renamed-history')::uuid,'edit_co',pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'),jsonb_build_array(jsonb_build_object('id',md5('co-guard-line-a')::uuid,'ordered_quantity',5),jsonb_build_object('id',md5('co-guard-line-b')::uuid,'ordered_quantity',3))));
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT l.ordered_quantity=5 AND l.unit_price=0 AND k.product_name='Saved catalogue A' AND k.display_sku='CO-GUARD-A' FROM private.co_order_lines l JOIN private.co_stock_keys k ON k.id=l.stock_key_id WHERE l.id=md5('co-guard-line-a')::uuid),'retained enabled historical identity allows increase after catalogue SKU rename');
-- A new selected use cannot reuse an old SKU before checking current canonical identity.
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-new-stock-line')::uuid,'product_id',md5('co-guard-product-a')::uuid,'sku','CO-GUARD-A','product_name','New document label','ordered_quantity',1,'unit_price','7.25')));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-key-canonical-first')::uuid,'edit_co',payload),'22023','canonical SKU checked before existing customer SKU key reuse');
END $$;
RESET ROLE;
UPDATE public.products SET sku='CO-GUARD-A' WHERE id=md5('co-guard-product-a')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-new-stock-line')::uuid,'product_id',md5('co-guard-product-a')::uuid,'sku','CO-GUARD-A','product_name','Ignored new label','ordered_quantity',1,'unit_price','7.25')));
 PERFORM pg_temp.catalog_co_test_call(md5('co-key-same-product')::uuid,'edit_co',payload);
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT a.stock_key_id=b.stock_key_id AND b.unit_price=7.25 AND k.product_name='Saved catalogue A' FROM private.co_order_lines a JOIN private.co_order_lines b ON b.id=md5('co-new-stock-line')::uuid JOIN private.co_stock_keys k ON k.id=a.stock_key_id WHERE a.id=md5('co-guard-line-a')::uuid),'same product reuses immutable saved key label and requested agreed price');
-- Remove a no-history line through the actual writer; neither quantity-only nor
-- full new-line form may reuse its identity, including for another customer.
SET LOCAL ROLE authenticated;
SELECT pg_temp.catalog_co_test_call(md5('co-remove-line')::uuid,'edit_co',pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'),jsonb_build_array(jsonb_build_object('id',md5('co-guard-line-a')::uuid,'ordered_quantity',5),jsonb_build_object('id',md5('co-guard-line-b')::uuid,'ordered_quantity',3))));
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-new-stock-line')::uuid,'product_id',md5('co-guard-product-a')::uuid,'sku','CO-GUARD-A','product_name','Saved catalogue A','ordered_quantity',1,'unit_price','0')));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-reuse-removed')::uuid,'edit_co',payload),'22023','removed CO line UUID cannot be reused');
END $$;
RESET ROLE;
-- Legacy null keys are genuine saved history, not a caller flag.
INSERT INTO private.co_stock_keys(id,customer_id,display_sku,product_id,product_name) VALUES(md5('co-legacy-null-key')::uuid,md5('co-guard-customer')::uuid,'LEGACY-NULL',NULL,'Saved manual CO label');
INSERT INTO private.co_order_lines(id,co_id,customer_id,stock_key_id,ordered_quantity,unit_price)
SELECT md5('co-legacy-null-line')::uuid,(result->>'id')::uuid,md5('co-guard-customer')::uuid,md5('co-legacy-null-key')::uuid,2,0 FROM pg_temp.catalogue_co_results WHERE label='create';
INSERT INTO public.products(id,name,sku) VALUES(md5('co-null-key-selected')::uuid,'Selected enabled same SKU','LEGACY-NULL');
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',(SELECT jsonb_agg(CASE WHEN j->>'id'=md5('co-legacy-null-line')::uuid::text THEN jsonb_set(j,'{ordered_quantity}','3') ELSE j END) FROM jsonb_array_elements(payload->'lines') j));
 PERFORM pg_temp.catalog_co_test_call(md5('co-manual-increase')::uuid,'edit_co',payload);
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-null-key-new')::uuid,'product_id',md5('co-null-key-selected')::uuid,'sku','LEGACY-NULL','product_name','Selected enabled same SKU','ordered_quantity',1,'unit_price','0')));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-null-key-reuse')::uuid,'edit_co',payload),'22023','legacy null key blocks new selected use instead of relinking');
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT ordered_quantity=3 AND unit_price=0 FROM private.co_order_lines WHERE id=md5('co-legacy-null-line')::uuid),'enabled customer retains manual historical quantity rules');
UPDATE public.customers SET is_enabled=false WHERE id=md5('co-guard-customer')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',(SELECT jsonb_agg(CASE WHEN j->>'id'=md5('co-legacy-null-line')::uuid::text THEN jsonb_set(j,'{ordered_quantity}','4') ELSE j END) FROM jsonb_array_elements(payload->'lines') j));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-manual-cap')::uuid,'edit_co',payload),'23514','disabled customer caps each persisted manual line');
END $$;
RESET ROLE;
-- Fulfillment uses saved immutable identities despite disabled masters.
UPDATE public.products SET is_enabled=false WHERE id=md5('co-guard-product-a')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; result jsonb; o uuid; BEGIN
 SELECT (r.result->>'id')::uuid INTO o FROM pg_temp.catalogue_co_results r WHERE label='create';
 payload:=(pg_temp.catalog_co_binding(o)-'lines')||jsonb_build_object('sj_number','FICTIONAL-CO-SJ','sj_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,'lines',jsonb_build_array(jsonb_build_object('co_line_id',md5('co-guard-line-a')::uuid,'quantity',2)));
 result:=pg_temp.catalog_co_test_call(md5('co-save-sj')::uuid,'save_sj_draft',payload);
 INSERT INTO pg_temp.catalogue_co_results VALUES('sj-draft',md5('co-save-sj')::uuid,'save_sj_draft',payload,result);
 payload:=jsonb_build_object('draft_id',result->'id','expected_draft_version',result->'version','expected_customer_version',result->'customer_version','expected_co_version',pg_temp.catalog_co_binding(o)->'expected_co_version');
 result:=pg_temp.catalog_co_test_call(md5('co-post-sj')::uuid,'post_sj',payload);
 INSERT INTO pg_temp.catalogue_co_results VALUES('post-sj',md5('co-post-sj')::uuid,'post_sj',payload,result);
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT quantity=2 FROM private.co_delivery_revision_lines WHERE co_line_id=md5('co-guard-line-a')::uuid),'disabled catalogue masters do not block historical fulfillment');
SELECT pg_temp.foundation_assert((SELECT unit_price=0 FROM private.co_stock_batches WHERE co_line_id=md5('co-guard-line-a')::uuid),'delivery batch preserves agreed zero price');
-- Change the mutable classifier after commit. Exact receipt must still win.
UPDATE private.co_drafts SET payload=payload||jsonb_build_object('bound_delivery_head_id',(SELECT result->'id' FROM pg_temp.catalogue_co_results WHERE label='post-sj')) WHERE id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='sj-draft');
INSERT INTO public.products(id,name,sku) VALUES(md5('co-replay-unmarked')::uuid,'Fictional replay-only sentinel','CO-REPLAY-UNMARKED');
INSERT INTO private.co_stock_keys(id,customer_id,display_sku,product_id,product_name) VALUES(md5('co-replay-unmarked-key')::uuid,md5('co-guard-customer')::uuid,'CO-REPLAY-UNMARKED',md5('co-replay-unmarked')::uuid,'Fictional replay-only sentinel');
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_assert((SELECT public.pilot_co_transaction_v1(request_id,operation,payload)=result FROM pg_temp.catalogue_co_results WHERE label='post-sj'),'post_sj receipt replay precedes later correction draft classification');
SELECT pg_temp.foundation_assert((SELECT pg_temp.catalog_co_test_call(request_id,operation,payload)=result FROM pg_temp.catalogue_co_results WHERE label='post-sj'),'private admitted core also replays before classifier');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_transaction_v1(md5('co-post-sj')::uuid,'edit_co','{}')$q$,'22023','CO receipt operation mismatch refused before classification');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_evidence_transaction_v1(md5('co-post-sj')::uuid,'register_evidence','{}')$q$,'22023','order receipt cannot cross evidence command family');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_reconcile_co_evidence_v1(md5('co-post-sj')::uuid,false)$q$,'22023','reconciliation preserves order evidence family separation');
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('co-replay-unmarked')::uuid),'committed replay does not newly mark customer stock references');
-- Real returns and reviewed corrections run through the final composed stack.
INSERT INTO pg_temp.catalogue_co_results(label,request_id,operation,payload)
SELECT 'return-draft',md5('co-save-return')::uuid,'save_return_draft',jsonb_build_object('customer_id',s.customer_id,'expected_customer_version',s.version::text,'return_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,'reference','FICTIONAL-RETURN','lines',jsonb_build_array(jsonb_build_object('batch_id',b.id,'quantity',1)))
FROM private.co_customer_state s JOIN private.co_stock_batches b ON b.customer_id=s.customer_id WHERE b.co_line_id=md5('co-guard-line-a')::uuid;
SET LOCAL ROLE authenticated;
UPDATE pg_temp.catalogue_co_results SET result=pg_temp.catalog_co_test_call(request_id,operation,payload) WHERE label='return-draft';
DO $$ DECLARE payload jsonb; preview jsonb; result jsonb; BEGIN
 SELECT jsonb_build_object('draft_id',r.result->'id','expected_draft_version',r.result->'version','expected_customer_version',r.result->'customer_version','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb) INTO payload FROM pg_temp.catalogue_co_results r WHERE label='return-draft';
 preview:=public.pilot_co_preview_v1('post_return',payload);
 PERFORM pg_temp.foundation_assert(preview->>'can_post'='true','historical return preview remains valid');
 payload:=payload||jsonb_build_object('preview_fingerprint',preview->'preview_fingerprint');
 result:=pg_temp.catalog_co_test_call(md5('co-post-return')::uuid,'post_return',payload);
 INSERT INTO pg_temp.catalogue_co_results VALUES('post-return',md5('co-post-return')::uuid,'post_return',payload,result);
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=1 FROM private.co_return_revision_lines WHERE customer_id=md5('co-guard-customer')::uuid),'disabled-master historical return posts');
INSERT INTO pg_temp.catalogue_co_results(label,request_id,operation,payload)
SELECT 'correct-return',md5('co-correct-return')::uuid,'correct_return',jsonb_build_object('return_head_id',h.id,'original_revision_id',h.current_revision_id,'expected_return_version',h.version::text,'expected_customer_version',s.version::text,'action','void','reason','Fictional correction','completed_report_drafts','[]'::jsonb,'acknowledged_reopen_orders','[]'::jsonb)
FROM private.co_return_heads h JOIN private.co_customer_state s ON s.customer_id=h.customer_id WHERE h.id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='post-return');
SET LOCAL ROLE authenticated;
UPDATE pg_temp.catalogue_co_results SET payload=payload||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1(operation,payload)->'preview_fingerprint') WHERE label='correct-return';
UPDATE pg_temp.catalogue_co_results SET result=pg_temp.catalog_co_test_call(request_id,operation,payload) WHERE label='correct-return';
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT h.version=2 AND r.is_void FROM private.co_return_heads h JOIN private.co_return_revisions r ON r.id=h.current_revision_id WHERE h.id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='post-return')),'historical return correction keeps revision semantics');
-- Delivered/resolved minima are unchanged; catalogue caps never replace them.
SET LOCAL ROLE authenticated;
DO $$ DECLARE o uuid; payload jsonb; BEGIN
 SELECT (result->>'id')::uuid INTO o FROM pg_temp.catalogue_co_results WHERE label='create';
 payload:=pg_temp.catalog_co_binding(o);
 payload:=jsonb_set(payload,'{lines}',(SELECT jsonb_agg(CASE WHEN j->>'id'=md5('co-guard-line-a')::uuid::text THEN jsonb_set(j,'{ordered_quantity}','1') ELSE j END) FROM jsonb_array_elements(payload->'lines') j));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-delivered-minimum')::uuid,'edit_co',payload),'23514','delivered quantity minimum remains enforced');
 payload:=(pg_temp.catalog_co_binding(o)-'lines')||jsonb_build_object('reason','Fictional pending resolution','lines',jsonb_build_array(jsonb_build_object('co_line_id',md5('co-guard-line-a')::uuid,'quantity',1)));
 PERFORM pg_temp.catalog_co_test_call(md5('co-resolve')::uuid,'resolve_undelivered',payload);
 payload:=pg_temp.catalog_co_binding(o);
 payload:=jsonb_set(payload,'{lines}',(SELECT jsonb_agg(CASE WHEN j->>'id'=md5('co-guard-line-a')::uuid::text THEN jsonb_set(j,'{ordered_quantity}','2') ELSE j END) FROM jsonb_array_elements(payload->'lines') j));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-resolved-minimum')::uuid,'edit_co',payload),'23514','resolved plus delivered minimum remains enforced');
END $$;
RESET ROLE;
-- Final stage08 monthly publication, including its evidence link, is exercised.
INSERT INTO pg_temp.catalogue_co_results(label,request_id,operation,payload)
SELECT 'report-draft',md5('co-report-initialize')::uuid,'save_report_draft',jsonb_build_object('action','initialize','customer_id',customer_id,'expected_customer_version',version::text,'report_month',date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)
FROM private.co_customer_state WHERE customer_id=md5('co-guard-customer')::uuid;
SET LOCAL ROLE authenticated;
UPDATE pg_temp.catalogue_co_results SET result=pg_temp.catalog_co_test_call(request_id,operation,payload) WHERE label='report-draft';
RESET ROLE;
INSERT INTO pg_temp.catalogue_co_results(label,request_id,operation,payload)
SELECT 'report-fill',md5('co-report-fill')::uuid,'save_report_draft',jsonb_build_object('action','fill_remaining_zero','draft_id',d.id,'expected_draft_version',d.version::text,'expected_customer_version',s.version::text,'eligible_set_fingerprint',d.eligible_set_fingerprint)
FROM private.co_drafts d JOIN private.co_customer_state s ON s.customer_id=d.customer_id WHERE d.id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='report-draft');
SET LOCAL ROLE authenticated;
UPDATE pg_temp.catalogue_co_results SET result=pg_temp.catalog_co_test_call(request_id,operation,payload) WHERE label='report-fill';
RESET ROLE;
-- Synthetic owner-created finalized evidence is only a linkage fixture, never
-- a claim about provider object bytes or authorization to upload real evidence.
INSERT INTO private.co_evidence(id,customer_id,draft_id,draft_version,customer_version,report_month,created_by,request_id,mime_type,byte_size,sha256,version,finalized_draft_version)
SELECT md5('co-report-evidence')::uuid,d.customer_id,d.id,d.version,s.version,d.report_month,md5('co-guard-actor')::uuid,md5('co-report-fill')::uuid,'application/pdf',1,repeat('a',64),2,d.version+1
FROM private.co_drafts d JOIN private.co_customer_state s ON s.customer_id=d.customer_id WHERE d.id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='report-draft');
UPDATE private.co_drafts SET evidence_id=md5('co-report-evidence')::uuid WHERE id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='report-draft');
INSERT INTO pg_temp.catalogue_co_results(label,request_id,operation,payload)
SELECT 'post-report',md5('co-post-report')::uuid,'post_report',jsonb_build_object('draft_id',d.id,'expected_draft_version',d.version::text,'expected_customer_version',s.version::text,'eligible_set_fingerprint',d.eligible_set_fingerprint)
FROM private.co_drafts d JOIN private.co_customer_state s ON s.customer_id=d.customer_id WHERE d.id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='report-draft');
SET LOCAL ROLE authenticated;
UPDATE pg_temp.catalogue_co_results SET payload=payload||jsonb_build_object('preview_fingerprint',public.pilot_co_preview_v1(operation,payload)->'preview_fingerprint') WHERE label='post-report';
UPDATE pg_temp.catalogue_co_results SET result=pg_temp.catalog_co_test_call(request_id,operation,payload) WHERE label='post-report';
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=1 FROM private.co_report_evidence WHERE evidence_id=md5('co-report-evidence')::uuid),'final stage08 monthly publication links evidence');
SELECT pg_temp.foundation_assert((SELECT bool_and(unit_price=0) FROM private.co_stock_batches WHERE co_line_id=md5('co-guard-line-a')::uuid),'reports and corrections never rewrite saved batch prices');
-- No new order or line for a disabled customer, even with a selected enabled product.
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=jsonb_build_object('customer_id',md5('co-guard-customer')::uuid,'expected_customer_version',(pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'))->'expected_customer_version'),'co_number','FICTIONAL-CO-DISABLED','order_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,'lines',jsonb_build_array(jsonb_build_object('id',md5('co-disabled-new-line')::uuid,'product_id',md5('co-guard-product-b')::uuid,'sku','CO-GUARD-B','product_name','Saved B','ordered_quantity',1,'unit_price','0')));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-disabled-new-order')::uuid,'create_co',payload),'23514','disabled customer new CO refused');
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-disabled-new-line')::uuid,'product_id',md5('co-guard-product-b')::uuid,'sku','CO-GUARD-B','product_name','Saved B','ordered_quantity',1,'unit_price','0')));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-disabled-new-line-request')::uuid,'edit_co',payload),'23514','disabled customer cannot split or add lines');
END $$;
RESET ROLE;
UPDATE public.customers SET is_enabled=true WHERE id=md5('co-guard-customer')::uuid;
UPDATE public.products SET sku='CO-A-LATER' WHERE id=md5('co-guard-product-a')::uuid;
INSERT INTO public.products(id,name,sku) VALUES(md5('co-other-product-same-key')::uuid,'Different selected product','CO-GUARD-A');
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-different-key-new')::uuid,'product_id',md5('co-other-product-same-key')::uuid,'sku','CO-GUARD-A','product_name','Different selected product','ordered_quantity',1,'unit_price','0')));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-different-key')::uuid,'edit_co',payload),'22023','different product ID on existing stock key blocks new use');
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT product_id=md5('co-guard-product-a')::uuid AND product_name='Saved catalogue A' FROM private.co_stock_keys WHERE customer_id=md5('co-guard-customer')::uuid AND normalized_sku='co-guard-a'),'stock key is never relinked to selected identity');
-- Historical missing-master behavior matches the approved PO precedent.
DELETE FROM public.products WHERE id=md5('co-guard-product-b')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',(SELECT jsonb_agg(CASE WHEN j->>'id'=md5('co-guard-line-b')::uuid::text THEN jsonb_set(j,'{ordered_quantity}','4') ELSE j END) FROM jsonb_array_elements(payload->'lines') j));
 PERFORM pg_temp.catalog_co_test_call(md5('co-missing-master-history')::uuid,'edit_co',payload);
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT ordered_quantity=4 AND unit_price=12.50 FROM private.co_order_lines WHERE id=md5('co-guard-line-b')::uuid),'missing master does not invent a stricter historical quantity cap');
-- Gen1 remains old behavior, including manual creation, and old receipts replay.
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; result jsonb; BEGIN
 payload:=jsonb_build_object('customer_id',md5('co-guard-other')::uuid,'expected_customer_version','1','co_number','FICTIONAL-CO-LEGACY','order_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,'lines',jsonb_build_array(jsonb_build_object('id',md5('co-legacy-foreign-line')::uuid,'sku','LEGACY-ONLY','product_name','Old manual key','ordered_quantity',2,'unit_price','0')));
 result:=public.pilot_co_transaction_v1(md5('co-legacy-public')::uuid,'create_co',payload);
 INSERT INTO pg_temp.catalogue_co_results VALUES('legacy',md5('co-legacy-public')::uuid,'create_co',payload,result);
 PERFORM pg_temp.foundation_assert(public.pilot_co_transaction_v1(md5('co-legacy-public')::uuid,'create_co',payload)=result,'committed pre-cutover CO receipt recovered unchanged');
END $$;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-legacy-foreign-line')::uuid,'ordered_quantity',1)));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-foreign-line')::uuid,'edit_co',payload),'22023','foreign persisted CO line cannot be claimed');
END $$;
SELECT pg_temp.foundation_assert(public.pilot_reconcile_co_v1(md5('co-abandoned')::uuid,true)->>'status'='abandoned','CO unknown abandonment succeeds');
SELECT pg_temp.foundation_assert(public.pilot_reconcile_co_v1(md5('co-abandoned')::uuid,false)->>'status'='abandoned','CO unbound abandonment reconciles');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_test_call(md5('co-abandoned')::uuid,'create_co','{}')$q$,'55000','abandoned CO command fences late delivery');
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT execution_version=1 FROM private.co_commands WHERE request_id=md5('co-legacy-public')::uuid),'legacy loaded begin default remains generation one');
SELECT pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1),'CO tests never globally activate tracking or generation');
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_transaction_v1(request_id,operation,payload) FROM pg_temp.catalogue_co_results WHERE label='create'$q$,'42501','PO role cannot recover another or former CO receipt');
RESET ROLE;
UPDATE public.users SET role='po_admin' WHERE id=md5('co-guard-actor')::uuid;
SELECT set_config('request.jwt.claim.sub',md5('co-guard-actor')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_transaction_v1(request_id,operation,payload) FROM pg_temp.catalogue_co_results WHERE label='create'$q$,'42501','former CO current authority revoked before own receipt recovery');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_reconcile_co_v1(md5('co-create')::uuid,false)$q$,'42501','former CO cannot reconcile own receipt');
RESET ROLE;
UPDATE public.users SET role='co_admin',is_active=false WHERE id=md5('co-guard-actor')::uuid;
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_transaction_v1(request_id,operation,payload) FROM pg_temp.catalogue_co_results WHERE label='create'$q$,'42501','inactive CO cannot recover committed receipt');
RESET ROLE;
UPDATE public.users SET is_active=true WHERE id=md5('co-guard-actor')::uuid;
SET LOCAL ROLE anon;
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_transaction_v1(md5('co-anon')::uuid,'create_co','{}')$q$,'42501','anonymous CO entrypoint remains denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_transaction_v1(md5('co-service')::uuid,'create_co','{}')$q$,'42501','service role cannot gain public CO authority');
RESET ROLE;

-- A real saved draft can outlive its subsequently removed unposted line.
-- The queued draft event must resolve the immutable pre-edit line snapshot.
INSERT INTO private.co_audit_events(customer_id,actor_id,operation,before_state,after_state) VALUES(md5('co-guard-customer')::uuid,auth.uid(),'save_report_draft','{"lines":null}','{}');
INSERT INTO public.products(id,name,sku) VALUES(md5('co-retired-draft-product')::uuid,'Fictional retained draft identity','CO-RETIRED-DRAFT');
SET LOCAL ROLE authenticated;
DO $$ DECLARE o uuid; payload jsonb; BEGIN
 SELECT (result->>'id')::uuid INTO o FROM pg_temp.catalogue_co_results WHERE label='create';
 payload:=pg_temp.catalog_co_binding(o);
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-retired-draft-line')::uuid,'product_id',md5('co-retired-draft-product')::uuid,'sku','CO-RETIRED-DRAFT','product_name','Fictional retained draft identity','ordered_quantity',1,'unit_price','0')));
 PERFORM pg_temp.catalog_co_test_call(md5('co-retired-draft-add')::uuid,'edit_co',payload);
 payload:=(pg_temp.catalog_co_binding(o)-'lines')||jsonb_build_object('sj_number','FICTIONAL-RETIRED-DRAFT','sj_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,'lines',jsonb_build_array(jsonb_build_object('co_line_id',md5('co-retired-draft-line')::uuid,'quantity',1)));
 PERFORM pg_temp.catalog_co_test_call(md5('co-retired-draft-save')::uuid,'save_sj_draft',payload);
 payload:=pg_temp.catalog_co_binding(o);
 payload:=jsonb_set(payload,'{lines}',(SELECT jsonb_agg(j) FROM jsonb_array_elements(payload->'lines') j WHERE j->>'id'<>md5('co-retired-draft-line')::uuid::text));
 PERFORM pg_temp.catalog_co_test_call(md5('co-retired-draft-remove')::uuid,'edit_co',payload);
END $$;
RESET ROLE;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.co_order_lines WHERE id=md5('co-retired-draft-line')::uuid),'supported edit removes unposted line after draft snapshot');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('co-retired-draft-product')::uuid),'removed draft reference retains lifetime product evidence');

-- Preserve v1's any-before-snapshot retired-identity detection, not edit-only.
INSERT INTO private.co_audit_events(customer_id,actor_id,operation,before_state,after_state)
SELECT md5('co-guard-customer')::uuid,auth.uid(),'cancel_co',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('id',md5('co-non-edit-retired-line')::uuid,'stock_key_id',k.id))),'{}'::jsonb
FROM private.co_stock_keys k WHERE k.customer_id=md5('co-guard-customer')::uuid AND k.product_id=md5('co-retired-draft-product')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; BEGIN
 payload:=pg_temp.catalog_co_binding((SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'));
 payload:=jsonb_set(payload,'{lines}',payload->'lines'||jsonb_build_array(jsonb_build_object('id',md5('co-non-edit-retired-line')::uuid,'product_id',md5('co-retired-draft-product')::uuid,'sku','CO-RETIRED-DRAFT','product_name','Fictional retained draft identity','ordered_quantity',1,'unit_price','0')));
 PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.catalog_co_test_call(%L::uuid,%L,%L::jsonb)',md5('co-non-edit-retired-request')::uuid,'edit_co',payload),'22023','non-edit before snapshot retains retired CO identity refusal');
END $$;
RESET ROLE;

-- Actual OLD/NEW and removed references are assertion-only. Raw probes here
-- are deliberately synthetic owner actions; no raw production bypass is added.
INSERT INTO public.products(id,name,sku) VALUES(md5('co-assert-unmarked')::uuid,'Fictional unmarked old CO product','CO-ASSERT-UNMARKED');
INSERT INTO private.co_stock_keys(id,customer_id,display_sku,product_id,product_name) VALUES(md5('co-assert-unmarked-key')::uuid,md5('co-guard-customer')::uuid,'CO-ASSERT-UNMARKED',md5('co-assert-unmarked')::uuid,'Fictional unmarked old CO product');
INSERT INTO private.co_order_lines(id,co_id,customer_id,stock_key_id,ordered_quantity,unit_price)
SELECT md5('co-assert-old-line')::uuid,(result->>'id')::uuid,md5('co-guard-customer')::uuid,md5('co-assert-unmarked-key')::uuid,1,0 FROM pg_temp.catalogue_co_results WHERE label='create';
CREATE FUNCTION pg_temp.catalog_co_assert_probe(mode text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE o uuid:=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_co_results WHERE label='create'); snapshot jsonb;
BEGIN
 INSERT INTO private.catalog_co_active_v2 VALUES(pg_backend_pid(),txid_current());
 IF mode='context' THEN SET CONSTRAINTS private.catalog_co_context_empty_v2 IMMEDIATE; RETURN; END IF;
 IF mode='nested' THEN PERFORM private.catalog_co_transaction_core_v2(md5('co-nested')::uuid,'create_co','{}'); RETURN; END IF;
 IF mode='immediate' THEN SET CONSTRAINTS private.catalog_co_assert_v2 IMMEDIATE; END IF;
 IF mode='early-state' THEN
  INSERT INTO private.co_customer_state(customer_id) VALUES(md5('co-early-state-customer')::uuid);
 ELSIF mode='old-line' THEN
  DELETE FROM private.co_order_lines WHERE id=md5('co-assert-old-line')::uuid;
 ELSE
  snapshot:=CASE WHEN mode='malformed' THEN '{"product_id":12}'::jsonb ELSE jsonb_build_object('customer_id',md5('co-guard-customer')::uuid,'lines',jsonb_build_array(jsonb_build_object('stock_key_id',md5('co-assert-unmarked-key')::uuid))) END;
  INSERT INTO private.co_audit_events(customer_id,actor_id,operation,before_state,after_state) VALUES(md5('co-guard-customer')::uuid,auth.uid(),'edit_co',snapshot,'{}');
 END IF;
 DELETE FROM private.catalog_co_active_v2 WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 SET CONSTRAINTS ALL IMMEDIATE;
END $$;
INSERT INTO public.customers(id,name,customer_category) VALUES(md5('co-early-state-customer')::uuid,'Fictional early CO state','perorangan');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_assert_probe('old-line')$q$,'23514','actual deleted OLD stock identity missing mark aborts');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_assert_probe('old-snapshot')$q$,'23514','actual OLD-only immutable CO audit snapshot requires evidence');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_assert_probe('early-state')$q$,'23514','early CO state insertion queues missing customer assertion');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_assert_probe('immediate')$q$,'23514','forced immediate missing CO evidence fails closed');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_assert_probe('malformed')$q$,'22023','malformed typed CO snapshot aborts');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_assert_probe('context')$q$,'23514','CO core context cannot survive commit');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_co_assert_probe('nested')$q$,'55000','nested CO core cannot establish second context');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_co_active_v2),'successful and failed CO scope always cleans up');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('co-assert-unmarked')::uuid),'assertions never repair missing evidence');
-- Flush all legitimate queued events, including actual removed line snapshots,
-- rather than relying on outer rollback to avoid commit-time assertions.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
