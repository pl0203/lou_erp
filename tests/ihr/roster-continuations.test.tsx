import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),read:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/leave/useLeaveReads',()=>({useAuthorizedLeaveRead:(...args:unknown[])=>mocks.read(...args)}))
import { fetchLeaveRosterContinuations } from '../../src/lib/leave/setupRpc'
import LeaveRosterContinuations from '../../src/pages/ihr/leave/LeaveRosterContinuations'
const calendarId='73000000-0000-0000-0000-000000000090',employeeId='71000000-0000-0000-0000-000000000001',groupId='79000000-0000-0000-0000-000000000021'
const row={continuationFingerprint:'a'.repeat(64),employeeId,employeeName:'Synthetic person',memberVersion:3,groupId,groupName:'Synthetic group',effectiveFrom:'2026-11-01',effectiveUntil:'2027-01-01'}
const response=()=>({calendarId,scopeVersion:'scope',rows:[row],total:1,page:1,pageSize:25})
const context:LeaveContext={scopeVersion:'scope',memberKind:'director',timezone:null,balances:[],setup:{ready:false,blockers:[]},capabilities:{request:false,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false,calendarConfigure:true}}
const props=()=>({actorId:'71000000-0000-0000-0000-000000000004',context,calendarId,authorityReady:true,send:vi.fn().mockResolvedValue({id:employeeId,version:4,operation:'set_group_membership'}),onDirtyChange:vi.fn(),onSaved:vi.fn()})
beforeEach(()=>{vi.clearAllMocks();mocks.read.mockReturnValue({available:true,data:response(),isCurrent:()=>true,isFetching:false,refetch:vi.fn()})});afterEach(cleanup)
test('scope-bound paginated response contains fixed continuation data only',async()=>{
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:response(),error:null})})
 expect(await fetchLeaveRosterContinuations(calendarId,'scope',1,25,new AbortController().signal)).toEqual(response())
 expect(mocks.rpc).toHaveBeenCalledWith('leave_roster_continuations_v1',{p_calendar_id:calendarId,p_page:1,p_page_size:25})
})
test.each([
 {...response(),scopeVersion:'old'}, {...response(),calendarId:employeeId}, {...response(),total:0},
 {...response(),rows:[{...row,effectiveUntil:null}]}, {...response(),rows:[{...row,effectiveUntil:row.effectiveFrom}]},
 {...response(),rows:[{...row,balanceMinutes:5400}]}, {...response(),rows:[row,row]}, {...response(),privateNotes:'hidden'},
])('rejects unbound, malformed or overbroad continuation payload',async value=>{
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:value,error:null})})
 await expect(fetchLeaveRosterContinuations(calendarId,'scope',1,25,new AbortController().signal)).rejects.toThrow()
})
test('explicit send fixes the existing group, adjacent dates and null replacement',async()=>{
 const p=props();render(<LeaveRosterContinuations {...p}/>);expect(screen.queryByRole('combobox')).toBeNull()
 fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:'Continue unchanged schedule'}})
 fireEvent.click(screen.getByRole('button',{name:'Perpanjang kelompok Synthetic person'}))
 await waitFor(()=>expect(p.send).toHaveBeenCalledWith({operation:'set_group_membership',continuationFingerprint:row.continuationFingerprint,employeeId,groupId,effectiveFrom:row.effectiveFrom,effectiveUntil:row.effectiveUntil,replaceMembershipId:null,expectedVersion:3,reason:'Continue unchanged schedule'}))
 expect(p.onSaved).toHaveBeenCalledOnce()
})
test('unconfirmed authority hides schedule rows and cannot submit a retained draft',()=>{
 const p=props(),view=render(<LeaveRosterContinuations {...p}/>);fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:'Draft'}})
 view.rerender(<LeaveRosterContinuations {...p} authorityReady={false}/>);expect(screen.queryByText('Synthetic person')).toBeNull();expect(screen.queryByDisplayValue('Draft')).toBeNull();expect(p.send).not.toHaveBeenCalled()
 view.rerender(<LeaveRosterContinuations {...p}/>);expect(screen.getByDisplayValue('Draft')).toBeTruthy()
})
test('stale completed read prevents an old row click from submitting',()=>{
 mocks.read.mockReturnValue({available:true,data:response(),isCurrent:()=>false,isFetching:false,refetch:vi.fn()});const p=props();render(<LeaveRosterContinuations {...p}/>)
 fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:'Draft'}});fireEvent.click(screen.getByRole('button',{name:'Perpanjang kelompok Synthetic person'}));expect(p.send).not.toHaveBeenCalled()
})
test('loading and error are not represented as an empty schedule',()=>{
 const p=props();mocks.read.mockReturnValue({available:false,isFetching:true,isCurrent:()=>false});const view=render(<LeaveRosterContinuations {...p}/>)
 expect(screen.queryByText(/Belum ada kelompok/)).toBeNull();mocks.read.mockReturnValue({available:false,isFetching:false,isError:true,isCurrent:()=>false,refetch:vi.fn()});view.rerender(<LeaveRosterContinuations {...p}/>);expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByText(/Belum ada kelompok/)).toBeNull()
})

test('continuation token is serialized only when explicitly supplied',async()=>{
 const {toSetupPayload}=await import('../../src/lib/leave/setupRpc')
 const command={operation:'set_group_membership' as const,employeeId,groupId,effectiveFrom:row.effectiveFrom,effectiveUntil:row.effectiveUntil,replaceMembershipId:null,expectedVersion:3,reason:'Continue'}
 expect(toSetupPayload(command)).not.toHaveProperty('continuation_fingerprint')
 expect(toSetupPayload({...command,continuationFingerprint:row.continuationFingerprint})).toHaveProperty('continuation_fingerprint',row.continuationFingerprint)
 expect(()=>toSetupPayload({...command,continuationFingerprint:'tampered'})).toThrow()
})

test('a separate calendar draft blocks extension without pretending authority is loading',()=>{
 const p=props();render(<LeaveRosterContinuations {...p} blockedByCalendarDraft/>);fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:'Keep this draft'}})
 expect(screen.getByRole('status').textContent).toContain('Simpan atau batalkan perubahan kalender')
 fireEvent.click(screen.getByRole('button',{name:'Perpanjang kelompok Synthetic person'}));expect(p.send).not.toHaveBeenCalled();expect(screen.getByDisplayValue('Keep this draft')).toBeTruthy()
})

function warned(){
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented
}

test('a continuation reason stays unload-protected while authority is suspended and releases when cleared',()=>{
 const p=props(),view=render(<LeaveRosterContinuations {...p}/>);expect(warned()).toBe(false)
 fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:'Unsaved reason'}});expect(warned()).toBe(true)
 view.rerender(<LeaveRosterContinuations {...p} authorityReady={false}/>);expect(warned()).toBe(true);expect(screen.queryByDisplayValue('Unsaved reason')).toBeNull()
 view.rerender(<LeaveRosterContinuations {...p}/>);fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:''}});expect(warned()).toBe(false)
 view.unmount();expect(warned()).toBe(false)
})

test('confirmed continuation save clears its own unload warning',async()=>{
 const p=props();render(<LeaveRosterContinuations {...p}/>);fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:'Save reason'}});expect(warned()).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Perpanjang kelompok Synthetic person'}));await waitFor(()=>expect(p.onSaved).toHaveBeenCalledOnce())
 expect(warned()).toBe(false);expect(screen.getByLabelText('Alasan perpanjangan kelompok')).toHaveProperty('value','')
})

test('unconfirmed continuation save retains the reason and unload warning',async()=>{
 const p=props();p.send.mockRejectedValue(new Error('unconfirmed'));render(<LeaveRosterContinuations {...p}/>);fireEvent.change(screen.getByLabelText('Alasan perpanjangan kelompok'),{target:{value:'Keep reason'}})
 fireEvent.click(screen.getByRole('button',{name:'Perpanjang kelompok Synthetic person'}));await screen.findByRole('alert')
 expect(p.onSaved).not.toHaveBeenCalled();expect(screen.getByDisplayValue('Keep reason')).toBeTruthy();expect(warned()).toBe(true)
})
