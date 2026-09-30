import { expect, test } from 'vitest'
import { singleRelation } from '../src/lib/relations'
test('preserves a to-one object including zero and nullable fields',()=>{
 const object={id:'p',price:0,size:null};expect(singleRelation(object)).toBe(object)
})
test('normalizes a singleton relation array',()=>{
 const object={id:'p'};expect(singleRelation([object])).toBe(object)
})
for(const value of [[],null,undefined]) test(`empty relation ${String(value)} is null`,()=>expect(singleRelation(value)).toBeNull())
test('does not silently take the first of an unexpected to-many relation',()=>expect(()=>singleRelation([{id:'a'},{id:'b'}])).toThrow('multiple'))
