import { act,cleanup,fireEvent,render,screen } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const mocks=vi.hoisted(()=>({busy:false,saved:vi.fn(),command:vi.fn(),rota:null as any,extension:null as any}))
const calendar={id:'73000000-0000-0000-0000-000000000090',name:'Synthetic calendar',version:3,effectiveFrom:'2026-10-20',effectiveUntil:'2027-01-01',timezone:'Asia/Jakarta',holidaysConfirmed:true,sundayMinutes:0,holidays:[],groups:[]}
vi.mock('../../src/lib/leave/useLeaveReads',()=>({useAuthorizedLeaveRead:(_actor:unknown,_context:unknown,key:unknown[])=>({available:true,isCurrent:()=>true,data:key.includes('rota-context')?{calendar,authorityKey:'proof'}:{rows:[calendar],total:1},refetch:vi.fn()})}))
vi.mock('../../src/pages/ihr/leave/LeaveAdminWritePanels',()=>({useAdminCommand:(props:unknown)=>{mocks.command(props);return {busy:mocks.busy,recovery:false,recoveryUI:null,send:vi.fn()}}}))
vi.mock('../../src/pages/ihr/leave/useAdminEditorContinuity',()=>({useAdminEditorContinuity:(_scope:unknown,_key:unknown,fresh:boolean)=>({key:0,ready:fresh,retaining:false,onSaved:mocks.saved,onReceipt:vi.fn(),wait:vi.fn()})}))
vi.mock('../../src/pages/ihr/leave/LeaveRotaSettings',()=>({default:(props:unknown)=>{mocks.rota=props;return <p>Calendar editor</p>}}))
vi.mock('../../src/pages/ihr/leave/LeaveRosterContinuations',()=>({default:(props:unknown)=>{mocks.extension=props;return <p>Continuation editor</p>}}))
import LeaveAdminRotaPanel from '../../src/pages/ihr/leave/LeaveAdminRotaPanel'
const context:LeaveContext={scopeVersion:'scope',memberKind:'director',timezone:null,balances:[],setup:{ready:false,blockers:[]},capabilities:{request:false,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false,calendarConfigure:true}}
const dirty=()=>{}
function mount(){const client=new QueryClient(),element=()=> <QueryClientProvider client={client}><LeaveAdminRotaPanel actorId="71000000-0000-0000-0000-000000000004" context={context} readState="ready" onDirtyChange={dirty}/></QueryClientProvider>;const view=render(element());fireEvent.click(screen.getByRole('button',{name:'Atur kalender Synthetic calendar'}));return ()=>view.rerender(element())}
beforeEach(()=>{vi.clearAllMocks();mocks.busy=false;mocks.rota=null;mocks.extension=null});afterEach(cleanup)
test('shared in-flight command suspends both editors and uses only calendar authority',()=>{
 const refresh=mount();expect(mocks.rota.authorityReady).toBe(true);expect(mocks.extension.authorityReady).toBe(true)
 mocks.busy=true;refresh();expect(mocks.rota.authorityReady).toBe(false);expect(mocks.extension.authorityReady).toBe(false)
 expect(mocks.command).toHaveBeenLastCalledWith(expect.objectContaining({authority:'calendar'}))
})
test('old extension completion reads the current calendar draft before deciding to remount',()=>{
 mount();const complete=mocks.extension.onSaved;act(()=>mocks.rota.onDirtyChange(true));act(()=>complete())
 expect(mocks.saved).toHaveBeenLastCalledWith({hasUnsavedChanges:true})
})
test('old calendar completion preserves a newer extension reason draft',()=>{
 mount();const complete=mocks.rota.onSaved;act(()=>mocks.extension.onDirtyChange(true));act(()=>complete({hasUnsavedChanges:false}))
 expect(mocks.saved).toHaveBeenLastCalledWith({hasUnsavedChanges:true})
})
