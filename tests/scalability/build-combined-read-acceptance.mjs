import { mkdirSync,writeFileSync } from 'node:fs'
import { buildCombinedAcceptancePackets } from './can-read-po-experiment.mjs'
if(process.argv.length!==4||process.argv[2]!=='--rows')throw new Error('Use --rows 6000 or --rows 30000')
const packets=buildCombinedAcceptancePackets(Number(process.argv[3])),root='scale-results/combined-read-acceptance/'
mkdirSync(root,{recursive:true})
for(const [name,sql] of Object.entries(packets))writeFileSync(root+name+'.sql',sql,{flag:'wx'})
