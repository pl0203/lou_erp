import { formatDisplayDate } from '../../lib/displayDate';
import { useState } from 'react';
import type { COAllocation, COReportRow } from '../../lib/co/validation';
import { invalid, minorUnits } from '../../lib/co/validation';
import { completeCORead, fetchCOReportAllocations, fetchCOReportImport, fetchCOReportRows } from '../../lib/co/rpc';
import type { COReportImport } from '../../lib/co/workspaceReads';
import { formatCOMinorUnits } from '../../lib/co/catalog';
import { formatMoney } from '../../lib/reads/money';
import { isCOAuthorityError } from '../../lib/co/authority';
import { COFailure, COPagination, useCOActor, useCORead } from './COShared';
import { LoadingState } from '../ui/LoadingState';
import { Section } from '../ui/Section';
import { CORevisionAttachment } from './COEvidenceAttachment';
import COAllocationDetails from './COAllocationDetails';
const unavailable = 'Tidak tersedia';
function amount(value:string|null|undefined){return value==null?unavailable:formatMoney(value,'full')}
/** Source evidence and FIFO accounting prices are intentionally separate columns. */
export function RecordedReportRows({rows,source,allocations}:{rows:readonly COReportRow[];source:COReportImport;allocations:readonly COAllocation[]}){
 const input=source.manifest?.input;
 return <div className="overflow-x-auto"><table className="w-full text-sm text-left border-collapse"><caption className="text-left py-3">Jumlah terjual tercatat, bukan stok fisik. Nilai laporan sumber bukan pendapatan atau utang.</caption><thead><tr>{['SKU / Nama','Satuan buku tercatat','Jumlah terjual','Harga satuan laporan','Total laporan','Harga CO','Nilai alokasi CO','Rekonsiliasi'].map(label=><th key={label} scope="col" className="p-3 border-b whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{rows.map(row=>{
 const mappings=input?.mappings.filter(m=>m.included&&m.stockKeyId===row.stock_key_id)??[];
 const sourceRows=input?.extracted.sourceRows.filter(r=>mappings.some(m=>m.rowId===r.id)&&input.includedSectionIds.includes(r.ref.section))??[];
 const prices=[...new Set(sourceRows.map(r=>r.unitPrice?.decimal??null))];
 const selected=allocations.filter(a=>a.stock_key_id===row.stock_key_id),coPrices=[...new Set(selected.map(a=>a.unit_price))];
 const sourceAmounts=sourceRows.map(r=>r.amount?.decimal??null);
 const sourceTotal=sourceRows.length&&sourceAmounts.every(v=>v!==null)?formatCOMinorUnits(sourceAmounts.reduce((sum,v)=>sum+minorUnits(v!),0n)):null;
 const allocationTotal=formatCOMinorUnits(selected.reduce((sum,a)=>sum+minorUnits(a.amount),0n));
 const allocated=selected.reduce((sum,a)=>sum+BigInt(a.quantity),0n);
 const returns=input?.returns.filter(r=>sourceRows.some(s=>s.id===r.rowId))??[];
 const unit=source.unit_declarations[row.stock_key_id];
 return <tr key={row.stock_key_id} data-co-report-row={row.stock_key_id}><th scope="row" className="p-3 border-b"><p>{row.display_sku}</p><p className="font-normal">{row.product_name}</p></th><td className="p-3 border-b">{unit?.unit??unavailable}{unit&&<details><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Dasar satuan</summary><p>Pernyataan buku yang terikat pada laporan: {unit.id} · {unit.version}</p></details>}</td><td className="p-3 border-b">{row.sold_quantity??unavailable}</td><td className="p-3 border-b">{prices.length>1?'Beragam':amount(prices[0])}{!!sourceRows.length&&<details><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Baris sumber ({sourceRows.length})</summary>{sourceRows.map(r=><div key={r.id} className="py-2"><p>{r.name} · Qty sumber {r.quantity.raw} {r.unit??''} · Retur sumber {r.returned?.raw??'—'}</p><p>Harga satuan laporan: {r.unitPrice?.raw??unavailable} · Total laporan: {r.amount?.raw??unavailable} {r.currency??''}</p><p>{r.ref.page?`Halaman ${r.ref.page}`:`Sheet ${r.ref.sheet}`} · baris {r.ref.row} · bagian {r.ref.section}</p>{mappings.find(m=>m.rowId===r.id)?.conversion&&<p>Konversi eksplisit: {mappings.find(m=>m.rowId===r.id)?.conversion?.reason}</p>}</div>)}</details>}</td><td className="p-3 border-b">{amount(sourceTotal)}{sourceTotal!==null&&` ${source.currency??''}`}</td><td className="p-3 border-b">{coPrices.length>1?'Beragam':coPrices.length?`Rp ${amount(coPrices[0])}`:unavailable}</td><td className="p-3 border-b">{allocated===BigInt(row.sold_quantity??'-1')?`Rp ${amount(allocationTotal)}`:unavailable}</td><td className="p-3 border-b">{allocated===BigInt(row.sold_quantity??'-1')?'Alokasi sesuai jumlah':'Alokasi perlu diperiksa'}{returns.map(r=><p key={r.rowId}>{r.state==='linked'?'Retur tertaut':r.state==='unresolved'?'Retur perlu rekonsiliasi':'Tanpa retur'}{r.note&&` · ${r.note}`}{source.return_proofs?.some(p=>p.rowId===r.rowId)&&<span> · Pilihan manusia belum dicocokkan; cakupan retur terdahulu dibuktikan server.</span>}</p>)}</td></tr>
 })}</tbody></table></div>;
}
export default function CORecordedReportTable({customerId,month,customerVersion,revisionId,onAuthorityFailure,showEvidence=true,coverage}:{customerId:string;month:string;customerVersion:string;revisionId:string;onAuthorityFailure?:(error:unknown)=>void;showEvidence?:boolean;coverage?:{revisionId:string;through:string;partial:boolean}}){
 const actor=useCOActor(`recorded-report:${customerId}:${month}:${customerVersion}:${revisionId}`),[page,setPage]=useState(1),[showAllocations,setShowAllocations]=useState(false);
 const reject=onAuthorityFailure??actor.rejectAuthority;
 async function guarded<T>(fn:()=>Promise<T>){try{return await fn()}catch(error){if(actor.isCurrent()&&isCOAuthorityError(error))reject(error);throw error}}
 const source=useCORead(actor,'report-import',{customerId,month,revisionId},o=>guarded(()=>fetchCOReportImport(customerId,month,revisionId,o)));
 const rows=useCORead(actor,'recorded-rows',{customerId,month,revisionId,customerVersion,page},o=>guarded(()=>fetchCOReportRows({p_customer_id:customerId,p_month:month,p_view:'revision',p_revision_id:revisionId,p_expected_customer_version:customerVersion,p_expected_draft_version:null,p_page:page,p_page_size:100},o)));
 const allocations=useCORead(actor,'recorded-allocation-summary',{customerId,month,revisionId,customerVersion},o=>guarded(async()=>{const all=await completeCORead(p=>fetchCOReportAllocations({p_customer_id:customerId,p_month:month,p_revision_id:revisionId,p_expected_customer_version:customerVersion,p_page:p,p_page_size:100},o));if(all.some(a=>a.report_revision_id!==revisionId))invalid('recorded allocation revision');return all as COAllocation[]}));
 const failed=source.error||rows.error||allocations.error;
 return <Section title="Laporan penjualan tercatat"><div className="space-y-3">{coverage?.revisionId===revisionId?<p>Cakupan tercatat sampai {formatDisplayDate(coverage.through)} (tanggal UTC server){coverage.partial?' · bulan parsial':''}</p>:<p>Cakupan revisi ini belum tersedia pada data yang diperiksa.</p>}{failed?<COFailure error={failed} retry={()=>{void source.refetch();void rows.refetch();void allocations.refetch()}}/>:!source.data||!rows.data||!allocations.data?<LoadingState title="Memuat laporan tercatat…" shape="list"/>:<><p>Sumber: {source.data.source_filename??unavailable}</p><p>Total laporan sumber: {amount(source.data.source_amount)} {source.data.currency??''}</p>{!source.data.manifest&&<p>Harga dan satuan laporan historis tidak tersedia. Harga CO tidak dipakai untuk mengisinya.</p>}<RecordedReportRows rows={rows.data.rows as COReportRow[]} source={source.data} allocations={allocations.data}/><COPagination page={page} pageSize={100} total={rows.data.total} pending={rows.isFetching} onPage={setPage}/></>}{showEvidence&&<CORevisionAttachment customerId={customerId} revisionId={revisionId} onAuthorityFailure={reject}/>}<details onToggle={e=>setShowAllocations(e.currentTarget.open)}><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Bukti alokasi FIFO dan PIC asli</summary>{showAllocations&&<COAllocationDetails hideAggregateQuantity customerId={customerId} month={month} customerVersion={customerVersion} revisionId={revisionId} onAuthorityFailure={reject}/>}</details></div></Section>;
}
