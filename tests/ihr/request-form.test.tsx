import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { transferableAbortController } from 'node:util'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA,employeeB } from './fixtures'
import { quoteFixture,quoteInput,quoteScope } from './quote-fixture'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'71000000-0000-0000-0000-000000000001'}})}))
import { leaveKeys } from '../../src/lib/leave/queryKeys'
import MyLeave from '../../src/pages/ihr/leave/MyLeave'
const context:LeaveContext={scopeVersion:quoteScope,memberKind:'employee',capabilities:{request:true,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false},currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'},timezone:'Etc/UTC',setup:{ready:false,blockers:[]},balances:[{accountId:employeeA,year:2026,allowanceMinutes:5400,approvedMinutes:450,pendingMinutes:60,availableMinutes:4890,expiredMinutes:0,version:4,reconciled:true}]}
const clients:QueryClient[]=[]
function mount(actor=employeeA){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const panel=(identity=actor)=><QueryClientProvider client={client}><MyLeave actorId={identity} context={context}/></QueryClientProvider>;return {client,panel,view:render(panel())}}
function serve(){mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='leave_transaction_v1'?Promise.resolve({data:{id:args.p_request_id,version:1,operation:'submit_request'},error:null}):{abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:quoteFixture,error:null})})}
async function open(){fireEvent.click(screen.getByRole('button',{name:'Buat pratinjau cuti'}));await screen.findByLabelText('Tanggal mulai')}
async function preview(){for(const [label,value] of [['Tanggal mulai',quoteInput.startDate],['Tanggal selesai',quoteInput.endDate],['Alasan pribadi',quoteInput.reason]])fireEvent.change(screen.getByLabelText(label),{target:{value}});fireEvent.click(screen.getByRole('button',{name:'Hitung pratinjau'}));await screen.findByRole('region',{name:'Pratinjau cuti'})}
beforeEach(()=>{vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});localStorage.clear();serve();vi.spyOn(window,'confirm').mockReturnValue(true)})
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.unstubAllGlobals();vi.restoreAllMocks()})
test('submission refreshes authority, sends the exact quote contract once and clears the private draft after confirmation',async()=>{
 const {client}=mount();await open();await preview();const before=mocks.rpc.mock.calls.filter(([name])=>name==='leave_context_v1').length
 const button=screen.getByRole('button',{name:'Ajukan cuti'});fireEvent.click(button);fireEvent.click(button)
 expect(await screen.findByText('Cuti berhasil diajukan. Saldo telah direservasi.')).toBeTruthy()
 const commands=mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1');expect(commands).toHaveLength(1)
 expect(commands[0][1]).toMatchObject({p_operation:'submit_request',p_payload:{input:{start_date:quoteInput.startDate,end_date:quoteInput.endDate,duration:quoteInput.duration,reason:quoteInput.reason},quote_fingerprint:quoteFixture.fingerprint}})
 expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_context_v1').length).toBeGreaterThan(before)
 expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(localStorage.length).toBe(0);expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain(quoteInput.reason)
 const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);expect(e.defaultPrevented).toBe(false)
})
test('lost send fences edits and survives close/reopen; recovery returns committed success without another submission',async()=>{
 mount();await open();await preview();mocks.rpc.mockImplementationOnce(()=>({abortSignal:()=>Promise.resolve({data:context,error:null})}));mocks.rpc.mockRejectedValueOnce(new Error(quoteInput.reason))
 fireEvent.click(screen.getByRole('button',{name:'Ajukan cuti'}));await screen.findByRole('button',{name:'Pulihkan hasil pengajuan'});expect(screen.queryByLabelText('Alasan pribadi')).toBeNull()
 const raw=localStorage.getItem(localStorage.key(0)!)!;expect(raw).not.toMatch(/Private|reason|input|start_date/);const id=JSON.parse(raw).id
 fireEvent.click(screen.getByRole('button',{name:'Tutup formulir'}));fireEvent.click(screen.getByRole('button',{name:'Buat pratinjau cuti'}));await screen.findByRole('button',{name:'Pulihkan hasil pengajuan'});expect(screen.queryByLabelText('Tanggal mulai')).toBeNull()
 mocks.rpc.mockImplementation((name:string)=>name==='leave_reconcile_request_v1'?Promise.resolve({data:{state:'committed',result:{id,version:1,operation:'submit_request'}},error:null}):{abortSignal:()=>Promise.resolve({data:context,error:null})})
 fireEvent.click(screen.getByRole('button',{name:'Pulihkan hasil pengajuan'}));expect(await screen.findByText('Cuti berhasil diajukan. Saldo telah direservasi.')).toBeTruthy();expect(localStorage.length).toBe(0)
 expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(1)
})
test('abandonment confirms there was no submission and allows a fresh preview',async()=>{
 mount();await open();await preview();mocks.rpc.mockImplementationOnce(()=>({abortSignal:()=>Promise.resolve({data:context,error:null})}));mocks.rpc.mockRejectedValueOnce(new Error('lost'))
 fireEvent.click(screen.getByRole('button',{name:'Ajukan cuti'}));await screen.findByRole('button',{name:'Pulihkan hasil pengajuan'})
 mocks.rpc.mockImplementation((name:string)=>name==='leave_reconcile_request_v1'?Promise.resolve({data:{state:'abandoned'},error:null}):{abortSignal:()=>Promise.resolve({data:context,error:null})})
 fireEvent.click(screen.getByRole('button',{name:'Pulihkan hasil pengajuan'}));expect(await screen.findByText('Pengajuan sebelumnya tidak tersimpan. Hitung pratinjau sebelum mengajukan lagi.')).toBeTruthy();expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy();expect(screen.queryByRole('button',{name:'Ajukan cuti'})).toBeNull()
})
test('changed authority before send prevents the command and discards the private draft',async()=>{
 mount();await open();await preview();mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{...context,capabilities:{...context.capabilities,request:false}},error:null})})
 fireEvent.click(screen.getByRole('button',{name:'Ajukan cuti'}));await screen.findByRole('alert');expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull();expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(0)
})
test('identity change while a sent command is unresolved rejects its late UI result',async()=>{
 const {panel,view}=mount();await open();await preview();let finish!:(value:unknown)=>void,id=''
 mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='leave_transaction_v1'?(id=String(args.p_request_id),new Promise(resolve=>finish=resolve)):{abortSignal:()=>Promise.resolve({data:context,error:null})})
 fireEvent.click(screen.getByRole('button',{name:'Ajukan cuti'}));await waitFor(()=>expect(finish).toBeDefined());view.rerender(panel(employeeB))
 await act(async()=>finish({data:{id,version:1,operation:'submit_request'},error:null}));expect(screen.queryByText('Cuti berhasil diajukan. Saldo telah direservasi.')).toBeNull();expect(screen.queryByDisplayValue(quoteInput.reason)).toBeNull()
})

test('cancelled cached submit preflight preserves the draft and never dispatches a command',async()=>{
 const {client}=mount();await open();await preview();let signal!:AbortSignal
 mocks.rpc.mockReturnValue({abortSignal:(s:AbortSignal)=>(signal=s,new Promise(()=>{}))})
 fireEvent.click(screen.getByRole('button',{name:'Ajukan cuti'}));await waitFor(()=>expect(signal).toBeDefined())
 await act(async()=>client.cancelQueries({queryKey:leaveKeys.context(employeeA,'current'),exact:true}));expect(signal.aborted).toBe(true);await screen.findByRole('alert')
 expect(screen.getByDisplayValue(quoteInput.reason)).toBeTruthy();expect(screen.queryByRole('button',{name:'Ajukan cuti'})).toBeNull();expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_transaction_v1')).toHaveLength(0)
})
