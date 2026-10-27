// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
const sql=readFileSync('tests/database/co/workspace-reads.sql','utf8')
test('successful SJ fixture operations bind the current authoritative order version after delivery',()=>{
 const source=sql.split('DO $source_proposal_exact$')[1].split('END $source_proposal_exact$;')[0]
 const pages=sql.split('DO $a5_batch_pages_and_labels$')[1].split('END $a5_batch_pages_and_labels$;')[0]
 expect(source).not.toContain("'expected_co_version','1'")
 expect(pages).not.toContain("'expected_co_version','1'")
 expect((source.match(/'expected_co_version',\(SELECT version::text FROM private.co_orders WHERE id=o AND customer_id=c\)/g)||[])).toHaveLength(4)
 expect((pages.match(/'expected_co_version',\(SELECT version::text FROM private.co_orders WHERE id=first_co AND customer_id=c\)/g)||[])).toHaveLength(2)
 expect(source).toContain("'expected_delivery_version',source_version")
 expect(pages).toContain("'expected_delivery_version',hv")
})
