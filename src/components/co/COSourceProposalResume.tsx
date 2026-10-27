import { useEffect, useRef, useState } from 'react';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { useLocation, useNavigate } from 'react-router-dom';
import { CO_BACKEND } from '../../lib/co/queryKeys';
import { coSourceProposalURL, fetchCOReportSourceProposal } from '../../lib/co/workspaceReads';
import type { COSourceProposalArgs, COSourceProposalResume } from '../../lib/co/workspaceReads';
import type { ReactNode } from 'react';
import { isCOAuthorityError } from '../../lib/co/authority';
import type { COOrderRecord } from '../../lib/co/validation';
import { fetchCOCustomerStock } from '../../lib/co/rpc';
import { hasOrdinaryCOReportCorrectionRecovery, hasScopedCORecovery } from '../../lib/co/import/recoveryScope';
import { COFailure, useCOActor, useCORead } from './COShared';
import { ActionLink } from '../ui/ActionLink';
import { LoadingState } from '../ui/LoadingState';
import CODeliveryDialog from './CODeliveryDialog';
import COReturnDialog from './COReturnDialog';
import COCorrectionDialog from './COCorrectionDialog';
import COReportCorrectionRecovery from './COReportCorrectionRecovery';
import { useCOReportWorkspace, COReportCorrectionConsent } from './COReportWorkspace';

type Owner={kind:'delivery';co:COOrderRecord}|{kind:'return'}|{kind:'report';month:string};
type Props={request:COSourceProposalArgs;owner?:Owner;linkOnly?:boolean;parentBlocked?:boolean;parentFailure?:ReactNode};
/** Wait for the enclosing authority owner's StrictMode activation. */
export default function COSourceProposalResume(props:Props){
 const [active,setActive]=useState(false);
 useEffect(()=>{setActive(true)},[]);
 return active?<ResumeOwner {...props}/>:<LoadingState title="Memeriksa usulan sumber asli…" shape="compact"/>;
}
/** No sender here: retain one exact source owner for its whole dirty/result lifetime. */
function ResumeOwner({request,owner,linkOnly=false,parentBlocked=false,parentFailure}:Props){
 const actor=useCOActor(`source-proposal:${JSON.stringify(request)}`),location=useLocation(),navigate=useNavigate();
 const clean=owner?.kind==='delivery'?`/athel/co/${owner.co.id}`:owner?.kind==='return'?`/athel/co/stock?customer=${request.p_customer_id}`:`/athel/co/reports/${request.p_customer_id}/${owner?.kind==='report'?owner.month:request.p_month}`;
 const exit=()=>navigate(clean,{replace:true});
 let recovery=false,ordinaryReport=false;
 try{
  if(owner?.kind==='report'){
   recovery=hasScopedCORecovery(localStorage,actor.identity.actorId,request.p_customer_id,`report:${owner.month}`);
   ordinaryReport=hasOrdinaryCOReportCorrectionRecovery(localStorage,actor.identity.actorId,request.p_customer_id,`report:${owner.month}`);
  }else if(owner){
   const scope=owner.kind==='delivery'?`sj:${owner.co.id}`:'return';
   const raw=localStorage.getItem(`co-request:${encodeURIComponent(CO_BACKEND)}:${actor.identity.actorId}:${request.p_customer_id}:${encodeURIComponent(scope)}`);
   if(raw){try{const value=JSON.parse(raw);recovery=!!value.uncertain||!!value.committed}catch{recovery=true}}
  }
 }catch{recovery=true}
 // Only pre-existing uncertainty selects recovery. An active owner's own new
 // request must never cause a second owner to replace it during a refetch.
 const [entryRecovery]=useState({recovery,ordinaryReport});
 const read=useCORead(actor,'source-proposal',request,o=>fetchCOReportSourceProposal(request,o),!entryRecovery.recovery);
 const retained=useRef<{checked:COSourceProposalResume;co?:COOrderRecord}|null>(null);
 if(!actor.enabled)return null;
 if(entryRecovery.recovery&&owner){
  if(owner.kind==='delivery')return <CODeliveryDialog co={owner.co} returnFocus={null} onClose={exit} onSaved={exit}/>;
  if(owner.kind==='return')return <ReturnOwner customerId={request.p_customer_id} onClose={exit}/>;
  if(entryRecovery.ordinaryReport)return <COReportCorrectionRecovery customerId={request.p_customer_id} month={owner.month} onRecorded={exit} onExit={exit}/>;
  return <section><p>Periksa hasil pencatatan asli sebelum meninjau usulan sumber.</p><ActionLink to={clean}>Periksa hasil pencatatan</ActionLink></section>;
 }
 if(read.isError&&(!retained.current||isCOAuthorityError(read.error)))return <section><p>Usulan sumber asli tidak tersedia. Tidak ada sumber pengganti yang dibuat.</p><p>Usulan laporan biasa dapat ditinjau di pemilik aslinya. Usulan impor yang memerlukan ikatan pencatatan impor asli tidak dapat dilanjutkan dari sini.</p><COFailure error={read.error} retry={()=>void read.refetch()}/><ActionLink to={clean}>Kembali ke sumber</ActionLink></section>;
 if(!read.data&&!retained.current)return <LoadingState title="Memeriksa usulan sumber asli…" shape="compact"/>;
 const checked=retained.current?.checked??read.data!,url=coSourceProposalURL(checked),path=url.split('?')[0];
 if(linkOnly||!owner||path!==location.pathname||owner.kind!==checked.owner.kind)return <ActionLink to={url}>Tinjau usulan sumber asli</ActionLink>;
 const c=checked.source_context,p=c.payload;
 const coDrift=owner.kind==='delivery'&&(checked.owner.co_id!==owner.co.id||owner.co.customer_id!==checked.customer_id||owner.co.customer_version!==checked.customer_version||owner.co.co_version!==('expected_co_version' in p?p.expected_co_version:null));
 if(!retained.current){
  if(coDrift)return <p>Usulan sumber asli tidak tersedia: sumber CO berubah.</p>;
  retained.current={checked,...(owner.kind==='delivery'?{co:owner.co}:{})};
 }
 // Retained data identifies only the owner. Failed/drifting current reads block
 // every new source action; they never replace the core or dispose of recovery.
 const proposalDrift=!!read.data&&JSON.stringify(read.data)!==JSON.stringify(checked);
 const blocked=parentBlocked||read.isFetching||read.isError||coDrift||proposalDrift;
 const failure=<>{parentFailure}{read.isError&&<COFailure error={read.error} retry={()=>void read.refetch()}/>} {(coDrift||proposalDrift)&&<COFailure error={new Error('Usulan sumber asli tidak tersedia: sumber berubah; isian dan hasil asli dipertahankan.')} retry={()=>void read.refetch()}/>}</>;
 if(owner.kind==='delivery'){
  const correction=c.operation==='correct_sj'?{headId:c.payload.delivery_head_id,revisionId:c.payload.original_revision_id,version:c.payload.expected_delivery_version,action:c.payload.action}:undefined;
  return <CODeliveryDialog co={retained.current.co!} draftId={'draft_id' in p?p.draft_id:undefined} correctionSource={correction} readBlocked={blocked} readFailure={failure} resumeContext={c} returnFocus={null} onClose={exit} onSaved={exit}/>;
 }
 if(owner.kind==='return')return <ReturnOwner customerId={checked.customer_id} checked={checked} blocked={blocked} readFailure={failure} onClose={exit}/>;
 return <ReportOwner checked={checked} month={owner.month} blocked={blocked} readFailure={failure} onClose={exit}/>;
}
function ReturnOwner({customerId,checked,blocked=false,readFailure,onClose}:{customerId:string;checked?:COSourceProposalResume;blocked?:boolean;readFailure?:ReactNode;onClose:()=>void}){
 const actor=useCOActor(`source-return:${customerId}`);
 const stock=useCORead(actor,'source-return-current',{customerId},o=>fetchCOCustomerStock({p_customer_id:customerId,p_as_of:null,p_search:'',p_expected_customer_version:null,p_page:1,p_page_size:1},o));
 const retainedVersion=useRef<string|null>(null);
 if(stock.isError&&(!retainedVersion.current||isCOAuthorityError(stock.error)))return <COFailure error={stock.error} retry={()=>void stock.refetch()}/>;
 if(!stock.data&&!retainedVersion.current)return <LoadingState title="Memuat sumber retur…" shape="compact"/>;
 const drift=!!checked&&stock.data?.customer_version!==checked.customer_version;
 if(retainedVersion.current===null){if(drift)return <p>Usulan sumber asli tidak tersedia: pelanggan berubah.</p>;retainedVersion.current=stock.data!.customer_version}
 const failure=<>{readFailure}{stock.isError&&<COFailure error={stock.error} retry={()=>void stock.refetch()}/>} {drift&&<COFailure error={new Error('Usulan sumber asli tidak tersedia: pelanggan berubah; isian dan hasil asli dipertahankan.')} retry={()=>void stock.refetch()}/>}</>;

 const c=checked?.source_context;
 const selection=c?.operation==='post_return'?{view:'draft' as const,id:c.payload.draft_id,draftVersion:c.payload.expected_draft_version}:c?.operation==='correct_return'?{view:'effective' as const,id:c.payload.return_head_id,revisionId:c.payload.original_revision_id,returnVersion:c.payload.expected_return_version,action:c.payload.action}:undefined;
 return <COReturnDialog customerId={customerId} customerVersion={retainedVersion.current} selection={selection} resumeBlocked={blocked || stock.isFetching || stock.isError || drift} readFailure={failure} resumeContext={c} returnFocus={null} onClose={onClose} onSaved={onClose}/>;
}
/** The ordinary report workspace remains the only sender/canonical result owner. No seed/save here. */
function ReportOwner({checked,month,blocked,readFailure,onClose}:{checked:COSourceProposalResume;month:string;blocked:boolean;readFailure?:ReactNode;onClose:()=>void}){
 const work=useCOReportWorkspace(checked.customer_id,month),c=checked.source_context;
 const [dirty,setDirty]=useState(false),unsaved=useUnsavedChanges(dirty),mountedOwner=useRef(false);
 useBeforeSignOut(signal=>unsaved.confirmDiscardDecision({signal}),`source-report:${checked.customer_id}:${month}`);
 if(work.denied)return <COFailure error={work.authorityError}/>;
 if(!work.accepted)return <LoadingState title="Memuat sumber laporan…" shape="compact"/>;
 if(c.operation!=='correct_report')return <p>Usulan sumber asli tidak tersedia.</p>;
 const p=c.payload,d=work.accepted.draft,e=work.accepted.effective;
 const drift=work.accepted.customer_version!==checked.customer_version||d?.draft_id!==p.draft_id||d?.draft_version!==p.expected_draft_version||d?.consumed||d?.source_context_link||d?.context_issue||d?.eligible_set_fingerprint!==p.eligible_set_fingerprint||e?.report_head_id!==p.report_head_id||e?.revision_id!==p.original_revision_id||e?.report_version!==p.expected_report_version;
 if(drift&&!mountedOwner.current)return <p>Usulan sumber asli tidak tersedia: laporan utama berubah.</p>;
 mountedOwner.current=true;
 return <>{unsaved.dialog}<COCorrectionDialog resultAcceptance={<COReportCorrectionConsent work={work} onAccepted={()=>unsaved.runWithoutPrompt(onClose)}/>} ownUnsaved={false} onDirtyChange={setDirty} confirmDiscard={message=>unsaved.confirmDiscardDecision({message})} operation={c.operation} resumeContext={c} finalActionLabel="Simpan perubahan" customerId={checked.customer_id} source={p} selectedMonth={month} sender={work.sender} current={work.current} blocked={blocked || work.frozen || drift} readFailure={<>{readFailure}{drift&&<COFailure error={new Error('Usulan sumber asli tidak tersedia: laporan utama berubah; hasil asli dipertahankan.')}/>}</>} onAuthorityFailure={work.setError} onAccepted={async r=>{const ok=await work.acceptCanonical(r);if(ok)unsaved.runWithoutPrompt(onClose);return ok}} onRecovered={async r=>{const ok=await work.acceptCanonical(r,true);if(ok)unsaved.runWithoutPrompt(onClose);return ok}} onClose={()=>unsaved.confirmDiscard(onClose)} returnFocus={null}/></>;
}
