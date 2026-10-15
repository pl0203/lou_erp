import { mkdirSync,writeFileSync } from 'node:fs'
import { buildHelperAcceptancePackets } from './can-read-po-experiment.mjs'
if(process.argv.length!==4||process.argv[2]!=='--rows')throw new Error('Use --rows 6000 or --rows 30000')
const packets=buildHelperAcceptancePackets(Number(process.argv[3])),root='scale-results/helper-acceptance/'
mkdirSync(root,{recursive:true})
for(const [name,sql] of Object.entries(packets))writeFileSync(root+name+'.sql',sql,{flag:'wx'})
