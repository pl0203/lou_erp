BEGIN;
\ir seed.sql
\ir accounts-seed.sql
-- Store fixture clock/IDs only; production never consults these test-only GUCs.
SELECT set_config('ihr.test.year',extract(year FROM clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer::text,true);
SELECT set_config('ihr.test.today',(clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date::text,true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE a jsonb;b jsonb;h jsonb;BEGIN
 a:=public.leave_prepare_self_v1();b:=public.leave_prepare_self_v1();
 PERFORM pg_temp.assert_true(a=b AND a->>'year'=current_setting('ihr.test.year'),'self preparation idempotent and current year');
 PERFORM set_config('ihr.test.account',a->>'accountId',true);
 PERFORM set_config('ihr.test.version',a->>'version',true);
 h:=public.leave_balance_history_v1((a->>'accountId')::uuid,NULL,1);
 PERFORM pg_temp.assert_true(h->'balance'->>'allowanceMinutes'='5400' AND h->'balance'->'approvedMinutes'='null'::jsonb AND h->'balance'->'pendingMinutes'='null'::jsonb AND h->'balance'->'availableMinutes'='null'::jsonb,'unreconciled buckets remain unknown');
 PERFORM pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(h) k)=ARRAY['balance','nextBefore','rows'],'history exact envelope');
 PERFORM pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(h->'rows'->0) k)=ARRAY['allowanceDelta','date','id','kind','reservedDelta','sequence','usedDelta'],'history exact minimized entry');
 PERFORM pg_temp.assert_true(h->'nextBefore'='null'::jsonb,'single page has no next cursor');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_balance_history_v1(%L,NULL,101)',a->>'accountId'),'22023');
END $$;
-- Neither peer nor assigned approver gains independent balance-history scope.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_balance_history_v1(%L)',current_setting('ihr.test.account')),'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_history_v1('78000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_balance_history_v1(%L)',current_setting('ihr.test.account')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_balance_history_v1(%L)',current_setting('ihr.test.account')),'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_accounts_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_balance_history_v1(%L)',current_setting('ihr.test.account')),'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_true(public.leave_balance_history_v1(current_setting('ihr.test.account')::uuid)->'rows'->0->>'kind'='annual_grant','read_private independent scope works');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_accounts_v1('71000000-0000-0000-0000-000000000002')$s$,'42501');
-- Opening for a missing account: import failure must roll back both preparation and all grants.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
DO $$ DECLARE payload jsonb;msg text;BEGIN
 payload:=jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000002','year',current_setting('ihr.test.year')::integer,
 'allowance_minutes',5400,'past_used_minutes',60,'future_approved',jsonb_build_array(jsonb_build_object('source_id','79000000-0000-0000-0000-000000000001','start_date',current_setting('ihr.test.today'),'end_date',current_setting('ihr.test.today'),'duration',jsonb_build_object('mode','fixed_minutes','minutes',60),'total_minutes',60)),
 'as_of',(current_setting('ihr.test.today')::date-1)::text,'source_id','78000000-0000-0000-0000-000000000002','expected_version',0,'reason','Fictional opening only');
 PERFORM set_config('ihr.test.import_payload',payload::text,true);
 BEGIN
  PERFORM public.leave_transaction_v1('77000000-0000-0000-0000-000000000001','reconcile_opening',payload);RAISE EXCEPTION 'Import unexpectedly available';
 EXCEPTION WHEN SQLSTATE '55000' THEN GET STACKED DIAGNOSTICS msg=PG_EXCEPTION_DETAIL;PERFORM pg_temp.assert_true(msg::jsonb->>'code'='OPENING_REQUEST_IMPORT_UNAVAILABLE','specific atomic import seam failure');END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.ihr_leave_accounts WHERE employee_id='71000000-0000-0000-0000-000000000002') OR EXISTS(SELECT 1 FROM private.ihr_leave_commands WHERE request_id='77000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'Opening failure left account or command'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT set_config('ihr.test.account2',(public.leave_prepare_self_v1()->>'accountId'),true);
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000002','reconcile_opening',jsonb_set(current_setting('ihr.test.import_payload')::jsonb,'{expected_version}','2')::text),'55000');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT allowance_minutes<>5400 OR opening_reconciled OR version<>2 FROM public.ihr_leave_accounts WHERE id=current_setting('ihr.test.account2')::uuid) OR (SELECT count(*) FROM public.ihr_leave_ledger WHERE account_id=current_setting('ihr.test.account2')::uuid)<>1 THEN RAISE EXCEPTION 'Prepared account was changed by failed import'; END IF;
END $$;
SET LOCAL ROLE authenticated;
-- Configure alone can reconcile scoped opening, but cannot adjust entitlement.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
DO $$ DECLARE payload jsonb;r jsonb;BEGIN
 payload:=jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','year',current_setting('ihr.test.year')::integer,'allowance_minutes',5400,'past_used_minutes',450,'future_approved','[]'::jsonb,'as_of',current_setting('ihr.test.today'),'source_id','78000000-0000-0000-0000-000000000003','expected_version',current_setting('ihr.test.version')::integer,'reason','Fictional verified opening');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000003','reconcile_opening',jsonb_set(payload,'{allowance_minutes}','4950')::text),'22023');
 r:=public.leave_transaction_v1('77000000-0000-0000-0000-000000000003','reconcile_opening',payload);
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('77000000-0000-0000-0000-000000000003','reconcile_opening',payload)=r,'same command returns same opening result');
 PERFORM pg_temp.assert_true(public.leave_reconcile_request_v1('77000000-0000-0000-0000-000000000003',false)->'result'=r,'opening command recovers exact result');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000003','reconcile_opening',jsonb_set(payload,'{past_used_minutes}','60')::text),'55000');
 PERFORM set_config('ihr.test.version',r->>'version',true);
END $$;
DO $$ DECLARE payload jsonb;BEGIN
 payload:=jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','year',current_setting('ihr.test.year')::integer,'delta_minutes',60,'source_id','78000000-0000-0000-0000-000000000004','expected_version',current_setting('ihr.test.version')::integer,'reason','Fictional allowance correction');
 PERFORM set_config('ihr.test.adjust_payload',payload::text,true);
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000004','adjust_balance',payload::text),'42501');
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
DO $$ DECLARE p jsonb:=current_setting('ihr.test.adjust_payload')::jsonb;r jsonb;BEGIN
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000005','adjust_balance',jsonb_set(p,'{delta_minutes}','-5000')::text),'55000');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000005','adjust_balance',jsonb_set(p,'{year}',to_jsonb(current_setting('ihr.test.year')::integer+1))::text),'22023');
 r:=public.leave_transaction_v1('77000000-0000-0000-0000-000000000005','adjust_balance',p);
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('77000000-0000-0000-0000-000000000005','adjust_balance',p)=r,'adjustment idempotent');
 PERFORM set_config('ihr.test.version',r->>'version',true);
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000006','adjust_balance',jsonb_set(p,'{expected_version}',to_jsonb((r->>'version')::integer))::text),'22023');
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE h jsonb;n jsonb;BEGIN
 h:=public.leave_balance_history_v1(current_setting('ihr.test.account')::uuid,NULL,1);
 PERFORM pg_temp.assert_true(h->'balance'->>'allowanceMinutes'='5460' AND h->'balance'->>'approvedMinutes'='450' AND h->'balance'->>'availableMinutes'='5010','verified opening plus independent correction, no extra 5400');
 n:=public.leave_balance_history_v1(current_setting('ihr.test.account')::uuid,(h->>'nextBefore')::bigint,1);
 PERFORM pg_temp.assert_true(h->'rows'->0->>'kind'='adjustment' AND n->'rows'->0->>'kind'='opening' AND (n->'rows'->0->>'sequence')::bigint<(h->'rows'->0->>'sequence')::bigint,'stable keyset pagination');
END $$;
RESET ROLE;
-- Self adjustment remains denied even with an explicit self-scoped grant.
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason)
VALUES('71000000-0000-0000-0000-000000000001','adjust','employee','71000000-0000-0000-0000-000000000001','2020-01-01','71000000-0000-0000-0000-000000000006','Fictional self-denial fixture');
SELECT set_config('ihr.test.member_version',(SELECT version::text FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000001'),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000007','adjust_balance',current_setting('ihr.test.adjust_payload')),'42501');
-- Administrative employee-to-director transition preserves ledger/history without a new grant.
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
DO $$ DECLARE p jsonb;r jsonb;BEGIN
 p:=jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','member_kind','director','active',true,'employment_start','2020-01-01','eligibility_date','2021-01-01','calendar_id',NULL,'expected_version',current_setting('ihr.test.member_version')::integer,'reason','Fictional director transition');
 r:=public.leave_transaction_v1('77000000-0000-0000-0000-000000000008','set_member',p);
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','77000000-0000-0000-0000-000000000009','set_member',(p||jsonb_build_object('member_kind','employee','expected_version',(r->>'version')::integer))::text),'22023');
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_prepare_self_v1()$s$,'55000');
SELECT pg_temp.assert_denied(format('SELECT public.leave_balance_history_v1(%L)',current_setting('ihr.test.account')),'42501');
SELECT pg_temp.assert_true(public.leave_context_v1()->'currentPeriod'='null'::jsonb AND public.leave_context_v1()->'balances'='[]'::jsonb,'open personal view revoked at director transition');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_true(public.leave_balance_history_v1(current_setting('ihr.test.account')::uuid)->'balance'->>'approvedMinutes'='450','independently scoped reader retains original director history');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE a public.ihr_leave_accounts%ROWTYPE;BEGIN
 SELECT * INTO a FROM public.ihr_leave_accounts WHERE id=current_setting('ihr.test.account')::uuid;
 IF a.used_minutes<>450 OR a.allowance_minutes<>5460 OR (SELECT count(*) FROM public.ihr_leave_ledger WHERE account_id=a.id)<>3 THEN RAISE EXCEPTION 'Transition recalculated history'; END IF;
 INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,used_delta,source_kind,source_id,source_event)
 VALUES(a.id,a.period_start,'cancellation',-450,'request','79000000-0000-0000-0000-000000000090','cancelled');
 IF (SELECT used_minutes FROM public.ihr_leave_accounts WHERE id=a.id)<>0 THEN RAISE EXCEPTION 'Original-period reversal blocked after director transition'; END IF;
 BEGIN INSERT INTO public.ihr_leave_accounts(employee_id,year,period_start,period_end,policy_id,timezone)
 VALUES(a.employee_id,a.year+1,make_date(a.year+1,1,1),make_date(a.year+2,1,1),a.policy_id,a.timezone);RAISE EXCEPTION 'New director account';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
END $$;
ROLLBACK;
