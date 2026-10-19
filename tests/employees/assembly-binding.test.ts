// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,it,vi} from 'vitest'
const mutation=vi.hoisted(()=>({kind:''}))
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,readFileSync:vi.fn((path:any,...args:any[])=>{
 const value=(fs.readFileSync as any)(path,...args)
 if(String(path).endsWith('/catalog-manifest.json')&&mutation.kind){const m=JSON.parse(String(value));if(mutation.kind==='extra')m.verifier['unreviewed-source.txt']='a'.repeat(64);else delete m.verifier['sql/employee-foundation/catalog.sql'];return JSON.stringify(m)}
 return value
})}})
import {assembleEmployeeSql} from '../../scripts/assemble-employee-sql.mjs'
it.each(['extra','missing'])('refuses %s verifier paths without reading a caller-selected source',kind=>{
 mutation.kind=kind;vi.mocked(readFileSync).mockClear()
 expect(()=>assembleEmployeeSql()).toThrow(/verifier|deep-equal|Expected|equal/i)
 expect(vi.mocked(readFileSync).mock.calls.some(([path])=>String(path).endsWith('unreviewed-source.txt'))).toBe(false)
 mutation.kind=''
})
