// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
const old=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
const candidate=readFileSync('supabase/migrations/202610010008_customer_delivery_aggregation.sql','utf8')
test('customer report changes only equivalent per-shipment delivery preaggregation',()=>{
 const definition=old.match(/CREATE FUNCTION public\.pilot_customer_performance_v1\([^]*?END \$\$;/)![0]
 const transformed=definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
 .replace(' sales AS (SELECT p.customer_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value',` delivery_values AS MATERIALIZED (SELECT d.surat_jalan_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value FROM public.sj_line_items d JOIN public.po_line_items l ON l.id=d.po_line_item_id GROUP BY d.surat_jalan_id),
 sales AS (SELECT p.customer_id,sum(d.value) AS value`)
 .replace('JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN public.po_line_items l ON l.id=d.po_line_item_id','JOIN delivery_values d ON d.surat_jalan_id=s.id')
 expect(candidate).toContain(transformed)
 expect(candidate).not.toMatch(/ALTER POLICY|CREATE INDEX|GRANT |REVOKE |SECURITY DEFINER/)
 expect(candidate).toContain("md5(prosrc)='76897aa310b4c4c606c5ab2ca8ea3b7c'")
})

test('SQL parity oracle contains the untouched baseline and independent cross-period facts',()=>{
 const fixture=readFileSync('tests/database/scalable-customer-parity.sql','utf8')
 const definition=old.match(/CREATE FUNCTION public\.pilot_customer_performance_v1\([^]*?END \$\$;/)![0]
 expect(fixture).toContain(definition.replace('public.pilot_customer_performance_v1','pg_temp.baseline_customer'))
 expect(fixture).toContain("(item->>'total_sales')::numeric<>40")
 expect(fixture).toContain("(item->>'order_count')::integer<>1")
 expect(fixture).toContain("(item->>'actual_visits')::integer<>2")
 expect(fixture).toContain("(item->>'sales_target')::numeric<>20")
 expect(fixture).toContain('SCALABLE_CUSTOMER_PARITY_VERIFIED')
})
