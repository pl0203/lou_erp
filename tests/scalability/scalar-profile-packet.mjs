import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildParentPolicyPackets } from './parent-policy-packet.mjs'
export function buildScalarProfilePackets(source,parentSetup,scalarSetup,parity){
 if(!scalarSetup.includes('SCALAR_PROFILE_DRIFT_GUARD_VERIFIED'))throw new Error('Reviewed scalar setup required')
 const compared=parity.replaceAll('pg_temp.apply_parent_set_policy()','pg_temp.apply_scalar_profile_policy()').replaceAll('PARENT_SET_POLICY_PARITY_VERIFIED','SCALAR_PROFILE_POLICY_PARITY_VERIFIED')
 return buildParentPolicyPackets(source,parentSetup+'\n'+scalarSetup,compared,'scalar-profile')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom diagnostic arguments accepted')
 const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
 const parent=readFileSync('tests/database/parent-set-policy-setup.sql','utf8')
 const scalar=readFileSync('tests/database/scalar-profile-policy-setup.sql','utf8')
 const parity=readFileSync('tests/database/parent-set-parity.sql','utf8')
 const packets=buildScalarProfilePackets(source,parent,scalar,parity)
 mkdirSync('scale-results/diagnostics',{recursive:true})
 writeFileSync('scale-results/policy-parity.sql',packets.parity,{flag:'wx'})
 for(const p of packets.benchmarks)writeFileSync(`scale-results/diagnostics/${p.name}.sql`,p.sql,{flag:'wx'})
}
