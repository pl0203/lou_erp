// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
const source=readFileSync('tests/database/co/import-races.mjs','utf8')
test('synthetic payload builders execute in fixture-owner setup, not authenticated race sessions',()=>{
 expect(source.includes("const fixtureTxn = body => `BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); ${body}; COMMIT;`")).toBe(true)
 expect(source).toContain('start(fixtureTxn(`SELECT co_test.import_post_payload(')
 expect(source).toContain('start(fixtureTxn(`SELECT co_test.import_review_payload(')
 expect(source).not.toMatch(/txn\(`SELECT co_test\./)
 expect(source).not.toMatch(/GRANT\s+(?:USAGE|ALL|EXECUTE)/)
 expect(source).toContain('SET LOCAL ROLE authenticated;')
 expect(source).toContain('gate(auth()+commit(p)), retry=start(txn(commit(p)))')
 expect(source).toContain('reviewOther=start(txn(reviewCall(randomUUID()),2))')
})
