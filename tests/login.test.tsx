import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
const state=vi.hoisted(()=>({auth:{profile:null,loading:false,identityRevision:1,error:'Profile unavailable'},signIn:vi.fn(async()=>({error:null}))}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>state.auth}))
vi.mock('../src/lib/supabase',()=>({supabase:{auth:{signInWithPassword:state.signIn}}}))
import Login from '../src/pages/Login'
afterEach(cleanup)
test('only a new completed profile error permits another login attempt',async()=>{
 const view=render(<MemoryRouter><Login/></MemoryRouter>)
 fireEvent.change(screen.getByPlaceholderText('anda@perusahaan.com'),{target:{value:'a@example.test'}})
 fireEvent.change(document.querySelector('input[type=password]')!,{target:{value:'dummy'}})
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}))
 await waitFor(()=>expect(state.signIn).toHaveBeenCalledTimes(1))
 // The old profile error is not a completion receipt for this attempt.
 expect((screen.getByRole('button',{name:'Sedang masuk…'}) as HTMLButtonElement).disabled).toBe(true)
 state.auth.identityRevision=2
 view.rerender(<MemoryRouter><Login/></MemoryRouter>)
 await waitFor(()=>expect((screen.getByRole('button',{name:'Coba lagi'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.getByText('Profile unavailable')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}))
 await waitFor(()=>expect(state.signIn).toHaveBeenCalledTimes(2))
})
