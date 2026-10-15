import { mkdirSync,writeFileSync } from 'node:fs'
import { buildHelperDailyDiagnostic,buildHelperExperiment } from './can-read-po-experiment.mjs'
if(process.argv.length!==2)throw new Error('Fixed daily diagnostic accepts no arguments')
const root='scale-results/helper-daily-diagnostic/',small=buildHelperExperiment()
mkdirSync(root,{recursive:true})
writeFileSync(root+'truth.sql',small.truth,{flag:'wx'})
for(const packet of small.policy)writeFileSync(root+packet.name+'.sql',packet.sql,{flag:'wx'})
for(const packet of buildHelperDailyDiagnostic().packets)writeFileSync(root+packet.name+'.sql',packet.sql,{flag:'wx'})
