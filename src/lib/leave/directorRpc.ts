import { supabase } from '../supabase'
import { leaveErrorMessage } from './rpc'
import { parseDirectorRequests } from './directorContracts'
export async function fetchDirectorRequests(before:number|null,signal:AbortSignal){
 signal.throwIfAborted()
 if(before!==null&&(!Number.isSafeInteger(before)||before<1))throw new Error('Halaman tidak valid.')
 const {data,error}=await supabase.rpc('leave_director_requests_v1',{p_before:before,p_limit:25}).abortSignal(signal)
 signal.throwIfAborted();if(error)throw new Error(leaveErrorMessage(error))
 return parseDirectorRequests(data,before,25)
}
