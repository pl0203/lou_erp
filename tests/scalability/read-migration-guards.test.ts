// @vitest-environment node
import { readFileSync,readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect,test } from 'vitest'
import { buildReadMigrationGuardTests } from './read-migration-guards.mjs'
const source=readFileSync('supabase/migrations/202610010007_read_policy_plans.sql','utf8')
test('negative guard tests execute exact preflight only, never migration COMMIT or policy changes',()=>{
 const packet=buildReadMigrationGuardTests(source)
 expect(packet.match(/^BEGIN;$/gm)).toHaveLength(5);expect(packet.match(/^ROLLBACK;$/gm)).toHaveLength(5)
 expect(packet).not.toMatch(/^COMMIT;$/m);expect(packet).not.toContain('ALTER POLICY pilot_po_visibility')
 expect(packet.match(/READ_MIGRATION_DRIFT_REJECTED/g)).toHaveLength(5)
 expect(packet).toContain('SELECT pg_temp.scale_assert_contract();')
 expect(()=>buildReadMigrationGuardTests(source+'\nCOMMIT;')).toThrow()
})
test('rejected experiments are absent from automatic deployable migration discovery',()=>{
 const files=readdirSync('supabase/migrations')
 expect(files.filter(f=>f.startsWith('202610'))).toEqual(['202610010001_scalable_order_reads.sql','202610010002_scalable_report_reads.sql','202610010004_scalable_order_lookup_index.sql','202610010007_read_policy_plans.sql','202610010008_customer_delivery_aggregation.sql','202610010009_sales_page_enrichment.sql','202610010010_nullable_catalog_prices.sql'])
 expect(source).not.toContain('DROP INDEX')
 expect(source).toContain('Rejected experimental child-index state requires separate review')
})
test('final policy matrix retains independent literal role/state/write expectations',()=>{
 const historical=readFileSync('tests/database/parent-set-parity.sql','utf8')
 const final=readFileSync('tests/database/scalable-policy-state.sql','utf8')
 const core=historical.slice(historical.indexOf('CREATE TEMP TABLE parent_set_parity_actors'),historical.indexOf("SELECT pg_temp.parent_set_capture_phase('baseline');"))
 expect(final).toContain(core);expect(final).not.toContain('ALTER POLICY');expect(final).not.toContain('apply_parent_set_policy')
 expect(final).toContain("phase='candidate')<>620");expect(final).toContain('FINAL_READ_POLICY_ROLLBACK_VERIFIED')
})

test('entry source hashes match the preserved migration function bodies',()=>{
 for(const [file,names] of [
  ['supabase/migrations/202609300001_pilot_security.sql',['public.current_user_role','private.pilot_can_read_po','private.pilot_can_access_actor']],
  ['supabase/migrations/202610010002_scalable_report_reads.sql',['public.pilot_athel_summary_v1']],
 ] as const){
  const original=readFileSync(file,'utf8')
  for(const name of names){
   const start=original.indexOf('FUNCTION '+name+'(')
   expect(start).toBeGreaterThanOrEqual(0)
   const bodyStart=original.indexOf('AS $$',start)+5
   const body=original.slice(bodyStart,original.indexOf('$$;',bodyStart))
   expect(source).toContain(createHash('md5').update(body).digest('hex'))
  }
 }
})
