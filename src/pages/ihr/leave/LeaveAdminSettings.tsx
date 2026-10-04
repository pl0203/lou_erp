import { useEffect,useRef,useState } from 'react'
import { emptyPolicy } from '../../../lib/leave/adminContracts'
import type { AdminReceipt,LeaveAdminAccessData,LeaveAdminCommand,LeaveAdminRequest,LeaveAdminSend,LeaveAdminSettingsData,LeavePolicyDraft } from '../../../lib/leave/adminContracts'
import { toAdminPayload } from '../../../lib/leave/adminRpc'
import { LeavePolicyFields,LeavePolicyActivation } from './LeavePolicySettings'
import LeaveGovernanceSettings from './LeaveGovernanceSettings'
import LeaveAccessSettings from './LeaveAccessSettings'
import LeaveReassignmentSettings from './LeaveReassignmentSettings'
import LeaveSetupImpacts from './LeaveSetupImpacts'
import { useSetupUnsaved } from './useSetupUnsaved'
/** Only return after completed target reads and current active-actor authorization. */
export type AdminRefreshResult={employeeId:string;scopeVersion:string}
export type LeaveAdminSettingsProps={
 actorId:string;employeeId:string;scopeVersion:string;dataScopeVersion:string;authorityKey:string;authorityReady:boolean
 canConfigure:boolean;canManageAccess:boolean;canReadPrivate:boolean
 settings?:LeaveAdminSettingsData;access?:LeaveAdminAccessData;requests?:LeaveAdminRequest[]
 send:LeaveAdminSend;onRefresh:()=>Promise<AdminRefreshResult|void>;onDirtyChange?:(dirty:boolean)=>void;onClose?:()=>void
}
type Section='policy'|'activation'|'retention'|'access_review'|'access'|'reassignment'
type Draft={policy:LeavePolicyDraft;activation:{id:string;confirmed:boolean};retention:string;access_review:string;access:{manifest:string;grant:string};reassignment:{request:string;assignment:string};reasons:Record<Section,string>}
const initial=():Draft=>({policy:{...emptyPolicy},activation:{id:'',confirmed:false},retention:'',access_review:'',access:{manifest:'',grant:''},reassignment:{request:'',assignment:''},reasons:{policy:'',activation:'',retention:'',access_review:'',access:'',reassignment:''}})
const serialized=(draft:Draft,section:Section)=>JSON.stringify({value:draft[section],reason:draft.reasons[section]})
const sections:Section[]=['policy','activation','retention','access_review','access','reassignment']
const baselineFor=(draft:Draft)=>Object.fromEntries(sections.map(s=>[s,serialized(draft,s)])) as Record<Section,string>
/** Identity/target/capability loss drops every private draft. Scope continuity is narrower and proved below. */
export default function LeaveAdminSettings(props:LeaveAdminSettingsProps){
 return <AdminEditor key={`${props.actorId}:${props.employeeId}:${props.canConfigure}:${props.canManageAccess}:${props.canReadPrivate}:${props.authorityKey}`} {...props}/>
}
function AdminEditor(props:LeaveAdminSettingsProps){
 const {actorId,employeeId,scopeVersion,dataScopeVersion,authorityReady,canConfigure,canManageAccess,canReadPrivate,settings,access,requests=[],send,onRefresh,onDirtyChange,onClose}=props
 const [draft,setDraft]=useState(initial),[baseline,setBaseline]=useState(()=>baselineFor(initial())),[observedScope,setObservedScope]=useState(scopeVersion)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[waitingContinuity,setWaitingContinuity]=useState(false)
 const inFlight=useRef(false),ownRefresh=useRef(false),live=useRef(true),errorRef=useRef<HTMLParagraphElement>(null)
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 // A mere epoch change is not a grant-continuity receipt. Keep the draft off-screen while
 // an own mutation refresh resolves; every other epoch change drops all private input.
 if(observedScope!==scopeVersion&&!ownRefresh.current){setObservedScope(scopeVersion);const clean=initial();setDraft(clean);setBaseline(baselineFor(clean));setError('');setSaved('')}
 const dirty=sections.some(s=>baseline[s]!==serialized(draft,s))
 useSetupUnsaved(dirty)
 useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
 useEffect(()=>{if(error)errorRef.current?.focus()},[error])
 const fresh=authorityReady&&dataScopeVersion===scopeVersion&&observedScope===scopeVersion&&!waitingContinuity
 const own=actorId===employeeId,disabled=busy||own||!fresh
 const allowed=canConfigure||canManageAccess
 function change<K extends Section>(key:K,value:Draft[K]){setDraft(d=>({...d,[key]:value}));setSaved('')}
 function reason(section:Section){return <label className="block">Alasan {section}<textarea aria-label={`Alasan ${section}`} maxLength={1000} className="block min-h-20 w-full rounded border p-2" disabled={disabled} value={draft.reasons[section]} onChange={e=>{setDraft(d=>({...d,reasons:{...d.reasons,[section]:e.target.value}}));setSaved('')}}/></label>}
 function close(){if(!dirty||window.confirm('Buang isian pengaturan yang belum disimpan?'))onClose?.()}
 async function save(section:Section,command:LeaveAdminCommand){
  if(inFlight.current||disabled)return
  try{toAdminPayload(command)}catch{setError('Periksa isian, pilihan yang belum dikonfirmasi dan alasan perubahan.');return}
  inFlight.current=true;ownRefresh.current=true;setBusy(true);setError('');setSaved('')
  let receipt:AdminReceipt
  try{
   receipt=await send(command);if(!live.current)return
   setBaseline(b=>{
    if(section!=='access')return {...b,[section]:serialized(draft,section)}
    const prior=JSON.parse(b.access) as {value:Draft['access'];reason:string}
    const value=command.operation==='grant_leave_access'?{...prior.value,manifest:draft.access.manifest}:{...prior.value,grant:draft.access.grant}
    return {...b,access:JSON.stringify({value,reason:draft.reasons.access})}
   });setWaitingContinuity(true)
   const proof=await onRefresh();if(!live.current)return
   if(proof&&proof.employeeId===employeeId){setObservedScope(proof.scopeVersion)}else{const clean=initial();setDraft(clean);setBaseline(baselineFor(clean))}
   setSaved(`Pengaturan tersimpan (versi ${receipt.version}).`)
  }catch{if(live.current)setError('Perubahan belum dapat dipastikan. Periksa akses dan versi; pulihkan hasil sebelum mengirim percobaan berbeda.')}
  finally{if(live.current){setWaitingContinuity(false);setBusy(false)}inFlight.current=false;ownRefresh.current=false}
 }
 if(!allowed)return <p role="status">Akses pengaturan tidak tersedia.</p>
 if(!fresh)return <p role="status">Memeriksa kembali akses dan lingkup anggota…</p>
 const validSettings=canConfigure&&settings?.employeeId===employeeId&&settings.authorityKey===props.authorityKey,validAccess=canManageAccess&&access?.employeeId===employeeId&&access.authorityKey===props.authorityKey
 return <div className="space-y-5" aria-label="Administrasi cuti" onKeyDown={e=>{if(e.key==='Escape'&&onClose){e.preventDefault();close()}}}>
  <h2 className="text-lg font-semibold">Pengaturan cuti dengan izin khusus</h2>
  {own&&<p>Administrator lain harus mengubah kelayakan, jatah, izin atau penugasan Anda.</p>}
  {validSettings&&<><section aria-label="Kesiapan pengaturan" className="rounded-xl border p-4"><h3 className="font-semibold">Kesiapan penggunaan</h3>{settings.readiness.ready?<p>Seluruh prasyarat server telah diverifikasi.</p>:<ul className="list-disc pl-5">{settings.readiness.blockers.map(b=><li key={b.code}>{b.message}</li>)}</ul>}<LeaveSetupImpacts impacts={settings.impacts}/></section>
  <section className="space-y-3 rounded-xl border bg-white p-4"><LeavePolicyFields value={draft.policy} onChange={p=>change('policy',p)} disabled={disabled}/>{reason('policy')}<button type="button" className="min-h-11 rounded border px-4" disabled={disabled||!draft.reasons.policy.trim()} onClick={()=>void save('policy',{operation:'save_policy_version',employeeId,expectedVersion:settings.memberVersion,reason:draft.reasons.policy,policy:draft.policy})}>Simpan versi kebijakan</button></section>
  <section className="space-y-3 rounded-xl border bg-white p-4"><LeavePolicyActivation policies={settings.policyDrafts} value={draft.activation.id} onChange={id=>change('activation',{...draft.activation,id})} confirmed={draft.activation.confirmed} onConfirmed={confirmed=>change('activation',{...draft.activation,confirmed})} disabled={disabled}/>{reason('activation')}<button type="button" className="min-h-11 rounded border px-4" disabled={disabled||!draft.activation.id||!draft.activation.confirmed||!draft.reasons.activation.trim()} onClick={()=>void save('activation',{operation:'activate_member_policy',employeeId,expectedVersion:settings.memberVersion,reason:draft.reasons.activation,policyId:draft.activation.id,establishedEligibilityConfirmed:draft.activation.confirmed})}>Aktifkan versi kebijakan</button></section>
  {(['retention','access_review'] as const).map(kind=><section key={kind} className="space-y-3 rounded-xl border bg-white p-4"><LeaveGovernanceSettings kind={kind} evidence={settings.governance} value={draft[kind]} onChange={id=>change(kind,id)} disabled={disabled}/>{reason(kind)}<button type="button" className="min-h-11 rounded border px-4" disabled={disabled||!draft[kind]||!draft.reasons[kind].trim()} onClick={()=>void save(kind,{operation:'set_governance_reference',employeeId,kind,approvalId:draft[kind],expectedVersion:Math.max(0,...settings.governance.filter(g=>g.kind===kind).map(g=>g.referenceVersion)),reason:draft.reasons[kind]})}>Gunakan bukti {kind==='retention'?'retensi':'tinjauan akses'}</button></section>)}
  {canReadPrivate&&<section className="space-y-3 rounded-xl border bg-white p-4"><LeaveReassignmentSettings rows={requests} requestId={draft.reassignment.request} onRequest={request=>change('reassignment',{...draft.reassignment,request})} assignmentId={draft.reassignment.assignment} onAssignment={assignment=>change('reassignment',{...draft.reassignment,assignment})} disabled={disabled}/>{reason('reassignment')}<button type="button" className="min-h-11 rounded border px-4" disabled={disabled||!draft.reassignment.request||!draft.reassignment.assignment||!draft.reasons.reassignment.trim()} onClick={()=>{const r=requests.find(r=>r.id===draft.reassignment.request);if(r)void save('reassignment',{operation:'reassign_request',employeeId,requestId:r.id,expectedVersion:r.version,assignmentId:draft.reassignment.assignment,...(r.cancellationAttemptId?{attemptId:r.cancellationAttemptId}:{}),reason:draft.reasons.reassignment})}}>Alihkan satu permohonan</button></section>}
  </>}
  {canConfigure&&!validSettings&&<p role="status">Pengaturan anggota belum selesai dimuat.</p>}
  {validAccess&&<section className="space-y-3 rounded-xl border bg-white p-4"><LeaveAccessSettings actorId={actorId} data={access} manifestId={draft.access.manifest} onManifest={manifest=>change('access',{...draft.access,manifest})} grantId={draft.access.grant} onGrant={grant=>change('access',{...draft.access,grant})} disabled={disabled}/>{reason('access')}<div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded border px-4" disabled={disabled||!draft.access.manifest||!draft.reasons.access.trim()} onClick={()=>void save('access',{operation:'grant_leave_access',manifestId:draft.access.manifest,expectedVersion:0,reason:draft.reasons.access})}>Terapkan manifest izin</button><button type="button" className="min-h-11 rounded border px-4" disabled={disabled||!draft.access.grant||!draft.reasons.access.trim()} onClick={()=>{const g=access.grants.find(g=>g.id===draft.access.grant);if(g)void save('access',{operation:'revoke_leave_access',grantId:g.id,expectedVersion:g.version,reason:draft.reasons.access})}}>Cabut izin terpilih</button></div></section>}
  {canManageAccess&&!validAccess&&<p role="status">Pengelolaan izin memerlukan manifest bootstrap eksternal dan lingkup anggota yang terverifikasi.</p>}
  {error&&<p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}{saved&&<p role="status">{saved}</p>}
  {onClose&&<button type="button" className="min-h-11 rounded border px-4" disabled={busy} onClick={close}>Tutup pengaturan</button>}
 </div>
}
