import type { ReactNode } from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'
import { actorId, context, detail, employeeId, fields, otherId } from './fixtures'

// Synthetic RPC boundary: the production authority/read/command/guard hooks stay real.
export const server = {
  actor: actorId, role: 'executive', active: true, allowed: true, timezone: null as string|null,
  profileCallback: null as null|((event:string,session:any)=>void),
  records: [structuredClone(detail)] as any[], candidates: [] as any[], audits: [] as any[],
  calls: [] as {name:string;args:any}[], overrides: {} as Record<string,(args:any)=>any>,
  receipts: new Map<string,any>(), signOut: vi.fn(),
  rpc(name:string,args:any={}) {
    this.calls.push({name,args})
    const work = Promise.resolve().then(async()=> {
      if(this.overrides[name]) return this.overrides[name](args)
      if(name==='pilot_my_profile') return {data:{id:this.actor,full_name:'Synthetic Director',role:this.role,is_active:this.active},error:null}
      if(name==='employee_context_v1') return {data:{...context,actorId:this.actor,canMaintainBasic:this.allowed,timezone:this.allowed?this.timezone:null,today:this.allowed&&this.timezone?'2026-10-19':null,setupBlockers:!this.allowed||this.timezone?[]:['WORKPLACE_TIMEZONE_UNCONFIRMED']},error:null}
      if(name==='employee_page_v1') {
        const rows=this.records.map(({id,version,fields})=>({id,version,...fields})).filter(row=>(!args.p_status||row.recordedStatus===args.p_status)&&`${row.name} ${row.employeeNumber??''}`.toLowerCase().includes((args.p_query??'').toLowerCase()))
        return {data:{rows:rows.slice((args.p_page-1)*args.p_page_size,args.p_page*args.p_page_size),total:rows.length,page:args.p_page,pageSize:args.p_page_size},error:null}
      }
      if(name==='employee_detail_v1') return {data:this.records.find(row=>row.id===args.p_employee_id),error:null}
      if(name==='employee_account_candidates_v1'||name==='employee_audit_v1') {
        const rows=name==='employee_audit_v1'?this.audits:this.candidates.filter(row=>`${row.displayName} ${row.email}`.toLowerCase().includes(args.p_query.toLowerCase()))
        return {data:{rows:rows.slice((args.p_page-1)*args.p_page_size,args.p_page*args.p_page_size),total:rows.length,page:args.p_page,pageSize:args.p_page_size},error:null}
      }
      if(name==='employee_preview_v1') {
        const record=this.records.find(row=>row.id===args.p_employee_id), action=args.p_action
        const section=action.includes('employee')?'fields':action==='save_initial_episode'?'episode':action==='save_reporting'?'reporting':'account'
        const before=record?{[section]:section==='account'?record.account?{userId:record.account.userId}:{}:record[section]??{}}:{}
        const after={[section]:action==='save_reporting'?args.p_payload.intervals:args.p_payload}
        return {data:{employeeId:args.p_employee_id,expectedVersion:args.p_expected_version,action,normalizedPayload:args.p_payload,before,after,scopeVersion:context.scopeVersion,timezone:this.timezone,previewFingerprint:'a'.repeat(64)},error:null}
      }
      if(name==='employee_command_v1') {
        const receipt={employeeId:args.p_employee_id,operationId:args.p_operation_id,version:args.p_expected_version+1,auditEventId:otherId}
        this.receipts.set(args.p_operation_id,receipt)
        if(args.p_action==='create_employee')this.records.push({...structuredClone(detail),id:args.p_employee_id,fields:args.p_payload})
        return {data:receipt,error:null}
      }
      if(name==='employee_operation_v1') return {data:this.receipts.has(args.p_operation_id)?{state:'completed',result:this.receipts.get(args.p_operation_id)}:{state:args.p_resolution==='abandon'?'abandoned':'absent',result:null},error:null}
      return {data:null,error:null}
    })
    return Object.assign(work,{abortSignal:()=>work,single:()=>work})
  },
}
export const syntheticSupabase={rpc:(name:string,args?:any)=>server.rpc(name,args),auth:{getSession:async()=>({data:{session:{user:{id:server.actor}}}}),onAuthStateChange:(callback:any)=>{server.profileCallback=callback;return {data:{subscription:{unsubscribe(){}}}}},signOut:()=>server.signOut()},from:vi.fn(()=>{throw new Error('No operational table writes allowed')})}
const clients:QueryClient[]=[], routers:ReturnType<typeof createMemoryRouter>[]=[]
export function setupScreen(){
 vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}})
 Object.assign(server,{actor:actorId,role:'executive',active:true,allowed:true,timezone:null,records:[structuredClone(detail)],candidates:[],audits:[],calls:[],overrides:{},receipts:new Map()})
 server.signOut.mockReset().mockResolvedValue({error:null});syntheticSupabase.from.mockClear();sessionStorage.clear();localStorage.clear()
}
export function mountScreen(node:ReactNode,path='/ihr/employees/new',entries?:string[]){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client)
 const router=createMemoryRouter([{path:'*',element:<QueryClientProvider client={client}>{node}</QueryClientProvider>}],{initialEntries:entries??[path]});routers.push(router)
 const view=render(<RouterProvider router={router}/>);return {...view,client,router}
}
export function cleanupScreen(){cleanup();routers.splice(0).forEach(router=>router.dispose());clients.splice(0).forEach(client=>client.clear());vi.unstubAllGlobals()}
export async function refreshProfile(){await act(async()=>server.profileCallback?.('TOKEN_REFRESHED',{user:{id:server.actor}}))}
export function calls(name:string){return server.calls.filter(call=>call.name===name)}
export function manyEmployees(count=27){return Array.from({length:count},(_,index)=>({...structuredClone(detail),id:`20000000-0000-0000-0000-${String(index+1).padStart(12,'0')}`,fields:{...fields,name:`Karyawan ${String(index+1).padStart(2,'0')}`}}))}
export { actorId, employeeId, otherId }
