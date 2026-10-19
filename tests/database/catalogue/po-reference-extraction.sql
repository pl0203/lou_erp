-- Fictional public-source-only fixtures. Enclose in the authorized disposable
-- runner's transaction. This suite never starts PostgreSQL or resolves history.
CREATE FUNCTION pg_temp.por_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'PO reference assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.por_extract(relation regclass,action text,old_row jsonb,new_row jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 EXECUTE 'SELECT private.catalog_por_extract_event_v1($1,$2,$3,$4,$5)' INTO result
 USING relation,action,old_row,new_row,'{"sourceCommit":"c38b14fd122fc5dd08080f9a48adce254e4c3e52","schemaProfile":"public-po-source-20261014","producerPinsSha256":"8085f8784fb1071ef91f994bb962af9731ea8c9a2aa61023fcf88b7b8be20cb1"}'::jsonb;
 RETURN result;
END $$;
DO $test$
DECLARE
 ledger regclass:='private.pilot_order_requests'; audit regclass:='public.po_audit_log';
 c text:='10000000-0000-4000-8000-000000000001'; p text:='20000000-0000-4000-8000-000000000001';
 q text:='20000000-0000-4000-8000-000000000002'; po text:='30000000-0000-4000-8000-000000000001';
 line text:='40000000-0000-4000-8000-000000000001'; campaign text:='50000000-0000-4000-8000-000000000001';
 sj text:='60000000-0000-4000-8000-000000000001'; actor text:='70000000-0000-4000-8000-000000000001';
 r jsonb; a jsonb; x jsonb; y jsonb; payload jsonb; item jsonb; old_item jsonb; new_item jsonb; ack jsonb;
 result jsonb; failure_message text; key text; invalid jsonb; fn record;
BEGIN
 IF to_regprocedure('private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)') IS NULL THEN
  BEGIN
   PERFORM pg_temp.por_extract(ledger,'INSERT',NULL,'{}');
   RAISE EXCEPTION 'Missing helper unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42883' THEN
   GET STACKED DIAGNOSTICS failure_message=MESSAGE_TEXT;
   IF failure_message IS DISTINCT FROM 'function private.catalog_por_extract_event_v1(regclass, text, jsonb, jsonb, jsonb) does not exist' THEN RAISE; END IF;
   RAISE NOTICE 'CATALOGUE_PO_REFERENCE_EXPECTED_RED_42883';
  END;
  RETURN;
 END IF;
 item:=jsonb_build_object('product_id',p,'product_name','Fictional tile','sku','FICT-ONE','quantity',2,'unit_price',0);
 payload:=jsonb_build_object('customer_id',c,'po_number','FICT-PO','items',jsonb_build_array(item));
 r:=jsonb_build_object('actor_id',actor,'request_id',actor,'operation','create_po','payload',payload,'result',NULL,'abandoned',false,'created_at','2026-10-14T00:00:00Z','execution_version',1);
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,r);
 PERFORM pg_temp.por_assert(result#>'{extraction,refs}'=jsonb_build_array(jsonb_build_object('kind','customer','id',c),jsonb_build_object('kind','product','id',p)),'pending payload retained');
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}'='[]','create raw caller item ID is not a persisted line');
 x:=jsonb_set(r,'{payload,items}',jsonb_build_array(item||jsonb_build_object('id',line)));
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x)#>'{extraction,edges}'='[]','create does not infer saved line');
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,r||'{"abandoned":true}');
 PERFORM pg_temp.por_assert(result#>'{extraction,refs}' @> jsonb_build_array(jsonb_build_object('kind','product','id',p)),'abandoned payload retained');
 x:=jsonb_set(r,'{payload,items}',jsonb_build_array(item||jsonb_build_object('product_id',q)));
 result:=pg_temp.por_extract(ledger,'UPDATE',r,x);
 PERFORM pg_temp.por_assert(jsonb_array_length(result#>'{extraction,refs}')=3 AND jsonb_array_length(result#>'{extraction,origins}')=4,'OLD removal retained');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',r,r)->>'code'='INVALID_EVENT','actual event combinations enforced');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'DELETE',NULL,r)->>'code'='INVALID_EVENT','DELETE requires old row');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,'null')->>'code'='INVALID_EVENT','JSON null is not SQL null row');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,r||'{"execution_version":2}')->>'code'='UNKNOWN_VERSION','unknown version refused');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(r,'{payload,unclassified}',to_jsonb(p)))->>'code'='UNKNOWN_SHAPE','unknown raw key refused');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(r,'{payload,items,0,unclassified}',to_jsonb(q)))->>'code'='UNKNOWN_SHAPE','unknown item key refused');
 x:=jsonb_set(r,'{payload,items}',jsonb_build_array(item-'product_id'));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,historicalNulls}'='["NEW.payload.items[0].product_id"]','omitted historical product retained');
 x:=jsonb_set(r,'{payload,items,0,product_id}','""');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x)#>'{extraction,historicalNulls}'='["NEW.payload.items[0].product_id"]','named raw normalization accepts empty identity');
 x:=jsonb_set(r,'{payload,items,0,product_id}','"broken"');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x)->>'code'='INVALID_UUID','invalid product UUID refuses');
 x:=r||jsonb_build_object('operation','edit_po','payload',(payload-'po_number')||jsonb_build_object('po_id',po,'expected_updated_at','2026-10-14T00:00:00Z','items',jsonb_build_array(item||jsonb_build_object('id',line))),'result',jsonb_build_object('id',po,'po_id',po,'updated_at','2026-10-14T00:00:01Z'));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','po_line','id',line,'orderId',po,'expect',jsonb_build_object('productId',p),'origin','NEW.payload.items[0].id')),'line product and PO constraints retained');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(x,'{result,po_id}',to_jsonb(sj)))->>'code'='CROSS_ORDER_LINEAGE','receipt mismatch refused');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x||'{"abandoned":true}')->>'code'='CONTRADICTORY_LINEAGE','committed and abandoned conflict');
 x:=r||jsonb_build_object('operation','recovery_abandoned','payload','{}'::jsonb,'abandoned',true,'execution_version',0);
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x)#>'{extraction,refs}'='[]','empty recovery tombstone');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x||jsonb_build_object('payload',payload))->>'code'='UNKNOWN_SHAPE','recovery cannot hide payload');
 -- Named execution-zero source eras use their own public SQL grammar.
 x:=r||jsonb_build_object('operation','submit_sales','execution_version',0,'payload',jsonb_build_object('customer_id',c,'visit_id',sj,'items',jsonb_build_array(item||jsonb_build_object('is_promo',true,'promotion_id',campaign))),'result',jsonb_build_object('id',po));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result->>'ok'='true','legacy submit named grammar');
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','girard_order','id',po,'customerId',c,'expect',jsonb_build_object('visitId',sj),'origin','NEW.result.id')),'legacy sales visit binding');
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','promotion','id',campaign,'expect',jsonb_build_object('productId',p),'origin','NEW.payload.items[0].promotion_id')),'promotion expected product');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x||'{"execution_version":1}')->>'code'='UNSUPPORTED_LEGACY_PROFILE','retired submit source-era discriminator');
 x:=r||jsonb_build_object('operation','finalize_visit','execution_version',0,'payload',jsonb_build_object('schedule_id',sj,'storage_path','visits/'||sj||'/fictional.jpg','lat',NULL,'lng',NULL),'result',jsonb_build_object('id',po));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result->>'ok'='true' AND jsonb_array_length(result#>'{extraction,edges}')=2,'legacy visit named grammar');
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','visit','id',po,'expect',jsonb_build_object('scheduleId',sj),'origin','NEW.result.id')),'legacy visit schedule binding');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(x,'{payload,customer_id}',to_jsonb(c)))->>'code'='UNKNOWN_SHAPE','new visit keys not silently imported into legacy');
 -- Receipt and payload establish resource tuples, not only isolated IDs.
 x:=r||jsonb_build_object('operation','approve_sales','payload',jsonb_build_object('order_id',actor,'po_number','FICT-APPROVAL'),'result',jsonb_build_object('id',po,'updated_at','2026-10-14T00:00:01Z'));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','girard_order','id',actor,'expect',jsonb_build_object('poId',po),'origin','NEW.payload.order_id')),'approval source PO binding');
 x:=r||jsonb_build_object('operation','save_delivery','payload',jsonb_build_object('po_id',po,'sj_id',sj,'expected_updated_at','2026-10-14T00:00:00Z','sj_number','FICT-SJ','sj_date','2026-10-14','lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',1))),'result',jsonb_build_object('id',sj,'po_id',po,'updated_at','2026-10-14T00:00:01Z'));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','delivery','id',sj,'orderId',po,'expect','{}'::jsonb,'origin','NEW.result.id')),'save delivery receipt binding');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(x,'{result,id}',to_jsonb(actor)))->>'code'='CONTRADICTORY_LINEAGE','save delivery receipt target mismatch');
 x:=r||jsonb_build_object('operation','void_delivery','payload',jsonb_build_object('sj_id',sj,'expected_updated_at','2026-10-14T00:00:00Z','reason','Fictional correction'),'result',jsonb_build_object('id',sj,'po_id',po,'updated_at','2026-10-14T00:00:01Z'));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','delivery','id',sj,'orderId',po,'expect','{}'::jsonb,'origin','NEW.payload.sj_id')),'void delivery receipt binding');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(x,'{result,id}',to_jsonb(actor)))->>'code'='CONTRADICTORY_LINEAGE','void delivery receipt target mismatch');
 x:=r||jsonb_build_object('operation','edit_sj_returned_date','payload',jsonb_build_object('sj_id',sj,'expected_updated_at','2026-10-14T00:00:00Z','sj_date_returned',NULL),'result',jsonb_build_object('id',sj,'po_id',po,'updated_at','2026-10-14T00:00:01Z'));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','delivery','id',sj,'orderId',po,'expect','{}'::jsonb,'origin','NEW.payload.sj_id')),'returned date receipt binding');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(x,'{result,id}',to_jsonb(actor)))->>'code'='CONTRADICTORY_LINEAGE','returned date receipt target mismatch');
 x:=r||jsonb_build_object('operation','cancel_po','payload',jsonb_build_object('po_id',po,'expected_updated_at','2026-10-14T00:00:00Z','reason','Fictional cancellation'),'result',jsonb_build_object('id',po,'po_id',po,'updated_at','2026-10-14T00:00:01Z'));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','po','id',po,'expect','{}'::jsonb,'origin','NEW.result.id')),'cancel PO receipt binding');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(x,'{result,id}',to_jsonb(actor)))->>'code'='CROSS_ORDER_LINEAGE','cancel PO receipt target mismatch');
 x:=r||jsonb_build_object('operation','reject_sales','payload',jsonb_build_object('order_id',actor,'reason','Fictional rejection'),'result',jsonb_build_object('id',actor));
 result:=pg_temp.por_extract(ledger,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result#>'{extraction,edges}' @> jsonb_build_array(jsonb_build_object('kind','girard_order','id',actor,'expect','{}'::jsonb,'origin','NEW.result.id')),'reject sales receipt binding');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,jsonb_set(x,'{result,id}',to_jsonb(po)))->>'code'='CONTRADICTORY_LINEAGE','reject sales receipt target mismatch');
 -- Native numeric stock versions remain exact above JavaScript safe integers.
 ack:=jsonb_build_object('version',1,'payload_hash','fictional-hash','po_version',NULL,'shortages','[]'::jsonb,'allocations',jsonb_build_array(jsonb_build_object('promotion_id',campaign,'product_id',p,'product_name','Fictional tile','sku','FICT-ONE','remaining_quantity',2,'requested_quantity',2,'incremental_quantity',2,'allocation_quantity',2,'stock_version',9007199254740993::numeric)));
 x:=jsonb_set(r,'{payload,promo_stock_ack}',ack);
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x)->>'ok'='true','numeric fidelity');
 x:=jsonb_set(x,'{payload,promo_stock_ack,allocations,0,stock_version}','9223372036854775808');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(ledger,'INSERT',NULL,x)->>'code'='UNKNOWN_SHAPE','numeric maximum remains exact');
 -- Audit text has nested OLD and NEW within each actual row side.
 a:=jsonb_build_object('id',actor,'purchase_order_id',po,'changed_by',actor,'field_changed','po_items_revised','old_value',NULL,'new_value',NULL,'changed_at','2026-10-14T00:00:00Z');
 old_item:=jsonb_build_object('id',line,'purchase_order_id',po,'product_id',p,'product_name','Fictional old tile','sku','OLD-FICT','quantity',2,'unit_price',0,'line_total',0);
 new_item:=jsonb_build_object('id',line,'product_id',q,'product_name','Fictional new tile','sku','NEW-FICT','quantity',2,'unit_price',0,'is_promo',false,'promotion_id',NULL);
 a:=a||jsonb_build_object('old_value',jsonb_build_array(old_item)::text,'new_value',jsonb_build_array(new_item)::text);
 result:=pg_temp.por_extract(audit,'INSERT',NULL,a);
 PERFORM pg_temp.por_assert(result#>'{extraction,refs}'=jsonb_build_array(jsonb_build_object('kind','product','id',p),jsonb_build_object('kind','product','id',q)) AND jsonb_array_length(result#>'{extraction,origins}')=2,'nested both sides retained');
 result:=pg_temp.por_extract(audit,'DELETE',a,NULL);
 PERFORM pg_temp.por_assert(result#>>'{extraction,origins,0,rowSide}'='OLD','deleted audit row origins retained');
 x:=a||jsonb_build_object('old_value',NULL,'new_value',NULL);
 PERFORM pg_temp.por_assert(pg_temp.por_extract(audit,'INSERT',NULL,x)->>'ok'='true','SQL null accepted');
 FOREACH key IN ARRAY ARRAY['null','{}','1','[null]','[1]','broken'] LOOP
  x:=a||jsonb_build_object('new_value',key);
  PERFORM pg_temp.por_assert(pg_temp.por_extract(audit,'INSERT',NULL,x)->>'ok'='false','text JSON null refused');
 END LOOP;
 x:=a||jsonb_build_object('new_value',$badjson$["\u0000"]$badjson$);
 PERFORM pg_temp.por_assert(pg_temp.por_extract(audit,'INSERT',NULL,x)->>'code'='INVALID_TEXT_JSON','escaped NUL text JSON refused');
 x:=a||jsonb_build_object('old_value',jsonb_build_array(old_item||jsonb_build_object('purchase_order_id',sj))::text);
 PERFORM pg_temp.por_assert(pg_temp.por_extract(audit,'INSERT',NULL,x)->>'code'='CROSS_ORDER_LINEAGE','wrong PO refused');
 x:=a||jsonb_build_object('old_value',jsonb_build_array(old_item-'product_id')::text,'new_value',NULL);
 PERFORM pg_temp.por_assert(pg_temp.por_extract(audit,'INSERT',NULL,x)#>'{extraction,historicalNulls}'='["NEW.old_value[0].product_id"]','named pre-product saved line');
 x:=a||jsonb_build_object('field_changed','sj_lines_revised','old_value',jsonb_build_array(jsonb_build_object('id',actor,'surat_jalan_id',sj,'po_line_item_id',line,'quantity_delivered',2))::text,'new_value',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',0))::text);
 result:=pg_temp.por_extract(audit,'INSERT',NULL,x);
 PERFORM pg_temp.por_assert(result->>'ok'='true' AND jsonb_array_length(result#>'{extraction,edges}')=4,'SJ saved and normalized line constraints');
 x:=a||jsonb_build_object('field_changed','customer','old_value',c,'new_value',actor);
 PERFORM pg_temp.por_assert(jsonb_array_length(pg_temp.por_extract(audit,'INSERT',NULL,x)#>'{extraction,refs}')=2,'both customer text sides retained');
 x:=a||jsonb_build_object('field_changed','notes','old_value',p,'new_value',q);
 PERFORM pg_temp.por_assert(pg_temp.por_extract(audit,'INSERT',NULL,x)#>'{extraction,refs}'='[]','no arbitrary UUID scan');
 x:=a||jsonb_build_object('field_changed','unregistered_inherited_field');
 PERFORM pg_temp.por_assert(pg_temp.por_extract(audit,'INSERT',NULL,x)->>'code'='UNKNOWN_OPERATION','inherited field refused');
 EXECUTE 'SELECT private.catalog_por_extract_event_v1($1,$2,$3,$4,$5)' INTO result USING ledger,'INSERT',NULL::jsonb,r,'{}'::jsonb;
 PERFORM pg_temp.por_assert(result->>'code'='UNVERIFIED_SCHEMA','source profile refused');
 FOR fn IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'catalog_por_%' LOOP
  PERFORM pg_temp.por_assert(fn.provolatile='i' AND NOT fn.prosecdef AND fn.proconfig=ARRAY['search_path=""']
   AND NOT has_function_privilege('anon',fn.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',fn.oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',fn.oid,'EXECUTE')
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) acl WHERE acl.grantee<>fn.proowner OR acl.grantor<>fn.proowner OR acl.privilege_type<>'EXECUTE'),'ACL and fixed path');
 END LOOP;
 RAISE NOTICE 'CATALOGUE_PO_REFERENCE_BEHAVIOR_PASSED';
END $test$;
