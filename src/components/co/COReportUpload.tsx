import { useCallback, useEffect, useRef, useState } from 'react';
import { parseVersion } from '../../lib/co/validation';
import { isCOAuthorityError } from '../../lib/co/authority';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import type { ImportScope, ImportReopenAcknowledgment, ReviewInput, SourceRef } from '../../lib/co/import/types';
import { useCOImportReview, type ImportEditSeed } from './useCOImportReview';
import COChangePreview from './COChangePreview';
import COImportReviewTable from './COImportReviewTable';
import COManualTranscription from './COManualTranscription';
import COSourcePreview from './COSourcePreview';
import COReturnReconciliation from './COReturnReconciliation';
import { Button } from '../ui/Button';
import { COFailure } from './COShared';
import './co-import.css';
const EXIT = 'Isian pemeriksaan yang belum dicatat akan hilang. Permintaan yang sudah dikirim tidak dibatalkan; gunakan Periksa hasil pencatatan bila hasilnya belum pasti.';
/** One mounted source owner. Never mount COEvidenceAttachment beside this workspace. */
function useWideComparison() {
 const [wide,setWide]=useState(()=>typeof matchMedia==='function' && matchMedia('(min-width: 1180px)').matches);
 useEffect(()=>{if(typeof matchMedia!=='function')return;const query=matchMedia('(min-width: 1180px)');const update=()=>setWide(query.matches);update();query.addEventListener('change',update);return ()=>query.removeEventListener('change',update)},[]);
 return wide;
}
export default function COReportUpload({ scope, customerName, onRecorded, onExit, edit = false, initialSeed, readBlocked=false, onDirtyChange, recoveryOnly=false, canonicalContext }: {
    scope: ImportScope;
    customerName: string;
    onRecorded?: () => void;
    onExit?: () => void;
    /** Historical values are read-only outside this owner; submission always needs a fresh File. */
    edit?: boolean;
    initialSeed?:ImportEditSeed;
    readBlocked?:boolean;
    recoveryOnly?:boolean;
    /** Checked root identity, independent of whether a fast refetch exposed isFetching. */
    canonicalContext?:string;
    onDirtyChange?:(dirty:boolean)=>void;
}) {
    const wideComparison = useWideComparison();
    const work = useCOImportReview(scope,readBlocked,recoveryOnly), { state } = work;
    useEffect(()=>{if(initialSeed&&!readBlocked)work.seedEdit(initialSeed)},[initialSeed,readBlocked,work.seedEdit]);
    const lastCanonical=useRef(canonicalContext);
    useEffect(()=>{
        if(lastCanonical.current===canonicalContext)return;
        lastCanonical.current=canonicalContext;
        // Reuse the existing suspension transition: retain intent, abort old generation,
        // discard checked context/preview, and require deliberate current-context review.
        work.setReadBlocked(true);
        work.setReadBlocked(readBlocked);
    },[canonicalContext,readBlocked,work.setReadBlocked]);
    const [editReason,setEditReason] = useState('');
    // Readiness is a capability of this exact checked preview, never the prior
    // child's boolean during a fingerprint-changing remount.
    const impactFingerprint=state.preview?.previewFingerprint??null;
    const [impactReadiness,setImpactReadiness]=useState<{fingerprint:string|null;ready:boolean}>({fingerprint:null,ready:false});
    const onImpactReady=useCallback((ready:boolean)=>setImpactReadiness({fingerprint:impactFingerprint,ready}),[impactFingerprint]);
    const impactReady=impactFingerprint!==null&&impactReadiness.fingerprint===impactFingerprint&&impactReadiness.ready;
    const guard = useUnsavedChanges(work.dirty || work.unknown || edit && !!editReason);
    useEffect(()=>{onDirtyChange?.(work.dirty||work.unknown||!!editReason);return ()=>onDirtyChange?.(false)},[work.dirty,work.unknown,editReason,onDirtyChange]);
    useBeforeSignOut(signal => guard.confirmDiscardDecision({ signal, message: EXIT }), JSON.stringify(scope));
    const [pane, setPane] = useState<'table' | 'source'>('table'), [selected, setSelected] = useState<SourceRef | null>(null), [localError, setLocalError] = useState(''), [accept, setAccept] = useState(false), [consent,setConsent]=useState<ImportReopenAcknowledgment[]>([]);
    const summary = useRef<HTMLElement>(null);
    const [focusSummary,setFocusSummary] = useState(0);
    useEffect(()=>{if(focusSummary)summary.current?.focus();},[focusSummary]);
    const fileGeneration = useRef(0);
    const [loadingFile,setLoadingFile] = useState(false);
    const live = useRef(true);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    useEffect(()=>setAccept(false),[state.phase,state.receipt,state.supportingResult]);
    useEffect(()=>{if(!state.preview)setConsent([])},[state.preview]);
    const required=state.preview?.requiredReopenOrders??[];
    const sameConsent=(a:readonly ImportReopenAcknowledgment[],b:readonly ImportReopenAcknowledgment[])=>a.length===b.length&&a.every(x=>b.some(y=>x.coId===y.coId&&x.expectedCoVersion===y.expectedCoVersion));
    const acks=!!required.length&&sameConsent(consent,required);
    const intendedAcknowledgments=acks?consent:[];
    const pinnedAcknowledgments=state.previewAcknowledgments??[];
    const consentPending=!!state.preview&&!sameConsent(intendedAcknowledgments,pinnedAcknowledgments);
    useEffect(()=>{if(readBlocked||recoveryOnly){fileGeneration.current++;setLoadingFile(false)}},[readBlocked,recoveryOnly]);
    const canReviewSource=!!state.file||!!state.preparedReviewReady;
    const busy = loadingFile || state.phase === 'processing' || state.phase === 'committing';
    const frozen = readBlocked || recoveryOnly || busy || work.unknown || !!state.supportingResult;
    const ignore = (p: Promise<unknown>) => void p.catch(() => { });
    async function file(file: File) {
      if(frozen)return;
      const reason=state.input?(state.input.reason??''):editReason;
      if(edit&&!reason.trim()){setLocalError('Alasan perubahan wajib diisi.');return;}
      if(!/\.(pdf|xlsx)$/i.test(file.name)){setLocalError('Pilih satu file PDF atau XLSX.');return;}
      if((work.unknown||work.dirty&&(!state.editSeed||!!state.file))&&!await guard.confirmDiscardDecision({message:EXIT})||!live.current)return;
      const generation=++fileGeneration.current;
      setLoadingFile(true);setLocalError('');setSelected(null);setPane('table');
      try { await (edit ? work.loadFile(file, reason.trim()) : work.loadFile(file)); if(live.current&&generation===fileGeneration.current)await work.loadContext(); }
      finally {if(live.current&&generation===fileGeneration.current)setLoadingFile(false);}
    }
    const update = (next: ReviewInput) => { setConsent([]); work.updateReview({ mappings: next.mappings, returns: next.returns, includedSectionIds: next.includedSectionIds, completenessConfirmed: next.completenessConfirmed, omittedZeroStockKeyIds: next.omittedZeroStockKeyIds, currency: next.currency, reason: next.reason, sourceConfirmations: next.sourceConfirmations??[] }); };
    async function cancel() { if (await guard.confirmDiscardDecision({ message: EXIT }) && live.current) {
        fileGeneration.current++;
        setLoadingFile(false);
        work.cancel();
        setSelected(null);
        onExit?.();
    } }
    useEffect(() => { if (state.phase === 'recorded')
        onRecorded?.(); }, [state.phase, onRecorded]);
    async function review() { if (!state.preparedReviewReady&&!state.validation?.canConfirm&&!state.validation?.canRequestServerCheck) {
        setPane('table');
        setFocusSummary(v=>v+1);
        return;
    } await work.review(intendedAcknowledgments); }
    return <div className="co-import">{guard.dialog}<header><h2 className="text-2xl font-semibold">{state.input ? 'Periksa laporan penjualan' : edit ? 'Edit laporan penjualan' : 'Upload laporan penjualan'}</h2><p>{customerName} · {scope.reportMonth.slice(0, 7)}{state.file && ` · ${state.file.name}`}</p></header>
 {recoveryOnly&&<section><h2>Pemulihan permintaan asli saja</h2><p>Perubahan sumber aktif harus diselesaikan melalui sumber aslinya. Hasil permintaan asli tetap dapat diperiksa dan diterima secara eksplisit; tidak ada pencatatan utama baru di sini.</p></section>}
 {edit && !recoveryOnly && !work.unknown && <section><p>{state.editSeed?'Nilai awal dapat diedit; konfirmasi dan bukti baru tetap wajib.':'Laporan tanpa baris sumber imutabel memerlukan pemetaan dari sumber baru; jumlah tercatat tetap ditampilkan di atas.'}</p><label>Alasan Edit<input className="ui-control" maxLength={2000} value={state.input?(state.input.reason??''):editReason} disabled={frozen} onChange={e=>{setEditReason(e.target.value);if(state.input)work.updateReview({reason:e.target.value||null})}}/></label></section>}
 {state.editSeed&&<section><h2>Nilai awal dari laporan tercatat</h2><p>Keputusan ini adalah isian awal, bukan bukti baru atau izin pencatatan. Konfirmasi ulang pemetaan, satuan, retur dan kelengkapan.</p><details><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Provenans nilai awal</summary><p>Pencatatan: {state.editSeed.revisionId} · manifest {state.editSeed.manifestDigest} · SHA sumber {state.editSeed.sourceSha256}</p></details></section>}
 {state.sourceReset&&<p role="alert">Sumber baru tidak sama dengan provenans nilai awal. Keputusan lama direset; periksa dan petakan sumber baru.</p>}
 {busy && <p role="status">{state.phase === 'committing' ? 'Mencatat penjualan…' : 'Memproses laporan…'}</p>}
 {(state.error || localError) && <COFailure error={state.error || new Error(localError)}/>}
 {work.unknown && <section><h2>Hasil perintah belum pasti</h2><p>Jangan kirim ulang. Keluar atau Batal tidak membatalkan perintah yang telah dikirim.</p><Button variant="secondary" disabled={readBlocked||busy} onClick={() => ignore(work.recover())}>{state.recoveryLabel}</Button></section>}
 {state.receipt && state.phase === 'unknown' && (state.error as {code?:string})?.code === 'CO_IMPORT_CURRENT_CHANGED' && !state.supportingResult && <section><p>Hasil asli tersimpan; keadaan laporan terkini perlu diterima secara eksplisit.</p><label><input type="checkbox" disabled={readBlocked||busy} checked={accept} onChange={e => setAccept(e.target.checked)}/>Saya memahami keadaan terkini dapat berbeda dari hasil asli</label><Button disabled={readBlocked||!accept || busy} variant="secondary" onClick={() => ignore(work.acceptRecovered())}>Terima hasil pencatatan asli</Button></section>}
 {state.supportingResult && <section><h2>Hasil asli ditemukan; konteks sudah berubah</h2><p>Operasi: {state.supportingResult.family}. Penerimaan membuang pemeriksaan saat ini, mengakui hasil asli, dan membaca keadaan terkini. Pilih file kembali setelahnya.</p><label><input type="checkbox" disabled={readBlocked||busy} checked={accept} onChange={e => setAccept(e.target.checked)}/>Buang isian saat ini dan terima keadaan terkini</label><Button variant="secondary" disabled={readBlocked||!accept || busy} onClick={() => ignore(work.acknowledgeSupporting())}>Akui hasil asli dan buka keadaan terkini</Button></section>}
 {!recoveryOnly && !work.unknown && !state.supportingResult && state.phase !== 'recorded' && <div className="co-import__drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length === 1)
        ignore(file(e.dataTransfer.files[0]));
    else
        setLocalError('Pilih tepat satu file.'); }}><label>{state.file ? 'Ganti file' : 'Pilih PDF atau XLSX'}<input type="file" accept=".pdf,.xlsx" disabled={frozen || edit && !(state.input?(state.input.reason??''):editReason).trim()} onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected)
        ignore(file(selected)); }}/></label><p>Tarik satu file ke sini atau gunakan pemilih file. Sumber hanya diperiksa secara lokal sebelum konfirmasi.</p></div>}
 {state.manualReviewRequired && <section><h2>Format sumber memerlukan pemeriksaan manual</h2><p>Ekstraksi tidak berhasil. Tidak ada jumlah yang dianggap nol atau dibuat otomatis.</p><ul>{state.input?.extracted.warnings.map(w => <li key={w}>{w}</li>)}</ul>{state.input && state.file && <COManualTranscription file={state.file} original={state.input.extracted} onTranscribe={work.transcribeSource} disabled={frozen}/>}</section>}
 {state.input?.extracted.manualTranscription && <section><h2>Ditulis ulang oleh manusia</h2><p>{state.input.extracted.manualTranscription.reason}</p><p>Parser asli: {state.input.extracted.manualTranscription.originalParserVersion}. Kegagalan asli tetap disimpan: {state.input.extracted.warnings.join("; ")}</p></section>}
 {state.input && <><div className="co-import__tabs" role="group" aria-label="Tampilan pemeriksaan"><Button variant="secondary" aria-pressed={pane === 'table'} onClick={() => setPane('table')}>Tabel pemeriksaan</Button><Button variant="secondary" disabled={!state.file} aria-pressed={pane === 'source'} onClick={() => setPane('source')}>Lihat sumber</Button></div><div className="co-import__layout"><div hidden={!wideComparison && pane !== 'table'}><div><p>{state.context ? 'Pemetaan memakai konteks pelanggan yang terikat versi.' : 'Konteks barang belum tersedia; keputusan belum dapat dikonfirmasi.'}</p>{!state.context && <Button variant="secondary" disabled={frozen || edit && !state.input.reason?.trim()} onClick={() => ignore(work.loadContext())}>Muat konteks barang</Button>}</div><COImportReviewTable summaryRef={summary} input={state.input} validation={state.validation ?? { issues: [], quantities: [], totalsByUnit: {}, sourceAmount: null, canConfirm: false }} context={state.context} onChange={update} disabled={frozen} onSource={ref => { setSelected(ref); setPane('source'); }} onDeclareUnit={(stockKeyId, unit, reason) => { if (!state.context)
        return; ignore(work.declareUnit({ customer_id: scope.customerId, stock_key_id: stockKeyId, expected_customer_version: parseVersion(state.context.context.customerVersion), expected_unit_version: null, unit, reason, confirmed: true }).then(() => work.loadContext())); }}/><COReturnReconciliation input={state.input} context={state.context} onChange={update} onRefresh={work.loadContext} disabled={frozen} onAuthorityFailure={error => { if (isCOAuthorityError(error))
        work.cancel(); }}/></div><div hidden={!wideComparison && pane !== 'source'}>{state.file && (wideComparison || pane === 'source') && <COSourcePreview file={state.file} selectedRef={selected}/>}</div></div></>}
 {state.preview && <section><h2>Konfirmasi pencatatan</h2><dl className="co-import__totals"><div><dt>Pendapatan CO sebelum</dt><dd>{state.preview.existingPreview.before?.revenue??'Belum tersedia'}</dd></div><div><dt>Pendapatan CO sesudah</dt><dd>{state.preview.existingPreview.after?.revenue??'Belum tersedia'}</dd></div><div><dt>Laporan terdampak</dt><dd>{state.preview.existingPreview.counts?.report??'—'}</dd></div><div><dt>Baris stok terdampak</dt><dd>{state.preview.existingPreview.counts?.stock??'—'}</dd></div><div><dt>Kredit PIC terdampak</dt><dd>{state.preview.existingPreview.counts?.credit??'—'}</dd></div></dl><p>Harga satuan CO mengikuti sumber alokasi FIFO, terpisah dari harga satuan laporan.</p><p>Seluruh laporan dicatat sebagai satu transaksi. Sistem mengalokasikan penjualan dengan FIFO; harga sumber tidak mengganti harga CO.</p>{state.preview.issues.map((i, n) => <p key={n}>{i.message}</p>)}</section>}
 {state.preview && <COChangePreview key={state.preview.previewFingerprint} onReadyChange={onImpactReady} selectedMonth={scope.reportMonth} importSnapshot={{binding:state.preview.binding,previewFingerprint:state.preview.previewFingerprint,acknowledgedReopenOrders:pinnedAcknowledgments,header:state.preview.existingPreview,requiredReopenOrders:state.preview.requiredReopenOrders}} onStalePreview={(fingerprint,error)=>work.invalidatePreview(fingerprint,error)} onAuthorityFailure={error=>{if(isCOAuthorityError(error))work.cancel()}}/>}
 {state.preview && <section>{!!state.preview.requiredReopenOrders?.length && <label><input type="checkbox" disabled={readBlocked||busy} checked={acks} onChange={e => setConsent(e.target.checked?structuredClone(required):[])}/>Saya menyetujui pembukaan kembali {state.preview.requiredReopenOrders.length} pesanan terdampak sesuai versi pratinjau</label>}</section>}
 {state.phase === 'recorded' ? <p role="status">Penjualan sudah dicatat dan hasil kanonis sudah diperiksa.</p> : <footer className="co-import__actions" role="group" aria-label={state.preview?'Tindakan pencatatan laporan':'Tindakan pemeriksaan laporan'}><Button variant="secondary" disabled={state.phase === 'committing'} onClick={() => ignore(cancel())}>Batal</Button>{state.input && !frozen && (state.needsFreshReview ? <Button disabled={!canReviewSource || edit&&!state.input.reason?.trim()} onClick={()=>ignore(work.refreshReview())}>Periksa ulang dampak</Button> : consentPending?<Button disabled={!canReviewSource} onClick={()=>ignore(review())}>Periksa ulang dampak</Button> : state.preview?.existingPreview.can_post && !state.preview.issues.some(i => i.blocking) ? <Button disabled={frozen || !canReviewSource || !impactReady || edit && !state.input?.reason?.trim() || !!state.preview.requiredReopenOrders?.length && !acks} onClick={() => { if(impactReady)ignore(work.confirm()); }}>{state.preview.existingPreview.operation === 'correct_report' ? 'Simpan perubahan' : 'Catat penjualan'}</Button> : <Button disabled={!canReviewSource || state.manualReviewRequired || !state.context&&!state.preparedReviewReady} onClick={() => ignore(review())}>{state.preview ? 'Periksa ulang dampak' : 'Tinjau pencatatan'}</Button>)}</footer>}</div>;
}
