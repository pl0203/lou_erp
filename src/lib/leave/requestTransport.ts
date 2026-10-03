import type { QueryClient } from '@tanstack/react-query'
import { createTransactionSender } from '../orderTransactions'
import { parseUUID } from './contracts'
import type { LeaveResult,UUID } from './contracts'
import type { LeaveQuoteInput } from './quoteContracts'
import type { RequestReceipt } from './requestContracts'
import { invalidRequest,parseRequestReceipt,requestObject,toSubmitPayload } from './requestRpc'
import { LEAVE_BACKEND,leaveKeys } from './queryKeys'
/** Serialization filter only. The established sender owns UUID/hash, reconciliation and tombstones. */
function recoveryStorage(resolve:()=>Storage,parseReceipt:(value:unknown)=>LeaveResult):Storage{
 const minimal=(raw:string)=>{
  const v=requestObject(JSON.parse(raw));if(typeof v.key!=='string'||!/^[0-9a-f]{64}$/.test(v.key)||typeof v.uncertain!=='boolean')invalidRequest()
  return JSON.stringify({id:parseUUID(v.id),key:v.key,uncertain:v.uncertain,...(v.committed===undefined?{}:{committed:parseReceipt(v.committed)})})
 }
 return {get length(){return resolve().length},clear(){resolve().clear()},key(i){return resolve().key(i)},removeItem(key){resolve().removeItem(key)},getItem(key){const raw=resolve().getItem(key);return raw===null?null:minimal(raw)},setItem(key,value){resolve().setItem(key,minimal(value))}}
}
function storageKey(options:{backendScope:string;actorId:UUID;formScope:string}){return `ihr-request:${encodeURIComponent(options.backendScope)}:${options.actorId}:${encodeURIComponent(options.formScope)}`}
export type LeaveCommandTransportOptions<T extends LeaveResult>={
 actorId:UUID;backendScope:string;formScope:string;storage:()=>Storage;authorize:()=>Promise<void>
 /** Return a validated minimal {id,version,operation}; private fields are never serialized. */
 parseReceipt:(value:unknown)=>T
}
/** Reusable serialization/authorization adapter. The established sender alone owns command identity and reconciliation. */
export function createLeaveCommandTransport<T extends LeaveResult>(options:LeaveCommandTransportOptions<T>){
 parseUUID(options.actorId);if(!options.backendScope||!options.formScope)invalidRequest()
 const parseReceipt=(value:unknown):T=>{
  const receipt=options.parseReceipt(value)
  if(!Number.isSafeInteger(receipt.version)||receipt.version<1||typeof receipt.operation!=='string'||!receipt.operation)invalidRequest()
  return {id:parseUUID(receipt.id),version:receipt.version,operation:receipt.operation} as T
 }
 const sender=createTransactionSender({rpcName:'leave_transaction_v1',recoveryRpcName:'leave_reconcile_request_v1',storage:()=>recoveryStorage(options.storage,parseReceipt),storageKey:storageKey(options),
  validateResult:(value,expected)=>{const receipt=parseReceipt(value);return expected===undefined||receipt.operation===expected}})
 return {
  async send(operation:string,payload:unknown):Promise<T>{
   try{await options.authorize();return parseReceipt(await sender(operation,payload))}
   catch{throw new Error('Pengajuan belum dapat dipastikan. Periksa akses dan isian; pulihkan hasil sebelum mencoba pengajuan lain.')}
  },
  hasUnresolved:sender.hasUnresolved,acknowledgeRecovered:sender.acknowledgeRecovered,
  async reconcile():Promise<{state:'committed';result:T}|{state:'abandoned'}>{
   try{await options.authorize();const result=await sender.reconcile();if(result.state==='committed')return {state:'committed',result:parseReceipt(result.result)};if(result.state==='abandoned')return {state:'abandoned'};return invalidRequest()}
   catch{throw new Error('Hasil pengajuan belum pasti. Jangan membuat pengajuan baru. Coba pulihkan hasil kembali.')}
  },
 }
}
export function createLeaveRequestTransport(options:Omit<LeaveCommandTransportOptions<RequestReceipt>,'parseReceipt'>){
 const transport=createLeaveCommandTransport({...options,parseReceipt:(value:unknown)=>{
  const receipt=parseRequestReceipt(value),raw=options.storage().getItem(storageKey(options))
  // Submit's subject is its command UUID. Transitions intentionally use their own receipt parser.
  if(raw!==null&&parseUUID(requestObject(JSON.parse(raw)).id)!==receipt.id)invalidRequest()
  return receipt
 }})
 return {...transport,async send(input:LeaveQuoteInput,fingerprint:string):Promise<RequestReceipt>{
  try{return await transport.send('submit_request',toSubmitPayload(input,fingerprint))}
  catch{throw new Error('Pengajuan belum dapat dipastikan. Periksa akses dan isian; pulihkan hasil sebelum mencoba pengajuan lain.')}
 }}
}
/** Submission affects own balance/history, approver inbox/counts and authorized team views. */
export async function invalidateRequestCaches(client:QueryClient){
 await client.invalidateQueries({queryKey:leaveKeys.all,predicate:query=>query.queryKey[1]===LEAVE_BACKEND})
}
