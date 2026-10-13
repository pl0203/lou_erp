-- Optional private supporting evidence. Metadata is not proof of provider object bytes.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
CREATE TABLE private.co_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL, draft_id uuid NOT NULL,
 draft_version bigint NOT NULL CHECK(draft_version>0), customer_version bigint NOT NULL CHECK(customer_version>0), report_month date NOT NULL,
 bound_report_revision_id uuid, source_context_fingerprint text,
 created_by uuid NOT NULL REFERENCES public.users(id), request_id uuid NOT NULL,
 mime_type text NOT NULL CHECK(mime_type IN('application/pdf','image/png','image/jpeg')),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760), sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 version bigint NOT NULL DEFAULT 1 CHECK(version IN(1,2)), finalized_draft_version bigint,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((version=1 AND finalized_draft_version IS NULL) OR (version=2 AND finalized_draft_version=draft_version+1)),
 FOREIGN KEY(draft_id,customer_id) REFERENCES private.co_drafts(id,customer_id),
 FOREIGN KEY(bound_report_revision_id,customer_id) REFERENCES private.co_report_revisions(id,customer_id),
 FOREIGN KEY(created_by,request_id) REFERENCES private.co_commands(actor_id,request_id),
 UNIQUE(draft_id,draft_version,sha256,mime_type,byte_size), UNIQUE(id,customer_id), UNIQUE(id,draft_id,customer_id)
);
CREATE INDEX co_evidence_customer ON private.co_evidence(customer_id,id);
CREATE INDEX co_evidence_actor_request ON private.co_evidence(created_by,request_id);
CREATE TABLE private.co_evidence_verifications (
 evidence_id uuid PRIMARY KEY REFERENCES private.co_evidence(id), object_id uuid NOT NULL UNIQUE,
 object_version text, byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760), mime_type text NOT NULL,
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'), verified_by uuid NOT NULL REFERENCES public.users(id), verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.co_drafts ADD COLUMN evidence_id uuid,
 ADD CONSTRAINT co_draft_evidence_binding FOREIGN KEY(evidence_id,id,customer_id) REFERENCES private.co_evidence(id,draft_id,customer_id);
CREATE TABLE private.co_report_evidence (
 report_revision_id uuid PRIMARY KEY, report_head_id uuid NOT NULL, customer_id uuid NOT NULL, evidence_id uuid NOT NULL,
 FOREIGN KEY(report_revision_id,report_head_id,customer_id) REFERENCES private.co_report_revisions(id,head_id,customer_id),
 FOREIGN KEY(evidence_id,customer_id) REFERENCES private.co_evidence(id,customer_id)
);
CREATE INDEX co_report_evidence_original ON private.co_report_evidence(evidence_id,customer_id);
CREATE FUNCTION private.co_evidence_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.version<>1 OR NEW.version<>2 OR NEW.finalized_draft_version<>OLD.draft_version+1
 OR (to_jsonb(OLD)-ARRAY['version','finalized_draft_version']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['version','finalized_draft_version']) THEN RAISE EXCEPTION 'Immutable evidence identity' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_evidence_identity BEFORE UPDATE OR DELETE ON private.co_evidence FOR EACH ROW EXECUTE FUNCTION private.co_evidence_guard_v1();
CREATE TRIGGER co_evidence_immutable BEFORE UPDATE OR DELETE ON private.co_evidence_verifications FOR EACH ROW EXECUTE FUNCTION private.co_immutable_v1();
CREATE TRIGGER co_evidence_immutable BEFORE UPDATE OR DELETE ON private.co_report_evidence FOR EACH ROW EXECUTE FUNCTION private.co_immutable_v1();
CREATE FUNCTION private.co_evidence_path_v1(e private.co_evidence) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT e.id::text||CASE e.mime_type WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END;
$$;
CREATE FUNCTION private.co_evidence_json_v1(e private.co_evidence) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',e.id,'version',e.version::text,'customer_id',e.customer_id,'customer_version',e.customer_version::text,'draft_id',e.draft_id,'draft_version',e.draft_version::text,'report_month',e.report_month,'filename','evidence-'||private.co_evidence_path_v1(e),'mime_type',e.mime_type,'byte_size',e.byte_size,'state',CASE WHEN e.version=2 THEN 'finalized' WHEN EXISTS(SELECT 1 FROM private.co_evidence_verifications WHERE evidence_id=e.id) THEN 'verified' ELSE 'pending' END,'finalized_draft_version',e.finalized_draft_version::text);
$$;
-- Caller locks the current users row, then request, customer, draft, evidence in that order.
CREATE FUNCTION private.co_evidence_draft_v1(d private.co_drafts, expected bigint, cv bigint) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx jsonb;
BEGIN
 IF d.id IS NULL OR d.kind<>'report' THEN RAISE EXCEPTION 'Invalid evidence draft' USING ERRCODE='22023'; END IF;
 IF d.version<>expected OR d.payload->>'bound_customer_version' IS DISTINCT FROM cv::text THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF d.payload?'posted_report_head_id' THEN RAISE EXCEPTION 'Report draft consumed' USING ERRCODE='55000'; END IF;
 ctx:=private.co_report_context_v1(d.customer_id,d.report_month,d.id);
 IF d.eligible_set_fingerprint IS DISTINCT FROM ctx->>'eligible_set_fingerprint' OR d.payload->'bound_report_revision_id' IS DISTINCT FROM ctx->'bound_report_revision_id' THEN RAISE EXCEPTION 'CO_ELIGIBLE_SET_STALE' USING ERRCODE='PT409'; END IF;
END $$;
CREATE FUNCTION private.co_evidence_begin_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; fingerprint text;
BEGIN
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN('register_evidence','finalize_evidence') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid evidence command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.status='abandoned' THEN RAISE EXCEPTION 'CO request abandoned' USING ERRCODE='55000'; END IF;
 IF command.actor_id IS NOT NULL THEN
  IF command.operation<>p_operation OR command.payload_fingerprint<>fingerprint THEN RAISE EXCEPTION 'CO request identity mismatch' USING ERRCODE='22023'; END IF;
  IF command.status='committed' THEN RETURN command.receipt; END IF;
  RAISE EXCEPTION 'Evidence command executing' USING ERRCODE='55000';
 END IF;
 INSERT INTO private.co_commands(actor_id,request_id,operation,payload_fingerprint,status) VALUES(actor,p_request_id,p_operation,fingerprint,'pending');
 RETURN NULL;
END $$;
CREATE FUNCTION private.co_evidence_reconcile_v1(p_request_id uuid,p_abandon boolean,p_evidence boolean) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_abandon IS NULL OR p_evidence IS NULL THEN RAISE EXCEPTION 'Invalid recovery request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.operation IS NOT NULL AND ((command.operation IN('register_evidence','finalize_evidence'))<>p_evidence) THEN RAISE EXCEPTION 'CO request family mismatch' USING ERRCODE='22023'; END IF;
 IF command.status='committed' THEN RETURN jsonb_build_object('status','committed','operation',command.operation,'receipt',command.receipt); END IF;
 IF command.status='abandoned' THEN RETURN jsonb_build_object('status','abandoned'); END IF;
 IF command.status='pending' THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF p_abandon THEN INSERT INTO private.co_commands(actor_id,request_id,status) VALUES(actor,p_request_id,'abandoned'); RETURN jsonb_build_object('status','abandoned'); END IF;
 RETURN jsonb_build_object('status','unknown');
END $$;
CREATE OR REPLACE FUNCTION public.pilot_reconcile_co_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.co_evidence_reconcile_v1(p_request_id,p_abandon,false); END $$;
CREATE FUNCTION public.pilot_reconcile_co_evidence_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.co_evidence_reconcile_v1(p_request_id,p_abandon,true); END $$;
CREATE FUNCTION public.pilot_co_evidence_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); r jsonb; d private.co_drafts%ROWTYPE; e private.co_evidence%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; c uuid; cv bigint; filename text; mime text; size bigint; digest text; old_id uuid;
BEGIN
 r:=private.co_evidence_begin_v1(p_request_id,p_operation,p_payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF p_operation='register_evidence' THEN
  PERFORM private.co_input_object_v1(p_payload,ARRAY['draft_id','expected_draft_version','expected_customer_version','filename','mime_type','byte_size','sha256'],ARRAY['draft_id','expected_draft_version','expected_customer_version','filename','mime_type','byte_size','sha256']);
  SELECT customer_id INTO c FROM private.co_drafts WHERE id=private.co_input_uuid_v1(p_payload->'draft_id') AND kind='report';
 ELSE
  PERFORM private.co_input_object_v1(p_payload,ARRAY['evidence_id','expected_evidence_version','expected_draft_version','expected_customer_version'],ARRAY['evidence_id','expected_evidence_version','expected_draft_version','expected_customer_version']);
  SELECT customer_id INTO c FROM private.co_evidence WHERE id=private.co_input_uuid_v1(p_payload->'evidence_id');
 END IF;
 cv:=private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'));
 IF p_operation='register_evidence' THEN
  SELECT * INTO d FROM private.co_drafts WHERE id=(p_payload->>'draft_id')::uuid AND customer_id=c FOR UPDATE;
  PERFORM private.co_evidence_draft_v1(d,private.co_input_version_v1(p_payload->'expected_draft_version'),cv);
  filename:=private.co_input_text_v1(p_payload->'filename');mime:=private.co_input_text_v1(p_payload->'mime_type');digest:=private.co_input_text_v1(p_payload->'sha256');
  IF jsonb_typeof(p_payload->'byte_size') IS DISTINCT FROM 'number' OR p_payload->>'byte_size'!~'^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION 'Invalid evidence size' USING ERRCODE='22023'; END IF;size:=(p_payload->>'byte_size')::bigint;
  IF size>10485760 OR digest!~'^[a-f0-9]{64}$' OR mime NOT IN('application/pdf','image/png','image/jpeg') OR length(filename)>200 OR filename~'[[:cntrl:]/\\]' OR filename!~*(CASE mime WHEN 'application/pdf' THEN '^[^.].*\.pdf$' WHEN 'image/png' THEN '^[^.].*\.png$' ELSE '^[^.].*\.jpe?g$' END) THEN RAISE EXCEPTION 'Invalid evidence declaration' USING ERRCODE='22023'; END IF;
  INSERT INTO private.co_evidence(customer_id,draft_id,draft_version,customer_version,report_month,bound_report_revision_id,source_context_fingerprint,created_by,request_id,mime_type,byte_size,sha256)
  VALUES(c,d.id,d.version,cv,d.report_month,(d.payload->>'bound_report_revision_id')::uuid,d.payload->'source_context'->>'source_context_fingerprint',actor,p_request_id,mime,size,digest)
  ON CONFLICT(draft_id,draft_version,sha256,mime_type,byte_size) DO NOTHING RETURNING * INTO e;
  IF e.id IS NULL THEN
   SELECT * INTO e FROM private.co_evidence
   WHERE draft_id=d.id AND draft_version=d.version AND sha256=digest AND mime_type=mime AND byte_size=size;
   -- Keep the original unique identity and creator-only upload/finalize boundary.
   -- A second authorized operator must not receive an unusable committed success.
   IF e.created_by<>actor THEN
    RAISE EXCEPTION 'CO_EVIDENCE_REGISTERED_BY_OTHER_ACTOR' USING ERRCODE='PT409';
   END IF;
  END IF;
 ELSE
  SELECT * INTO e FROM private.co_evidence WHERE id=(p_payload->>'evidence_id')::uuid;
  SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
  SELECT * INTO e FROM private.co_evidence WHERE id=e.id FOR UPDATE;
  IF e.created_by<>actor THEN RAISE EXCEPTION 'Evidence registration actor required' USING ERRCODE='42501'; END IF;
  PERFORM private.co_evidence_draft_v1(d,private.co_input_version_v1(p_payload->'expected_draft_version'),cv);
  IF e.version<>private.co_input_version_v1(p_payload->'expected_evidence_version') OR d.version<>e.draft_version OR cv<>e.customer_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF e.version<>1 THEN RAISE EXCEPTION 'Evidence already finalized' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
  IF a.evidence_id IS NULL THEN RAISE EXCEPTION 'Evidence not verified' USING ERRCODE='55000'; END IF;
  PERFORM private.co_evidence_object_v1(e,a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256);
  old_id:=d.evidence_id;
  UPDATE private.co_drafts SET evidence_id=e.id,version=version+1 WHERE id=d.id;
  UPDATE private.co_evidence SET version=2,finalized_draft_version=d.version+1 WHERE id=e.id RETURNING * INTO e;
 END IF;
 INSERT INTO private.co_audit_events(customer_id,actor_id,request_id,operation,before_state,after_state) VALUES(c,actor,p_request_id,p_operation,jsonb_build_object('evidence_id',old_id),private.co_evidence_json_v1(e));
 RETURN private.co_command_commit_v1(p_request_id,jsonb_build_object('id',e.id,'operation',p_operation,'version',e.version::text,'customer_id',c,'customer_version',cv::text));
END $$;
CREATE FUNCTION private.co_evidence_object_v1(e private.co_evidence,oid uuid,ov text,n bigint,mime text,digest text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF oid IS NULL OR n IS DISTINCT FROM e.byte_size OR mime IS DISTINCT FROM e.mime_type OR digest IS DISTINCT FROM e.sha256 OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.id=oid AND o.bucket_id='co-evidence' AND o.name=private.co_evidence_path_v1(e) AND o.version IS NOT DISTINCT FROM ov AND NOT o.is_delete_marker AND o.metadata->>'size'=e.byte_size::text AND o.metadata->>'mimetype'=e.mime_type) THEN RAISE EXCEPTION 'Evidence object changed' USING ERRCODE='PT409'; END IF;
END $$;
-- This is the only byte-attestation input. EXECUTE is granted solely to service_role.
-- Actor was returned by the caller-JWT context; never impersonate it via session settings.
CREATE FUNCTION public.pilot_co_evidence_attest_v1(p_actor_id uuid,p_evidence_id uuid,p_object_id uuid,p_object_version text,p_byte_size bigint,p_mime_type text,p_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.co_evidence%ROWTYPE; d private.co_drafts%ROWTYPE; a private.co_evidence_verifications%ROWTYPE; cv bigint;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_actor_id AND is_active AND role IN('co_admin','executive') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id AND created_by=p_actor_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Invalid evidence identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||p_actor_id::text||':'||e.request_id::text,0));
 SELECT version INTO cv FROM private.co_customer_state WHERE customer_id=e.customer_id FOR UPDATE;
 SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR UPDATE;
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id FOR UPDATE;
 SELECT * INTO a FROM private.co_evidence_verifications WHERE evidence_id=e.id;
 PERFORM private.co_evidence_object_v1(e,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256);
 IF a.evidence_id IS NOT NULL THEN
  IF (a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256) IS DISTINCT FROM (p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256) THEN RAISE EXCEPTION 'Immutable verification mismatch' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('id',e.id,'state',CASE WHEN e.version=2 THEN 'finalized' ELSE 'verified' END);
 END IF;
 IF cv<>e.customer_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 PERFORM private.co_evidence_draft_v1(d,e.draft_version,cv);
 INSERT INTO private.co_evidence_verifications(evidence_id,object_id,object_version,byte_size,mime_type,sha256,verified_by) VALUES(e.id,p_object_id,p_object_version,p_byte_size,p_mime_type,p_sha256,p_actor_id);
 RETURN jsonb_build_object('id',e.id,'state','verified');
END $$;
CREATE FUNCTION public.pilot_co_evidence_v1(p_evidence_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.co_evidence%ROWTYPE;
BEGIN
 PERFORM private.co_read_actor_v1(); SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Invalid evidence identity' USING ERRCODE='22023'; END IF; RETURN private.co_evidence_json_v1(e);
END $$;
CREATE FUNCTION public.pilot_co_evidence_selection_v1(p_draft_id uuid,p_revision_id uuid,p_expected_draft_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d private.co_drafts%ROWTYPE; e private.co_evidence%ROWTYPE; c uuid; chosen uuid;
BEGIN
 PERFORM private.co_read_actor_v1();
 IF (p_draft_id IS NULL)=(p_revision_id IS NULL) THEN RAISE EXCEPTION 'One exact evidence selection required' USING ERRCODE='22023'; END IF;
 IF p_draft_id IS NOT NULL THEN
  SELECT * INTO d FROM private.co_drafts WHERE id=p_draft_id AND kind='report';c:=d.customer_id;chosen:=d.evidence_id;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid draft' USING ERRCODE='22023'; END IF;
  IF d.version<>private.co_input_version_v1(to_jsonb(p_expected_draft_version)) THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 ELSE
  IF p_expected_draft_version IS NOT NULL THEN RAISE EXCEPTION 'Invalid revision version' USING ERRCODE='22023'; END IF;
  SELECT customer_id INTO c FROM private.co_report_revisions WHERE id=p_revision_id;
  IF c IS NULL THEN RAISE EXCEPTION 'Invalid revision' USING ERRCODE='22023'; END IF;
  SELECT evidence_id INTO chosen FROM private.co_report_evidence WHERE report_revision_id=p_revision_id;
 END IF;
 SELECT * INTO e FROM private.co_evidence WHERE id=chosen AND customer_id=c AND version=2;
 RETURN jsonb_build_object('version','1','customer_id',c,'draft_id',p_draft_id,'draft_version',CASE WHEN p_draft_id IS NOT NULL THEN d.version::text ELSE NULL END,'revision_id',p_revision_id,'evidence',CASE WHEN e.id IS NOT NULL THEN private.co_evidence_json_v1(e) ELSE NULL END);
END $$;
CREATE FUNCTION public.pilot_co_evidence_context_v1(p_evidence_id uuid,p_purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); e private.co_evidence%ROWTYPE; d private.co_drafts%ROWTYPE; o storage.objects%ROWTYPE; cv bigint;
BEGIN
 SELECT * INTO e FROM private.co_evidence WHERE id=p_evidence_id;
 IF e.id IS NULL OR p_purpose IS NULL OR p_purpose NOT IN('upload','download') THEN RAISE EXCEPTION 'Invalid evidence context' USING ERRCODE='22023'; END IF;
 SELECT version INTO cv FROM private.co_customer_state WHERE customer_id=e.customer_id FOR SHARE;
 SELECT * INTO d FROM private.co_drafts WHERE id=e.draft_id FOR SHARE;
 IF p_purpose='upload' THEN
  IF e.created_by<>actor THEN RAISE EXCEPTION 'Evidence registration actor required' USING ERRCODE='42501'; END IF;
  IF e.version<>2 THEN
   IF cv<>e.customer_version THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
   PERFORM private.co_evidence_draft_v1(d,e.draft_version,cv);
  END IF;
 ELSE
  IF e.version<>2 OR NOT (d.evidence_id=e.id OR EXISTS(SELECT 1 FROM private.co_report_evidence WHERE evidence_id=e.id)) THEN RAISE EXCEPTION 'Evidence not linked' USING ERRCODE='55000'; END IF;
 END IF;
 SELECT * INTO o FROM storage.objects WHERE bucket_id='co-evidence' AND name=private.co_evidence_path_v1(e) AND NOT is_delete_marker;
 IF EXISTS(SELECT 1 FROM private.co_evidence_verifications WHERE evidence_id=e.id) THEN
  PERFORM private.co_evidence_object_v1(e,a.object_id,a.object_version,a.byte_size,a.mime_type,a.sha256) FROM private.co_evidence_verifications a WHERE evidence_id=e.id;
 END IF;
 RETURN jsonb_build_object('version','1','id',e.id,'actor_id',actor,'bucket','co-evidence','path',private.co_evidence_path_v1(e),'filename','evidence-'||private.co_evidence_path_v1(e),'mime_type',e.mime_type,'byte_size',e.byte_size,'sha256',e.sha256,'state',private.co_evidence_json_v1(e)->'state','object',CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'version',o.version) END);
END $$;
-- Called inside the two reviewed atomic publication sites, before changing head pointers.
CREATE FUNCTION private.co_link_evidence_v1(c uuid,head uuid,revision uuid,did uuid,dv bigint,original uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE chosen uuid; d private.co_drafts%ROWTYPE; month date;
BEGIN
 SELECT report_month INTO month FROM private.co_report_heads WHERE id=head AND customer_id=c;
 IF month IS NULL OR NOT EXISTS(SELECT 1 FROM private.co_report_revisions WHERE id=revision AND head_id=head AND customer_id=c) THEN RAISE EXCEPTION 'Invalid evidence revision binding' USING ERRCODE='22023'; END IF;
 IF did IS NOT NULL THEN
  SELECT * INTO d FROM private.co_drafts WHERE id=did AND customer_id=c AND kind='report' AND report_month=month;
  IF d.id IS NULL OR d.version IS DISTINCT FROM dv THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  chosen:=d.evidence_id;
  IF chosen IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.co_evidence WHERE id=chosen AND draft_id=d.id AND customer_id=c AND report_month=month AND version=2) THEN RAISE EXCEPTION 'Invalid selected evidence' USING ERRCODE='55000'; END IF;
 ELSE
  IF original IS NULL OR NOT EXISTS(SELECT 1 FROM private.co_report_revisions WHERE id=original AND head_id=head AND customer_id=c) THEN RAISE EXCEPTION 'Invalid original evidence revision' USING ERRCODE='22023'; END IF;
  SELECT evidence_id INTO chosen FROM private.co_report_evidence WHERE report_revision_id=original AND report_head_id=head AND customer_id=c;
 END IF;
 IF chosen IS NOT NULL THEN INSERT INTO private.co_report_evidence(report_revision_id,report_head_id,customer_id,evidence_id) VALUES(revision,head,c,chosen); END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('co-evidence','co-evidence',false,10485760,ARRAY['application/pdf','image/png','image/jpeg']);
-- Restrictive policies also defeat unrelated permissive client policies. Service is deliberately excluded.
CREATE POLICY co_evidence_private_select ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(bucket_id<>'co-evidence');
CREATE POLICY co_evidence_private_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'co-evidence');
CREATE POLICY co_evidence_private_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'co-evidence') WITH CHECK(bucket_id<>'co-evidence');
CREATE POLICY co_evidence_private_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'co-evidence');
DO $security$
DECLARE t text; fn regprocedure;
BEGIN
 FOREACH t IN ARRAY ARRAY['co_evidence','co_evidence_verifications','co_report_evidence'] LOOP EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);END LOOP;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND (p.proname LIKE 'co_evidence_%' OR p.proname='co_link_evidence_v1') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);END LOOP;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'pilot_co_evidence_%' OR p.proname='pilot_reconcile_co_evidence_v1') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn);IF fn::text NOT LIKE '%attest%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',fn);END IF;END LOOP;
END $security$;
GRANT EXECUTE ON FUNCTION public.pilot_co_evidence_attest_v1(uuid,uuid,uuid,text,bigint,text,text) TO service_role;

-- Exact reviewed bodies, unique executable sites and expected resulting digests.
-- Fail atomically on any drift, including comments containing a misleading anchor.
DO $publication_hooks$
DECLARE x record; original text; expected text; definition text; before_meta jsonb; after_meta jsonb; reviewed_meta jsonb; semantic_meta jsonb;
BEGIN
 FOR x IN SELECT * FROM (VALUES
('private.co_monthly_transaction_v1(uuid,text,jsonb)','213ae89869ebad6ce19d49a386122ffc4bbc6f73d39273d977c09918a7fdfdb8','   g:=private.co_materialize_generation_v1(c,v+1,actor,plan,revision,line_ids);','   PERFORM private.co_link_evidence_v1(c,head,revision,d.id,d.version);
   g:=private.co_materialize_generation_v1(c,v+1,actor,plan,revision,line_ids);','0442408fd2b5cee0326495e155f75f62ae96a30bd02e1888fcebdb3204ddf61f'),
('private.co_publish_reviewed_v1(uuid,uuid,uuid,text,jsonb,text)','f2482a6fb9122003ed56b57195d8d25944ff7d6892fc559aa36682b9857473a3','  UPDATE private.co_report_heads SET version=head_version,current_revision_id=revision WHERE id=head;','  PERFORM private.co_link_evidence_v1(c,head,revision,(r->>''draft_id'')::uuid,(r->>''draft_version'')::bigint,(r->>''original_revision_id'')::uuid);
  UPDATE private.co_report_heads SET version=head_version,current_revision_id=revision WHERE id=head;','bece31e4f6c584737e43e8da02aeccfade18c7223a8933e3d0c2047d372c79cf')
 ) AS hooks(signature,original_hash,anchor,replacement,result_hash) LOOP
  SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT original,before_meta FROM pg_proc p WHERE oid=x.signature::regprocedure;
  IF encode(sha256(convert_to(original,'UTF8')),'hex')<>x.original_hash THEN RAISE EXCEPTION 'Unreviewed evidence publication body: %',x.signature; END IF;
  -- Pin the reviewed pre08 catalog semantics, not target-observed metadata. Role,
  -- namespace, language and type identities are portable names; no fixture OIDs.
  -- The remaining entire pg_proc row is compared, so unknown metadata also fails closed.
  reviewed_meta:='{"probin":null,"procost":100,"prokind":"f","prorows":0,"proconfig":["search_path=\"\""],"proretset":false,"prosqlbody":null,"prosupport":"-","proargmodes":null,"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0,"proowner":"postgres","pronamespace":"private","prolang":"plpgsql","prorettype":"jsonb","proacl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}]}'::jsonb
   || CASE WHEN x.signature LIKE '%co_monthly_transaction%' THEN
    '{"proname":"co_monthly_transaction_v1","pronargs":3,"prosecdef":true,"proargnames":["p_request_id","p_operation","p_payload"],"proargtypes":["uuid","text","jsonb"]}'::jsonb
   ELSE '{"proname":"co_publish_reviewed_v1","pronargs":6,"prosecdef":false,"proargnames":["c","actor","request","op","plan","reason"],"proargtypes":["uuid","uuid","uuid","text","jsonb","text"]}'::jsonb END;
  SELECT (to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang','prorettype','proargtypes','proacl'])
   || jsonb_build_object('proowner',pg_get_userbyid(p.proowner),'pronamespace',n.nspname,'prolang',l.lanname,'prorettype',p.prorettype::regtype::text,
    'proargtypes',(SELECT jsonb_agg(t::regtype::text ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY a(t,ord)),
    'proacl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))
   INTO STRICT semantic_meta FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=x.signature::regprocedure;
  IF semantic_meta IS DISTINCT FROM reviewed_meta OR has_function_privilege('anon',x.signature,'EXECUTE') OR has_function_privilege('authenticated',x.signature,'EXECUTE') THEN RAISE EXCEPTION 'Unreviewed evidence publication metadata: %',x.signature; END IF;
  IF (length(original)-length(replace(original,x.anchor,'')))/length(x.anchor)<>1 THEN RAISE EXCEPTION 'Evidence publication anchor mismatch'; END IF;
  expected:=replace(original,x.anchor,x.replacement);
  IF encode(sha256(convert_to(expected,'UTF8')),'hex')<>x.result_hash THEN RAISE EXCEPTION 'Evidence publication result mismatch'; END IF;
  definition:=pg_get_functiondef(x.signature::regprocedure);
  IF (length(definition)-length(replace(definition,original,'')))/length(original)<>1 THEN RAISE EXCEPTION 'Evidence publication definition mismatch'; END IF;
  EXECUTE replace(definition,original,expected);
  SELECT to_jsonb(p) INTO STRICT after_meta FROM pg_proc p WHERE oid=x.signature::regprocedure;
  IF after_meta-'prosrc' IS DISTINCT FROM before_meta OR after_meta->>'prosrc' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Evidence publication metadata changed'; END IF;
 END LOOP;
END $publication_hooks$;

-- New CO objects have explicit audiences even under provider default grants.
-- Preserve legacy function ACLs. Attestation alone is service-only by design.
DO $co_explicit_service_boundary$
DECLARE f regprocedure; t regclass;
BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private' AND starts_with(p.proname,'co_'))
 OR (n.nspname='public' AND (starts_with(p.proname,'pilot_co_') OR starts_with(p.proname,'pilot_reconcile_co') OR p.proname IN ('pilot_procurement_access_v1','pilot_sales_metrics_v2','pilot_sales_metric_months_v2'))
 AND p.proname<>'pilot_co_evidence_attest_v1') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role',f);
 END LOOP;
 FOR t IN SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='private' AND starts_with(c.relname,'co_') AND c.relkind='r' LOOP
  EXECUTE format('REVOKE ALL ON TABLE %s FROM service_role',t);
 END LOOP;
END $co_explicit_service_boundary$;
REVOKE ALL ON SEQUENCE private.co_delivery_heads_original_creation_order_seq FROM service_role;


COMMIT;
