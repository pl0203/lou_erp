import React from 'react'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
const mocks=vi.hoisted(()=>({getPasswordSetupIdentity:vi.fn(),getSession:vi.fn(),updateUser:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({getPasswordSetupIdentity:mocks.getPasswordSetupIdentity,updatePasswordForSetup:async(userId:string,password:string)=>{
 const {updateBoundPassword}=await import('../src/lib/passwordSetup')
 return updateBoundPassword({getSession:mocks.getSession} as any,()=>({setSession:async()=>({data:{user:{id:'invited-user'}},error:null}),updateUser:mocks.updateUser,stopAutoRefresh:async()=>{}}) as any,userId,password)
}}))
import ResetPassword from '../src/pages/ResetPassword'
beforeEach(()=>{vi.clearAllMocks();mocks.getPasswordSetupIdentity.mockResolvedValue({identity:{userId:'invited-user',email:'invitee@example.test'},error:null});mocks.getSession.mockResolvedValue({data:{session:{user:{id:'invited-user'},access_token:'synthetic-token',refresh_token:'synthetic-refresh'}},error:null});mocks.updateUser.mockResolvedValue({error:null})})
afterEach(cleanup)
function mount(){render(<MemoryRouter initialEntries={['/reset-password']}><Routes><Route path='/reset-password' element={<ResetPassword/>}/><Route path='/login' element={<p>Login route</p>}/></Routes></MemoryRouter>)}
async function fill(){await waitFor(()=>expect((screen.getByRole('button',{name:'Simpan kata sandi'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.change(screen.getByPlaceholderText('Minimal 8 karakter'),{target:{value:'Synthetic8!'}});fireEvent.change(screen.getByPlaceholderText('Ulangi kata sandi Anda'),{target:{value:'Synthetic8!'}})}
test('expired invitation cannot update existing executive session',async()=>{mocks.getPasswordSetupIdentity.mockResolvedValue({identity:null,error:'Tautan tidak valid atau kedaluwarsa.'});mocks.getSession.mockResolvedValue({data:{session:{user:{id:'old-executive'}}},error:null});mount();await screen.findByText('Tautan tidak valid atau kedaluwarsa.');expect(mocks.updateUser).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Simpan kata sandi'})).toBeNull()})
test('valid setup displays target account and saves once',async()=>{mount();await fill();expect(screen.getByText('invitee@example.test')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Simpan kata sandi'}));await screen.findByText('Login route');expect(mocks.updateUser).toHaveBeenCalledTimes(1)})
test('Enter while saving cannot submit another password update',async()=>{let finish:any;mocks.updateUser.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));mount();await fill();fireEvent.click(screen.getByRole('button',{name:'Simpan kata sandi'}));await waitFor(()=>expect(mocks.updateUser).toHaveBeenCalledTimes(1));fireEvent.keyDown(screen.getByPlaceholderText('Ulangi kata sandi Anda'),{key:'Enter'});expect(mocks.updateUser).toHaveBeenCalledTimes(1);await act(async()=>finish({error:null}))})
test('session switch after callback blocks password write',async()=>{mount();await fill();mocks.getSession.mockResolvedValue({data:{session:{user:{id:'different-user'}}},error:null});fireEvent.click(screen.getByRole('button',{name:'Simpan kata sandi'}));await screen.findByText(/Sesi akun berubah/);expect(mocks.updateUser).not.toHaveBeenCalled()})
test('unexpected update rejection re-enables form with safe error',async()=>{mocks.updateUser.mockRejectedValue(new Error('synthetic network failure'));mount();await fill();fireEvent.click(screen.getByRole('button',{name:'Simpan kata sandi'}));await screen.findByText(/Tidak dapat menyimpan/);expect((screen.getByRole('button',{name:'Simpan kata sandi'}) as HTMLButtonElement).disabled).toBe(false)})
for (const type of ['invite', 'recovery']) test(`installed SDK plus reset UI refuses failed ${type} callback without touching the stored executive account`, async () => {
 const {GoTrueClient}=await import('@supabase/auth-js')
 const {preparePasswordSetup}=await import('../src/lib/passwordSetup')
 const original=window.location.href
 window.history.replaceState({},'',`/reset-password#error=access_denied&error_code=otp_expired&error_description=Expired&type=${type}`)
 const callbackUrl=window.location.href
 const key=`reset-ui-${type}`
 const user={id:'old-executive',email:'executive@example.test',aud:'authenticated',created_at:'2026-01-01T00:00:00Z'}
 const values:Record<string,string>={[key]:JSON.stringify({access_token:'synthetic-old-session',refresh_token:'synthetic-old-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})}
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(user),{status:200,headers:{'content-type':'application/json'}}))
 const auth=new GoTrueClient({url:'https://synthetic.example.test/auth/v1',storageKey:key,storage:{getItem:k=>values[k]??null,setItem:(k,v)=>{values[k]=v},removeItem:k=>{delete values[k]}},autoRefreshToken:false,persistSession:true,detectSessionInUrl:true,fetch:fetcher})
 try {
  mocks.getPasswordSetupIdentity.mockImplementation(()=>preparePasswordSetup(auth,callbackUrl))
  mocks.getSession.mockImplementation(()=>auth.getSession())
  mocks.updateUser.mockImplementation(value=>auth.updateUser(value))
  mount();await screen.findByText(/Tautan tidak valid atau kedaluwarsa/)
  expect((await auth.getSession()).data.session?.user.id).toBe('old-executive')
  expect(mocks.updateUser).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByRole('button',{name:'Simpan kata sandi'})).toBeNull()
 } finally {auth.stopAutoRefresh();window.history.replaceState({},'',original)}
})
test('same-account session refresh does not invalidate a verified password setup',async()=>{mount();await fill();mocks.getSession.mockResolvedValue({data:{session:{user:{id:'invited-user'},access_token:'synthetic-refreshed-session',refresh_token:'synthetic-refresh'}},error:null});fireEvent.click(screen.getByRole('button',{name:'Simpan kata sandi'}));await screen.findByText('Login route');expect(mocks.updateUser).toHaveBeenCalledTimes(1)})
