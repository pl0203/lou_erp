// Fixed fictional companion only. The shared runner keeps every original bound,
// suite, race exit check and finally-restoration path.
import { runHelperRaceAcceptance } from './test-helper-races-ci.mjs'
import { combinedRaceStateSql,buildCombinedRaceLifecycle } from '../tests/scalability/can-read-po-experiment.mjs'
if(process.argv.length!==2)throw new Error('No custom combined race target or arguments accepted')
runHelperRaceAcceptance({evidenceDir:'scale-results/combined-read-races',stateSql:combinedRaceStateSql,buildLifecycle:buildCombinedRaceLifecycle,bodyField:'combined_source_md5'})
console.log('COMBINED_READ_CANDIDATE_RACE_ACCEPTANCE_VERIFIED')
