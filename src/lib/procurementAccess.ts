import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useAuth } from './AuthContext'
import { supabase } from './supabase'

export const procurementCapabilities = ['customer_create','customer_edit','customer_delete','product_create','product_edit','product_delete'] as const
export type ProcurementCapability = typeof procurementCapabilities[number]
export type ProcurementCapabilities = Record<ProcurementCapability, boolean>
export type ProcurementAccess = ProcurementCapabilities & { version: 1; as_of: string; actor_id: string; role: 'po_admin' | 'co_admin' | 'executive' }
const denied: ProcurementCapabilities = Object.freeze({ customer_create:false, customer_edit:false, customer_delete:false, product_create:false, product_edit:false, product_delete:false })
const unavailable = () => new Error('Akses perubahan belum dapat dikonfirmasi. Muat ulang sebelum melanjutkan.')
export function decodeProcurementAccess(value: unknown): ProcurementAccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable()
  const row = value as Record<string, unknown>, keys = ['version','as_of','actor_id','role',...procurementCapabilities]
  if (Object.keys(row).length !== keys.length || keys.some(key => !(key in row)) || row.version !== 1 || typeof row.as_of !== 'string' || !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(row.as_of) || !Number.isFinite(Date.parse(row.as_of)) || typeof row.actor_id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(row.actor_id) || !['po_admin','co_admin','executive'].includes(String(row.role)) || procurementCapabilities.some(key => typeof row[key] !== 'boolean') || row.customer_delete !== false || row.role === 'co_admin' && procurementCapabilities.some(key => row[key])) throw unavailable()
  return row as ProcurementAccess
}
export async function fetchProcurementAccess(signal?: AbortSignal): Promise<ProcurementAccess> {
  signal?.throwIfAborted()
  let request = supabase.rpc('pilot_procurement_access_v1')
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  signal?.throwIfAborted()
  if (error) throw unavailable()
  return decodeProcurementAccess(data)
}
// An aborted query can revert to a previously successful cache entry. A fresh
// completion receipt, outside that revertible state, is required for mutation.
type Authority = { epoch: number; accepted?: ProcurementAccess; listeners: Set<() => void> }
const authorities = new WeakMap<QueryClient, Map<string, Authority>>()
function authority(client: QueryClient, identity: string) {
  let entries = authorities.get(client); if (!entries) { entries = new Map(); authorities.set(client,entries) }
  let entry = entries.get(identity); if (!entry) { entry = { epoch:0,listeners:new Set() }; entries.set(identity,entry) }
  return entry
}
function changed(entry: Authority) { entry.listeners.forEach(fn=>fn()) }
export function useProcurementAccess() {
  const { user, profile, loading } = useAuth(), client = useQueryClient()
  const identity = !loading && user && profile?.is_active && profile.id === user.id ? `${user.id}:${profile.role}` : ''
  const entry = authority(client, identity)
  const subscribe = useCallback((fn:()=>void)=>{entry.listeners.add(fn);return()=>{entry.listeners.delete(fn)}},[entry])
  useSyncExternalStore(subscribe,()=>entry.accepted,()=>entry.accepted)
  const query = useQuery({ queryKey:['procurement-access',identity], enabled:!!identity,
    queryFn:async({signal})=>{
      const epoch=++entry.epoch; entry.accepted=undefined; changed(entry)
      const invalidate=()=>{if(entry.epoch===epoch){entry.accepted=undefined;changed(entry)}}
      signal.addEventListener('abort',invalidate,{once:true})
      try { const result=await fetchProcurementAccess(signal); signal.throwIfAborted()
        if (`${result.actor_id}:${result.role}`!==identity || entry.epoch!==epoch) throw unavailable()
        entry.accepted=result;changed(entry);return result
      } catch(error){invalidate();throw error} finally{signal.removeEventListener('abort',invalidate)}
    }, structuralSharing:false, staleTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:'always',refetchOnReconnect:'always',
  })
  const ready=!!identity&&query.isSuccess&&!query.isFetching&&query.fetchStatus==='idle'&&entry.accepted===query.data
  const capabilities=ready?query.data!:denied
  const current=useRef({ready,capabilities,entry});current.current={ready,capabilities,entry}
  const mounted=useRef(false)
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const requireCapability=useCallback((key:ProcurementCapability)=>{
    const value=current.current
    if(!mounted.current||!value.ready||!value.capabilities[key]||value.entry.accepted!==value.capabilities)throw unavailable()
  },[])
  return {...query,ready,capabilities,require:requireCapability}
}
