-- Fictional vectors only. Caller supplies a verified disposable composed fixture,
-- executes exact missing-function RED before installation, then this same suite,
-- and rolls the entire installation back. This file does not authorize a target.
DO $preflight$ BEGIN
 IF current_user<>'postgres' OR to_regclass('private.pilot_schedule_requests') IS NULL
  OR to_regclass('private.pilot_visit_requests') IS NULL OR to_regclass('private.pilot_visit_workflow_audit') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_VISIT_REFERENCE_FIXTURE_INVALID' USING ERRCODE='PCV00';
 END IF;
END $preflight$;
DO $missing$ BEGIN
 IF to_regprocedure('private.catalog_extract_visit_reference_event_v1(regclass,text,jsonb,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_VISIT_REFERENCE_MISSING_FUNCTION' USING ERRCODE = 'PCV01';
 END IF;
END $missing$;
CREATE FUNCTION pg_temp.vr_equal(actual jsonb,expected jsonb,label text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Assertion failed: %; actual %, expected %',label,actual,expected; END IF;
END $$;
CREATE FUNCTION pg_temp.vr_refused(actual jsonb,code text,path text,label text) RETURNS void LANGUAGE sql AS $$
 SELECT pg_temp.vr_equal(actual,jsonb_build_object('ok',false,'code',code,'path',path),label);
$$;
CREATE FUNCTION pg_temp.vr_id(label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT md5('fictional-vr-'||label)::uuid::text; $$;
CREATE FUNCTION pg_temp.vr_schedule(customer text DEFAULT 'source',version integer DEFAULT 1) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('id',pg_temp.vr_id('schedule'),'outlet_id',pg_temp.vr_id(customer),'sales_person_id',pg_temp.vr_id('sales'),
 'assigned_by',pg_temp.vr_id('manager'),'scheduled_date','2026-02-03','status','pending','notes',pg_temp.vr_id('unrelated-product'),
 'created_at','2026-02-01T00:00:00Z','version',version);
$$;
CREATE FUNCTION pg_temp.vr_visit(version integer DEFAULT 1) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('id',pg_temp.vr_id('visit'),'outlet_id',pg_temp.vr_id('source'),'sales_person_id',pg_temp.vr_id('sales'),
 'schedule_id',pg_temp.vr_id('schedule'),'checked_in_at','2026-02-03T00:00:00Z','lat',NULL,'lng',NULL,'notes',pg_temp.vr_id('unrelated-product'),'note_version',version);
$$;
CREATE FUNCTION pg_temp.vr_request(kind text DEFAULT 'new',status text DEFAULT 'pending',version integer DEFAULT 1) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('id',pg_temp.vr_id('request'),'requester_id',pg_temp.vr_id('sales'),'kind',kind,'customer_id',pg_temp.vr_id('target'),
 'scheduled_date','2026-02-03','notes',pg_temp.vr_id('unrelated-product'),'source_schedule_id',CASE WHEN kind='amendment' THEN pg_temp.vr_id('schedule') END,
 'base_version',CASE WHEN kind='amendment' THEN 1 END,'approved_schedule_id',CASE WHEN status='approved' THEN pg_temp.vr_id('schedule') END,
 'status',status,'version',version,'reviewer_id',CASE WHEN status IN('approved','rejected') THEN pg_temp.vr_id('manager') END,
 'decided_at',CASE WHEN status<>'pending' THEN '2026-02-03T00:00:00Z' END,'created_at','2026-02-01T00:00:00Z');
$$;
CREATE FUNCTION pg_temp.vr_audit(op text,before_value jsonb,after_value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('id',pg_temp.vr_id('audit'),'actor_id',pg_temp.vr_id(CASE WHEN op IN('propose_visit','amend_visit','withdraw_request','edit_visit_note') THEN 'sales' ELSE 'manager' END),
 'request_id',pg_temp.vr_id('ledger'),'operation',op,'resource_id',pg_temp.vr_id(CASE WHEN op IN('create_schedule','edit_schedule','delete_schedule') THEN 'schedule' WHEN op='edit_visit_note' THEN 'visit' ELSE 'request' END),
 'old_value',before_value,'new_value',after_value,'changed_at','2026-02-03T00:00:00Z');
$$;
CREATE FUNCTION pg_temp.vr_ledger(op text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('actor_id',pg_temp.vr_id('sales'),'request_id',pg_temp.vr_id('ledger'),'operation',op,'result',NULL,'abandoned',false,'created_at','2026-02-03T00:00:00Z',
 'authority',jsonb_build_object('sales_person_id',pg_temp.vr_id('sales'),'customer_id',pg_temp.vr_id('target'),'source_customer_id',CASE WHEN op IN('amend_visit','edit_schedule','delete_schedule') THEN pg_temp.vr_id('source') END),
 'payload',CASE op
 WHEN 'propose_visit' THEN jsonb_build_object('customer_id',pg_temp.vr_id('target'),'scheduled_date','2026-02-03')
 WHEN 'amend_visit' THEN jsonb_build_object('schedule_id',pg_temp.vr_id('schedule'),'expected_version',1,'customer_id',pg_temp.vr_id('target'),'scheduled_date','2026-02-03','notes',NULL)
 WHEN 'create_schedule' THEN jsonb_build_object('customer_id',pg_temp.vr_id('target'),'sales_person_id',pg_temp.vr_id('sales'),'scheduled_date','2026-02-03')
 WHEN 'edit_schedule' THEN jsonb_build_object('schedule_id',pg_temp.vr_id('schedule'),'expected_version',1,'customer_id',pg_temp.vr_id('target'),'sales_person_id',pg_temp.vr_id('sales'),'scheduled_date','2026-02-03')
 WHEN 'delete_schedule' THEN jsonb_build_object('schedule_id',pg_temp.vr_id('schedule'),'expected_version',1)
 WHEN 'edit_visit_note' THEN jsonb_build_object('visit_id',pg_temp.vr_id('visit'),'expected_version',1,'notes',pg_temp.vr_id('unrelated-product'))
 ELSE jsonb_build_object('request_id',pg_temp.vr_id('request'),'expected_version',1) END);
$$;
CREATE FUNCTION pg_temp.vr_finalize() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('actor_id',pg_temp.vr_id('sales'),'request_id',pg_temp.vr_id('ledger'),'operation','finalize_visit','result',jsonb_build_object('id',pg_temp.vr_id('visit')),
 'abandoned',false,'created_at','2026-02-03T00:00:00Z','payload',jsonb_build_object('schedule_id',pg_temp.vr_id('schedule'),'expected_schedule_version',1,
 'customer_id',pg_temp.vr_id('target'),'scheduled_date','2026-02-03','storage_path','visits/'||pg_temp.vr_id('schedule')||'/fictional.jpg','notes',pg_temp.vr_id('unrelated-product'),'lat',NULL,'lng',NULL));
$$;
DO $behavior$
DECLARE r jsonb; n jsonb; e jsonb; b jsonb; a jsonb; bad jsonb; op text; key text; expected jsonb; empty_schedule jsonb;
 audit regclass:='private.pilot_visit_workflow_audit'::regclass;
 ledger regclass:='private.pilot_schedule_requests'::regclass;
 visits regclass:='private.pilot_visit_requests'::regclass;
BEGIN
 FOR op IN SELECT unnest(ARRAY['propose_visit','amend_visit','create_schedule','edit_schedule','delete_schedule','approve_request','reject_request','withdraw_request','edit_visit_note']) LOOP
  r:=pg_temp.vr_ledger(op);
  IF op='delete_schedule' THEN r:=jsonb_set(r,'{authority,customer_id}',to_jsonb(pg_temp.vr_id('source'))); END IF;
  e:=private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,r);
  PERFORM pg_temp.vr_equal(e->'ok','true',op||' operation payload');
 END LOOP;
 -- Receipts are operation typed and must bind payload target, status and version.
 FOR op IN SELECT unnest(ARRAY['propose_visit','amend_visit','create_schedule','edit_schedule','delete_schedule','approve_request','reject_request','withdraw_request','edit_visit_note']) LOOP
  r:=pg_temp.vr_ledger(op);
  IF op='delete_schedule' THEN r:=jsonb_set(r,'{authority,customer_id}',to_jsonb(pg_temp.vr_id('source'))); END IF;
  a:=jsonb_build_object('id',pg_temp.vr_id(CASE WHEN op IN('create_schedule','edit_schedule','delete_schedule') THEN 'schedule' WHEN op='edit_visit_note' THEN 'visit' ELSE 'request' END),
   'version',CASE WHEN op IN('propose_visit','amend_visit','create_schedule') THEN 1 ELSE 2 END);
  IF op IN('propose_visit','amend_visit','approve_request','reject_request','withdraw_request') THEN
   a:=a||jsonb_build_object('status',CASE op WHEN 'approve_request' THEN 'approved' WHEN 'reject_request' THEN 'rejected' WHEN 'withdraw_request' THEN 'withdrawn' ELSE 'pending' END);
  END IF;
  IF op='delete_schedule' THEN a:=a||'{"deleted":true}'::jsonb; END IF;
  IF op='approve_request' THEN a:=a||jsonb_build_object('schedule_id',pg_temp.vr_id('schedule'),'schedule_version',1); END IF;
  n:=r||jsonb_build_object('result',a);e:=private.catalog_extract_visit_reference_event_v1(ledger,'UPDATE',r,n);
  PERFORM pg_temp.vr_equal(e->'ok','true',op||' committed receipt');
  bad:=jsonb_set(n,'{result,version}','3');PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,bad),'CONTRADICTORY_LINEAGE','NEW.result.version',op||' receipt version binding');
  bad:=n||'{"abandoned":true}';PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,bad),'CONTRADICTORY_LINEAGE','NEW.abandoned',op||' committed cannot be abandoned');
  IF op NOT IN('propose_visit','amend_visit','create_schedule') THEN
   bad:=jsonb_set(n,'{result,id}',to_jsonb(pg_temp.vr_id('other-resource')));
   PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,bad),'CONTRADICTORY_LINEAGE','NEW.result.id',op||' receipt resource binding');
  END IF;
 END LOOP;
 r:=pg_temp.vr_ledger('amend_visit');e:=private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,r);
 SELECT jsonb_agg(x ORDER BY (x->>'id')::uuid) INTO expected FROM (VALUES(jsonb_build_object('kind','customer','id',pg_temp.vr_id('source'))),(jsonb_build_object('kind','customer','id',pg_temp.vr_id('target')))) t(x);
 PERFORM pg_temp.vr_equal(e#>'{extraction,refs}',expected,'authority source customer union');
 PERFORM pg_temp.vr_equal(e#>'{extraction,edges}',jsonb_build_array(jsonb_build_object('kind','schedule','id',pg_temp.vr_id('schedule'),'customerId',pg_temp.vr_id('source'),
 'origin','NEW.payload.schedule_id','expect',jsonb_build_object('scheduleVersion','1'))),'amend source schedule scope');
 r:=pg_temp.vr_ledger('propose_visit');e:=private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,r);
 PERFORM pg_temp.vr_equal(e,jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs',jsonb_build_array(jsonb_build_object('kind','customer','id',pg_temp.vr_id('target'))),
 'edges','[]'::jsonb,'historicalNulls','[]'::jsonb,'origins',jsonb_build_array(
 jsonb_build_object('ref',jsonb_build_object('kind','customer','id',pg_temp.vr_id('target')),'rowSide','NEW','path','NEW.authority.customer_id'),
 jsonb_build_object('ref',jsonb_build_object('kind','customer','id',pg_temp.vr_id('target')),'rowSide','NEW','path','NEW.payload.customer_id'))))),'exact proposal output');
 n:=jsonb_set(r,'{payload,customer_id}',to_jsonb(pg_temp.vr_id('source')));n:=jsonb_set(n,'{authority,customer_id}',to_jsonb(pg_temp.vr_id('source')));
 e:=private.catalog_extract_visit_reference_event_v1(ledger,'UPDATE',r,n);PERFORM pg_temp.vr_equal(e#>'{extraction,refs}',expected,'OLD plus NEW ledger scope');
 PERFORM pg_temp.vr_equal(private.catalog_extract_visit_reference_event_v1(ledger,'DELETE',r,NULL)#>'{extraction,refs}',jsonb_build_array(jsonb_build_object('kind','customer','id',pg_temp.vr_id('target'))),'removed OLD customer retained');
 r:=pg_temp.vr_finalize();e:=private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,r);
 PERFORM pg_temp.vr_equal(e#>'{extraction,edges}',jsonb_build_array(
 jsonb_build_object('kind','schedule','id',pg_temp.vr_id('schedule'),'customerId',pg_temp.vr_id('target'),'origin','NEW.payload.schedule_id','expect',jsonb_build_object('scheduleVersion','1','scheduledDate','2026-02-03')),
 jsonb_build_object('kind','visit','id',pg_temp.vr_id('visit'),'customerId',pg_temp.vr_id('target'),'origin','NEW.result.id','expect',jsonb_build_object('scheduleId',pg_temp.vr_id('schedule'))))),'capture binding survives extraction');
 PERFORM pg_temp.vr_equal(e#>'{extraction,refs}',jsonb_build_array(jsonb_build_object('kind','customer','id',pg_temp.vr_id('target'))),'UUID-shaped notes stay nonreference');
 FOR op IN SELECT unnest(ARRAY['propose_visit','amend_visit','create_schedule','edit_schedule','delete_schedule','approve_request','reject_request','withdraw_request','edit_visit_note']) LOOP
  b:=CASE op WHEN 'amend_visit' THEN pg_temp.vr_schedule() WHEN 'edit_schedule' THEN pg_temp.vr_schedule() WHEN 'delete_schedule' THEN pg_temp.vr_schedule()
   WHEN 'reject_request' THEN pg_temp.vr_request() WHEN 'withdraw_request' THEN pg_temp.vr_request() WHEN 'edit_visit_note' THEN pg_temp.vr_visit()
   WHEN 'approve_request' THEN jsonb_build_object('request',pg_temp.vr_request(),'schedule',NULL) ELSE 'null'::jsonb END;
  a:=CASE op WHEN 'propose_visit' THEN pg_temp.vr_request() WHEN 'amend_visit' THEN pg_temp.vr_request('amendment') WHEN 'create_schedule' THEN pg_temp.vr_schedule('target')
   WHEN 'edit_schedule' THEN pg_temp.vr_schedule('target',2) WHEN 'delete_schedule' THEN 'null'::jsonb WHEN 'reject_request' THEN pg_temp.vr_request('new','rejected',2)
   WHEN 'withdraw_request' THEN pg_temp.vr_request('new','withdrawn',2) WHEN 'edit_visit_note' THEN pg_temp.vr_visit(2)
   WHEN 'approve_request' THEN jsonb_build_object('request',pg_temp.vr_request('new','approved',2),'schedule',pg_temp.vr_schedule('target')) END;
  r:=pg_temp.vr_audit(op,b,a);e:=private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,r);
  PERFORM pg_temp.vr_equal(e->'ok','true',op||' exact nested branch');
  IF op='amend_visit' THEN PERFORM pg_temp.vr_equal(e#>'{extraction,refs}',expected,'amend root changes resource type'); END IF;
  IF op='delete_schedule' THEN PERFORM pg_temp.vr_equal(e#>'{extraction,refs}',jsonb_build_array(jsonb_build_object('kind','customer','id',pg_temp.vr_id('source'))),'removed OLD nested customer retained'); END IF;
 END LOOP;
 r:=pg_temp.vr_audit('approve_request',jsonb_build_object('request',pg_temp.vr_request(),'schedule',NULL),jsonb_build_object('request',pg_temp.vr_request('new','approved',2),'schedule',pg_temp.vr_schedule('target')));
 PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,jsonb_set(r,'{old_value}',pg_temp.vr_request())),'UNKNOWN_SHAPE','NEW.old_value','approval wrapper required');
 SELECT jsonb_object_agg(key,'null'::jsonb) INTO empty_schedule FROM jsonb_object_keys(pg_temp.vr_schedule()) key;
 n:=jsonb_set(r,'{old_value,schedule}',empty_schedule);PERFORM pg_temp.vr_equal(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n)->'ok','true','native all-null absent schedule');
 n:=jsonb_set(r,'{old_value}',(r->'old_value')-'schedule');PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'UNKNOWN_SHAPE','NEW.old_value','historical absent schedule differs from missing key');
 n:=jsonb_set(r,'{new_value,schedule,outlet_id}',to_jsonb(pg_temp.vr_id('source')));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.new_value.schedule','approval cross-customer binding');
 n:=jsonb_set(r,'{new_value,request,approved_schedule_id}',to_jsonb(pg_temp.vr_id('other-schedule')));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.new_value.schedule','approval cross-resource binding');
 -- Amendment approval retains the OLD source customer and NEW target customer.
 r:=pg_temp.vr_audit('approve_request',jsonb_build_object('request',pg_temp.vr_request('amendment'),'schedule',pg_temp.vr_schedule()),
  jsonb_build_object('request',pg_temp.vr_request('amendment','approved',2),'schedule',pg_temp.vr_schedule('target',2)));
 e:=private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,r);PERFORM pg_temp.vr_equal(e#>'{extraction,refs}',expected,'approval amendment OLD and NEW customers');
 n:=jsonb_set(r,'{old_value,schedule}','null');PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.old_value.schedule','amendment cannot use historical absent source');
 n:=jsonb_set(r,'{new_value,schedule,version}','1');PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.old_value.schedule','approval schedule version binding');
 r:=pg_temp.vr_audit('amend_visit',pg_temp.vr_schedule(),pg_temp.vr_request('amendment'));
 n:=jsonb_set(r,'{new_value,source_schedule_id}',to_jsonb(pg_temp.vr_id('other-schedule')));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.new_value.source_schedule_id','amend cross-resource binding');
 n:=jsonb_set(r,'{resource_id}',to_jsonb(pg_temp.vr_id('schedule')));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.resource_id','amend resource is NEW request not OLD schedule');
 n:=jsonb_set(r,'{old_value,extra}','null');PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'INSERT',NULL,n),'UNKNOWN_SHAPE','NEW.old_value','unknown nested key refused');
 n:=jsonb_set(r,'{old_value,outlet_id}','"bad"');PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(audit,'UPDATE',n,r),'INVALID_UUID','OLD.old_value.outlet_id','malformed OLD refuses');
 r:=pg_temp.vr_ledger('propose_visit');
 PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',r,r),'INVALID_EVENT','event','INSERT requires SQL-null OLD');
 PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'DELETE',r,'null'),'INVALID_EVENT','event','DELETE JSON null is not SQL-null NEW');
 PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'UPDATE',NULL,r),'INVALID_EVENT','event','UPDATE requires OLD');
 PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1('public.customers'::regclass,'INSERT',NULL,r),'UNKNOWN_RELATION','relation','unknown relation');
 PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,r||'{"operation":"future"}'),'UNKNOWN_OPERATION','NEW.operation','unknown operation');
 n:=jsonb_set(r,'{authority,source_customer_id}',to_jsonb(pg_temp.vr_id('source')));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.authority.source_customer_id','proposal cannot invent source');
 n:=jsonb_set(r,'{payload,customer_id}',to_jsonb(pg_temp.vr_id('source')));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.payload.customer_id','payload authority customer mismatch');
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,{},[],false,123,"bad"]') LOOP
  n:=jsonb_set(r,'{payload,customer_id}',bad);PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,n),'INVALID_UUID','NEW.payload.customer_id','strict UUID payload');
 END LOOP;
 r:=pg_temp.vr_finalize();
 FOR key IN SELECT unnest(ARRAY['customer_id','scheduled_date','expected_schedule_version']) LOOP
  n:=jsonb_set(r,'{payload}',(r->'payload')-key);PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n),'UNSUPPORTED_LEGACY_PROFILE','NEW.payload','unbound legacy capture refuses');
 END LOOP;
 n:=jsonb_set(r,'{payload,storage_path}',to_jsonb('visits/'||pg_temp.vr_id('other-schedule')||'/fictional.jpg'));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n),'CONTRADICTORY_LINEAGE','NEW.payload.storage_path','storage path schedule binding');
 n:=jsonb_set(r,'{payload,lat}','91');n:=jsonb_set(n,'{payload,lng}','0');PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n),'UNKNOWN_SHAPE','NEW.payload','coordinates bounds');
 FOR bad IN SELECT value FROM jsonb_array_elements('[0,-1,1.5,2147483648,null,"bad"]') LOOP
  n:=jsonb_set(r,'{payload,expected_schedule_version}',bad);PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n),'UNKNOWN_VERSION','NEW.payload.expected_schedule_version','invalid captured version');
 END LOOP;
 n:=jsonb_set(r,'{payload,expected_schedule_version}',to_jsonb(repeat('9',150000)));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n),'UNKNOWN_VERSION','NEW.payload.expected_schedule_version','oversized numeric string fails closed');
 FOR bad IN SELECT value FROM jsonb_array_elements('["infinity","2026-02-30","2026-99-01",null,42]') LOOP
  n:=jsonb_set(r,'{payload,scheduled_date}',bad);PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n),'UNKNOWN_SHAPE','NEW.payload.scheduled_date','finite date profile');
 END LOOP;
 n:=jsonb_set(r,'{payload,expected_schedule_version}','"1"');PERFORM pg_temp.vr_equal(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n)#>'{extraction,edges}',private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,r)#>'{extraction,edges}','source payload decimal string version normalized');
 n:=r||jsonb_build_object('operation','visit_recovery_abandoned','payload','{}'::jsonb,'result',NULL,'abandoned',true);PERFORM pg_temp.vr_equal(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n),jsonb_build_object('ok',true,'extraction',jsonb_build_object('refs','[]'::jsonb,'edges','[]'::jsonb,'origins','[]'::jsonb,'historicalNulls','[]'::jsonb)),'empty visit tombstone');
 n:=r||jsonb_build_object('result',NULL,'abandoned',true);PERFORM pg_temp.vr_equal(private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,n)#>'{extraction,refs}',private.catalog_extract_visit_reference_event_v1(visits,'INSERT',NULL,r)#>'{extraction,refs}','typed abandoned retains capture');
 r:=pg_temp.vr_ledger('propose_visit');n:=r||jsonb_build_object('operation','schedule_recovery_abandoned','payload','{}'::jsonb,'authority','{}'::jsonb,'abandoned',true);
 PERFORM pg_temp.vr_equal(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,n)->'ok','true','empty schedule tombstone');
 n:=jsonb_set(n,'{payload,customer_id}',to_jsonb(pg_temp.vr_id('target')));PERFORM pg_temp.vr_refused(private.catalog_extract_visit_reference_event_v1(ledger,'INSERT',NULL,n),'UNKNOWN_SHAPE','NEW.payload','tombstone cannot conceal customer');
END $behavior$;
DO $acl$
DECLARE f record; count_helpers integer;
BEGIN
 SELECT count(*) INTO count_helpers FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND (p.proname LIKE 'catalog_vr_%' OR p.proname='catalog_extract_visit_reference_event_v1');
 IF count_helpers<>11 THEN RAISE EXCEPTION 'owner-only exact helper set'; END IF;
 FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND (p.proname LIKE 'catalog_vr_%' OR p.proname='catalog_extract_visit_reference_event_v1') LOOP
  IF f.proowner<>'postgres'::regrole OR f.prosecdef OR f.provolatile<>'i' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner)
  OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE') OR has_function_privilege('service_role',f.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'owner-only function ACL: %',f.proname;
  END IF;
 END LOOP;
END $acl$;
-- Actual API role denial, not metadata privilege inference alone.
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM private.catalog_extract_visit_reference_event_v1('private.pilot_visit_requests'::regclass,'INSERT',NULL,'{}');
 RAISE EXCEPTION 'actual API role denial failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM private.catalog_extract_visit_reference_event_v1('private.pilot_visit_requests'::regclass,'INSERT',NULL,'{}');
 RAISE EXCEPTION 'actual API role denial failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM private.catalog_extract_visit_reference_event_v1('private.pilot_visit_requests'::regclass,'INSERT',NULL,'{}');
 RAISE EXCEPTION 'actual API role denial failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
