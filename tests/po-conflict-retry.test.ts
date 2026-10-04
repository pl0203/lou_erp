import {expect,test} from 'vitest'
import {POConflictError,retryUnlessPOConflict} from '../src/lib/poConflict'
test('only PT409 bypasses retry; genuine serialization and network errors retain their ordinary policy',()=>{
 expect(retryUnlessPOConflict(0,new POConflictError(),true)).toBe(false)
 const serialization=Object.assign(new Error('database serialization failure'),{code:'40001'})
 expect(retryUnlessPOConflict(0,serialization)).toBe(true);expect(retryUnlessPOConflict(3,serialization)).toBe(false)
 expect(retryUnlessPOConflict(0,new Error('network'),false)).toBe(false)
 expect(retryUnlessPOConflict(1,new Error('network'),2)).toBe(true)
 expect(retryUnlessPOConflict(2,new Error('network'),2)).toBe(false)
 expect(retryUnlessPOConflict(0,serialization,(_count,error)=>error===serialization)).toBe(true)
})
