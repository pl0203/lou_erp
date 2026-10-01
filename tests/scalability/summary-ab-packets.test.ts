// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { buildSummaryAbPackets } from './summary-ab-packets.mjs'
const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
test('seven fixed packets isolate child indexes and statement replanning without ANY filters',()=>{
 const packets=buildSummaryAbPackets(source);expect(packets).toHaveLength(7)
 expect(packets.map(p=>p.name)).toEqual(['a-static-lookup-only-admin','a-static-lookup-only-manager','b-static-child-indexes-admin','b-static-child-indexes-manager','c-dynamic-child-indexes-admin','c-dynamic-child-indexes-manager','c-dynamic-child-indexes-admin-generic'])
 for(const p of packets){expect(p.sql).toContain("current_database()<>'pilot_test'");expect(p.sql).toContain("manifest->'base'->>'purchase_orders'");expect(p.sql).toContain('<>6000');expect(p.sql).toContain('row_security_active');expect(p.sql).toContain("statement_timeout='60s'");expect(p.sql).toContain('CREATE FUNCTION pg_temp.ab_summary');expect(p.sql).not.toContain('ANY(ARRAY(SELECT id FROM');expect(p.sql).not.toMatch(/\b(?:INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE|COMMIT)\b/);expect(p.sql.lastIndexOf('ROLLBACK;')).toBeLessThan(p.sql.lastIndexOf('SCALE_DIAGNOSTIC_VERIFIED'));expect(p.sql).toContain('Candidate child indexes must be restored')}
 for(const p of packets.slice(0,2)){expect(p.sql).toContain('DROP INDEX public.pilot_po_line_items_purchase_order_id_idx');expect(p.sql).toContain('DROP INDEX public.pilot_sj_line_items_surat_jalan_id_idx');expect(p.sql.indexOf('Disposable marker required')).toBeLessThan(p.sql.indexOf('DROP INDEX'));expect(p.sql).toContain('Unexpected child index contract')}
 expect(packets[6].sql).toContain("SET LOCAL plan_cache_mode='force_generic_plan'")
 const original=source.match(/CREATE FUNCTION public\.pilot_athel_summary_v1\([^]*?END \$\$;/)![0].replace('public.pilot_athel_summary_v1','pg_temp.ab_summary')
 for(const p of packets.slice(0,4))expect(p.sql).toContain(original)
 for(const p of packets.slice(2))expect(p.sql).not.toContain('DROP INDEX')
 for(const p of packets.slice(4))expect(p.sql).toContain('$ab_query$ INTO result USING p_from,p_to,p_rolling_from,p_status,p_fulfillment;')
})
