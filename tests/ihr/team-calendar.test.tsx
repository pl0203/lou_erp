import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as calendar from '../../src/pages/ihr/leave/TeamLeaveCalendar'
import * as badge from '../../src/pages/ihr/leave/LeaveApprovalBadge'
import { calendarMonthRange } from '../../src/lib/leave/readContracts'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'71000000-0000-0000-0000-000000000003'},profile:{id:'71000000-0000-0000-0000-000000000003',is_active:true},loading:false}}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>mocks.auth}))
const actor=mocks.auth.user.id
const context:LeaveContext={scopeVersion:'one',memberKind:'manager',timezone:'Etc/UTC',balances:[],setup:{ready:false,blockers:[]},capabilities:{request:true,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false}}
const clients:QueryClient[]=[]
function mount(child:React.ReactNode){const q=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(q);return render(<QueryClientProvider client={q}>{child}</QueryClientProvider>)}
function reply(name:string,args?:Record<string,string>){return {data:name==='leave_context_v1'?context:name==='leave_reads_context_v1'?{scopeVersion:'one',calendarAudiences:['own','assigned_team'],defaultRange:{from:'2026-10-01',to:'2026-10-31'},defaultRangeState:'ready'}:name==='leave_approval_counts_v1'?{pendingLeave:31,pendingCancellation:2}:[{employeeId:actor,employeeName:'Fictional manager',date:args!.p_from,approvedMinutes:60,availabilityLabel:'partial_absence'}],error:null}}
beforeEach(()=>{mocks.rpc.mockReset();mocks.rpc.mockImplementation((name:string,args?:Record<string,string>)=>({abortSignal:()=>Promise.resolve(reply(name,args))}))})
afterEach(()=>{cleanup();clients.splice(0).forEach(q=>q.clear())})
test('month derives from confirmed company timezone and never substitutes local timezone',()=>{
 expect(calendarMonthRange('Pacific/Kiritimati',new Date('2026-09-30T12:00:00Z'))).toEqual({from:'2026-10-01',to:'2026-10-31'})
 expect(calendarMonthRange(null)).toBeNull();expect(calendarMonthRange('invalid')).toBeNull()
})
test('calendar shows exact minutes, partial no-clock-time explanation and no private detail route',async()=>{
 expect(calendar.default).toBeTypeOf('function');const Calendar=calendar.default
 mount(<Calendar actorId={actor} context={context}/>);expect(await screen.findByText('Fictional manager')).toBeTruthy()
 expect(screen.getByText('1j')).toBeTruthy();expect(screen.getByText(/waktu mulai dan selesai tidak dicatat/)).toBeTruthy()
 expect(screen.getByText('Sebagian jadwal')).toBeTruthy();expect(screen.queryByRole('link')).toBeNull()
 expect(screen.queryByText(/AM|PM/)).toBeNull();expect(screen.queryByText(/reason|alasan|saldo/i)).toBeNull()
})
test('calendar presents a compact dated agenda with exact leave minutes',async()=>{
 const Calendar=calendar.default;mount(<Calendar actorId={actor} context={context}/>)
 await screen.findByText('Fictional manager')
 const agenda=screen.getByRole('list',{name:'Agenda cuti'})
 expect(within(agenda).getAllByRole('listitem')).toHaveLength(1)
 expect(agenda.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-01')
 expect(within(agenda).getByText('1j')).toBeTruthy()
 expect(screen.queryByRole('grid')).toBeNull()
})
test('audiences come from server and range change revalidates authority before another calendar read',async()=>{
 expect(calendar.default).toBeTypeOf('function');const Calendar=calendar.default
 mount(<Calendar actorId={actor} context={context}/>);await screen.findByText('Fictional manager')
 expect(screen.getByRole('option',{name:'Tim yang ditugaskan'})).toBeTruthy();expect(screen.queryByRole('option',{name:'Akses kalender yang diberikan'})).toBeNull()
 const before=mocks.rpc.mock.calls.length;fireEvent.change(screen.getByLabelText('Cakupan kalender'),{target:{value:'assigned_team'}})
 await waitFor(()=>expect(mocks.rpc.mock.calls.some(([name,args])=>name==='leave_calendar_v1'&&args.p_audience==='assigned_team')).toBe(true))
 expect(mocks.rpc.mock.calls[before][0]).toBe('leave_context_v1')
})
test('unknown company timezone prevents calendar date queries and explains setup blocker',async()=>{
 expect(calendar.default).toBeTypeOf('function');const Calendar=calendar.default
 mocks.rpc.mockImplementation((name:string,args?:Record<string,string>)=>({abortSignal:()=>Promise.resolve(name==='leave_reads_context_v1'?{data:{scopeVersion:'one',calendarAudiences:['own'],defaultRange:null,defaultRangeState:'timezone_unconfirmed'},error:null}:reply(name,args))}))
 mount(<Calendar actorId={actor} context={{...context,timezone:null}}/>);expect(await screen.findByText(/Zona waktu perusahaan belum dikonfirmasi/)).toBeTruthy()
 await act(async()=>{await Promise.resolve()});expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_calendar_v1')).toBe(false)
})
test('calendar read error stays visible, does not claim no absence or reveal diagnostics',async()=>{
 expect(calendar.default).toBeTypeOf('function');const Calendar=calendar.default
 mocks.rpc.mockImplementation((name:string,args?:Record<string,string>)=>({abortSignal:()=>Promise.resolve(name==='leave_calendar_v1'?{data:null,error:{message:'Private reason'}}:reply(name,args))}))
 mount(<Calendar actorId={actor} context={context}/>);expect(await screen.findByText('Kalender belum dapat dimuat.')).toBeTruthy()
 expect(screen.queryByText('Tidak ada cuti disetujui pada rentang ini.')).toBeNull();expect(screen.queryByText('Private reason')).toBeNull()
})
test('badge shows full selected count and distinguishes unavailable from zero',async()=>{
 expect(badge.default).toBeTypeOf('function');const Badge=badge.default
 mount(<Badge actorId={actor} context={context}/>);expect(await screen.findByLabelText('33 persetujuan menunggu')).toBeTruthy()
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(name==='leave_context_v1'?reply(name):{data:null,error:{message:'Private reason'}})}))
 act(()=>window.dispatchEvent(new Event('focus')));expect(await screen.findByText('Jumlah belum tersedia')).toBeTruthy();expect(screen.queryByLabelText('0 persetujuan menunggu')).toBeNull()
})
test('non-approver badge renders no number and starts no reads',()=>{
 expect(badge.default).toBeTypeOf('function');const Badge=badge.default
 mount(<Badge actorId={actor} context={{...context,capabilities:{...context.capabilities,approve:false}}}/>);expect(mocks.rpc).not.toHaveBeenCalled();expect(screen.queryByText('Jumlah belum tersedia')).toBeNull()
})
test('pending authority hides calendar rows and disables interaction immediately',async()=>{
 expect(calendar.default).toBeTypeOf('function');const Calendar=calendar.default
 const q=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(q)
 const view=render(<QueryClientProvider client={q}><Calendar actorId={actor} context={context}/></QueryClientProvider>);await screen.findByText('Fictional manager')
 view.rerender(<QueryClientProvider client={q}><Calendar actorId={actor} context={context} readState="pending"/></QueryClientProvider>)
 expect(screen.queryByText('Fictional manager')).toBeNull();expect(screen.getByText(/Memeriksa akses kalender/)).toBeTruthy()
 expect((screen.getByLabelText('Cakupan kalender') as HTMLSelectElement).disabled).toBe(true)
})
test('director with no personal timezone can use server-confirmed assigned-manager month',async()=>{
 const director:LeaveContext={...context,memberKind:'director',timezone:null,capabilities:{...context.capabilities,request:false}}
 mocks.rpc.mockImplementation((name:string,args?:Record<string,string>)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?director:name==='leave_reads_context_v1'?{scopeVersion:'one',calendarAudiences:['assigned_team'],defaultRange:{from:'2026-10-01',to:'2026-10-31'},defaultRangeState:'ready'}:reply(name,args).data,error:null})}))
 const Calendar=calendar.default;mount(<Calendar actorId={actor} context={director}/>);expect(await screen.findByText('Fictional manager')).toBeTruthy()
 expect((screen.getByLabelText('Cakupan kalender') as HTMLSelectElement).value).toBe('assigned_team')
 expect(screen.queryByRole('option',{name:'Cuti saya'})).toBeNull()
})

test('mixed or unconfirmed timezone keeps manual bounded selection available',async()=>{
 mocks.rpc.mockImplementation((name:string,args?:Record<string,string>)=>({abortSignal:()=>Promise.resolve(name==='leave_reads_context_v1'?{data:{scopeVersion:'one',calendarAudiences:['own'],defaultRange:null,defaultRangeState:'timezone_mixed'},error:null}:reply(name,args))}))
 const Calendar=calendar.default;mount(<Calendar actorId={actor} context={context}/>);await screen.findByText(/Pilih rentang tanggal secara manual/)
 expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_calendar_v1')).toBe(false)
 fireEvent.change(screen.getByLabelText('Dari tanggal'),{target:{value:'2026-10-01'}});fireEvent.change(screen.getByLabelText('Sampai tanggal'),{target:{value:'2026-10-31'}})
 fireEvent.click(screen.getByRole('button',{name:'Tampilkan'}));expect(await screen.findByText('Fictional manager')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('Sampai tanggal'),{target:{value:'2027-01-02'}});const before=mocks.rpc.mock.calls.filter(([name])=>name==='leave_calendar_v1').length
 fireEvent.click(screen.getByRole('button',{name:'Tampilkan'}));expect(screen.getByText(/paling lama 93 hari/)).toBeTruthy();expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_calendar_v1')).toHaveLength(before)
})
test('available calendar audience can be selected when the initial audience is unavailable',async()=>{
 mocks.rpc.mockImplementation((name:string,args?:Record<string,string>)=>({abortSignal:()=>Promise.resolve(name==='leave_reads_context_v1'?{data:{scopeVersion:'one',calendarAudiences:['granted'],defaultRange:args?.p_audience==='granted'?{from:'2026-10-01',to:'2026-10-31'}:null,defaultRangeState:args?.p_audience==='granted'?'ready':'unavailable'},error:null}:reply(name,args))}))
 const Calendar=calendar.default;mount(<Calendar actorId={actor} context={context}/>);await screen.findByText(/Pilih cakupan yang diberikan/)
 expect((screen.getByLabelText('Cakupan kalender') as HTMLSelectElement).disabled).toBe(false)
 fireEvent.change(screen.getByLabelText('Cakupan kalender'),{target:{value:'granted'}});expect(await screen.findByText('Fictional manager')).toBeTruthy()
})
