import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const path = 'supabase/catalogue/v1/05-reads.sql'
const sql = existsSync(path) ? readFileSync(path, 'utf8') : ''
test('page SQL uses invoker/RLS, empty search path, text counts/versions and deterministic id order', () => {
 expect(sql).toMatch(/FUNCTION public\.pilot_catalog_page_v1\([\s\S]*?STABLE SECURITY INVOKER SET search_path = ''/)
 expect(sql).toContain('public.current_user_role()'); expect(sql).toContain('auth.uid()'); expect(sql).not.toMatch(/SECURITY DEFINER|SELECT\s+\*|to_jsonb\([cp]\)/i)
 expect(sql).toContain('catalog_version::text'); expect(sql).toContain('total_count::text'); expect(sql.match(/ORDER BY [cp]\.id/g)?.length).toBeGreaterThanOrEqual(2)
 expect(sql).not.toMatch(/CREATE POLICY|ALTER POLICY|DISABLE ROW LEVEL SECURITY|GRANT\s+SELECT/i)
 expect(sql).toContain("REVOKE ALL ON FUNCTION public.pilot_catalog_page_v1(text,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated, service_role")
 expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.pilot_catalog_page_v1(text,text,text,text,integer,integer) TO authenticated')
})
test('page SQL refuses null/invalid purposes, status and pagination instead of defaulting', () => {
 for (const value of ['enabled-for-order', 'all-for-history', 'catalogue', 'enabled', 'disabled']) expect(sql).toContain(`'${value}'`)
 expect(sql).toContain('p_page_size > 250'); expect(sql).toContain('p_page < 1'); expect(sql).toContain('p_page IS NULL'); expect(sql).toContain('p_search IS NULL'); expect(sql).toContain('ERRCODE = \'22023\'')
})
