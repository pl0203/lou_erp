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

test('unrelated additional SQL errors cannot satisfy an expected refusal',()=>{
 expect(isExpectedImportRefusal('ERROR:  42501: permission denied\nERROR:  P0001: Schema fingerprint changed\n','Schema fingerprint changed')).toBe(false)
})
test('category constraint failures require their exact SQLSTATE and constraint message',()=>{
 const message='new row for relation "customers" violates check constraint "customers_customer_category_check"'
 expect((isExpectedImportRefusal as any)(`ERROR:  23514: ${message}\n`,message,'23514')).toBe(true)
 expect((isExpectedImportRefusal as any)(`ERROR:  42501: ${message}\n`,message,'23514')).toBe(false)
})

test('psql connection errors cannot be hidden alongside an expected SQL refusal',()=>{
 expect(isExpectedImportRefusal('psql: error: connection refused\nERROR:  P0001: Schema fingerprint changed\n','Schema fingerprint changed')).toBe(false)
})
test('historical import companion includes only its reviewed pre-demo baseline migrations', async () => {
 const { selectImportBaselineMigrations } = await import('../scripts/test-po-import-ci.mjs')
 expect(selectImportBaselineMigrations(['202610081101_demo_order_promotions.sql','202610081102_demo_visit_workflow.sql','202610081103_demo_sales_reporting.sql','202610081104_demo_sales_assignment_cardinality.sql','202610081001_ihr_po_admin_director.sql','202610021008_ihr_leave_context.sql','202609300001_pilot_security.sql'])).toEqual(['202609300001_pilot_security.sql','202610021008_ihr_leave_context.sql','202610081001_ihr_po_admin_director.sql'])
})
