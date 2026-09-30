import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const state=vi.hoisted(()=>({callback:null as any, resolveProfile:null as any, resolveSession:null as any}))
vi.mock('../src/lib/supabase',()=>({supabase:{auth:{getSession:()=>new Promise(resolve=>{state.resolveSession=resolve}),onAuthStateChange:(cb:any)=>{state.callback=cb;return {data:{subscription:{unsubscribe:()=>{}}}}},signOut:async()=>({error:null})},from:()=>{const q:any={select:()=>q,eq:()=>q,single:()=>new Promise(resolve=>{state.resolveProfile=resolve})};return q}}}))
import ProtectedRoute from '../src/components/ProtectedRoute'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '../src/lib/AuthContext'
function Probe(){ const auth=useAuth(); return <p>{auth.loading?'loading':`${auth.user?.id??'none'}:${auth.profile?.id??'none'}`}</p> }
let client:QueryClient
beforeEach(()=>{state.callback=null;state.resolveProfile=null;client=new QueryClient({defaultOptions:{queries:{retry:false}}})})
afterEach(cleanup)
function mount(){render(<QueryClientProvider client={client}><AuthProvider><Probe/></AuthProvider></QueryClientProvider>)}
test('keeps protected content loading until profile resolves',async()=>{
 mount();await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 expect(screen.getByText('loading')).toBeTruthy()
 await act(async()=>state.resolveProfile({data:{id:'a',role:'executive',is_active:true},error:null}))
 expect(screen.getByText('a:a')).toBeTruthy()
})
test('ignores a stale profile after sign out and clears other-user cache',async()=>{
 mount();await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 const stale=state.resolveProfile
 client.setQueryData(['customers'],[{name:'private'}])
 await act(async()=>state.callback('SIGNED_OUT',null))
 await act(async()=>stale({data:{id:'a',role:'executive',is_active:true},error:null}))
 expect(screen.getByText('none:none')).toBeTruthy()
 expect(client.getQueryData(['customers'])).toBeUndefined()
})
test('failed profile fetch never retains earlier profile',async()=>{
 mount();await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 await act(async()=>state.resolveProfile({data:{id:'a',role:'executive',is_active:true},error:null}))
 await act(async()=>state.callback('SIGNED_IN',{user:{id:'b'}}))
 await act(async()=>state.resolveProfile({data:null,error:new Error('offline')}))
 await waitFor(()=>expect(screen.getByText('b:none')).toBeTruthy())
})
test('late initial session cannot overwrite newer signed-out state',async()=>{
 mount();await act(async()=>state.callback('SIGNED_OUT',null))
 await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 expect(screen.getByText('none:none')).toBeTruthy()
})
test('late profile from account A cannot replace account B',async()=>{
 mount();await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 const stale=state.resolveProfile
 await act(async()=>state.callback('SIGNED_IN',{user:{id:'b'}}))
 await act(async()=>state.resolveProfile({data:{id:'b',role:'sales_person',is_active:true},error:null}))
 await act(async()=>stale({data:{id:'a',role:'executive',is_active:false},error:null}))
 expect(screen.getByText('b:b')).toBeTruthy()
})
test('token refresh profile failure removes old privileges',async()=>{
 mount();await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 await act(async()=>state.resolveProfile({data:{id:'a',role:'executive',is_active:true},error:null}))
 await act(async()=>state.callback('TOKEN_REFRESHED',{user:{id:'a'}}))
 expect(screen.getByText('a:a')).toBeTruthy()
 await act(async()=>state.resolveProfile({data:null,error:new Error('offline')}))
 expect(screen.getByText('a:none')).toBeTruthy()
})
test('query ignoring abort cannot restore previous-user data after logout',async()=>{
 mount();await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 await act(async()=>state.resolveProfile({data:{id:'a',role:'executive',is_active:true},error:null}))
 let finish:any
 const pending=client.fetchQuery({queryKey:['private'],queryFn:()=>new Promise(resolve=>{finish=resolve})}).catch(()=>undefined)
 await act(async()=>state.callback('SIGNED_OUT',null))
 finish('private payload');await pending
 expect(client.getQueryData(['private'])).toBeUndefined()
})
for (const event of ['TOKEN_REFRESHED','SIGNED_IN']) test(`${event} preserves an unsaved mounted protected form`,async()=>{
 function Form(){return <ProtectedRoute allowedRoles={['executive']}><input aria-label='draft' defaultValue=''/></ProtectedRoute>}
 render(<QueryClientProvider client={client}><AuthProvider><MemoryRouter><Form/></MemoryRouter></AuthProvider></QueryClientProvider>)
 await act(async()=>state.resolveSession({data:{session:{user:{id:'a'}}}}))
 await act(async()=>state.resolveProfile({data:{id:'a',role:'executive',is_active:true},error:null}))
 const input=screen.getByLabelText('draft') as HTMLInputElement;input.value='unsaved order'
 await act(async()=>state.callback(event,{user:{id:'a'}}))
 await act(async()=>state.resolveProfile({data:{id:'a',role:'executive',is_active:true},error:null}))
 expect(screen.getByLabelText('draft')).toBe(input)
 expect(input.value).toBe('unsaved order')
})
