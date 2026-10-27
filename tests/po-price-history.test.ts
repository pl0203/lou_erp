import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ headers: [] as any[], lines: new Map<string, any[]>(), calls: [] as any[], error: null as unknown, afterLines: undefined as undefined | (() => void), countOffset: 0 }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: (table: string) => {
 const filters: any[] = [], orders: any[] = []; let offset = 0, end = 0
 const q: any = { select: (columns: string, options: any) => { state.calls.push({ table, columns, options, filters, orders }); return q },
 eq: (key: string, value: any) => { filters.push(['eq', key, value]); return q }, neq: (key: string, value: any) => { filters.push(['neq', key, value]); return q },
 is: (key: string, value: any) => { filters.push(['is', key, value]); return q }, ilike: (key: string, value: any) => { filters.push(['ilike', key, value]); return q },
 order: (key: string, options: any) => { orders.push([key, options]); return q }, range: (start: number, finish: number) => { offset = start; end = finish; return q },
 limit: () => q, abortSignal: () => q,
 then: (resolve: any, reject: any) => Promise.resolve().then(() => {
  if (state.error) return { data: null, error: state.error, count: null }
  const rows = state.headers.filter(h => filters.every(([op, key, value]) => {
   if (!key.startsWith('matching.')) return op === 'neq' ? h[key] !== value : h[key] === value
   // The SQL prefilter may be broad. Full line identity is independently checked.
   return (state.lines.get(h.id) ?? []).some(l => filters.filter(f => f[1].startsWith('matching.')).every(([operation, field, expected]) => operation === 'ilike' || l[field.slice(9)] === expected))
  })).sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  return { data: rows.slice(offset, end + 1), count: rows.length + state.countOffset, error: null }
 }).then(resolve, reject) }
 return q
} } }))
vi.mock('../src/lib/reads/detailReads', async importOriginal => ({ ...(await importOriginal<any>()), fetchCompletePOLines: vi.fn(async (id: string, version: string) => {
 const items = structuredClone(state.lines.get(id) ?? []); state.afterLines?.(); return { items, po_updated_at: version, po_has_delivery_history: false }
}) }))
import { fetchLastPOPrice } from '../src/lib/reads/poPriceHistory'
const customer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
function add(n: number, values: Record<string, unknown> = {}, prices = ['12500.50']) {
 const h = { id: id(n), customer_id: customer, po_number: `TEST-${n}`, order_date: '2026-01-01', status: 'confirm', created_at: `2026-01-${String(n).padStart(2,'0')}T00:00:00.000000+00:00`, updated_at: '2026-02-01T00:00:00.000000+00:00', ...values }
 state.headers.push(h); state.lines.set(h.id, prices.map((price, i) => ({id:`line-${n}-${i}`, product_id:product, sku:'SKU-TEST', unit_price:price}))); return h
}
const read = (signal?: AbortSignal) => fetchLastPOPrice(customer, product, 'SKU-TEST', signal)
beforeEach(() => { state.headers=[]; state.lines.clear(); state.calls=[]; state.error=null; state.afterLines=undefined; state.countOffset=0 })
test('latest created noncancelled same-customer item wins, not order date or modified date', async () => {
 add(1, {order_date:'2026-12-31', updated_at:'2026-12-31T00:00:00Z'}, ['900'])
 add(2, {}, ['12500.50']); add(3, {status:'cancelled'}, ['1']); add(4, {customer_id:id(99)}, ['2'])
 const other=add(5); state.lines.set(other.id,[{id:'other',product_id:id(98),sku:'OTHER',unit_price:'3'}])
 expect(await read()).toMatchObject({kind:'suggestion',price:'12500.50',unitPrice:12500.5,po:{id:id(2)}})
 expect(state.calls[0]).toMatchObject({table:'purchase_orders', options:{count:'exact'}, filters:expect.arrayContaining([['eq','customer_id',customer],['neq','status','cancelled'],['eq','matching.product_id',product]]), orders:[['created_at',{ascending:false}],['id',{ascending:false}]]})
})
test('same timestamp ties are deterministic by descending PO ID', async () => {
 add(1, {created_at:'2026-01-01T00:00:00Z'}, ['1']); add(2, {created_at:'2026-01-01T00:00:00Z'}, ['2'])
 expect(await read()).toMatchObject({kind:'suggestion',unitPrice:2})
})
test('conflicting duplicate item prices in latest PO require manual review, never older fallback', async () => {
 add(1); add(2,{},['10','20']); expect(await read()).toMatchObject({kind:'ambiguous',po:{id:id(2)}})
})
test('equal duplicate prices coalesce and zero remains a valid suggestion', async () => {
 add(1,{},['0.00','0']); expect(await read()).toMatchObject({kind:'suggestion',unitPrice:0})
})
test('successful complete empty history is first order', async () => { expect(await read()).toEqual({kind:'none'}) })
test('legacy SKU matching is normalized but never guessed as a product ID', async () => {
 const h=add(1); state.lines.set(h.id,[{id:'legacy',product_id:null,sku:' sku-test ',unit_price:'50'}]); expect(await read()).toMatchObject({kind:'legacy',po:{id:h.id}})
})
test('a newer definitive product match wins over older legacy history', async () => {
 const h=add(1); state.lines.set(h.id,[{id:'legacy',product_id:null,sku:'SKU-TEST',unit_price:'50'}]); add(2,{},['60']); expect(await read()).toMatchObject({kind:'suggestion',unitPrice:60})
})
test('legacy prefilter false positives are checked before first-order claim', async () => {
 const h=add(1); state.lines.set(h.id,[{id:'legacy',product_id:null,sku:'SKU-TEST-OTHER',unit_price:'50'}]); expect(await read()).toEqual({kind:'none'})
})
test('submillisecond recency across definitive and legacy searches is preserved', async () => {
 add(1,{created_at:'2026-01-01T00:00:00.000001Z'}); const h=add(2,{created_at:'2026-01-01T00:00:00.000002Z'})
 state.lines.set(h.id,[{id:'legacy',product_id:null,sku:'SKU-TEST',unit_price:'50'}]); expect(await read()).toMatchObject({kind:'legacy'})
})
test('errors and incomplete counts never become no-history', async () => {
 state.error=new Error('Read denied'); await expect(read()).rejects.toThrow('Read denied'); state.error=null; state.countOffset=1; await expect(read()).rejects.toThrow()
})
test('unsafe historical prices are not silently rounded', async () => { add(1,{},['1.001']); await expect(read()).rejects.toThrow() })
test('cancellation while details load invalidates the result', async () => {
 const h=add(1); state.afterLines=()=>{h.status='cancelled'}; await expect(read()).rejects.toThrow()
})
test('a newly entered matching PO during the read invalidates the older suggestion', async () => {
 add(1); state.afterLines=()=>{ state.afterLines=undefined; add(2) }; await expect(read()).rejects.toThrow()
})
test('an aborted read cannot succeed', async () => { const controller=new AbortController(); controller.abort(); await expect(read(controller.signal)).rejects.toThrow() })
test('same PO with both definitive and uncertain matching legacy lines requires review', async () => {
 const h=add(1);state.lines.get(h.id)!.push({id:'legacy',product_id:null,sku:'SKU-TEST',unit_price:'12500.50'});expect(await read()).toMatchObject({kind:'legacy'})
})
test('legacy lookup is bounded, never claiming first order from a truncated scan', async () => {
 for(let n=1;n<=101;n++){ const h=add(n,{created_at:'2026-01-01T00:00:00Z'});state.lines.set(h.id,[{id:`legacy-${n}`,product_id:null,sku:'SKU-TEST-OTHER',unit_price:'1'}]) }
 await expect(read()).rejects.toThrow(/Riwayat lama/)
})
test('SKU punctuation is a parameter, not a raw PostgREST expression', async () => {
 await fetchLastPOPrice(customer,product,'SYNTH_%*\\,()',undefined)
 const legacy=state.calls.find(call=>call.filters.some((f:any[])=>f[0]==='ilike'))
 expect(legacy.filters).toContainEqual(['ilike','matching.sku','%SYNTH\\_\\%%\\\\,()%'])
})
