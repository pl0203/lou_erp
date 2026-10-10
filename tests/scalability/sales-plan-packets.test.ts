// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { buildSalesPlanPackets,extractSalesStatement } from './sales-plan-packets.mjs'
const source=readFileSync('supabase/migrations/202610010001_scalable_order_reads.sql','utf8')
test('sales query extraction preserves full scope, nullable labels and typed six arguments',()=>{
 const sql=extractSalesStatement(source)
 expect(sql).toContain('LEFT JOIN public.customers c');expect(sql).toContain('LEFT JOIN public.users u')
 expect(sql).toContain('($5 IS NULL OR o.customer_id=$5)');expect(sql).toContain('($6 IS NULL OR o.visit_id=$6)')
 expect(sql).toContain('LIMIT $4 OFFSET ($3::bigint-1)*$4');expect(sql).not.toContain('INTO result')
 expect(sql).not.toMatch(/\bp_(?:status|own_only|page|page_size|customer_id|visit_id)\b/)
})
test('fixed five diagnostic packets preserve guards, source identity, real RLS and rollback',()=>{
 const p=buildSalesPlanPackets(source);expect(p).toHaveLength(5)
 for(const {sql} of p){expect(sql).toContain('BEGIN READ ONLY;');expect(sql).toContain("statement_timeout='60s'");expect(sql).toContain("IS DISTINCT FROM '30000'");expect(sql).toContain('md5(prosrc)');expect(sql).toContain("SET LOCAL ROLE authenticated");expect(sql).toContain("row_security_active(('public.'||t.name)::regclass)");expect(sql.indexOf('ROLLBACK;')).toBeLessThan(sql.indexOf('SALES_PLAN_DIAGNOSTIC_VERIFIED'))}
 expect(p.find(x=>x.name==='sales-inner-auto-sixth')!.sql.match(/EXPLAIN \(VERBOSE,COSTS\) EXECUTE sales_read/g)).toHaveLength(6)
 expect(p.filter(x=>x.name.startsWith('sales-rpc')).every(x=>x.sql.includes('=15007'))).toBe(true)
})
