import {CO_BACKEND} from './queryKeys';
import {parseUUID,parseHash,parseCOReceipt} from './validation';
export type LegacyReturnState='absent'|'refused'|'pending'|'malformed';
type Reader=Pick<Storage,'getItem'>;
type Scanner=Pick<Storage,'getItem'|'key'|'length'>;
const malformedMessage='Data pemulihan retur lama tidak dapat dibaca. Periksa permintaan retur lama sebelum membuat retur baru; jangan hapus data pemulihan.';
const pendingMessage='Masih ada permintaan retur lama yang perlu diperiksa. Selesaikan pemeriksaan hasil retur lama sebelum membuat retur baru.';
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(malformedMessage);return value as Record<string,unknown>;}
function exactKeys(value:Record<string,unknown>,required:string[],allowed=required){if(required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error(malformedMessage);}
function prefix(actorId:string,backend:string){parseUUID(actorId);if(typeof backend!=='string'||!backend)throw new Error(malformedMessage);return `co-request:${encodeURIComponent(backend)}:${actorId}:`;}
/** Inspection only: never grants authority, clears storage, reconciles, or abandons a request. */
export function legacyReturnState(storage:Reader,actorId:string,customerId:string,backend=CO_BACKEND):LegacyReturnState {
 try {
  const base=prefix(actorId,backend);parseUUID(customerId);
  const raw=storage.getItem(`${base}${customerId}:return`);if(raw===null)return 'absent';
  const value=object(JSON.parse(raw));exactKeys(value,['id','key','uncertain','binding'],['id','key','uncertain','binding','committed']);
  parseUUID(value.id);parseHash(value.key);if(typeof value.uncertain!=='boolean')throw new Error(malformedMessage);
  const binding=object(value.binding);exactKeys(binding,['operation','customer_id'],['operation','customer_id','co_id','draft_id','target_id']);
  if(typeof binding.operation!=='string'||!['save_return_draft','post_return','correct_return'].includes(binding.operation))throw new Error(malformedMessage);
  if(parseUUID(binding.customer_id)!==customerId)throw new Error(malformedMessage);
  for(const name of ['co_id','draft_id','target_id'])if(Object.hasOwn(binding,name))parseUUID(binding[name]);
  if(Object.hasOwn(value,'committed')){
   const receipt=parseCOReceipt(value.committed);
   const target=binding.target_id??(binding.operation==='save_return_draft'?binding.draft_id:undefined);
   if(receipt.customer_id!==customerId||receipt.operation!==binding.operation||target!==undefined&&receipt.id!==target)throw new Error(malformedMessage);
   return 'pending';
  }
  return value.uncertain?'pending':'refused';
 }catch{return 'malformed';}
}
export function assertNoLegacyReturn(storage:Reader,actorId:string,customerId:string,backend=CO_BACKEND):void {
 const state=legacyReturnState(storage,actorId,customerId,backend);
 if(state==='pending')throw new Error(pendingMessage);
 if(state==='malformed')throw new Error(malformedMessage);
}
/** Enumerate only exact actor/backend legacy return keys; never read foreign payloads. */
export function legacyReturnCustomers(storage:Scanner,actorId:string,backend=CO_BACKEND):{customerId:string;state:'pending'|'malformed'}[] {
 try {
  const base=prefix(actorId,backend),length=storage.length;
  if(!Number.isSafeInteger(length)||length<0)throw new Error(malformedMessage);
  const result:{customerId:string;state:'pending'|'malformed'}[]=[],seen=new Set<string>();
  for(let index=0;index<length;index++){
   const key=storage.key(index);if(typeof key!=='string')throw new Error(malformedMessage);
   if(!key.startsWith(base)||!key.endsWith(':return'))continue;
   const customerId=parseUUID(key.slice(base.length,-':return'.length));
   if(seen.has(customerId))throw new Error(malformedMessage);seen.add(customerId);
   const state=legacyReturnState(storage,actorId,customerId,backend);
   if(state==='pending'||state==='malformed')result.push({customerId,state});
  }
  if(storage.length!==length)throw new Error(malformedMessage);
  return result.sort((a,b)=>a.customerId.localeCompare(b.customerId));
 }catch{throw new Error(malformedMessage);}
}
