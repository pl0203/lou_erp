// Finite synthetic baseline reconstruction only. No connection or hosted runner.
// Caller must bind its disposable server before invoking this current-profile step.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const digest=s=>createHash('sha256').update(s).digest('hex')
export const returnCurrentFunctionSourcePins=Object.freeze([
 ['supabase/migrations/202610190001_sj_received_date.sql','df12f5038996fc57f5df7cf7562c46ec35ac8c0be8991a05e4fe4663599d0826'],
 ['sql/director-oversight-review.sql','45fde656f61e7d01e7586f3c9b5ca98ad57f8681e1b487964f9f7f1015e372ce'],
])
const guard=`DO $current_return_profile$ BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1
 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 OR (SELECT count(*) FROM private.catalog_cutover_v1)<>1
 OR NOT EXISTS(SELECT 1 FROM private.catalog_cutover_v1 WHERE singleton AND execution_generation=1 AND NOT tracking_ready)
 OR to_regclass('private.employee_records') IS NULL THEN
  RAISE EXCEPTION 'Identity-bound disposable current return profile required';
 END IF;
END $current_return_profile$;`
const helperPins=[
 ['private.ihr_leave_require_director()','cfa63e3bc9bb85ae3206c5a627a6912efe2a54eb2ea97ff3610b09fc1d1aa4fd','plpgsql','uuid'],
 ['private.ihr_leave_director_target(uuid)','8dd76fe21ce264c6dd546a853c96f95fcd6cbd30dea813f564d480efe485abb3','sql','boolean'],
]
export function buildReturnCurrentFunctions({read}){
 // Validate both complete sources before executing even the first guarded stage.
 const [sj,director]=returnCurrentFunctionSourcePins.map(([path,hash])=>{
  const text=read(path);assert.equal(digest(text),hash,`Current function source changed: ${path}`);return text
 })
 const start='CREATE FUNCTION private.ihr_leave_require_director()'
 const end='CREATE FUNCTION public.leave_director_calendar_context_v1('
 assert.equal(director.split(start).length,2);assert.equal(director.split(end).length,2)
 const declarations=director.slice(director.indexOf(start),director.indexOf(end))
 assert.equal((declarations.match(/CREATE FUNCTION private\./g)||[]).length,2)
 for(const [signature,hash] of helperPins){
  const name=signature.split('(')[0]
  const body=declarations.slice(declarations.indexOf(`CREATE FUNCTION ${name}(`)).match(/AS \$\$([\s\S]*?)\$\$;/)?.[1]
  assert.equal(digest(body??''),hash,`Director helper extraction changed: ${name}`)
 }
 const revoke='REVOKE ALL ON FUNCTION private.ihr_leave_require_director(),private.ihr_leave_director_target(uuid) FROM PUBLIC,anon,authenticated,service_role;'
 assert.equal(director.split(revoke).length,2)
 const pins=helperPins.map(([sig,hash,language,result])=>`('${sig}','${hash}','${language}','${result}')`).join(',\n')
 const helpers=`BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
${guard}
DO $absent$ BEGIN
 IF to_regprocedure('private.ihr_leave_require_director()') IS NOT NULL OR to_regprocedure('private.ihr_leave_director_target(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Director helpers must be absent from the fixed synthetic baseline';
 END IF;
END $absent$;
${declarations}${revoke}
DO $postimage$ DECLARE pin record;p record; BEGIN
 FOR pin IN SELECT * FROM (VALUES ${pins}) AS v(signature,body_hash,language,result_type) LOOP
  SELECT pro.*,l.lanname INTO STRICT p FROM pg_proc pro JOIN pg_language l ON l.oid=pro.prolang WHERE pro.oid=to_regprocedure(pin.signature);
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>pin.body_hash
   OR p.proowner<>'postgres'::regrole OR p.lanname<>pin.language
   OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR p.prokind<>'f' OR p.proretset OR p.pronargdefaults<>0 OR p.procost<>100 OR p.prorows<>0
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
   OR pg_get_function_result(p.oid)<>pin.result_type
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'Director helper postimage drift: %',pin.signature;
  END IF;
 END LOOP;
END $postimage$;
COMMIT;`
 return {guard,sj,helpers}
}
export function installReturnCurrentFunctions({read,run,verify}){
 const built=buildReturnCurrentFunctions({read})
 verify();run(built.guard);verify();run(built.sj);verify();run(built.helpers);verify()
}
