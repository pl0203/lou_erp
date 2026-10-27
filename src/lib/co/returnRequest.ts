import {assertNoLegacyReturn} from './returnLegacyRecovery';
import { ReturnRejectedError,decodeReturnCreate,validateReturnPayload,type ReturnPayload,type ReturnCreateResult } from './returnWorkspace';
import { parseUUID } from './validation';
type Stored={requestId:string;payload:ReturnPayload;result?:ReturnCreateResult};
type Options={actorId:string;role:string;backend:string;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;current:()=>boolean;authorize:()=>Promise<void>;send:(id:string,payload:ReturnPayload)=>Promise<ReturnCreateResult>;recover:(id:string)=>Promise<ReturnCreateResult|null>;canonical:(result:ReturnCreateResult,payload:ReturnPayload)=>Promise<void>;uuid?:()=>string};
/** Durable actor-scoped request. No not-found response abandons a possibly in-flight transaction. */
export function createReturnRequest(o:Options){
 parseUUID(o.actorId);if(!['executive','co_admin'].includes(o.role))throw new Error('Akses retur tidak tersedia.');
 const key=`co-stock-return:${encodeURIComponent(o.backend)}:${o.actorId}:${o.role}`;let busy=false;
 const current=()=>{if(!o.current())throw new Error('Sesi berubah. Buka kembali halaman retur.');};
 function pending():Stored|null{current();const raw=o.storage.getItem(key);if(raw===null)return null;const v=JSON.parse(raw);if(!v||typeof v!=='object'||Object.keys(v).some(k=>!['requestId','payload','result'].includes(k)))throw new Error('Data pemulihan retur tidak valid.');const requestId=parseUUID(v.requestId),payload=validateReturnPayload(v.payload);return {requestId,payload,...(v.result?{result:decodeReturnCreate(v.result,requestId,payload.customer_id)}:{})};}
 function save(v:Stored|null){current();if(v)o.storage.setItem(key,JSON.stringify(v));else o.storage.removeItem(key);}
 async function guarded<T>(fn:()=>Promise<T>){current();if(busy)throw new Error('Retur sedang diproses.');busy=true;try{await o.authorize();current();return await fn();}finally{busy=false;}}
 async function accept(v:Stored,result:ReturnCreateResult){current();const valid=decodeReturnCreate(result,v.requestId,v.payload.customer_id);save({...v,result:valid});await o.canonical(valid,v.payload);current();if(pending()?.requestId===v.requestId)save(null);return valid;}
 async function send(v:Stored,fresh=false){assertNoLegacyReturn(o.storage,o.actorId,v.payload.customer_id,o.backend);save(v);let result:ReturnCreateResult;try{result=await o.send(v.requestId,v.payload);}catch(error){current();if(fresh&&error instanceof ReturnRejectedError&&pending()?.requestId===v.requestId)save(null);throw error;}current();return accept(v,result);}
 return {pending,submit:(input:ReturnPayload)=>guarded(async()=>{const payload=validateReturnPayload(input),old=pending();if(old&&JSON.stringify(old.payload)!==JSON.stringify(payload))throw new Error('Periksa hasil retur sebelumnya sebelum mengubah isian.');const v=old??{requestId:parseUUID((o.uuid??(()=>crypto.randomUUID()))()),payload};return v.result?accept(v,v.result):send(v,!old);}),retry:()=>guarded(async()=>{const v=pending();if(!v)throw new Error('Tidak ada permintaan retur tersimpan.');return v.result?accept(v,v.result):send(v);}),reconcile:()=>guarded(async()=>{const v=pending();if(!v)return null;const result=v.result??await o.recover(v.requestId);current();return result?accept(v,result):null;})};
}
