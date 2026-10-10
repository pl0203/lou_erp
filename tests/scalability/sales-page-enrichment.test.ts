// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
const candidate=readFileSync('supabase/migrations/202610010009_sales_page_enrichment.sql','utf8')
const old=readFileSync('supabase/migrations/202610010001_scalable_order_reads.sql','utf8')
test('sales matching keeps filters and count scope while nullable labels are bounded after page',()=>{
 const matching=candidate.slice(candidate.indexOf('WITH matching AS MATERIALIZED'),candidate.indexOf('), page_rows AS MATERIALIZED'))
 expect(matching).not.toContain('JOIN public.customers');expect(matching).not.toContain('JOIN public.users')
 const oldFilters=old.match(/WHERE \(p_status='all' OR o.status=p_status\)[^]*?AND \(p_visit_id IS NULL OR o.visit_id=p_visit_id\)/)![0]
 expect(matching).toContain(oldFilters)
 expect(candidate).toContain('SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size')
 expect(candidate).toContain('FROM page_rows p LEFT JOIN public.customers c ON c.id=p.customer_id LEFT JOIN public.users u ON u.id=p.submitted_by')
 expect(candidate).toContain("'total',(SELECT count(*) FROM matching)")
 expect(candidate).not.toMatch(/ALTER POLICY|GRANT |REVOKE |SECURITY DEFINER|EXECUTE \$/)
 expect(candidate).toContain('Label relation primary-key contract drift')
 expect(candidate).toContain('pg_get_function_arguments(oid) AS canonical_arguments')
 expect(candidate).not.toContain('proargdefaults::text')
})

test('exact baseline and independent hidden-label/tie/empty-page oracles are retained',()=>{
 const baseline=old.match(/CREATE FUNCTION public\.pilot_sales_order_page_v1\([^]*?END \$\$;/)![0]
 const fixture=readFileSync('tests/database/scalable-sales-page-parity.sql','utf8')
 expect(fixture).toContain(baseline.replace('public.pilot_sales_order_page_v1','pg_temp.baseline_sales'))
 expect(fixture).toContain("item->'customers' IS DISTINCT FROM 'null'::jsonb")
 expect(fixture).toContain("item->'users' IS DISTINCT FROM 'null'::jsonb")
 expect(fixture).toContain('Stable tie sort oracle failed')
 expect(fixture).toContain('Empty page lost exact total')
 expect(fixture).toContain('SCALABLE_SALES_PAGE_PARITY_VERIFIED')
})
