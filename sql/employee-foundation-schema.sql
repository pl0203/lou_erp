-- UNPUBLISHED CANDIDATE. No hosted execution, live activation, data import or role grants.
-- DO NOT RUN DIRECTLY. Transaction-neutral source for fixed disposable test wrappers.
-- A future atomic activation bundle requires separate review and authorization.
-- Employee identity is separate from users, leave membership, access and reporting routing.
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE SCHEMA IF NOT EXISTS private;

CREATE FUNCTION private.employee_timezone_valid(p_zone text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT p_zone IS NULL OR (p_zone=btrim(p_zone) AND (p_zone='UTC' OR position('/' IN p_zone)>0)
  AND p_zone NOT LIKE 'posix/%' AND p_zone NOT LIKE 'right/%'
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_zone));
$$;
CREATE TABLE private.employee_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 timezone text CHECK(private.employee_timezone_valid(timezone)),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991)
);
INSERT INTO private.employee_settings(singleton) VALUES(true);
CREATE TABLE private.employee_reporting_guard (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991)
);
INSERT INTO private.employee_reporting_guard(singleton) VALUES(true);
CREATE TABLE private.employee_records (
 id uuid PRIMARY KEY,
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 name text NOT NULL CHECK(name=btrim(name) AND char_length(name) BETWEEN 1 AND 160),
 employee_number text CHECK(employee_number=btrim(employee_number) AND char_length(employee_number) BETWEEN 1 AND 64),
 job_title text CHECK(job_title=btrim(job_title) AND char_length(job_title) BETWEEN 1 AND 120),
 team text CHECK(team=btrim(team) AND char_length(team) BETWEEN 1 AND 120),
 recorded_status text NOT NULL DEFAULT 'draft' CHECK(recorded_status IN('draft','active','ended')),
 reporting_revision bigint NOT NULL DEFAULT 0 CHECK(reporting_revision BETWEEN 0 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX employee_records_name_id ON private.employee_records(name COLLATE "C",id);
CREATE UNIQUE INDEX employee_records_current_number ON private.employee_records(lower(employee_number)) WHERE employee_number IS NOT NULL;
CREATE TABLE private.employee_number_claims (
 normalized_number text PRIMARY KEY CHECK(normalized_number=lower(btrim(normalized_number)) AND char_length(normalized_number) BETWEEN 1 AND 64),
 employee_id uuid NOT NULL REFERENCES private.employee_records(id) ON DELETE RESTRICT,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX employee_number_claims_employee ON private.employee_number_claims(employee_id);
CREATE TABLE private.employee_account_links (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
 employee_id uuid UNIQUE NOT NULL REFERENCES private.employee_records(id) ON DELETE RESTRICT,
 quarantined boolean NOT NULL DEFAULT false,
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 quarantined_at timestamptz
);
CREATE TABLE private.employee_episodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid UNIQUE NOT NULL REFERENCES private.employee_records(id) ON DELETE RESTRICT,
 episode_number integer NOT NULL DEFAULT 1 CHECK(episode_number=1),
 start_date date CHECK(start_date IS NULL OR (isfinite(start_date) AND start_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date)),
 end_date date CHECK(end_date IS NULL OR (isfinite(end_date) AND end_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date)),
 source_reference text CHECK(source_reference=btrim(source_reference) AND char_length(source_reference) BETWEEN 1 AND 500),
 CHECK(start_date IS NULL OR end_date IS NULL OR end_date>=start_date)
);
CREATE TABLE private.employee_reporting_revisions (
 employee_id uuid NOT NULL REFERENCES private.employee_records(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 mode text NOT NULL CHECK(mode IN('schedule','correction')),
 actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source_reference text CHECK(source_reference=btrim(source_reference) AND char_length(source_reference) BETWEEN 1 AND 500),
 PRIMARY KEY(employee_id,revision)
);
CREATE TABLE private.employee_reporting_intervals (
 employee_id uuid NOT NULL,
 revision bigint NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 manager_employee_id uuid REFERENCES private.employee_records(id) ON DELETE RESTRICT,
 from_date date NOT NULL CHECK(isfinite(from_date) AND from_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date),
 until_date date CHECK(until_date IS NULL OR (isfinite(until_date) AND until_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date)),
 PRIMARY KEY(employee_id,revision,ordinal),
 FOREIGN KEY(employee_id,revision) REFERENCES private.employee_reporting_revisions(employee_id,revision) ON DELETE RESTRICT,
 CHECK(manager_employee_id IS NULL OR manager_employee_id<>employee_id),
 CHECK(until_date IS NULL OR until_date>from_date)
);
CREATE INDEX employee_reporting_intervals_manager ON private.employee_reporting_intervals(manager_employee_id,from_date,until_date);
CREATE TABLE private.employee_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES private.employee_records(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 effective_date date CHECK(effective_date IS NULL OR (isfinite(effective_date) AND effective_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date)),
 action text NOT NULL CHECK(action IN('create_employee','edit_employee','save_initial_episode','link_account','quarantine_account_link','save_reporting')),
 reason text NOT NULL CHECK(reason=btrim(reason) AND char_length(reason) BETWEEN 1 AND 500),
 source_reference text CHECK(source_reference=btrim(source_reference) AND char_length(source_reference) BETWEEN 1 AND 500),
 before_data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(before_data)='object'),
 after_data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(after_data)='object')
);
CREATE INDEX employee_audit_employee_time ON private.employee_audit_events(employee_id,recorded_at DESC,id DESC);
-- A tombstone may precede employee creation. No FK is appropriate for its target UUID.
-- A pending command is never committed: atomic command + audit + result or no change.
CREATE TABLE private.employee_operations (
 actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 operation_id uuid NOT NULL,
 employee_id uuid,
 action text,
 expected_version bigint CHECK(expected_version BETWEEN 0 AND 9007199254740991),
 request_fingerprint text,
 state text NOT NULL CHECK(state IN('completed','abandoned')),
 result jsonb CHECK(result IS NULL OR jsonb_typeof(result)='object'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,operation_id),
 CHECK((state='completed' AND result IS NOT NULL AND request_fingerprint IS NOT NULL) OR (state='abandoned' AND result IS NULL))
);

-- No client table access, even when service_role can bypass row policies.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['employee_records','employee_number_claims','employee_account_links','employee_episodes',
  'employee_reporting_revisions','employee_reporting_intervals','employee_audit_events','employee_operations','employee_settings','employee_reporting_guard'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated, service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION private.employee_require_director() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND is_active AND role='executive') THEN
  RAISE EXCEPTION 'Employee Director authority required' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END;
$$;
CREATE FUNCTION private.employee_read_guard(p_query text,p_page integer,p_page_size integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
  OR p_query IS NULL OR char_length(btrim(p_query))>120 THEN
  RAISE EXCEPTION 'Invalid employee page input' USING ERRCODE='22023';
 END IF;
 RETURN btrim(p_query);
END;
$$;
CREATE FUNCTION private.employee_fields(p_row private.employee_records) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('name',p_row.name,'employeeNumber',p_row.employee_number,'jobTitle',p_row.job_title,
  'team',p_row.team,'recordedStatus',p_row.recorded_status);
$$;
-- Defense in depth: never return arbitrary stored JSON, including nested extras.
CREATE FUNCTION private.employee_audit_projection(p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb:='{}'; section text; keys text[]; projected jsonb;
BEGIN
 FOREACH section IN ARRAY ARRAY['fields','episode','account'] LOOP
  keys:=CASE section WHEN 'fields' THEN ARRAY['name','employeeNumber','jobTitle','team','recordedStatus']
   WHEN 'episode' THEN ARRAY['startDate','endDate','sourceReference'] ELSE ARRAY['userId'] END;
  IF jsonb_typeof(p_data->section)='object' THEN
   SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO projected FROM jsonb_each(p_data->section) WHERE key=ANY(keys)
    AND jsonb_typeof(value) IN('string','null');
   result:=result||jsonb_build_object(section,projected);
  END IF;
 END LOOP;
 IF jsonb_typeof(p_data->'reporting')='array' THEN
  SELECT coalesce(jsonb_agg((SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(item)
   WHERE key IN('managerEmployeeId','from','until') AND jsonb_typeof(value) IN('string','null')) ORDER BY ordinal),'[]')
  INTO projected FROM jsonb_array_elements(p_data->'reporting') WITH ORDINALITY AS items(item,ordinal) WHERE jsonb_typeof(item)='object';
  result:=result||jsonb_build_object('reporting',projected);
 END IF;
 RETURN result;
END;
$$;
CREATE FUNCTION private.employee_context_impl_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=auth.uid(); allowed boolean; zone text; config_version bigint; profile_stamp text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 SELECT u.is_active AND u.role='executive',u.role::text||':'||u.is_active::text||':'||u.xmin::text
 INTO allowed,profile_stamp FROM public.users u WHERE id=actor;
 SELECT s.timezone,s.version INTO zone,config_version FROM private.employee_settings s WHERE singleton;
 RETURN jsonb_build_object('actorId',actor,'scopeVersion',md5(actor::text||':'||coalesce(profile_stamp,'missing')||':'||config_version::text||':'||coalesce(zone,'')),
  'canMaintainBasic',coalesce(allowed,false),'timezone',CASE WHEN allowed THEN zone END,
  'today',CASE WHEN allowed AND zone IS NOT NULL THEN to_char(statement_timestamp() AT TIME ZONE zone,'YYYY-MM-DD') END,
  'setupBlockers',CASE WHEN allowed AND zone IS NULL THEN '["WORKPLACE_TIMEZONE_UNCONFIRMED"]'::jsonb ELSE '[]'::jsonb END);
END;
$$;
CREATE FUNCTION private.employee_page_impl_v1(p_query text,p_status text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q text; result_rows jsonb; row_total bigint;
BEGIN
 PERFORM private.employee_require_director();
 q:=private.employee_read_guard(p_query,p_page,p_page_size);
 IF p_status IS NOT NULL AND p_status NOT IN('draft','active','ended') THEN RAISE EXCEPTION 'Invalid employee status' USING ERRCODE='22023'; END IF;
 WITH matches AS MATERIALIZED (SELECT e.* FROM private.employee_records e WHERE (p_status IS NULL OR e.recorded_status=p_status)
  AND (q='' OR strpos(lower(e.name),lower(q))>0 OR strpos(lower(coalesce(e.employee_number,'')),lower(q))>0)),
 page_rows AS (SELECT * FROM matches ORDER BY name COLLATE "C",id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT (SELECT count(*) FROM matches),coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.version)||private.employee_fields(r::private.employee_records)
  ORDER BY r.name COLLATE "C",r.id),'[]') INTO row_total,result_rows FROM page_rows r;
 RETURN jsonb_build_object('rows',result_rows,'total',row_total,'page',p_page,'pageSize',p_page_size);
END;
$$;
CREATE FUNCTION private.employee_detail_impl_v1(p_employee_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE employee private.employee_records%ROWTYPE; episode jsonb; account jsonb; reporting jsonb; warnings jsonb:='[]';
 linked private.employee_account_links%ROWTYPE; account_user public.users%ROWTYPE; zone text; today date;
 current_manager uuid; manager_user uuid; manager_quarantined boolean; has_interval boolean;
BEGIN
 PERFORM private.employee_require_director();
 IF p_employee_id IS NULL THEN RAISE EXCEPTION 'Employee id required' USING ERRCODE='22023'; END IF;
 SELECT * INTO employee FROM private.employee_records WHERE id=p_employee_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 SELECT jsonb_build_object('startDate',start_date,'endDate',end_date,'sourceReference',source_reference) INTO episode
 FROM private.employee_episodes WHERE employee_id=p_employee_id;
 SELECT * INTO linked FROM private.employee_account_links WHERE employee_id=p_employee_id;
 IF FOUND THEN
  SELECT * INTO account_user FROM public.users WHERE id=linked.user_id;
  account:=jsonb_build_object('userId',account_user.id,'displayName',account_user.full_name,'email',account_user.email,
   'role',account_user.role,'active',account_user.is_active,'operationalManagerId',account_user.manager_id,
   'operationalManagerName',(SELECT full_name FROM public.users WHERE id=account_user.manager_id),'quarantined',linked.quarantined);
  IF employee.recorded_status='ended' AND account_user.is_active THEN warnings:=warnings||'"ENDED_EMPLOYMENT_ACTIVE_LOGIN"'::jsonb; END IF;
  IF employee.recorded_status='active' AND NOT account_user.is_active THEN warnings:=warnings||'"ACTIVE_EMPLOYMENT_INACTIVE_LOGIN"'::jsonb; END IF;
  IF linked.quarantined THEN warnings:=warnings||'"ACCOUNT_LINK_QUARANTINED"'::jsonb; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('managerEmployeeId',manager_employee_id,'from',from_date,'until',until_date)
  ORDER BY from_date,ordinal),'[]') INTO reporting FROM private.employee_reporting_intervals
 WHERE employee_id=p_employee_id AND revision=employee.reporting_revision;
 IF account IS NOT NULL THEN
  SELECT timezone INTO zone FROM private.employee_settings WHERE singleton;
  IF zone IS NULL THEN warnings:=warnings||'"REPORTING_COMPARISON_UNAVAILABLE"'::jsonb;
  ELSE
   today:=(statement_timestamp() AT TIME ZONE zone)::date;
   SELECT manager_employee_id,true INTO current_manager,has_interval FROM private.employee_reporting_intervals
   WHERE employee_id=p_employee_id AND revision=employee.reporting_revision AND from_date<=today AND (until_date IS NULL OR today<until_date)
   ORDER BY from_date,ordinal LIMIT 1;
   IF NOT coalesce(has_interval,false) THEN warnings:=warnings||'"REPORTING_COMPARISON_UNAVAILABLE"'::jsonb;
   ELSE
    SELECT user_id,quarantined INTO manager_user,manager_quarantined FROM private.employee_account_links WHERE employee_id=current_manager;
    IF linked.quarantined OR (current_manager IS NOT NULL AND (manager_user IS NULL OR manager_quarantined)) THEN
     warnings:=warnings||'"REPORTING_ACCESS_MANAGER_UNCOMPARABLE"'::jsonb;
    ELSIF manager_user IS DISTINCT FROM account_user.manager_id THEN warnings:=warnings||'"REPORTING_ACCESS_MANAGER_MISMATCH"'::jsonb;
    END IF;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('id',employee.id,'version',employee.version,'fields',private.employee_fields(employee),
  'episode',episode,'account',account,'reportingRevision',employee.reporting_revision,'reporting',reporting,'warnings',warnings);
END;
$$;
CREATE FUNCTION private.employee_audit_impl_v1(p_employee_id uuid,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result_rows jsonb; row_total bigint;
BEGIN
 PERFORM private.employee_require_director(); PERFORM private.employee_read_guard('',p_page,p_page_size);
 IF p_employee_id IS NULL THEN RAISE EXCEPTION 'Employee id required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.employee_records WHERE id=p_employee_id) THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO row_total FROM private.employee_audit_events WHERE employee_id=p_employee_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employeeId',a.employee_id,'actorId',a.actor_id,'actorName',a.actor_name,
  'recordedAt',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'effectiveDate',a.effective_date,
  'action',a.action,'reason',a.reason,'sourceReference',a.source_reference,
  'before',private.employee_audit_projection(a.before_data),'after',private.employee_audit_projection(a.after_data))
  ORDER BY a.recorded_at DESC,a.id DESC),'[]') INTO result_rows FROM
  (SELECT * FROM private.employee_audit_events WHERE employee_id=p_employee_id ORDER BY recorded_at DESC,id DESC
   LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size) a;
 RETURN jsonb_build_object('rows',result_rows,'total',row_total,'page',p_page,'pageSize',p_page_size);
END;
$$;
CREATE FUNCTION private.employee_account_candidates_impl_v1(p_query text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q text; result_rows jsonb; row_total bigint;
BEGIN
 PERFORM private.employee_require_director(); q:=private.employee_read_guard(p_query,p_page,p_page_size);
 WITH matches AS MATERIALIZED (SELECT u.id,u.full_name,u.email,u.role,u.is_active,
   CASE WHEN l.quarantined THEN 'quarantined' WHEN l.user_id IS NOT NULL THEN 'linked' ELSE 'unlinked' END link_state
  FROM public.users u LEFT JOIN private.employee_account_links l ON l.user_id=u.id
  WHERE q='' OR strpos(lower(u.full_name),lower(q))>0 OR strpos(lower(u.email),lower(q))>0),
 page_rows AS (SELECT * FROM matches ORDER BY full_name COLLATE "C",id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
 SELECT (SELECT count(*) FROM matches),coalesce(jsonb_agg(jsonb_build_object('userId',r.id,'displayName',r.full_name,
  'email',r.email,'role',r.role,'active',r.is_active,'linkState',r.link_state) ORDER BY r.full_name COLLATE "C",r.id),'[]')
 INTO row_total,result_rows FROM page_rows r;
 RETURN jsonb_build_object('rows',result_rows,'total',row_total,'page',p_page,'pageSize',p_page_size);
END;
$$;

-- Public invoker wrappers expose only the narrow versioned APIs. Every privileged
-- implementation independently checks current users authority, not editable claims.
CREATE FUNCTION public.employee_context_v1() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$ SELECT private.employee_context_impl_v1(); $$;
CREATE FUNCTION public.employee_page_v1(p_query text,p_status text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$ SELECT private.employee_page_impl_v1(p_query,p_status,p_page,p_page_size); $$;
CREATE FUNCTION public.employee_detail_v1(p_employee_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$ SELECT private.employee_detail_impl_v1(p_employee_id); $$;
CREATE FUNCTION public.employee_audit_v1(p_employee_id uuid,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$ SELECT private.employee_audit_impl_v1(p_employee_id,p_page,p_page_size); $$;
CREATE FUNCTION public.employee_account_candidates_v1(p_query text,p_page integer,p_page_size integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$ SELECT private.employee_account_candidates_impl_v1(p_query,p_page,p_page_size); $$;

-- Close default PUBLIC execution in the creation transaction. Do not alter unrelated
-- schema defaults or privileges of existing leave/calendar functions.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','private') AND p.proname LIKE 'employee\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.signature);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.employee_context_impl_v1(),private.employee_page_impl_v1(text,text,integer,integer),
 private.employee_detail_impl_v1(uuid),private.employee_audit_impl_v1(uuid,integer,integer),private.employee_account_candidates_impl_v1(text,integer,integer),
 public.employee_context_v1(),public.employee_page_v1(text,text,integer,integer),public.employee_detail_v1(uuid),
 public.employee_audit_v1(uuid,integer,integer),public.employee_account_candidates_v1(text,integer,integer) TO authenticated;
