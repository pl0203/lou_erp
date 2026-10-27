// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
const migration='supabase/migrations/202610020003_stale_po_conflicts.sql'
const sources=[['202610010001_scalable_order_reads.sql','pilot_po_lines_v1'],['202610010010_nullable_catalog_prices.sql','pilot_order_transaction']] as const
test('additive conflict migration pins both effective bodies and changes only their exact custom stale raise',()=>{
 const sql=readFileSync(migration,'utf8')
 for(const [file,name] of sources){
  const source=readFileSync(`supabase/migrations/${file}`,'utf8')
  const body=source.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`))![1]
  expect(body.match(/ERRCODE='40001'/g)).toHaveLength(1)
  const changed=body.replace("ERRCODE='40001'","ERRCODE='PT409'")
  expect(sql).toContain(createHash('md5').update(body).digest('hex'))
  expect(sql).toContain(createHash('md5').update(changed).digest('hex'))
 }
 expect(sql).toContain("to_jsonb(p)-'prosrc'")
 expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|ALTER TABLE|ALTER POLICY|GRANT|REVOKE)\b/i)
 expect(sql).toContain('Stale PO source drift; migration refused')
 expect(sql).toContain('Stale PO metadata changed; migration refused')
 expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1)
})
