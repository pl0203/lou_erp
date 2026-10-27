import { decodeImportBinding } from './manifest';
import { CO_BACKEND } from '../queryKeys';
import { invalid, parseBoolean, parseHash, parseUUID, parseMonth, parseVersion, operations, record } from '../validation';
/** Only exact monthly form siblings. Stored metadata is a blocking signal, never authority. */
export function scopedCORecoveryKeys(actorId:string,customerId:string,formScope:string):string[] {
    if (!/^report:\d{4}-\d{2}-01$/.test(formScope))
        return [];
    const suffix = `${encodeURIComponent(CO_BACKEND)}:${parseUUID(actorId)}:${parseUUID(customerId)}:`;
    const siblings = [`co-request:${suffix}${encodeURIComponent(formScope)}`, `co-evidence-request:${suffix}${encodeURIComponent(formScope)}`, ...['prepare', 'commit', 'review', 'unit'].map(f => `co-import-request:${suffix}${encodeURIComponent(`${formScope}:${f}`)}`)];
    return siblings;
}
/** Classification only; never grants command authority or deletes retained identities. */
export function classifyCORecovery(raw:string|null,key:string,actorId:string,customerId:string,formScope:string):'absent'|'certain_refusal'|'unknown'|'committed'|'malformed' {
 if(raw===null)return 'absent';
 try {
  const keys=scopedCORecoveryKeys(actorId,customerId,formScope),index=keys.indexOf(key);
  if(index<0)invalid('recovery scope');
  const v=record(JSON.parse(raw));parseUUID(v.id);parseHash(v.key);parseBoolean(v.uncertain);
  if(Object.keys(v).some(k=>!['id','key','uncertain','binding','committed'].includes(k)))invalid('recovery identity');
  const b=record(v.binding);
  if(index<2){
   if(Object.keys(b).some(k=>!['operation','customer_id','co_id','draft_id','target_id'].includes(k))||b.customer_id!==customerId||!(index===0?operations:['register_evidence','finalize_evidence']).includes(b.operation))invalid('recovery binding');
   for(const k of ['customer_id','co_id','draft_id','target_id'])if(b[k]!==undefined)parseUUID(b[k]);
  }else{
   const family=['prepare','commit','review','unit'][index-2];
   if(Object.keys(b).some(k=>!['family','customerId','month','operation','draftId','stockKeyId','digest','customerVersion','draftVersion','binding','action','targetId'].includes(k))||b.family!==family||b.customerId!==customerId||b.month!==formScope.slice(7))invalid('recovery binding');
   parseUUID(b.customerId);parseMonth(b.month);
   for(const k of ['draftId','stockKeyId','targetId'])if(b[k]!==undefined)parseUUID(b[k]);
   for(const k of ['customerVersion','draftVersion'])if(b[k]!==undefined)parseVersion(b[k]);
   if(b.digest!==undefined)parseHash(b.digest);if(b.binding!==undefined)decodeImportBinding(b.binding);
   const allowed=family==='commit'?['post_report','correct_report']:[{prepare:'prepare_import',review:'review_import',unit:'declare_stock_key_unit'}[family]!];
   if(!allowed.includes(b.operation)||family==='prepare'&&(!b.draftId||!b.digest||!b.customerVersion||!b.draftVersion)||family==='commit'&&!b.binding||family==='unit'&&(!b.stockKeyId||!b.customerVersion)||family==='review'&&(!b.draftId||!b.draftVersion||!b.customerVersion||!['open','abandon'].includes(b.action)))invalid('recovery binding');
  }
  // Any retained receipt requires its domain's original-result reconciliation.
  if(Object.hasOwn(v,'committed'))return 'committed';
  return v.uncertain?'unknown':'certain_refusal';
 }catch{return 'malformed'}
}
export function hasScopedCORecovery(storage:Storage,actorId:string,customerId:string,formScope:string,exceptKey?:string):boolean {
 try{return scopedCORecoveryKeys(actorId,customerId,formScope).some(key=>key!==exceptKey&&!['absent','certain_refusal'].includes(classifyCORecovery(storage.getItem(key),key,actorId,customerId,formScope)))}catch{return true}
}
export function assertNoOtherCORequest(storage:Storage,actorId:string,customerId:string,formScope:string,ownKey:string){
 if(hasScopedCORecovery(storage,actorId,customerId,formScope,ownKey))throw new Error('Periksa hasil pencatatan');
}
/** Routing hint only. The selected owner must reconcile and canonically validate the original receipt. */
export function hasOrdinaryCOReportCorrectionRecovery(storage:Storage,actorId:string,customerId:string,formScope:string):boolean {
 try {
  const key=scopedCORecoveryKeys(actorId,customerId,formScope)[0];
  if(!key)return false;
  const raw=storage.getItem(key),state=classifyCORecovery(raw,key,actorId,customerId,formScope);
  return (state==='unknown'||state==='committed')&&record(record(JSON.parse(raw!)).binding).operation==='correct_report';
 }catch{return false}
}
