CREATE SCHEMA __SCHEMA__;
REVOKE ALL ON SCHEMA __SCHEMA__ FROM PUBLIC;
CREATE TABLE __SCHEMA__.actor(id uuid PRIMARY KEY, active boolean NOT NULL, role_name text NOT NULL);
CREATE TABLE __SCHEMA__.master(id uuid PRIMARY KEY, label text NOT NULL);
CREATE TABLE __SCHEMA__.identity_evidence(
 kind smallint NOT NULL CHECK(kind IN (1,2)), id uuid NOT NULL,
 provenance text NOT NULL CHECK(provenance IN ('unknown','unused')),
 lifetime_used boolean NOT NULL DEFAULT false,
 tombstone boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(kind,id)
);
CREATE TABLE __SCHEMA__.target(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 master_id uuid NOT NULL REFERENCES __SCHEMA__.master(id) ON DELETE CASCADE NOT DEFERRABLE,
 period text NOT NULL, target_value numeric NOT NULL,
 set_by uuid NOT NULL REFERENCES __SCHEMA__.actor(id),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(master_id,period)
);
CREATE TABLE __SCHEMA__.business(id integer PRIMARY KEY, value integer NOT NULL);
INSERT INTO __SCHEMA__.business VALUES(1,0);
INSERT INTO __SCHEMA__.actor VALUES('10000000-0000-0000-0000-000000000001',true,'executive'),('10000000-0000-0000-0000-000000000002',false,'executive');
INSERT INTO __SCHEMA__.master SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'synthetic-'||n FROM generate_series(1,30)n;
INSERT INTO __SCHEMA__.identity_evidence(kind,id,provenance) SELECT 1,id,'unused' FROM __SCHEMA__.master WHERE id<>'00000000-0000-0000-0000-000000000030';

CREATE FUNCTION __SCHEMA__.actor_check() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_id uuid;
BEGIN
 LOCK TABLE __SCHEMA__.actor IN SHARE MODE;
 actor_id:=current_setting('probe.actor',true)::uuid;
 IF NOT EXISTS(SELECT 1 FROM __SCHEMA__.actor WHERE id=actor_id AND active AND role_name IN ('executive','lead')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROBE_ACTOR_REFUSED';
 END IF;
 RETURN actor_id;
END $$;
CREATE FUNCTION __SCHEMA__.evidence_lock(k smallint, v uuid) RETURNS __SCHEMA__.identity_evidence LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e __SCHEMA__.identity_evidence;
BEGIN
 LOCK TABLE __SCHEMA__.identity_evidence IN ROW EXCLUSIVE MODE __NOWAIT__;
 SELECT * INTO e FROM __SCHEMA__.identity_evidence WHERE kind=k AND id=v FOR UPDATE __NOWAIT__;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='PROBE_TRACKING_INCOMPLETE'; END IF;
 RETURN e;
END $$;
CREATE FUNCTION __SCHEMA__.reservation_key(k smallint,v uuid) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT __RESERVATION_HASH__;
$$;
CREATE FUNCTION __SCHEMA__.reserve_create(k smallint,v uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT pg_try_advisory_xact_lock(__SCHEMA__.reservation_key(k,v)) THEN
  RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='PROBE_CREATION_BUSY';
 END IF;
END $$;
CREATE FUNCTION __SCHEMA__.mark_used(v uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e __SCHEMA__.identity_evidence;
BEGIN
 e:=__SCHEMA__.evidence_lock(1::smallint,v);
 UPDATE __SCHEMA__.identity_evidence SET lifetime_used=true,version=version+1 WHERE kind=1 AND id=v;
END $$;
CREATE FUNCTION __SCHEMA__.target_before() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid;
BEGIN
 a:=__SCHEMA__.actor_check();
 IF TG_OP<>'DELETE' AND NEW.set_by IS DISTINCT FROM a THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROBE_SETTER_REFUSED'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.master_id,NEW.period,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.master_id,OLD.period,OLD.created_at) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROBE_TARGET_SCOPE_IMMUTABLE';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER target_before BEFORE INSERT OR UPDATE OR DELETE ON __SCHEMA__.target FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.target_before();
CREATE FUNCTION __SCHEMA__.target_actual_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v uuid;
BEGIN
 FOR v IN SELECT DISTINCT x FROM unnest(CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.master_id] WHEN 'DELETE' THEN ARRAY[OLD.master_id] ELSE ARRAY[OLD.master_id,NEW.master_id] END) t(x) ORDER BY x LOOP
  PERFORM __SCHEMA__.mark_used(v);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER zz_target_actual_event AFTER INSERT OR UPDATE OR DELETE ON __SCHEMA__.target FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.target_actual_event();
CREATE FUNCTION __SCHEMA__.target_assert_used() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v uuid;
BEGIN
 FOR v IN SELECT DISTINCT x FROM unnest(CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.master_id] WHEN 'DELETE' THEN ARRAY[OLD.master_id] ELSE ARRAY[OLD.master_id,NEW.master_id] END) t(x) LOOP
  IF NOT EXISTS(SELECT 1 FROM __SCHEMA__.identity_evidence WHERE kind=1 AND id=v AND lifetime_used) THEN RAISE EXCEPTION USING ERRCODE='P1005',MESSAGE='PROBE_ASSERT_USED_FAILED'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER zz_target_assert_used AFTER INSERT OR UPDATE OR DELETE ON __SCHEMA__.target DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.target_assert_used();
CREATE FUNCTION __SCHEMA__.master_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e __SCHEMA__.identity_evidence;
BEGIN
 PERFORM __SCHEMA__.actor_check();
 IF TG_OP='INSERT' THEN
  PERFORM __SCHEMA__.reserve_create(1::smallint,NEW.id);
  LOCK TABLE __SCHEMA__.identity_evidence IN ROW EXCLUSIVE MODE __NOWAIT__;
  SELECT * INTO e FROM __SCHEMA__.identity_evidence WHERE kind=1 AND id=NEW.id FOR UPDATE __NOWAIT__;
  IF FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='PROBE_IDENTITY_REUSE_REFUSED'; END IF;
  INSERT INTO __SCHEMA__.identity_evidence(kind,id,provenance) VALUES(1,NEW.id,'unknown');
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'PROBE_MASTER_KEY_IMMUTABLE'; END IF;
 e:=__SCHEMA__.evidence_lock(1::smallint,OLD.id);
 UPDATE __SCHEMA__.identity_evidence SET tombstone=tombstone OR TG_OP='DELETE',version=version+1 WHERE kind=1 AND id=OLD.id;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER master_guard BEFORE INSERT OR UPDATE OR DELETE ON __SCHEMA__.master FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.master_guard();
CREATE FUNCTION __SCHEMA__.delete_unused(v uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e __SCHEMA__.identity_evidence;
BEGIN
 PERFORM __SCHEMA__.actor_check();
 PERFORM 1 FROM __SCHEMA__.master WHERE id=v FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1006',MESSAGE='PROBE_MASTER_MISSING'; END IF;
 e:=__SCHEMA__.evidence_lock(1::smallint,v);
 IF EXISTS(SELECT 1 FROM __SCHEMA__.target WHERE master_id=v) THEN RAISE EXCEPTION USING ERRCODE='P1003',MESSAGE='PROBE_CURRENT_LINK'; END IF;
 IF e.provenance<>'unused' OR e.lifetime_used OR e.tombstone THEN RAISE EXCEPTION USING ERRCODE='P1004',MESSAGE='PROBE_NOT_UNUSED'; END IF;
 DELETE FROM __SCHEMA__.master WHERE id=v;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA __SCHEMA__ FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA __SCHEMA__ FROM PUBLIC;
GRANT USAGE ON SCHEMA __SCHEMA__ TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON __SCHEMA__.target TO authenticated;
GRANT EXECUTE ON FUNCTION __SCHEMA__.delete_unused(uuid) TO authenticated;
