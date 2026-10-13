-- Forward repair of the composed personal context. Earlier migration shells stay immutable.
-- Only the obsolete schema sentinel is retired; all real setup and entitlement blockers remain.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE OR REPLACE FUNCTION public.leave_context_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid:=private.ihr_leave_require_actor();result jsonb;readiness jsonb;blockers jsonb;
BEGIN
 result:=private.ihr_leave_context_before_admin();
 IF result->>'memberKind' IN('employee','manager') THEN
  readiness:=private.ihr_leave_readiness(actor,statement_timestamp());
  IF jsonb_typeof(result->'setup'->'blockers') IS DISTINCT FROM 'array'
   OR jsonb_typeof(readiness->'blockers') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Leave setup unavailable' USING ERRCODE='55000';
  END IF;
  SELECT coalesce(jsonb_agg(blocker ORDER BY position),'[]'::jsonb) INTO blockers
  FROM jsonb_array_elements(result->'setup'->'blockers') WITH ORDINALITY AS legacy(blocker,position)
  WHERE blocker->>'code' IS DISTINCT FROM 'SCHEMA_NOT_READY';
  blockers:=blockers||(readiness->'blockers');
  result:=jsonb_set(result,'{setup}',jsonb_build_object(
   'ready',coalesce((readiness->>'ready')::boolean,false) AND jsonb_array_length(blockers)=0,
   'blockers',blockers));
 END IF;
 RETURN result;
END;
$$;
COMMIT;
