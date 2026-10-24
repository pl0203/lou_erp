import type { QueryClient } from '@tanstack/react-query'
import type { UUID } from './contracts'

export const LEAVE_BACKEND = import.meta.env.VITE_SUPABASE_URL ?? 'unconfigured'
/** 'current' is the discovery slot; private rows use a server-issued scope revision. */
export function createLeaveKeys(backend: string) {
  return {
    all: ['leave'] as const,
    identity: (identity: UUID) => ['leave', backend, identity] as const,
    context: (identity: UUID, scopeVersion: string) => ['leave', backend, identity, 'context', scopeVersion] as const,
    private: (identity: UUID, scopeVersion: string, ...parts: readonly unknown[]) => ['leave', backend, identity, 'private', scopeVersion, ...parts] as const,
  }
}
export const leaveKeys = createLeaveKeys(LEAVE_BACKEND)
type IdentityBoundary={identity:UUID|null|undefined;backend:string;generation:number;listeners:Set<()=>void>}
const boundaries=new WeakMap<QueryClient,IdentityBoundary>()
function boundary(client:QueryClient){
 let state=boundaries.get(client)
 if(!state){
  state={identity:undefined,backend:LEAVE_BACKEND,generation:0,listeners:new Set()};boundaries.set(client,state)
  const owned=state
  client.getQueryCache().subscribe(event=>{
   if(event.type==='removed'&&event.query.queryKey[0]==='leave'&&event.query.queryKey[3]==='context'&&event.query.queryKey[4]==='current'&&event.query.queryKey[1]===owned.backend&&(owned.identity===undefined||event.query.queryKey[2]===owned.identity)){
    owned.generation++;owned.listeners.forEach(listener=>listener())
   }
  })
 }
 return state
}
export function getLeaveIdentityGeneration(client:QueryClient){return boundary(client).generation}
export function isCurrentLeaveIdentity(client:QueryClient,identity:UUID,generation:number){
 const state=boundary(client)
 return state.generation===generation&&state.backend===LEAVE_BACKEND&&(state.identity===undefined||state.identity===identity)
}
/** Private context authorities subscribe once, never one listener per observer. */
export function subscribeLeaveIdentityBoundary(client:QueryClient,listener:()=>void){const state=boundary(client);state.listeners.add(listener);return()=>{state.listeners.delete(listener)}}
/** A second observer is not revocation. Only clean up different identities/backends on mount. */
export function synchronizeLeaveIdentity(client: QueryClient, identity: UUID | null, backend=LEAVE_BACKEND) {
  const state=boundary(client)
  if(state.identity!==identity||state.backend!==backend){state.identity=identity;state.backend=backend;state.generation++;state.listeners.forEach(listener=>listener())}
  const filters = { queryKey: leaveKeys.all, predicate: (query: { queryKey: readonly unknown[] }) => !identity || query.queryKey[1] !== backend || query.queryKey[2] !== identity }
  void client.cancelQueries(filters); client.removeQueries(filters)
}
/** Cancel before removal, so a transport ignoring abort cannot restore obsolete private rows. */
export function synchronizeLeaveScope(client: QueryClient, identity: UUID | null, scopeVersion?: string) {
  const filters = { queryKey: leaveKeys.all, predicate: (query: { queryKey: readonly unknown[] }) => {
    const key = query.queryKey
    if (!identity || key[1] !== LEAVE_BACKEND || key[2] !== identity) return true
    if (key[3] === 'context' && key[4] === 'current') return false
    return scopeVersion === undefined || key[4] !== scopeVersion
  } }
  void client.cancelQueries(filters); client.removeQueries(filters)
}
