import {validateReturnPayload,type ReturnItem,type ReturnPayload} from './returnWorkspace';
export type ReturnEntry={item:ReturnItem;quantity:string};
export type ReturnForm={customerId:string;customerVersion:string;generationId:string;date:string;reason:string;reference:string;notes:string;entries:ReturnEntry[]};
/** Compare exact base-unit quantities; never infer or convert a unit. */
export function buildReturnPayload(form:ReturnForm):ReturnPayload {
 if(form.date>new Date().toISOString().slice(0,10))throw new Error('Tanggal retur melewati batas pencatatan ledger (UTC). Gunakan tanggal sebenarnya dan catat setelah batas ledger berganti.');
 const items=form.entries.map(({item,quantity})=>{
  if(!/^[1-9]\d*$/.test(quantity)||BigInt(quantity)>2147483647n||BigInt(quantity)>BigInt(item.available_quantity))throw new Error(`Qty retur ${item.display_sku} harus 1 sampai ${item.available_quantity}.`);
  if(!item.unit||!item.unit_id||!item.unit_version)throw new Error(`Satuan ${item.display_sku} belum terverifikasi.`);
  return {stock_key_id:item.stock_key_id,quantity:Number(quantity),unit:item.unit,unit_id:item.unit_id,unit_version:item.unit_version};
 });
 return validateReturnPayload({customer_id:form.customerId,expected_customer_version:form.customerVersion,expected_generation_id:form.generationId,return_date:form.date,reason:form.reason.trim(),reference:form.reference.trim()||null,notes:form.notes.trim()||null,items});
}
export function verifyReturnReadback(result:import('./returnWorkspace').ReturnCreateResult,payload:ReturnPayload,saved:{header:Record<string,unknown>;lines:Record<string,unknown>[]}):void {
 const h=saved.header;
 if(h.head_id!==result.head_id||h.revision_id!==result.revision_id||h.customer_id!==payload.customer_id||h.return_date!==payload.return_date||h.reference!==payload.reference||h.reason!==payload.reason||h.notes!==payload.notes||h.is_void===true)throw new Error('Hasil retur tidak sesuai permintaan. Periksa hasil sebelum mencoba lagi.');
 const actual=new Map<string,bigint>();
 for(const row of saved.lines){if(typeof row.stock_key_id!=='string'||typeof row.quantity!=='string'||!/^[1-9]\d*$/.test(row.quantity))throw new Error('Baris retur tidak valid.');actual.set(row.stock_key_id,(actual.get(row.stock_key_id)??0n)+BigInt(row.quantity));}
 if(actual.size!==payload.items.length||payload.items.some(i=>actual.get(i.stock_key_id)!==BigInt(i.quantity)))throw new Error('Jumlah hasil retur tidak sesuai permintaan.');
}

export function returnDateDefaults(now=new Date()){
 const cutoff=now.toISOString().slice(0,10);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const wibToday=['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');
 return {date:wibToday<=cutoff?wibToday:'',cutoff,wibToday};
}
