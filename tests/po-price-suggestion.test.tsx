import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ read: vi.fn(), auth: { user:{id:'actor-a'}, profile:{id:'actor-a',role:'po_admin',is_active:true}, loading:false, error:null as string|null } }))
vi.mock('../src/lib/AuthContext', () => ({useAuth:()=>state.auth}))
vi.mock('../src/lib/reads/poPriceHistory', () => ({fetchLastPOPrice:state.read}))
import POLastPriceSuggestion from '../src/components/POLastPriceSuggestion'
const initialAuth=structuredClone(state.auth), usePrice=vi.fn()
const suggestion=(price=12500.5)=>({kind:'suggestion',price:String(price),unitPrice:price,po:{id:'po-test',po_number:'TEST-PO',order_date:'2026-01-01'}})
let client:QueryClient
const props={customerId:'customer-a',productId:'product-a',sku:'SYNTHETIC-SKU',currentUnitPrice:Number.NaN,onUsePrice:usePrice}
function View(p:Partial<typeof props> & {disabled?:boolean;enabled?:boolean}={}) {return <QueryClientProvider client={client}><POLastPriceSuggestion {...props} {...p}/></QueryClientProvider>}
function deferred<T>() {let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}}
beforeEach(()=>{state.auth=structuredClone(initialAuth);state.read.mockReset();state.read.mockResolvedValue(suggestion());usePrice.mockReset();client=new QueryClient({defaultOptions:{queries:{retry:false}}})})
afterEach(()=>{cleanup();client.clear();onlineManager.setOnline(true)})
test('shows IDR unit price and source, but only applies on explicit click',async()=>{
 render(View());await screen.findByText(/Rp 12.500,5/);expect(screen.getByText(/TEST-PO/)).toBeTruthy();expect(usePrice).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:/Gunakan harga ini/}));expect(usePrice).toHaveBeenCalledWith(12500.5)
})
test('loading, no-history and read-error messages are distinct; failure has retry',async()=>{
 const request=deferred<any>();state.read.mockReturnValueOnce(request.promise);render(View());expect(screen.getByText(/Memuat riwayat harga/)).toBeTruthy();expect(screen.queryByText(/pertama kali/)).toBeNull()
 await act(async()=>request.resolve({kind:'none'}));await screen.findByText(/Ini pertama kali pelanggan ini memesan item ini/)
 state.read.mockRejectedValueOnce(new Error('denied'));await act(async()=>{await client.invalidateQueries()});await screen.findByText(/Riwayat harga belum dapat dimuat/);expect(screen.queryByText(/pertama kali/)).toBeNull()
 state.read.mockResolvedValueOnce(suggestion());fireEvent.click(screen.getByRole('button',{name:/Coba lagi/}));await screen.findByText(/Rp 12.500,5/)
})
test.each(['legacy','ambiguous'])('%s history never offers an arbitrary price',async(kind)=>{
 state.read.mockResolvedValue({kind,po:{id:'po-test',po_number:'TEST-PO',order_date:'2026-01-01'}});render(View());await screen.findByText(kind==='legacy'?/Riwayat lama belum memiliki identitas produk yang pasti/:/PO terakhir memuat beberapa harga/)
 expect(screen.queryByRole('button',{name:/Gunakan harga ini/})).toBeNull();expect(screen.queryByText(/pertama kali/)).toBeNull();expect(usePrice).not.toHaveBeenCalled()
})
test('refresh cannot overwrite an edited price, nor can an old enabled button apply during refresh',async()=>{
 const view=render(View({currentUnitPrice:99}));await screen.findByText(/Rp 12.500,5/);const old=screen.getByRole('button',{name:/Gunakan harga ini/})
 const request=deferred<any>();state.read.mockReturnValueOnce(request.promise)
 act(()=>{void client.invalidateQueries();fireEvent.click(old)});expect(usePrice).not.toHaveBeenCalled()
 view.rerender(View({currentUnitPrice:88}));await act(async()=>request.resolve(suggestion(20)));await screen.findByText(/Rp 20/);expect(usePrice).not.toHaveBeenCalled()
})
test('customer/item change discards late old results and preserves entered price',async()=>{
 const old=deferred<any>();state.read.mockReturnValueOnce(old.promise);const view=render(View({currentUnitPrice:77}))
 state.read.mockResolvedValueOnce(suggestion(33));view.rerender(View({customerId:'customer-b',productId:'product-b',sku:'OTHER',currentUnitPrice:77}));await screen.findByText(/Rp 33/)
 await act(async()=>old.resolve(suggestion(88)));expect(screen.queryByText(/Rp 88/)).toBeNull();expect(usePrice).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:/Gunakan harga ini/}));expect(usePrice).toHaveBeenCalledWith(33)
})
test('actor switch drops old history and rechecks under new identity',async()=>{
 const view=render(View());await screen.findByText(/Rp 12.500,5/);const old=screen.getByRole('button',{name:/Gunakan harga ini/});const request=deferred<any>();state.read.mockReturnValueOnce(request.promise)
 state.auth={...state.auth,user:{id:'actor-b'},profile:{...state.auth.profile,id:'actor-b'}};view.rerender(View());fireEvent.click(old);expect(usePrice).not.toHaveBeenCalled();expect(screen.queryByText(/Rp 12.500,5/)).toBeNull()
 await act(async()=>request.resolve(suggestion(10)));await screen.findByText(/Rp 10/)
})
test('zero is explicitly usable and does not become missing history',async()=>{
 state.read.mockResolvedValue(suggestion(0));render(View());await screen.findByText(/Rp 0/);fireEvent.click(screen.getByRole('button',{name:/Gunakan harga ini/}));expect(usePrice).toHaveBeenCalledWith(0)
})
test('same price is marked used, and mutation lock disables application',async()=>{
 const view=render(View({currentUnitPrice:12500.5}));await screen.findByText(/Harga ini sudah digunakan/);expect((screen.getByRole('button',{name:/Harga ini sudah digunakan/}) as HTMLButtonElement).disabled).toBe(true)
 view.rerender(View({currentUnitPrice:11,disabled:true}));expect((screen.getByRole('button',{name:/Gunakan harga ini/}) as HTMLButtonElement).disabled).toBe(true);expect(usePrice).not.toHaveBeenCalled()
})
test.each(['sales_person','co_admin'])('role %s cannot query or use PO pricing history',async(role)=>{
 state.auth.profile.role=role;render(View());expect(state.read).not.toHaveBeenCalled();expect(screen.queryByRole('button')).toBeNull()
})
test('unresolved/mismatched/inactive identity and missing product do not query',async()=>{
 state.auth.profile.id='other';const view=render(View());expect(state.read).not.toHaveBeenCalled()
 state.auth=structuredClone(initialAuth);state.auth.profile.is_active=false;view.rerender(View());expect(state.read).not.toHaveBeenCalled()
 state.auth=structuredClone(initialAuth);view.rerender(View({productId:null as any}));expect(state.read).not.toHaveBeenCalled()
})
test('catalogue readiness gate prevents reads and rejects an old apply button',async()=>{
 const view=render(View({enabled:false}));expect(state.read).not.toHaveBeenCalled()
 view.rerender(View());await screen.findByText(/Rp 12.500,5/);const old=screen.getByRole('button',{name:/Gunakan harga ini/})
 view.rerender(View({enabled:false}));fireEvent.click(old);expect(usePrice).not.toHaveBeenCalled();expect(screen.queryByText(/Rp 12.500,5/)).toBeNull()
})
test('unmount prevents an old apply button from changing the draft',async()=>{
 const view=render(View());await screen.findByText(/Rp 12.500,5/);const old=screen.getByRole('button',{name:/Gunakan harga ini/});view.unmount();fireEvent.click(old);expect(usePrice).not.toHaveBeenCalled()
})
test('current edited price survives late first-order result',async()=>{
 const request=deferred<any>();state.read.mockReturnValueOnce(request.promise)
 const view=render(View({currentUnitPrice:123}));view.rerender(View({currentUnitPrice:456}));await act(async()=>request.resolve({kind:'none'}));await screen.findByText(/pertama kali/);expect(usePrice).not.toHaveBeenCalled()
})

test('offline paused refresh never leaves a clickable stale suggestion',async()=>{
 render(View());await screen.findByText(/Rp 12.500,5/)
 act(()=>{onlineManager.setOnline(false);void client.refetchQueries()})
 await waitFor(()=>expect(client.getQueryCache().getAll()[0].state.fetchStatus).toBe('paused'))
 await screen.findByText(/Sambungkan kembali/);expect(screen.queryByRole('button',{name:/Gunakan harga ini/})).toBeNull();expect(screen.queryByText(/pertama kali/)).toBeNull();expect(usePrice).not.toHaveBeenCalled()
 state.read.mockResolvedValueOnce(suggestion(50));act(()=>onlineManager.setOnline(true));await screen.findByText(/Rp 50/)
})
