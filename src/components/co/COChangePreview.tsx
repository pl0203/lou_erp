import { fetchCOOrdinaryImpacts, fetchCOImportImpacts, type COImportImpactBinding } from '../../lib/co/workspaceReads';
import { LoadingState } from '../ui/LoadingState'
import { Button } from '../ui/Button';
import { useEffect, useState } from 'react';
import type { COImpactKind, COImpactRows, COPreview, COReviewedOperation } from '../../lib/co/contracts';
import { completeCORead } from '../../lib/co/rpc';
import type { COReadOptions } from '../../lib/co/rpc';
import { isCOAuthorityError } from './COReportWorkspace';
import { invalid } from '../../lib/co/validation';
import { formatMoney } from '../../lib/reads/money';
import { formatDisplayDate } from '../../lib/displayDate';
import { COFailure, COPagination, useCOActor, useCORead } from './COShared';
/** Immutable snapshot: every child read uses this exact payload and fingerprint. */
export interface COReviewSnapshot {
    operation: COReviewedOperation | 'post_report';
    payload: Record<string, unknown>;
    header: COPreview;
}
const labels: Record<COImpactKind, string> = { report: 'Laporan', stock: 'Stok', revenue: 'Pendapatan', credit: 'Kredit PIC', reopen: 'CO dibuka ulang', issue: 'Penghalang', missing_month: 'Periode wajib' };
export async function readAllCOImpacts<K extends COImpactKind>(snapshot: COReviewSnapshot, kind: K, options?: COReadOptions): Promise<COImpactRows[K][]> {
    return await completeCORead(async (page) => { const result = await fetchCOOrdinaryImpacts(snapshot,kind,page,100,options); if (result.total !== snapshot.header.counts[kind])
        invalid('preview impact count'); return result; }, r => r.ref ?? (kind === 'stock' ? `${r.stock_key_id}:${r.batch_id}` : kind === 'credit' ? `${r.report_month}:${r.sales_person_id_at_creation}` : kind === 'issue' ? JSON.stringify(r) : r.report_month ?? r.co_id)) as COImpactRows[K][];
}
export type COImportReviewSnapshot = COImportImpactBinding & {header:COPreview;requiredReopenOrders?:{coId:string;expectedCoVersion:string}[]};
async function readAllImportReports(snapshot:COImportReviewSnapshot,options?:COReadOptions){
 const rows:COImpactRows['report'][]=[];const seen=new Set<string>();
 for(let page=1;;page++){
  const result=await fetchCOImportImpacts(snapshot,'report',page,100,options);
  if(result.total!==snapshot.header.counts.report)invalid('import impact count');
  for(const row of result.rows){if(seen.has(row.ref))invalid('duplicate import report');seen.add(row.ref);rows.push(row)}
  if(BigInt(rows.length)===BigInt(result.total))return rows;
  if(!result.rows.length||BigInt(rows.length)>BigInt(result.total))invalid('incomplete import impacts');
 }
}
async function readAllImportReopen(snapshot:COImportReviewSnapshot,options?:COReadOptions){
 const rows:COImpactRows['reopen'][]=[];const seen=new Set<string>();
 for(let page=1;;page++){
  const result=await fetchCOImportImpacts(snapshot,'reopen',page,100,options);
  if(result.total!==snapshot.header.counts.reopen||BigInt(result.total)>1000n)invalid('reopen impact count');
  for(const row of result.rows){if(seen.has(row.co_id))invalid('duplicate reopen identity');seen.add(row.co_id);rows.push(row)}
  if(BigInt(rows.length)===BigInt(result.total))break;
  if(!result.rows.length||BigInt(rows.length)>BigInt(result.total))invalid('incomplete reopen impacts');
 }
 if(snapshot.requiredReopenOrders&&(snapshot.requiredReopenOrders.length!==rows.length||rows.some(row=>!snapshot.requiredReopenOrders!.some(pin=>pin.coId===row.co_id&&pin.expectedCoVersion===row.expected_co_version))))invalid('reopen acknowledgment identity');
 return rows;
}
export default function COChangePreview({snapshot,importSnapshot,selectedMonth,onAuthorityFailure,onReadyChange,onStalePreview}:({snapshot:COReviewSnapshot;importSnapshot?:never}|{snapshot?:never;importSnapshot:COImportReviewSnapshot})&{selectedMonth?:string;onAuthorityFailure?:(error:unknown)=>void;onReadyChange?:(ready:boolean)=>void;onStalePreview?:(fingerprint:string,error:unknown)=>void}){
 const header=snapshot?.header??importSnapshot!.header;
 const fingerprint=importSnapshot?.previewFingerprint??header.preview_fingerprint;
 const actor=useCOActor(`preview:${fingerprint}`),[kind,setKind]=useState<COImpactKind>('issue'),[page,setPage]=useState(1);
 async function guarded<T>(fn:()=>Promise<T>){
  try{return await fn()}catch(error){
   if(actor.isCurrent()){
    if(isCOAuthorityError(error)){
     // Revoke the owning source before a child callback can cancel/unmount this
     // preview. Otherwise useCORead's later protection sees a departed actor and
     // correctly ignores the failure, leaving the still-mounted root authorized.
     actor.rejectAuthority(error);
     onAuthorityFailure?.(error);
    }else if(!importSnapshot||(error as {code?:string})?.code==='PT409')onStalePreview?.(fingerprint,error);
   }
   throw error;
  }
 }
 const args={snapshot,importSnapshot,kind,page};
 const read=useCORead(actor,'preview-impact',args,o=>guarded(async()=>{
  const result=importSnapshot?await fetchCOImportImpacts(importSnapshot,kind,page,20,o):await fetchCOOrdinaryImpacts(snapshot!,kind,page,20,o);
  if(result.total!==header.counts[kind])invalid('preview impact count');return result;
 }));
 const selected=useCORead(actor,'preview-selected-report',{snapshot,importSnapshot,selectedMonth},o=>guarded(async()=>((importSnapshot?await readAllImportReports(importSnapshot,o):await readAllCOImpacts(snapshot!,'report',o))).find(r=>r.month===selectedMonth)??null),!!selectedMonth);
 const needsReopen=!!importSnapshot&&header.counts.reopen!=='0';
 const reopen=useCORead(actor,'preview-reopen-identities',{importSnapshot},o=>guarded(()=>readAllImportReopen(importSnapshot!,o)),needsReopen);
 const ready=(!needsReopen||!!reopen.data&&!reopen.isFetching&&!reopen.isError)&&!!read.data&&!read.isFetching&&!read.isError&&(!selectedMonth||!!selected.data&&!selected.isFetching&&!selected.isError);
 useEffect(()=>{onReadyChange?.(ready);return ()=>onReadyChange?.(false)},[ready,onReadyChange]);
 const valueLabel=importSnapshot?'Nilai alokasi CO':'Pendapatan';
 return <section aria-label="Peninjauan dampak" className="rounded-lg border border-blue-200 p-4 space-y-3 text-base"><h3 className="font-semibold">Peninjauan seluruh dampak</h3>
 <p>Perubahan seluruh periode diterapkan bersama. Nilai alokasi memakai Harga CO, bukan total laporan sumber. Jumlah antar-SKU atau satuan berbeda tidak dijumlahkan.</p>
 {!header.after.complete&&<p role="alert">Provisional: laporan belum lengkap. Kosong bukan nol.</p>}
 {selectedMonth&&(selected.isError?<COFailure error={selected.error} retry={()=>void selected.refetch()}/>:selected.isPending?<LoadingState title="Memeriksa periode dipilih di semua halaman dampak…" shape="compact"/>:selected.data?<><p>{valueLabel} periode dipilih: Rp {formatMoney(selected.data.after_revenue,'full')}{!selected.data.complete?' (provisional)':''}</p><p>Cakupan periode dipilih: {formatDisplayDate(selected.data.coverage)} (tanggal UTC server){selected.data.is_partial_month?' · bulan parsial':''}</p></>:<p>Total periode dipilih belum tersedia pada hasil ini.</p>)}
 {needsReopen&&<section role="region" aria-label="Pesanan yang perlu dibuka kembali"><h4>Pesanan yang perlu dibuka kembali</h4>{reopen.isError?<COFailure error={reopen.error} retry={()=>void reopen.refetch()}/>:!reopen.data?<LoadingState title="Memeriksa identitas pesanan terdampak…" shape="compact"/>:<ul>{reopen.data.map(row=><li key={row.co_id}>{(row as typeof row & {labels?:{coNumber:string|null}}).labels?.coNumber??'Identitas CO tidak tersedia'} · versi yang disetujui {row.expected_co_version}</li>)}</ul>}</section>}
 <p className="text-sm">Identitas yang tidak tersedia pada pembacaan terikat ini tidak ditebak; periksa sumber sebelum menyetujui perubahan.</p><div className="flex flex-wrap gap-2">{(Object.keys(labels) as COImpactKind[]).map(k=><Button type="button" variant="quiet" size="compact" className={k===kind?'bg-brand-tint border-brand-primary':undefined} aria-pressed={k===kind} key={k} onClick={()=>{setKind(k);setPage(1)}}>{labels[k]} ({header.counts[k]})</Button>)}</div>
 {read.isError?<COFailure error={read.error} retry={()=>void read.refetch()}/>:!read.data?<LoadingState title="Memuat dampak…" shape="compact"/>:<><ul className="space-y-2">{read.data.rows.map((r,i)=><li key={i} className="break-words border-b border-brand-divider pb-2">{impactText(kind,r)}</li>)}</ul>{read.data.total==='0'&&<p>Tidak ada {labels[kind].toLowerCase()}.</p>}<COPagination page={page} total={read.data.total} pending={read.isFetching} onPage={setPage}/></>}
 <details className="text-sm"><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Detail teknis peninjauan</summary><div className="mt-2 space-y-2"><p>Seluruh riwayat pelanggan sebelum: Rp {formatMoney(header.before.revenue,'full')}</p><p>Seluruh riwayat pelanggan sesudah: Rp {formatMoney(header.after.revenue,'full')}</p><pre className="whitespace-pre-wrap break-all">{read.data ? read.data.rows.map(r=>Object.entries(r).filter(([key])=>['stock_key_id','batch_id','co_id','sales_person_id_at_creation'].includes(key)).map(([key,value])=>`${key}: ${value ?? 'null'}`).join(' · ')).filter(Boolean).join('\n') : 'Detail dampak belum tersedia'}</pre><p className="text-[13px] break-all">Sidik peninjauan: {fingerprint}</p></div></details>{!header.can_post&&<p role="alert">Belum dapat diterapkan. Selesaikan semua penghalang dan tinjau ulang.</p>}</section>;
}

function impactText(kind: COImpactKind, r: Record<string, any>) { const label=r.labels; const sku=label?.sku&&label?.productName?`${label.sku} · ${label.productName}`:'Identitas SKU tidak tersedia'; const co=label?.coNumber?`CO ${label.coNumber}`:'Identitas CO tidak tersedia'; const sj=label?.sjNumber?`SJ ${label.sjNumber}`:'Identitas SJ tidak tersedia'; switch (kind) {
    case 'report': return `${r.month}${r.report_reference ? ` · ${r.report_reference}` : ''} · cakupan ${r.coverage} · Nilai alokasi CO Rp ${formatMoney(r.before_revenue, 'full')} → Rp ${formatMoney(r.after_revenue, 'full')}${r.complete ? '' : ' · belum lengkap'}`;
    case 'stock': return `SKU ${sku} · ${co} · ${sj} · ${r.before_quantity} → ${r.after_quantity}`;
    case 'revenue':
    case 'credit': return `${r.report_month}${kind === 'credit' ? ` · PIC asli ${r.sales_person_id_at_creation === null ? 'Unassigned' : label?.picName ?? 'Nama PIC tidak tersedia'}` : ''} · Rp ${formatMoney(r.before_amount, 'full')} → Rp ${formatMoney(r.after_amount, 'full')}`;
    case 'reopen': return `${co} · versi ${r.expected_co_version ?? 'tidak tersedia'} · memerlukan pembukaan kembali · laporan wajib ${r.missing_month_count??'tidak tersedia'}`;
    case 'issue': return `${r.code}${r.report_month ? ` · ${r.report_month}` : ''}${r.stock_key_id ? ` · ${sku}` : ''}${r.co_id ? ` · ${co}` : ''}`;
    case 'missing_month': return `${r.report_month} · ${r.reason} · cakupan ${r.coverage_through_date ?? 'belum ada'}`;
} }
