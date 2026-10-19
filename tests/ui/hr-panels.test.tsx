import { weeklyAccess,weeklyPage,weeklyRow } from '../ihr/weekly-calendar-fixtures'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA, employeeB, managerA, directorA, hrA } from '../ihr/fixtures'
const mocks = vi.hoisted(() => ({listeners:new Set<()=>void>(),rpc:vi.fn(),auth:{user:{id:'71000000-0000-0000-0000-000000000001'},profile:{id:'71000000-0000-0000-0000-000000000001',is_active:true,role:'sales_person',full_name:'Fictional actor'},loading:false,signOut:vi.fn()}}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',async()=>{const {useEffect,useReducer}=await import('react');return {useAuth:()=>{const [,update]=useReducer(n=>n+1,0);useEffect(()=>{mocks.listeners.add(update);return()=>{mocks.listeners.delete(update)}},[]);return mocks.auth}}})
import { quoteFixture, quoteInput, quoteScope } from '../ihr/quote-fixture'
import LeaveManagement from '../../src/pages/ihr/LeaveManagement'
import { leaveKeys } from '../../src/lib/leave/queryKeys'
const scope=quoteScope,requestId='82000000-0000-0000-0000-000000000001'
const none={request:false,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false}
const personal:LeaveContext={scopeVersion:scope,memberKind:'employee',capabilities:{...none,request:true},setup:{ready:false,blockers:[]},balances:[],timezone:'Etc/UTC',currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'}}
const summary={id:requestId,sequence:1,startDate:'2026-10-09',endDate:'2026-10-09',duration:{mode:'full_scheduled_day'},totalMinutes:450,status:'submitted',version:1,submittedAt:'2026-10-03T00:00:00Z',sourceKind:'submission',employee:{id:employeeA,name:'Fictional employee'},cancellationAttemptId:null,cancellationRequestedAt:null}
const detail={...summary,reason:'Fictional private reason',approverName:'Fictional manager',days:[{date:'2026-10-09',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:450}],cancellation:null,balanceContext:{basis:'current',asOf:'2026-10-03T01:00:00Z',periods:[{year:2026,reservedMinutes:450,usedMinutes:900,availableMinutes:4050,expiredMinutes:0,reconciled:true}]}}
const settings={employeeId:employeeA,authorityKey:'a'.repeat(64),memberVersion:2,policy:null,policyDrafts:[],governance:[],readiness:{ready:false,blockers:[{code:'RETENTION_UNCONFIRMED',message:'Retensi belum disetujui'}]},impacts:{available:false,pendingCount:null,approvedCount:null}}
let ownRows:any[]
let context:LeaveContext, audiences:string[], targets:any[], rows:any[], counts:{pendingLeave:number;pendingCancellation:number}
let pausedContext=false, rejectContext=false, pendingSignals:AbortSignal[],finishMutation:((value:any)=>void)|undefined
const clients:QueryClient[]=[],routers:ReturnType<typeof createMemoryRouter>[]=[]
function response(name:string,args:any={}){
 if(name==='leave_context_v1')return context
 if(name==='leave_quote_v1')return quoteFixture
 if(name==='leave_team_calendar_context_v1')return {...weeklyAccess(audiences),scopeVersion:context.scopeVersion}
 if(name==='leave_team_calendar_v1')return {...weeklyPage([weeklyRow(employeeA,'Fictional calendar employee')]),scopeVersion:context.scopeVersion}
 if(name==='leave_approval_counts_v1')return counts
 if(name==='leave_assigned_inbox_v1')return {rows,nextBefore:null}
 if(name==='leave_assigned_request_v1')return detail
 if(name==='leave_admin_targets_v1')return {rows:targets,total:targets.length,page:args.p_page,pageSize:args.p_page_size}
 if(name==='leave_hr_requests_v1'){const {employee,cancellationAttemptId,cancellationRequestedAt,...own}=summary;return {employeeId:args.p_employee_id,scopeVersion:context.scopeVersion,authorityKey:'a'.repeat(64),rows:[own],nextBefore:null}}
 if(name==='leave_hr_request_v1'){const {employee,cancellationAttemptId,cancellationRequestedAt,cancellation,balanceContext,...own}=detail;return {employeeId:args.p_employee_id,scopeVersion:context.scopeVersion,authorityKey:'a'.repeat(64),request:own}}
 if(name==='leave_hr_request_history_v1'){const old=!!args.p_before_at;const row={id:old?'84000000-0000-0000-0000-000000000002':'84000000-0000-0000-0000-000000000001',event:'rejected',atTime:old?'2026-10-02T10:00:00Z':'2026-10-03T10:00:00Z',actor:{id:managerA,name:'Fictional reviewer'},reason:old?'Fictional older event':'Fictional event reason',approverName:null};return {employeeId:args.p_employee_id,requestId:args.p_request_id,scopeVersion:context.scopeVersion,authorityKey:'a'.repeat(64),rows:[row],nextBefore:old?null:{atTime:row.atTime,id:row.id}}}
 if(name==='leave_balance_accounts_v1')return {currentPeriod:personal.currentPeriod,balances:[{accountId:employeeB,year:2026,allowanceMinutes:5400,approvedMinutes:450,pendingMinutes:0,availableMinutes:4950,expiredMinutes:0,version:2,reconciled:true}]}
 if(name==='leave_balance_history_v1')return {balance:response('leave_balance_accounts_v1').balances[0],rows:[{id:employeeA,sequence:1,date:'2026-10-02',kind:'adjustment',allowanceDelta:60,reservedDelta:0,usedDelta:0}],nextBefore:null}
 if(name==='leave_admin_write_context_v1')return {employeeId:args.p_employee_id,scopeVersion:context.scopeVersion,authorityKey:'a'.repeat(64),capabilities:{configure:context.capabilities.configure,adjust:context.capabilities.adjust},balance:{state:'verified',currentPeriod:personal.currentPeriod,account:{accountId:employeeB,year:2026,version:2,reconciled:true}},memberOptions:context.capabilities.configure?{state:'available',calendars:[{id:employeeB,name:'Fictional current lineage'}],groups:[]}:null}
 if(name==='leave_admin_setup_v1')return {rows:args.p_section==='members'?[{id:employeeA,name:'Fictional target',memberKind:'employee',active:true,employmentStart:'2020-01-01',eligibilityDate:'2021-01-01',calendarId:employeeB,version:1,impacts:{available:false,pendingCount:null,approvedCount:null},assignments:[],memberships:[]}]:[],total:args.p_section==='members'?1:0,page:args.p_page,pageSize:args.p_page_size}
 if(name==='leave_admin_settings_v1')return {...settings,employeeId:args.p_employee_id}
 if(name==='leave_admin_access_v1')return {employeeId:args.p_employee_id,authorityKey:'a'.repeat(64),grants:[],manifests:[]}
 if(name==='leave_admin_requests_v1')return {rows:[],nextBefore:null}
 if(name==='leave_own_history_v1')return {rows:ownRows,nextBefore:null}
 if(name==='leave_own_request_history_v1')return {requestId:args.p_request_id,requestVersion:1,scopeVersion:context.scopeVersion,rows:[],nextBefore:null}
 if(name==='leave_own_request_v1'){const {employee,cancellationAttemptId,cancellationRequestedAt,cancellation,balanceContext,...own}=detail;return own}
 if(name==='leave_request_transition_state_v1')return {id:requestId,version:1,status:'submitted',canWithdraw:true,canRequestCancellation:false,cancellationBlocker:null,activeAttemptId:null}
 throw new Error('Unexpected fixture RPC '+name)
}
function serve(){mocks.rpc.mockImplementation((name:string,args:any)=>{
 if(mocks.rpc.mock.calls.length>50)throw new Error('Fixture request budget exceeded')
 if(name==='leave_transaction_v1')return new Promise(resolve=>{finishMutation=resolve})
 return {abortSignal:(signal:AbortSignal)=>{
  if(name==='leave_context_v1'&&pausedContext){pendingSignals.push(signal);return new Promise(()=>{})}
  if(name==='leave_context_v1'&&rejectContext)return Promise.reject(new Error('Private diagnostic'))
  return Promise.resolve({data:response(name,args),error:null})
 }}
})}
function identity(id:string){mocks.auth.user.id=id;mocks.auth.profile.id=id}
function mount(client=new QueryClient({defaultOptions:{queries:{retry:false}}})){clients.push(client);const router=createMemoryRouter([{path:'/ihr/leave',element:<LeaveManagement/>},{path:'/away',element:<p>Other page</p>}],{initialEntries:['/ihr/leave']});routers.push(router);const element=()=> <QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>;const view=render(element());return {client,router,view,element}}
function guarded(){const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}
function tab(name:string){return screen.getByRole('tab',{name:new RegExp(name)})}
beforeEach(()=>{vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});identity(employeeA);mocks.auth.profile.role='sales_person';mocks.auth.profile.is_active=true;context=personal;audiences=['own'];ownRows=[];targets=[];rows=[summary];counts={pendingLeave:1,pendingCancellation:2};pausedContext=false;rejectContext=false;pendingSignals=[];finishMutation=undefined;localStorage.clear();onlineManager.setOnline(true);vi.spyOn(window,'confirm').mockReturnValue(false);serve()})
afterEach(()=>{cleanup();routers.splice(0).forEach(r=>r.dispose());clients.splice(0).forEach(c=>c.clear());onlineManager.setOnline(true);vi.restoreAllMocks();vi.unstubAllGlobals();mocks.rpc.mockReset();mocks.auth.signOut.mockClear()})

function mainTarget(){
 const main=screen.getByRole('main')
 expect(main.id).toBe('main-content');expect(main.getAttribute('tabindex')).toBe('-1')
 expect(document.querySelectorAll('#main-content')).toHaveLength(1)
 expect(main.className).toContain('ui-main-content')
 return main
}
async function openRequest(){fireEvent.click(await screen.findByRole('button',{name:'Ajukan cuti'}));await screen.findByLabelText('Tanggal mulai')}
function fillRequest(){for(const [label,value] of [['Tanggal mulai',quoteInput.startDate],['Tanggal selesai',quoteInput.endDate],['Alasan pribadi',quoteInput.reason]])fireEvent.change(screen.getByLabelText(label),{target:{value}})}

test('real route owns one focusable main through initial loading ready and setup-blocked states',async()=>{
 pausedContext=true;mount();mainTarget();expect(screen.getByText('Memuat akses cuti...')).toBeTruthy()
 pausedContext=false;fireEvent(window,new Event('focus'))
 // Replace the pending context by an explicit current completion, not cached success.
 const client=clients[0];await act(async()=>{await client.cancelQueries({queryKey:leaveKeys.context(employeeA,'current'),exact:true});await client.refetchQueries({queryKey:leaveKeys.context(employeeA,'current'),exact:true})})
 await screen.findByRole('tab',{name:'Ajukan Cuti'});mainTarget()
 expect(screen.getByRole('heading',{name:'Ajukan Cuti'}).closest('header')?.className).toContain('ui-page-header')
 const setup=screen.getByRole('heading',{name:'Pengaturan cuti belum lengkap'}).closest('section')!
 expect(setup.getAttribute('role')).toBe('status');expect(setup.className).toContain('ui-notice--warning')
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByText('0j')).toBeNull()
})
test.each(['transport','denied'] as const)('safe %s authority error retains one main and its exact native focus target',async(kind)=>{
 const normal=mocks.rpc.getMockImplementation()!
 mocks.rpc.mockImplementation((name,args)=>name==='leave_context_v1'?{abortSignal:()=>Promise.resolve({data:null,error:{code:kind==='denied'?'42501':'55000',message:'Private diagnostic'}})}:normal(name,args))
 mount();const error=await screen.findByRole('alert');mainTarget()
 await waitFor(()=>expect(document.activeElement).toBe(error));expect(error.tagName).toBe('DIV');expect(error.className).toContain('ui-notice--error')
 expect(screen.queryByText('Private diagnostic')).toBeNull();expect(screen.queryByRole('tab')).toBeNull()
 expect(within(error).getByRole('button',{name:'Coba lagi'}).className).toContain('ui-action--secondary')
})
test('application admin role alone grants no HR actions while calendar-only capability stays separate',async()=>{
 identity(hrA);mocks.auth.profile.role='admin';context={...personal,memberKind:null,capabilities:none,currentPeriod:null};audiences=[]
 const {client}=mount();await screen.findByText('Belum ada akses cuti yang diberikan. Hubungi administrator HR.');mainTarget()
 expect(screen.queryByRole('tab')).toBeNull();expect(screen.queryByRole('button',{name:'Ajukan cuti'})).toBeNull()
 expect(screen.getByText('Belum ada akses cuti yang diberikan. Hubungi administrator HR.').closest('section')?.className).toContain('ui-empty-state')
 audiences=['granted'];await act(async()=>client.invalidateQueries({queryKey:leaveKeys.identity(hrA)}))
 fireEvent.click(await screen.findByRole('tab',{name:'Kalender'}));await screen.findByText('Fictional calendar employee')
 expect(screen.queryByRole('tab',{name:'Pengaturan'})).toBeNull();expect(screen.queryByRole('tab',{name:'Persetujuan'})).toBeNull()
 for(const label of ['Cakupan kalender','Tanggal dalam periode'])expect(screen.getByLabelText(label).closest('.ui-field')).toBeTruthy()
 expect((screen.getByRole('button',{name:'Tampilkan periode'}) as HTMLButtonElement).type).toBe('submit')
})
test('configure-only target keeps explicit unknown choices typed fields and static impacts',async()=>{
 identity(hrA);context={...personal,memberKind:null,capabilities:{...none,configure:true},currentPeriod:null};audiences=[];targets=[{id:employeeA,name:'Fictional target',capabilities:{configure:true,adjust:false,readPrivate:false,calendar:false,manageAccess:false}}]
 mount();fireEvent.click(await screen.findByRole('button',{name:'Atur Fictional target'}));const reason=await screen.findByLabelText('Alasan policy')
 expect(reason.tagName).toBe('TEXTAREA');expect(reason.closest('.ui-field')).toBeTruthy()
 expect((screen.getByLabelText('Pembatalan tanggal lampau diizinkan') as HTMLSelectElement).value).toBe('')
 expect(screen.queryByLabelText('Manifest izin yang disetujui')).toBeNull();expect(screen.queryByRole('button',{name:'Saldo dan riwayat anggota'})).toBeNull()
 const impacts=screen.getByText('Dampak permohonan belum tersedia. Tinjau dampak sebelum menggunakan pengaturan ini.').closest('aside')!
 expect(impacts.className).toContain('ui-notice--warning');expect(impacts.hasAttribute('role')).toBe(false)
 expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_balance_accounts_v1')).toBe(false)
})
test('request preview keeps native labels focus submit boundary and sends only a reviewed quote',async()=>{
 const {client}=mount();const opener=await screen.findByRole('button',{name:'Ajukan cuti'});await openRequest();const start=screen.getByLabelText('Tanggal mulai') as HTMLInputElement
 expect(start.type).toBe('date');expect(document.activeElement).toBe(start);expect(start.closest('.ui-field')).toBeTruthy()
 expect(opener.tagName).toBe('BUTTON');expect(opener.className).toContain('ui-action--primary')
 fillRequest();const preview=screen.getByRole('button',{name:'Hitung pratinjau'}) as HTMLButtonElement;expect(preview.type).toBe('submit');expect(preview.className).toContain('ui-action--primary')
 fireEvent.click(preview);const review=await screen.findByRole('region',{name:'Pratinjau cuti'});expect(review.tagName).toBe('SECTION');await waitFor(()=>expect(document.activeElement).toBe(review))
 expect(within(review).getByText('11j 15m')).toBeTruthy();expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_transaction_v1')).toBe(false)
 const send=within(review).getByRole('button',{name:'Ajukan cuti'}) as HTMLButtonElement;expect(send.type).toBe('button');fireEvent.click(send);fireEvent.click(send);await waitFor(()=>expect(finishMutation).toBeDefined())
 const calls=mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1');expect(calls).toHaveLength(1);expect(calls[0][1]).toMatchObject({p_operation:'submit_request',p_payload:{quote_fingerprint:quoteFixture.fingerprint,input:{start_date:quoteInput.startDate,end_date:quoteInput.endDate,duration:quoteInput.duration,reason:quoteInput.reason}}})
 await act(async()=>finishMutation!({data:{id:employeeB,version:1,operation:'submit_request'},error:null}));await screen.findByText('Cuti berhasil diajukan. Saldo telah direservasi.')
 await waitFor(()=>expect(client.isFetching()).toBe(0))
 // Existing authority masks may replace the opener during refresh; the owner returns
 // focus to its current native ref, without asserting unproved picker continuity.
 const currentOpener=screen.getByRole('region',{name:'Cuti saya'}).querySelector('button[hidden]') as HTMLButtonElement
 expect(currentOpener.tagName).toBe('BUTTON');expect(currentOpener.className).toContain('ui-action--primary')
 vi.mocked(window.confirm).mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Tutup formulir'}));await waitFor(()=>expect(document.activeElement).toBe(currentOpener));expect(guarded()).toBe(false)
})
test('canceled shared authority masks private draft and preview preserves its guard and recovers same owner',async()=>{
 const {client}=mount();await openRequest();fillRequest();fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await screen.findByRole('region',{name:'Pratinjau cuti'})
 pausedContext=true;fireEvent(window,new Event('focus'));await waitFor(()=>expect(pendingSignals.length).toBeGreaterThan(0));await act(async()=>client.cancelQueries({queryKey:leaveKeys.context(employeeA,'current'),exact:true}))
 const error=await screen.findByText('Akses cuti belum dapat dikonfirmasi. Silakan coba lagi.');mainTarget();expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(guarded()).toBe(true)
 pausedContext=false;fireEvent.click(within(error.closest('[role=alert]') as HTMLElement).getByRole('button',{name:'Coba lagi'}));await screen.findByDisplayValue(quoteInput.reason)
 expect(screen.queryByRole('region',{name:'Pratinjau cuti'})).toBeNull();expect(guarded()).toBe(true)
 identity(employeeB);await act(async()=>mocks.listeners.forEach(update=>update()));await screen.findByRole('button',{name:'Ajukan cuti'});expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(guarded()).toBe(false)
})
test('unresolved submission hides edit controls until canonical recovery without resending private reason',async()=>{
 const normal=mocks.rpc.getMockImplementation()!;mocks.rpc.mockImplementation((name,args)=>name==='leave_transaction_v1'?Promise.reject(new Error('lost result')):normal(name,args))
 mount();await openRequest();fillRequest();fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));const review=await screen.findByRole('region',{name:'Pratinjau cuti'});fireEvent.click(within(review).getByRole('button',{name:'Ajukan cuti'}))
 const recover=await screen.findByRole('button',{name:'Pulihkan hasil pengajuan'});expect(recover.className).toContain('ui-action--secondary');expect(screen.queryByLabelText('Alasan pribadi')).toBeNull();expect(localStorage.length).toBe(1);expect(localStorage.getItem(localStorage.key(0)!)).not.toContain(quoteInput.reason)
 mocks.rpc.mockImplementation((name,args)=>name==='leave_reconcile_request_v1'?Promise.resolve({data:{state:'committed',result:{id:employeeB,version:1,operation:'submit_request'}},error:null}):normal(name,args))
 fireEvent.click(recover);await screen.findByText('Cuti berhasil diajukan. Saldo telah direservasi.');expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(1);expect(localStorage.length).toBe(0)
})

function nativeFields(container:HTMLElement){
 const fields=container.querySelectorAll('.ui-field')
 expect(fields.length).toBeGreaterThan(0)
 const ids:string[]=[]
 fields.forEach(field=>{
  const label=field.querySelector('label')!,control=field.querySelector('input,select,textarea') as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement
  expect(control).toBeTruthy();expect(label.htmlFor).toBe(control.id);expect(control.id).not.toBe('');expect(document.getElementById(control.id)).toBe(control)
  ids.push(control.id)
 })
 expect(new Set(ids).size).toBe(ids.length)
}
test('director sees only assigned authority with non-live counts and exact row/detail focus owners',async()=>{
 identity(directorA);context={...personal,memberKind:'director',capabilities:{...none,approve:true},balances:[],currentPeriod:null};audiences=['assigned_team'];mount()
 const opener=await screen.findByRole('button',{name:'Tinjau Fictional employee'})
 expect(screen.queryByRole('tab',{name:'Ajukan Cuti'})).toBeNull();expect(screen.queryByRole('tab',{name:'Pengaturan'})).toBeNull();expect(screen.queryByRole('region',{name:'Saldo cuti'})).toBeNull()
 const badge=await screen.findByLabelText('3 persetujuan menunggu');expect(badge.tagName).toBe('SPAN');expect(badge.hasAttribute('role')).toBe(false);expect(badge.hasAttribute('aria-live')).toBe(false);expect(badge.className).toContain('ui-status-badge--warning')
 fireEvent.click(opener);const panel=await screen.findByRole('region',{name:'Detail permintaan ditugaskan'});await screen.findByText('Fictional private reason')
 const heading=within(panel).getByRole('heading',{name:/Fictional employee/});expect(heading.tagName).toBe('H3');await waitFor(()=>expect(document.activeElement).toBe(heading));nativeFields(panel)
 expect((within(panel).getByLabelText('Alasan penolakan') as HTMLTextAreaElement).maxLength).toBe(1000)
 const currentOpener=screen.getByRole('button',{name:'Tinjau Fictional employee'});expect(currentOpener.tagName).toBe('BUTTON')
 fireEvent.click(within(panel).getByRole('button',{name:'Tutup detail'}));await waitFor(()=>expect(document.activeElement).toBe(currentOpener));mainTarget()
})
test('count read error remains unavailable and genuine zero remains a static badge',async()=>{
 identity(managerA);context={...personal,memberKind:'manager',capabilities:{...none,request:true,approve:true}};audiences=['own','assigned_team']
 const normal=mocks.rpc.getMockImplementation()!;let failing=true;mocks.rpc.mockImplementation((name,args)=>name==='leave_approval_counts_v1'&&failing?{abortSignal:()=>Promise.resolve({data:null,error:{code:'55000',message:'Private count diagnostic'}})}:normal(name,args))
 const {client}=mount();await screen.findByText('Jumlah belum tersedia');expect(screen.queryByLabelText('0 persetujuan menunggu')).toBeNull();expect(screen.queryByText('Private count diagnostic')).toBeNull()
 failing=false;counts={pendingLeave:0,pendingCancellation:0};await act(async()=>client.invalidateQueries({queryKey:leaveKeys.identity(managerA)}))
 const badge=await screen.findByLabelText('0 persetujuan menunggu');expect(badge.className).toContain('ui-status-badge--neutral');expect(badge.hasAttribute('role')).toBe(false)
})
test('configured member editor labels actual native date/select controls and suspends them through authority loss',async()=>{
 identity(hrA);context={...personal,memberKind:null,capabilities:{...none,configure:true},currentPeriod:null};audiences=[];targets=[{id:employeeA,name:'Fictional configured target',capabilities:{configure:true,adjust:false,readPrivate:false,calendar:false,manageAccess:false}}]
 const {client}=mount();fireEvent.click(await screen.findByRole('button',{name:'Atur Fictional configured target'}));await screen.findByLabelText('Alasan policy');fireEvent.click(screen.getByRole('button',{name:'Keanggotaan'}));await screen.findByLabelText('Alasan perubahan')
 const panel=screen.getByRole('region',{name:'Pengaturan anggota'});nativeFields(panel);expect((screen.getByLabelText('Mulai bekerja') as HTMLInputElement).type).toBe('date');expect((screen.getByLabelText('Berlaku sampai (eksklusif)') as HTMLInputElement).type).toBe('date');expect(screen.getByLabelText('Anggota aktif').tagName).toBe('INPUT')
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Private membership draft'}});expect(guarded()).toBe(true)
 pausedContext=true;fireEvent(window,new Event('focus'));await waitFor(()=>expect(pendingSignals.length).toBeGreaterThan(0));await act(async()=>client.cancelQueries({queryKey:leaveKeys.context(hrA,'current'),exact:true}));expect(screen.queryByDisplayValue('Private membership draft')).toBeNull();expect(guarded()).toBe(true)
 pausedContext=false;const error=await screen.findByText('Akses cuti belum dapat dikonfirmasi. Silakan coba lagi.');fireEvent.click(within(error.closest('[role=alert]') as HTMLElement).getByRole('button',{name:'Coba lagi'}));await screen.findByDisplayValue('Private membership draft');nativeFields(screen.getByRole('region',{name:'Pengaturan anggota'}))
})
