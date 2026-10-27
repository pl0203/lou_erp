// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
const probe=readFileSync('tests/database/co/import-install-failure.sql','utf8')
const snapshot=readFileSync('tests/database/co/import-install-snapshot.sql','utf8')
test('late probe requires the installed hook at the exact bare or current dispatcher target',()=>{
 expect(probe).toContain("PERFORM private.co_workspace_generation_guard_v1();")
 expect(probe).toContain("CASE WHEN to_regclass('private.catalog_cutover_v1') IS NULL")
 expect(probe).toContain("THEN 'public.pilot_co_transaction_v1(uuid,text,jsonb)'")
 expect(probe).toContain("ELSE 'private.catalog_co_legacy_transaction_v1(uuid,text,jsonb)'")
 expect(probe).toContain("position('co_import_publication_guard_v1' IN pg_get_functiondef(dispatcher))=0")
 expect(probe).toContain("USING ERRCODE='PZ603'")
 expect(probe).toContain("OR has_function_privilege('anon'")
 expect(probe).toContain("OR NOT has_function_privilege('authenticated'")
})
test('rollback snapshot covers catalogue bodies as well as original CO hooks',()=>{
 expect(snapshot).toContain("p.proname LIKE 'co_%' OR p.proname LIKE 'catalog_%'")
 expect(snapshot).toContain("'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner")
})
