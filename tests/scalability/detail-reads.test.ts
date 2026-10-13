import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ rows: [] as any[], cap: 100, failOffset: -1, selected: [] as string[], filter: [] as any[], ranges: [] as number[] }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: () => {
  let offset=0,limit=Infinity
  const q:any={select:(columns:string)=>{state.selected.push(columns);return q},eq:(name:string,id:string)=>{state.filter.push([name,id]);return q},order:()=>q,range:(start:number,end:number)=>{offset=start;limit=end-start+1;state.ranges.push(start);return q},abortSignal:()=>q,then:(ok:any,fail:any)=>Promise.resolve({data:state.rows.slice(offset,offset+Math.min(limit,state.cap)),count:state.rows.length,error:offset===state.failOffset?new Error('page failed'):null}).then(ok,fail)};return q
} } }))
vi.mock('../../src/lib/reads/orders',()=>({fetchPOLinePage:vi.fn()}))
import { fetchSalesOrderLines, fetchDeliveryLines, fetchAuditPage, priceForEdit } from '../../src/lib/reads/detailReads'
beforeEach(()=>{state.rows=Array.from({length:501},(_,i)=>({id:`row-${i}`}));state.cap=100;state.failOffset=-1;state.selected=[];state.filter=[];state.ranges=[]})
test('selected sales lines remain complete when actual API chunks are smaller than requested',async()=>{
 const rows=await fetchSalesOrderLines('order');expect(rows).toEqual(state.rows);expect(state.ranges).toEqual([0,100,200,300,400,500]);expect(state.filter.every(([field,id])=>field==='order_id'&&id==='order')).toBe(true);expect(state.selected[0]).toBe('id, order_id, product_name, sku, quantity, unit_price, is_promo')
})
test('failed later delivery-line read rejects rather than returning partial correction input',async()=>{state.failOffset=100;await expect(fetchDeliveryLines('sj')).rejects.toThrow('page failed')})
test('a capped history page is an error rather than an apparently complete page',async()=>{state.cap=10;await expect(fetchAuditPage('po',1)).rejects.toThrow(/lengkap/)})
test.each(['0.00','0.01','999999999999.99'])('numeric edit prices preserve supported decimal %s',value=>{expect(priceForEdit(value)).toBe(Number(value))})
test('edit prices refuse a decimal that silently changes through a JS number',()=>{expect(()=>priceForEdit('90071992547409.91')).toThrow()})
