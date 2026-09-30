import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({profile:null,loading:false,error:'Profile unavailable'})}))
vi.mock('../src/lib/supabase',()=>({supabase:{auth:{signInWithPassword:async()=>({error:null})},from:()=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:null,error:new Error('missing')})};return q}}}))
import Login from '../src/pages/Login'
afterEach(cleanup)
test('displays profile error and permits another login attempt',async()=>{
 render(<Login/>);
 fireEvent.change(screen.getByPlaceholderText('anda@perusahaan.com'),{target:{value:'a@example.test'}})
 fireEvent.change(document.querySelector('input[type=password]')!,{target:{value:'dummy'}})
 fireEvent.click(screen.getByRole('button',{name:'Masuk'}))
 await waitFor(()=>expect((screen.getByRole('button',{name:'Masuk'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.getByText('Profile unavailable')).toBeTruthy()
})
