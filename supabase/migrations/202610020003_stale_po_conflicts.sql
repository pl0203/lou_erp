-- Additive, exact-source hotfix for custom business conflicts on PostgREST 14.
-- Genuine database serialization failures are untouched. No rows, RLS or grants change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
SET LOCAL search_path='';
DO $stale_po_conflicts$
DECLARE target record; fn oid; before_metadata jsonb; definition text; current_source text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
  ('public.pilot_po_lines_v1(uuid,integer,integer,timestamp with time zone)',
   'e4a931ce4345ba9dd63a6ebd7dc52241','d7b04bc2c54b075cda9dc5de7911d60d',false,'s',
   $raise$RAISE EXCEPTION 'PO changed; refresh before continuing' USING ERRCODE='40001';$raise$,
   $raise$RAISE EXCEPTION 'PO changed; refresh before continuing' USING ERRCODE='PT409';$raise$),
  ('public.pilot_order_transaction(uuid,text,jsonb)',
   'ab2271c853e3bfcb10bf2814d16cede0','2fa378a5be5bfbed7dfdabfe8c6c420c',true,'v',
   $raise$RAISE EXCEPTION 'PO changed; refresh before saving' USING ERRCODE='40001';$raise$,
   $raise$RAISE EXCEPTION 'PO changed; refresh before saving' USING ERRCODE='PT409';$raise$)
 ) AS expected(signature,before_hash,after_hash,security_definer,volatility,old_raise,new_raise) LOOP
  fn:=to_regprocedure(target.signature);
  SELECT p.prosrc,to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)
   INTO current_source,before_metadata,definition FROM pg_proc p WHERE p.oid=fn;
  IF fn IS NULL OR md5(current_source) IS DISTINCT FROM target.before_hash
   OR (length(current_source)-length(replace(current_source,target.old_raise,'')))/length(target.old_raise)<>1
   OR strpos(current_source,$code$ERRCODE='PT409'$code$)>0
  THEN RAISE EXCEPTION 'Stale PO source drift; migration refused'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn
   AND p.proowner='postgres'::regrole AND l.lanname='plpgsql'
   AND p.prosecdef=target.security_definer AND p.provolatile=target.volatility::"char"
   AND p.proconfig=ARRAY['search_path=""'] AND NOT p.proisstrict AND p.proparallel='u' AND NOT p.proleakproof
   AND pg_get_function_result(p.oid)='jsonb')
   OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
   OR has_function_privilege('anon',fn,'EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=fn AND (NOT coalesce(a.grantee=ANY(ARRAY[p.proowner,'authenticated'::regrole::oid,'service_role'::regrole::oid]),false)
     OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR (a.grantee<>p.proowner AND a.is_grantable)))
  THEN RAISE EXCEPTION 'Stale PO authority drift; migration refused'; END IF;
  -- Only these complete, pinned raise statements are replaced in their own functions.
  EXECUTE replace(definition,target.old_raise,target.new_raise);
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid=fn) IS DISTINCT FROM target.after_hash
   OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=fn) IS DISTINCT FROM before_metadata
  THEN RAISE EXCEPTION 'Stale PO metadata changed; migration refused'; END IF;
 END LOOP;
END $stale_po_conflicts$;
NOTIFY pgrst,'reload schema';
COMMIT;
