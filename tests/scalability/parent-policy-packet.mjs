import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSummaryDPackets } from './summary-ab-packets.mjs'
const snapshots={
 columns_before:"SELECT md5(jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum)::text) AS columns_before FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped",
 policy_before:"SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY schemaname,tablename,policyname),'[]'::jsonb)::text) AS policy_before FROM pg_policies x WHERE schemaname IN ('public','storage')",
 functions_before:"SELECT md5(jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl) ORDER BY p.oid)::text) AS functions_before FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')",
 grants_before:"SELECT md5(jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)::text) AS grants_before FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'",
 constraints_before:"SELECT md5(jsonb_agg(jsonb_build_array(c.oid,pg_get_constraintdef(c.oid)) ORDER BY c.oid)::text) AS constraints_before FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'",
}
export function buildParentPolicyPackets(source,setup,parity){
 if(!setup.includes('PARENT_SET_DRIFT_GUARD_VERIFIED')||!parity.includes('PARENT_SET_POLICY_PARITY_VERIFIED'))throw new Error('Reviewed setup and parity fragments required')
 if(/^\s*COMMIT\s*;/m.test(setup+'\n'+parity))throw new Error('Trial fragments may not commit')
 const base=buildSummaryDPackets(source).find(p=>p.name==='d-dynamic-lookup-only-admin')
 let prefix=base.sql.split('SET LOCAL ROLE authenticated;')[0]
 const capture=Object.values(snapshots).map(query=>query+'\n\\gset\n').join('')
 // Capture after disposable guard, before any candidate index or policy mutation.
 prefix=prefix.replace('DROP INDEX public.pilot_po_line_items_purchase_order_id_idx;',()=>capture+'DROP INDEX public.pilot_po_line_items_purchase_order_id_idx;')
 function benchmarks(phase){return ['admin','manager'].map(role=>{
  const actor=role==='admin'?'84000000-0000-0000-0000-000000000006':'84000000-0000-0000-0000-000000000002'
  const expectedRole=role==='admin'?'po_admin':'sales_manager',from=role==='admin'?'2021-01-01':'2026-07-01'
  const totals=role==='admin'?'6007,6000600,3000180,3000420':'756,750500,375130,375370'
  return `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${actor}',true);
DO $$ BEGIN IF NOT row_security_active('public.purchase_orders') OR NOT row_security_active('public.po_line_items') OR NOT row_security_active('public.surat_jalan') OR NOT row_security_active('public.sj_line_items') OR public.current_user_role()::text IS DISTINCT FROM '${expectedRole}' THEN RAISE EXCEPTION 'Benchmark role/RLS mismatch'; END IF; END $$;
SELECT '${phase}-${role}' AS diagnostic,clock_timestamp() AS started_at;
EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) SELECT pg_temp.assert_d_totals(pg_temp.ab_summary('${from}','2026-09-30','2025-10-01','all','all'),${totals});
RESET ROLE;
`
 }).join('')}
 const restored=base.sql.slice(base.sql.lastIndexOf('ROLLBACK;')+'ROLLBACK;'.length).replace(/SELECT 'SCALE_DIAGNOSTIC_VERIFIED' AS result,[^\n]+\n/g,'')
 const checks=Object.entries(snapshots).map(([name,query])=>`SELECT 1 / CASE WHEN (${query}) = :'${name}' THEN 1 ELSE 0 END AS ${name}_restored;\n`).join('')
 const emptyCheck=`DO $empty$ DECLARE t text; n bigint; BEGIN
 IF current_database()<>'pilot_test' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') OR to_regclass('public.pilot_scale_manifest') IS NOT NULL THEN RAISE EXCEPTION 'Empty synthetic database required'; END IF;
 IF (SELECT count(*) FROM auth.users)<>0 OR (SELECT count(*) FROM storage.objects)<>0 OR (SELECT count(*) FROM private.pilot_order_requests)<>0 THEN RAISE EXCEPTION 'Empty synthetic database required'; END IF;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'pilot_fixture_marker' LOOP EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n; IF n<>0 THEN RAISE EXCEPTION 'Empty synthetic database required'; END IF; END LOOP;
END $empty$;
`
 const seed=`SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT ('84000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,8)i;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT ('84000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Synthetic policy actor '||i,'policy-actor-'||i||'@example.invalid',(CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' ELSE 'executive' END)::public.user_role,i<>8,CASE i WHEN 4 THEN '84000000-0000-0000-0000-000000000002'::uuid WHEN 5 THEN '84000000-0000-0000-0000-000000000003'::uuid END FROM generate_series(1,8)i;
SET LOCAL session_replication_role='origin';
`
 const small="BEGIN;\nSET LOCAL statement_timeout='60s';\nSET LOCAL lock_timeout='5s';\nSET LOCAL pilot.policy_trial_mode='parity';\n"+emptyCheck+capture+seed+setup+'\n'+parity+'\nRESET ROLE;\nROLLBACK;\n'+checks+emptyCheck+"SELECT 'PARITY_ROLLBACK_EMPTY_VERIFIED' AS result;\nSELECT 'SCALE_DIAGNOSTIC_VERIFIED' AS result,'parent-set-parity' AS diagnostic;\n"
 const large=prefix+"SET LOCAL pilot.policy_trial_mode='benchmark';\n"+setup+'\n'+benchmarks('baseline')+'SELECT pg_temp.apply_parent_set_policy();\n'+benchmarks('candidate')+'SELECT pg_temp.assert_trial_preserved();\nROLLBACK;\n'+restored+checks+"SELECT 'SCALE_DIAGNOSTIC_VERIFIED' AS result,'parent-set-policy' AS diagnostic;\n"
 return {parity:small,benchmark:large}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic arguments accepted')
 const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
 const setup=readFileSync('tests/database/parent-set-policy-setup.sql','utf8')
 const parity=readFileSync('tests/database/parent-set-parity.sql','utf8')
 mkdirSync('scale-results/diagnostics',{recursive:true})
 const packets=buildParentPolicyPackets(source,setup,parity)
 writeFileSync('scale-results/policy-parity.sql',packets.parity,{flag:'wx'})
 writeFileSync('scale-results/diagnostics/parent-set-policy.sql',packets.benchmark,{flag:'wx'})
}
