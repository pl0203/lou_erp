-- Read-only PostgreSQL17 regression: ACL normalization, not permission changes.
BEGIN READ ONLY;
SET LOCAL search_path='';
DO $acl_normalization$
DECLARE raw aclitem[];kind "char";actual jsonb;expected jsonb;column_grant aclitem[];
BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Disposable fixture required';END IF;
 column_grant:=ARRAY[makeaclitem('authenticated'::regrole,'postgres'::regrole,'SELECT',true)];
 expected:=jsonb_build_array(jsonb_build_object('grantor','postgres','grantee','authenticated','privilege','SELECT','grantable',true));
 -- Null column ACL: no explicit column privileges. The table ACL is separate.
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO actual FROM aclexplode(NULLIF(NULL::aclitem[],'{}'::aclitem[]))x;
 IF actual<>'[]'::jsonb THEN RAISE EXCEPTION 'Null column ACL changed meaning';END IF;
 -- Explicit zero-dimensional empty ACL must also mean no grants, never an error.
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO actual FROM aclexplode(NULLIF('{}'::aclitem[],'{}'::aclitem[]))x;
 IF actual<>'[]'::jsonb THEN RAISE EXCEPTION 'Empty column ACL changed meaning';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',pg_get_userbyid(x.grantee),'privilege',x.privilege_type,'grantable',x.is_grantable)),'[]') INTO actual FROM aclexplode(NULLIF(column_grant,'{}'::aclitem[]))x;
 IF actual<>expected THEN RAISE EXCEPTION 'Explicit column grant or grant option lost';END IF;
 -- For functions, tables and sequences NULL means defaults; explicit empty means none.
 FOREACH kind IN ARRAY ARRAY['f'::"char",'r'::"char",'s'::"char"] LOOP
  raw:=NULL;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]') INTO actual FROM aclexplode(NULLIF(coalesce(raw,acldefault(kind,'postgres'::regrole)),'{}'::aclitem[]))x;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.grantor,x.grantee,x.privilege_type,x.is_grantable) INTO expected FROM aclexplode(acldefault(kind,'postgres'::regrole))x;
  IF actual IS DISTINCT FROM expected OR actual='[]'::jsonb THEN RAISE EXCEPTION 'Null object ACL no longer carries defaults: %',kind;END IF;
  raw:='{}'::aclitem[];
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO actual FROM aclexplode(NULLIF(coalesce(raw,acldefault(kind,'postgres'::regrole)),'{}'::aclitem[]))x;
  IF actual<>'[]'::jsonb THEN RAISE EXCEPTION 'Empty object ACL incorrectly inherited defaults: %',kind;END IF;
  raw:=ARRAY[makeaclitem('authenticated'::regrole,'postgres'::regrole,CASE kind WHEN 'f' THEN 'EXECUTE' WHEN 's' THEN 'USAGE' ELSE 'SELECT' END,false)];
  SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',pg_get_userbyid(x.grantee),'privilege',x.privilege_type,'grantable',x.is_grantable)),'[]') INTO actual FROM aclexplode(NULLIF(coalesce(raw,acldefault(kind,'postgres'::regrole)),'{}'::aclitem[]))x;
  expected:=jsonb_build_array(jsonb_build_object('grantor','postgres','grantee','authenticated','privilege',CASE kind WHEN 'f' THEN 'EXECUTE' WHEN 's' THEN 'USAGE' ELSE 'SELECT' END,'grantable',false));
  IF actual<>expected THEN RAISE EXCEPTION 'Explicit object privilege changed: %',kind;END IF;
 END LOOP;
END $acl_normalization$;
SELECT 'CO_RETURN_ACL_NORMALIZATION_PASSED';
COMMIT;
