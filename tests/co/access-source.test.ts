// @vitest-environment node
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
test('access stage adds reviewed boundary migration and HR immutable fingerprints', () => {
 expect(existsSync('supabase/migrations/20261009110007_co_access.sql')).toBe(true)
 const runner=readFileSync('scripts/test-co-ci.mjs','utf8')
 for(const name of ['public.ihr_leave_members','public.ihr_leave_accounts','public.ihr_leave_ledger','public.ihr_leave_requests','public.ihr_leave_approvers','private.ihr_leave_cancellation_decisions']) expect(runner).toContain(`'${name}'`)
 expect(runner).toContain('CO_ACCESS_BOUNDARIES_PASSED'); expect(runner).toContain('CO_HR_PRESERVATION_PASSED')
})
test('one centralized role home and executive-only CO provisioning',()=>{
 for(const path of ['src/pages/Login.tsx','src/components/ProtectedRoute.tsx']) expect(readFileSync(path,'utf8')).toContain("navigationModules'")
 expect(readFileSync('supabase/functions/invite-user/index.ts','utf8')).toMatch(/const allowedRoles = \[[^\n]*'co_admin'/)
 expect(readFileSync('supabase/functions/invite-user/index.ts','utf8')).not.toMatch(/const managerRoles = \[[^\n]*'co_admin'/)
})

test('every historical HR business table is included in immutable preservation evidence',()=>{const runner=readFileSync('scripts/test-co-ci.mjs','utf8');const tables=readdirSync('supabase/migrations').filter(name=>name.includes('_ihr_')).flatMap(name=>[...readFileSync(`supabase/migrations/${name}`,'utf8').matchAll(/CREATE TABLE(?: IF NOT EXISTS)? ((?:public|private)\.ihr_\w+)/gi)].map(match=>match[1]));expect(new Set(tables).size).toBe(28);for(const table of tables)expect(runner).toContain(`'${table}'`)})
