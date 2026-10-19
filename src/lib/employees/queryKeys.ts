import type { QueryClient } from '@tanstack/react-query'
import { EmployeeError, parseUUID, strictObject } from './contracts'
import type { UUID } from './contracts'
export const EMPLOYEE_BACKEND=import.meta.env.VITE_SUPABASE_URL??'unconfigured'
export function createEmployeeKeys(backend:string) {return {
 all:['employees'] as const,
 identity:(actor:UUID)=>['employees',backend,actor] as const,
 context:(actor:UUID)=>['employees',backend,actor,'context','current'] as const,
 private:(actor:UUID,scope:string,...parts:readonly unknown[])=>['employees',backend,actor,'private',scope,...parts] as const,
}}
export const employeeKeys=createEmployeeKeys(EMPLOYEE_BACKEND)
/** Cancellation comes first even when the underlying transport ignores its signal. */
export function removeEmployeeQueries(client:QueryClient,predicate:(key:readonly unknown[])=>boolean) {
 const filters={queryKey:employeeKeys.all,predicate:(query:{queryKey:readonly unknown[]})=>predicate(query.queryKey)}
 void client.cancelQueries(filters);client.removeQueries(filters)
}
export function invalidateEmployeeReads(client:QueryClient) {
 return client.invalidateQueries({queryKey:employeeKeys.all,predicate:query=>query.queryKey[3]==='private'})
}
export type RecoveryMarker={actorId:UUID;backend:string;operationId:UUID;employeeId:UUID}
export const recoveryStorageKey=(backend:string,actor:UUID)=>`employees:operation:${encodeURIComponent(backend)}:${actor}`
export function readEmployeeRecovery(actorId:UUID,backend=EMPLOYEE_BACKEND):RecoveryMarker|null {
 try {
  const raw=sessionStorage.getItem(recoveryStorageKey(backend,actorId));if(raw===null)return null
  const row=strictObject(JSON.parse(raw),['actorId','backend','operationId','employeeId'])
  const marker={actorId:parseUUID(row.actorId),backend:row.backend,operationId:parseUUID(row.operationId),employeeId:parseUUID(row.employeeId)}
  if(marker.actorId!==actorId||marker.backend!==backend)throw new Error()
  return marker as RecoveryMarker
 }catch{throw new EmployeeError('transport','RECOVERY_STORAGE_UNAVAILABLE')}
}
export function writeEmployeeRecovery(input:RecoveryMarker) {
 try {
  const row=strictObject(input,['actorId','backend','operationId','employeeId'])
  if(typeof row.backend!=='string'||!row.backend)throw new EmployeeError('invalid','INVALID_INPUT')
  const marker:RecoveryMarker={actorId:parseUUID(row.actorId),backend:row.backend,operationId:parseUUID(row.operationId),employeeId:parseUUID(row.employeeId)}
  const old=readEmployeeRecovery(marker.actorId,marker.backend)
  if(old&&(old.operationId!==marker.operationId||old.employeeId!==marker.employeeId))throw new EmployeeError('conflict','UNRESOLVED_OPERATION')
  sessionStorage.setItem(recoveryStorageKey(marker.backend,marker.actorId),JSON.stringify(marker))
  const saved=readEmployeeRecovery(marker.actorId,marker.backend)
  if(!saved||saved.operationId!==marker.operationId||saved.employeeId!==marker.employeeId)throw new Error()
 }catch(error){if(error instanceof EmployeeError)throw error;throw new EmployeeError('transport','RECOVERY_STORAGE_UNAVAILABLE')}
}
export function clearEmployeeRecovery(actorId:UUID,backend=EMPLOYEE_BACKEND,operationId?:UUID) {
 try {if(operationId&&readEmployeeRecovery(actorId,backend)?.operationId!==operationId)return;sessionStorage.removeItem(recoveryStorageKey(backend,actorId))}
 catch{throw new EmployeeError('transport','RECOVERY_STORAGE_UNAVAILABLE')}
}

/** On a fresh page there may be no in-memory previous actor. Never retain foreign markers. */
export function purgeForeignEmployeeRecovery(actorId:UUID|null,backend=EMPLOYEE_BACKEND) {
 try {
  const keep=actorId?recoveryStorageKey(backend,actorId):null
  const keys=Array.from({length:sessionStorage.length},(_,index)=>sessionStorage.key(index))
  for(const key of keys)if(key?.startsWith('employees:operation:')&&key!==keep)sessionStorage.removeItem(key)
 }catch{/* An unavailable storage area cannot supply an accepted recovery marker or allow dispatch. */}
}
