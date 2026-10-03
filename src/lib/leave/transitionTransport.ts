import type { LeaveCommandTransportOptions } from './requestTransport'
import { createLeaveCommandTransport } from './requestTransport'
import { parseTransitionReceipt,toTransitionPayload } from './transitionRpc'
import type { TransitionCommand,TransitionReceipt } from './transitionContracts'
/** Reuses canonical UUID, payload hash, freshness/reconciliation and minimal-storage behavior. */
export function createLeaveTransitionTransport(options:Omit<LeaveCommandTransportOptions<TransitionReceipt>,'parseReceipt'>){
 let active:TransitionCommand|null=null
 const transport=createLeaveCommandTransport({...options,parseReceipt:(value:unknown)=>{
  const receipt=parseTransitionReceipt(value)
  if(active&&(receipt.id!==active.requestId||receipt.version!==active.expectedVersion+1))throw new Error('Hasil keputusan belum sesuai. Pulihkan hasil sebelum melanjutkan.')
  return receipt
 }})
 return {...transport,async send(command:TransitionCommand):Promise<TransitionReceipt>{
  const payload=toTransitionPayload(command)
  if(active)throw new Error('Keputusan masih diproses.')
  active=command
  try{return await transport.send(command.operation,payload)}finally{active=null}
 }}
}
