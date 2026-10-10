import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { deferred, fixture, metricsCalls, months, mount, page, role, setAuth, state, uuid, values, zero } from './sales-ui-harness'
import App from '../../src/App'
import GirardNav from '../../src/components/GirardNav'
import { PerformanceContent } from '../../src/pages/girard/GirardPerformance'

test('only salesperson navigation offers Penjualan Saya and keeps read-only order history',()=>{
  mount(<GirardNav/>);expect(screen.getByRole('link',{name:'Penjualan Saya'}).getAttribute('href')).toBe('/girard/my-sales');expect(screen.getByRole('link',{name:'Riwayat Pesanan'}).getAttribute('href')).toBe('/girard/my-orders');expect(screen.queryByRole('link',{name:/Buat.*[PO]|Revenue/i})).toBeNull()
  role('sales_manager');expect(screen.queryByRole('link',{name:'Penjualan Saya'})).toBeNull();expect(screen.getByRole('link',{name:'Dashboard'})).toBeTruthy()
})

test.each(['po_admin','co_admin','sales_manager','sales_head','executive'])('%s cannot mount own-only summary or initiate v2 reads',async(name)=>{
  role(name);mount(<App/>);await act(async()=>{});expect(screen.queryByRole('heading',{name:'Penjualan Saya'})).toBeNull();expect(metricsCalls()).toHaveLength(0);expect(state.calls.filter(c=>c.name==='pilot_sales_metric_months_v2')).toHaveLength(0)
})

test.each(['missing','inactive','mismatch','error'])('%s verified profile rejects before Sales reads',async(kind)=>{
  if(kind==='missing')setAuth({profile:null});if(kind==='inactive')setAuth({profile:{...state.auth.profile,is_active:false}});if(kind==='mismatch')setAuth({profile:{...state.auth.profile,id:uuid(9)}});if(kind==='error')setAuth({error:'revoked',profile:null})
  mount(<App/>);await act(async()=>{});expect(metricsCalls()).toHaveLength(0);expect(screen.queryByText('Rp 720.000')).toBeNull()
})

test('team filters go unchanged to server intersection without client person/role authority',async()=>{
  role('sales_manager');mount(<PerformanceContent/>,`/girard/dashboard?sales_manager=${uuid(2)}&sales_type=co`)
  await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});expect(metricsCalls()[0].args).toMatchObject({p_manager_id:uuid(2),p_order_type:'co',p_group_by:'person'});expect(Object.keys(metricsCalls()[0].args).sort()).toEqual(['p_group_by','p_manager_id','p_month_from','p_month_until','p_order_type','p_page','p_page_size']);expect(screen.getByText('Cakupan: tim')).toBeTruthy()
})

test('leadership Unassigned is explicit and narrowing clears broader rows before response',async()=>{
  role('sales_head');const pending=deferred();let narrowArgs:any
  state.handler=(name:string,args:any)=>{if(name==='pilot_sales_metrics_v2'){if(args.p_manager_id){narrowArgs=args;return pending.promise}return {data:page(args,{items:[{person_id:null,person_name:'Unassigned',is_unassigned:true,...values,co_contributing_report_count:'1'}]}),error:null}}return fixture(name,args)}
  mount(<PerformanceContent/>,'/girard/dashboard');await screen.findByText('Unassigned')
  fireEvent.change(within(screen.getByRole('region',{name:'Metrik Sales'})).getByLabelText('Manajer'),{target:{value:uuid(2)}})
  await waitFor(()=>expect(narrowArgs).toBeTruthy());expect(screen.queryByText('Unassigned')).toBeNull()
  await act(async()=>pending.resolve({data:page(narrowArgs,{total:'0',items:[],summary:{...zero,co_report_event_count:'0'}}),error:null}));await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});expect(screen.queryByText('Unassigned')).toBeNull()
})

test('identity switch and revocation remove private rows and earliest months; late responses stay removed',async()=>{
  const pending=deferred();let oldArgs:any
  state.handler=(name:string,args:any)=>{if(name==='pilot_sales_metrics_v2'&&state.auth.user.id===uuid(1)){oldArgs=args;return pending.promise}if(name==='pilot_sales_metric_months_v2')return {data:months(args,state.auth.user.id===uuid(1)?'2024-02-01':'2026-09-01'),error:null};return fixture(name,args)}
  mount(<App/>);await waitFor(()=>expect(oldArgs).toBeTruthy());await screen.findAllByRole('option',{name:/Februari 2024/})
  role('sales_person',uuid(3));await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});expect(screen.queryAllByRole('option',{name:/Februari 2024/})).toHaveLength(0)
  const oldData=page(oldArgs,{scope:'own'});setAuth({user:null,profile:null});await act(async()=>pending.resolve({data:oldData,error:null}));expect(screen.queryByText('Rp 720.000')).toBeNull();expect(screen.queryAllByRole('option',{name:/Februari 2024/})).toHaveLength(0)
})

test('malformed manager/type/month URL never widens a filter by silently falling back',async()=>{
  mount(<App/>,'/girard/my-sales?sales_manager=not-uuid&sales_type=everything&sales_from=2026-00');await screen.findByRole('alert');expect(metricsCalls()).toHaveLength(0)
})

test('raw CO report/evidence identifiers are rejected by production decoding and never rendered',async()=>{
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{items:[{...page(args).items[0],report_id:uuid(500),evidence_path:'private/report.png'}]}),error:null}:fixture(name,args)
  mount(<App/>);await screen.findByRole('alert');expect(document.body.innerHTML).not.toContain(uuid(500));expect(document.body.innerHTML).not.toContain('private/report.png');expect(state.calls.some(c=>/co_(?:detail|report|evidence)|evidence-download/.test(c.name))).toBe(false)
})

test('current verified role must agree with server scope before figures can be labelled own',async()=>{
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{scope:'team'}),error:null}:fixture(name,args)
  mount(<App/>);await screen.findByRole('alert');expect(screen.queryByText('Rp 720.000')).toBeNull()
})

test('actual Dashboard tab wiring keeps customer and person groups and independently labelled activity',async()=>{
  role('sales_manager');mount(<App/>,'/girard/dashboard');await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});expect(metricsCalls().at(-1)?.args.p_group_by).toBe('customer')
  fireEvent.click(screen.getByRole('button',{name:'Performa Tim Sales'}));await screen.findByRole('region',{name:'Kontribusi per orang'});expect(metricsCalls().at(-1)?.args.p_group_by).toBe('person');expect(screen.getByRole('heading',{name:'Aktivitas dan Target Tim'})).toBeTruthy()
})

test('forged own manager filter stays an intersecting RPC argument and cannot relabel scope',async()=>{
  mount(<App/>,`/girard/my-sales?sales_manager=${uuid(2)}`);await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});expect(metricsCalls()[0].args.p_manager_id).toBe(uuid(2));expect(screen.getByText('Cakupan: sendiri')).toBeTruthy();expect(screen.queryByLabelText('Manajer')).toBeNull()
})

test('verified same-ID role revocation removes the active summary immediately',async()=>{
  mount(<App/>);await screen.findByText('CO-only store');role('po_admin');await screen.findByText('PO home');expect(screen.queryByText('CO-only store')).toBeNull();expect(screen.queryByRole('region',{name:'Metrik Sales'})).toBeNull()
})

test('mobile navigation opens the named own-summary link and closes after selection',async()=>{
  const {vi}=await import('vitest')
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
  const {router}=mount(<App/>,'/girard/my-sales');await screen.findByRole('region',{name:'Ringkasan seluruh hasil'})
  fireEvent.click(screen.getByRole('button',{name:'Buka menu'}));const dialog=screen.getByRole('dialog',{name:'Menu utama'});const link=within(dialog).getByRole('link',{name:'Penjualan Saya'});link.focus();expect(document.activeElement).toBe(link);fireEvent.click(link)
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(router.state.location.pathname).toBe('/girard/my-sales')
})

test('a late broad leadership page cannot restore Unassigned after narrowing',async()=>{
  role('sales_head');const pending=deferred();let broad:any
  state.handler=(name:string,args:any)=>{if(name==='pilot_sales_metrics_v2'){if(!args.p_manager_id){broad=page(args,{items:[{person_id:null,person_name:'Unassigned',is_unassigned:true,...values,co_contributing_report_count:'1'}]});return pending.promise}return {data:page(args,{total:'0',items:[],summary:{...zero,co_report_event_count:'0'}}),error:null}}return fixture(name,args)}
  mount(<PerformanceContent/>,'/girard/dashboard');await waitFor(()=>expect(broad).toBeTruthy());await screen.findByRole('option',{name:'Manager B'})
  fireEvent.change(screen.getByLabelText('Manajer'),{target:{value:uuid(2)}});await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});await act(async()=>pending.resolve({data:broad,error:null}));expect(screen.queryByText('Unassigned')).toBeNull();expect(metricsCalls()[0].signal?.aborted).toBe(true)
})

test('returning to the same identity cannot resurrect its older in-flight response',async()=>{
  const pending=deferred();let first:any;let hold=true
  state.handler=(name:string,args:any)=>{if(name==='pilot_sales_metrics_v2'&&state.auth.user.id===uuid(1)&&hold){first=page(args,{items:[{...page(args).items[0],customer_name:'Stale identity generation'}]});hold=false;return pending.promise}return fixture(name,args)}
  mount(<App/>);await waitFor(()=>expect(first).toBeTruthy());role('sales_person',uuid(3));await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});role('sales_person',uuid(1));await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});await act(async()=>pending.resolve({data:first,error:null}));expect(screen.queryByText('Stale identity generation')).toBeNull();expect(metricsCalls()[0].signal?.aborted).toBe(true)
})

test('incomplete manager directory is explicit while the independently authorized totals remain available',async()=>{
  role('sales_head');state.handler=(name:string,args:any)=>name==='pilot_team_directory'?{data:[],count:1,error:null}:fixture(name,args)
  mount(<PerformanceContent/>,'/girard/dashboard');await screen.findByRole('region',{name:'Ringkasan seluruh hasil'});expect(screen.getByText(/Daftar manajer tidak tersedia/)).toBeTruthy();expect(screen.getByRole('button',{name:'Muat ulang daftar manajer'})).toBeTruthy()
})
