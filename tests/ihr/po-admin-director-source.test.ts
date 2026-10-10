// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const migration = 'supabase/migrations/202610081001_ihr_po_admin_director.sql'
test('PO Admin director routing is an additive migration across all four authority boundaries', () => {
  expect(existsSync(migration), 'forward route migration is required').toBe(true)
  const sql = readFileSync(migration, 'utf8')
  for (const name of ['ihr_leave_is_approver', 'ihr_leave_guard_approver', 'ihr_leave_set_approver', 'ihr_leave_assignment_active']) {
    expect(sql).toContain(`CREATE OR REPLACE FUNCTION private.${name}(`)
  }
  expect(sql.match(/CREATE OR REPLACE FUNCTION /g)).toHaveLength(5)
  expect(sql).toContain('CREATE OR REPLACE FUNCTION public.leave_admin_setup_v1(')
  expect(sql.match(/role\s*=\s*'po_admin'/g)).toHaveLength(5)
  expect(sql).toContain('AFTER UPDATE OF is_active, role ON public.users')
  expect(sql).not.toMatch(/GRANT |CREATE TABLE|INSERT INTO public\.users|UPDATE public\.users|INSERT INTO public\.ihr_leave_access_grants/)
  expect(sql.trim()).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;$/)
})

test('CI loads the new route only after the immutable baseline and runs actual role regression SQL', () => {
  const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
  expect(workflow).toContain(`psql -X -v ON_ERROR_STOP=1 -f ${migration}`)
  expect(workflow).toContain('tests/database/ihr/po-admin-director.sql')
  expect(workflow).toContain('IHR_PO_ADMIN_DIRECTOR_APPROVAL_CANCELLATION_PASSED')
  const deployment=JSON.parse(readFileSync('vercel.json','utf8')).git.deploymentEnabled
  expect(deployment['fix/po-admin-director']).toBe(false)
  expect(deployment['fix/pilot-database']).toBe(true)
})

test('all PO Admin SQL fixture identifiers are complete UUIDs', () => {
  const sql = readFileSync('tests/database/ihr/po-admin-director.sql', 'utf8')
  for (const [quoted] of sql.matchAll(/'[0-9a-f]{8}-[0-9a-f-]+'/g)) {
    expect(quoted).toMatch(/^'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}'$/)
  }
})
