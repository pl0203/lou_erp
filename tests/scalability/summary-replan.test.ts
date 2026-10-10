// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { extractSummaryStatement } from './query-plan-packets.mjs'
const original=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
test('summary preserves original joins and uses only fixed typed parameter execution',()=>{
 const candidate=readFileSync('supabase/migrations/202610010007_read_policy_plans.sql','utf8')
 const actual=candidate.match(/EXECUTE \$summary_query\$\n([^]*?)\n\$summary_query\$ INTO result USING p_from,p_to,p_rolling_from,p_status,p_fulfillment;/)?.[1]
 const expected=extractSummaryStatement(original)
 expect(actual).toBe(expected)
 expect(candidate).toContain("LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$")
 expect(candidate).toContain('PERFORM private.pilot_report_dates_v1(p_from,p_to,p_rolling_from,p_status,p_fulfillment);')
 expect(actual).not.toMatch(/\b(?:format\(|SET plan_cache_mode)\b/i)
})
test('diagnostic source extraction uses the fixed replacement statement rather than stale baseline',()=>{
 const candidate=readFileSync('supabase/migrations/202610010007_read_policy_plans.sql','utf8')
 expect(extractSummaryStatement(candidate)).not.toContain('l.purchase_order_id=ANY(ARRAY(SELECT id FROM pos))')
 expect(extractSummaryStatement(candidate)).not.toContain('d.surat_jalan_id=ANY(ARRAY(SELECT id FROM headers))')
 const fixture=readFileSync('tests/database/scalable-summary-parity.sql','utf8')
 const baseline=original.match(/CREATE FUNCTION public\.pilot_athel_summary_v1\([^]*?END \$\$;/)?.[0]
 expect(fixture).toContain(baseline!.replace('public.pilot_athel_summary_v1','pg_temp.baseline_summary'))
})
