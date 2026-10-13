// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const migration='supabase/migrations/202610021008_ihr_leave_context.sql'
test('final context removes only the obsolete schema sentinel and uses real merged blockers',()=>{
 expect(existsSync(migration),'additive final-context migration is required').toBe(true)
 const sql=readFileSync(migration,'utf8')
 expect(sql).toContain("blocker->>'code' IS DISTINCT FROM 'SCHEMA_NOT_READY'")
 expect(sql).toContain("blockers:=blockers||(readiness->'blockers')")
 expect(sql).toContain("coalesce((readiness->>'ready')::boolean,false) AND jsonb_array_length(blockers)=0")
 expect(sql).not.toContain("coalesce((result->'setup'->>'ready')::boolean,false)")
 expect(sql.match(/CREATE OR REPLACE FUNCTION /g)).toHaveLength(1)
 expect(sql).toContain('CREATE OR REPLACE FUNCTION public.leave_context_v1() RETURNS jsonb')
 expect(sql).toContain('STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp')
 expect(sql).toContain('actor uuid:=private.ihr_leave_require_actor()')
 expect(sql).not.toMatch(/GRANT |REVOKE |ALTER TABLE|CREATE TABLE|INSERT INTO|UPDATE public|DELETE FROM|set_config\(/)
})
test('exact-head CI loads the additive migration and parses actual PostgreSQL context output',()=>{
 const workflow=readFileSync('.github/workflows/pilot-safety.yml','utf8')
 expect(workflow).toContain(`psql -X -v ON_ERROR_STOP=1 -f ${migration}`)
 expect(readFileSync('tests/database/ihr/composed.sql','utf8')).toContain('\\ir context-contract.sql')
 expect(workflow).toContain('IHR_CONTEXT_CONTRACT_PATH=scale-results/ihr-context-contract.json')
 expect(workflow).toContain('tests/ihr/context-sql-output.test.ts')
})
