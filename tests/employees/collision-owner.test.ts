// @vitest-environment node
import { expect,it,vi } from 'vitest'
let collision:any
try{collision=await import('../database/employees/collision-owner.mjs')}catch{}
const expected={kind:'type',token:'12345678-1234-4234-8234-123456789abc',baseline:'a'.repeat(64)}
const marker={version:1,kind:'type',token:expected.token,oid:'123',baseline:expected.baseline,fingerprint:'b'.repeat(64)}
const observed={oid:'123',identity:'private.employee_install_collision',owner:'postgres',objectKind:'e',marker:JSON.stringify(marker),fingerprint:'b'.repeat(64)}
function decode(value:any=observed){expect(collision?.assertOwnedCollision).toBeTypeOf('function');return collision.assertOwnedCollision(expected,JSON.stringify(value))}
it('accepts only exact atomically marked collision metadata and whole-state fingerprint',()=>{expect(decode()).toEqual({absent:false,oid:'123'});expect(collision.collisionCreateSql(expected)).toContain('COMMENT ON TYPE private.employee_install_collision');expect(collision.collisionCreateSql(expected)).toContain("pg_temp.employee_legacy_snapshot()")})
it.each(['json','extra','token','kind','oid','owner','identity','shape','hash','baseline','marker-extra','marker-missing'])('refuses %s metadata before deletion',kind=>{
 expect(collision?.assertOwnedCollision).toBeTypeOf('function');const value=structuredClone(observed)
 if(kind==='json')value.marker='{'
 if(kind==='extra')(value as any).extra=true
 if(kind==='owner')value.owner='anon'
 if(kind==='identity')value.identity='private.unowned'
 if(kind==='shape')value.objectKind='b'
 if(kind==='hash')value.fingerprint='c'.repeat(64)
 if(kind==='marker-missing')value.marker=null as any
 if(['token','kind','oid','baseline','marker-extra'].includes(kind)){const m:any={...marker};if(kind==='token')m.token='87654321-1234-4234-8234-123456789abc';if(kind==='kind')m.kind='table';if(kind==='oid')m.oid='124';if(kind==='baseline')m.baseline='c'.repeat(64);if(kind==='marker-extra')m.extra=true;value.marker=JSON.stringify(m)}
 expect(()=>decode(value)).toThrow()
})
it('allows uncertain creation absence only with exact original baseline and no residual metadata',()=>{
 const absent={oid:null,identity:null,owner:null,objectKind:null,marker:null,fingerprint:expected.baseline}
 expect(decode(absent)).toEqual({absent:true})
 expect(()=>decode({...absent,fingerprint:'c'.repeat(64)})).toThrow()
 expect(()=>decode({...absent,marker:JSON.stringify(marker)})).toThrow()
})
it('rejects caller-selected kinds and malformed ownership values before producing fixed SQL',()=>{
 expect(collision?.collisionCreateSql).toBeTypeOf('function')
 for(const value of [{...expected,kind:'other'},{...expected,token:'x'},{...expected,baseline:'x'},{...expected,sql:'DROP'}])expect(()=>collision.collisionCreateSql(value)).toThrow()
 expect(collision.collisionDropSql('type')).toBe('DROP TYPE private.employee_install_collision;')
 expect(()=>collision.collisionDropSql('private.unowned')).toThrow()
})
it('preserves the original uncertain-COMMIT error after successful fresh cleanup',async()=>{
 expect(collision?.withCollisionCleanup).toBeTypeOf('function')
 const original=Error('owned client exited after COMMIT'),cleanup=vi.fn(()=>decode())
 await expect(collision.withCollisionCleanup(async()=>{throw original},cleanup)).rejects.toBe(original)
 expect(cleanup).toHaveBeenCalledTimes(1)
})
it('retains original and cleanup errors instead of replacing the original cause',async()=>{
 expect(collision?.withCollisionCleanup).toBeTypeOf('function')
 const original=Error('statement timeout'),cleanup=Error('ownership mismatch')
 try{await collision.withCollisionCleanup(async()=>{throw original},async()=>{throw cleanup});throw Error('expected rejection')}catch(error:any){expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([original,cleanup]);expect(error.message).toContain('statement timeout');expect(error.message).toContain('ownership mismatch')}
})
it('does not turn cleanup failure into success when work completed',async()=>{
 expect(collision?.withCollisionCleanup).toBeTypeOf('function');const failure=Error('baseline mismatch')
 await expect(collision.withCollisionCleanup(async()=>{},async()=>{throw failure})).rejects.toBe(failure)
})

it.each([123,0,-1,4294967296,'0','-1','0123','1.23','1e2',' 123','123 ','4294967296','999999999999999999999'])('rejects noncanonical or out-of-range PostgreSQL OID %s',oid=>{
 const value={...observed,oid,marker:JSON.stringify({...marker,oid})}
 expect(()=>decode(value)).toThrow(/OID/)
})
it.each(['1','50709','4294967295'])('accepts canonical PostgreSQL JSON OID %s',oid=>{
 expect(decode({...observed,oid,marker:JSON.stringify({...marker,oid})})).toEqual({absent:false,oid})
})
