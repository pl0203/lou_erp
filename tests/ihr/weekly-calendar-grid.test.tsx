import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import TeamLeaveCalendar from '../../src/pages/ihr/leave/TeamLeaveCalendar'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { fixturePeriodPage,weeklyAccess,weeklyPage,weeklyRow,employeeId } from './weekly-calendar-fixtures'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'71000000-0000-0000-0000-000000000003'},profile:{id:'71000000-0000-0000-0000-000000000003',is_active:true},loading:false}}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>mocks.auth}))
const context:LeaveContext={scopeVersion:'one',memberKind:'employee',timezone:'Etc/UTC',balances:[],setup:{ready:false,blockers:[]},capabilities:{request:true,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false}}
const clients:QueryClient[]=[]
let access=weeklyAccess(),page=weeklyPage(),live=context
function response(name:string,args?:Record<string,any>){
 if(name==='leave_context_v1')return live
 if(name==='leave_team_calendar_context_v1')return access
 if(name==='leave_team_calendar_v1'){
  return {...fixturePeriodPage(args!.p_period_start,args!.p_view,page),page:args!.p_page,pageSize:args!.p_page_size}
 }
 // Baseline response lets the red test prove the missing table rather than a transport fixture error.
 if(name==='leave_reads_context_v1')return {scopeVersion:'one',calendarAudiences:['own'],defaultRange:{from:'2026-10-01',to:'2026-10-31'},defaultRangeState:'ready'}
 if(name==='leave_calendar_v1')return [{employeeId,employeeName:'Fictional employee',date:'2026-10-19',approvedMinutes:60,availabilityLabel:'partial_absence'}]
 throw new Error(`Unexpected RPC ${name}`)
}
function mount(readState:'ready'|'pending'|'error'='ready'){
 const q=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(q)
 const view=render(<QueryClientProvider client={q}><TeamLeaveCalendar actorId={mocks.auth.user.id} context={context} readState={readState}/></QueryClientProvider>)
 return {...view,q,rerenderState:(state:'ready'|'pending'|'error')=>view.rerender(<QueryClientProvider client={q}><TeamLeaveCalendar actorId={mocks.auth.user.id} context={context} readState={state}/></QueryClientProvider>)}
}
beforeEach(()=>{mocks.rpc.mockReset();access=weeklyAccess();page=weeklyPage();live=context;mocks.auth.user={id:employeeId};mocks.auth.profile={id:employeeId,is_active:true};mocks.rpc.mockImplementation((name:string,args?:Record<string,any>)=>({abortSignal:()=>Promise.resolve({data:response(name,args),error:null})}))})
afterEach(()=>{cleanup();clients.splice(0).forEach(q=>q.clear())})
test('one semantic table has employee rows, seven date columns and no private or decision controls',async()=>{
 mount();await screen.findByText('Fictional employee')
 const table=screen.getByRole('table',{name:/Kalender cuti mingguan/})
 expect(within(table).getAllByRole('columnheader')).toHaveLength(8)
 expect(within(table).getAllByRole('rowheader')).toHaveLength(1)
 expect(table.querySelectorAll('thead time')).toHaveLength(7)
 expect(within(table).getByText('1j')).toBeTruthy();expect(within(table).getByText('Sebagian jadwal asal')).toBeTruthy()
 expect(screen.queryByRole('link')).toBeNull();expect(screen.queryByText(/alasan|saldo|AM|PM/)).toBeNull()
 expect(screen.queryByRole('button',{name:/Setujui|Tolak/})).toBeNull()
})
test('shows visible pending pinning and distinct status text without relying on color',async()=>{
 page=weeklyPage([weeklyRow(employeeId,'Fictional pending','submitted'),weeklyRow('71000000-0000-0000-0000-000000000004','Fictional cancellation','cancellation_pending'),weeklyRow('71000000-0000-0000-0000-000000000005','Fictional empty',null)])
 mount();await screen.findByText('Fictional pending')
 const table=screen.getByRole('table'),rows=within(table).getAllByRole('row').slice(1)
 expect(within(rows[0]).getByText('Menunggu keputusan')).toBeTruthy();expect(within(rows[0]).getByText('Menunggu persetujuan')).toBeTruthy()
 expect(within(rows[1]).getByText('Pembatalan menunggu')).toBeTruthy()
 expect(rows[0].className).toContain('is-pending');expect(rows[2].className).not.toContain('is-pending')
 expect(within(rows[2]).queryByText(/Menunggu/)).toBeNull()
})
test('peer approved availability cannot acquire a pending marker or derived pending count',async()=>{
 page=weeklyPage([weeklyRow(employeeId,'Fictional approved','approved'),weeklyRow('71000000-0000-0000-0000-000000000004','Fictional empty',null)])
 mount();await screen.findByText('Fictional approved')
 const table=screen.getByRole('table');expect(within(table).queryByText(/Menunggu/)).toBeNull();expect(table.querySelector('.is-pending')).toBeNull()
 expect(within(table).getByText('Disetujui')).toBeTruthy()
})
test('holiday, alternating half-day, unknown setup and stored deductions remain distinct',async()=>{
 const row=weeklyRow();row.days[0]={...row.days[0],schedule:'holiday',scheduledMinutes:0};row.days[2]={...row.days[2],schedule:'unconfigured',scheduledMinutes:null as unknown as number};page=weeklyPage([row])
 mount();await screen.findByText('Fictional employee')
 const table=screen.getByRole('table');expect(within(table).getByText('Libur kalender')).toBeTruthy();expect(within(table).getByText('Jadwal belum dikonfigurasi')).toBeTruthy()
 expect(within(table).getByText('Jadwal 3j 45m')).toBeTruthy();expect(within(table).getByText('1j')).toBeTruthy()
 expect(screen.getByText(/Potongan cuti tersimpan tidak dihitung ulang/)).toBeTruthy()
})
test('previous and next week navigate exactly seven days and refresh current authority',async()=>{
 mount();await screen.findByText('Fictional employee');const before=mocks.rpc.mock.calls.length
 fireEvent.click(screen.getByRole('button',{name:'Minggu sebelumnya'}))
 await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_view:'week',p_period_start:'2026-10-12',p_audience:'sales_team',p_page:1,p_page_size:25}))
 expect(mocks.rpc.mock.calls[before][0]).toBe('leave_context_v1');await screen.findByText('Fictional employee')
 fireEvent.click(screen.getByRole('button',{name:'Minggu berikutnya'}));await screen.findByText('Fictional employee')
 expect(screen.getByLabelText('Tanggal dalam periode').getAttribute('value')).toBe('2026-10-19')
})
test('mixed company timezone never guesses current week but allows explicit aligned date',async()=>{
 access={...weeklyAccess(['own']),defaultDate:null as any,defaultDateState:'timezone_mixed'}
 mount();await screen.findByText(/Zona waktu perusahaan belum dikonfirmasi/)
 expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_team_calendar_v1')).toBe(false)
 fireEvent.change(screen.getByLabelText('Tanggal dalam periode'),{target:{value:'2026-10-22'}});fireEvent.click(screen.getByRole('button',{name:'Tampilkan periode'}))
 await screen.findByText('Fictional employee');expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_view:'week',p_period_start:'2026-10-19',p_audience:'own',p_page:1,p_page_size:25})
})
test('one page hides pagination, multiple pages preserve server order and reset on week change',async()=>{
 page={...weeklyPage(),total:26};mount();await screen.findByText('Fictional employee')
 fireEvent.click(screen.getByRole('button',{name:'Karyawan berikutnya'}));await screen.findByText('Fictional employee')
 expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_view:'week',p_period_start:'2026-10-19',p_audience:'sales_team',p_page:2,p_page_size:25})
 fireEvent.click(screen.getByRole('button',{name:'Minggu berikutnya'}));await screen.findByText('Fictional employee')
 expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_view:'week',p_period_start:'2026-10-26',p_audience:'sales_team',p_page:1,p_page_size:25})
})
test('single-page roster includes employees with no leave and no misleading empty state',async()=>{
 page=weeklyPage([weeklyRow(employeeId,'Fictional no leave',null)]);mount();await screen.findByText('Fictional no leave')
 expect(screen.queryByRole('button',{name:'Karyawan berikutnya'})).toBeNull();expect(screen.queryByText(/Tidak ada karyawan/)).toBeNull()
})
test('pending and failed shared authority hide roster and suspend every calendar control',async()=>{
 const view=mount();await screen.findByText('Fictional employee')
 for(const state of ['pending','error'] as const){view.rerenderState(state);expect(screen.queryByRole('table')).toBeNull();expect((screen.getByLabelText('Cakupan kalender') as HTMLSelectElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Minggu berikutnya'}) as HTMLButtonElement).disabled).toBe(true)}
})
test('revoked or changed scope hides old roster before any further data request',async()=>{
 mount();await screen.findByText('Fictional employee');const before=mocks.rpc.mock.calls.filter(([n])=>n==='leave_team_calendar_v1').length
 live={...context,scopeVersion:'revoked'};act(()=>window.dispatchEvent(new Event('focus')))
 await waitFor(()=>expect(screen.queryByText('Fictional employee')).toBeNull())
 await waitFor(()=>expect(mocks.rpc.mock.calls.filter(([n])=>n==='leave_context_v1').length).toBeGreaterThan(2))
 expect(mocks.rpc.mock.calls.filter(([n])=>n==='leave_team_calendar_v1')).toHaveLength(before)
})
test('calendar errors stay errors, sanitize diagnostics, and do not claim no leave',async()=>{
 mocks.rpc.mockImplementation((name:string,args?:Record<string,any>)=>({abortSignal:()=>Promise.resolve(name==='leave_team_calendar_v1'?{data:null,error:{message:'secret employee reason'}}:{data:response(name,args),error:null})}))
 mount();await screen.findByText('Kalender belum dapat dimuat.');expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByText(/secret employee/)).toBeNull();expect(screen.queryByText(/Tidak ada karyawan/)).toBeNull()
})
test('inactive identity starts no RPC and cannot expose cached calendar',async()=>{
 mocks.auth.profile.is_active=false;mount();await act(async()=>{await Promise.resolve()});expect(mocks.rpc).not.toHaveBeenCalled();expect(screen.queryByRole('table')).toBeNull()
})
test('narrow screen keeps one scrollable table and no duplicated controls or IDs',async()=>{
 mount();await screen.findByText('Fictional employee');const table=screen.getByRole('table'),before=mocks.rpc.mock.calls.length
 Object.defineProperty(window,'innerWidth',{value:375,configurable:true});act(()=>window.dispatchEvent(new Event('resize')))
 expect(screen.getByRole('table')).toBe(table);expect(mocks.rpc).toHaveBeenCalledTimes(before)
 const ids=Array.from(document.querySelectorAll('[id]')).map(node=>node.id);expect(new Set(ids).size).toBe(ids.length)
 expect(screen.getByRole('region',{name:'Tabel kalender, geser untuk melihat semua tanggal'}).getAttribute('tabindex')).toBe('0')
 const css=readFileSync('src/pages/ihr/leave/team-leave-calendar.css','utf8');expect(css).toContain('overflow-x: auto');expect(css).toContain('position: sticky')
})

test('month toggle shows exact calendar dates, resets paging and keeps the same audience',async()=>{
 mount();await screen.findByText('Fictional employee')
 fireEvent.click(screen.getByRole('button',{name:'Bulanan'}))
 await screen.findByText('Fictional employee')
 expect(screen.getByRole('button',{name:'Bulanan'}).getAttribute('aria-pressed')).toBe('true')
 expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(32)
 expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_period_start:'2026-10-01',p_view:'month',p_audience:'sales_team',p_page:1,p_page_size:25})
 fireEvent.click(screen.getByRole('button',{name:'Bulan berikutnya'}));await screen.findByText('Fictional employee')
 expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(31)
 expect(mocks.rpc).toHaveBeenCalledWith('leave_team_calendar_v1',{p_period_start:'2026-11-01',p_view:'month',p_audience:'sales_team',p_page:1,p_page_size:25})
 fireEvent.click(screen.getByRole('button',{name:'Mingguan'}));await screen.findByText('Fictional employee')
 expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(8)
})

test('compact month blocks retain visible status words, not color alone',async()=>{
 page=weeklyPage([weeklyRow(employeeId,'Fictional pending','submitted')]);mount();await screen.findByText('Fictional pending')
 fireEvent.click(screen.getByRole('button',{name:'Bulanan'}));await screen.findByText('Fictional pending')
 const labels=within(screen.getByRole('table')).getAllByText('Tunggu')
 expect(labels.length).toBeGreaterThan(0);expect(labels[0].className).not.toContain('sr-only')
})

test('month and week round-trips preserve an October anchor instead of drifting into September',async()=>{
 mount();await screen.findByText('Fictional employee')
 fireEvent.change(screen.getByLabelText('Tanggal dalam periode'),{target:{value:'2026-10-01'}});fireEvent.click(screen.getByRole('button',{name:'Tampilkan periode'}));await screen.findByText('Fictional employee')
 fireEvent.click(screen.getByRole('button',{name:'Bulanan'}));await screen.findByText('Fictional employee')
 expect(screen.getByRole('table').querySelector('thead time')?.getAttribute('datetime')).toBe('2026-10-01')
 fireEvent.click(screen.getByRole('button',{name:'Mingguan'}));await screen.findByText('Fictional employee')
 fireEvent.click(screen.getByRole('button',{name:'Bulanan'}));await screen.findByText('Fictional employee')
 expect(screen.getByRole('table').querySelector('thead time')?.getAttribute('datetime')).toBe('2026-10-01')
})

test('late previous-week response cannot replace a newer monthly calendar',async()=>{
 mount();await screen.findByText('Fictional employee')
 const normal=mocks.rpc.getMockImplementation()!;let finish!:(value:unknown)=>void,oldSignal!:AbortSignal
 mocks.rpc.mockImplementation((name:string,args?:Record<string,any>)=>name==='leave_team_calendar_v1'&&args?.p_view==='week'&&args?.p_period_start==='2026-10-12'?{abortSignal:(signal:AbortSignal)=>{oldSignal=signal;return new Promise(resolve=>finish=resolve)}}:normal(name,args))
 fireEvent.click(screen.getByRole('button',{name:'Minggu sebelumnya'}));await waitFor(()=>expect(finish).toBeTypeOf('function'))
 await waitFor(()=>expect((screen.getByRole('button',{name:'Bulanan'}) as HTMLButtonElement).disabled).toBe(false))
 fireEvent.click(screen.getByRole('button',{name:'Bulanan'}));await screen.findByText('Fictional employee')
 expect(oldSignal.aborted).toBe(true)
 const stale=fixturePeriodPage('2026-10-12','week',weeklyPage([weeklyRow(employeeId,'Stale private calendar','submitted')]))
 await act(async()=>finish({data:stale,error:null}))
 expect(screen.queryByText('Stale private calendar')).toBeNull();expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(32)
})
