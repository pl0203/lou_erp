import COSourceProposalResume from '../../../components/co/COSourceProposalResume';
import { coSourceProposalRequest } from '../../../lib/co/workspaceReads';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { hasScopedCORecovery, hasOrdinaryCOReportCorrectionRecovery } from '../../../lib/co/import/recoveryScope';
import { parseMonth, parseUUID } from '../../../lib/co/validation';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import { completeCORead, fetchCOReport, fetchCOReportHistory, fetchCOReportImport, fetchCOReportRows } from '../../../lib/co/rpc';
import { formatCOReportMonth } from '../../../lib/co/presentation';
import { formatAuditTimestamp } from '../../../lib/displayDate';
import { COFailure, COFreshness, COPagination, useCOActor, useCORead } from '../../../components/co/COShared';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import COReportUpload from '../../../components/co/COReportUpload';
import COLegacyReportEdit from '../../../components/co/COLegacyReportEdit';
import COReportCorrectionRecovery from '../../../components/co/COReportCorrectionRecovery';
import CORecordedReportTable from '../../../components/co/CORecordedReportTable';
import COReportRevisionEvidence from '../../../components/co/COReportRevisionEvidence';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ActionLink } from '../../../components/ui/ActionLink';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Section } from '../../../components/ui/Section';
import type { COReportHeader } from '../../../lib/co/validation';
import type { ImportEditSeed } from '../../../components/co/useCOImportReview';
import { Notice } from '../../../components/ui/Feedback';
export default function COMonthlyReport(){
 const {customerId,month}=useParams();const [search]=useSearchParams();const revision=search.get('revision');const actor=useCOActor(`report-route:${customerId}:${month}`);
 try{parseUUID(customerId);parseMonth(month);if(revision)parseUUID(revision)}catch{return <COFailure error={new Error('Pelanggan atau bulan laporan tidak valid.')}/>}
 if(!actor.enabled)return null;
 let request;try{request=coSourceProposalRequest(search,customerId!)}catch(error){return <COFailure error={error}/>;}
 return <COSourceBoundary source={`monthly:${customerId}:${month}`} check={o=>fetchCOReport(customerId!,month!,null,o)}>{request?<COSourceProposalResume key={JSON.stringify(request)} request={request} owner={{kind:'report',month:month!}}/>:<ActivatedMonthlyRoute key={actor.scope} customerId={customerId!} month={month!} revision={revision} legacy={search.get('recovery')==='legacy'} returnTo={safeReportReturnTo(search.get('returnTo'),customerId!)}/>}</COSourceBoundary>;
}
/** Child reads start only after the enclosing authority owner has activated.
 * Root StrictMode cleanup/setup must not turn its transient cleanup into a
 * permanent failed canonical query. No currentness or unmount guard is relaxed. */
function ActivatedMonthlyRoute(props:Parameters<typeof MonthlyRoute>[0]){
 const [active,setActive]=useState(false);
 useEffect(()=>{setActive(true)},[]);
 return active?<MonthlyRoute {...props}/>:<LoadingState title="Memuat laporan…" shape="list"/>;
}
function MonthlyRoute({customerId,month,revision,legacy,returnTo}:{customerId:string;month:string;revision:string|null;legacy:boolean;returnTo:string}){
 const actor=useCOActor(`monthly-entry:${customerId}:${month}`);const report=useCORead(actor,'report',{customerId,month},o=>fetchCOReport(customerId,month,null,o));
 const customers=useCORead(actor,'customers',{},fetchCOCustomers);
 const [editing,setEditing]=useState(false),[epoch,setEpoch]=useState(0),[history,setHistory]=useState(false),[recovering,setRecovering]=useState(false),[hasOwnedIntent,setOwnedIntent]=useState(false);
 const onRecorded=useCallback(()=>{setEditing(false);setRecovering(false);void report.refetch()},[report.refetch]);
 if(report.isError&&!report.data)return <COFailure error={report.error} retry={()=>void report.refetch()}/>;
 if(!report.data)return <LoadingState title="Memuat laporan…" shape="list"/>;
 const effective=report.data.effective;
 const name=effective?.customer_name??report.data.draft?.customer_name??customers.data?.find(c=>c.id===customerId)?.name;
 if(!name)return customers.isError?<COFailure error={customers.error} retry={()=>void customers.refetch()}/>:customers.data?<COFailure error={new Error('Nama toko belum tersedia pada katalog yang diizinkan.')}/>:<LoadingState title="Memuat identitas toko…" shape="compact"/>;
 const version=report.data.customer_version;
 let retainedRequest=false,ordinaryCorrectionRecovery=false;
 try{retainedRequest=hasScopedCORecovery(localStorage,actor.identity.actorId,customerId,`report:${month}`);ordinaryCorrectionRecovery=hasOrdinaryCOReportCorrectionRecovery(localStorage,actor.identity.actorId,customerId,`report:${month}`)}catch{retainedRequest=true;/* Unreadable recovery state is not a certain refusal. */}
 const selectedRevision=revision??effective?.revision_id;
 const sourceBound=!!report.data.draft?.source_context_link;
 const savedDraft=report.data.draft;
 const hasSavedInput=!!savedDraft&&!savedDraft.consumed&&(BigInt(savedDraft.entered_count)>0n||!!savedDraft.notes?.trim()||!!savedDraft.report_reference?.trim());
 const readBlocked=report.isFetching||report.isError||sourceBound;
 const canonicalContext=JSON.stringify([version,report.data.generation_id,...[report.data.draft,effective].map(h=>h?[h.draft_id,h.draft_version,h.revision_id,h.report_version,h.row_count,h.eligible_set_fingerprint,h.source_context_fingerprint,h.source_context_link,h.context_issue,h.consumed]:null)]);
 return <div className="mx-auto max-w-7xl min-w-0 space-y-5"><ActionLink variant="quiet" to={returnTo}>← Laporan bulanan</ActionLink><PageHeader title={`${name} · ${formatCOReportMonth(month)}`} description="Laporan penjualan bulanan mencakup semua CO toko, tanpa memilih sumber CO."/><COFreshness value={report.data.reporting_freshness}/>
 {report.isError&&<COFailure error={report.error} retry={()=>void report.refetch()}/>}
 {!revision&&!legacy&&!sourceBound&&hasSavedInput&&<ActionLink variant="secondary" size="compact" to={`/athel/co/reports/${customerId}/${month}?recovery=legacy&returnTo=${encodeURIComponent(returnTo)}`}>Periksa isian tersimpan</ActionLink>}
 {legacy&&report.data.draft&&<LegacyPendingWork customerId={customerId} month={month} customerVersion={version} draft={report.data.draft}/>}
 {sourceBound&&<Notice tone="warning" title="Laporan terikat ke perubahan sumber"><p>Kembali ke sumber usulan asli dan tinjau semua periode bersama. Tautan konteks bukan seluruh usulan; pencatatan utama tetap diblokir.</p><COSourceProposalResume linkOnly request={{p_customer_id:customerId,p_month:month,p_draft_id:report.data.draft.draft_id,p_expected_draft_version:report.data.draft.draft_version,p_expected_customer_version:version}}/><ActionLink variant="quiet" to="/athel/co">Kembali ke Pesanan CO</ActionLink><ActionLink variant="quiet" to={`/athel/co/stock?customer=${customerId}`}>Kembali ke Stok Pelanggan</ActionLink></Notice>}
 {legacy&&!sourceBound&&!editing&&!recovering&&<Button disabled={readBlocked} onClick={()=>{setEpoch(v=>v+1);setEditing(true)}}>Tinjau isian tersimpan</Button>}
 {legacy&&<Notice tone="warning" title="Isian tersimpan perlu diperiksa">Isian belum tercatat tetap disimpan; ini bukan laporan baru atau penjualan nol. Pilih sumber dan periksa kembali seluruh barang terhadap data terkini sebelum mencatat. Tidak ada pencatatan otomatis.</Notice>}
 {!revision&&effective&&retainedRequest&&!recovering&&<Notice tone="warning" title="Ada hasil perintah yang perlu diperiksa"><p>Laporan tercatat tidak menggantikan hasil permintaan asli. Periksa identitas hasil sebelum memulai Edit baru.</p><Button onClick={()=>setRecovering(true)}>Periksa hasil pencatatan</Button></Notice>}
 {revision?<COReportRevisionEvidence customerId={customerId} month={month} customerVersion={version} revisionId={revision} isEffective={revision===effective?.revision_id}/>:effective&&<>
 {editing&&<h2 className="text-lg font-semibold">Laporan tercatat saat ini</h2>}<CORecordedReportTable key={`${selectedRevision}:${version}`} customerId={customerId} month={month} customerVersion={version} revisionId={effective.revision_id} coverage={{revisionId:effective.revision_id,through:effective.coverage_through_date,partial:effective.is_partial_month}}/>
 {!sourceBound&&!editing&&!recovering&&!retainedRequest&&<div className="flex flex-wrap gap-3"><Button disabled={readBlocked} onClick={()=>{setEpoch(v=>v+1);setEditing(true)}}>Edit</Button><ActionLink variant="quiet" to={`/athel/co/stock?customer=${customerId}`}>Lihat stok toko</ActionLink></div>}
 </>}
 {!revision&&(!sourceBound||hasOwnedIntent||recovering)&&(!effective&&!legacy||editing||recovering)&&!(recovering&&ordinaryCorrectionRecovery)&&<SeededUpload key={`${actor.scope}:${epoch}`} customerId={customerId} month={month} revisionId={recovering?null:effective?.revision_id??null} customerVersion={version} scope={{actorId:actor.identity.actorId,customerId,reportMonth:month,epoch}} customerName={name} canonicalContext={canonicalContext} edit={!!effective} recoveryOnly={recovering&&sourceBound} readBlocked={report.isFetching||report.isError||sourceBound&&!recovering} onDirtyChange={setOwnedIntent} onRecorded={onRecorded} onExit={()=>{setEditing(false);setRecovering(false)}}/>}
 {!revision&&recovering&&ordinaryCorrectionRecovery&&<COReportCorrectionRecovery customerId={customerId} month={month} onRecorded={onRecorded} onExit={()=>setRecovering(false)}/>}
 {effective&&<details onToggle={e=>setHistory(e.currentTarget.open)}><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left font-medium">Riwayat perubahan</summary>{history&&<ReportHistory customerId={customerId} month={month}/>}</details>}
 </div>;
}
function SeededUpload({customerId,month,revisionId,customerVersion,...props}:{customerId:string;month:string;revisionId:string|null;customerVersion:string}&Omit<Parameters<typeof COReportUpload>[0],'initialSeed'>){
 const actor=useCOActor(`edit-seed:${customerId}:${month}:${revisionId}`);
 const [legacyEdit,setLegacyEdit]=useState(false);
 const [initialSeed,setInitialSeed]=useState<ImportEditSeed|null|undefined>(revisionId?undefined:null),[failure,setFailure]=useState<unknown>(null);
 const source=useCORead(actor,'report-import',{customerId,month,revisionId},o=>fetchCOReportImport(customerId,month,revisionId!,o),!!revisionId&&initialSeed===undefined&&!failure);
 const quantities=useCORead(actor,'edit-effective-quantities',{customerId,month,revisionId,customerVersion},o=>completeCORead(page=>fetchCOReportRows({p_customer_id:customerId,p_month:month,p_view:'revision',p_revision_id:revisionId!,p_expected_draft_version:null,p_expected_customer_version:customerVersion,p_page:page,p_page_size:100},o)),!!source.data?.manifest&&initialSeed===undefined&&!failure);
 useEffect(()=>{
  if(initialSeed!==undefined||!source.data)return;
  if(!source.data.manifest){setLegacyEdit(true);return}
  if(!quantities.data)return;
  try{
   const input=structuredClone(source.data.manifest.input),expected=new Map<string,bigint>();
   for(const m of input.mappings)if(m.included&&m.stockKeyId&&m.quantity!==null)expected.set(m.stockKeyId,(expected.get(m.stockKeyId)??0n)+BigInt(m.quantity));
   for(const key of input.omittedZeroStockKeyIds)if(!expected.has(key))expected.set(key,0n);
   if(quantities.data.some(r=>r.sold_quantity===null))throw new Error('Keputusan sumber tidak sama dengan jumlah laporan tercatat; gunakan sumber baru.');
   const rows=new Map(quantities.data.map(r=>[r.stock_key_id as string,BigInt(r.sold_quantity)]));
   if([...expected].some(([key,q])=>rows.get(key)!==q)||[...rows].some(([key,q])=>!expected.has(key)&&q!==0n))throw new Error('Keputusan sumber tidak sama dengan jumlah laporan tercatat; gunakan sumber baru.');
   input.omittedZeroStockKeyIds=[...new Set([...input.omittedZeroStockKeyIds,...[...rows].filter(([key,q])=>q===0n&&!expected.has(key)).map(([key])=>key)])];
   setInitialSeed({revisionId:source.data.revision_id,manifestDigest:source.data.manifest.digest,sourceSha256:input.extracted.sha256,input});
  }catch(error){setFailure(error)}
 },[source.data,quantities.data,initialSeed]);
 if(legacyEdit&&revisionId)return <COLegacyReportEdit customerId={customerId} month={month} revisionId={revisionId} customerVersion={customerVersion} onRecorded={props.onRecorded} onExit={props.onExit!}/>;
 if(initialSeed===undefined){const error=failure||source.error||quantities.error;return error?<div><COFailure error={error} retry={()=>{setFailure(null);void source.refetch();void quantities.refetch()}}/>{failure&&<Button onClick={()=>setInitialSeed(null)}>Gunakan sumber baru untuk Edit</Button>}</div>:<LoadingState title="Memuat nilai awal Edit…" shape="compact"/>}
 return <COReportUpload {...props} initialSeed={initialSeed??undefined}/>;
}
function LegacyPendingWork({customerId,month,customerVersion,draft}:{customerId:string;month:string;customerVersion:string;draft:COReportHeader}){
 const actor=useCOActor(`legacy-work:${customerId}:${month}:${draft.draft_version}`),[page,setPage]=useState(1);
 const args={p_customer_id:customerId,p_month:month,p_view:'draft' as const,p_expected_draft_version:draft.draft_version,p_expected_customer_version:customerVersion,p_page:page,p_page_size:100};
 const read=useCORead(actor,'legacy-pending-rows',args,o=>fetchCOReportRows(args,o));
 return <Section title="Pekerjaan laporan tersimpan" aria-label="Pekerjaan laporan tersimpan"><p>Catatan: {draft.notes??'Tidak tersedia'}</p><p>Referensi: {draft.report_reference??'Tidak tersedia'}</p><p>Isian tersimpan hanya dibaca, bukan pencatatan efektif dan bukan nol otomatis.</p>{read.isError?<COFailure error={read.error} retry={()=>void read.refetch()}/>:!read.data?<LoadingState title="Memuat isian tersimpan…" shape="compact"/>:<><table className="w-full text-left text-sm"><thead><tr><th>SKU / Barang</th><th>Jumlah tersimpan</th></tr></thead><tbody>{read.data.rows.map((r:{stock_key_id:string;display_sku:string;product_name:string;sold_quantity:string|null})=><tr key={r.stock_key_id}><th scope="row">{r.display_sku} · {r.product_name}</th><td>{r.sold_quantity??'Belum diisi'}</td></tr>)}</tbody></table><COPagination page={page} pageSize={100} total={read.data.total} pending={read.isFetching} onPage={setPage}/></>}</Section>;
}
function ReportHistory({customerId,month}:{customerId:string;month:string}){
 const actor=useCOActor(`report-history:${customerId}:${month}`),[page,setPage]=useState(1);const args={p_customer_id:customerId,p_month:month,p_page:page,p_page_size:20};const read=useCORead(actor,'report-history',args,o=>fetchCOReportHistory(args,o));
 return read.isError?<COFailure error={read.error} retry={()=>void read.refetch()}/>:!read.data?<LoadingState title="Memuat riwayat perubahan…" shape="compact"/>:<div className="space-y-3 py-3"><ul>{read.data.rows.map(r=><li key={r.revision_id} className="py-3 border-b"><p>{r.author_name??r.created_by} · {formatAuditTimestamp(r.created_at,'WIB')}</p><p>{r.reason??'Pencatatan pertama'}{r.is_effective?' · Tercatat saat ini':''}</p><p className="text-sm">Versi riwayat {r.report_version}</p><ActionLink variant="quiet" size="compact" to={`/athel/co/reports/${customerId}/${month}?revision=${r.revision_id}`}>Buka bukti dan perubahan baris</ActionLink></li>)}</ul><COPagination page={page} total={read.data.total} pending={read.isFetching} onPage={setPage}/></div>;
}

/** Only the report-list path and known filter keys can be carried across the detail route. */
export function safeReportReturnTo(value:string|null,customerId:string):string {
 const fallback=`/athel/co/reports?customer=${encodeURIComponent(customerId)}`;
 if(!value?.startsWith('/athel/co/reports?'))return fallback;
 const url=new URL(value,'https://local.invalid');
 if(url.origin!=='https://local.invalid'||url.pathname!=='/athel/co/reports'||url.hash)return fallback;
 if([...url.searchParams.keys()].some(k=>!['customer','month','status','page'].includes(k)))return fallback;
 return url.pathname+url.search;
}
