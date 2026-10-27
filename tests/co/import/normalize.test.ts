import { describe, it, expect } from 'vitest'
import { summarizeSource, suggestSkuMatches } from '../../../src/lib/co/import/normalize'
import { row } from './reviewFixture'
describe('source normalization', () => {
 it('preserves sold quantity and source amount independent of returns', () => {
  for (const [quantity,returned,amount] of [['73','73','1241000'],['31','17','589000']]) {
   const r=row({quantity:{raw:quantity,decimal:quantity},returned:{raw:returned,decimal:returned},amount:{raw:amount,decimal:amount}})
   expect(summarizeSource([r]).amount).toBe(`${amount}.00`)
   expect(r.quantity.decimal).toBe(quantity)
  }
 })
 it('keeps differing source prices distinct',()=>expect(summarizeSource([row(),row({unitPrice:{raw:'30000',decimal:'30000'}})]).unitPrice).toBe('multiple'))
 it('does not combine price bases or currencies',()=>{
  expect(summarizeSource([row(),row({unit:'BOX'})]).unitPrice).toBe('multiple')
  expect(summarizeSource([row(),row({currency:'USD'})]).amount).toBeNull()
 })
 it('preserves unresolved amount and exact precision',()=>{
  expect(summarizeSource([row({amount:null})]).amount).toBeNull()
  expect(summarizeSource([row({amount:{raw:'1.001',decimal:'1.001'}})]).amount).toBeNull()
  expect(summarizeSource([row({amount:{raw:'9007199254740993.01',decimal:'9007199254740993.01'}}),row({amount:{raw:'.02',decimal:'0.02'}})]).amount).toBe('9007199254740993.03')
 })
 it('suggests all exact SKU candidates without mutating evidence',()=>{
  const r=row(); const catalog=[{stockKeyId:'a',sku:'001',name:'A',unit:'PCS'},{stockKeyId:'b',sku:'001',name:'B',unit:'PCS'}]
  expect(suggestSkuMatches(r,catalog)).toEqual(['a','b']); expect(r.sourceSku).toBe('001')
  expect(suggestSkuMatches(row({sourceSku:null}),catalog)).toEqual([])
 })
})
