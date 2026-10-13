import { createTransactionSender } from '../orderTransactions'
import { parseUUID } from './contracts'
import type { LeaveResult, Recovery, UUID } from './contracts'
import type { BalanceCommand } from './accountContracts'
import { accountObject, invalidAccount, parseBalanceReceipt, toBalancePayload } from './accountRpc'
/** Filters serialization only; the canonical sender owns UUIDs, hash, reconciliation and tombstones. */
function metadataStorage(resolve:()=>Storage):Storage{
 const minimal=(raw:string)=>{
  const v=accountObject(JSON.parse(raw));if(typeof v.key!=='string'||!/^[0-9a-f]{64}$/.test(v.key)||typeof v.uncertain!=='boolean')invalidAccount()
  return JSON.stringify({id:parseUUID(v.id),key:v.key,uncertain:v.uncertain,...(v.committed===undefined?{}:{committed:parseBalanceReceipt(v.committed)})})
 }
 return {get length(){return resolve().length},clear(){resolve().clear()},key(i){return resolve().key(i)},removeItem(key){resolve().removeItem(key)},getItem(key){const raw=resolve().getItem(key);return raw===null?null:minimal(raw)},setItem(key,value){resolve().setItem(key,minimal(value))}}
}
/** authorize must refresh active actor/scope through runLeaveInteraction before every call. */
export function createLeaveBalanceTransport(options:{actorId:UUID;backendScope:string;formScope:string;storage:()=>Storage;authorize:()=>Promise<void>}){
 parseUUID(options.actorId);if(!options.backendScope||!options.formScope)invalidAccount()
 const sender=createTransactionSender({rpcName:'leave_transaction_v1',recoveryRpcName:'leave_reconcile_request_v1',storage:()=>metadataStorage(options.storage),storageKey:`ihr-balance:${encodeURIComponent(options.backendScope)}:${options.actorId}:${encodeURIComponent(options.formScope)}`,
  validateResult:(value,expected)=>{const receipt=parseBalanceReceipt(value);return expected===undefined||receipt.operation===expected}})
 return {
  async send(command:BalanceCommand):Promise<LeaveResult>{try{const payload=toBalancePayload(command);await options.authorize();const receipt=parseBalanceReceipt(await sender(command.operation,payload));if(receipt.operation!==command.operation)invalidAccount();return receipt}catch{throw new Error('Saldo belum dapat disimpan. Periksa akses dan isian; pulihkan hasil bila status belum pasti.')}},
  hasUnresolved:sender.hasUnresolved,acknowledgeRecovered:sender.acknowledgeRecovered,
  async reconcile():Promise<Recovery>{try{await options.authorize();const result=await sender.reconcile();if(result.state==='committed')return {state:'committed',result:parseBalanceReceipt(result.result)};if(result.state==='abandoned')return {state:'abandoned'};return invalidAccount()}catch{throw new Error('Hasil perubahan saldo belum pasti. Jangan membuat pengiriman baru.')}}
 }
}
