import {useLayoutEffect,useRef,useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {EmployeeError,normalizeEmployeeProposal,parseUUID} from './contracts'
import type {CommandResult,EmployeeCommand,EmployeePreview,EmployeeProposal,OperationResult} from './contracts'
import {executeEmployeeCommand,normalizeEmployeeError,previewEmployeeCommand,resolveEmployeeOperation} from './rpc'
import {clearEmployeeRecovery,EMPLOYEE_BACKEND,invalidateEmployeeReads,readEmployeeRecovery,writeEmployeeRecovery} from './queryKeys'
import type {RecoveryMarker} from './queryKeys'
import {getEmployeeAuthority,runEmployeeInteraction,suspendEmployeeAuthority,useEmployeeContext} from './useEmployeeContext'
export type EmployeeCommandPhase='idle'|'submitting'|'uncertain'|'recovering'|'completed'|'blocked'
type State={phase:EmployeeCommandPhase;error:EmployeeError|null;receipt:CommandResult|null;previewResult:EmployeePreview|null}
type BoundPreview={proposal:EmployeeProposal;preview:EmployeePreview;attempt:number}
const initial:State={phase:'idle',error:null,receipt:null,previewResult:null}
/** One mounted editor owns this command state. Only the minimal recovery marker persists. */
export function useEmployeeCommand(requestedEmployeeId?:string) {
 const authority=useEmployeeContext(),client=useQueryClient(),[state,setState]=useState<State>(initial),[revision,setRevision]=useState(0)
 const stateRef=useRef(state);stateRef.current=state
 const busy=useRef<string|null>(null),mounted=useRef(true),bound=useRef<BoundPreview|null>(null),pendingCommand=useRef<EmployeeCommand|null>(null),marker=useRef<RecoveryMarker|null>(null)
 const initialized=useRef(''),target=useRef<string|null>(null),storageReady=useRef(false)
 const key=`${authority.actorId??''}|${EMPLOYEE_BACKEND}|${authority.draftGeneration}|${requestedEmployeeId??'new'}`
 const currentKey=useRef(key);currentKey.current=key
 const publish=(patch:Partial<State>)=>{if(mounted.current){stateRef.current={...stateRef.current,...patch};setState(stateRef.current)}}
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;bound.current=null;pendingCommand.current=null}},[])
 useLayoutEffect(()=>{
  initialized.current=key;busy.current=null;bound.current=null;pendingCommand.current=null;marker.current=null;storageReady.current=false;target.current=null
  if(!authority.actorId){publish({...initial,phase:'blocked'});return}
  try {
   marker.current=readEmployeeRecovery(authority.actorId)
   // Discover a previous /new operation BEFORE allocating any replacement employee ID.
   target.current=marker.current?.employeeId??(requestedEmployeeId?parseUUID(requestedEmployeeId):crypto.randomUUID())
   storageReady.current=true;publish({...initial,phase:getEmployeeAuthority(client).denied?'blocked':marker.current?'uncertain':'idle'})
  }catch(error){publish({...initial,phase:'blocked',error:normalizeEmployeeError(error)})}
  setRevision(value=>value+1)
 },[key,authority.actorId,requestedEmployeeId])
 useLayoutEffect(()=>{
  if(busy.current!==key&&bound.current&&bound.current.attempt!==authority.authorityRevision){bound.current=null;publish({previewResult:null})}
 },[authority.authorityRevision])
 const sameEditor=(captured:string)=>mounted.current&&currentKey.current===captured&&initialized.current===captured
 const capture=()=>{
  if(initialized.current!==key||!authority.actorId||!storageReady.current)throw new EmployeeError('transport','RECOVERY_STORAGE_UNAVAILABLE')
  const now=getEmployeeAuthority(client)
  if(now.actorId!==authority.actorId||now.backend!==EMPLOYEE_BACKEND||now.denied)throw new EmployeeError('denied','AUTHORITY_CHANGED')
  if(!now.scopeVersion)throw new EmployeeError('transport','AUTHORITY_CHANGED')
  return {actor:authority.actorId,scope:now.scopeVersion,key}
 }
 const fail=(error:unknown,captured:string,dispatched=false)=>{
  if(!sameEditor(captured))return
  const safe=normalizeEmployeeError(error)
  if(safe.kind==='denied'&&safe.reason!=='AUTHORITY_CHANGED'){suspendEmployeeAuthority(client,true);publish({phase:'blocked',error:safe,previewResult:null});return}
  if(dispatched&&safe.kind==='transport'){publish({phase:'uncertain',error:safe,previewResult:null});return}
  publish({phase:marker.current?'uncertain':safe.kind==='denied'?'blocked':'idle',error:safe,previewResult:null})
 }
 const committed=(result:CommandResult,captured:string)=>{
  if(!sameEditor(captured))return
  if(!marker.current||result.operationId!==marker.current.operationId||result.employeeId!==marker.current.employeeId)throw new EmployeeError('transport','INVALID_RESPONSE')
  // A confirmed commit remains confirmed even if storage cleanup or later reads fail.
  let error:EmployeeError|null=null
  try{clearEmployeeRecovery(marker.current.actorId,marker.current.backend,marker.current.operationId);marker.current=null}catch(problem){error=normalizeEmployeeError(problem)}
  pendingCommand.current=null;bound.current=null;publish({phase:'completed',receipt:result,error,previewResult:null})
  void invalidateEmployeeReads(client).catch(()=>{})
 }
 const preview=async(proposal:EmployeeProposal):Promise<EmployeePreview|null>=>{
  if(busy.current===key||marker.current||stateRef.current.phase==='completed')return null
  busy.current=key;const captured=key
  try{
   const session=capture(),normalized=normalizeEmployeeProposal(proposal)
   if(normalized.employeeId!==target.current)throw new EmployeeError('invalid','TARGET_MISMATCH')
   const result=await runEmployeeInteraction(client,session.actor,session.scope,context=>previewEmployeeCommand(normalized,new AbortController().signal).then(result=>{
    if(result.scopeVersion!==context.scopeVersion)throw new EmployeeError('conflict','SCOPE_CHANGED');return result
   }))
   if(!sameEditor(captured))return null
   bound.current={proposal:normalized,preview:result,attempt:getEmployeeAuthority(client).attempt};publish({previewResult:result,error:null,phase:'idle'});return result
  }catch(error){fail(error,captured);return null}finally{if(busy.current===captured)busy.current=null}
 }
 const send=async(command:EmployeeCommand,captured:string,session:ReturnType<typeof capture>):Promise<CommandResult|null>=>{
  let dispatched=false,known:CommandResult|null=null
  try{
   const result=await runEmployeeInteraction(client,session.actor,session.scope,async()=>{
    if(!sameEditor(captured))throw new EmployeeError('denied','AUTHORITY_CHANGED')
    const next={actorId:session.actor,backend:EMPLOYEE_BACKEND,operationId:command.operationId,employeeId:command.employeeId}
    writeEmployeeRecovery(next);marker.current=next;pendingCommand.current=command
    dispatched=true;known=await executeEmployeeCommand(command);return known
   })
   committed(result,captured);return sameEditor(captured)?result:null
  }catch(error){
   if(!sameEditor(captured))return null
   // A focus/offline transition after a successful RPC is not an unknown commit.
   const now=getEmployeeAuthority(client)
   if(known&&sameEditor(captured)&&now.actorId===session.actor&&!now.denied){committed(known,captured);return known}
   if(dispatched&&normalizeEmployeeError(error).kind!=='transport'&&normalizeEmployeeError(error).reason!=='AUTHORITY_CHANGED'){
    try{clearEmployeeRecovery(session.actor,EMPLOYEE_BACKEND,command.operationId);marker.current=null;pendingCommand.current=null}catch(problem){fail(problem,captured,true);return null}
   }
   fail(error,captured,dispatched);return null
  }
 }
 const submit=async(proposal:EmployeeProposal):Promise<CommandResult|null>=>{
  if(busy.current===key||marker.current||stateRef.current.phase==='completed')return null
  busy.current=key;const captured=key
  try{
   const session=capture(),normalized=normalizeEmployeeProposal(proposal),approved=bound.current,now=getEmployeeAuthority(client)
   if(!approved||approved.attempt!==now.attempt||approved.preview.scopeVersion!==session.scope||JSON.stringify(approved.proposal)!==JSON.stringify(normalized))throw new EmployeeError('conflict','PREVIEW_REQUIRED')
   const command={...normalized,operationId:crypto.randomUUID(),previewFingerprint:approved.preview.previewFingerprint}
   bound.current=null;publish({phase:'submitting',error:null,previewResult:null})
   return await send(command,captured,session)
  }catch(error){fail(error,captured);return null}finally{if(busy.current===captured)busy.current=null}
 }
 const retryUnknown=async():Promise<CommandResult|null>=>{
  if(busy.current===key||!marker.current||!pendingCommand.current||stateRef.current.phase==='completed')return null
  busy.current=key;const captured=key
  try{const session=capture();publish({phase:'submitting',error:null});return await send(pendingCommand.current,captured,session)}
  catch(error){fail(error,captured);return null}finally{if(busy.current===captured)busy.current=null}
 }
 const recover=async(resolution:'read'|'abandon'):Promise<OperationResult|null>=>{
  if(busy.current===key||!marker.current||stateRef.current.phase==='completed')return null
  busy.current=key;const captured=key,currentMarker=marker.current
  let known:OperationResult|null=null
  try{
   const session=capture();publish({phase:'recovering',error:null})
   const result=await runEmployeeInteraction(client,session.actor,session.scope,async()=>{known=await resolveEmployeeOperation(currentMarker.operationId,resolution);return known})
   if(!sameEditor(captured))return null
   if(result.state==='completed')committed(result.result,captured)
   else if(result.state==='abandoned'){
    clearEmployeeRecovery(session.actor,EMPLOYEE_BACKEND,currentMarker.operationId);marker.current=null;pendingCommand.current=null;bound.current=null;publish({...initial})
   }else publish({phase:'uncertain',error:resolution==='abandon'?new EmployeeError('transport','ABANDON_UNCONFIRMED'):null})
   return result
  }catch(error){
   const now=getEmployeeAuthority(client)
   if(known?.state==='completed'&&sameEditor(captured)&&now.actorId===currentMarker.actorId&&!now.denied){committed(known.result,captured);return known}
   fail(error,captured);return null
  }finally{if(busy.current===captured)busy.current=null}
 }
 // revision makes marker-only initialization observable without persisting any proposal.
 void revision
 const active=initialized.current===key&&!!authority.actorId
 return {...state,phase:active?state.phase:'blocked' as EmployeeCommandPhase,receipt:active?state.receipt:null,previewResult:active?state.previewResult:null,
  employeeId:active?target.current:null,recoveryEmployeeId:active?marker.current?.employeeId??null:null,canRetryUnknown:active&&!!pendingCommand.current&&!!marker.current,
  authorityReady:authority.authorityReady,authorityDenied:authority.authorityDenied,draftGeneration:authority.draftGeneration,authorityRevision:authority.authorityRevision,refresh:authority.refresh,
  preview,submit,retryUnknown,checkOutcome:()=>recover('read'),abandonUnknown:()=>recover('abandon')}
}
