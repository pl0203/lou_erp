-- REVIEW CANDIDATE: transaction-neutral, after 01. No hosted execution authorized.
SET LOCAL search_path=pg_catalog,pg_temp;
CREATE FUNCTION private.employee_end_elapsed(p_end date,p_at timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((p_at AT TIME ZONE 'Asia/Jakarta')::date>p_end,false);
$$;
CREATE FUNCTION private.employee_restricted(p_user uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM private.employee_account_links l JOIN private.employee_records e ON e.id=l.employee_id
 LEFT JOIN private.employee_episodes ep ON ep.employee_id=e.id WHERE l.user_id=p_user
 AND (e.recorded_status='inactive' OR private.employee_end_elapsed(ep.end_date,clock_timestamp())));
$$;
CREATE FUNCTION private.employee_account_allowed(p_user uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND is_active) AND NOT private.employee_restricted(p_user);
$$;
CREATE FUNCTION private.employee_permanent_executive(p_exclude uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id<>p_exclude AND u.role='executive' AND private.employee_account_allowed(u.id)
 AND NOT EXISTS(SELECT 1 FROM private.employee_account_links l JOIN private.employee_episodes ep ON ep.employee_id=l.employee_id
 WHERE l.user_id=u.id AND ep.end_date IS NOT NULL));
$$;
CREATE TABLE private.employee_access_guard(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),token boolean NOT NULL DEFAULT false);
INSERT INTO private.employee_access_guard(singleton) VALUES(true);
ALTER TABLE private.employee_access_guard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.employee_access_guard FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.employee_access_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES private.employee_records(id),
 user_id uuid NOT NULL REFERENCES public.users(id),actor_id uuid REFERENCES public.users(id),
 cause text NOT NULL CHECK(cause IN('employee_inactive','employment_end')),was_active boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.employee_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.employee_access_events FROM PUBLIC,anon,authenticated,service_role;
-- Mutate a singleton before actor/employee/user locks. Unlike an advisory lock
-- alone, this also rejects a stale REPEATABLE READ snapshot with SQLSTATE 40001.
CREATE FUNCTION private.employee_serialize_access() RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 UPDATE private.employee_access_guard SET token=NOT token WHERE singleton;
$$;
CREATE FUNCTION private.employee_access_mutex() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM private.employee_serialize_access(); RETURN NULL; END;
$$;
CREATE TRIGGER employee_access_mutex BEFORE INSERT OR UPDATE OR DELETE ON public.users FOR EACH STATEMENT EXECUTE FUNCTION private.employee_access_mutex();
CREATE TRIGGER employee_access_mutex BEFORE INSERT OR UPDATE OR DELETE ON private.employee_records FOR EACH STATEMENT EXECUTE FUNCTION private.employee_access_mutex();
CREATE TRIGGER employee_access_mutex BEFORE INSERT OR UPDATE OR DELETE ON private.employee_episodes FOR EACH STATEMENT EXECUTE FUNCTION private.employee_access_mutex();
CREATE TRIGGER employee_access_mutex BEFORE INSERT OR UPDATE OR DELETE ON private.employee_account_links FOR EACH STATEMENT EXECUTE FUNCTION private.employee_access_mutex();
CREATE FUNCTION private.employee_guard_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE removes_authority boolean:=false;
BEGIN
 IF TG_OP<>'DELETE' AND NEW.is_active AND (TG_OP='INSERT' OR NOT OLD.is_active) AND private.employee_restricted(NEW.id) THEN
  RAISE EXCEPTION 'EMPLOYEE_ACCESS_RESTRICTED' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN removes_authority:=OLD.is_active;
 ELSIF TG_OP='UPDATE' THEN removes_authority:=OLD.is_active AND (NOT NEW.is_active OR (OLD.role='executive' AND NEW.role<>'executive')); END IF;
 IF removes_authority THEN
  IF OLD.id=auth.uid() THEN RAISE EXCEPTION 'SELF_DISABLE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF OLD.role='executive' AND NOT private.employee_permanent_executive(OLD.id) THEN
   RAISE EXCEPTION 'LAST_EXECUTIVE_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER employee_guard_account BEFORE INSERT OR UPDATE OR DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION private.employee_guard_account();
CREATE FUNCTION private.employee_disable_link(p_employee uuid,p_cause text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid; active_before boolean;
BEGIN
 SELECT user_id INTO target FROM private.employee_account_links WHERE employee_id=p_employee;
 IF target IS NULL THEN RETURN; END IF;
 IF target=auth.uid() THEN RAISE EXCEPTION 'SELF_DISABLE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT is_active INTO active_before FROM public.users WHERE id=target FOR UPDATE;
 UPDATE public.users SET is_active=false WHERE id=target AND is_active;
 INSERT INTO private.employee_access_events(employee_id,user_id,actor_id,cause,was_active) VALUES(p_employee,target,auth.uid(),p_cause,active_before);
END;
$$;
CREATE FUNCTION private.employee_enforce_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.recorded_status='inactive' AND (TG_OP='INSERT' OR OLD.recorded_status IS DISTINCT FROM NEW.recorded_status) THEN
  PERFORM private.employee_disable_link(NEW.id,'employee_inactive'); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER employee_enforce_record AFTER INSERT OR UPDATE OF recorded_status ON private.employee_records FOR EACH ROW EXECUTE FUNCTION private.employee_enforce_record();
CREATE FUNCTION private.employee_guard_dated_link(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_user=auth.uid() THEN RAISE EXCEPTION 'SELF_DISABLE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND is_active AND role='executive') AND NOT private.employee_permanent_executive(p_user) THEN
  RAISE EXCEPTION 'LAST_EXECUTIVE_REQUIRED' USING ERRCODE='42501'; END IF;
END;
$$;
CREATE FUNCTION private.employee_enforce_episode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid;
BEGIN
 SELECT user_id INTO target FROM private.employee_account_links WHERE employee_id=NEW.employee_id;
 IF (TG_OP='UPDATE' AND private.employee_end_elapsed(OLD.end_date,clock_timestamp())) OR private.employee_end_elapsed(NEW.end_date,clock_timestamp()) THEN
  IF TG_OP='INSERT' OR OLD.end_date IS DISTINCT FROM NEW.end_date THEN PERFORM private.employee_disable_link(NEW.employee_id,'employment_end'); END IF;
 END IF;
 IF NEW.end_date IS NOT NULL AND (TG_OP='INSERT' OR OLD.end_date IS DISTINCT FROM NEW.end_date) AND target IS NOT NULL THEN
  PERFORM private.employee_guard_dated_link(target); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER employee_enforce_episode BEFORE INSERT OR UPDATE ON private.employee_episodes FOR EACH ROW EXECUTE FUNCTION private.employee_enforce_episode();
CREATE FUNCTION private.employee_enforce_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.employee_id,NEW.user_id) IS DISTINCT FROM ROW(OLD.employee_id,OLD.user_id) THEN
  RAISE EXCEPTION 'ACCOUNT_LINK_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM private.employee_records e LEFT JOIN private.employee_episodes ep ON ep.employee_id=e.id
   WHERE e.id=NEW.employee_id AND (e.recorded_status='inactive' OR private.employee_end_elapsed(ep.end_date,clock_timestamp()))) THEN
   RAISE EXCEPTION 'EMPLOYEE_ACCESS_RESTRICTED' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM private.employee_episodes WHERE employee_id=NEW.employee_id AND end_date IS NOT NULL) THEN
   PERFORM private.employee_guard_dated_link(NEW.user_id); END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER employee_enforce_link BEFORE INSERT OR UPDATE ON private.employee_account_links FOR EACH ROW EXECUTE FUNCTION private.employee_enforce_link();
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT role FROM public.users WHERE id=auth.uid() AND private.employee_account_allowed(id);
$$;
CREATE OR REPLACE FUNCTION public.pilot_my_profile() RETURNS TABLE(id uuid,full_name text,email text,role public.user_role,is_active boolean,manager_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT u.id,u.full_name,u.email,u.role,u.is_active,u.manager_id FROM public.users u WHERE u.id=auth.uid() AND private.employee_account_allowed(u.id);
$$;
CREATE OR REPLACE FUNCTION private.employee_require_director() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.current_user_role() IS DISTINCT FROM 'executive'::public.user_role THEN RAISE EXCEPTION 'DIRECTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN auth.uid();
END;
$$;
CREATE OR REPLACE FUNCTION private.employee_lock_actor() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 PERFORM private.employee_serialize_access();
 PERFORM 1 FROM public.users WHERE id=actor FOR SHARE;
 IF NOT private.employee_account_allowed(actor) OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND role='executive') THEN
  RAISE EXCEPTION 'DIRECTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END;
$$;
REVOKE ALL ON FUNCTION private.employee_end_elapsed(date,timestamptz),private.employee_restricted(uuid),private.employee_account_allowed(uuid),
 private.employee_permanent_executive(uuid),private.employee_serialize_access(),private.employee_access_mutex(),private.employee_guard_account(),
 private.employee_disable_link(uuid,text),private.employee_enforce_record(),private.employee_guard_dated_link(uuid),private.employee_enforce_episode(),private.employee_enforce_link()
 FROM PUBLIC,anon,authenticated,service_role;
