-- Final installed candidate regression: literal row sets and write outcomes, not old/new policy comparison.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ DECLARE t text; n bigint; BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable owner required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM storage.objects) OR EXISTS(SELECT 1 FROM private.pilot_order_requests) THEN RAISE EXCEPTION 'Empty final-policy fixture required'; END IF;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'pilot_fixture_marker' LOOP EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n; IF n<>0 THEN RAISE EXCEPTION 'Empty final-policy fixture required'; END IF; END LOOP;
END $$;
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT ('84000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,8)i;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT ('84000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Synthetic policy actor '||i,'policy-actor-'||i||'@example.invalid',(CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' ELSE 'executive' END)::public.user_role,i<>8,CASE i WHEN 4 THEN '84000000-0000-0000-0000-000000000002'::uuid WHEN 5 THEN '84000000-0000-0000-0000-000000000003'::uuid END FROM generate_series(1,8)i;
SET LOCAL session_replication_role='origin';
-- Preparation only: execute inside the separately guarded disposable pilot_test
-- transaction, as postgres, with only the eight fixture identities and the
-- hosted-equivalent policies. Run before loading the separate 6k benchmark.
-- The copied oracle below runs against the installed candidate. Its synthetic
-- data and temporary probe functions disappear on rollback before the large load.
SAVEPOINT parent_set_parity_cohort;
RESET ROLE;
DO $guard$ BEGIN
 IF current_user <> 'postgres' OR current_database() <> 'pilot_test'
 OR current_setting('session_replication_role') <> 'origin'
 OR (SELECT count(*) FROM public.pilot_fixture_marker) <> 1
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR EXISTS(SELECT 1 FROM public.purchase_orders)

 THEN RAISE EXCEPTION 'Guarded empty-business disposable owner transaction required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name='parent_set_parity_read') THEN
  RAISE EXCEPTION 'Parity prepared statement already exists'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid IN
  ('public.purchase_orders'::regclass,'public.po_line_items'::regclass,'public.surat_jalan'::regclass,'public.sj_line_items'::regclass)
  AND NOT tgisinternal AND tgenabled NOT IN ('O','A')) THEN
  RAISE EXCEPTION 'Normal business triggers must remain enabled'; END IF;
END $guard$;
SET LOCAL plan_cache_mode=force_generic_plan;
SELECT set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

CREATE TEMP TABLE parent_set_parity_actors(label text PRIMARY KEY,actor_id uuid,db_role name NOT NULL);
INSERT INTO parent_set_parity_actors VALUES
 ('executive','84000000-0000-0000-0000-000000000001','authenticated'),
 ('manager_a','84000000-0000-0000-0000-000000000002','authenticated'),
 ('manager_b','84000000-0000-0000-0000-000000000003','authenticated'),
 ('sales_a','84000000-0000-0000-0000-000000000004','authenticated'),
 ('sales_b','84000000-0000-0000-0000-000000000005','authenticated'),
 ('po_admin','84000000-0000-0000-0000-000000000006','authenticated'),
 ('sales_head','84000000-0000-0000-0000-000000000007','authenticated'),
 ('inactive','84000000-0000-0000-0000-000000000008','authenticated'),
 ('missing','84000000-0000-0000-0000-000000000099','authenticated'),
 ('anon',NULL,'anon');
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.users WHERE id='84000000-0000-0000-0000-000000000099') THEN
  RAISE EXCEPTION 'Missing-user probe unexpectedly has a profile'; END IF;
 IF (SELECT count(*) FROM public.users WHERE id IN(SELECT actor_id FROM pg_temp.parent_set_parity_actors WHERE label NOT IN('missing','anon'))) <> 8 THEN
  RAISE EXCEPTION 'Expected synthetic fixture actors missing'; END IF;
END $guard$;

-- Fourteen PO IDs are deliberately reused as the designated child IDs in each
-- separate table. Reads use these exact IDs; trigger-generated audit rows and
-- any unrelated rows are excluded from direct ID comparisons.
CREATE TEMP TABLE parent_set_parity_cohort(n integer PRIMARY KEY,id uuid UNIQUE NOT NULL,scenario text NOT NULL);
INSERT INTO parent_set_parity_cohort
SELECT n,('87000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,scenario
FROM (VALUES (1,'current sales A'),(2,'legacy sales A'),(3,'unlinked'),
 (4,'duplicate current links'),(5,'mixed current team links'),(6,'hidden customer / historical sales A'),
 (7,'inactive historical direct report'),(8,'manager A self history'),(9,'manager B self legacy history'),
 (10,'legacy sales B'),(11,'current sales B'),(12,'status changes'),
 (13,'duplicate mixed legacy links'),(14,'current B plus legacy A')) AS cases(n,scenario);

INSERT INTO auth.users(id) VALUES('87020000-0000-0000-0000-000000000001');
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
VALUES('87020000-0000-0000-0000-000000000001','PARENT SET inactive historical salesperson',
 'parent-set-history@example.invalid','sales_person',false,'84000000-0000-0000-0000-000000000002');
INSERT INTO public.customers(id,name) VALUES
 ('87010000-0000-0000-0000-000000000001','PARENT SET customer A'),
 ('87010000-0000-0000-0000-000000000002','PARENT SET customer B');
INSERT INTO public.outlets(id,name) VALUES
 ('87011000-0000-0000-0000-000000000001','PARENT SET legacy outlet A'),
 ('87011000-0000-0000-0000-000000000002','PARENT SET legacy outlet B');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES
 ('87010000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000001'),
 ('87010000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000003','84000000-0000-0000-0000-000000000001');
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id,assigned_by) VALUES
 ('87010000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000004','84000000-0000-0000-0000-000000000001'),
 ('87010000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000005','84000000-0000-0000-0000-000000000001');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date)
SELECT id,CASE WHEN n IN(6,9,10,11,14) THEN '87010000-0000-0000-0000-000000000002'::uuid
 ELSE '87010000-0000-0000-0000-000000000001'::uuid END,
 '84000000-0000-0000-0000-000000000006','PARENT-SET-PARITY-'||n,'in_progress','2026-09-15'
FROM pg_temp.parent_set_parity_cohort;
INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value)
SELECT p.customer_id,links.actor::uuid,'approved',p.id,100
FROM (VALUES
 (1,'84000000-0000-0000-0000-000000000004'),
 (4,'84000000-0000-0000-0000-000000000004'),(4,'84000000-0000-0000-0000-000000000004'),
 (5,'84000000-0000-0000-0000-000000000004'),(5,'84000000-0000-0000-0000-000000000005'),
 (6,'84000000-0000-0000-0000-000000000004'),(7,'87020000-0000-0000-0000-000000000001'),
 (8,'84000000-0000-0000-0000-000000000002'),(11,'84000000-0000-0000-0000-000000000005'),
 (12,'84000000-0000-0000-0000-000000000004'),(14,'84000000-0000-0000-0000-000000000005')
) AS links(n,actor) JOIN pg_temp.parent_set_parity_cohort c USING(n) JOIN public.purchase_orders p ON p.id=c.id;
INSERT INTO public.orders(outlet_id,sales_person_id,purchase_order_id)
SELECT CASE WHEN p.customer_id='87010000-0000-0000-0000-000000000001'::uuid
 THEN '87011000-0000-0000-0000-000000000001'::uuid
 ELSE '87011000-0000-0000-0000-000000000002'::uuid END,links.actor::uuid,p.id
FROM (VALUES
 (2,'84000000-0000-0000-0000-000000000004'),(9,'84000000-0000-0000-0000-000000000003'),
 (10,'84000000-0000-0000-0000-000000000005'),(13,'84000000-0000-0000-0000-000000000004'),
 (13,'84000000-0000-0000-0000-000000000004'),(13,'84000000-0000-0000-0000-000000000005'),
 (14,'84000000-0000-0000-0000-000000000004')
) AS links(n,actor) JOIN pg_temp.parent_set_parity_cohort c USING(n) JOIN public.purchase_orders p ON p.id=c.id;
DO $legacy$ BEGIN
 IF EXISTS(SELECT 1 FROM public.orders o JOIN public.purchase_orders p ON p.id=o.purchase_order_id
  JOIN pg_temp.parent_set_parity_cohort c ON c.id=p.id WHERE o.outlet_id=p.customer_id) THEN
  RAISE EXCEPTION 'Legacy outlet and current customer IDs must be distinct'; END IF;
END $legacy$;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT id,id,'PARENT SET item','PARENT-SET',10,10 FROM pg_temp.parent_set_parity_cohort;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by)
SELECT id,id,'PARENT-SET-SJ-'||n,'2026-09-16','84000000-0000-0000-0000-000000000006' FROM pg_temp.parent_set_parity_cohort;
INSERT INTO public.sj_line_items(id,surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT id,id,id,2 FROM pg_temp.parent_set_parity_cohort;
INSERT INTO public.po_audit_log(id,purchase_order_id,changed_by,field_changed,new_value)
SELECT id,id,'84000000-0000-0000-0000-000000000001','parent_set_parity_designated',scenario FROM pg_temp.parent_set_parity_cohort;
-- Fire deferred business triggers normally, before either policy variant.
SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE parent_set_parity_results(
 phase text NOT NULL,state text NOT NULL,actor text NOT NULL,surface text NOT NULL,outcome jsonb NOT NULL,
 PRIMARY KEY(phase,state,actor,surface));

CREATE FUNCTION pg_temp.parent_set_read_probe(query text,ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER AS $probe$
DECLARE result jsonb;
BEGIN
 IF current_user NOT IN('authenticated','anon') THEN RAISE EXCEPTION 'Real application role required'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items']) t(name)
  WHERE NOT row_security_active(('public.'||t.name)::regclass)) THEN RAISE EXCEPTION 'Active RLS required'; END IF;
 BEGIN
  EXECUTE query INTO result USING ids;
  RETURN jsonb_build_object('sqlstate','00000','data',result);
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('sqlstate',SQLSTATE); END;
END $probe$;

-- Every attempted write is rolled back in its own exception subtransaction,
-- including an unexpectedly permitted raw write. Only normalized observations
-- survive; generated UUIDs/timestamps are intentionally not compared.
CREATE FUNCTION pg_temp.parent_set_write_probe(operation text,target_table text,actor_label text,po uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER AS $probe$
DECLARE result jsonb; response jsonb; created uuid; replay jsonb; payload jsonb;
BEGIN
 IF current_user NOT IN('authenticated','anon') OR current_setting('session_replication_role') <> 'origin' THEN
  RAISE EXCEPTION 'Normal authenticated/anonymous write path required'; END IF;
 BEGIN
  IF operation='create_po' THEN
   payload:=jsonb_build_object('customer_id','87010000-0000-0000-0000-000000000001',
    'po_number','PARENT-SET-RPC-'||actor_label,'order_date','2026-09-20',
    'items',jsonb_build_array(jsonb_build_object('product_name','Parity paid line','quantity',2,'unit_price',10),
      jsonb_build_object('product_name','Parity zero line','quantity',1,'unit_price',0)));
   response:=public.pilot_order_transaction('87030000-0000-0000-0000-000000000001','create_po',payload);
   created:=(response->>'id')::uuid;
   replay:=public.pilot_order_transaction('87030000-0000-0000-0000-000000000001','create_po',payload);
   SELECT jsonb_build_object('sqlstate','00000','has_id',created IS NOT NULL,
    'has_version',nullif(response->>'updated_at','') IS NOT NULL,'replay_equal',replay=response,
    'header',(SELECT jsonb_build_object('customer_id',customer_id,'created_by',created_by,'po_number',po_number,'status',status,'order_date',order_date,'total_value',total_value) FROM public.purchase_orders WHERE id=created),
    'lines',(SELECT jsonb_agg(jsonb_build_object('name',product_name,'quantity',quantity,'unit_price',unit_price,'line_total',line_total) ORDER BY product_name) FROM public.po_line_items WHERE purchase_order_id=created),
    'audit_fields',(SELECT jsonb_agg(field_changed ORDER BY field_changed) FROM public.po_audit_log WHERE purchase_order_id=created)) INTO result;
  ELSE
   IF target_table NOT IN('purchase_orders','po_line_items','surat_jalan','sj_line_items')
    OR operation NOT IN('INSERT','UPDATE','DELETE') THEN RAISE EXCEPTION 'Unknown bounded raw-write probe'; END IF;
   IF operation='INSERT' THEN
    -- Permission must fail before constraint/duplicate checks; SQLSTATE is recorded.
    EXECUTE format('INSERT INTO public.%I(id) VALUES($1)',target_table) USING po;
   ELSIF operation='UPDATE' THEN
    EXECUTE format('UPDATE public.%I SET id=id WHERE id=$1',target_table) USING po;
   ELSE EXECUTE format('DELETE FROM public.%I WHERE id=$1',target_table) USING po; END IF;
   result:=jsonb_build_object('sqlstate','00000');
  END IF;
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Rollback completed parity write';
 EXCEPTION
  WHEN SQLSTATE 'PZ001' THEN NULL;
  WHEN OTHERS THEN result:=jsonb_build_object('sqlstate',SQLSTATE);
 END;
 RETURN result;
END $probe$;

-- Handwritten expected sets keep equality from passing vacuously (for example,
-- if a role or prepared statement accidentally observed no rows in both runs).
CREATE FUNCTION pg_temp.parent_set_expected_ids(actor_label text,state_label text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER AS $expected$
DECLARE numbers integer[];
BEGIN
 numbers:=CASE
  WHEN actor_label IN('executive','po_admin','sales_head') THEN ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14]
  WHEN actor_label='manager_a' AND state_label='manager_transfer' THEN ARRAY[7,8]
  WHEN actor_label='manager_b' AND state_label='manager_transfer' THEN ARRAY[1,2,4,5,6,9,10,11,12,13,14]
  WHEN actor_label='manager_a' THEN ARRAY[1,2,4,5,6,7,8,12,13,14]
  WHEN actor_label='manager_b' THEN ARRAY[5,9,10,11,13,14]
  WHEN actor_label='sales_a' AND state_label<>'sales_deactivated' THEN ARRAY[1,2,4,5,6,12,13,14]
  WHEN actor_label='sales_b' THEN ARRAY[5,10,11,13,14]
  ELSE ARRAY[]::integer[] END;
 RETURN (SELECT coalesce(jsonb_agg(('87000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid ORDER BY n),'[]'::jsonb) FROM unnest(numbers) n);
END $expected$;

-- No business-table grants are changed. These are test-local function grants.
REVOKE ALL ON FUNCTION pg_temp.parent_set_read_probe(text,uuid[]),pg_temp.parent_set_write_probe(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.parent_set_read_probe(text,uuid[]),pg_temp.parent_set_write_probe(text,text,text,uuid) TO authenticated,anon;
DO $permissions$ DECLARE temp_schema name; BEGIN
 SELECT nspname INTO temp_schema FROM pg_namespace WHERE oid=pg_my_temp_schema();
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated,anon',temp_schema);
END $permissions$;

-- This statement is prepared exactly once. Policy DDL may invalidate its plan;
-- actor/role changes and authority mutations must never reuse cached visibility.
PREPARE parent_set_parity_read(uuid[]) AS
SELECT jsonb_build_object(
 'purchase_orders',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM public.purchase_orders WHERE id=ANY($1)),
 'po_line_items',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM public.po_line_items WHERE id=ANY($1)),
 'po_audit_log',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM public.po_audit_log WHERE id=ANY($1)),
 'surat_jalan',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM public.surat_jalan WHERE id=ANY($1)),
 'sj_line_items',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM public.sj_line_items WHERE id=ANY($1)));

CREATE FUNCTION pg_temp.parent_set_capture_state(phase_label text,state_label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $capture$
DECLARE identity record; table_name text; op text; ids uuid[]; expected jsonb; observed jsonb;
 prepared_expected jsonb; customer_expected jsonb; customer_ids uuid[]:=ARRAY['87010000-0000-0000-0000-000000000001'::uuid,'87010000-0000-0000-0000-000000000002'::uuid];
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Capture orchestration requires owner'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM pg_temp.parent_set_parity_cohort;
 FOR identity IN SELECT * FROM pg_temp.parent_set_parity_actors ORDER BY label LOOP
  expected:=pg_temp.parent_set_expected_ids(identity.label,state_label);
  prepared_expected:='{}'::jsonb;
  EXECUTE format('SET LOCAL ROLE %I',identity.db_role);
  PERFORM set_config('request.jwt.claim.sub',coalesce(identity.actor_id::text,''),true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',identity.actor_id,'role',identity.db_role)::text,true);
  FOREACH table_name IN ARRAY ARRAY['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items'] LOOP
   observed:=pg_temp.parent_set_read_probe(format('SELECT coalesce(jsonb_agg(id ORDER BY id),''[]''::jsonb) FROM public.%I WHERE id=ANY($1)',table_name),ids);
   EXECUTE 'RESET ROLE';
   INSERT INTO pg_temp.parent_set_parity_results VALUES(phase_label,state_label,identity.label,table_name,observed);
   IF identity.label='anon' THEN
    IF observed->>'sqlstate' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Anonymous read unexpectedly permitted: %',table_name; END IF;
   ELSIF observed IS DISTINCT FROM jsonb_build_object('sqlstate','00000','data',expected) THEN
    RAISE EXCEPTION 'Unexpected exact ID set: phase %, state %, actor %, table %, outcome %',phase_label,state_label,identity.label,table_name,observed;
   END IF;
   prepared_expected:=prepared_expected||jsonb_build_object(table_name,expected);
   EXECUTE format('SET LOCAL ROLE %I',identity.db_role);
  END LOOP;
  observed:=pg_temp.parent_set_read_probe(format('EXECUTE parent_set_parity_read(%L::uuid[])',ids::text),ids);
  EXECUTE 'RESET ROLE';
  INSERT INTO pg_temp.parent_set_parity_results VALUES(phase_label,state_label,identity.label,'prepared_read',observed);
  IF observed IS DISTINCT FROM (CASE WHEN identity.label='anon' THEN jsonb_build_object('sqlstate','42501')
   ELSE jsonb_build_object('sqlstate','00000','data',prepared_expected) END) THEN
   RAISE EXCEPTION 'Prepared read leaked or lost identity: phase %, state %, actor %',phase_label,state_label,identity.label; END IF;
  customer_expected:=CASE
   WHEN identity.label IN('executive','po_admin','sales_head') THEN to_jsonb(customer_ids)
   WHEN identity.label='manager_a' AND state_label='customer_reassigned' THEN '[]'::jsonb
   WHEN identity.label='manager_b' AND state_label='customer_reassigned' THEN to_jsonb(customer_ids)
   WHEN identity.label='manager_a' OR (identity.label='sales_a' AND state_label<>'sales_deactivated') THEN jsonb_build_array(customer_ids[1])
   WHEN identity.label IN('manager_b','sales_b') THEN jsonb_build_array(customer_ids[2])
   ELSE '[]'::jsonb END;
  EXECUTE format('SET LOCAL ROLE %I',identity.db_role);
  observed:=pg_temp.parent_set_read_probe('SELECT coalesce(jsonb_agg(id ORDER BY id),''[]''::jsonb) FROM public.customers WHERE id=ANY($1)',customer_ids);
  EXECUTE 'RESET ROLE';
  INSERT INTO pg_temp.parent_set_parity_results VALUES(phase_label,state_label,identity.label,'customers',observed);
  IF observed IS DISTINCT FROM (CASE WHEN identity.label='anon' THEN jsonb_build_object('sqlstate','42501')
   ELSE jsonb_build_object('sqlstate','00000','data',customer_expected) END) THEN
   RAISE EXCEPTION 'Customer visibility mismatch: phase %, state %, actor %',phase_label,state_label,identity.label; END IF;
  IF state_label='initial' THEN
   FOREACH table_name IN ARRAY ARRAY['purchase_orders','po_line_items','surat_jalan','sj_line_items'] LOOP
    FOREACH op IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
     IF has_table_privilege(identity.db_role,'public.'||table_name,op) THEN RAISE EXCEPTION 'Unexpected raw write grant: %, %, %',identity.db_role,table_name,op; END IF;
     EXECUTE format('SET LOCAL ROLE %I',identity.db_role);
     observed:=pg_temp.parent_set_write_probe(op,table_name,identity.label,ids[1]);
     EXECUTE 'RESET ROLE';
     INSERT INTO pg_temp.parent_set_parity_results VALUES(phase_label,state_label,identity.label,'raw_'||table_name||'_'||op,observed);
     IF observed->>'sqlstate' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Raw write permission outcome changed: %, %, %',identity.label,table_name,op; END IF;
    END LOOP;
   END LOOP;
   EXECUTE format('SET LOCAL ROLE %I',identity.db_role);
   observed:=pg_temp.parent_set_write_probe('create_po',NULL,identity.label,ids[1]);
   EXECUTE 'RESET ROLE';
   INSERT INTO pg_temp.parent_set_parity_results VALUES(phase_label,state_label,identity.label,'rpc_create_po',observed);
   IF identity.label IN('executive','po_admin') THEN
    IF observed->>'sqlstate' IS DISTINCT FROM '00000' OR observed->>'has_id' IS DISTINCT FROM 'true'
     OR observed->>'has_version' IS DISTINCT FROM 'true' OR observed->>'replay_equal' IS DISTINCT FROM 'true'
     OR (observed->'header'->>'total_value')::numeric IS DISTINCT FROM 20
     OR jsonb_array_length(observed->'lines') IS DISTINCT FROM 2
     OR coalesce(jsonb_array_length(observed->'audit_fields'),0)<1 THEN
      RAISE EXCEPTION 'Normal create_po/replay/trigger path failed for %: %',identity.label,observed; END IF;
   ELSIF observed->>'sqlstate' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Unauthorized create_po outcome changed: %',identity.label; END IF;
   -- Owner verifies the successful subtransaction really rolled back every write.
   IF EXISTS(SELECT 1 FROM public.purchase_orders WHERE po_number='PARENT-SET-RPC-'||identity.label)
    OR EXISTS(SELECT 1 FROM private.pilot_order_requests WHERE request_id='87030000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Write probe escaped its rollback subtransaction'; END IF;
  END IF;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
END $capture$;

CREATE FUNCTION pg_temp.parent_set_capture_phase(phase_label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $phase$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Owner phase required'; END IF;
 PERFORM pg_temp.parent_set_capture_state(phase_label,'initial');
 UPDATE public.purchase_orders SET status='cancelled' WHERE id='87000000-0000-0000-0000-000000000012';
 UPDATE public.girard_orders SET status='cancelled' WHERE po_id='87000000-0000-0000-0000-000000000012';
 PERFORM pg_temp.parent_set_capture_state(phase_label,'status_changed');
 UPDATE public.users SET is_active=false WHERE id='84000000-0000-0000-0000-000000000004';
 PERFORM pg_temp.parent_set_capture_state(phase_label,'sales_deactivated');
 UPDATE public.users SET is_active=true WHERE id='84000000-0000-0000-0000-000000000004';
 PERFORM pg_temp.parent_set_capture_state(phase_label,'sales_reactivated');
 UPDATE public.users SET manager_id='84000000-0000-0000-0000-000000000003' WHERE id='84000000-0000-0000-0000-000000000004';
 PERFORM pg_temp.parent_set_capture_state(phase_label,'manager_transfer');
 UPDATE public.users SET manager_id='84000000-0000-0000-0000-000000000002' WHERE id='84000000-0000-0000-0000-000000000004';
 PERFORM pg_temp.parent_set_capture_state(phase_label,'manager_restored');
 UPDATE public.customer_manager_assignments SET manager_id='84000000-0000-0000-0000-000000000003'
  WHERE customer_id='87010000-0000-0000-0000-000000000001';
 PERFORM pg_temp.parent_set_capture_state(phase_label,'customer_reassigned');
 UPDATE public.customer_manager_assignments SET manager_id='84000000-0000-0000-0000-000000000002'
  WHERE customer_id='87010000-0000-0000-0000-000000000001';
 UPDATE public.purchase_orders SET status='in_progress' WHERE id='87000000-0000-0000-0000-000000000012';
 UPDATE public.girard_orders SET status='approved' WHERE po_id='87000000-0000-0000-0000-000000000012';
END $phase$;

SELECT pg_temp.parent_set_capture_phase('candidate');
RESET ROLE;
DO $final$ BEGIN
 IF (SELECT count(*) FROM pg_temp.parent_set_parity_results WHERE phase='candidate')<>620 THEN RAISE EXCEPTION 'Incomplete final policy matrix'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name='parent_set_parity_read' AND generic_plans>0) THEN RAISE EXCEPTION 'Prepared generic-plan identity coverage missing'; END IF;
END $final$;
DEALLOCATE parent_set_parity_read;
SELECT 'FINAL_READ_POLICY_MATRIX_VERIFIED' AS result;
ROLLBACK TO SAVEPOINT parent_set_parity_cohort;
RELEASE SAVEPOINT parent_set_parity_cohort;

RESET ROLE;
ROLLBACK;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.purchase_orders) OR EXISTS(SELECT 1 FROM private.pilot_order_requests) THEN RAISE EXCEPTION 'Final-policy rollback left data'; END IF; END $$;
SELECT 'FINAL_READ_POLICY_ROLLBACK_VERIFIED' AS result;
