import { useMemo } from 'react'
import { useAuth } from './AuthContext'
import { createTransactionSender } from './orderTransactions'
export function createVisitPlanningSender(actorId:string,scope:string) {
 return createTransactionSender({rpcName:'pilot_schedule_transaction_v1',recoveryRpcName:'pilot_reconcile_schedule_v1',
  storage:()=>window.localStorage,storageKey:`pilot-schedule:${actorId}:${scope}`,
  validateResult:result=>{const value=result as unknown as {id:unknown;version:unknown};return typeof value.id==='string' && Number.isSafeInteger(value.version) && Number(value.version)>0},
 })
}
export function useVisitPlanningSender(scope:string){const {profile}=useAuth();return useMemo(()=>createVisitPlanningSender(profile?.id??'signed-out',scope),[profile?.id,scope])}
