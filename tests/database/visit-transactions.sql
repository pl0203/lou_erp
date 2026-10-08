-- Synthetic serial visit finalization tests; all data and injected faults roll back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('13000000-0000-0000-0000-000000000001'),('13000000-0000-0000-0000-000000000002');
INSERT INTO public.users(id,full_name,email,role) VALUES
('13000000-0000-0000-0000-000000000001','Synthetic rep','visit@tests.invalid','sales_person'),
('13000000-0000-0000-0000-000000000002','Synthetic other rep','other-visit@tests.invalid','sales_person');
INSERT INTO public.customers(id,name) VALUES ('23000000-0000-0000-0000-000000000001','Synthetic visit customer'),('23000000-0000-0000-0000-000000000002','Synthetic failed visit customer');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) SELECT ('43000000-0000-0000-0000-00000000000'||n)::uuid,CASE WHEN n=2 THEN '23000000-0000-0000-0000-000000000002'::uuid ELSE '23000000-0000-0000-0000-000000000001'::uuid END,'13000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001',current_date+n FROM generate_series(1,3)n;
INSERT INTO storage.objects(bucket_id,name,owner_id) SELECT 'visits','visits/43000000-0000-0000-0000-00000000000'||n||'/photo.webp','13000000-0000-0000-0000-000000000001' FROM generate_series(1,3)n;
CREATE FUNCTION public.pilot_test_fail_photo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.storage_path LIKE '%000000000002/%' THEN RAISE EXCEPTION 'injected photo failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER pilot_test_fail_photo BEFORE INSERT ON public.visit_photos FOR EACH ROW EXECUTE FUNCTION public.pilot_test_fail_photo();
-- Preserve legacy atomic-evidence scenarios with the required captured binding.
CREATE FUNCTION pg_temp.finalize_bound(request uuid,operation text,payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.pilot_finalize_visit(request,operation,payload||jsonb_build_object('expected_schedule_version',1,'customer_id',s.outlet_id,'scheduled_date',s.scheduled_date,'notes',null))
 FROM public.sales_schedules s WHERE s.id=(payload->>'schedule_id')::uuid;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE r jsonb; again jsonb; payload jsonb; request uuid:=gen_random_uuid(); failed uuid:=gen_random_uuid(); abandoned uuid:=gen_random_uuid();
BEGIN
 payload:='{"schedule_id":"43000000-0000-0000-0000-000000000001","storage_path":"visits/43000000-0000-0000-0000-000000000001/photo.webp","lat":-6.2,"lng":106.8}';
 r:=pg_temp.finalize_bound(request,'finalize_visit',payload);
 IF (SELECT count(*) FROM public.outlet_visits WHERE schedule_id=(payload->>'schedule_id')::uuid)<>1 OR (SELECT count(*) FROM public.visit_photos WHERE visit_id=(r->>'id')::uuid)<>1 THEN RAISE EXCEPTION 'Missing atomic visit/photo'; END IF;
 IF (SELECT status FROM public.sales_schedules WHERE id=(payload->>'schedule_id')::uuid)<>'completed' THEN RAISE EXCEPTION 'Schedule not completed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.outlet_visits v JOIN public.visit_photos p ON p.visit_id=v.id WHERE v.id=(r->>'id')::uuid AND v.checked_in_at=p.taken_at AND v.checked_in_at>clock_timestamp()-interval '1 minute') THEN RAISE EXCEPTION 'Server timestamp mismatch'; END IF;
 again:=pg_temp.finalize_bound(request,'finalize_visit',payload);
 IF r<>again THEN RAISE EXCEPTION 'Visit replay mismatch'; END IF;
 IF public.pilot_reconcile_visit(request,false)->>'state'<>'committed' THEN RAISE EXCEPTION 'Visit recovery failed'; END IF;
 BEGIN PERFORM pg_temp.finalize_bound(request,'finalize_visit',payload || '{"lat":1}'::jsonb); RAISE EXCEPTION 'Changed payload accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM pg_temp.finalize_bound(gen_random_uuid(),'finalize_visit',payload); RAISE EXCEPTION 'Duplicate schedule accepted'; EXCEPTION WHEN SQLSTATE 'PVS01' OR object_not_in_prerequisite_state THEN
 IF SQLSTATE <> (CASE WHEN to_regclass('private.pilot_visit_requests') IS NULL THEN '55000' ELSE 'PVS01' END) THEN RAISE; END IF; END;
 BEGIN PERFORM pg_temp.finalize_bound(failed,'finalize_visit','{"schedule_id":"43000000-0000-0000-0000-000000000002","storage_path":"visits/43000000-0000-0000-0000-000000000002/photo.webp"}'); RAISE EXCEPTION 'Fault not raised'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected photo failure' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id='43000000-0000-0000-0000-000000000002') OR (SELECT status FROM public.sales_schedules WHERE id='43000000-0000-0000-0000-000000000002')<>'pending' THEN RAISE EXCEPTION 'Failed photo left completed visit'; END IF;
 PERFORM public.pilot_reconcile_visit(abandoned,true);
 BEGIN PERFORM pg_temp.finalize_bound(abandoned,'finalize_visit',payload); RAISE EXCEPTION 'Abandoned request executed'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN PERFORM pg_temp.finalize_bound(gen_random_uuid(),'finalize_visit','{"schedule_id":"43000000-0000-0000-0000-000000000003","storage_path":"visits/43000000-0000-0000-0000-000000000003/missing.webp"}'); RAISE EXCEPTION 'Missing object accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM pg_temp.finalize_bound(gen_random_uuid(),'finalize_visit','{"schedule_id":"43000000-0000-0000-0000-000000000003","storage_path":"visits/43000000-0000-0000-0000-000000000001/photo.webp"}'); RAISE EXCEPTION 'Wrong schedule object accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM pg_temp.finalize_bound(gen_random_uuid(),'finalize_visit','{"schedule_id":"43000000-0000-0000-0000-000000000003","storage_path":"visits/43000000-0000-0000-0000-000000000003/photo.webp","lat":91,"lng":0}'); RAISE EXCEPTION 'Invalid geo accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','13000000-0000-0000-0000-000000000002',true);
 BEGIN PERFORM pg_temp.finalize_bound(gen_random_uuid(),'finalize_visit',payload); RAISE EXCEPTION 'Foreign schedule accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN UPDATE public.sales_schedules SET scheduled_date=scheduled_date+1 WHERE id='43000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'Finalized schedule mutable'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN UPDATE public.sales_schedules SET status='completed' WHERE id='43000000-0000-0000-0000-000000000003'; RAISE EXCEPTION 'Unproven schedule completed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM public.sales_schedules WHERE id='43000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'Visited schedule deleted'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 DELETE FROM public.sales_schedules WHERE id='43000000-0000-0000-0000-000000000003';
 IF EXISTS(SELECT 1 FROM public.sales_schedules WHERE id='43000000-0000-0000-0000-000000000003') THEN RAISE EXCEPTION 'Unvisited schedule deletion silently ignored'; END IF;
 IF has_table_privilege('authenticated','public.outlet_visits','INSERT') OR has_table_privilege('authenticated','public.visit_photos','INSERT') THEN RAISE EXCEPTION 'Direct visit writes remain'; END IF;
END $$;
ROLLBACK;
