-- SOURCE-ONLY candidate. Backend execution requires separate approval and target binding.
-- Exact dual profiles: post-CO without catalogue, or captured installed catalogue.
-- Only ten catalogue bodies extend the new operation; every existing runtime fence,
-- catalog_writer_drain_v2 call, lineage edge and unrelated producer pin is preserved.
-- No historical rows, quantities, returned dates, cutover state or grants change.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE private.pilot_order_requests IN SHARE ROW EXCLUSIVE MODE NOWAIT;
CREATE TEMP TABLE sj_received_profile(profile text PRIMARY KEY) ON COMMIT DROP;
DO $profile$
DECLARE markers integer; generation integer; ready boolean;
BEGIN
 markers:=(to_regclass('private.catalog_cutover_v1') IS NOT NULL)::integer
  +(to_regclass('private.catalog_identity_v1') IS NOT NULL)::integer
  +(to_regprocedure('private.catalog_po_legacy_transaction_v1(uuid,text,jsonb)') IS NOT NULL)::integer;
 IF markers=0 THEN INSERT INTO pg_temp.sj_received_profile VALUES('legacy');
 ELSIF markers=3 THEN
  -- Hold the existing generation without changing or enabling its cutover state.
  SELECT execution_generation,tracking_ready INTO STRICT generation,ready
   FROM private.catalog_cutover_v1 WHERE singleton FOR SHARE NOWAIT;
  IF generation NOT IN (1,2) OR ready IS NULL OR (generation=2 AND NOT ready)
   OR (SELECT count(*) FROM private.catalog_cutover_v1)<>1 THEN
   RAISE EXCEPTION 'Unsupported catalogue cutover state' USING ERRCODE='55000'; END IF;
  INSERT INTO pg_temp.sj_received_profile VALUES('catalogue');
 ELSE RAISE EXCEPTION 'Partial catalogue installation requires a separately reviewed rebase'
   USING ERRCODE='55000',DETAIL='CATALOGUE_REBASE_REQUIRED';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('private.demo_returned_date_open(timestamptz,timestamptz)'))
 IS DISTINCT FROM '3174f9009692cd8d3b3e76a102d56ece' THEN
  RAISE EXCEPTION 'Fourteen-day window helper drift' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.demo_returned_date_open(timestamptz,timestamptz)')
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND p.provolatile='s'
  AND NOT p.prosecdef AND NOT p.proisstrict AND p.prorettype='boolean'::regtype
  AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
  RAISE EXCEPTION 'Fourteen-day window helper security topology drift' USING ERRCODE='55000'; END IF;
END $profile$;
CREATE TEMP TABLE sj_received_pins(profile text,signature text,old_md5 text NOT NULL,new_md5 text NOT NULL,
 security_definer boolean NOT NULL,volatility "char" NOT NULL,PRIMARY KEY(profile,signature)) ON COMMIT DROP;
INSERT INTO sj_received_pins VALUES
 ('legacy','public.pilot_order_transaction(uuid,text,jsonb)','0b1e19441a499ae9c864b2d21aef28ba','418f6234dddf9951e7995de5f721a143',true,'v'),
 ('legacy','public.pilot_reconcile_request(uuid,boolean)','36cd1c50d51128e611cbdd6807412aff','f8978af8eb24dc44beb5f0df343405d4',true,'v'),
 ('legacy','private.demo_order_execution_fence()','22f2bbc6ec73fc23aeeb116a8f6cf325','8548cc66f4500a9e2b044415432b4aa4',false,'v'),
 ('catalogue','private.catalog_po_legacy_transaction_v1(uuid,text,jsonb)','0b1e19441a499ae9c864b2d21aef28ba','418f6234dddf9951e7995de5f721a143',true,'v'),
 ('catalogue','private.catalog_po_transaction_core_v2(uuid,text,jsonb)','48e381a23cd97852c4a01cfff6318bf9','ad178daab814ebe9ceda4b7d534c0cc7',true,'v'),
 ('catalogue','public.pilot_reconcile_request(uuid,boolean)','36cd1c50d51128e611cbdd6807412aff','f8978af8eb24dc44beb5f0df343405d4',true,'v'),
 ('catalogue','private.demo_order_execution_fence()','f43b664954adf3b68aff927a2f5c69d2','71f870013c218dcc2f20ab6dcf910025',true,'v'),
 ('catalogue','public.pilot_order_transaction(uuid,text,jsonb)','d46364fb5b2cf057e98e3f5c03a1a0e5','5eb10f564eca436acd7983329fd80ffe',true,'v'),
 ('catalogue','private.catalog_po_assert_event_v2()','45a2241d0821bdb3b5f0b84ca608111f','7584fb8753f96ff0271e334bbb047d21',true,'v'),
 ('catalogue','private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)','9678f1d6ebad54ab62755b3add49d347','96302bb0ab749ccd32e02783afe17b1e',false,'i'),
 ('catalogue','private.catalog_history_extract_v1(text,jsonb)','08b8ecb5f792d9bed6346b1f8487cadb','2007ae335b7854667b5cde22eddc7bba',false,'s'),
 ('catalogue','private.catalog_history_producers_v1()','a4173a60d03b4a0efb9e9ea86af48449','ca2503109eaee4f147faade8081fbe67',true,'s'),
 ('catalogue','private.catalog_assert_checked_graph_v2()','6155cb4ca3e236dfcd9eba04e75ce982','6ffafa0f145828f5917a360e8181212e',true,'v');
DELETE FROM pg_temp.sj_received_pins WHERE profile<>(SELECT profile FROM pg_temp.sj_received_profile);
CREATE TEMP TABLE sj_received_functions ON COMMIT DROP AS
 SELECT p.oid,x.signature,to_jsonb(p)-'prosrc' AS metadata,p.prosrc AS original_body,p.prosrc AS expected_body
 FROM pg_temp.sj_received_pins x JOIN pg_proc p ON p.oid=to_regprocedure(x.signature);
CREATE TEMP TABLE sj_received_apply(apply boolean NOT NULL) ON COMMIT DROP;
DO $preflight$ BEGIN
 IF (SELECT count(*) FROM pg_temp.sj_received_functions)<>(SELECT count(*) FROM pg_temp.sj_received_pins) THEN
  RAISE EXCEPTION 'Received-date entrypoint topology drift' USING ERRCODE='55000'; END IF;
 -- Retry is a no-op only for one complete exact profile, never a mixed installation.
 IF NOT EXISTS(SELECT 1 FROM pg_temp.sj_received_pins x JOIN pg_proc p ON p.oid=to_regprocedure(x.signature) WHERE md5(p.prosrc) IS DISTINCT FROM x.new_md5) THEN
  INSERT INTO pg_temp.sj_received_apply VALUES(false);
 ELSIF NOT EXISTS(SELECT 1 FROM pg_temp.sj_received_pins x JOIN pg_proc p ON p.oid=to_regprocedure(x.signature) WHERE md5(p.prosrc) IS DISTINCT FROM x.old_md5) THEN
  INSERT INTO pg_temp.sj_received_apply VALUES(true);
 ELSE RAISE EXCEPTION 'Unreviewed or partial received-date entrypoint bodies' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.sj_received_pins x JOIN pg_proc p ON p.oid=to_regprocedure(x.signature)
  WHERE p.proowner<>'postgres'::regrole OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.prosecdef IS DISTINCT FROM x.security_definer
   OR p.provolatile<>x.volatility OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prokind<>'f') THEN
  RAISE EXCEPTION 'Received-date function security topology drift' USING ERRCODE='55000'; END IF;
END $preflight$;
CREATE TEMP TABLE sj_received_rewrites(profile text,signature text,sequence integer,old_span text,new_span text,occurrences integer) ON COMMIT DROP;
INSERT INTO sj_received_rewrites VALUES
 ('legacy','public.pilot_order_transaction(uuid,text,jsonb)',0,$old$,'edit_sj_returned_date')$old$,$new$,'edit_sj_returned_date','edit_sj_received_date')$new$,3),
 ('legacy','public.pilot_order_transaction(uuid,text,jsonb)',1,$old$  ELSIF p_operation='edit_sj_returned_date' THEN$old$,$new$  ELSIF p_operation='edit_sj_received_date' THEN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['expected_updated_at','sj_date_received','sj_id']::text[]
   OR jsonb_typeof(p_payload->'sj_date_received') NOT IN ('string','null')
   THEN RAISE EXCEPTION 'Received date payload fields invalid' USING ERRCODE='22023'; END IF;
   IF p_payload->'sj_date_received'<>'null'::jsonb THEN
    IF (p_payload->>'sj_date_received') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
     RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023'; END IF;
    BEGIN
     IF NOT isfinite((p_payload->>'sj_date_received')::date)
     OR to_char((p_payload->>'sj_date_received')::date,'YYYY-MM-DD')<>p_payload->>'sj_date_received' THEN
      RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023'; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
     RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023';
    END;
   END IF;
   -- Parent lock and optimistic version check above precede the SJ lock and wall clock.
   SELECT * INTO sj FROM public.surat_jalan h WHERE h.id=sj.id AND h.purchase_order_id=po_id FOR UPDATE;
   IF NOT FOUND OR sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Active delivery note required' USING ERRCODE='22023'; END IF;
   IF po.status='complete' AND NOT private.demo_returned_date_open(po.completed_at,clock_timestamp()) THEN
    RAISE EXCEPTION 'Completed received-date correction window has ended' USING ERRCODE='55000'; END IF;
   UPDATE public.surat_jalan h SET sj_date_received=(p_payload->>'sj_date_received')::date WHERE h.id=sj.id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value)
   VALUES(po_id,actor,'sj_date_received',sj.sj_date_received::text,p_payload->>'sj_date_received');
   id:=sj.id;
  ELSIF p_operation='edit_sj_returned_date' THEN$new$,1),
 ('legacy','public.pilot_order_transaction(uuid,text,jsonb)',2,$old$IF p_operation<>'edit_sj_returned_date' THEN$old$,$new$IF p_operation NOT IN ('edit_sj_returned_date','edit_sj_received_date') THEN$new$,1),
 ('legacy','public.pilot_reconcile_request(uuid,boolean)',0,$old$'edit_sj_returned_date','recovery_abandoned'$old$,$new$'edit_sj_returned_date','edit_sj_received_date','recovery_abandoned'$new$,1),
 ('legacy','private.demo_order_execution_fence()',0,$old$'edit_sj_returned_date')$old$,$new$'edit_sj_returned_date','edit_sj_received_date')$new$,1),
 ('catalogue','private.catalog_po_legacy_transaction_v1(uuid,text,jsonb)',0,$old$,'edit_sj_returned_date')$old$,$new$,'edit_sj_returned_date','edit_sj_received_date')$new$,3),
 ('catalogue','private.catalog_po_transaction_core_v2(uuid,text,jsonb)',0,$old$,'edit_sj_returned_date')$old$,$new$,'edit_sj_returned_date','edit_sj_received_date')$new$,3),
 ('catalogue','private.catalog_po_legacy_transaction_v1(uuid,text,jsonb)',1,$old$  ELSIF p_operation='edit_sj_returned_date' THEN$old$,$new$  ELSIF p_operation='edit_sj_received_date' THEN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['expected_updated_at','sj_date_received','sj_id']::text[]
   OR jsonb_typeof(p_payload->'sj_date_received') NOT IN ('string','null')
   THEN RAISE EXCEPTION 'Received date payload fields invalid' USING ERRCODE='22023'; END IF;
   IF p_payload->'sj_date_received'<>'null'::jsonb THEN
    IF (p_payload->>'sj_date_received') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
     RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023'; END IF;
    BEGIN
     IF NOT isfinite((p_payload->>'sj_date_received')::date)
     OR to_char((p_payload->>'sj_date_received')::date,'YYYY-MM-DD')<>p_payload->>'sj_date_received' THEN
      RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023'; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
     RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023';
    END;
   END IF;
   -- Parent lock and optimistic version check above precede the SJ lock and wall clock.
   SELECT * INTO sj FROM public.surat_jalan h WHERE h.id=sj.id AND h.purchase_order_id=po_id FOR UPDATE;
   IF NOT FOUND OR sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Active delivery note required' USING ERRCODE='22023'; END IF;
   IF po.status='complete' AND NOT private.demo_returned_date_open(po.completed_at,clock_timestamp()) THEN
    RAISE EXCEPTION 'Completed received-date correction window has ended' USING ERRCODE='55000'; END IF;
   UPDATE public.surat_jalan h SET sj_date_received=(p_payload->>'sj_date_received')::date WHERE h.id=sj.id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value)
   VALUES(po_id,actor,'sj_date_received',sj.sj_date_received::text,p_payload->>'sj_date_received');
   id:=sj.id;
  ELSIF p_operation='edit_sj_returned_date' THEN$new$,1),
 ('catalogue','private.catalog_po_transaction_core_v2(uuid,text,jsonb)',1,$old$  ELSIF p_operation='edit_sj_returned_date' THEN$old$,$new$  ELSIF p_operation='edit_sj_received_date' THEN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['expected_updated_at','sj_date_received','sj_id']::text[]
   OR jsonb_typeof(p_payload->'sj_date_received') NOT IN ('string','null')
   THEN RAISE EXCEPTION 'Received date payload fields invalid' USING ERRCODE='22023'; END IF;
   IF p_payload->'sj_date_received'<>'null'::jsonb THEN
    IF (p_payload->>'sj_date_received') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
     RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023'; END IF;
    BEGIN
     IF NOT isfinite((p_payload->>'sj_date_received')::date)
     OR to_char((p_payload->>'sj_date_received')::date,'YYYY-MM-DD')<>p_payload->>'sj_date_received' THEN
      RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023'; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
     RAISE EXCEPTION 'Received date must be a real YYYY-MM-DD calendar date' USING ERRCODE='22023';
    END;
   END IF;
   -- Parent lock and optimistic version check above precede the SJ lock and wall clock.
   SELECT * INTO sj FROM public.surat_jalan h WHERE h.id=sj.id AND h.purchase_order_id=po_id FOR UPDATE;
   IF NOT FOUND OR sj.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Active delivery note required' USING ERRCODE='22023'; END IF;
   IF po.status='complete' AND NOT private.demo_returned_date_open(po.completed_at,clock_timestamp()) THEN
    RAISE EXCEPTION 'Completed received-date correction window has ended' USING ERRCODE='55000'; END IF;
   UPDATE public.surat_jalan h SET sj_date_received=(p_payload->>'sj_date_received')::date WHERE h.id=sj.id;
   INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value)
   VALUES(po_id,actor,'sj_date_received',sj.sj_date_received::text,p_payload->>'sj_date_received');
   id:=sj.id;
  ELSIF p_operation='edit_sj_returned_date' THEN$new$,1),
 ('catalogue','private.catalog_po_legacy_transaction_v1(uuid,text,jsonb)',2,$old$IF p_operation<>'edit_sj_returned_date' THEN$old$,$new$IF p_operation NOT IN ('edit_sj_returned_date','edit_sj_received_date') THEN$new$,1),
 ('catalogue','private.catalog_po_transaction_core_v2(uuid,text,jsonb)',2,$old$IF p_operation<>'edit_sj_returned_date' THEN$old$,$new$IF p_operation NOT IN ('edit_sj_returned_date','edit_sj_received_date') THEN$new$,1),
 ('catalogue','public.pilot_reconcile_request(uuid,boolean)',0,$old$'edit_sj_returned_date','recovery_abandoned'$old$,$new$'edit_sj_returned_date','edit_sj_received_date','recovery_abandoned'$new$,1),
 ('catalogue','private.demo_order_execution_fence()',0,$old$'edit_sj_returned_date')$old$,$new$'edit_sj_returned_date','edit_sj_received_date')$new$,1),
 ('catalogue','public.pilot_order_transaction(uuid,text,jsonb)',0,$old$'edit_sj_returned_date')$old$,$new$'edit_sj_returned_date','edit_sj_received_date')$new$,1),
 ('catalogue','private.catalog_po_assert_event_v2()',0,$old$'edit_sj_returned_date')$old$,$new$'edit_sj_returned_date','edit_sj_received_date')$new$,1),
 ('catalogue','private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)',0,$old$'edit_sj_returned_date','finalize_visit'$old$,$new$'edit_sj_returned_date','edit_sj_received_date','finalize_visit'$new$,1),
 ('catalogue','private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)',1,$old$ELSIF operation='edit_sj_returned_date' THEN$old$,$new$ELSIF operation IN ('edit_sj_returned_date','edit_sj_received_date') THEN$new$,1),
 ('catalogue','private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)',2,$old$    WHEN 'edit_sj_returned_date' THEN ARRAY['sj_id','expected_updated_at','sj_date_returned']$old$,$new$    WHEN 'edit_sj_received_date' THEN ARRAY['sj_id','expected_updated_at','sj_date_received']
    WHEN 'edit_sj_returned_date' THEN ARRAY['sj_id','expected_updated_at','sj_date_returned']$new$,1),
 ('catalogue','private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)',3,$old$'notes','sj_date_returned','sj_voided'$old$,$new$'notes','sj_date_returned','sj_date_received','sj_voided'$new$,1),
 ('catalogue','private.catalog_history_extract_v1(text,jsonb)',0,$old$'edit_sj_returned_date'))$old$,$new$'edit_sj_returned_date','edit_sj_received_date'))$new$,1),
 ('catalogue','private.catalog_history_producers_v1()',0,$old$9678f1d6ebad54ab62755b3add49d347$old$,$new$96302bb0ab749ccd32e02783afe17b1e$new$,1),
 ('catalogue','private.catalog_history_producers_v1()',1,$old$48e381a23cd97852c4a01cfff6318bf9$old$,$new$ad178daab814ebe9ceda4b7d534c0cc7$new$,1),
 ('catalogue','private.catalog_assert_checked_graph_v2()',0,$old$2ef5505a63d8a74057d3723efcf1ab5705642d465892093a79468ab916958502$old$,$new$8bb96682d56adb717fd23b1ab6329f5fc4da355096c2427abc83d3e19258681f$new$,1),
 ('catalogue','private.catalog_assert_checked_graph_v2()',1,$old$724655ca8092b32cef374fb2f0088a2e539c6539c3ec5b29091c4721ace9eb9b$old$,$new$fe8fe6fef6144bec612062c29052ba3d576d3791e11de7d10b77a9f76fe20a3d$new$,1);
DELETE FROM pg_temp.sj_received_rewrites WHERE profile<>(SELECT profile FROM pg_temp.sj_received_profile);
DO $apply$
DECLARE entry record; patch record; body text; definition text;
BEGIN
 IF NOT (SELECT apply FROM pg_temp.sj_received_apply) THEN RETURN; END IF;
 FOR entry IN SELECT * FROM pg_temp.sj_received_pins ORDER BY signature LOOP
  SELECT p.prosrc INTO STRICT body FROM pg_proc p WHERE p.oid=to_regprocedure(entry.signature);
  IF md5(body) IS DISTINCT FROM entry.old_md5 THEN RAISE EXCEPTION 'Entrypoint changed during received-date migration'; END IF;
  FOR patch IN SELECT * FROM pg_temp.sj_received_rewrites WHERE signature=entry.signature ORDER BY sequence LOOP
   IF (length(body)-length(replace(body,patch.old_span,'')))/length(patch.old_span)<>patch.occurrences THEN
    RAISE EXCEPTION 'Received-date executable span drift'; END IF;
   body:=replace(body,patch.old_span,patch.new_span);
  END LOOP;
  IF md5(body) IS DISTINCT FROM entry.new_md5 THEN RAISE EXCEPTION 'Received-date expected body mismatch'; END IF;
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p WHERE p.oid=to_regprocedure(entry.signature);
  IF (length(definition)-length(replace(definition,(SELECT original_body FROM pg_temp.sj_received_functions WHERE oid=to_regprocedure(entry.signature)),'')))/length((SELECT original_body FROM pg_temp.sj_received_functions WHERE oid=to_regprocedure(entry.signature)))<>1 THEN
   RAISE EXCEPTION 'Received-date function definition mismatch'; END IF;
  EXECUTE replace(definition,(SELECT original_body FROM pg_temp.sj_received_functions WHERE oid=to_regprocedure(entry.signature)),body);
  UPDATE pg_temp.sj_received_functions SET expected_body=body WHERE oid=to_regprocedure(entry.signature);
 END LOOP;
END $apply$;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.sj_received_functions f JOIN pg_proc p ON p.oid=f.oid
  WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM f.metadata OR p.prosrc IS DISTINCT FROM f.expected_body)
 OR EXISTS(SELECT 1 FROM pg_temp.sj_received_pins x JOIN pg_proc p ON p.oid=to_regprocedure(x.signature) WHERE md5(p.prosrc) IS DISTINCT FROM x.new_md5) THEN
  RAISE EXCEPTION 'Received-date metadata or final body drift'; END IF;
END $postflight$;
NOTIFY pgrst,'reload schema';
COMMIT;
