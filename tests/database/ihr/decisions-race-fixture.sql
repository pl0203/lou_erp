-- Fixture only, fresh marked disposable snapshot. Owner setup is not authorization evidence.
BEGIN;
SELECT set_config('request.jwt.claim.sub','',true);
\ir quote-seed.sql
CREATE SCHEMA ihr_decision_race_fixture;
REVOKE ALL ON SCHEMA ihr_decision_race_fixture FROM PUBLIC,anon,authenticated;
CREATE TABLE ihr_decision_race_fixture.cases(scenario text PRIMARY KEY,request_id uuid NOT NULL,command_a uuid NOT NULL,command_b uuid NOT NULL,actor_a uuid NOT NULL,actor_b uuid NOT NULL,operation_a text NOT NULL,operation_b text NOT NULL,payload_a jsonb NOT NULL,payload_b jsonb NOT NULL,expected_status text NOT NULL);
DO $$DECLARE n integer;input jsonb;receipt jsonb;request_id uuid;scenario text;operation_a text;operation_b text;actor_a uuid;actor_b uuid;payload jsonb;BEGIN
 FOR n IN 1..6 LOOP
  PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
  input:=pg_temp.quote_input(pg_temp.quote_friday()+(n-1)*7,pg_temp.quote_friday()+(n-1)*7);
  receipt:=public.leave_transaction_v1(('85000000-0000-0000-0000-'||lpad((100+n)::text,12,'0'))::uuid,'submit_request',jsonb_build_object('input',input,'quote_fingerprint',public.leave_quote_v1(input)->>'fingerprint'));
  request_id:=(receipt->>'id')::uuid;
  scenario:=CASE n WHEN 1 THEN 'approve_reject' WHEN 2 THEN 'withdraw_approve' WHEN 3 THEN 'reject_approve' WHEN 4 THEN 'cancel_accept_decline' WHEN 5 THEN 'cancel_same_key' ELSE 'authority_after_account_wait' END;
  actor_a:=CASE WHEN n=2 THEN '71000000-0000-0000-0000-000000000001'::uuid ELSE '71000000-0000-0000-0000-000000000003'::uuid END;
  actor_b:='71000000-0000-0000-0000-000000000003';
  operation_a:=CASE n WHEN 2 THEN 'withdraw_request' WHEN 3 THEN 'reject_request' WHEN 4 THEN 'approve_cancellation' WHEN 5 THEN 'approve_cancellation' ELSE 'approve_request' END;
  operation_b:=CASE n WHEN 1 THEN 'reject_request' WHEN 4 THEN 'decline_cancellation' WHEN 5 THEN 'approve_cancellation' ELSE 'approve_request' END;
  payload:=jsonb_build_object('request_id',request_id,'expected_version',1);
  IF n IN(4,5) THEN
   PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
   PERFORM public.leave_transaction_v1(('85000000-0000-0000-0000-'||lpad((200+n)::text,12,'0'))::uuid,'approve_request',payload);
  END IF;
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO ihr_decision_race_fixture.cases VALUES(scenario,request_id,
   ('85000000-0000-0000-0000-'||lpad((300+n)::text,12,'0'))::uuid,
   ('85000000-0000-0000-0000-'||lpad((CASE WHEN n=5 THEN 300+n ELSE 400+n END)::text,12,'0'))::uuid,
   actor_a,actor_b,operation_a,operation_b,
   payload||CASE WHEN operation_a='reject_request' THEN '{"reason":"Fictional rejection"}'::jsonb ELSE '{}'::jsonb END,
   payload||CASE WHEN operation_b IN('reject_request','decline_cancellation') THEN '{"reason":"Fictional losing decision"}'::jsonb ELSE '{}'::jsonb END,
   CASE n WHEN 2 THEN 'withdrawn' WHEN 3 THEN 'rejected' WHEN 4 THEN 'cancelled' WHEN 5 THEN 'cancelled' ELSE 'approved' END);
 END LOOP;
END $$;
INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,to_jsonb(p)||jsonb_build_object(
 'id','85000000-0000-0000-0000-000000000090','version',2,'cancellation_rules_confirmed',true,'cancellation_mode','whole_request',
 'cancellation_allow_past',true,'cancellation_allow_repeat_declined',true,'cancellation_reason_required',false))).*
 FROM public.ihr_leave_policies p WHERE id='79000000-0000-0000-0000-000000000001';
UPDATE public.ihr_leave_members SET active_policy_id='85000000-0000-0000-0000-000000000090' WHERE user_id='71000000-0000-0000-0000-000000000001';
DO $$DECLARE c ihr_decision_race_fixture.cases%ROWTYPE;n integer:=0;attempt uuid;BEGIN
 FOR c IN SELECT * FROM ihr_decision_race_fixture.cases WHERE scenario IN('cancel_accept_decline','cancel_same_key') ORDER BY scenario LOOP
  n:=n+1;
  PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
  PERFORM public.leave_transaction_v1(('85000000-0000-0000-0000-'||lpad((500+n)::text,12,'0'))::uuid,'request_cancellation',jsonb_build_object('request_id',c.request_id,'expected_version',2,'reason','Fictional cancellation race'));
  attempt:=(public.leave_request_transition_state_v1(c.request_id)->>'activeAttemptId')::uuid;
  PERFORM set_config('request.jwt.claim.sub','',true);
  UPDATE ihr_decision_race_fixture.cases SET payload_a=payload_a||jsonb_build_object('expected_version',3,'attempt_id',attempt),payload_b=payload_b||jsonb_build_object('expected_version',3,'attempt_id',attempt) WHERE scenario=c.scenario;
 END LOOP;
END $$;
UPDATE public.ihr_leave_members SET active_policy_id='79000000-0000-0000-0000-000000000001' WHERE user_id='71000000-0000-0000-0000-000000000001';
COMMIT;
