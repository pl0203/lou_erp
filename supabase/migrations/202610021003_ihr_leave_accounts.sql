-- Unpublished annual accounts candidate. No staff, grants, policy or opening positions are seeded.
BEGIN;
CREATE TABLE public.ihr_leave_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES public.ihr_leave_members(user_id),
 leave_type text NOT NULL DEFAULT 'annual' CHECK(leave_type='annual'),year integer NOT NULL CHECK(year BETWEEN 1 AND 9998),
 period_start date NOT NULL,period_end date NOT NULL,policy_id uuid NOT NULL REFERENCES public.ihr_leave_policies(id),
 timezone text NOT NULL,allowance_minutes integer NOT NULL DEFAULT 0 CHECK(allowance_minutes>=0),
 reserved_minutes integer NOT NULL DEFAULT 0 CHECK(reserved_minutes>=0),used_minutes integer NOT NULL DEFAULT 0 CHECK(used_minutes>=0),
 opening_reconciled boolean NOT NULL DEFAULT false,opening_as_of date,opening_source_id uuid,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(employee_id,leave_type,year),CHECK(period_start=make_date(year,1,1) AND period_end=make_date(year+1,1,1)),
 CHECK(allowance_minutes>=used_minutes+reserved_minutes),
 CHECK(opening_reconciled=(opening_as_of IS NOT NULL AND opening_source_id IS NOT NULL)),
 CHECK(opening_as_of IS NULL OR (opening_as_of>=period_start AND opening_as_of<period_end))
);
CREATE TABLE public.ihr_leave_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 account_id uuid NOT NULL REFERENCES public.ihr_leave_accounts(id),effective_date date NOT NULL,
 kind text NOT NULL CHECK(kind IN('annual_grant','opening','adjustment','reservation','approval','rejection','withdrawal','cancellation')),
 allowance_delta integer NOT NULL DEFAULT 0,reserved_delta integer NOT NULL DEFAULT 0,used_delta integer NOT NULL DEFAULT 0,
 source_kind text NOT NULL CHECK(length(btrim(source_kind)) BETWEEN 1 AND 80),source_id uuid NOT NULL,
 source_event text NOT NULL CHECK(length(btrim(source_event)) BETWEEN 1 AND 80),actor_id uuid REFERENCES public.users(id),
 reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,source_kind,source_id,source_event),
 CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
 CHECK(kind<>'annual_grant' OR (allowance_delta=5400 AND reserved_delta=0 AND used_delta=0)),
 CHECK(kind<>'opening' OR (allowance_delta=0 AND reserved_delta=0 AND used_delta>=0)),
 CHECK(kind<>'adjustment' OR (allowance_delta<>0 AND reserved_delta=0 AND used_delta=0 AND reason IS NOT NULL))
);
CREATE UNIQUE INDEX ihr_one_annual_grant ON public.ihr_leave_ledger(account_id) WHERE kind='annual_grant';
CREATE UNIQUE INDEX ihr_one_opening ON public.ihr_leave_ledger(account_id) WHERE kind='opening';
CREATE INDEX ihr_leave_history_page ON public.ihr_leave_ledger(account_id,sequence DESC);
ALTER TABLE public.ihr_leave_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ihr_leave_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ihr_leave_accounts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ihr_leave_ledger FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.ihr_leave_ledger_sequence_seq FROM PUBLIC,anon,authenticated;

-- Trusted time argument is supplied only by private callers or deterministic OWNER tests.
-- Member.timezone is a snapshot, never the authority for a period boundary.
CREATE FUNCTION private.ihr_leave_annual_eligibility(p_employee uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ihr_leave_members%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;c public.ihr_leave_calendars%ROWTYPE;
 zone text;today date;yr integer;starts date;ends date;
BEGIN
 SELECT * INTO m FROM public.ihr_leave_members WHERE user_id=p_employee;
 IF p_at IS NULL OR m.user_id IS NULL OR NOT m.active OR m.member_kind NOT IN('employee','manager') OR
  NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_employee AND is_active) THEN
  RAISE EXCEPTION 'Annual account unavailable' USING ERRCODE='55000',DETAIL='{"code":"ANNUAL_MEMBER_INELIGIBLE"}';
 END IF;
 zone:=private.ihr_leave_calendar_timezone(m.active_calendar_id);
 IF zone IS NULL THEN RAISE EXCEPTION 'Calendar timezone unconfirmed' USING ERRCODE='55000',DETAIL='{"code":"TIMEZONE_UNCONFIRMED"}'; END IF;
 today:=(p_at AT TIME ZONE zone)::date;yr:=extract(year FROM today)::integer;starts:=make_date(yr,1,1);ends:=make_date(yr+1,1,1);
 SELECT * INTO c FROM public.ihr_leave_calendars WHERE calendar_id=m.active_calendar_id AND effective_from<=today AND (effective_until IS NULL OR effective_until>today) ORDER BY version DESC LIMIT 1;
 IF c.id IS NULL OR c.timezone IS NULL OR c.timezone<>zone THEN RAISE EXCEPTION 'Applicable calendar unconfirmed' USING ERRCODE='55000',DETAIL='{"code":"TIMEZONE_UNCONFIRMED"}'; END IF;
 IF m.cycle_state<>'established_calendar' OR m.eligibility_date IS NULL OR m.employment_start IS NULL OR m.eligibility_date>starts THEN
  RAISE EXCEPTION 'First grant requires explicit policy' USING ERRCODE='55000',DETAIL='{"code":"FIRST_GRANT_BLOCKED"}';
 END IF;
 SELECT * INTO p FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
 IF NOT m.annual_policy_confirmed OR p.id IS NULL OR NOT p.annual_policy_confirmed OR p.annual_allowance_minutes<>5400
  OR p.effective_from>starts OR (p.effective_until IS NOT NULL AND p.effective_until<=today) THEN
  RAISE EXCEPTION 'Annual policy unconfirmed' USING ERRCODE='55000',DETAIL='{"code":"ANNUAL_POLICY_UNCONFIRMED"}';
 END IF;
 RETURN jsonb_build_object('year',yr,'startDate',starts,'endDate',ends,'timezone',zone,'policyId',p.id);
END;
$$;
CREATE FUNCTION private.ihr_leave_account_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_members m JOIN public.users u ON u.id=m.user_id AND u.is_active WHERE m.user_id=NEW.employee_id AND m.active AND m.member_kind IN('employee','manager')) THEN
   RAISE EXCEPTION 'Account member unavailable' USING ERRCODE='55000',DETAIL='{"code":"ANNUAL_MEMBER_INELIGIBLE"}'; END IF;
 ELSIF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.employee_id,NEW.leave_type,NEW.year,NEW.period_start,NEW.period_end,NEW.policy_id,NEW.timezone,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.employee_id,OLD.leave_type,OLD.year,OLD.period_start,OLD.period_end,OLD.policy_id,OLD.timezone,OLD.created_at)
   OR (OLD.opening_reconciled AND ROW(NEW.opening_reconciled,NEW.opening_as_of,NEW.opening_source_id) IS DISTINCT FROM ROW(OLD.opening_reconciled,OLD.opening_as_of,OLD.opening_source_id)) THEN
   RAISE EXCEPTION 'Original account period is immutable' USING ERRCODE='42501',DETAIL='{"code":"ACCOUNT_IMMUTABLE"}'; END IF;
  NEW.version:=OLD.version+1;
 ELSE RAISE EXCEPTION 'Account history is immutable' USING ERRCODE='42501',DETAIL='{"code":"ACCOUNT_IMMUTABLE"}'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_account_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ihr_leave_accounts FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_account_guard();
CREATE TRIGGER ihr_account_no_truncate BEFORE TRUNCATE ON public.ihr_leave_accounts FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE FUNCTION private.ihr_leave_apply_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.ihr_leave_accounts%ROWTYPE;allowance bigint;used bigint;reserved bigint;
BEGIN
 SELECT * INTO STRICT a FROM public.ihr_leave_accounts WHERE id=NEW.account_id FOR UPDATE;
 IF NEW.effective_date<a.period_start OR NEW.effective_date>=a.period_end THEN RAISE EXCEPTION 'Original period required' USING ERRCODE='22023',DETAIL='{"code":"ORIGINAL_PERIOD_REQUIRED"}'; END IF;
 IF NEW.kind='annual_grant' AND (NEW.effective_date<>a.period_start OR NOT EXISTS(SELECT 1 FROM public.ihr_leave_members WHERE user_id=a.employee_id AND active AND member_kind IN('employee','manager'))) THEN
  RAISE EXCEPTION 'Annual grant denied' USING ERRCODE='55000',DETAIL='{"code":"ANNUAL_MEMBER_INELIGIBLE"}'; END IF;
 allowance:=a.allowance_minutes::bigint+NEW.allowance_delta;used:=a.used_minutes::bigint+NEW.used_delta;reserved:=a.reserved_minutes::bigint+NEW.reserved_delta;
 IF allowance<0 OR used<0 OR reserved<0 OR allowance<used+reserved OR greatest(allowance,used,reserved)>2147483647 THEN
  RAISE EXCEPTION 'Account would be underfunded' USING ERRCODE='55000',DETAIL='{"code":"INSUFFICIENT_ALLOWANCE"}'; END IF;
 UPDATE public.ihr_leave_accounts SET allowance_minutes=allowance,reserved_minutes=reserved,used_minutes=used WHERE id=a.id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ihr_ledger_apply BEFORE INSERT ON public.ihr_leave_ledger FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_apply_ledger();
CREATE TRIGGER ihr_ledger_immutable BEFORE UPDATE OR DELETE ON public.ihr_leave_ledger FOR EACH ROW EXECUTE FUNCTION private.ihr_leave_immutable_audit();
CREATE TRIGGER ihr_ledger_no_truncate BEFORE TRUNCATE ON public.ihr_leave_ledger FOR EACH STATEMENT EXECUTE FUNCTION private.ihr_leave_immutable_audit();

-- All callers take setup/assignment/scope/occupancy (if applicable), then this account advisory lock.
-- Do not use ON CONFLICT on ledger INSERT: BEFORE triggers must never apply a skipped event.
CREATE FUNCTION private.ihr_leave_prepare_account(p_employee uuid,p_at timestamptz) RETURNS public.ihr_leave_accounts
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE e jsonb;a public.ihr_leave_accounts%ROWTYPE;
BEGIN
 e:=private.ihr_leave_annual_eligibility(p_employee,p_at);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-account:'||p_employee::text||':'||(e->>'year'),0));
 SELECT * INTO a FROM public.ihr_leave_accounts WHERE employee_id=p_employee AND leave_type='annual' AND year=(e->>'year')::integer FOR UPDATE;
 IF a.id IS NOT NULL THEN RETURN a; END IF;
 INSERT INTO public.ihr_leave_accounts(employee_id,year,period_start,period_end,policy_id,timezone)
 VALUES(p_employee,(e->>'year')::integer,(e->>'startDate')::date,(e->>'endDate')::date,(e->>'policyId')::uuid,e->>'timezone') RETURNING * INTO a;
 INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,allowance_delta,source_kind,source_id,source_event)
 VALUES(a.id,a.period_start,'annual_grant',5400,'annual_account',a.id,'grant');
 SELECT * INTO a FROM public.ihr_leave_accounts WHERE id=a.id;RETURN a;
END;
$$;
CREATE FUNCTION public.leave_prepare_self_v1() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();at_time timestamptz;e jsonb;a public.ihr_leave_accounts%ROWTYPE;
BEGIN
 PERFORM private.ihr_leave_require_command_isolation();
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||actor::text,0));
 PERFORM version FROM private.ihr_leave_scope_revision WHERE singleton FOR UPDATE;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 e:=private.ihr_leave_annual_eligibility(actor,at_time);
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-account:'||actor::text||':'||(e->>'year'),0));
 PERFORM id FROM public.ihr_leave_accounts WHERE employee_id=actor AND year=(e->>'year')::integer FOR UPDATE;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 a:=private.ihr_leave_prepare_account(actor,at_time);
 RETURN jsonb_build_object('accountId',a.id,'year',a.year,'version',a.version);
END;
$$;
CREATE FUNCTION private.ihr_leave_balance_json(a public.ihr_leave_accounts,p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('accountId',a.id,'year',a.year,'allowanceMinutes',a.allowance_minutes,'reconciled',a.opening_reconciled,
 'approvedMinutes',CASE WHEN a.opening_reconciled THEN a.used_minutes END,'pendingMinutes',CASE WHEN a.opening_reconciled THEN a.reserved_minutes END,
 'availableMinutes',CASE WHEN a.opening_reconciled THEN CASE WHEN (p_at AT TIME ZONE a.timezone)::date>=a.period_end THEN 0 ELSE a.allowance_minutes-a.used_minutes-a.reserved_minutes END END,
 'expiredMinutes',CASE WHEN a.opening_reconciled THEN CASE WHEN (p_at AT TIME ZONE a.timezone)::date>=a.period_end THEN a.allowance_minutes-a.used_minutes-a.reserved_minutes ELSE 0 END END,'version',a.version);
$$;
-- Preserve the current calendar shell; only this migration adds the personal period and balances.
ALTER FUNCTION public.leave_context_v1() RENAME TO ihr_leave_calendar_context_v1;
ALTER FUNCTION public.ihr_leave_calendar_context_v1() SET SCHEMA private;
REVOKE ALL ON FUNCTION private.ihr_leave_calendar_context_v1() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.leave_context_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();v jsonb;period jsonb;balances jsonb:='[]';e jsonb;current_verified boolean:=false;
BEGIN
 v:=private.ihr_leave_calendar_context_v1();
 IF v->'capabilities'->>'request'='true' THEN
  BEGIN
   e:=private.ihr_leave_annual_eligibility(actor,statement_timestamp());
   period:=jsonb_build_object('year',(e->>'year')::integer,'startDate',e->>'startDate','endDate',e->>'endDate');
  EXCEPTION WHEN SQLSTATE '55000' THEN period:=NULL; END;
  SELECT coalesce(jsonb_agg(private.ihr_leave_balance_json(a,statement_timestamp()) ORDER BY a.year DESC),'[]') INTO balances FROM public.ihr_leave_accounts a WHERE a.employee_id=actor;
  SELECT coalesce(bool_or(a.opening_reconciled),false) INTO current_verified FROM public.ihr_leave_accounts a WHERE a.employee_id=actor AND a.year=(period->>'year')::integer;
  -- Member-level legacy flag cannot verify this year's opening account.
  v:=jsonb_set(v,'{setup,blockers}',coalesce((SELECT jsonb_agg(b) FROM jsonb_array_elements(v->'setup'->'blockers') b WHERE b->>'code'<>'opening_unreconciled'),'[]'));
  IF NOT current_verified THEN v:=jsonb_set(v,'{setup,blockers}',v->'setup'->'blockers'||jsonb_build_array(jsonb_build_object('code','opening_unreconciled','message','Saldo awal belum direkonsiliasi.','field','openingReconciled'))); END IF;
 END IF;
 RETURN v||jsonb_build_object('currentPeriod',period,'balances',balances);
END;
$$;
CREATE FUNCTION public.leave_balance_history_v1(p_account_id uuid,p_before bigint DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();a public.ihr_leave_accounts%ROWTYPE;rows jsonb;next_before bigint;
BEGIN
 SELECT * INTO a FROM public.ihr_leave_accounts WHERE id=p_account_id;
 IF a.id IS NULL OR NOT ((a.employee_id=actor AND EXISTS(SELECT 1 FROM public.ihr_leave_members m WHERE m.user_id=actor AND m.active AND m.member_kind IN('employee','manager')))
  OR private.ihr_leave_has_grant(actor,'read_private',a.employee_id)) THEN
  RAISE EXCEPTION 'Balance access denied' USING ERRCODE='42501',DETAIL='{"code":"BALANCE_ACCESS_DENIED"}'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR (p_before IS NOT NULL AND p_before<1) THEN RAISE EXCEPTION 'Invalid history page' USING ERRCODE='22023',DETAIL='{"code":"INVALID_HISTORY_PAGE"}'; END IF;
 SELECT coalesce(jsonb_agg(r.entry ORDER BY r.sequence DESC),'[]'),min(r.sequence) INTO rows,next_before FROM (
  SELECT l.sequence,jsonb_build_object('id',l.id,'sequence',l.sequence,'date',l.effective_date,'kind',l.kind,
   'allowanceDelta',l.allowance_delta,'reservedDelta',l.reserved_delta,'usedDelta',l.used_delta) entry
  FROM public.ihr_leave_ledger l WHERE l.account_id=a.id AND (p_before IS NULL OR l.sequence<p_before) ORDER BY l.sequence DESC LIMIT p_limit
 ) r;
 IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_ledger l WHERE l.account_id=a.id AND l.sequence<next_before) THEN next_before:=NULL; END IF;
 RETURN jsonb_build_object('balance',private.ihr_leave_balance_json(a,statement_timestamp()),'rows',rows,'nextBefore',next_before);
END;
$$;
-- Explicit private HR read only: configure, adjustment and approval do not imply this audience.
CREATE FUNCTION public.leave_balance_accounts_v1(p_employee_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();rows jsonb;e jsonb;period jsonb;
BEGIN
 IF NOT private.ihr_leave_has_grant(actor,'read_private',p_employee_id) THEN RAISE EXCEPTION 'Balance access denied' USING ERRCODE='42501',DETAIL='{"code":"BALANCE_ACCESS_DENIED"}'; END IF;
 BEGIN e:=private.ihr_leave_annual_eligibility(p_employee_id,statement_timestamp());period:=jsonb_build_object('year',(e->>'year')::integer,'startDate',e->>'startDate','endDate',e->>'endDate');
 EXCEPTION WHEN SQLSTATE '55000' THEN period:=NULL; END;
 SELECT coalesce(jsonb_agg(private.ihr_leave_balance_json(a,statement_timestamp()) ORDER BY a.year DESC),'[]') INTO rows FROM public.ihr_leave_accounts a WHERE a.employee_id=p_employee_id;
 RETURN jsonb_build_object('currentPeriod',period,'balances',rows);
END;
$$;

-- Task6 replaces this private seam only after requests/day occupancy can be imported immutably.
-- Caller holds the employee occupancy lock before any account lock. No exception is swallowed.
CREATE FUNCTION private.ihr_import_opening_absences_v1(p_employee uuid,p_account uuid,p_source uuid,p_as_of date,p_lines jsonb,p_actor uuid,p_at timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)>0 THEN
  RAISE EXCEPTION 'Opening request import unavailable' USING ERRCODE='55000',DETAIL='{"code":"OPENING_REQUEST_IMPORT_UNAVAILABLE"}'; END IF;
END;
$$;
-- Retain stable calendar commands and extend only these two exact account operations.
ALTER FUNCTION private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_authorize_calendar_command;
CREATE FUNCTION private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE keys text[];target uuid;field text;line jsonb;
BEGIN
 IF p_operation NOT IN('reconcile_opening','adjust_balance') THEN PERFORM private.ihr_leave_authorize_calendar_command(p_actor,p_operation,p_payload,p_authorized_at);RETURN; END IF;
 IF p_authorized_at IS NULL OR p_actor IS DISTINCT FROM private.ihr_leave_require_actor() THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501'; END IF;
 keys:=CASE p_operation WHEN 'reconcile_opening' THEN ARRAY['employee_id','year','allowance_minutes','past_used_minutes','future_approved','as_of','source_id','expected_version','reason'] ELSE ARRAY['employee_id','year','delta_minutes','source_id','expected_version','reason'] END;
 PERFORM private.ihr_leave_validate_payload(p_payload,keys,keys);
 target:=(p_payload->>'employee_id')::uuid;
 IF target IS NULL OR target=p_actor OR NOT private.ihr_leave_has_grant(p_actor,CASE p_operation WHEN 'reconcile_opening' THEN 'configure' ELSE 'adjust' END,target,p_authorized_at) THEN
  RAISE EXCEPTION 'Independent scoped account administrator required' USING ERRCODE='42501',DETAIL='{"code":"BALANCE_COMMAND_DENIED"}'; END IF;
 IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 1000 OR (p_payload->>'source_id')::uuid IS NULL THEN RAISE EXCEPTION 'Invalid account source' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY (CASE p_operation WHEN 'reconcile_opening' THEN ARRAY['year','allowance_minutes','past_used_minutes','expected_version'] ELSE ARRAY['year','expected_version'] END) LOOP
  IF jsonb_typeof(p_payload->field) IS DISTINCT FROM 'number' OR p_payload->>field !~ '^[0-9]+$' OR (p_payload->>field)::bigint>2147483647 THEN RAISE EXCEPTION 'Exact integer required' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_operation='adjust_balance' THEN
  IF jsonb_typeof(p_payload->'delta_minutes') IS DISTINCT FROM 'number' OR p_payload->>'delta_minutes' !~ '^-?[0-9]+$' OR (p_payload->>'delta_minutes')::integer=0 THEN RAISE EXCEPTION 'Signed exact adjustment required' USING ERRCODE='22023'; END IF;
 ELSE
  IF jsonb_typeof(p_payload->'as_of') IS DISTINCT FROM 'string' OR p_payload->>'as_of' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR jsonb_typeof(p_payload->'future_approved') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'future_approved')>100 THEN RAISE EXCEPTION 'Invalid opening' USING ERRCODE='22023'; END IF;
  PERFORM (p_payload->>'as_of')::date;
  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'future_approved') LOOP
   PERFORM private.ihr_leave_validate_payload(line,ARRAY['source_id','start_date','end_date','duration','total_minutes'],ARRAY['source_id','start_date','end_date','duration','total_minutes']);
   IF (line->>'source_id')::uuid IS NULL OR jsonb_typeof(line->'total_minutes') IS DISTINCT FROM 'number' OR line->>'total_minutes' !~ '^[0-9]+$' OR (line->>'total_minutes')::integer<1
    OR jsonb_typeof(line->'start_date') IS DISTINCT FROM 'string' OR line->>'start_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR jsonb_typeof(line->'end_date') IS DISTINCT FROM 'string' OR line->>'end_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR (line->>'start_date')::date<=(p_payload->>'as_of')::date OR (line->>'end_date')::date<(line->>'start_date')::date
    OR extract(year FROM (line->>'end_date')::date)<>(p_payload->>'year')::integer THEN RAISE EXCEPTION 'Invalid opening line' USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(line->'duration') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid opening duration' USING ERRCODE='22023'; END IF;
   IF (line->'duration'=jsonb_build_object('mode','full_scheduled_day') OR (line->'duration'->>'mode'='fixed_minutes' AND line->'duration'->'minutes' IN('60'::jsonb,'120'::jsonb,'180'::jsonb,'225'::jsonb,'240'::jsonb,'300'::jsonb,'360'::jsonb) AND (SELECT count(*) FROM jsonb_object_keys(line->'duration'))=2)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid opening duration' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'future_approved'))<>(SELECT count(DISTINCT l->>'source_id') FROM jsonb_array_elements(p_payload->'future_approved') l) THEN RAISE EXCEPTION 'Duplicate opening source' USING ERRCODE='22023'; END IF;
 END IF;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Invalid account payload' USING ERRCODE='22023',DETAIL='{"code":"INVALID_PAYLOAD"}';
END;
$$;
CREATE FUNCTION private.ihr_leave_reconcile_opening(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE target uuid:=(p->>'employee_id')::uuid;a public.ihr_leave_accounts%ROWTYPE;prior_version bigint;total bigint;as_of date:=(p->>'as_of')::date;e jsonb;
BEGIN
 e:=private.ihr_leave_annual_eligibility(target,p_at);
 IF (p->>'year')::integer<>(e->>'year')::integer OR as_of<(e->>'startDate')::date OR as_of>(p_at AT TIME ZONE (e->>'timezone'))::date THEN RAISE EXCEPTION 'Current opening period required' USING ERRCODE='22023',DETAIL='{"code":"CURRENT_PERIOD_REQUIRED"}'; END IF;
 SELECT version INTO prior_version FROM public.ihr_leave_accounts WHERE employee_id=target AND year=(p->>'year')::integer;
 IF coalesce(prior_version,0)<>(p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale account' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}'; END IF;
 a:=private.ihr_leave_prepare_account(target,p_at);
 IF a.opening_reconciled OR EXISTS(SELECT 1 FROM public.ihr_leave_ledger WHERE account_id=a.id AND kind<>'annual_grant') THEN RAISE EXCEPTION 'Opening already committed' USING ERRCODE='55000',DETAIL='{"code":"OPENING_ALREADY_COMMITTED"}'; END IF;
 IF (p->>'allowance_minutes')::integer<>a.allowance_minutes OR a.allowance_minutes<>5400 THEN RAISE EXCEPTION 'Opening allowance must match independently prepared grant' USING ERRCODE='22023',DETAIL='{"code":"OPENING_ALLOWANCE_MISMATCH"}'; END IF;
 SELECT (p->>'past_used_minutes')::bigint+coalesce(sum((l->>'total_minutes')::bigint),0) INTO total FROM jsonb_array_elements(p->'future_approved') l;
 IF total>a.allowance_minutes THEN RAISE EXCEPTION 'Opening underfunded' USING ERRCODE='55000',DETAIL='{"code":"INSUFFICIENT_ALLOWANCE"}'; END IF;
 PERFORM private.ihr_import_opening_absences_v1(target,a.id,(p->>'source_id')::uuid,as_of,p->'future_approved',p_actor,p_at);
 INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,used_delta,source_kind,source_id,source_event,actor_id,reason)
 VALUES(a.id,as_of,'opening',total,'opening',(p->>'source_id')::uuid,'verified',p_actor,p->>'reason');
 UPDATE public.ihr_leave_accounts SET opening_reconciled=true,opening_as_of=as_of,opening_source_id=(p->>'source_id')::uuid WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,target_user_id,after_data,reason) VALUES(p_actor,'reconcile_opening',target,p,p->>'reason');
 RETURN jsonb_build_object('id',a.id,'version',a.version,'operation','reconcile_opening');
END;
$$;
CREATE FUNCTION private.ihr_leave_adjust_balance(p_actor uuid,p jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE a public.ihr_leave_accounts%ROWTYPE;target uuid:=(p->>'employee_id')::uuid;e jsonb;
BEGIN
 e:=private.ihr_leave_annual_eligibility(target,p_at);
 IF (p->>'year')::integer<>(e->>'year')::integer THEN RAISE EXCEPTION 'Current adjustment period required' USING ERRCODE='22023',DETAIL='{"code":"CURRENT_PERIOD_REQUIRED"}'; END IF;
 SELECT * INTO a FROM public.ihr_leave_accounts WHERE employee_id=target AND year=(p->>'year')::integer FOR UPDATE;
 IF a.id IS NULL OR NOT a.opening_reconciled THEN RAISE EXCEPTION 'Opening verification required' USING ERRCODE='55000',DETAIL='{"code":"OPENING_UNRECONCILED"}'; END IF;
 IF a.version<>(p->>'expected_version')::bigint THEN RAISE EXCEPTION 'Stale account' USING ERRCODE='55000',DETAIL='{"code":"STALE_VERSION"}'; END IF;
 INSERT INTO public.ihr_leave_ledger(account_id,effective_date,kind,allowance_delta,source_kind,source_id,source_event,actor_id,reason)
 VALUES(a.id,(p_at AT TIME ZONE a.timezone)::date,'adjustment',(p->>'delta_minutes')::integer,'adjustment',(p->>'source_id')::uuid,'allowance',p_actor,p->>'reason');
 SELECT * INTO a FROM public.ihr_leave_accounts WHERE id=a.id;
 INSERT INTO public.ihr_leave_admin_events(actor_id,operation,target_user_id,after_data,reason) VALUES(p_actor,'adjust_balance',target,p,p->>'reason');
 RETURN jsonb_build_object('id',a.id,'version',a.version,'operation','adjust_balance');
END;
$$;
ALTER FUNCTION private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz) RENAME TO ihr_leave_dispatch_calendar_command;
CREATE FUNCTION private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor uuid;at_time timestamptz;target uuid;
BEGIN
 IF p_operation NOT IN('reconcile_opening','adjust_balance') THEN RETURN private.ihr_leave_dispatch_calendar_command(p_actor,p_operation,p_payload,p_authorized_at); END IF;
 target:=(p_payload->>'employee_id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-setup',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-approver:'||target::text,0));
 PERFORM version FROM private.ihr_leave_scope_revision WHERE singleton FOR UPDATE;
 -- Employee-scoped occupancy locks precede accounts; Task6 shares this exact namespace.
 IF p_operation='reconcile_opening' THEN PERFORM pg_advisory_xact_lock(hashtextextended('ihr-occupancy:'||target::text,0)); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ihr-account:'||target::text||':'||(p_payload->>'year'),0));
 PERFORM id FROM public.ihr_leave_accounts WHERE employee_id=target AND year=(p_payload->>'year')::integer FOR UPDATE;
 SELECT private.ihr_leave_require_actor(),clock_timestamp() INTO actor,at_time;
 IF actor IS DISTINCT FROM p_actor OR p_authorized_at IS NULL THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='42501'; END IF;
 PERFORM private.ihr_leave_authorize_command(actor,p_operation,p_payload,at_time);
 CASE p_operation
 WHEN 'reconcile_opening' THEN RETURN private.ihr_leave_reconcile_opening(actor,p_payload,at_time);
 WHEN 'adjust_balance' THEN RETURN private.ihr_leave_adjust_balance(actor,p_payload,at_time);
 END CASE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow OR unique_violation THEN
 RAISE EXCEPTION 'Invalid or duplicate account input' USING ERRCODE='22023',DETAIL='{"code":"INVALID_ACCOUNT_INPUT"}';
END;
$$;
REVOKE ALL ON FUNCTION private.ihr_leave_annual_eligibility(uuid,timestamptz),private.ihr_leave_account_guard(),private.ihr_leave_apply_ledger(),private.ihr_leave_prepare_account(uuid,timestamptz),private.ihr_leave_balance_json(public.ihr_leave_accounts,timestamptz),private.ihr_import_opening_absences_v1(uuid,uuid,uuid,date,jsonb,uuid,timestamptz),private.ihr_leave_authorize_command(uuid,text,jsonb,timestamptz),private.ihr_leave_reconcile_opening(uuid,jsonb,timestamptz),private.ihr_leave_adjust_balance(uuid,jsonb,timestamptz),private.ihr_leave_dispatch_command(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leave_prepare_self_v1(),public.leave_context_v1(),public.leave_balance_history_v1(uuid,bigint,integer),public.leave_balance_accounts_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_prepare_self_v1(),public.leave_context_v1(),public.leave_balance_history_v1(uuid,bigint,integer),public.leave_balance_accounts_v1(uuid) TO authenticated;
COMMIT;
