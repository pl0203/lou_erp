-- Disposable PostgreSQL semantics. Does not claim HTTP/PostgREST retry coverage.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL search_path='';
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable fixture required'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES('97000000-0000-0000-0000-000000000001');
INSERT INTO public.users(id,full_name,email,role) VALUES('97000000-0000-0000-0000-000000000001','Synthetic conflict actor','conflict@example.invalid','po_admin');
INSERT INTO public.customers(id,name) VALUES('97000000-0000-0000-0000-000000000002','Synthetic conflict customer');
-- Test-only privileged snapshot lets the real authenticated role compare all affected rows.
CREATE FUNCTION pg_temp.stale_po_snapshot(po_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'po',(SELECT to_jsonb(p) FROM public.purchase_orders p WHERE p.id=po_id),
  'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.po_line_items l WHERE l.purchase_order_id=po_id),
  'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.po_audit_log a WHERE a.purchase_order_id=po_id),
  'deliveries',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.surat_jalan s WHERE s.purchase_order_id=po_id),
  'delivery_lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.sj_line_items l JOIN public.surat_jalan s ON s.id=l.surat_jalan_id WHERE s.purchase_order_id=po_id),
  'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.request_id) FROM private.pilot_order_requests r WHERE r.actor_id=auth.uid())
 )
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
DO $tests$
DECLARE created jsonb; delivered jsonb; edited jsonb; response jsonb; baseline jsonb;
 po uuid; line uuid; sj uuid; stale timestamptz; version timestamptz; operation text;
 payload jsonb; request uuid; failed_request uuid; delivery_request uuid;
BEGIN
 created:=public.pilot_order_transaction(gen_random_uuid(),'create_po',jsonb_build_object(
  'customer_id','97000000-0000-0000-0000-000000000002','po_number','SYNTH-CONFLICT-PO','order_date',CURRENT_DATE,
  'items',jsonb_build_array(jsonb_build_object('product_name','Synthetic item','quantity',5,'unit_price',10))));
 po:=(created->>'id')::uuid; stale:=(created->>'updated_at')::timestamptz;
 response:=public.pilot_po_lines_v1(po,1,100,stale);
 IF (response->>'po_updated_at')::timestamptz<>stale OR jsonb_array_length(response->'items')<>1 THEN RAISE EXCEPTION 'Valid version read failed'; END IF;
 line:=(response->'items'->0->>'id')::uuid;
 delivery_request:=gen_random_uuid();
 payload:=jsonb_build_object('po_id',po,'expected_updated_at',stale,'sj_number','SYNTH-CONFLICT-SJ','sj_date',CURRENT_DATE,
  'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',1)));
 delivered:=public.pilot_order_transaction(delivery_request,'save_delivery',payload);
 IF public.pilot_order_transaction(delivery_request,'save_delivery',payload) IS DISTINCT FROM delivered THEN RAISE EXCEPTION 'Committed replay changed'; END IF;
 sj:=(delivered->>'id')::uuid; version:=(delivered->>'updated_at')::timestamptz;
 baseline:=pg_temp.stale_po_snapshot(po);
 response:=NULL;
 BEGIN
  response:=public.pilot_po_lines_v1(po,1,100,stale);
  RAISE EXCEPTION 'Stale read unexpectedly succeeded';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN
  IF SQLERRM<>'PO changed; refresh before continuing' THEN RAISE; END IF;
 END;
 IF response IS NOT NULL OR pg_temp.stale_po_snapshot(po) IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Stale read exposed partial rows or changed data'; END IF;
 FOREACH operation IN ARRAY ARRAY['edit_po','save_delivery','void_delivery','cancel_po'] LOOP
  request:=gen_random_uuid(); failed_request:=request;
  BEGIN
   PERFORM public.pilot_order_transaction(request,operation,jsonb_build_object('po_id',po,'sj_id',sj,
    'expected_updated_at',stale,'customer_id','97000000-0000-0000-0000-000000000002','notes','STALE MUST NOT SAVE',
    'items',jsonb_build_array(jsonb_build_object('id',line,'product_name','Synthetic item','quantity',5,'unit_price',10)),
    'sj_number','STALE-SJ','sj_date',CURRENT_DATE,'reason','Stale must not act',
    'lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',1))));
   RAISE EXCEPTION 'Stale operation unexpectedly succeeded: %',operation;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
   IF SQLERRM<>'PO changed; refresh before saving' THEN RAISE; END IF;
  END;
  IF pg_temp.stale_po_snapshot(po) IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Stale operation changed data or request outcome: %',operation; END IF;
 END LOOP;
 -- Missing expected versions also remain fail-closed conflicts.
 BEGIN
  PERFORM public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id',po));
  RAISE EXCEPTION 'Missing version edit unexpectedly succeeded';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 IF pg_temp.stale_po_snapshot(po) IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Missing version changed data'; END IF;
 response:=public.pilot_po_lines_v1(po,1,100,version);
 IF (response->>'po_updated_at')::timestamptz<>version OR (response->'items'->0->>'delivered_quantity')::integer<>1 THEN RAISE EXCEPTION 'Refreshed header version read failed'; END IF;
 edited:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id',po,'expected_updated_at',version,
  'customer_id','97000000-0000-0000-0000-000000000002','notes','VALID EDIT',
  'items',jsonb_build_array(jsonb_build_object('id',line,'product_name','Synthetic item','quantity',5,'unit_price',10))));
 IF (edited->>'updated_at')::timestamptz<=version OR (SELECT notes FROM public.purchase_orders WHERE id=po)<>'VALID EDIT' THEN RAISE EXCEPTION 'Valid edit failed'; END IF;
 IF public.pilot_reconcile_request(failed_request,true)->>'state'<>'abandoned' THEN RAISE EXCEPTION 'Definitive rejected request could not be safely reconciled'; END IF;
 RAISE NOTICE 'STALE_PO_PT409_READ_ALL_WRITES_ATOMICITY_VALID_VERSION_REPLAY_RECOVERY_VERIFIED';
END $tests$;
RESET ROLE;
ROLLBACK;
