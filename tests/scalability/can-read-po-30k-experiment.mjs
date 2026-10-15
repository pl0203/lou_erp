import { mkdirSync,writeFileSync } from 'node:fs'
import { buildHelper30kExperiment,buildHelperExperiment } from './can-read-po-experiment.mjs'
if(process.argv.length!==2)throw new Error('Fixed30k experiment accepts no arguments')
const packets=buildHelper30kExperiment(),root='scale-results/helper-30k-experiment/'
mkdirSync(root,{recursive:true})
const small=buildHelperExperiment()
writeFileSync(root+'truth.sql',small.truth,{flag:'wx'})
for(const packet of small.policy)writeFileSync(root+packet.name+'.sql',packet.sql,{flag:'wx'})
for(const packet of [...packets.warmups,...packets.benchmarks])writeFileSync(root+packet.name+'.sql',packet.sql,{flag:'wx'})
writeFileSync(root+'packet-order.json',JSON.stringify(Object.fromEntries(Object.entries(packets).map(([k,v])=>[k,v.map(p=>({name:p.name,rpc:p.rpc,variant:p.variant,warmup:p.warmup}))])),null,2),{flag:'wx'})
