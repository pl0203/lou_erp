import {useEffect,useRef,useSyncExternalStore} from 'react'
import {createSyntheticServer,ACTOR} from './server'
export const server=createSyntheticServer(localStorage)
const guards=new Set<(signal:AbortSignal)=>Promise<boolean>>()
let auth={user:{id:ACTOR},profile:{id:ACTOR,full_name:'Director Sintetis',role:'executive',is_active:true},loading:false}
const authListeners=new Set<()=>void>()
export function useBeforeSignOut(callback:(signal:AbortSignal)=>Promise<boolean>){const latest=useRef(callback);latest.current=callback;useEffect(()=>{const guard=(signal:AbortSignal)=>latest.current(signal);guards.add(guard);return()=>{guards.delete(guard)}},[])}
export function useAuth(){return {...useSyncExternalStore(fn=>{authListeners.add(fn);return()=>{authListeners.delete(fn)}},()=>auth),signOut:async()=>{const control=new AbortController();for(const guard of guards)if(!await guard(control.signal))return false;server.configure({allowed:false});return true}}}
export const supabase={rpc:server.rpc,from(){throw Error('Operational table access unavailable in synthetic browser')},auth:{getSession:async()=>({data:{session:{user:{id:ACTOR}}}})}}
export function Controls(){
 const state=useSyncExternalStore(server.subscribe,server.getState)
 function refresh(){window.dispatchEvent(new Event('focus'))}
 return <details className="qa-controls"><summary>Synthetic QA controls · no real accounts</summary><aside aria-label="Synthetic QA controls"><p>Mock RPC/auth boundary. This is not SQL authorization or real login proof.</p><label>Response mode <select id="qa-mode" value={state.mode} onChange={e=>{server.configure({mode:e.target.value});refresh()}}>{['normal','slow','lost-after','lost-before','held-after','malformed'].map(x=><option key={x}>{x}</option>)}</select></label><button onClick={()=>server.release()}>Release held reply</button><button onClick={()=>{server.configure({timezone:state.timezone?null:'UTC'});refresh()}}>Toggle synthetic UTC</button><button onClick={()=>{server.configure({allowed:!state.allowed});refresh()}}>Toggle server access</button><button onClick={refresh}>Refresh authority</button><output id="qa-ledger">{JSON.stringify({mode:state.mode,allowed:state.allowed,timezone:state.timezone,commits:state.commits,records:state.records.length,operations:Object.keys(state.operations).length,calls:state.calls.length})}</output></aside></details>
}
