// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { extractSummaryStatement } from './query-plan-packets.mjs'
const original=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
test('summary changes only redundant parent filters and fixed typed parameter execution',()=>{
 const candidate=readFileSync('supabase/migrations/202610010006_scoped_summary_plan.sql','utf8')
 const actual=candidate.match(/EXECUTE \$summary_query\$\n([^]*?)\n\$summary_query\$ INTO result USING p_from,p_to,p_rolling_from,p_status,p_fulfillment;/)?.[1]
 const expected=extractSummaryStatement(original)
  .replace('JOIN pos p ON p.id=l.purchase_order_id),','JOIN pos p ON p.id=l.purchase_order_id WHERE l.purchase_order_id=ANY(ARRAY(SELECT id FROM pos))),')
  .replace('JOIN lines l ON l.id=d.po_line_item_id),','JOIN lines l ON l.id=d.po_line_item_id WHERE d.surat_jalan_id=ANY(ARRAY(SELECT id FROM headers))),')
 expect(actual).toBe(expected)
 expect(candidate).toContain("LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$")
 expect(candidate).toContain('PERFORM private.pilot_report_dates_v1(p_from,p_to,p_rolling_from,p_status,p_fulfillment);')
 expect(candidate).not.toMatch(/\b(?:GRANT|REVOKE|SECURITY DEFINER|format\(|SET plan_cache_mode)\b/i)
})
test('diagnostic source extraction uses the fixed replacement statement rather than stale baseline',()=>{
 const candidate=readFileSync('supabase/migrations/202610010006_scoped_summary_plan.sql','utf8')
 expect(extractSummaryStatement(candidate)).toContain('l.purchase_order_id=ANY(ARRAY(SELECT id FROM pos))')
 expect(extractSummaryStatement(candidate)).toContain('d.surat_jalan_id=ANY(ARRAY(SELECT id FROM headers))')
 const fixture=readFileSync('tests/database/scalable-summary-parity.sql','utf8')
 const baseline=original.match(/CREATE FUNCTION public\.pilot_athel_summary_v1\([^]*?END \$\$;/)?.[0]
 expect(fixture).toContain(baseline!.replace('public.pilot_athel_summary_v1','pg_temp.baseline_summary'))
})
