import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const mocks=vi.hoisted(()=>({live:null as unknown,commit:vi.fn(),interaction:vi.fn()}))
vi.mock('../../src/lib/leave/useLeaveContext',()=>({runLeaveInteraction:(...args:unknown[])=>mocks.interaction(...args)}))
vi.mock('../../src/lib/leave/requestTransport',()=>({invalidateRequestCaches:()=>Promise.resolve()}))
import { useAdminCommand } from '../../src/pages/ihr/leave/LeaveAdminWritePanels'
const context:LeaveContext={scopeVersion:'scope',memberKind:'director',timezone:null,balances:[],setup:{ready:false,blockers:[]},capabilities:{request:false,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false,calendarConfigure:true}}
const clean=()=>{},confirmed=()=>Promise.resolve()
function Harness({authority='calendar',ready=true}:{authority?:'member'|'calendar';ready?:boolean}){
 const command=useAdminCommand({authority,actorId:'71000000-0000-0000-0000-000000000004',context,formScope:'test-calendar',readState:'ready',fresh:ready,draftDirty:false,onDirtyChange:clean,onConfirmed:confirmed,
  makeTransport:authorize=>({send:async()=>{await authorize();mocks.commit();return {id:'73000000-0000-0000-0000-000000000090',version:2,operation:'save_calendar_version'}},hasUnresolved:()=>false,acknowledgeRecovered:clean,reconcile:async()=>({state:'abandoned'})})})
 return <button onClick={()=>void command.send({}).catch(()=>{})}>Send</button>
}
const mount=(props:Parameters<typeof Harness>[0]={})=>render(<QueryClientProvider client={new QueryClient()}><Harness {...props}/></QueryClientProvider>)
beforeEach(()=>{vi.clearAllMocks();mocks.live=context;mocks.interaction.mockImplementation(async(_client,_actor,_scope,action)=>action(mocks.live))});afterEach(cleanup)
test('calendar command uses a fresh explicit calendar capability',async()=>{mount();fireEvent.click(screen.getByText('Send'));await waitFor(()=>expect(mocks.commit).toHaveBeenCalledOnce());expect(mocks.interaction).toHaveBeenCalledOnce()})
test.each([false,undefined])('revoked or omitted live capability (%s) blocks stale Director send',async calendarConfigure=>{
 mocks.live={...context,capabilities:{...context.capabilities,calendarConfigure}};mount();fireEvent.click(screen.getByText('Send'));await waitFor(()=>expect(mocks.interaction).toHaveBeenCalled());expect(mocks.commit).not.toHaveBeenCalled()
})
test('separate calendar capability never authorizes the default member command path',async()=>{mount({authority:'member'});fireEvent.click(screen.getByText('Send'));await waitFor(()=>expect(mocks.interaction).toHaveBeenCalled());expect(mocks.commit).not.toHaveBeenCalled()})
test('unconfirmed calendar read never reaches mutation transport',()=>{mount({ready:false});fireEvent.click(screen.getByText('Send'));expect(mocks.interaction).not.toHaveBeenCalled();expect(mocks.commit).not.toHaveBeenCalled()})
