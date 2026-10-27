-- READ-ONLY cross-server baseline attestation. No row/customer data or function bodies.
-- Run only with approved read access before candidate installation. No application step.
-- aclexplode is strict but rejects zero-dimensional empty arrays. Normalize empty
-- AFTER defaulting NULL function/relation ACLs; explicit empty remains no grants.
-- Column NULL/empty both mean no column-specific grants (table ACL is separate).
BEGIN READ ONLY;
SET LOCAL search_path='';
DO $preflight$ DECLARE catalogue boolean:=to_regclass('private.catalog_cutover_v1') IS NOT NULL;name text;signature text;generation smallint;tracking boolean;hr boolean:=to_regclass('private.employee_records') IS NOT NULL;BEGIN
 IF catalogue IS DISTINCT FROM hr THEN RAISE EXCEPTION 'Unsupported mixed catalogue/employee profile';END IF;
 FOREACH name IN ARRAY ARRAY['private.employee_account_links','private.employee_episodes'] LOOP
  IF (to_regclass(name) IS NOT NULL) IS DISTINCT FROM hr THEN RAISE EXCEPTION 'Partial employee authority profile';END IF;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['private.employee_account_allowed(uuid)','private.employee_restricted(uuid)','private.employee_end_elapsed(date,timestamp with time zone)'] LOOP
  IF (to_regprocedure(signature) IS NOT NULL) IS DISTINCT FROM hr THEN RAISE EXCEPTION 'Partial employee authority function profile: %',signature;END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['private.catalog_identity_v1','private.catalog_requests_v1','private.catalog_co_active_v2','private.catalog_writer_active_v2'] LOOP
  IF (to_regclass(name) IS NOT NULL) IS DISTINCT FROM catalogue THEN RAISE EXCEPTION 'Partial catalogue preflight profile';END IF;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['private.catalog_co_legacy_transaction_v1(uuid,text,jsonb)','private.catalog_co_transaction_v2(uuid,text,jsonb)','private.catalog_co_dispatch_v2(uuid,text,jsonb)','private.catalog_co_monthly_transaction_v2(uuid,text,jsonb)','private.catalog_evidence_legacy_v1(uuid,text,jsonb)','private.catalog_evidence_core_v2(uuid,text,jsonb,boolean)','private.catalog_history_producers_v1()','private.catalog_history_foreign_keys_v1()'] LOOP
  IF (to_regprocedure(signature) IS NOT NULL) IS DISTINCT FROM catalogue THEN RAISE EXCEPTION 'Partial catalogue preflight functions';END IF;
 END LOOP;
 IF catalogue THEN
  EXECUTE 'SELECT execution_generation,tracking_ready FROM private.catalog_cutover_v1 WHERE singleton' INTO STRICT generation,tracking;
  IF generation<>1 OR tracking IS DISTINCT FROM false THEN RAISE EXCEPTION 'Unsupported catalogue execution generation/tracking profile';END IF;
 END IF;
 FOREACH signature IN ARRAY ARRAY['private.co_actor_v1()','private.co_read_actor_v1()','private.co_lock_customer_v1(uuid,bigint)','private.co_read_lock_v1(uuid,text)','private.co_read_batches_v1(uuid,uuid,uuid)','private.co_build_plan_v1(uuid,text,jsonb)','private.co_allocation_signature_v1(jsonb)','private.co_effective_allocation_signature_v1(uuid)','private.co_workspace_generation_guard_v1()','public.pilot_co_transaction_v1(uuid,text,jsonb)'] LOOP
  IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'Missing return preflight dependency: %',signature;END IF;
 END LOOP;
 IF to_regclass('private.co_stock_key_unit_declarations') IS NULL THEN RAISE EXCEPTION 'Unit declaration schema missing';END IF;
 IF to_regclass('private.co_return_workspace_requests') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='private' AND p.proname='co_return_workspace_page_v1') OR (n.nspname='public' AND p.proname IN('pilot_co_return_customers_v1','pilot_co_return_history_customers_v1','pilot_co_return_items_v1','pilot_co_returns_page_v1','pilot_co_return_create_v1','pilot_co_return_create_result_v1'))) THEN
  RAISE EXCEPTION 'Partial or already installed return workspace candidate';
 END IF;
END $preflight$;
WITH functions AS (
 SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
  encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') source_sha256,
  pg_get_userbyid(p.proowner) owner,l.lanname language,p.prosecdef security_definer,p.provolatile volatility,p.proisstrict strict,p.proleakproof leakproof,p.proparallel parallel,p.proconfig settings,
  pg_get_function_result(p.oid) result_type,p.proretset returns_set,p.pronargdefaults default_count,
  encode(sha256(convert_to(pg_get_function_arguments(p.oid),'UTF8')),'hex') arguments_sha256,
  p.procost cost,p.prorows rows,p.probin library,p.prosupport::regproc::text support,CASE WHEN p.provariadic=0 THEN NULL ELSE p.provariadic::regtype::text END variadic_type,
  CASE WHEN p.proargdefaults IS NULL THEN NULL ELSE encode(sha256(convert_to(pg_get_function_arguments(p.oid),'UTF8')),'hex') END defaults_sha256,
  coalesce((SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) FROM aclexplode(NULLIF(coalesce(p.proacl,acldefault('f',p.proowner)),'{}'::aclitem[]))a),'[]') acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE p.prokind='f' AND ((n.nspname='private' AND (p.proname LIKE 'co\_%' ESCAPE '\' OR p.proname LIKE 'catalog\_%' ESCAPE '\' OR p.proname LIKE 'employee\_%' ESCAPE '\' OR p.proname LIKE 'ihr\_%' ESCAPE '\' OR p.proname LIKE 'demo\_%' ESCAPE '\')) OR (n.nspname='public' AND p.proname LIKE 'pilot\_%' ESCAPE '\'))
), relations AS (
 SELECT c.oid,n.nspname schema,c.relname name,c.relkind kind,c.relowner,c.relacl,c.relrowsecurity rls,c.relforcerowsecurity force_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p','v','m','S') AND
 ((n.nspname='private' AND (c.relname LIKE 'co\_%' ESCAPE '\' OR c.relname LIKE 'catalog\_%' ESCAPE '\' OR c.relname LIKE 'employee\_%' ESCAPE '\')) OR (n.nspname='public' AND c.relname IN('users','customers','products','customer_manager_assignments','customer_sales_rep_assignments')))
), tables AS (
 SELECT r.schema,r.name,r.kind,pg_get_userbyid(r.relowner) owner,r.rls,r.force_rls,(SELECT jsonb_build_object('type',q.seqtypid::regtype::text,'start',q.seqstart::text,'increment',q.seqincrement::text,'max',q.seqmax::text,'min',q.seqmin::text,'cache',q.seqcache::text,'cycle',q.seqcycle) FROM pg_sequence q WHERE q.seqrelid=r.oid) sequence_definition,CASE WHEN r.kind IN('v','m') THEN encode(sha256(convert_to(pg_get_viewdef(r.oid,true),'UTF8')),'hex') ELSE NULL END view_source_sha256,
 coalesce((SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) FROM aclexplode(NULLIF(coalesce(r.relacl,acldefault(CASE WHEN r.kind='S' THEN 's'::"char" ELSE 'r'::"char" END,r.relowner)),'{}'::aclitem[]))a),'[]') acl,
 coalesce((SELECT jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'acl',coalesce((SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type) FROM aclexplode(NULLIF(a.attacl,'{}'::aclitem[]))x),'[]')) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),'[]') columns,
 coalesce((SELECT jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=r.oid),'[]') constraints,
 coalesce((SELECT jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=r.oid),'[]') indexes,
 coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),'[]') triggers,
 coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role) END ORDER BY CASE WHEN role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role) END) FROM unnest(p.polroles)role),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=r.oid),'[]') policies
 FROM relations r
), document AS (
 SELECT jsonb_build_object('attestation_version','return-preflight-v1','catalogue_profile',CASE WHEN to_regclass('private.catalog_cutover_v1') IS NULL THEN 'bare' ELSE 'generation-one-tracking-disabled' END,
 'postgres_major',current_setting('server_version_num')::integer/10000,
 'functions',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY schema,name,arguments),'[]') FROM functions f),
 'tables',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY schema,name),'[]') FROM tables t)) value
)
SELECT jsonb_build_object('attestation_sha256',encode(sha256(convert_to(value::text,'UTF8')),'hex'),'attestation',value)::text FROM document;
COMMIT;
