import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({profile:null,loading:false,error:'Profile unavailable'})}))
vi.mock('../src/lib/supabase',()=>({supabase:{auth:{signInWithPassword:async()=>({error:new Error('synthetic credential failure')})},from:()=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:null,error:new Error('missing')})};return q}}}))
import Login from '../src/pages/Login'
afterEach(cleanup)
test('displays profile error and permits another login attempt',async()=>{
 render(<MemoryRouter><Login/></MemoryRouter>);
 expect(screen.getByText('Profile unavailable')).toBeTruthy()
 fireEvent.change(screen.getByPlaceholderText('anda@perusahaan.com'),{target:{value:'a@example.test'}})
 fireEvent.change(document.querySelector('input[type=password]')!,{target:{value:'dummy'}})
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}))
 await waitFor(()=>expect((screen.getByRole('button',{name:'Coba lagi'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.getByText('Email atau kata sandi salah. Silakan coba lagi.')).toBeTruthy()
})
