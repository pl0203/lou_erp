// @vitest-environment node
import { expect,test,vi } from 'vitest'
import { isExpectedImportRefusal,runPoImportCi } from '../scripts/test-po-import-ci.mjs'
const env={PATH:'/usr/bin:/bin',PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres',PGPASSWORD:'synthetic-only',SCALE_PERMIT:'disposable-pilot-ci',SCALE_ROWS:'6000',GITHUB_ACTIONS:'true',CI:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_RUN_ID:'123'}
for(const patch of [{PGHOST:'hosted.invalid'},{PGDATABASE:'postgres'},{SCALE_PERMIT:''},{GITHUB_ACTIONS:'false'},{CI:'false'},{GITHUB_REPOSITORY:'someone/else'},{GITHUB_RUN_ID:''}])test(`import companion setup refuses unsafe target before execution ${JSON.stringify(patch)}`,async()=>{
 const execute=vi.fn();await expect(runPoImportCi({env:{...env,...patch},execute})).rejects.toThrow();expect(execute).not.toHaveBeenCalled()
})
test('only exact expected SQLSTATE and full refusal message count as a negative-test pass',()=>{
 expect(isExpectedImportRefusal('ERROR:  P0001: Schema fingerprint changed\nCONTEXT: test','Schema fingerprint changed')).toBe(true)
 expect(isExpectedImportRefusal('psql:packet.sql:12: ERROR:  P0001: Schema fingerprint changed\n','Schema fingerprint changed')).toBe(true)
 expect(isExpectedImportRefusal('ERROR:  42501: Schema fingerprint changed\n','Schema fingerprint changed')).toBe(false)
 expect(isExpectedImportRefusal('ERROR:  P0001: Schema fingerprint changed unexpectedly\n','Schema fingerprint changed')).toBe(false)
 expect(isExpectedImportRefusal("ERROR:  42501: unrelated\nDETAIL: 'ERROR: P0001: Schema fingerprint changed\n'",'Schema fingerprint changed')).toBe(false)
})
