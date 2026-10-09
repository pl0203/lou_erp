-- Fragment executed inside the generator's guarded empty disposable transaction.
-- All facts are fictional. The caller owns BEGIN/ROLLBACK and metadata restoration.
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM public.users) OR EXISTS(SELECT 1 FROM public.purchase_orders)
 OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM private.pilot_order_requests)
 THEN RAISE EXCEPTION 'Empty helper truth fixture required'; END IF;
END $$;
CREATE FUNCTION pg_temp.truth_actor(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT ('91000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.truth_po(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT ('92000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid $$;
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT pg_temp.truth_actor(i) FROM generate_series(1,12)i;
INSERT INTO auth.users(id) VALUES(pg_temp.truth_actor(99)); -- authenticated orphan, no profile
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT pg_temp.truth_actor(i),'HELPER SYNTHETIC '||i,'helper-'||i||'@example.invalid',
 (CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager'
 WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' WHEN 8 THEN 'executive' WHEN 10 THEN 'sales_manager' WHEN 12 THEN 'po_admin' ELSE 'sales_person' END)::public.user_role,
 i NOT IN(8,9),CASE WHEN i IN(4,9,10,12) THEN pg_temp.truth_actor(2) WHEN i=5 THEN pg_temp.truth_actor(3) WHEN i=11 THEN pg_temp.truth_actor(10) END
FROM generate_series(1,12)i;
INSERT INTO public.customers(id,name) VALUES(pg_temp.truth_po(90),'HELPER SYNTHETIC CUSTOMER');
INSERT INTO public.outlets(id,name) VALUES(pg_temp.truth_po(91),'HELPER SYNTHETIC LEGACY OUTLET');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date)
SELECT pg_temp.truth_po(i),pg_temp.truth_po(90),pg_temp.truth_actor(1),'HELPER-SYNTHETIC-'||i,(CASE WHEN i=13 THEN 'complete' ELSE 'confirm' END)::public.po_status,'2026-09-01' FROM generate_series(1,15)i;
INSERT INTO public.girard_orders(customer_id,submitted_by,po_id,status)
SELECT pg_temp.truth_po(90),pg_temp.truth_actor(actor),pg_temp.truth_po(po),CASE WHEN po=15 THEN 'rejected' ELSE 'approved' END
FROM (VALUES(1,4),(3,5),(4,9),(5,12),(8,11),(9,4),(9,4),(9,5),(13,2),(15,4)) v(po,actor);
INSERT INTO public.orders(outlet_id,sales_person_id,purchase_order_id)
SELECT pg_temp.truth_po(91),pg_temp.truth_actor(actor),pg_temp.truth_po(po)
FROM (VALUES(2,4),(6,9),(7,12),(10,4),(10,4),(10,5),(11,NULL::integer),(14,2)) v(po,actor);
-- Both NULL-link cases prevent equality being accidentally changed to null-safe equality.
INSERT INTO public.girard_orders(customer_id,submitted_by,po_id,status)
VALUES(pg_temp.truth_po(90),pg_temp.truth_actor(4),NULL,'pending');
INSERT INTO public.orders(outlet_id,sales_person_id,purchase_order_id)
VALUES(pg_temp.truth_po(91),pg_temp.truth_actor(4),NULL);
SET LOCAL session_replication_role='origin';
SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE helper_truth_results(phase text,state text,actor integer,po integer,outcome jsonb);
-- This hostile table belongs to authenticated, not the owner running setup.
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE users(id uuid,role text,is_active boolean,manager_id uuid);
INSERT INTO pg_temp.users VALUES('91000000-0000-0000-0000-000000000004','executive',true,NULL);
RESET ROLE;
SET LOCAL search_path=pg_temp,public;
SET LOCAL plan_cache_mode=force_generic_plan;
PREPARE helper_identity_probe(uuid) AS SELECT private.pilot_can_read_po($1);
CREATE FUNCTION pg_temp.helper_probe(po uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE answer boolean;
BEGIN
 IF current_user NOT IN('authenticated','anon') OR NOT row_security_active('public.purchase_orders') THEN RAISE EXCEPTION 'Real helper probe role/RLS required'; END IF;
 BEGIN
  EXECUTE format('EXECUTE helper_identity_probe(%L::uuid)',po) INTO answer;
  RETURN jsonb_build_object('sqlstate','00000','value',answer);
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('sqlstate',SQLSTATE); END;
END $$;
CREATE FUNCTION pg_temp.helper_assert(actor integer,po integer,expected boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE observed jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',coalesce(pg_temp.truth_actor(actor)::text,''),true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 observed:=pg_temp.helper_probe(pg_temp.truth_po(po));
 EXECUTE 'RESET ROLE';
 IF observed IS DISTINCT FROM jsonb_build_object('sqlstate','00000','value',expected) THEN
  RAISE EXCEPTION 'Helper truth mismatch: actor %, PO %, expected %, got %',actor,po,expected,observed;
 END IF;
 RETURN observed;
END $$;
CREATE FUNCTION pg_temp.helper_capture(phase text,state text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE a integer;p integer; wanted boolean; grants integer[]; active boolean; observed jsonb;
BEGIN
 FOR a IN SELECT unnest(ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,99,NULL]) LOOP
  active:=a IS NOT NULL AND a NOT IN(8,9,99) AND NOT(a=4 AND state='sales_deactivated') AND NOT(a=2 AND state='manager_deactivated');
  grants:=CASE a
   WHEN 2 THEN CASE WHEN state='manager_demoted' THEN ARRAY[13,14] WHEN state='manager_transfer' THEN ARRAY[4,5,6,7,13,14] ELSE ARRAY[1,2,4,5,6,7,9,10,13,14,15] END
   WHEN 3 THEN CASE WHEN state='manager_transfer' THEN ARRAY[1,2,3,9,10,15] ELSE ARRAY[3,9,10] END
   WHEN 4 THEN ARRAY[1,2,9,10,15] WHEN 5 THEN ARRAY[3,9,10] WHEN 10 THEN ARRAY[8] WHEN 11 THEN ARRAY[8]
   ELSE ARRAY[]::integer[] END;
  FOR p IN SELECT unnest(ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,99,NULL]) LOOP
   wanted:=coalesce(active AND (a IN(1,6,7,12) OR (p IS NOT NULL AND p=ANY(grants))),false);
   observed:=pg_temp.helper_assert(a,p,wanted);
   INSERT INTO pg_temp.helper_truth_results VALUES(phase,state,a,p,observed);
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION pg_temp.helper_phase(phase text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM pg_temp.helper_capture(phase,'initial');
 PERFORM set_config('request.jwt.claim.sub',pg_temp.truth_actor(1)::text,true);
 UPDATE public.users SET is_active=false WHERE id=pg_temp.truth_actor(4);
 PERFORM pg_temp.helper_capture(phase,'sales_deactivated');
 PERFORM set_config('request.jwt.claim.sub',pg_temp.truth_actor(1)::text,true);
 UPDATE public.users SET is_active=true WHERE id=pg_temp.truth_actor(4);
 UPDATE public.users SET role='sales_person' WHERE id=pg_temp.truth_actor(2);
 PERFORM pg_temp.helper_capture(phase,'manager_demoted');
 PERFORM set_config('request.jwt.claim.sub',pg_temp.truth_actor(1)::text,true);
 UPDATE public.users SET role='sales_manager',is_active=false WHERE id=pg_temp.truth_actor(2);
 PERFORM pg_temp.helper_capture(phase,'manager_deactivated');
 PERFORM set_config('request.jwt.claim.sub',pg_temp.truth_actor(1)::text,true);
 UPDATE public.users SET is_active=true WHERE id=pg_temp.truth_actor(2);
 UPDATE public.users SET manager_id=pg_temp.truth_actor(3) WHERE id=pg_temp.truth_actor(4);
 PERFORM pg_temp.helper_capture(phase,'manager_transfer');
 PERFORM set_config('request.jwt.claim.sub',pg_temp.truth_actor(1)::text,true);
 UPDATE public.users SET manager_id=pg_temp.truth_actor(2) WHERE id=pg_temp.truth_actor(4);
 UPDATE public.girard_orders SET status='rejected' WHERE po_id=pg_temp.truth_po(1);
 UPDATE public.purchase_orders SET status='cancelled' WHERE id=pg_temp.truth_po(1);
 PERFORM pg_temp.helper_capture(phase,'restored_and_status_changed');
 PERFORM set_config('request.jwt.claim.sub',pg_temp.truth_actor(1)::text,true);
 UPDATE public.girard_orders SET status='approved' WHERE po_id=pg_temp.truth_po(1);
 UPDATE public.purchase_orders SET status='confirm' WHERE id=pg_temp.truth_po(1);
END $$;
CREATE FUNCTION pg_temp.helper_exception_probes() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE observed jsonb;
BEGIN
 PERFORM pg_temp.helper_assert(100,1,false); -- no auth identity or profile
 IF NOT has_function_privilege('authenticated','private.pilot_can_read_po(uuid)','EXECUTE')
 OR has_function_privilege('anon','private.pilot_can_read_po(uuid)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE p.oid='private.pilot_can_read_po(uuid)'::regprocedure AND x.grantee=0 AND x.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Helper execute boundary changed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','malformed-synthetic-uuid',true);
 EXECUTE 'SET LOCAL ROLE authenticated'; observed:=pg_temp.helper_probe(pg_temp.truth_po(1)); EXECUTE 'RESET ROLE';
 IF observed IS DISTINCT FROM jsonb_build_object('sqlstate','22P02') THEN RAISE EXCEPTION 'Malformed claim SQLSTATE changed: %',observed; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 EXECUTE 'SET LOCAL ROLE anon'; observed:=pg_temp.helper_probe(NULL); EXECUTE 'RESET ROLE';
 IF observed IS DISTINCT FROM jsonb_build_object('sqlstate','42501') THEN RAISE EXCEPTION 'Anon helper denial changed: %',observed; END IF;
END $$;
SELECT pg_temp.helper_phase('baseline');
SELECT pg_temp.helper_exception_probes();
SELECT pg_temp.apply_can_read_po_trial();
SELECT pg_temp.helper_phase('candidate');
SELECT pg_temp.helper_exception_probes();
DO $parity$ BEGIN
 IF (SELECT count(*) FROM pg_temp.helper_truth_results WHERE phase='baseline')<>1428
 OR (SELECT count(*) FROM pg_temp.helper_truth_results WHERE phase='candidate')<>1428 THEN RAISE EXCEPTION 'Incomplete direct truth matrix'; END IF;
 IF EXISTS((SELECT state,actor,po,outcome FROM pg_temp.helper_truth_results WHERE phase='baseline' EXCEPT SELECT state,actor,po,outcome FROM pg_temp.helper_truth_results WHERE phase='candidate')
 UNION ALL (SELECT state,actor,po,outcome FROM pg_temp.helper_truth_results WHERE phase='candidate' EXCEPT SELECT state,actor,po,outcome FROM pg_temp.helper_truth_results WHERE phase='baseline')) THEN RAISE EXCEPTION 'Direct helper parity changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name='helper_identity_probe' AND generic_plans>5) THEN RAISE EXCEPTION 'Prepared helper reuse not exercised'; END IF;
END $parity$;
-- Each deliberate defect must cause the independent oracle to fail. Its exception
-- subtransaction restores the candidate body automatically, including its metadata.
DO $negative$ DECLARE label text;body text; BEGIN
 FOR label,body IN SELECT * FROM (VALUES
  ('constant_false','SELECT false'),('constant_true','SELECT true'),
  ('missing_caller_null','SELECT NULL::boolean'),
  ('requires_parent','SELECT EXISTS(SELECT 1 FROM public.purchase_orders WHERE id=po)')) v(label,body) LOOP
  BEGIN
   EXECUTE format($ddl$CREATE OR REPLACE FUNCTION private.pilot_can_read_po(po uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS %L$ddl$,body);
   IF label IN('constant_false','requires_parent') THEN PERFORM pg_temp.helper_assert(1,NULL,true);
   ELSE PERFORM pg_temp.helper_assert(99,1,false); END IF;
   RAISE EXCEPTION 'Negative helper control was not rejected: %',label;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM NOT LIKE 'Helper truth mismatch:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'HELPER_NEGATIVE_CONTROL_REJECTED %',label;
 END LOOP;
END $negative$;
DEALLOCATE helper_identity_probe;
SELECT 'HELPER_DIRECT_TRUTH_VERIFIED' AS result,1428 AS observations_per_variant;
