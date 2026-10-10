// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { accessRewriteSignatures, buildAccessTopologyChecks } from '../database/co/access-topology.mjs'
const migration = readFileSync('supabase/migrations/20261009110007_co_access.sql','utf8')
// Exact final pre07 defining sources, independently of candidate pins.
const sources = [
  [
    "public.pilot_athel_summary_v1(date,date,date,text,text)",
    "supabase/migrations/202610010007_read_policy_plans.sql"
  ],
  [
    "public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer)",
    "supabase/migrations/202610010002_scalable_report_reads.sql"
  ],
  [
    "public.pilot_promotions_v1(boolean)",
    "supabase/migrations/202610081101_demo_order_promotions.sql"
  ],
  [
    "public.pilot_promotion_image_v1(uuid)",
    "supabase/migrations/202610081101_demo_order_promotions.sql"
  ],
  [
    "public.pilot_promotion_transaction_v1(uuid,text,jsonb)",
    "supabase/migrations/202610081101_demo_order_promotions.sql"
  ],
  [
    "public.pilot_reconcile_promotion_v1(uuid,boolean)",
    "supabase/migrations/202610081101_demo_order_promotions.sql"
  ],
  [
    "public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid)",
    "supabase/migrations/202610010009_sales_page_enrichment.sql"
  ],
  [
    "public.pilot_customer_stats_v1(uuid[],date,integer)",
    "supabase/migrations/202610010002_scalable_report_reads.sql"
  ],
  [
    "public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer)",
    "supabase/migrations/202610081103_demo_sales_reporting.sql"
  ],
  [
    "public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer)",
    "supabase/migrations/20261009061801_unify_store_owner_credit.sql"
  ],
  [
    "public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer)",
    "supabase/migrations/202610081103_demo_sales_reporting.sql"
  ],
  [
    "public.pilot_sales_report_months_v1(uuid)",
    "supabase/migrations/20261009061801_unify_store_owner_credit.sql"
  ],
  [
    "public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz)",
    "supabase/migrations/202610081103_demo_sales_reporting.sql"
  ],
  [
    "public.pilot_manager_customers_v1(uuid,timestamptz,timestamptz,integer,integer)",
    "supabase/migrations/20261009061801_unify_store_owner_credit.sql"
  ],
  [
    "public.pilot_store_po_context_v1(uuid,integer,integer)",
    "supabase/migrations/202610081102_demo_visit_workflow.sql"
  ],
  [
    "private.pilot_admin_sales_source_v1(timestamptz,timestamptz)",
    "supabase/migrations/20261009061801_unify_store_owner_credit.sql"
  ],
  [
    "private.pilot_canonical_sales_source_v1(timestamptz,timestamptz)",
    "supabase/migrations/20261009061801_unify_store_owner_credit.sql"
  ],
  [
    "private.pilot_admin_sales_start_v1(uuid)",
    "supabase/migrations/20261009061801_unify_store_owner_credit.sql"
  ],
  [
    "private.pilot_performance_scope_v1(uuid,text)",
    "supabase/migrations/202610010002_scalable_report_reads.sql"
  ],
  [
    "public.pilot_po_page_v1(text,text,integer,integer)",
    "supabase/migrations/202610010001_scalable_order_reads.sql"
  ],
  [
    "public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)",
    "supabase/migrations/202610081101_demo_order_promotions.sql"
  ],
  [
    "public.pilot_order_transaction(uuid,text,jsonb)",
    "supabase/migrations/202610081101_demo_order_promotions.sql"
  ],
  [
    "public.pilot_reconcile_request(uuid,boolean)",
    "supabase/migrations/202610081101_demo_order_promotions.sql"
  ]
] as const

test('all 23 textual replacements are bound to exact reviewed pre07 bodies and executable entry spans',()=>{
 const pins = new Map([...migration.matchAll(/\('([^']+)','(?:executive|sales|not_co|order|recovery)','([a-f0-9]{64})',(\d+)\)/g)].map(match=>[match[1],{hash:match[2],entry:Number(match[3])}]))
 expect([...pins.keys()].sort()).toEqual([...accessRewriteSignatures].sort())
 for(const [signature,file] of sources){
  const source=readFileSync(file,'utf8')
  const start=source.indexOf('FUNCTION '+signature.split('(')[0]+'(')
  expect(start).toBeGreaterThanOrEqual(0)
  const from=source.indexOf('AS $$',start)+5, until=source.indexOf('$$;',from)
  const body=source.slice(from,until),pin=pins.get(signature)!
  expect(createHash('sha256').update(body).digest('hex'),signature).toBe(pin.hash)
  const span=signature.includes('pilot_order_transaction(')||signature.includes('pilot_reconcile_request(')?'role:=private.demo_order_actor();':'BEGIN'
  expect(body.slice(pin.entry-1,pin.entry-1+span.length),signature).toBe(span)
  if(signature.includes('pilot_reconcile_request('))expect(body.slice(502,515)).toBe('IF FOUND THEN')
 }
 expect(migration).toContain('Unreviewed access function body: %')
 expect(migration).not.toContain("regexp_replace(definition,E'\\\\mBEGIN")
})
test('negative packet uses the actual candidate, legal comment drift and rollback, then checks known executable guard',()=>{
 const packet=buildAccessTopologyChecks(migration)
 expect(accessRewriteSignatures).toHaveLength(23)
 expect(packet).toContain('/* BEGIN records the routine entry marker. */')
 expect(packet).toContain('/* outer /* BEGIN nested entry marker */ comment */')
 expect(packet).toContain('Unreviewed trailing body drift')
 expect(packet).toContain('Fixture changed owner/security/volatility/config/ACL')
 expect(packet).toContain('Normal rewrite changed owner/security/volatility/config/ACL')
 expect(packet).toContain('Known-body guard was not executable for PO')
 expect(packet).toContain('ROLLBACK;')
 expect(packet).not.toMatch(/^COMMIT;$/m)
 expect(()=>buildAccessTopologyChecks(migration+'\nCOMMIT;')).toThrow()
})
