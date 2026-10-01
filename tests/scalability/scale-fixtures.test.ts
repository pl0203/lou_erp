// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { verifyScaleTarget, verifyScaleConnectionTarget } from '../../scripts/verify-scale-target.mjs'
import { buildManifest, generateSql } from './generate-fixtures.mjs'
const target={host:'127.0.0.1',database:'pilot_test',permit:'disposable-pilot-ci',rows:6000,marker:'disposable-pilot-ci'}
describe('disposable scale target',()=>{
 test('accepts only explicit recognized disposable targets',()=>{expect(()=>verifyScaleTarget(target)).not.toThrow();expect(()=>verifyScaleConnectionTarget(target)).not.toThrow()})
 for(const patch of [{host:'production.example.com'},{host:'/tmp/socket'},{database:'postgres'},{permit:''},{marker:''},{rows:30001},{rows:1},{rows:NaN}])test(`refuses unsafe or unbounded target ${JSON.stringify(patch)}`,()=>{expect(()=>verifyScaleTarget({...target,...patch})).toThrow()})
})
for(const rows of [6000,30000])test(`manifest describes exact base and separate edge counts at ${rows}`,()=>{
 const m=buildManifest(rows)
 expect(m.base.purchase_orders).toBe(rows);expect(m.base.po_line_items).toBe(rows*10);expect(m.base.surat_jalan).toBe(rows*2);expect(m.base.sj_line_items).toBe(rows*20)
 expect(m.base_totals).toEqual({po_value:String(rows*1000)+'.00',delivered_value:String(rows*500)+'.00',outstanding_value:String(rows*500)+'.00'})
 expect(m.edges.purchase_orders).toBe(7);expect(m.edges.po_line_items).toBe(7);expect(m.edges.surat_jalan).toBe(5);expect(m.edges.sj_line_items).toBe(5)
 expect(m.window).toEqual({from:rows===6000?'2025-10-01':'2021-10-01',to:'2026-09-30',pos_per_month:500})
 expect(m.role_po_counts.managerA).toBe(rows/2+7);expect(m.role_po_counts.managerB).toBe(rows/2)
 expect(m.actual_bytes).toBeNull();expect(m.capacity_verified).toBe(false)
})
test('default CLI prints manifest and never produces a write script',()=>{
 const out=execFileSync(process.execPath,['tests/scalability/generate-fixtures.mjs'],{encoding:'utf8',env:{...process.env,PGHOST:'production.invalid'}})
 expect(JSON.parse(out).base.purchase_orders).toBe(6000);expect(out).not.toContain('INSERT INTO')
})
test('SQL output requires exact explicit permit and recognized local target',()=>{
 expect(()=>generateSql(6000,{target:'local-ci',permit:''})).toThrow()
 expect(()=>generateSql(6000,{target:'production',permit:'disposable-pilot-ci'})).toThrow()
 const sql=generateSql(6000,{target:'local-ci',permit:'disposable-pilot-ci'})
 expect(sql.indexOf("current_database()<>'pilot_test'")).toBeLessThan(sql.indexOf('INSERT INTO'))
 expect(sql.indexOf('pilot_fixture_marker')).toBeLessThan(sql.indexOf("session_replication_role='replica'"))
 expect(sql).toContain("session_replication_role='origin'");expect(sql).toContain('ANALYZE');expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
})

test('CLI accepts no user-supplied identities or arbitrary seed inputs',()=>{expect(()=>execFileSync(process.execPath,['tests/scalability/generate-fixtures.mjs','--actor-email','real@example.com'],{encoding:'utf8',stdio:'pipe'})).toThrow()})
