import { webcrypto } from 'node:crypto'
import { transferableAbortController } from 'node:util'
import { invalidateRequestCaches } from '../../src/lib/leave/requestTransport'
import { leaveKeys } from '../../src/lib/leave/queryKeys'
import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { onlineManager,QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc}}))
import AssignedApprovalInbox from '../../src/pages/ihr/leave/AssignedApprovalInbox'
const actor='71000000-0000-0000-0000-000000000003',id='82000000-0000-0000-0000-000000000001'
const context:LeaveContext={scopeVersion:'fixture-scope',memberKind:'manager',capabilities:{request:true,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false},setup:{ready:true,blockers:[]},balances:[],timezone:'Etc/UTC'}
const row={id,sequence:1,startDate:'2026-10-09',endDate:'2026-10-09',duration:{mode:'full_scheduled_day'},totalMinutes:450,status:'submitted',version:1,submittedAt:'2026-10-03T00:00:00Z',sourceKind:'submission',employee:{id:'71000000-0000-0000-0000-000000000001',name:'Fictional employee'},cancellationAttemptId:null,cancellationRequestedAt:null}
const detail={...row,reason:'Fictional private reason',approverName:'Fictional manager',days:[{date:'2026-10-09',scheduledMinutes:450,chargedMinutes:450,exclusion:null,groupName:null}],allocations:[{year:2026,startDate:'2026-01-01',endDate:'2027-01-01',chargedMinutes:450}],cancellation:null,balanceContext:{basis:'current',asOf:'2026-10-03T01:00:00Z',periods:[{year:2026,reservedMinutes:450,usedMinutes:900,availableMinutes:4050,expiredMinutes:0,reconciled:true}]}}
const clients:QueryClient[]=[]
let rows:unknown[],failure:boolean,finish:((value:unknown)=>void)|undefined
function serve(){rpc.mockImplementation((name:string)=>{
 if(name==='leave_transaction_v1')return new Promise(resolve=>finish=resolve)
 return {abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:name==='leave_assigned_request_v1'?detail:{rows,nextBefore:null},error:failure&&name==='leave_assigned_inbox_v1'?{code:'55000',message:'Private backend detail'}:null})}
})}
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const element=(readState:'ready'|'pending'|'error'='ready')=><QueryClientProvider client={client}><AssignedApprovalInbox actorId={actor} context={context} readState={readState}/></QueryClientProvider>;return {view:render(element()),element}}
beforeEach(()=>{vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});onlineManager.setOnline(true);rows=[row];failure=false;finish=undefined;rpc.mockReset();localStorage.clear();vi.stubGlobal('crypto',webcrypto);serve()})
afterEach(()=>{cleanup();onlineManager.setOnline(true);clients.splice(0).forEach(c=>c.clear());vi.restoreAllMocks();vi.unstubAllGlobals()})
test('inbox read failure is not rendered as empty and retry refreshes authority',async()=>{
 failure=true;mount();expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Tidak ada permintaan yang menunggu keputusan.')).toBeNull();expect(screen.queryByText('Private backend detail')).toBeNull()
 failure=false;rows=[];fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));expect(await screen.findByText('Tidak ada permintaan yang menunggu keputusan.')).toBeTruthy()
})
test('fresh assigned detail gates private reason and blocks repeated approval clicks',async()=>{
 mount();expect(screen.queryByText('Fictional private reason')).toBeNull();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));expect(await screen.findByText('Fictional private reason')).toBeTruthy()
 const approve=screen.getByRole('button',{name:'Setujui cuti'});fireEvent.click(approve);fireEvent.click(approve);await waitFor(()=>expect(finish).toBeDefined());expect(rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(1)
 rows=[];await act(async()=>finish!({data:{id,version:2,operation:'approve_request'},error:null}));expect(await screen.findByText('Keputusan tersimpan.')).toBeTruthy();expect(screen.queryByText('Fictional private reason')).toBeNull()
})
test('assigned cards show a status badge and collapse daily details without hiding decisions or balance context',async()=>{
 mount();await screen.findByRole('button',{name:'Tinjau Fictional employee'})
 expect(screen.getByLabelText('Status permintaan: Menunggu persetujuan cuti').className).toContain('rounded-full')
 fireEvent.click(screen.getByRole('button',{name:'Tinjau Fictional employee'}))
 await screen.findByText('Fictional private reason')
 const region=screen.getByRole('region',{name:'Detail permintaan ditugaskan'})
 const breakdown=within(region).getByText('Rincian tanggal dan periode').closest('details')!
 expect(breakdown).toBeTruthy();expect(breakdown.hasAttribute('open')).toBe(false)
 expect(within(region).getByRole('region',{name:'Konteks saldo permohonan'}).closest('details')).toBeNull()
 expect(within(region).getByRole('button',{name:'Setujui cuti'}).closest('details')).toBeNull()
 expect(within(region).getByRole('button',{name:'Setujui cuti'}).classList.contains('bg-brand-primary')).toBe(true)
})
test('reject requires a reason, and shared authority suspension hides retained private input',async()=>{
 const {view,element}=mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));const reason=await screen.findByLabelText('Alasan penolakan');expect((screen.getByRole('button',{name:'Tolak cuti'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.change(reason,{target:{value:'Private decision note'}});view.rerender(element('pending'));expect(screen.queryByDisplayValue('Private decision note')).toBeNull();expect(screen.queryByText('Fictional private reason')).toBeNull()
 view.rerender(element());expect(await screen.findByDisplayValue('Private decision note')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Tolak cuti'}));await waitFor(()=>expect(finish).toBeDefined());expect(localStorage.getItem(localStorage.key(0)!)!).not.toContain('Private decision note')
 rows=[];await act(async()=>finish!({data:{id,version:2,operation:'reject_request'},error:null}));expect(await screen.findByText('Keputusan tersimpan.')).toBeTruthy()
})
test('capability loss hides inbox even if same-scope cached rows exist',async()=>{
 const {view}=mount();await screen.findByRole('button',{name:'Tinjau Fictional employee'});view.rerender(<QueryClientProvider client={clients[0]}><AssignedApprovalInbox actorId={actor} context={{...context,capabilities:{...context.capabilities,approve:false}}}/></QueryClientProvider>);expect(screen.queryByText('Fictional employee')).toBeNull()
})
test('whole cancellation review uses its distinct attempt and retains original-period explanation',async()=>{
 const attempt='82000000-0000-0000-0000-000000000002',pending={...row,status:'cancellation_pending',version:3,cancellationAttemptId:attempt,cancellationRequestedAt:'2026-10-03T01:00:00Z'}
 rows=[pending];rpc.mockImplementation((name:string)=>name==='leave_transaction_v1'?new Promise(resolve=>finish=resolve):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:name==='leave_assigned_request_v1'?{...detail,...pending,cancellation:{id:attempt,requestedAt:pending.cancellationRequestedAt,reason:'Fictional cancellation reason',approverName:'Fictional manager'}}:{rows,nextBefore:null},error:null})})
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));expect(await screen.findByText('Fictional cancellation reason')).toBeTruthy();expect(screen.getByText(/Pengembalian masuk ke periode asal/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Setujui pembatalan'}));await waitFor(()=>expect(finish).toBeDefined());const call=rpc.mock.calls.find(([name])=>name==='leave_transaction_v1')!
 expect(call[1].p_operation).toBe('approve_cancellation');expect(call[1].p_payload).toEqual({request_id:id,expected_version:3,attempt_id:attempt})
 rows=[];await act(async()=>finish!({data:{id,version:4,operation:'approve_cancellation'},error:null}));expect(await screen.findByText('Keputusan tersimpan.')).toBeTruthy()
})
test('reopening a cached detail always performs fresh authority and request reads',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason');fireEvent.click(screen.getByRole('button',{name:'Tutup detail'}))
 const oldContextReads=rpc.mock.calls.filter(([name])=>name==='leave_context_v1').length
 fireEvent.click(screen.getByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason')
 expect(rpc.mock.calls.filter(([name])=>name==='leave_assigned_request_v1')).toHaveLength(2);expect(rpc.mock.calls.filter(([name])=>name==='leave_context_v1').length).toBeGreaterThan(oldContextReads)
})
test('same actor scope replacement clears private rejection input and dirty guards',async()=>{
 const {view}=mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));fireEvent.change(await screen.findByLabelText('Alasan penolakan'),{target:{value:'Ephemeral old scope reason'}})
 let event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
 view.rerender(<QueryClientProvider client={clients[0]}><AssignedApprovalInbox actorId={actor} context={{...context,scopeVersion:'new-scope'}}/></QueryClientProvider>)
 expect(screen.queryByDisplayValue('Ephemeral old scope reason')).toBeNull();event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(false)
})
test.each([false,true])('cancelled private detail refresh keeps retained input hidden until a genuine read completes (offline=%s)',async offline=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason');fireEvent.change(screen.getByLabelText('Alasan penolakan'),{target:{value:'Retained ephemeral reason'}})
 let detailSignal:AbortSignal|undefined,resolveOld:((value:unknown)=>void)|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:(signal:AbortSignal)=>name==='leave_assigned_request_v1'?(detailSignal=signal,new Promise(resolve=>resolveOld=resolve)):Promise.resolve({data:name==='leave_context_v1'?context:{rows,nextBefore:null},error:null})}))
 if(offline)onlineManager.setOnline(false)
 fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}))
 expect(screen.queryByText('Fictional private reason')).toBeNull();expect(screen.queryByRole('button',{name:'Setujui cuti'})).toBeNull()
 await waitFor(()=>expect(detailSignal).toBeDefined())
 expect(screen.queryByText('Fictional private reason')).toBeNull();expect(screen.queryByDisplayValue('Retained ephemeral reason')).toBeNull()
 await act(async()=>clients[0].cancelQueries({queryKey:leaveKeys.private(actor,context.scopeVersion,'assigned-detail',id),exact:true}))
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
 expect(detailSignal!.aborted).toBe(true);expect(screen.queryByText('Fictional private reason')).toBeNull();expect(screen.queryByRole('button',{name:'Setujui cuti'})).toBeNull()
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true)
 onlineManager.setOnline(true);serve();fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}))
 expect(await screen.findByDisplayValue('Retained ephemeral reason')).toBeTruthy();expect(screen.getByText('Fictional private reason')).toBeTruthy()
 await act(async()=>resolveOld!({data:{...detail,reason:'Obsolete private response'},error:null}));expect(screen.queryByText('Obsolete private response')).toBeNull()
})
test('page-back suppresses cached names until fresh authority and assigned-list completion',async()=>{
 let firstReads=0,release:((value:unknown)=>void)|undefined
 rpc.mockImplementation((name:string,args?:{p_before?:number|null})=>({abortSignal:()=>{
  if(name==='leave_context_v1')return Promise.resolve({data:context,error:null})
  if(args?.p_before===2)return Promise.resolve({data:{rows:[{...row,id:'82000000-0000-0000-0000-000000000002',sequence:1,employee:{...row.employee,name:'Older fictional employee'}}],nextBefore:null},error:null})
  firstReads++;if(firstReads>1)return new Promise(resolve=>release=resolve)
  return Promise.resolve({data:{rows:[{...row,sequence:2}],nextBefore:2},error:null})
 }}))
 mount();await screen.findByText('Fictional employee');fireEvent.click(screen.getByRole('button',{name:'Lebih lama'}));await screen.findByText('Older fictional employee');fireEvent.click(screen.getByRole('button',{name:'Lebih baru'}))
 expect(screen.queryByText('Fictional employee')).toBeNull();await waitFor(()=>expect(release).toBeDefined())
 await act(async()=>release!({data:{rows:[],nextBefore:null},error:null}));expect(await screen.findByText('Tidak ada permintaan yang menunggu keputusan.')).toBeTruthy();expect(screen.queryByText('Fictional employee')).toBeNull()
})
test('same actor and scope remount requires fresh assigned rows without evicting another observer',async()=>{
 const {view,element}=mount();await screen.findByText('Fictional employee');view.unmount()
 const key=leaveKeys.private(actor,context.scopeVersion,'assigned-inbox',null,25);expect(clients[0].getQueryData(key)).toBeTruthy()
 let release:((value:unknown)=>void)|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:()=>name==='leave_context_v1'?Promise.resolve({data:context,error:null}):new Promise(resolve=>release=resolve)}))
 render(element());expect(screen.queryByText('Fictional employee')).toBeNull();await waitFor(()=>expect(release).toBeDefined());expect(clients[0].getQueryData(key)).toBeTruthy()
 await act(async()=>release!({data:{rows:[],nextBefore:null},error:null}));expect(await screen.findByText('Tidak ada permintaan yang menunggu keputusan.')).toBeTruthy()
})
test('assignment loss after a cancelled detail read stays hidden after context succeeds and clears only on authorized recovery',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason');fireEvent.change(screen.getByLabelText('Alasan penolakan'),{target:{value:'Ephemeral during assignment check'}})
 let signal:AbortSignal|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_assigned_request_v1'?(signal=s,new Promise(()=>{})):Promise.resolve({data:name==='leave_context_v1'?context:{rows,nextBefore:null},error:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));await waitFor(()=>expect(signal).toBeDefined())
 await act(async()=>clients[0].cancelQueries({queryKey:leaveKeys.private(actor,context.scopeVersion,'assigned-detail',id),exact:true}));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
 rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:name==='leave_assigned_inbox_v1'?{rows:[],nextBefore:null}:null,error:name==='leave_assigned_request_v1'?{code:'42501',message:'Private removed assignment'}:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));await screen.findByText('Detail tidak tersedia atau penugasan berubah.')
 expect(screen.queryByText('Fictional private reason')).toBeNull();expect(screen.queryByDisplayValue('Ephemeral during assignment check')).toBeNull();expect(screen.queryByRole('button',{name:'Setujui cuti'})).toBeNull();expect(screen.queryByText('Private removed assignment')).toBeNull()
 serve();fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));expect(await screen.findByDisplayValue('Ephemeral during assignment check')).toBeTruthy()
})
test('a second current observer does not evict assigned data or purge the first observer on unmount',async()=>{
 const first=mount();await screen.findByText('Fictional employee');const client=clients[0]
 const removals:unknown[]=[];const unsubscribe=client.getQueryCache().subscribe(event=>{if(event.type==='removed'&&event.query.queryKey.includes('assigned-inbox'))removals.push(event.query.queryKey)})
 let release:((value:unknown)=>void)|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:()=>name==='leave_context_v1'?Promise.resolve({data:context,error:null}):new Promise(resolve=>release=resolve)}))
 const second=render(first.element());expect(within(second.container).queryByText('Fictional employee')).toBeNull();await waitFor(()=>expect(release).toBeDefined())
 expect(client.getQueryData(leaveKeys.private(actor,context.scopeVersion,'assigned-inbox',null,25))).toBeTruthy();expect(removals).toEqual([])
 await act(async()=>release!({data:{rows,nextBefore:null},error:null}));await waitFor(()=>expect(screen.getAllByText('Fictional employee')).toHaveLength(2))
 second.unmount();expect(within(first.view.container).getByText('Fictional employee')).toBeTruthy();expect(removals).toEqual([]);unsubscribe()
})
test('uncertain decision recovery survives hidden cancelled reads and confirms only the reconciled minimal receipt',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason')
 rpc.mockImplementation((name:string)=>name==='leave_transaction_v1'?Promise.reject(new Error('Private network detail')):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:name==='leave_assigned_request_v1'?detail:{rows,nextBefore:null},error:null})})
 fireEvent.click(screen.getByRole('button',{name:'Setujui cuti'}));await screen.findByRole('button',{name:'Pulihkan hasil keputusan'})
 expect(screen.queryByText('Private network detail')).toBeNull();expect(localStorage.getItem(localStorage.key(0)!)!).not.toContain('Fictional private reason')
 let privateSignal:AbortSignal|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:(signal:AbortSignal)=>name==='leave_assigned_request_v1'?(privateSignal=signal,new Promise(()=>{})):Promise.resolve({data:name==='leave_context_v1'?context:{rows,nextBefore:null},error:null})}))
 fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));await waitFor(()=>expect(privateSignal).toBeDefined());await act(async()=>clients[0].cancelQueries({queryKey:leaveKeys.private(actor,context.scopeVersion,'assigned-detail',id),exact:true}))
 rows=[];rpc.mockImplementation((name:string)=>name==='leave_reconcile_request_v1'?Promise.resolve({data:{state:'committed',result:{id,version:2,operation:'approve_request'}},error:null}):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:{rows,nextBefore:null},error:null})})
 fireEvent.click(screen.getByRole('button',{name:'Pulihkan hasil keputusan'}));expect(await screen.findByText('Keputusan tersimpan.')).toBeTruthy();expect(screen.queryByText('Fictional private reason')).toBeNull();expect(localStorage.length).toBe(0)
 expect(rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(1)
})
test.each([false,true])('cancelled assigned-list refresh never revives a cached employee row (offline=%s)',async offline=>{
 mount();await screen.findByText('Fictional employee');let signal:AbortSignal|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_assigned_inbox_v1'?(signal=s,new Promise(()=>{})):Promise.resolve({data:context,error:null})}))
 if(offline)onlineManager.setOnline(false)
 fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));expect(screen.queryByText('Fictional employee')).toBeNull();await waitFor(()=>expect(signal).toBeDefined())
 await act(async()=>clients[0].cancelQueries({queryKey:leaveKeys.private(actor,context.scopeVersion,'assigned-inbox',null,25),exact:true}));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
 expect(signal!.aborted).toBe(true);expect(screen.queryByText('Fictional employee')).toBeNull();expect(screen.queryByRole('button',{name:'Tinjau Fictional employee'})).toBeNull()
 onlineManager.setOnline(true);rows=[];serve();fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));expect(await screen.findByText('Tidak ada permintaan yang menunggu keputusan.')).toBeTruthy()
})
test('a decision in one observer immediately invalidates the other selected private detail and refetches authority',async()=>{
 const first=mount();await screen.findByText('Fictional employee');const second=render(first.element())
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'Tinjau Fictional employee'})).toHaveLength(2))
 fireEvent.click(within(first.view.container).getByRole('button',{name:'Tinjau Fictional employee'}));await within(first.view.container).findByText('Fictional private reason')
 fireEvent.click(within(second.container).getByRole('button',{name:'Tinjau Fictional employee'}));await within(second.container).findByText('Fictional private reason')
 fireEvent.change(within(second.container).getByLabelText('Alasan penolakan'),{target:{value:'Other observer ephemeral reason'}})
 const client=clients[0],key=leaveKeys.private(actor,context.scopeVersion,'assigned-detail',id),removed:unknown[]=[]
 const unsubscribe=client.getQueryCache().subscribe(event=>{if(event.type==='removed'&&JSON.stringify(event.query.queryKey)===JSON.stringify(key))removed.push(event.query.queryKey)})
 fireEvent.click(within(first.view.container).getByRole('button',{name:'Setujui cuti'}));await waitFor(()=>expect(finish).toBeDefined())
 let refreshedDetail:((value:unknown)=>void)|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:()=>name==='leave_assigned_request_v1'?new Promise(resolve=>refreshedDetail=resolve):Promise.resolve({data:name==='leave_context_v1'?context:{rows:[],nextBefore:null},error:null})}))
 await act(async()=>finish!({data:{id,version:2,operation:'approve_request'},error:null}))
 await waitFor(()=>expect(within(second.container).queryByText('Fictional private reason')).toBeNull())
 expect(within(second.container).queryByDisplayValue('Other observer ephemeral reason')).toBeNull();expect(within(second.container).queryByRole('button',{name:'Setujui cuti'})).toBeNull()
 await waitFor(()=>expect(refreshedDetail).toBeDefined());expect(removed).toEqual([])
 await act(async()=>refreshedDetail!({data:null,error:{code:'42501'}}));expect(await within(second.container).findByText('Detail tidak tersedia atau penugasan berubah.')).toBeTruthy()
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true)
 expect(rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(1);expect(removed).toEqual([]);unsubscribe()
})
test.each([false,true])('shared invalidation keeps a cancelled detail hidden until fresh recovery (offline=%s)',async offline=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason');fireEvent.change(screen.getByLabelText('Alasan penolakan'),{target:{value:'Private draft across invalidation'}})
 const client=clients[0],key=leaveKeys.private(actor,context.scopeVersion,'assigned-detail',id)
 let signal:AbortSignal|undefined,resolveOld:((value:unknown)=>void)|undefined,invalidation:Promise<void>|undefined
 rpc.mockImplementation((name:string)=>({abortSignal:(s:AbortSignal)=>name==='leave_assigned_request_v1'?(signal=s,new Promise(resolve=>resolveOld=resolve)):Promise.resolve({data:name==='leave_context_v1'?context:{rows,nextBefore:null},error:null})}))
 if(offline)onlineManager.setOnline(false)
 await act(async()=>{invalidation=invalidateRequestCaches(client)})
 await waitFor(()=>expect(signal).toBeDefined());expect(screen.queryByText('Fictional private reason')).toBeNull();expect(screen.queryByDisplayValue('Private draft across invalidation')).toBeNull();expect(screen.queryByRole('button',{name:'Setujui cuti'})).toBeNull()
 await act(async()=>{await client.cancelQueries({queryKey:key,exact:true});await invalidation});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
 expect(signal!.aborted).toBe(true);expect(screen.queryByText('Fictional private reason')).toBeNull();expect(screen.queryByRole('button',{name:'Setujui cuti'})).toBeNull()
 onlineManager.setOnline(true);serve();fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));expect(await screen.findByDisplayValue('Private draft across invalidation')).toBeTruthy()
 await act(async()=>resolveOld!({data:{...detail,reason:'Obsolete invalidated response'},error:null}));expect(screen.queryByText('Obsolete invalidated response')).toBeNull()
})
test('invalidation without immediate refetch also revokes a cached detail completion',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason')
 const reads=rpc.mock.calls.filter(([name])=>name==='leave_assigned_request_v1').length
 await act(async()=>clients[0].invalidateQueries({queryKey:leaveKeys.private(actor,context.scopeVersion,'assigned-detail',id),exact:true,refetchType:'none'}))
 expect(rpc.mock.calls.filter(([name])=>name==='leave_assigned_request_v1')).toHaveLength(reads)
 await waitFor(()=>expect(screen.queryByText('Fictional private reason')).toBeNull());expect(screen.queryByRole('button',{name:'Setujui cuti'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Muat ulang detail'}));expect(await screen.findByText('Fictional private reason')).toBeTruthy()
})

test('review presents duration, scheduled versus charged capacity, current version and minimized fresh balance',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Fictional private reason')
 expect(screen.getByText('Versi permohonan: 1')).toBeTruthy()
 expect(screen.getByText('Durasi: Sehari sesuai jadwal')).toBeTruthy()
 expect(screen.getByText(/Jadwal 7j 30m/)).toBeTruthy()
 expect(screen.getByText(/Saldo terkini/)).toBeTruthy()
 expect(screen.getByText(/Tersedia: 67j 30m/)).toBeTruthy()
})
test('partial weekday and Saturday context refreshes the displayed decision version',async()=>{
 let version=7
 const partial={...row,endDate:'2026-10-10',duration:{mode:'fixed_minutes',minutes:225},totalMinutes:450}
 rows=[{...partial,version}]
 rpc.mockImplementation((name:string)=>name==='leave_transaction_v1'?new Promise(resolve=>finish=resolve):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:name==='leave_assigned_request_v1'?{...detail,...partial,version,days:[{date:'2026-10-09',scheduledMinutes:450,chargedMinutes:225,exclusion:null,groupName:null},{date:'2026-10-10',scheduledMinutes:225,chargedMinutes:225,exclusion:null,groupName:'Saturday group'}]}:{rows,nextBefore:null},error:null})})
 mount();fireEvent.click(await screen.findByRole('button',{name:'Tinjau Fictional employee'}));await screen.findByText('Versi permohonan: 7')
 expect(screen.getByText('Durasi: 3j 45m per hari kerja')).toBeTruthy();expect(screen.getByText(/2026-10-09 · Jadwal 7j 30m · Diminta 3j 45m/)).toBeTruthy();expect(screen.getByText(/2026-10-10 · Jadwal 3j 45m · Diminta 3j 45m/)).toBeTruthy()
 version=8;fireEvent.click(screen.getByRole('button',{name:'Muat ulang daftar'}));await screen.findByText('Versi permohonan: 8')
 fireEvent.click(screen.getByRole('button',{name:'Setujui cuti'}));await waitFor(()=>expect(finish).toBeDefined());expect(rpc.mock.calls.find(([name])=>name==='leave_transaction_v1')?.[1].p_payload.expected_version).toBe(8)
})
