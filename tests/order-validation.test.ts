import { expect, test, vi } from 'vitest'
const state = vi.hoisted(()=>({writes:[] as string[]}))
vi.mock('../src/lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:(table:string)=>{
 const q:any={insert:()=>{state.writes.push(table);return q},update:()=>{state.writes.push(table);return q},delete:()=>{state.writes.push(table);return q},eq:()=>q,select:()=>q,single:async()=>({data:{id:'id'},error:null}),then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};return q
}}}))
import { createPO } from '../src/pages/athel/PONew'
import { saveEdits } from '../src/pages/athel/POEdit'
import { submitOrder } from '../src/pages/girard/VisitPage'
for(const action of ['create','edit','sales']) {
 const run=(item:any)=>action==='create'?createPO({customer_id:'c',po_number:'PO',order_date:'2026-09-30',expected_delivery_date:'',notes:'',lineItems:[item]}):action==='edit'?saveEdits('p',{customer_id:'c',expected_delivery_date:null,notes:null,lineItems:[item]}):submitOrder({customer_id:'c',visit_id:'v',submitted_by:'u',items:[item]})
 for(const overrides of [{quantity:-1},{quantity:0},{quantity:1.5},{quantity:Infinity},{unit_price:-1},{unit_price:NaN},{unit_price:Infinity},{quantity:2,unit_price:Number.MAX_VALUE},{quantity:Number.MAX_SAFE_INTEGER+1}])test(`${action}: rejects ${JSON.stringify(overrides)} before any write`,async()=>{
  state.writes=[]
  await expect(run({id:null,product_id:'p',product_name:'Product',sku:'SKU',quantity:1,unit_price:10,...overrides})).rejects.toThrow()
  expect(state.writes).toEqual([])
 })
 test(`${action}: accepts a legitimate zero-price item`,async()=>{
  state.writes=[]
  await expect(run({id:null,product_id:'p',product_name:'Product',sku:'SKU',quantity:1,unit_price:0,is_promo:true})).resolves.not.toThrow()
  expect(state.writes.length).toBeGreaterThan(0)
 })
}
