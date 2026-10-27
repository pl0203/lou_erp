import { useState } from 'react';
import { fetchCOReportDelta } from '../../lib/co/workspaceReads';
import { isCOAuthorityError } from '../../lib/co/authority';
import { COFailure, COPagination, useCOActor, useCORead } from './COShared';
import { Section } from '../ui/Section';
import { LoadingState } from '../ui/LoadingState';
import CORecordedReportTable from './CORecordedReportTable';
/** Explicit immutable revision; never project current effective rows/source into original evidence. */
export default function COReportRevisionEvidence({customerId,month,customerVersion,revisionId,isEffective=false,onAuthorityFailure}:{customerId:string;month:string;customerVersion:string;revisionId:string;isEffective?:boolean;onAuthorityFailure?:(error:unknown)=>void}){
 const actor=useCOActor(`report-evidence:${customerId}:${month}:${customerVersion}:${revisionId}`),[page,setPage]=useState(1);const args={p_customer_id:customerId,p_month:month,p_revision_id:revisionId,p_page:page,p_page_size:100};
 const delta=useCORead(actor,'report-delta',args,async o=>{try{return await fetchCOReportDelta(args,o)}catch(error){if(actor.isCurrent()&&isCOAuthorityError(error))onAuthorityFailure?.(error);throw error}});
 return <Section title={`Bukti revisi ${isEffective?'efektif':'historis'} ${revisionId}`}><p>{isEffective?'Laporan ini masih efektif.':'Bukan laporan efektif saat ini.'} Sumber dan bukti asli tidak diganti oleh berkas versi terbaru.</p><CORecordedReportTable customerId={customerId} month={month} customerVersion={customerVersion} revisionId={revisionId} onAuthorityFailure={onAuthorityFailure}/><h3 className="font-semibold mt-4">Perubahan jumlah dibanding pencatatan sebelumnya</h3>{delta.isError?<COFailure error={delta.error} retry={()=>void delta.refetch()}/>:!delta.data?<LoadingState title="Memuat perubahan baris…" shape="compact"/>:<><ul>{delta.data.rows.map(r=><li key={r.stock_key_id}>{r.display_sku} · {r.product_name}: {r.before_quantity??'Tidak ada baris'} → {r.after_quantity??'Tidak ada baris'}</li>)}</ul>{delta.data.total==='0'&&<p>Tidak ada perubahan jumlah. Bukti harga dan alokasi tetap dapat berubah.</p>}<COPagination page={page} pageSize={100} total={delta.data.total} pending={delta.isFetching} onPage={setPage}/></>}</Section>;
}
