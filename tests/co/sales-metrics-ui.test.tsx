import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { deferred, fixture, metricsCalls, months, mount, page, role, state, uuid, values, zero } from './sales-ui-harness'
import App from '../../src/App'
import { CustomerPerformanceContent } from '../../src/pages/girard/CustomerPerformance'
import { PerformanceContent } from '../../src/pages/girard/GirardPerformance'
import { RevenueContent } from '../../src/pages/girard/GirardRevenue'
const sales = () => screen.getByRole('region',{name:'Metrik Sales'})
const change = (label:string,value:string) => fireEvent.change(within(sales()).getByLabelText(label),{target:{value}})
async function ready() { await screen.findByRole('region',{name:'Ringkasan seluruh hasil'}); return sales() }
function assertAmount(label:string,amount:string,region:HTMLElement=screen.getByRole('region',{name:'Ringkasan seluruh hasil'})) { const card=within(region).getByText(label).closest('article')!; expect(within(card as HTMLElement).getByText(amount)).toBeTruthy() }

test('own route presents three independent exact metrics and posted/partial coverage definitions',async()=>{
  mount(<App/>); await ready()
  expect(screen.getByRole('heading',{name:'Penjualan Saya'})).toBeTruthy()
  assertAmount('PO Order Value','Rp 1.000.000'); assertAmount('PO Delivered Revenue','Rp 300.000'); assertAmount('CO Sold Revenue','Rp 720.000')
  expect(within(sales()).getByText(/belum dilaporkan/i)).toBeTruthy()
  expect(within(sales()).getByText(/sebagian bulan/i)).toBeTruthy()
  expect(within(sales()).getByText(/waktu pembacaan/i)).toBeTruthy()
  expect(within(sales()).queryByText('Rp 2.020.000')).toBeNull()
  expect(metricsCalls()[0].args).toEqual({p_manager_id:null,p_month_from:'2026-10-01',p_month_until:'2026-11-01',p_group_by:'customer',p_order_type:'all',p_page:1,p_page_size:20})
  expect(metricsCalls()[0].signal?.aborted).toBe(false)
  expect(state.raw).not.toHaveBeenCalled()
})

test('whole-month controls include authorized CO-only history and bind leap/December ranges and type',async()=>{
  mount(<App/>); await ready()
  expect(within(sales()).getAllByRole('option',{name:/Februari 2024/})).toHaveLength(2)
  change('Dari bulan','2024-02'); change('Sampai bulan','2024-02'); await waitFor(()=>expect(metricsCalls().at(-1)?.args).toMatchObject({p_month_from:'2024-02-01',p_month_until:'2024-03-01'}))
  change('Sampai bulan','2025-12'); change('Dari bulan','2025-12'); await waitFor(()=>expect(metricsCalls().at(-1)?.args).toMatchObject({p_month_from:'2025-12-01',p_month_until:'2026-01-01'}))
  change('Dari bulan','2025-02'); change('Sampai bulan','2025-02'); await waitFor(()=>expect(metricsCalls().at(-1)?.args).toMatchObject({p_month_from:'2025-02-01',p_month_until:'2025-03-01'}))
  change('Jenis pesanan','po'); await ready(); await waitFor(()=>assertAmount('CO Sold Revenue','Rp 0'))
  change('Jenis pesanan','co'); await ready(); await waitFor(()=>assertAmount('PO Order Value','Rp 0')); assertAmount('PO Delivered Revenue','Rp 0'); assertAmount('CO Sold Revenue','Rp 720.000')
  expect(state.calls.filter(c=>c.name==='pilot_sales_metric_months_v2').map(c=>c.args.p_order_type)).toEqual(['all','po','co'])
  expect(state.calls.every(c=>['pilot_sales_metric_months_v2','pilot_sales_metrics_v2'].includes(c.name))).toBe(true)
})

test('more than 100 rows use server summaries, exact pagination, and reset to page one on filters',async()=>{
  state.handler=(name:string,args:any)=>{
    if(name!=='pilot_sales_metrics_v2')return fixture(name,args)
    const all=Array.from({length:101},(_,n)=>({customer_id:uuid(100+n),customer_name:`Store ${n+1}`,...zero,po_order_value:'10000.00',po_order_count:'1',co_report_event_count:'0'}))
    return {data:page(args,{total:'101',summary:{...zero,po_order_value:'1010000.00',po_order_count:'101',co_report_event_count:'0'},items:all.slice((args.p_page-1)*20,args.p_page*20)}),error:null}
  }
  mount(<App/>); await ready(); assertAmount('PO Order Value','Rp 1.010.000')
  fireEvent.click(within(sales()).getByRole('button',{name:'Berikutnya'})); await screen.findByText('Store 21'); assertAmount('PO Order Value','Rp 1.010.000')
  expect(within(sales()).getByText('21–40 dari 101')).toBeTruthy()
  change('Dari bulan','2026-09'); await waitFor(()=>expect(metricsCalls().at(-1)?.args.p_page).toBe(1))
  await screen.findByText('Store 1'); expect(metricsCalls()).toHaveLength(3)
})

test('huge counts and money never round through Number or sum visible rows',async()=>{
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{total:'9007199254740993',summary:{...values,co_sold_revenue:'2147483646999978525163.53',co_report_event_count:'1'},items:Array.from({length:20},(_,n)=>({customer_id:uuid(100+n),customer_name:`Store ${n}`,...zero,co_report_event_count:'0'}))}),error:null}:fixture(name,args)
  mount(<App/>); await ready(); assertAmount('CO Sold Revenue','Rp 2.147.483.646.999.978.525.163,53')
  expect(within(sales()).getByText('1–20 dari 9.007.199.254.740.993')).toBeTruthy()
})

test('person shared-report contributions are nonadditive and inactive credit is not current activity credit',async()=>{
  role('sales_head')
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{total:'2',items:[{person_id:uuid(11),person_name:'Original inactive PIC',is_unassigned:false,...values,co_sold_revenue:'600000.00',co_sold_order_count:'1',co_contributing_report_count:'1'},{person_id:uuid(12),person_name:'Changed-role original PIC',is_unassigned:false,...zero,co_sold_revenue:'120000.00',co_sold_order_count:'1',co_contributing_report_count:'1'}]}),error:null}:fixture(name,args)
  mount(<PerformanceContent/>,'/girard/dashboard'); await ready()
  const summary=screen.getByRole('region',{name:'Ringkasan seluruh hasil'})
  expect(within(summary).getByText('Laporan CO (pelanggan/bulan): 1')).toBeTruthy()
  expect(within(sales()).getByText(/tidak dapat dijumlahkan antar orang/i)).toBeTruthy()
  expect(within(sales()).getAllByText('Kontribusi laporan CO: 1')).toHaveLength(2)
  expect(within(sales()).getByText('Original inactive PIC')).toBeTruthy()
  expect(within(sales()).queryByText('Current team cohort')).toBeNull()
  expect(screen.getAllByText('Current team cohort').length).toBeGreaterThan(0)
  expect(within(sales()).queryAllByRole('button',{name:/target/i})).toHaveLength(0)
})

test('customer Dashboard preserves current-owner activity/target comparison independently of CO-only facts',async()=>{
  role('sales_head'); mount(<CustomerPerformanceContent/>,'/girard/dashboard'); await ready()
  expect(within(sales()).getByText('CO-only store')).toBeTruthy()
  expect(within(sales()).queryByText('Current store owner')).toBeNull()
  expect(screen.getAllByText('Current store owner').length).toBeGreaterThan(0)
  expect(screen.getAllByText('50%').length).toBeGreaterThan(0)
  expect(state.raw).not.toHaveBeenCalled()
})

test('explicit zero reports retain customer events without fictional person rows',async()=>{
  role('sales_head')
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{total:'0',summary:{...zero,co_report_event_count:'1'},items:[]}),error:null}:fixture(name,args)
  mount(<PerformanceContent/>,'/girard/dashboard'); await ready(); assertAmount('CO Sold Revenue','Rp 0')
  expect(within(sales()).getByText('Laporan CO (pelanggan/bulan): 1')).toBeTruthy()
  expect(within(sales()).getByText(/Tidak ada kontribusi orang/i)).toBeTruthy()
})

test('correction and repeated refresh replace amounts once without increasing counts',async()=>{
  let corrected=false
  state.handler=(name:string,args:any)=>{if(name!=='pilot_sales_metrics_v2')return fixture(name,args); const data=page(args); if(corrected){data.summary.co_sold_revenue='700000.00';data.items[0].co_sold_revenue='700000.00'} return {data,error:null}}
  mount(<App/>);await ready();corrected=true
  for(let i=0;i<2;i++){fireEvent.click(within(sales()).getByRole('button',{name:'Muat ulang metrik'}));await waitFor(()=>assertAmount('CO Sold Revenue','Rp 700.000'))}
  expect(within(screen.getByRole('region',{name:'Ringkasan seluruh hasil'})).getByText('CO dengan penjualan: 2')).toBeTruthy()
  expect(within(sales()).queryByText('Rp 720.000')).toBeNull()
})

test.each(['metrics','months','decoder'])('%s failure is unavailable and retryable, never manufactured zero',async(kind)=>{
  let fail=true
  state.handler=(name:string,args:any)=>{if(fail && name===(kind==='months'?'pilot_sales_metric_months_v2':'pilot_sales_metrics_v2'))return kind==='decoder'?{data:{...page(args),evidence_path:'secret/co.pdf'},error:null}:{data:null,error:new Error('offline')};return fixture(name,args)}
  mount(<App/>); await waitFor(()=>expect(within(sales()).getByRole('alert')).toBeTruthy())
  expect(within(sales()).queryByText(/^Rp /)).toBeNull(); expect(sales().innerHTML).not.toContain('secret/co.pdf')
  fail=false;fireEvent.click(within(sales()).getByRole('button',{name:'Coba lagi'}));await ready();assertAmount('CO Sold Revenue','Rp 720.000')
})

test('failed refresh removes previous successful values',async()=>{
  mount(<App/>);await ready();state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:null,error:new Error('offline')}:fixture(name,args)
  fireEvent.click(within(sales()).getByRole('button',{name:'Muat ulang metrik'}));await waitFor(()=>expect(within(sales()).getByRole('alert')).toBeTruthy());expect(within(sales()).queryByText(/^Rp /)).toBeNull()
})

test('null earliest month is truthful empty scope, not directory failure',async()=>{
  state.handler=(name:string,args:any)=>name==='pilot_sales_metric_months_v2'?{data:months(args,null),error:null}:name==='pilot_sales_metrics_v2'?{data:page(args,{total:'0',summary:{...zero,co_report_event_count:'0'},items:[]}),error:null}:fixture(name,args)
  mount(<App/>);await ready();expect(within(sales()).getByText(/Belum ada bulan metrik/i)).toBeTruthy();expect(within(sales()).queryByRole('alert')).toBeNull();assertAmount('CO Sold Revenue','Rp 0')
})

test('late old-type/page responses cannot appear under new filters and Back/Forward restores semantics',async()=>{
  const pending=deferred(); let oldArgs:any
  state.handler=(name:string,args:any)=>{if(name==='pilot_sales_metrics_v2'&&args.p_order_type==='po'){oldArgs=args;return pending.promise}return fixture(name,args)}
  const {router}=mount(<App/>);await ready();change('Jenis pesanan','po');await waitFor(()=>expect(oldArgs).toBeTruthy());expect(within(sales()).queryByText('Rp 720.000')).toBeNull()
  change('Jenis pesanan','co');await ready();await act(async()=>pending.resolve({data:page(oldArgs),error:null}));assertAmount('PO Order Value','Rp 0');expect(within(sales()).getByLabelText('Jenis pesanan')).toHaveProperty('value','co')
  await act(async()=>router.navigate(-1));await ready();expect(within(sales()).getByLabelText('Jenis pesanan')).toHaveProperty('value','po');assertAmount('CO Sold Revenue','Rp 0')
  await act(async()=>router.navigate(1));await ready();expect(within(sales()).getByLabelText('Jenis pesanan')).toHaveProperty('value','co')
})

test('compatibility RevenueContent uses v2 without legacy ranking or invented owner/last-sale data',async()=>{
  role('sales_head');mount(<RevenueContent/>,'/compatibility');await ready();assertAmount('CO Sold Revenue','Rp 720.000');expect(state.calls.some(c=>c.name==='pilot_revenue_v1')).toBe(false);expect(within(sales()).queryByText(/Peringkat|Pesanan Terakhir|Penanggung Jawab Toko/)).toBeNull()
})

test('activity month changes do not show previous cohort figures under the new month',async()=>{
  role('sales_head');const pending=deferred()
  state.handler=(name:string,args:any)=>name==='pilot_customer_performance_v1'&&args.p_year_month==='2026-09'?pending.promise:fixture(name,args)
  mount(<CustomerPerformanceContent/>,'/girard/dashboard');await ready();await screen.findAllByText('Current activity cohort')
  fireEvent.change(screen.getByLabelText('Bulan aktivitas pelanggan'),{target:{value:'2026-09'}})
  await waitFor(()=>expect(state.calls.some(c=>c.name==='pilot_customer_performance_v1'&&c.args.p_year_month==='2026-09')).toBe(true))
  expect(screen.queryAllByText('Current activity cohort')).toHaveLength(0)
  expect(within(sales()).getByText('CO-only store')).toBeTruthy()
  await act(async()=>pending.resolve(fixture('pilot_customer_performance_v1',{p_page:1,p_page_size:50})))
})

test('a zero-report customer remains visible and a positive zero-price allocation keeps its count',async()=>{
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{total:'2',summary:{...zero,co_sold_order_count:'1',co_report_event_count:'2'},items:[{customer_id:uuid(40),customer_name:'Explicit zero report',...zero,co_report_event_count:'1'},{customer_id:uuid(41),customer_name:'Zero price sold stock',...zero,co_sold_order_count:'1',co_report_event_count:'1'}]}),error:null}:fixture(name,args)
  mount(<App/>);await ready();expect(within(sales()).getByText('Explicit zero report')).toBeTruthy();assertAmount('CO Sold Revenue','Rp 0')
  expect(within(screen.getByRole('region',{name:'Zero price sold stock'})).getByText('CO dengan penjualan: 1')).toBeTruthy()
})

test('the PostgreSQL page ceiling keeps exact total and disables only unavailable navigation',async()=>{
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{total:'9007199254740993',items:Array.from({length:20},(_,n)=>({customer_id:uuid(n+100),customer_name:`Large page ${n}`,...zero,co_report_event_count:'0'}))}),error:null}:fixture(name,args)
  mount(<App/>,'/girard/my-sales?sales_customer_page=2147483647');await ready()
  expect(within(sales()).getByRole('button',{name:'Berikutnya'})).toHaveProperty('disabled',true)
  expect(within(sales()).getByRole('button',{name:'Sebelumnya'})).toHaveProperty('disabled',false)
  expect(within(sales()).getByText('42.949.672.921–42.949.672.940 dari 9.007.199.254.740.993')).toBeTruthy()
})

test('newer page wins after an interrupted page request and returns to the labelled first page',async()=>{
  const pending=deferred();let second:any
  state.handler=(name:string,args:any)=>{if(name!=='pilot_sales_metrics_v2')return fixture(name,args);const data=page(args,{total:'21',items:Array.from({length:args.p_page===1?20:1},(_,n)=>({customer_id:uuid(100+n),customer_name:args.p_page===1?`First page ${n}`:'Old second page',...zero,co_report_event_count:'0'}))});if(args.p_page===2){second=data;return pending.promise}return {data,error:null}}
  const {router}=mount(<App/>);await ready();fireEvent.click(within(sales()).getByRole('button',{name:'Berikutnya'}));await waitFor(()=>expect(second).toBeTruthy());expect(screen.queryByText('First page 0')).toBeNull()
  await act(async()=>router.navigate(-1));await ready();await act(async()=>pending.resolve({data:second,error:null}));expect(screen.queryByText('Old second page')).toBeNull();expect(screen.getByText('First page 0')).toBeTruthy()
})

test('month-directory responses resolved out of order never restore broader history',async()=>{
  const pending=deferred();let old:any
  state.handler=(name:string,args:any)=>{if(name==='pilot_sales_metric_months_v2'){if(args.p_order_type==='po'){old=months(args,'2000-01-01');return pending.promise}return {data:months(args,args.p_order_type==='co'?'2026-09-01':'2024-02-01'),error:null}}return fixture(name,args)}
  mount(<App/>);await ready();change('Jenis pesanan','po');await waitFor(()=>expect(old).toBeTruthy());change('Jenis pesanan','co');await ready();await act(async()=>pending.resolve({data:old,error:null}));expect(within(sales()).queryAllByRole('option',{name:/2000|Februari 2024/})).toHaveLength(0)
})

test('a failing independent activity read leaves valid Sales available and never invents activity zero',async()=>{
  role('sales_head');state.handler=(name:string,args:any)=>name==='pilot_customer_performance_v1'?{data:null,error:new Error('activity failed')}:fixture(name,args)
  mount(<CustomerPerformanceContent/>,'/girard/dashboard');await ready();expect(screen.getByText(/Data performa tidak tersedia/)).toBeTruthy();assertAmount('CO Sold Revenue','Rp 720.000');expect(screen.queryByText('0/0 kunjungan')).toBeNull()
})

test('native controls and unified responsive metric cards retain accessible exact values and long names',async()=>{
  const longName='NamaPelangganTanpaSpasi'.repeat(12)
  state.handler=(name:string,args:any)=>name==='pilot_sales_metrics_v2'?{data:page(args,{items:[{...page(args).items[0],customer_name:longName}]}),error:null}:fixture(name,args)
  mount(<App/>);await ready();const name=within(sales()).getByText(longName);expect(name.className).toContain('overflow-wrap:anywhere')
  const filter=within(sales()).getByLabelText('Jenis pesanan');filter.focus();expect(document.activeElement).toBe(filter);expect(filter.tagName).toBe('SELECT')
  for(const article of sales().querySelectorAll('article')) expect(article.className).toContain('min-w-0')
  expect(within(screen.getByRole('region',{name:longName})).getByText('Rp 720.000')).toBeTruthy()
})
