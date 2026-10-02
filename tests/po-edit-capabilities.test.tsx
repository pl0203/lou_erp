import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
const state=vi.hoisted(()=>{const invalidate=vi.fn();return {rpc:vi.fn(),navigate:vi.fn(),invalidate,reset:vi.fn(),queryClient:{invalidateQueries:invalidate,cancelQueries:vi.fn(async()=>{})},status:'in_progress',historyError:false,history:[{voided_at:null as string|null,sj_line_items:[{po_line_item_id:'line',quantity_delivered:2}]}]}})
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:state.rpc}}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'dummy'}})}))
vi.mock('../src/components/AthelNav',()=>({default:()=>null}))
vi.mock('react-router-dom',()=>({useNavigate:()=>state.navigate,useParams:()=>({id:'po'})}))
const po={id:'po',po_number:'DUMMY',status:'in_progress',customer_id:'c',order_date:'2026-09-30',total_value:30,updated_at:'2026-09-30T00:00:00Z'}
const lines=[{id:'line',product_name:'Delivered product',sku:'SKU',quantity:3,unit_price:10}]
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>state.queryClient,useMutation:()=>({reset:state.reset}),useQuery:({queryKey}:any)=>({isLoading:false,isError:queryKey[0]==='po_line_state'&&state.historyError,refetch:()=>{},data:queryKey[0]==='po'?{...po,status:state.status}:queryKey[0]==='po_line_state'?{po_updated_at:po.updated_at,po_has_delivery_history:state.history.length>0,items:lines.map(line=>({...line,has_delivery_history:state.history.length>0,delivered_quantity:state.history[0]?.voided_at ? 0 : state.history[0]?.sj_line_items[0]?.quantity_delivered ?? 0}))}:queryKey[0]==='po_line_items'?lines:queryKey[0]==='po_edit_deliveries'?state.history:queryKey[0]==='customers'?[{id:'c',name:'Dummy customer'}]:queryKey[0]==='purchase_orders'?{items:[{...po,status:state.status,customers:{name:'Dummy'},surat_jalan:[]}],total:1}:[]})}))
vi.mock('../src/lib/reads/usePagedRead',()=>({usePagedRead:()=>({data:{version:1,as_of:po.updated_at,items:[{...po,status:state.status,total_value:'30.00',customers:{name:'Dummy'}}],total:1,page:1,page_size:10},filters:{status:'all',search:''},page:1,setFilters:()=>{},setPage:()=>{},isPending:false,isError:false,refetch:()=>{}})}))
import POEdit from '../src/pages/athel/POEdit'
import POList from '../src/pages/athel/POList'
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.clearAllMocks();state.status='in_progress';state.historyError=false;state.history[0].voided_at=null})
for(const status of ['cancelled','complete'])test(`${status} cannot enter editing through list or direct URL`,()=>{
 state.status=status;const list=render(<POList/>);expect(screen.queryByRole('button',{name:'Ubah'})).toBeNull();list.unmount();render(<POEdit/>);expect(screen.queryByRole('button',{name:'Simpan Perubahan'})).toBeNull();expect(screen.getByText(/tidak dapat diubah/i)).toBeTruthy()
})
test('delivery history locks customer and identity while quantity respects active delivered minimum',async()=>{
 render(<POEdit/>);await screen.findByDisplayValue('Delivered product')
 expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).disabled).toBe(true)
 expect((screen.getByDisplayValue('Delivered product') as HTMLInputElement).disabled).toBe(true)
 expect((screen.getByDisplayValue('SKU') as HTMLInputElement).disabled).toBe(true)
 const numbers=screen.getAllByRole('spinbutton') as HTMLInputElement[];expect(numbers[0].min).toBe('2');expect(numbers[0].disabled).toBe(false);expect(numbers[1].disabled).toBe(true)
 expect((screen.getByRole('button',{name:'Hapus Delivered product'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByText(/Riwayat pengiriman mengunci/)).toBeTruthy()
})
test('voided history still protects identities but does not impose active delivered quantity',async()=>{
 state.history[0].voided_at='2026-10-01';render(<POEdit/>);await screen.findByDisplayValue('Delivered product');expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).min).toBe('1');expect((screen.getByDisplayValue('Delivered product') as HTMLInputElement).disabled).toBe(true)
})
test('unknown delivery history blocks edits and provides retry instead of unlocking fields',()=>{
 state.historyError=true;render(<POEdit/>);expect(screen.getByRole('alert')).toBeTruthy();expect(screen.getByRole('button',{name:'Coba lagi'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Simpan Perubahan'})).toBeNull()
})
test('PO expiry has customer expiry wording in both list layouts',()=>{render(<POList/>);expect(screen.queryByText('Estimasi Pengiriman')).toBeNull();expect(screen.getAllByText('Tanggal Kedaluwarsa PO')).toHaveLength(2)})

test('no delivery history keeps valid draft fields editable and expiry optional',async()=>{
 const original=state.history;state.history=[]
 try { render(<POEdit/>);await screen.findByDisplayValue('Delivered product');expect((screen.getByRole('combobox', { name: 'Pelanggan' }) as HTMLInputElement).disabled).toBe(false);expect((screen.getByDisplayValue('Delivered product') as HTMLInputElement).disabled).toBe(false);expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).disabled).toBe(false);expect((screen.getByRole('button',{name:'Hapus Delivered product'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)') as HTMLInputElement).required).toBe(false) } finally {state.history=original}
})

for(const view of ['complete','error'])test(`uncertain committed edit can still reconcile on ${view} view`,async()=>{
 state.status=view==='complete'?'complete':'in_progress';state.historyError=view==='error'
 localStorage.setItem('pilot-request:dummy:edit-po:po',JSON.stringify({id:'dummy-request',key:'hash',uncertain:true}))
 state.rpc.mockResolvedValue({data:{state:'committed',operation:'edit_po',result:{id:'po'}},error:null});vi.spyOn(window,'confirm').mockReturnValue(true)
 render(<POEdit/>);fireEvent.click(screen.getByRole('button',{name:'Pulihkan hasil penyimpanan'}))
 await waitFor(()=>expect(localStorage.getItem('pilot-request:dummy:edit-po:po')).toBeNull())
 expect(state.navigate).toHaveBeenCalledWith('/athel/po/po')
})

test('edit line fields stack on phones while preserving the desktop column layout', async () => {
  render(<POEdit />)
  const sku = await screen.findByDisplayValue('SKU')
  const field = sku.parentElement!
  const grid = field.parentElement!
  // Layout contracts only: jsdom cannot prove screen geometry.
  expect(grid.classList.contains('grid-cols-1')).toBe(true)
  expect([...grid.classList].some(name => name.startsWith('sm:grid-cols-['))).toBe(true)
  expect(field.classList.contains('min-w-0')).toBe(true)
  for (const input of grid.querySelectorAll('input')) expect(input.classList.contains('min-w-0')).toBe(true)
})

test('PO list lets long mobile identities wrap and tablet tables scroll instead of clipping', () => {
  render(<POList />)
  const names = screen.getAllByText('DUMMY')
  const mobile = names.find(node => node.tagName === 'P')!
  expect(mobile.parentElement!.classList.contains('min-w-0')).toBe(true)
  expect(mobile.parentElement!.classList.contains('[overflow-wrap:anywhere]')).toBe(true)
  const table = screen.getByRole('table')
  expect(table.parentElement!.classList.contains('overflow-x-auto')).toBe(true)
  expect(table.parentElement!.getAttribute('tabindex')).toBe('0')
})
