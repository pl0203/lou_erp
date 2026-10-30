import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
const state=vi.hoisted(()=>({auth:{user:null as any,profile:null as any,loading:true,identityRevision:1,error:null},signIn:vi.fn()}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>state.auth}))
vi.mock('../src/lib/supabase',()=>({supabase:{auth:{signInWithPassword:state.signIn}}}))
import Login from '../src/pages/Login'
import ProtectedRoute from '../src/components/ProtectedRoute'
import SessionLoading from '../src/components/SessionLoading'
beforeEach(()=>{Object.assign(state.auth,{user:null,profile:null,loading:true,identityRevision:1,error:null});state.signIn.mockReset().mockResolvedValue({error:null})})
afterEach(cleanup)
test('neutral session presentation has one polite status and no fabricated progress or private content',()=>{
 render(<SessionLoading/>);expect(screen.getAllByRole('status')).toHaveLength(1)
 expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
 expect(screen.getByText('Memeriksa sesi…')).toBeTruthy();expect(screen.queryByRole('progressbar')).toBeNull()
 expect(screen.queryByRole('textbox')).toBeNull()
})
test('protected route never exposes a private child while a matching active profile is still loading',()=>{
 state.auth.user={id:'actor'};state.auth.profile={id:'actor',role:'co_admin',is_active:true}
 const view=render(<MemoryRouter><ProtectedRoute allowedRoles={['co_admin']}><p>Private ledger data</p></ProtectedRoute></MemoryRouter>)
 expect(screen.getByText('Memeriksa sesi…')).toBeTruthy();expect(screen.queryByText('Private ledger data')).toBeNull()
 state.auth.loading=false;view.rerender(<MemoryRouter><ProtectedRoute allowedRoles={['co_admin']}><p>Private ledger data</p></ProtectedRoute></MemoryRouter>)
 expect(screen.getByText('Private ledger data')).toBeTruthy()
})
test('initial login restore is neutral but a submitted login stays mounted and locked through profile verification',async()=>{
 const view=render(<MemoryRouter><Login/></MemoryRouter>)
 expect(screen.getByText('Memeriksa sesi…')).toBeTruthy();expect(screen.queryByPlaceholderText('anda@perusahaan.com')).toBeNull()
 state.auth.loading=false;view.rerender(<MemoryRouter><Login/></MemoryRouter>)
 const email=screen.getByPlaceholderText('anda@perusahaan.com') as HTMLInputElement
 const password=document.querySelector('input[type=password]') as HTMLInputElement
 fireEvent.change(email,{target:{value:'synthetic@example.invalid'}});fireEvent.change(password,{target:{value:'synthetic-test-only'}})
 fireEvent.click(screen.getByRole('button',{name:'Masuk'}));await waitFor(()=>expect(state.signIn).toHaveBeenCalledTimes(1))
 state.auth.loading=true;view.rerender(<MemoryRouter><Login/></MemoryRouter>)
 expect(screen.getByPlaceholderText('anda@perusahaan.com')).toBe(email);expect(email.value).toBe('synthetic@example.invalid')
 expect(email.disabled).toBe(true);expect(password.disabled).toBe(true)
 const submit=screen.getByRole('button',{name:'Sedang masuk…'}) as HTMLButtonElement
 expect(submit.disabled).toBe(true);fireEvent.click(submit);expect(state.signIn).toHaveBeenCalledTimes(1)
 expect(screen.queryByText('Memeriksa sesi…')).toBeNull()
})
