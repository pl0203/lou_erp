// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
const sql=readFileSync('tests/database/co/import-posting.sql','utf8')
const body=sql.split('DO $legacy_effective_seed_acceptance$')[1].split('END $legacy_effective_seed_acceptance$;')[0]
test('retained legacy fixture establishes canonical evidence before opening an editable draft',()=>{
 const beforeDraft=body.split('d:=co_test.report_init(c,m);')[0]
 expect(beforeDraft.includes('legacy_replay:=private.co_replay_v1(private.co_sources_v1(c));')).toBe(true)
 expect(beforeDraft).toContain('INSERT INTO private.co_stock_movements(')
 expect(beforeDraft).toContain('INSERT INTO private.co_sale_allocations(')
 expect(beforeDraft).toContain("PERFORM co_test.assert(private.co_evidence_matches_v1(c,legacy_replay),'synthetic legacy evidence matches canonical source replay');")
 expect(beforeDraft).toContain("legacy_replay->'issues'->0->>'code'='CO_REPORT_INCOMPLETE'")
 expect(beforeDraft).toContain("legacy_replay->'issues'->0->>'stock_key_id'=new_key::text")
 expect(beforeDraft).not.toMatch(/DISABLE|session_replication_role|CREATE OR REPLACE|['"]can_post['"]/)
})
