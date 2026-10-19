import {transferableAbortController} from 'node:util'
import {useState} from 'react'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {createMemoryRouter,RouterProvider,useNavigate} from 'react-router-dom'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({callback:null as any,role:'executive',signOut:vi.fn(),id:'10000000-0000-0000-0000-000000000001'}))
vi.mock('../../src/lib/supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:state.id}}}}),onAuthStateChange:(callback:any)=>{state.callback=callback;return {data:{subscription:{unsubscribe:vi.fn()}}}},signOut:()=>state.signOut()},rpc:()=>({single:async()=>({data:{id:state.id,role:state.role,is_active:true,full_name:'Synthetic director'},error:null})})}}))
import {AuthProvider,useAuth} from '../../src/lib/AuthContext'
import {useEmployeeIdentityBoundary,getEmployeeAuthority} from '../../src/lib/employees/useEmployeeContext'
import {EMPLOYEE_BACKEND,recoveryStorageKey} from '../../src/lib/employees/queryKeys'
import {employeeId,operationId} from './fixtures'
import {useEmployeeNavigationGuard} from '../../src/lib/employees/useEmployeeNavigationGuard'
let client:QueryClient,router:ReturnType<typeof createMemoryRouter>
function Editor(){const auth=useAuth(),navigate=useNavigate(),[draft,setDraft]=useState('Synthetic draft'),[pending,setPending]=useState(false),[error,setError]=useState('');const guard=useEmployeeNavigationGuard({dirty:!!draft,pending});return <><input aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/><button onClick={()=>guard.confirmDiscard(()=>navigate('/list'))}>Cancel</button><button onClick={()=>navigate(-1)}>Back</button><button onClick={()=>navigate(1)}>Forward</button><button onClick={()=>{setDraft('');setPending(true)}}>Pending only</button><button onClick={()=>guard.runWithoutPrompt(()=>navigate('/saved'))}>Known committed</button><button onClick={()=>void auth.signOut().catch(()=>setError('Logout failed'))}>Logout</button>{error&&<p>{error}</p>}{guard.dialog}</>}
function IdentityBoundary(){useEmployeeIdentityBoundary();return null}
function Tree(){const auth=useAuth();return auth.loading?<p>Loading</p>:!auth.user?<p>Signed out</p>:auth.profile?.role!=='executive'?<p>Employee access removed</p>:<Editor/>}
async function mount(){client=new QueryClient();router=createMemoryRouter([{path:'/editor',element:<QueryClientProvider client={client}><AuthProvider><IdentityBoundary/><Tree/></AuthProvider></QueryClientProvider>},{path:'/list',element:<p>List</p>},{path:'/saved',element:<p>Saved</p>}],{initialEntries:['/list','/editor','/saved'],initialIndex:1});render(<RouterProvider router={router}/>);await screen.findByLabelText('Draft');await act(async()=>{})}
beforeEach(()=>{state.role='executive';sessionStorage.clear();vi.stubGlobal('AbortController',class {constructor(){return transferableAbortController()}});state.signOut.mockReset().mockResolvedValue({error:null})})
afterEach(()=>{cleanup();router?.dispose();client?.clear()})
it('Cancel asks once, Keep preserves the editor and discard changes location',async()=>{await mount();fireEvent.click(screen.getByText('Cancel'));expect(screen.getAllByRole('dialog')).toHaveLength(1);fireEvent.click(screen.getByText('Tetap mengedit'));expect(router.state.location.pathname).toBe('/editor');expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Synthetic draft');fireEvent.click(screen.getByText('Cancel'));fireEvent.click(screen.getByText('Buang perubahan'));await screen.findByText('List');expect(screen.queryByRole('dialog')).toBeNull()})
it.each(['Back','Forward'])('%s navigation is protected and Keep does not corrupt history',async direction=>{await mount();fireEvent.click(screen.getByText(direction));fireEvent.click(await screen.findByText('Tetap mengedit'));expect(router.state.location.pathname).toBe('/editor');fireEvent.click(screen.getByText(direction));fireEvent.click(await screen.findByText('Buang perubahan'));await screen.findByText(direction==='Back'?'List':'Saved')})
it('pending work alone guards navigation and browser close without claiming to cancel the command',async()=>{await mount();fireEvent.click(screen.getByText('Pending only'));fireEvent.click(screen.getByText('Cancel'));expect(screen.getByRole('dialog').textContent).toContain('Permintaan yang sudah dikirim tidak dibatalkan');const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)})
it('sign-out reuses one dialog, Keep cancels, and failed logout preserves draft and re-arms the guard',async()=>{state.signOut.mockResolvedValue({error:new Error('synthetic failure')});await mount();fireEvent.click(screen.getByText('Logout'));fireEvent.click(screen.getByText('Logout'));await screen.findByRole('dialog');expect(screen.getAllByRole('dialog')).toHaveLength(1);fireEvent.click(screen.getByText('Tetap mengedit'));expect(state.signOut).not.toHaveBeenCalled();await act(async()=>{});fireEvent.click(screen.getByText('Logout'));fireEvent.click(await screen.findByText('Buang perubahan'));await screen.findByText('Logout failed');expect((screen.getByLabelText('Draft')as HTMLInputElement).value).toBe('Synthetic draft');fireEvent.click(screen.getByText('Logout'));await screen.findByRole('dialog');expect(state.signOut).toHaveBeenCalledTimes(1)})
it('same-user token refresh preserves mounted drafts; successful logout clears without a second dialog',async()=>{await mount();const input=screen.getByLabelText('Draft');await act(async()=>state.callback('TOKEN_REFRESHED',{user:{id:state.id}}));expect(screen.getByLabelText('Draft')).toBe(input);expect((input as HTMLInputElement).value).toBe('Synthetic draft');fireEvent.click(screen.getByText('Logout'));fireEvent.click(await screen.findByText('Buang perubahan'));await screen.findByText('Signed out');expect(screen.queryByRole('dialog')).toBeNull();expect(state.signOut).toHaveBeenCalledTimes(1)})
it('known committed navigation bypasses only navigation, not a discarded or failed save',async()=>{await mount();fireEvent.click(screen.getByText('Known committed'));await screen.findByText('Saved');expect(screen.queryByRole('dialog')).toBeNull()})

it('persistent identity boundary clears recovery on logout even when auth-gated editor unmounts',async()=>{
 await mount();const key=recoveryStorageKey(EMPLOYEE_BACKEND,state.id);sessionStorage.setItem(key,JSON.stringify({actorId:state.id,backend:EMPLOYEE_BACKEND,employeeId,operationId}))
 await act(async()=>state.callback('TOKEN_REFRESHED',{user:{id:state.id}}));expect(sessionStorage.getItem(key)).not.toBeNull()
 await act(async()=>state.callback('SIGNED_OUT',null));await screen.findByText('Signed out');expect(sessionStorage.length).toBe(0)
})

it('verified same-user demotion purges recovery when the real auth gate unmounts the editor',async()=>{
 await mount();const generation=getEmployeeAuthority(client).draftGeneration,key=recoveryStorageKey(EMPLOYEE_BACKEND,state.id)
 sessionStorage.setItem(key,JSON.stringify({actorId:state.id,backend:EMPLOYEE_BACKEND,employeeId,operationId}))
 state.role='sales_person';await act(async()=>state.callback('TOKEN_REFRESHED',{user:{id:state.id}}));await screen.findByText('Employee access removed')
 expect(screen.queryByLabelText('Draft')).toBeNull();expect(sessionStorage.getItem(key)).toBeNull();expect(getEmployeeAuthority(client).ready).toBe(false);expect(getEmployeeAuthority(client).draftGeneration).toBeGreaterThan(generation)
})
it('real same-Director refresh and failed voluntary logout preserve recovery and purge generation',async()=>{
 state.signOut.mockResolvedValue({error:new Error('synthetic failure')});await mount()
 const generation=getEmployeeAuthority(client).draftGeneration,key=recoveryStorageKey(EMPLOYEE_BACKEND,state.id),marker=JSON.stringify({actorId:state.id,backend:EMPLOYEE_BACKEND,employeeId,operationId})
 sessionStorage.setItem(key,marker);await act(async()=>state.callback('TOKEN_REFRESHED',{user:{id:state.id}}))
 expect(sessionStorage.getItem(key)).toBe(marker);expect(getEmployeeAuthority(client).draftGeneration).toBe(generation)
 fireEvent.click(screen.getByText('Logout'));fireEvent.click(await screen.findByText('Buang perubahan'));await screen.findByText('Logout failed')
 expect(sessionStorage.getItem(key)).toBe(marker);expect(getEmployeeAuthority(client).draftGeneration).toBe(generation);expect((screen.getByLabelText('Draft')as HTMLInputElement).value).toBe('Synthetic draft')
})
