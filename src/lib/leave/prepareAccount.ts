import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import type { LeaveContext } from './contracts'
import { parseUUID } from './contracts'
import { accountInteger, accountObject, invalidAccount } from './accountRpc'
import { fetchLeaveContext, leaveErrorMessage } from './rpc'
import { leaveKeys, synchronizeLeaveScope } from './queryKeys'
/** Explicit user action only. fetchQuery coalesces observers; neither context nor render prepares. */
export function prepareCurrentLeaveAccount(client:QueryClient,identity:string,context:LeaveContext):Promise<LeaveContext>{
 parseUUID(identity)
 const period=context.currentPeriod
 if(!period||!context.capabilities.request||!['employee','manager'].includes(context.memberKind??''))return Promise.reject(new Error('Periode tahunan yang memenuhi syarat belum dikonfirmasi.'))
 return client.fetchQuery({queryKey:leaveKeys.private(identity,context.scopeVersion,'prepare-account',period.year),retry:false,staleTime:0,gcTime:0,
  queryFn:async({signal})=>{
   const {data,error}=await supabase.rpc('leave_prepare_self_v1').abortSignal(signal);signal.throwIfAborted()
   if(error)throw new Error(leaveErrorMessage(error))
   const receipt=accountObject(data),accountId=parseUUID(receipt.accountId),year=accountInteger(receipt.year,1,9998),version=accountInteger(receipt.version,1)
   if(year!==period.year)invalidAccount()
   const fresh=await fetchLeaveContext(signal);signal.throwIfAborted()
   synchronizeLeaveScope(client,identity,fresh.scopeVersion);signal.throwIfAborted()
   if(fresh.scopeVersion!==context.scopeVersion||!fresh.capabilities.request||fresh.memberKind==='director'||fresh.currentPeriod?.year!==year||!fresh.balances.some(b=>b.accountId===accountId&&b.year===year&&b.version>=version))invalidAccount()
   client.setQueryData(leaveKeys.context(identity,'current'),fresh)
   return fresh
  },
 })
}
