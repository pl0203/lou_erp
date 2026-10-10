// @vitest-environment node
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {expect,test} from 'vitest'
import {buildStalePOConflictPacket} from '../scripts/build-stale-po-conflict-packet.mjs'
import {buildStalePOConflictGuards} from './stale-po-conflict-guards.mjs'
const digest=(s:string)=>createHash('md5').update(s).digest('hex')
function snapshot(){
 return [
  ['202610010010_nullable_catalog_prices.sql','pilot_order_transaction','public.pilot_order_transaction(uuid,text,jsonb)',true,'v','p_request_id uuid, p_operation text, p_payload jsonb','p_request_id uuid, p_operation text, p_payload jsonb'],
  ['202610010001_scalable_order_reads.sql','pilot_po_lines_v1','public.pilot_po_lines_v1(uuid,integer,integer,timestamp with time zone)',false,'s','p_po_id uuid, p_page integer, p_page_size integer, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone','p_po_id uuid, p_page integer, p_page_size integer, p_expected_updated_at timestamp with time zone'],
 ].map(([file,name,signature,security,volatility,args,identity])=>{
  const source=readFileSync(`supabase/migrations/${file}`,'utf8')
  const body=source.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`))![1]
  const definition=`CREATE OR REPLACE FUNCTION ${signature} RETURNS jsonb LANGUAGE plpgsql AS $function$${body}$function$;`
  return {signature,security_definer:security,volatility,arguments:args,identity_arguments:identity,database:'postgres',operator:'postgres',present:true,source_md5:digest(body),owner:'postgres',language:'plpgsql',config:['search_path=""'],result:'jsonb',strict:false,parallel:'u',leakproof:false,custom_40001_raise_count:1,custom_PT409_raise_count:0,acl:['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres'],definition,definition_md5:digest(definition)}
 })
}
test('exact staging packet pins full observed metadata and retains one atomic source-only migration',()=>{
 const p=buildStalePOConflictPacket({preflight:snapshot(),expectedProjectRef:'mqfpupsuthghubkeiuey'})
 for(const sql of [p.apply,p.rollback]){expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);expect(sql).toContain('Exact reviewed staging function drift; refused');expect(sql).not.toContain('pg_terminate_backend');expect(sql).toContain('service_role=X/postgres')}
 expect(p.postcheck).toContain('BEGIN READ ONLY;');expect(p.postcheck).toContain('custom_PT409_raise_count')
 expect(p.rollback).toContain('reintroduces the known retry risk')
 expect(p.hashes.apply).toBe(createHash('sha256').update(p.apply).digest('hex'))
})
test.each(['production','other',''])('packet rejects unapproved destinations: %s',ref=>{
 expect(()=>buildStalePOConflictPacket({preflight:snapshot(),expectedProjectRef:ref})).toThrow()
})
test.each(['source_md5','owner','config','acl','security_definer','volatility','custom_40001_raise_count','definition_md5'])('packet refuses altered observed state: %s',key=>{
 const preflight=snapshot();(preflight[0] as any)[key]=key==='acl'?['postgres=X/postgres','anon=X/postgres']:null
 expect(()=>buildStalePOConflictPacket({preflight,expectedProjectRef:'mqfpupsuthghubkeiuey'})).toThrow()
})
test('CI guard tests reject authority drift without committing any change',()=>{
 const sql=buildStalePOConflictGuards(readFileSync('supabase/migrations/202610020003_stale_po_conflicts.sql','utf8'))
 expect(sql.match(/^BEGIN;$/gm)).toHaveLength(12);expect(sql.match(/^ROLLBACK;$/gm)).toHaveLength(12)
 expect(sql).not.toMatch(/^COMMIT;$/m);expect(sql).toContain('Rejected guard changed a function')
})
