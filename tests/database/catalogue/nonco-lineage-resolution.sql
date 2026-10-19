-- Fictional semantics/ACL assertions, authored but UNRUN. No server/target selection.
-- An independently authorized fixture runner must run before installation for the
-- exact PCN01 missing-entrypoint RED, then after both dependency and fragment.
DO $$ BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'CATALOGUE_NONCO_FIXTURE_INVALID' USING ERRCODE='PCN00'; END IF;
 IF to_regprocedure('private.catalog_resolve_nonco_frozen_v1(jsonb,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_NONCO_MISSING_FUNCTION' USING ERRCODE='PCN01'; END IF;
 IF to_regprocedure('private.catalog_vr_snapshot_v1(text,jsonb,text,text)') IS NULL THEN
  RAISE EXCEPTION 'CATALOGUE_NONCO_DEPENDENCY_MISSING' USING ERRCODE='PCN00'; END IF;
END $$;
CREATE FUNCTION pg_temp.nl_assert(p_ok boolean,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',p_label; END IF;
END $$;
CREATE FUNCTION pg_temp.nl_id(p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT md5('fictional-'||p_label)::uuid::text $$;
CREATE FUNCTION pg_temp.nl_edge(p_kind text,p_id text,p_expect jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('kind',p_kind,'id',pg_temp.nl_id(p_id),'origin','OLD.payload.resource','expect',p_expect)
$$;
CREATE FUNCTION pg_temp.nl_ex(p_edges jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('refs','[]'::jsonb,'edges',p_edges,'origins','[]'::jsonb,'historicalNulls','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.nl_schedule(p_version integer DEFAULT 1,p_customer text DEFAULT 'customer') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',pg_temp.nl_id('schedule'),'outlet_id',pg_temp.nl_id(p_customer),'sales_person_id',pg_temp.nl_id('sales'),
 'assigned_by',pg_temp.nl_id('admin'),'scheduled_date','2026-01-01','status','pending','notes',NULL,'created_at','2026-01-01T00:00:00Z','version',p_version)
$$;
CREATE FUNCTION pg_temp.nl_visit() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',pg_temp.nl_id('visit'),'outlet_id',pg_temp.nl_id('customer'),'sales_person_id',pg_temp.nl_id('sales'),
 'schedule_id',pg_temp.nl_id('schedule'),'checked_in_at','2026-01-01T00:00:00Z','lat',NULL,'lng',NULL,'notes',NULL,'note_version',1)
$$;
CREATE FUNCTION pg_temp.nl_request() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',pg_temp.nl_id('request'),'requester_id',pg_temp.nl_id('sales'),'kind','amendment','customer_id',pg_temp.nl_id('customer'),
 'scheduled_date','2026-01-01','notes',NULL,'source_schedule_id',pg_temp.nl_id('schedule'),'base_version',1,'approved_schedule_id',pg_temp.nl_id('schedule'),
 'status','approved','version',2,'reviewer_id',pg_temp.nl_id('admin'),'decided_at','2026-01-01T00:00:00Z','created_at','2026-01-01T00:00:00Z')
$$;
CREATE FUNCTION pg_temp.nl_snap(p_source text,p_row jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('source',p_source,'row',p_row) $$;
DO $$
DECLARE h jsonb; e jsonb; result jsonb; base jsonb; expect jsonb; k text; altered jsonb;
BEGIN
 base:=pg_temp.nl_snap('public.sales_schedules',pg_temp.nl_schedule()); h:=jsonb_build_object('snapshots',jsonb_build_array(base));
 e:=pg_temp.nl_edge('schedule','schedule',jsonb_build_object('scheduleVersion','1','scheduledDate','2026-01-01'));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(e)),h);
 PERFORM pg_temp.nl_assert(result->'ok'='true'::jsonb AND result->'extraction'->'edges'='[]'::jsonb AND result->'extraction'->'refs'=jsonb_build_array(jsonb_build_object('kind','customer','id',pg_temp.nl_id('customer'))),'OLD_ONLY');
 PERFORM pg_temp.nl_assert(result->'resolved'->0->'edge'=e,'PRESERVE_EXACT_CONSTRAINTS');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(e)),jsonb_build_object('snapshots',jsonb_build_array(base,pg_temp.nl_snap('public.sales_schedules',pg_temp.nl_schedule(1,'other')))));
 PERFORM pg_temp.nl_assert(result->>'code'='AMBIGUOUS_LINEAGE','CONFLICT_SAME_VERSION');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(e||jsonb_build_object('customerId',pg_temp.nl_id('other')))),h);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'WRONG_SCOPE');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(jsonb_set(e,'{expect,ignored}','"x"'))),h);
 PERFORM pg_temp.nl_assert(result->>'code'='UNSUPPORTED_CONSTRAINT','UNKNOWN_EXPECT');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(e||jsonb_build_object('orderId',pg_temp.nl_id('po')))),h);
 PERFORM pg_temp.nl_assert(result->>'code'='UNSUPPORTED_CONSTRAINT','NO_ORDER_DROP');
 FOREACH k IN ARRAY ARRAY['po','po_line','delivery','girard_order','promotion','co_line'] LOOP
  result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge(k,'resource',jsonb_build_object('productId',pg_temp.nl_id('product'))))),h);
  PERFORM pg_temp.nl_assert(result->>'code'='UNSUPPORTED_LINEAGE_KIND','UNSUPPORTED_PO_'||k);
 END LOOP;
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('visit','visit'))),jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.outlet_visits',pg_temp.nl_visit()))));
 PERFORM pg_temp.nl_assert(result->>'code'='MISSING_LINEAGE','DANGLING');
 h:=jsonb_build_object('snapshots',jsonb_build_array(base,pg_temp.nl_snap('public.outlet_visits',pg_temp.nl_visit()),pg_temp.nl_snap('public.visit_requests',pg_temp.nl_request())));
 expect:=jsonb_build_object('requestVersion','2','requestKind','amendment','requestStatus','approved','sourceScheduleId',pg_temp.nl_id('schedule'),'baseVersion','1','approvedScheduleId',pg_temp.nl_id('schedule'));
 e:=pg_temp.nl_edge('visit_request','request',expect)||jsonb_build_object('customerId',pg_temp.nl_id('customer'));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(e,pg_temp.nl_edge('visit','visit',jsonb_build_object('scheduleId',pg_temp.nl_id('schedule'),'noteVersion','1')))),h);
 PERFORM pg_temp.nl_assert(result->'ok'='true'::jsonb AND jsonb_array_length(result->'resolved')=5,'ALL_VISIT_EXPECTS');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(e)),jsonb_build_object('snapshots',jsonb_build_array(base,pg_temp.nl_snap('public.visit_requests',jsonb_set(pg_temp.nl_request(),'{requester_id}',to_jsonb(pg_temp.nl_id('other-sales')))))));
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'APPROVED_SINGLE_TUPLE');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('visit','visit',jsonb_build_object('noteVersion','2')))),h);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'NOTE_VERSION');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('visit','visit',jsonb_build_object('scheduleId',pg_temp.nl_id('other'))))),h);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'VISIT_SCHEDULE_BINDING');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex('[]'),jsonb_build_object('snapshots',jsonb_build_array(base||jsonb_build_object('row',NULL))));
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'INVALID_UNUSED_ROW');
 -- Every request constraint tested independently, not merely happy-path combined.
 FOR k IN SELECT jsonb_object_keys(expect) LOOP
  altered:=jsonb_set(e,ARRAY['expect',k],to_jsonb(CASE k WHEN 'requestKind' THEN 'new' WHEN 'requestStatus' THEN 'pending'
   WHEN 'requestVersion' THEN '3' WHEN 'baseVersion' THEN '2' ELSE pg_temp.nl_id('wrong') END));
  result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(altered)),h);
  PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'BINDING_'||k);
 END LOOP;
 e:=pg_temp.nl_edge('schedule','schedule',jsonb_build_object('scheduleVersion','2147483647'));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(e)),jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',pg_temp.nl_schedule(2147483647)))));
 PERFORM pg_temp.nl_assert(result->'ok'='true'::jsonb,'VERSION_FIDELITY');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(jsonb_set(e,'{expect,scheduleVersion}','"9007199254740993"'))),h);
 PERFORM pg_temp.nl_assert(result->>'code'='UNKNOWN_VERSION','BIGINT_NOT_ROUNDED');
 -- Unversioned lookup conservatively keeps old and new customers; removed OLD retained.
 h:=jsonb_build_object('snapshots',jsonb_build_array(base,pg_temp.nl_snap('public.sales_schedules',pg_temp.nl_schedule(2,'other'))));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('schedule','schedule'))),h);
 PERFORM pg_temp.nl_assert(result->'ok'='true'::jsonb AND jsonb_array_length(result->'extraction'->'refs')=2,'OLD_NEW_CUSTOMERS');
 -- Constraints cannot be weakened by merging identical resource identities.
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('schedule','schedule'),pg_temp.nl_edge('schedule','schedule',jsonb_build_object('scheduleVersion','3')))),h);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'NO_CONSTRAINT_DEDUP');
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('schedule','schedule',jsonb_build_object('scheduledDate','2026-01-02')))),h);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'DATE_BINDING');
END $$;
-- V2 adversarial retained-history regressions; semantic execution remains UNRUN.
DO $$
DECLARE req jsonb; source_row jsonb; approved_row jsonb; history jsonb; edge jsonb; result jsonb; changed jsonb; field text;
BEGIN
 source_row:=pg_temp.nl_schedule();
 req:=pg_temp.nl_request()||jsonb_build_object('status','pending','approved_schedule_id',NULL,'reviewer_id',NULL,'decided_at',NULL,'version',1);
 edge:=pg_temp.nl_edge('visit_request','request');
 -- Source customer reassignment is legitimate. Do not equate it to requested customer.
 req:=req||jsonb_build_object('customer_id',pg_temp.nl_id('new-customer'));
 history:=jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',source_row),pg_temp.nl_snap('public.visit_requests',req)));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(edge)),history);
 PERFORM pg_temp.nl_assert(result->'ok'='true'::jsonb,'V2_SOURCE_CUSTOMER_REASSIGNMENT');
 -- Same ID/version but wrong person must fail for pending amendment.
 changed:=source_row||jsonb_build_object('sales_person_id',pg_temp.nl_id('wrong-person'));
 history:=jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',changed),pg_temp.nl_snap('public.visit_requests',req)));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(edge)),history);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'V2_PENDING_SOURCE_PERSON');
 -- A later version with the right person cannot supply a separate tuple witness.
 history:=jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',changed),pg_temp.nl_snap('public.sales_schedules',source_row||jsonb_build_object('version',7)),pg_temp.nl_snap('public.visit_requests',req)));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(edge)),history);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'V2_SOURCE_JOINT_VERSION_PERSON');
 -- Valid approval tuple cannot conceal an invalid source tuple.
 approved_row:=source_row||jsonb_build_object('id',pg_temp.nl_id('approved-schedule'),'outlet_id',pg_temp.nl_id('new-customer'));
 req:=req||jsonb_build_object('status','approved','approved_schedule_id',pg_temp.nl_id('approved-schedule'),'reviewer_id',pg_temp.nl_id('admin'),'decided_at','2026-01-01T00:00:00Z','version',2);
 history:=jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',changed),pg_temp.nl_snap('public.sales_schedules',approved_row),pg_temp.nl_snap('public.visit_requests',req)));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(edge)),history);
 PERFORM pg_temp.nl_assert(result->'ok'='false'::jsonb,'V2_APPROVED_SOURCE_PERSON');
 -- Every non-note field of a retained visit is immutable, not only its FK tuple.
 FOREACH field IN ARRAY ARRAY['checked_in_at','lat','lng'] LOOP
  changed:=pg_temp.nl_visit()||jsonb_build_object('note_version',9);
  IF field='checked_in_at' THEN changed:=changed||jsonb_build_object(field,'2026-01-02T00:00:00Z');
  ELSE changed:=changed||jsonb_build_object('lat',1,'lng',2); END IF;
  history:=jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',source_row),pg_temp.nl_snap('public.outlet_visits',pg_temp.nl_visit()),pg_temp.nl_snap('public.outlet_visits',changed)));
  result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('visit','visit'))),history);
  PERFORM pg_temp.nl_assert(result->>'code'='CONTRADICTORY_LINEAGE','V2_VISIT_IMMUTABLE_'||field);
 END LOOP;
 FOREACH field IN ARRAY ARRAY['assigned_by','created_at'] LOOP
  changed:=source_row||jsonb_build_object('version',8);
  changed:=changed||jsonb_build_object(field,CASE field WHEN 'assigned_by' THEN pg_temp.nl_id('other-assigner') ELSE '2026-01-02T00:00:00Z' END);
  history:=jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',source_row),pg_temp.nl_snap('public.sales_schedules',changed)));
  result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('schedule','schedule'))),history);
  PERFORM pg_temp.nl_assert(result->>'code'='CONTRADICTORY_LINEAGE','V2_SCHEDULE_IMMUTABLE_'||field);
 END LOOP;
 -- Nonadjacent saved versions are allowed; no completeness/adjacency fiction.
 changed:=pg_temp.nl_visit()||jsonb_build_object('note_version',9,'notes','changed note');
 history:=jsonb_build_object('snapshots',jsonb_build_array(pg_temp.nl_snap('public.sales_schedules',source_row),pg_temp.nl_snap('public.sales_schedules',source_row||jsonb_build_object('version',8,'notes','changed schedule')),
 pg_temp.nl_snap('public.outlet_visits',pg_temp.nl_visit()),pg_temp.nl_snap('public.outlet_visits',changed)));
 result:=private.catalog_resolve_nonco_frozen_v1(pg_temp.nl_ex(jsonb_build_array(pg_temp.nl_edge('visit','visit'))),history);
 PERFORM pg_temp.nl_assert(result->'ok'='true'::jsonb,'V2_NONADJACENT_ALLOWED');
END $$;
DO $$ DECLARE p record; role_name text; BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='private.catalog_resolve_nonco_frozen_v1(jsonb,jsonb)'::regprocedure;
 PERFORM pg_temp.nl_assert(p.provolatile='i' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""'],'FIXED_INVOKER');
 PERFORM pg_temp.nl_assert(pg_get_userbyid(p.proowner)='postgres','OWNER');
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.nl_assert(NOT has_function_privilege(role_name,p.oid,'EXECUTE'),'ACL_'||role_name);
 END LOOP;
 PERFORM pg_temp.nl_assert(NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner),'NO_NONOWNER_GRANTS');
END $$;
\echo CATALOGUE_NONCO_FROZEN_ASSERTIONS_PASSED
