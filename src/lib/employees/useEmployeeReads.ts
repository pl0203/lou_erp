import {useCallback,useSyncExternalStore} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import type {EmployeeStatus} from './contracts'
import {normalizeEmployeeError,fetchEmployeePage,fetchEmployeeDetail,fetchEmployeeAudit,fetchEmployeeAccountCandidates} from './rpc'
import {employeeKeys} from './queryKeys'
import {completeEmployeeRead,getEmployeeAuthority,useEmployeeContext} from './useEmployeeContext'
type ReadReceipt={snapshot:{attempt:number;ready:boolean};completed:WeakMap<object,number>;listeners:Set<()=>void>}
// Query objects are owned by their QueryClient; weak keys disappear with cache eviction.
const receipts=new WeakMap<object,ReadReceipt>()
function receiptFor(client:QueryClient,key:readonly unknown[]):ReadReceipt {
 const query=client.getQueryCache().find({queryKey:key,exact:true})!
 let receipt=receipts.get(query)
 if(!receipt){receipt={snapshot:{attempt:0,ready:false},completed:new WeakMap(),listeners:new Set()};receipts.set(query,receipt)}
 return receipt
}
function publish(receipt:ReadReceipt,attempt:number,ready:boolean){receipt.snapshot={attempt,ready};receipt.listeners.forEach(listener=>listener())}
function useProtectedRead<T extends object>(parts:readonly unknown[],read:(signal:AbortSignal)=>Promise<T>) {
 const authority=useEmployeeContext(),client=useQueryClient(),actor=authority.actorId??'signed-out',scope=authority.scopeVersion??'unconfirmed',attempt=authority.authorityRevision
 const queryKey=employeeKeys.private(actor,scope,attempt,...parts)
 const query=useQuery({queryKey,enabled:authority.authorityReady,
  queryFn:async({signal})=>{
   const receipt=receiptFor(client,queryKey),readAttempt=receipt.snapshot.attempt+1
   publish(receipt,readAttempt,false)
   const interrupt=()=>{if(receipt.snapshot.attempt===readAttempt)publish(receipt,readAttempt+1,false)}
   signal.addEventListener('abort',interrupt,{once:true})
   try{
    const value=await completeEmployeeRead(client,actor,scope,attempt,signal,()=>read(signal))
    if(signal.aborted||receipt.snapshot.attempt!==readAttempt)throw new Error('Cancelled employee read')
    receipt.completed.set(value,readAttempt);publish(receipt,readAttempt,true);return value
   }catch(error){interrupt();throw error}finally{signal.removeEventListener('abort',interrupt)}
  },retry:false,networkMode:'always',structuralSharing:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false})
 const receipt=receiptFor(client,queryKey)
 const subscribe=useCallback((listener:()=>void)=>{receipt.listeners.add(listener);return()=>{receipt.listeners.delete(listener)}},[receipt])
 const readSnapshot=useSyncExternalStore(subscribe,()=>receipt.snapshot,()=>receipt.snapshot)
 const now=getEmployeeAuthority(client)
 const ready=authority.authorityReady&&now.ready&&now.attempt===attempt&&now.scopeVersion===scope&&query.isSuccess&&!query.isFetching&&readSnapshot.ready&&!!query.data&&receipt.completed.get(query.data)===readSnapshot.attempt
 // Do not return raw UseQueryResult: its data may be a reverted cached response.
 return {data:ready?query.data:undefined,error:query.error?normalizeEmployeeError(query.error):null,isPending:query.isPending||query.isFetching,authorityReady:authority.authorityReady,authorityDenied:authority.authorityDenied,refresh:authority.refresh,draftGeneration:authority.draftGeneration}
}
export function useEmployeePage(filters:{query:string;status:EmployeeStatus|null;page:number;pageSize?:number}) {
 const {query,status,page,pageSize=25}=filters
 return useProtectedRead(['page',query,status,page,pageSize],signal=>fetchEmployeePage(query,status,page,pageSize,signal))
}
export function useEmployeeDetail(id:string) {return useProtectedRead(['detail',id],signal=>fetchEmployeeDetail(id,signal))}
export function useEmployeeAudit(id:string,page:number) {return useProtectedRead(['audit',id,page],signal=>fetchEmployeeAudit(id,page,25,signal))}
export function useEmployeeAccountCandidates(query:string,page:number) {return useProtectedRead(['candidates',query,page],signal=>fetchEmployeeAccountCandidates(query,page,25,signal))}
