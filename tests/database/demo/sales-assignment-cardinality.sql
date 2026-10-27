-- Synthetic PostgreSQL 17 contract. Requires the ordinary pilot baseline plus
-- reviewed 202610081101 order/promotion migration for real immutable PO credit.
-- Run once per disposable fixture; never execute against hosted state.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'pilot_test' OR current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR EXISTS(SELECT 1 FROM public.customer_sales_rep_assignments)
 THEN RAISE EXCEPTION 'Empty disposable assignment fixture required'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES
 ('da700000-0000-0000-0000-000000000001'),('da700000-0000-0000-0000-000000000002'),('da700000-0000-0000-0000-000000000003');
INSERT INTO public.users(id,full_name,email,role) VALUES
 ('da700000-0000-0000-0000-000000000001','Synthetic assignment admin','assignment-admin@synthetic.invalid','po_admin'),
 ('da700000-0000-0000-0000-000000000002','Synthetic assignment sales','assignment-sales@synthetic.invalid','sales_person'),
 ('da700000-0000-0000-0000-000000000003','Synthetic other sales','assignment-other@synthetic.invalid','sales_person');
INSERT INTO public.customers(id,name) VALUES
 ('da710000-0000-0000-0000-000000000001','Synthetic assignment store one'),
 ('da710000-0000-0000-0000-000000000002','Synthetic assignment store two'),
 ('da710000-0000-0000-0000-000000000003','Synthetic unassigned store');
INSERT INTO public.customer_sales_rep_assignments(id,customer_id,sales_rep_id,assigned_by) VALUES
 ('da720000-0000-0000-0000-000000000001','da710000-0000-0000-0000-000000000001','da700000-0000-0000-0000-000000000002','da700000-0000-0000-0000-000000000001');
-- The historical minimal fixture already has desired cardinality. Deliberately
-- reconstruct the verified old UNIQUE(sales_rep_id), so RED proves real behavior.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.customer_sales_rep_assignments'::regclass AND conname='customer_sales_rep_assignments_sales_rep_id_key') THEN
  ALTER TABLE public.customer_sales_rep_assignments ADD CONSTRAINT customer_sales_rep_assignments_sales_rep_id_key UNIQUE(sales_rep_id);
 END IF;
END $$;
-- Optional synthetic variants for the integration runner. Every mutation here
-- is protected by the empty disposable fixture gate above. Refusal variants
-- must exit nonzero when the same migration is included below.
\if :{?task7_hosted_shape}
 ALTER TABLE public.customer_sales_rep_assignments ADD COLUMN assigned_at timestamptz DEFAULT now();
 ALTER TABLE public.customer_sales_rep_assignments
  DROP CONSTRAINT customer_sales_rep_assignments_customer_id_fkey,
  ADD CONSTRAINT customer_sales_rep_assignments_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE CASCADE,
  DROP CONSTRAINT customer_sales_rep_assignments_sales_rep_id_fkey,
  ADD CONSTRAINT customer_sales_rep_assignments_sales_rep_id_fkey FOREIGN KEY(sales_rep_id) REFERENCES public.users(id) ON DELETE CASCADE;
\endif
\if :{?task7_extra_unique}
 CREATE UNIQUE INDEX task7_unexpected_salesperson_key ON public.customer_sales_rep_assignments(sales_rep_id);
\endif
\if :{?task7_partial_unique}
 CREATE UNIQUE INDEX task7_unexpected_partial_key ON public.customer_sales_rep_assignments(sales_rep_id) WHERE assigned_by IS NOT NULL;
\endif
\if :{?task7_wrong_key}
 ALTER TABLE public.customer_sales_rep_assignments DROP CONSTRAINT customer_sales_rep_assignments_sales_rep_id_key,
  ADD CONSTRAINT customer_sales_rep_assignments_sales_rep_id_key UNIQUE(sales_rep_id,customer_id);
\endif
\if :{?task7_renamed_key}
 ALTER TABLE public.customer_sales_rep_assignments RENAME CONSTRAINT customer_sales_rep_assignments_sales_rep_id_key TO task7_unexpected_name;
\endif
\if :{?task7_incoming_fk}
 CREATE TABLE public.task7_incoming_dependency(sales_rep_id uuid REFERENCES public.customer_sales_rep_assignments(sales_rep_id));
\endif
\if :{?task7_replica_identity}
 ALTER TABLE public.customer_sales_rep_assignments REPLICA IDENTITY USING INDEX customer_sales_rep_assignments_sales_rep_id_key;
\endif
\if :{?task7_missing_customer_key}
 ALTER TABLE public.customer_sales_rep_assignments DROP CONSTRAINT customer_sales_rep_assignments_customer_id_key;
\endif
\if :{?task7_metadata_mutation}
 CREATE FUNCTION public.task7_change_acl_after_drop() RETURNS event_trigger LANGUAGE plpgsql AS $fixture$
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.customer_sales_rep_assignments'::regclass AND conname='customer_sales_rep_assignments_sales_rep_id_key') THEN
   GRANT INSERT ON public.customer_sales_rep_assignments TO authenticated;
  END IF;
 END $fixture$;
 CREATE EVENT TRIGGER task7_metadata_mutation ON ddl_command_end WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION public.task7_change_acl_after_drop();
\endif
\if :{?task7_extra_column}
 ALTER TABLE public.customer_sales_rep_assignments ADD COLUMN task7_unexpected_column text;
\endif
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','da700000-0000-0000-0000-000000000001',true);
SELECT public.pilot_order_transaction('da730000-0000-0000-0000-000000000001','create_po',
 '{"po_number":"SYNTHETIC-TASK7-PO","customer_id":"da710000-0000-0000-0000-000000000001","order_date":"2026-10-08","expected_delivery_date":null,"notes":"Synthetic fixed attribution","items":[{"product_id":null,"product_name":"Synthetic manual item","sku":"","quantity":1,"unit_price":1}]}'::jsonb);
COMMIT;
CREATE TEMP TABLE assignment_test_rows AS SELECT to_jsonb(a) AS metadata FROM public.customer_sales_rep_assignments a;
CREATE TEMP TABLE assignment_test_credit AS SELECT to_jsonb(p) AS metadata FROM public.purchase_orders p;
CREATE TEMP TABLE assignment_test_metadata AS
 SELECT 'relation' AS kind,c.oid,to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen'] AS metadata FROM pg_class c WHERE c.oid='public.customer_sales_rep_assignments'::regclass
 UNION ALL SELECT 'column',a.attnum::oid,to_jsonb(a) FROM pg_attribute a WHERE a.attrelid='public.customer_sales_rep_assignments'::regclass AND a.attnum>0
 UNION ALL SELECT 'policy',p.oid,to_jsonb(p) FROM pg_policy p WHERE p.polrelid='public.customer_sales_rep_assignments'::regclass
 UNION ALL SELECT 'constraint',k.oid,to_jsonb(k) FROM pg_constraint k WHERE k.conrelid='public.customer_sales_rep_assignments'::regclass AND k.conname<>'customer_sales_rep_assignments_sales_rep_id_key'
 UNION ALL SELECT 'index',i.indexrelid,to_jsonb(i) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.customer_sales_rep_assignments'::regclass AND c.relname<>'customer_sales_rep_assignments_sales_rep_id_key';
\if :{?task7_skip_migration}
 \echo 'RED: retaining exact old salesperson uniqueness'
\else
 \ir ../../../supabase/migrations/202610081104_demo_sales_assignment_cardinality.sql
\endif
DO $$ DECLARE violated_constraint text; BEGIN
 IF EXISTS((SELECT metadata FROM assignment_test_rows EXCEPT SELECT to_jsonb(a) FROM public.customer_sales_rep_assignments a)
  UNION ALL (SELECT to_jsonb(a) FROM public.customer_sales_rep_assignments a EXCEPT SELECT metadata FROM assignment_test_rows))
 THEN RAISE EXCEPTION 'ASSERT assignment rows preserved'; END IF;
 IF EXISTS((SELECT metadata FROM assignment_test_credit EXCEPT SELECT to_jsonb(p) FROM public.purchase_orders p)
  UNION ALL (SELECT to_jsonb(p) FROM public.purchase_orders p EXCEPT SELECT metadata FROM assignment_test_credit))
 THEN RAISE EXCEPTION 'ASSERT immutable historical credit preserved'; END IF;
 IF EXISTS(WITH after_metadata AS (
  SELECT 'relation',c.oid,to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen'] FROM pg_class c WHERE c.oid='public.customer_sales_rep_assignments'::regclass
  UNION ALL SELECT 'column',a.attnum::oid,to_jsonb(a) FROM pg_attribute a WHERE a.attrelid='public.customer_sales_rep_assignments'::regclass AND a.attnum>0
  UNION ALL SELECT 'policy',p.oid,to_jsonb(p) FROM pg_policy p WHERE p.polrelid='public.customer_sales_rep_assignments'::regclass
  UNION ALL SELECT 'constraint',k.oid,to_jsonb(k) FROM pg_constraint k WHERE k.conrelid='public.customer_sales_rep_assignments'::regclass AND k.conname<>'customer_sales_rep_assignments_sales_rep_id_key'
  UNION ALL SELECT 'index',i.indexrelid,to_jsonb(i) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.customer_sales_rep_assignments'::regclass AND c.relname<>'customer_sales_rep_assignments_sales_rep_id_key')
  (SELECT * FROM assignment_test_metadata EXCEPT SELECT * FROM after_metadata)
  UNION ALL (SELECT * FROM after_metadata EXCEPT SELECT * FROM assignment_test_metadata))
 THEN RAISE EXCEPTION 'ASSERT assignment metadata preserved'; END IF;
 BEGIN
  INSERT INTO public.customer_sales_rep_assignments(id,customer_id,sales_rep_id,assigned_by) VALUES
   ('da720000-0000-0000-0000-000000000002','da710000-0000-0000-0000-000000000002','da700000-0000-0000-0000-000000000002','da700000-0000-0000-0000-000000000001');
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ASSERT two stores must accept the same salesperson'; END;
 BEGIN
  INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES('da710000-0000-0000-0000-000000000001','da700000-0000-0000-0000-000000000003');
  RAISE EXCEPTION 'ASSERT duplicate store accepted';
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violated_constraint=CONSTRAINT_NAME;
  IF violated_constraint<>'customer_sales_rep_assignments_customer_id_key' THEN RAISE EXCEPTION 'ASSERT wrong duplicate-store constraint'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.customer_sales_rep_assignments'::regclass AND conname='customer_sales_rep_assignments_customer_id_key' AND pg_get_constraintdef(oid)='UNIQUE (customer_id)') THEN RAISE EXCEPTION 'ASSERT exact customer uniqueness retained'; END IF;
 END;
 BEGIN
  INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES('da710000-0000-0000-0000-000000000003','da700000-0000-0000-0000-000000000099');
  RAISE EXCEPTION 'ASSERT missing salesperson FK accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES('da710000-0000-0000-0000-000000000099','da700000-0000-0000-0000-000000000003');
  RAISE EXCEPTION 'ASSERT missing customer FK accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id,assigned_by) VALUES('da710000-0000-0000-0000-000000000003','da700000-0000-0000-0000-000000000003','da700000-0000-0000-0000-000000000099');
  RAISE EXCEPTION 'ASSERT missing assigned-by FK accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.customer_sales_rep_assignments(id,customer_id,sales_rep_id) VALUES('da720000-0000-0000-0000-000000000001','da710000-0000-0000-0000-000000000003','da700000-0000-0000-0000-000000000003');
  RAISE EXCEPTION 'ASSERT duplicate PK accepted';
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violated_constraint=CONSTRAINT_NAME;
  IF violated_constraint<>'customer_sales_rep_assignments_pkey' THEN RAISE EXCEPTION 'ASSERT wrong duplicate-id constraint'; END IF;
 END;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','da700000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.customer_sales_rep_assignments)<>2 THEN RAISE EXCEPTION 'ASSERT own two stores visible'; END IF;
 BEGIN INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES('da710000-0000-0000-0000-000000000003',auth.uid()); RAISE EXCEPTION 'ASSERT browser assignment mutation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.customer_sales_rep_assignments SET sales_rep_id=auth.uid(); RAISE EXCEPTION 'ASSERT browser assignment update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.customer_sales_rep_assignments; RAISE EXCEPTION 'ASSERT browser assignment delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','da700000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.customer_sales_rep_assignments) THEN RAISE EXCEPTION 'ASSERT unrelated assignments disclosed'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.customer_sales_rep_assignments; RAISE EXCEPTION 'ASSERT anonymous assignment access allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
-- Desired-state replay must preserve the two existing assignments, not recreate them.
\ir ../../../supabase/migrations/202610081104_demo_sales_assignment_cardinality.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM public.customer_sales_rep_assignments)<>2 THEN RAISE EXCEPTION 'ASSERT desired-state replay changed assignments'; END IF;
END $$;
UPDATE public.customer_sales_rep_assignments SET sales_rep_id='da700000-0000-0000-0000-000000000003' WHERE customer_id='da710000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF EXISTS((SELECT metadata FROM assignment_test_credit EXCEPT SELECT to_jsonb(p) FROM public.purchase_orders p)
  UNION ALL (SELECT to_jsonb(p) FROM public.purchase_orders p EXCEPT SELECT metadata FROM assignment_test_credit))
 OR NOT EXISTS(SELECT 1 FROM public.purchase_orders WHERE sales_person_id_at_creation='da700000-0000-0000-0000-000000000002' AND sales_attribution_state='assigned')
 THEN RAISE EXCEPTION 'ASSERT later reassignment rewrote immutable credit'; END IF;
END $$;
SELECT 'DEMO_SALES_ASSIGNMENT_CARDINALITY_SQL_PASSED' AS result;
