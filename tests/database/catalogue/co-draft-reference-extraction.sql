-- Authored fictional SQL semantic contract. Runtime UNRUN; no server startup.
DO $missing$ BEGIN
 IF to_regprocedure('private.catalog_extract_co_draft_event_v1(regclass,text,jsonb,jsonb,text)') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_CO_DRAFT_MISSING_FUNCTION' USING ERRCODE='PCE01';
 END IF;
END $missing$;
CREATE FUNCTION pg_temp.cd_equal(actual jsonb,expected jsonb,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: actual %, expected %',label,actual,expected; END IF;
END $$;
CREATE FUNCTION pg_temp.cd_id(label text) RETURNS text LANGUAGE sql AS $$ SELECT md5('fictional-draft-'||label)::uuid::text $$;
CREATE FUNCTION pg_temp.cd_row(kind text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',pg_temp.cd_id('draft'),'customer_id',pg_temp.cd_id('customer'),'kind',kind,
 'co_id',CASE kind WHEN 'sj' THEN pg_temp.cd_id('order') ELSE NULL END,'version',9007199254740993::numeric,
 'report_month',NULL,'eligible_set_fingerprint',NULL,'created_by',pg_temp.cd_id('actor'),'created_at','2026-01-02T03:04:05+00:00','evidence_id',NULL,
 'payload',CASE kind WHEN 'sj' THEN jsonb_build_object('sj_number','fictional SJ','sj_date','2026-01-02','received_date',NULL,'notes',NULL,
  'lines',jsonb_build_array(jsonb_build_object('co_line_id',pg_temp.cd_id('line'),'quantity',1)),
  'bound_co_version','9007199254740993','bound_customer_version','9223372036854775807',
  'candidate_batch_ids',jsonb_build_object(pg_temp.cd_id('line'),pg_temp.cd_id('future-batch')))
 ELSE jsonb_build_object('return_date','2026-01-02','reference',NULL,'reason','fictional reason','notes',NULL,
  'lines',jsonb_build_array(jsonb_build_object('batch_id',pg_temp.cd_id('batch'),'quantity',2)),'bound_customer_version','1') END);
$$;
CREATE FUNCTION pg_temp.cd_edge(kind text,id text,origin text,ord boolean,expect jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('kind',kind,'id',pg_temp.cd_id(id),'customerId',pg_temp.cd_id('customer'),'expect',expect,'origin',origin)
 || CASE WHEN ord THEN jsonb_build_object('orderId',pg_temp.cd_id('order')) ELSE '{}'::jsonb END;
$$;
CREATE FUNCTION pg_temp.cd_expected(kind text,side text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('ok',true,'extraction',jsonb_build_object(
 'refs',jsonb_build_array(jsonb_build_object('kind','customer','id',pg_temp.cd_id('customer'))),
 'edges',CASE kind WHEN 'sj' THEN jsonb_build_array(
 pg_temp.cd_edge('co_order','order',side||'.co_id',false),
 pg_temp.cd_edge('co_line','line',side||'.payload.lines[0].co_line_id',true),
 pg_temp.cd_edge('co_line','line',side||'.payload.candidate_batch_ids.key['||pg_temp.cd_id('line')||']',true))
 ELSE jsonb_build_array(pg_temp.cd_edge('co_batch','batch',side||'.payload.lines[0].batch_id',false)) END,
 'historicalNulls','[]'::jsonb,'origins',jsonb_build_array(jsonb_build_object('ref',jsonb_build_object('kind','customer','id',pg_temp.cd_id('customer')),'rowSide',side,'path',side||'.customer_id'))));
$$;
DO $tests$
DECLARE r jsonb; x jsonb; expected jsonb; prior jsonb; k text; i integer;
BEGIN
 FOREACH k IN ARRAY ARRAY['sj','return'] LOOP
  r:=pg_temp.cd_row(k);
  PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','INSERT',NULL,r,'source-stage08'),pg_temp.cd_expected(k,'NEW'),'exact positive '||k);
  PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','DELETE',r,NULL,'source-stage08'),pg_temp.cd_expected(k,'OLD'),'OLD removals '||k);
  expected:=pg_temp.cd_expected(k,'NEW'); prior:=pg_temp.cd_expected(k,'OLD');
  expected:=jsonb_set(expected,'{extraction,edges}',(prior#>'{extraction,edges}')||(expected#>'{extraction,edges}'));
  expected:=jsonb_set(expected,'{extraction,origins}',(prior#>'{extraction,origins}')||(expected#>'{extraction,origins}'));
  PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','UPDATE',r,r,'source-stage08'),expected,'all OLD NEW constraints retained');
  PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','INSERT',NULL,r-'evidence_id','source-stage04-pre-evidence'),pg_temp.cd_expected(k,'NEW'),'explicit historical omission profile');
 END LOOP;
 r:=pg_temp.cd_row('return');
 x:=jsonb_set(r,'{payload}',(r->'payload')||jsonb_build_object('posted_return_head_id',pg_temp.cd_id('head')));
 expected:=pg_temp.cd_expected('return','NEW');
 expected:=jsonb_set(expected,'{extraction,edges}',jsonb_build_array(pg_temp.cd_edge('co_return_head','head','NEW.payload.posted_return_head_id',false))||(expected#>'{extraction,edges}'));
 PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','INSERT',NULL,x,'source-stage08'),expected,'consumed return head');
 -- Retain full evidence/customer/draft binding without claiming evidence validity or resolution.
 x:=r||jsonb_build_object('evidence_id',pg_temp.cd_id('evidence'));
 expected:=pg_temp.cd_expected('return','OLD');
 expected:=jsonb_set(expected,'{extraction,edges}',jsonb_build_array(pg_temp.cd_edge('co_evidence','evidence','OLD.evidence_id',false,jsonb_build_object('draftId',pg_temp.cd_id('draft'))))||(expected#>'{extraction,edges}'));
 PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','DELETE',x,NULL,'source-stage08'),expected,'replaced evidence retained');
 r:=pg_temp.cd_row('sj');
 -- Full expected composite binding: bound revision must carry headId, plus customer/order.
 x:=jsonb_set(r,'{payload}',(r->'payload')||jsonb_build_object('bound_delivery_head_id',pg_temp.cd_id('head'),'bound_delivery_revision_id',pg_temp.cd_id('revision'),'bound_delivery_version','1','posted_delivery_head_id',pg_temp.cd_id('head')));
 expected:=pg_temp.cd_expected('sj','NEW');
 expected:=jsonb_set(expected,'{extraction,edges}',jsonb_build_array(pg_temp.cd_edge('co_order','order','NEW.co_id',false),
 pg_temp.cd_edge('co_delivery_head','head','NEW.payload.bound_delivery_head_id',true),
 pg_temp.cd_edge('co_delivery_revision','revision','NEW.payload.bound_delivery_revision_id',true,jsonb_build_object('headId',pg_temp.cd_id('head'))),
 pg_temp.cd_edge('co_delivery_head','head','NEW.payload.posted_delivery_head_id',true))||jsonb_build_array((expected#>'{extraction,edges}')->1,(expected#>'{extraction,edges}')->2));
 PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','INSERT',NULL,x,'source-stage08'),expected,'correction head revision tuple');
 -- Deliberately malformed source shapes must refuse, not return partial references.
 FOR i IN 1..11 LOOP
  x:=CASE i
  WHEN 1 THEN r-'evidence_id'
  WHEN 2 THEN r||'{"kind":"report"}'::jsonb
  WHEN 3 THEN jsonb_set(r,'{payload,lines}','null')
  WHEN 4 THEN jsonb_set(r,'{payload,candidate_batch_ids}','{}')
  WHEN 5 THEN jsonb_set(r,'{payload,lines,0,quantity}','1.5')
  WHEN 6 THEN jsonb_set(r,'{payload}',(r->'payload')||jsonb_build_object('bound_delivery_head_id',pg_temp.cd_id('head')))
  WHEN 7 THEN jsonb_set(r,'{payload,bound_co_version}','"9223372036854775808"')
  WHEN 8 THEN jsonb_set(r,'{payload,sj_date}','"2026-02-30"')
  WHEN 9 THEN jsonb_set(r,'{payload,lines}',(r#>'{payload,lines}')||(r#>'{payload,lines}'))
  WHEN 10 THEN jsonb_set(r,'{payload,source_context}','{}')
  ELSE r||'{"unexpected":"value"}'::jsonb END;
  PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','INSERT',NULL,x,'source-stage08')->'ok','false','refusal case '||i);
 END LOOP;
 PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','INSERT',NULL,r,'unknown')->'code','"UNSUPPORTED_LEGACY_PROFILE"','unknown profile');
 PERFORM pg_temp.cd_equal(private.catalog_extract_co_draft_event_v1('private.co_drafts','DELETE',NULL,r,'source-stage08')->'code','"INVALID_EVENT"','invalid event');
END $tests$;
