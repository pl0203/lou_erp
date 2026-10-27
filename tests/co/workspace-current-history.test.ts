// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
const proof=readFileSync('tests/database/co/workspace-current-history.sql','utf8')
const candidate=readFileSync('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql','utf8')
const history=readFileSync('supabase/catalogue/v1/new10-guarded-delete.sql','utf8')
test('authored import topology enumerates every new table and all 23 finite FK edges',()=>{
 const expected=JSON.parse(proof.match(/\$edges\$(.*?)\$edges\$/s)![1])
 const actual:unknown[][]=[]
 for(const match of candidate.matchAll(/CREATE TABLE (private\.\w+)\s*\(([\s\S]*?)\n\);/g)){
  const [,table,body]=match
  for(const fk of body.matchAll(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+\.\w+)\s*\(([^)]+)\)([^\n]*)/g)){
   actual.push([table,fk[1].split(',').map(x=>x.trim()),fk[2],fk[3].split(',').map(x=>x.trim()),'a','a','s',/DEFERRABLE INITIALLY DEFERRED/.test(fk[4]),/DEFERRABLE INITIALLY DEFERRED/.test(fk[4]),true])
  }
  for(const fk of body.matchAll(/(?:^|,)\s*(\w+)\s+uuid[^\n,]*REFERENCES\s+(\w+\.\w+)\s*\(([^)]+)\)/gm)){
   actual.push([table,[fk[1]],fk[2],fk[3].split(',').map(x=>x.trim()),'a','a','s',false,false,true])
  }
 }
 expect(new Set(expected.map((x:unknown[])=>x[0])).size).toBe(9)
 expect(expected).toHaveLength(23)
 expect(actual.map(x=>JSON.stringify(x)).sort()).toEqual(expected.map((x:unknown)=>JSON.stringify(x)).sort())
 expect(proof).toContain('c.conrelid::regclass::text=ANY(names) OR c.confrelid::regclass::text=ANY(names)')
})
test('old frozen graph remains finite and unsupported import topology is refused, never accepted',()=>{
 const frozen=JSON.parse(history.match(/\$fk\$(.*?)\$fk\$/s)![1])
 expect(frozen).toHaveLength(110)
 expect(history).not.toContain('private.co_import_manifests')
 expect(proof).toContain('PERFORM private.catalog_history_foreign_keys_v1()')
 expect(proof).toContain("rejected:=detail='CATALOG_TRACKING_INCOMPLETE'")
 expect(proof).toContain("IF NOT rejected THEN RAISE EXCEPTION 'Unsupported future cutover falsely certified'")
})
test('operation matrix preserves gen1 lifecycle/native deletion but rejects guarded delete',()=>{
 expect(proof).toContain("ARRAY['product','customer']")
 expect(proof).toContain("'set_enabled'")
 expect(proof).toContain('GET DIAGNOSTICS changed=ROW_COUNT')
 expect(proof).toContain("EXCEPTION WHEN SQLSTATE '55000' THEN rejected:=true")
 expect(proof).toContain('execution_generation=1 AND NOT tracking_ready')
 expect(proof).not.toMatch(/DISABLE TRIGGER|ALTER TABLE|CREATE FUNCTION|UPDATE private\.catalog_cutover|GRANT /)
 expect(proof.trim()).toMatch(/ROLLBACK;$/)
 const checked=readFileSync('supabase/catalogue/v1/new09-checked-boundaries.sql','utf8')
 const body=checked.slice(checked.indexOf('FUNCTION private.catalog_product_delete_begin_v2'))
 expect(body).toContain('IF generation=1 THEN RETURN NULL; END IF;')
 expect(body).toContain('PERFORM private.catalog_assert_history_contract_v1()')
 expect(body.indexOf('IF generation=1 THEN RETURN NULL; END IF;')).toBeLessThan(body.indexOf('PERFORM private.catalog_assert_history_contract_v1()'))
})
