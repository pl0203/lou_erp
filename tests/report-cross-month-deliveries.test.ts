// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
const state=vi.hoisted(()=>({failEligible:false}))
vi.mock('../src/lib/supabase',async()=>{
 const {createClient}=await import('@supabase/supabase-js')
 const fakeFetch:typeof fetch=async input=>{
  const u=new URL(String(input));const table=u.pathname.split('/').pop();let data:any[]=[]
  if(table==='customers')data=[{id:'c',name:'Dummy',visit_frequency_days:7}]
  if(table==='purchase_orders'){
   if(state.failEligible && !u.searchParams.has('order_date'))return new Response(JSON.stringify({message:'eligible orders unavailable',code:'XX000'}),{status:500,headers:{'Content-Type':'application/json'}})
   data=[{id:'prior',customer_id:'c',status:'in_progress',order_date:'2026-08-15'},{id:'current',customer_id:'c',status:'confirm',order_date:'2026-09-15'}]
   for(const f of u.searchParams.getAll('order_date'))data=data.filter(r=>f.startsWith('gte.')?r.order_date>=f.slice(4):r.order_date<=f.slice(4))
   if(u.searchParams.has('status'))data=data.filter(r=>['in_progress','complete'].includes(r.status))
  }
  if(table==='surat_jalan'){
   data=[{sj_date:'2026-09-01',q:2},{sj_date:'2026-09-30',q:3},{sj_date:'2026-10-01',q:4},{sj_date:'2026-09-10',q:5,voided_at:'2026-09-11'}].map(r=>({...r,purchase_order_id:'prior',sj_line_items:[{quantity_delivered:r.q,po_line_items:{unit_price:10}}]}))
   if(u.searchParams.get('voided_at')==='is.null')data=data.filter(r=>!r.voided_at)
   data=data.filter(r=>(u.searchParams.get('purchase_order_id')??'').includes(r.purchase_order_id))
   for(const f of u.searchParams.getAll('sj_date'))data=data.filter(r=>f.startsWith('gte.')?r.sj_date>=f.slice(4):r.sj_date<=f.slice(4))
  }
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})
 }
 return {supabase:createClient('https://example.invalid','synthetic-test-key',{global:{fetch:fakeFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
})
import {fetchCustomerPerformance} from '../src/pages/girard/CustomerPerformance'
beforeEach(()=>{state.failEligible=false})
test('monthly delivered sales include earlier orders while order count remains creation-month based',async()=>{
 const [row]=await fetchCustomerPerformance('u','executive','2026-09')
 expect(row.order_count).toBe(1)
 expect(row.total_sales).toBe(50)
})
test('eligible delivery-order read failure propagates instead of reporting zero sales',async()=>{
 state.failEligible=true
 await expect(fetchCustomerPerformance('u','executive','2026-09')).rejects.toMatchObject({message:'eligible orders unavailable'})
})
