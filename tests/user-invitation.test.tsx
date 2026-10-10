import React from 'react'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getSession:vi.fn(),updateUser:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc,auth:{getSession:mocks.getSession,updateUser:mocks.updateUser}}}))
vi.mock('../src/components/IHRNav',()=>({default:()=>null}))
import UserManagement from '../src/pages/ihr/UserManagement'
let client:QueryClient
beforeEach(()=>{
 vi.clearAllMocks(); client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
 sessionStorage.clear(); mocks.rpc.mockResolvedValue({data:[],error:null})
 mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-not-a-real-token'}}})
 vi.stubGlobal('fetch',vi.fn())
})
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals()})
function mountUsers(){render(<QueryClientProvider client={client}><MemoryRouter><UserManagement/></MemoryRouter></QueryClientProvider>)}
function fillInvite(name='First Admin'){
 fireEvent.click(screen.getByRole('button',{name:'+ Invite User'}))
 fireEvent.change(screen.getByPlaceholderText('e.g. Budi Santoso'),{target:{value:name}})
 fireEvent.change(screen.getByPlaceholderText('budi@company.com'),{target:{value:'admin@example.test'}})
}
test('late invite success preserves a newer draft after Cancel/reopen',async()=>{
 let finish:any; vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 mountUsers(); fillInvite(); fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1))
 fireEvent.click(screen.getByRole('button',{name:'Cancel'})); fillInvite('Second Admin')
 expect((screen.getByPlaceholderText('e.g. Budi Santoso') as HTMLInputElement).value).toBe('Second Admin')
 await act(async()=>finish(new Response(JSON.stringify({success:true,user_id:'synthetic'}),{status:200})))
 await waitFor(()=>expect(screen.queryByText('Saving...')).toBeNull()); expect((screen.getByPlaceholderText('e.g. Budi Santoso') as HTMLInputElement).value).toBe('Second Admin')
})
test('prior invitation error is cleared for the next untouched draft',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({error:'First invite failed',code:'INVALID_PAYLOAD'}),{status:400}))
 mountUsers(); fillInvite(); fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await screen.findByText('First invite failed')
 fireEvent.click(screen.getByRole('button',{name:'Cancel'})); fillInvite('Second Admin')
 expect(screen.queryByText('First invite failed')).toBeNull()
})
test('user-list RPC failure is visible and has a retry action',async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:new Error('Users RPC unavailable')})
 mountUsers()
 await waitFor(()=>expect(screen.queryByText('Loading users...')).toBeNull())
 expect(screen.getByText(/Unable to load users/)).toBeTruthy();expect(screen.getByRole('button',{name:'Retry'})).toBeTruthy();expect(screen.queryByText('0 active users')).toBeNull()
})
test('partial outcome blocks the same email across modal reopen and component remount',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({error:'Do not resend. Reconcile account.',code:'INVITE_PROFILE_FAILED',may_have_sent:true,user_id:'new'}),{status:502}))
 mountUsers();fillInvite();fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await screen.findByText(/Do not resend/)
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));fillInvite()
 expect((screen.getByRole('button',{name:'Send Invite'}) as HTMLButtonElement).disabled).toBe(true)
 cleanup();mountUsers();fillInvite()
 expect((screen.getByRole('button',{name:'Send Invite'}) as HTMLButtonElement).disabled).toBe(true)
 expect(fetch).toHaveBeenCalledTimes(1)
})
test('network outcome is held for reconciliation without blind retry',async()=>{
 vi.mocked(fetch).mockRejectedValue(new Error('Connection dropped'))
 mountUsers();fillInvite();fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await screen.findByText(/Do not resend/)
 expect((screen.getByRole('button',{name:'Send Invite'}) as HTMLButtonElement).disabled).toBe(true)
})
test('storage failure prevents the external invitation rather than losing reload protection',async()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage unavailable')})
 mountUsers();fillInvite();fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await screen.findByText(/Unable to safely track/)
 expect(fetch).not.toHaveBeenCalled()
})
test('unclassified server error blocks retry because the external outcome is unknown',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({error:'Internal server error'}),{status:500}))
 mountUsers();fillInvite();fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await screen.findByText(/Do not resend/)
 expect((screen.getByRole('button',{name:'Send Invite'}) as HTMLButtonElement).disabled).toBe(true)
})
test('pending invitation is held across unmount/reload before a response arrives',async()=>{
 let finish:any;vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 mountUsers();fillInvite();fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1))
 cleanup();mountUsers();fillInvite()
 expect((screen.getByRole('button',{name:'Send Invite'}) as HTMLButtonElement).disabled).toBe(true)
 await act(async()=>finish(new Response(JSON.stringify({success:true,user_id:'new-user'}),{status:200})))
 expect(fetch).toHaveBeenCalledTimes(1)
})
test('unexpected response-processing failure retains the pre-send reconciliation marker',async()=>{
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({get success(){throw new Error('unexpected response processing')}})} as any)
 mountUsers();fillInvite();fireEvent.click(screen.getByRole('button',{name:'Send Invite'}))
 await screen.findByText(/Do not resend/)
 expect((screen.getByRole('button',{name:'Send Invite'}) as HTMLButtonElement).disabled).toBe(true)
 cleanup();mountUsers();fillInvite()
 expect((screen.getByRole('button',{name:'Send Invite'}) as HTMLButtonElement).disabled).toBe(true)
})
