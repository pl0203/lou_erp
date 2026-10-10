import { useEffect, useRef, useState } from 'react';
import { downloadEvidence, fetchEvidence, fetchEvidenceSelection, prepareEvidenceFile, uploadEvidence, useEvidenceSender } from '../../lib/co/evidence';
import type { EvidenceRecord, EvidenceReceipt, EvidenceRecovery } from '../../lib/co/evidence';
import { CO_BUTTON, COFailure, useCOActor } from './COShared';
import { isCOAuthorityError } from './COReportWorkspace';
import type { COReportWorkspace, EvidenceDraftBinding } from './COReportWorkspace';

/** Downloads have no retained URL. Every click makes an authenticated, reauthorized read. */
function saveBlob(blob: Blob, name: string, current: () => boolean) {
    if (!current()) return;
    const url = URL.createObjectURL(blob);
    try {
        if (!current()) return;
        const a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener';
        a.click();
    } finally { URL.revokeObjectURL(url); }
}

export function CORevisionAttachment({ customerId, revisionId, onAuthorityFailure }: {
    customerId: string; revisionId: string; onAuthorityFailure?: (error: unknown) => void;
}) {
    const actor = useCOActor(`attachment:${customerId}:${revisionId}`);
    const [record, setRecord] = useState<EvidenceRecord | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
    const epoch = useRef(0), lock = useRef(false);
    function fail(e: unknown, live: () => boolean) {
        if (!live()) return;
        setError(e);
        if (isCOAuthorityError(e)) { setRecord(null); epoch.current++; onAuthorityFailure?.(e); }
    }
    useEffect(() => {
        const g = ++epoch.current; const live = () => actor.isCurrent() && epoch.current === g;
        setRecord(null); setError(null); setLoading(true);
        void fetchEvidenceSelection({ customerId, revisionId }, live).then(e => { if (live()) setRecord(e); }).catch(e => fail(e, live)).finally(() => { if (live()) setLoading(false); });
        return () => { epoch.current++; };
    }, [actor.scope, customerId, revisionId, retry]);
    async function download() {
        if (lock.current || !record || !actor.isCurrent()) return;
        const g = epoch.current, live = () => actor.isCurrent() && epoch.current === g;
        lock.current = true; setBusy(true);
        try { const blob = await downloadEvidence(record, live); saveBlob(blob, record.filename, live); }
        catch (e) { fail(e, live); }
        finally { lock.current = false; if (live()) setBusy(false); }
    }
    if (!actor.enabled) return null;
    return <div className="text-sm space-y-2"><p>Lampiran revisi (opsional)</p>{error ? <COFailure error={error} retry={() => setRetry(n => n + 1)}/> : loading ? <p role="status">Memuat lampiran…</p> : record ? <button type="button" className={CO_BUTTON} disabled={busy} onClick={() => void download()}>Unduh {record.filename}</button> : <p>Tidak ada lampiran untuk revisi ini.</p>}</div>;
}

type EvidenceResult =
    | { kind: 'command'; receipt: EvidenceReceipt; binding?: EvidenceDraftBinding }
    | { kind: 'observation'; evidence: EvidenceRecord; binding: EvidenceDraftBinding };

/** One owner lifetime. Supporting receipts never enter business recovery or COReceipt. */
export default function COEvidenceAttachment({ work, blocked = false, sourceFingerprint, confirmDiscard }: {
    work: COReportWorkspace; blocked?: boolean; sourceFingerprint?: string; confirmDiscard?: (message:string)=>Promise<boolean>;
}) {
    const h = work.accepted?.draft;
    const [selected, setSelected] = useState<EvidenceRecord | null>(null);
    const [file, setFile] = useState<Awaited<ReturnType<typeof prepareEvidenceFile>> | null>(null);
    const [record, setRecord] = useState<EvidenceRecord | null>(null);
    const [result, setResult] = useState<EvidenceResult | null>(null);
    const [recovery, setRecovery] = useState<EvidenceRecovery | null>(null);
    const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
    const lock = useRef(false), epoch = useRef(0), latest = useRef(work), input = useRef<HTMLInputElement>(null);
    latest.current = work;
    const key = JSON.stringify([work.actor.scope,work.generation,h?.draft_id,h?.draft_version,h?.customer_version,h?.source_context_fingerprint,sourceFingerprint]);
    const latestKey = useRef(key); latestKey.current = key;
    const sender = useEvidenceSender({formScope:`report:${work.accepted?.report_month}`,customerId:work.accepted!.customer_id,ownerKey:key,isCurrent:work.current});
    const usable = !!h && work.editing && !h.consumed && !h.context_issue && (!sourceFingerprint || h.source_context_fingerprint === sourceFingerprint);
    const outstanding = sender.hasUnresolved() || !!result || !!recovery && recovery.status === 'committed';
    const dirty = !!file || !!record || outstanding;
    useEffect(() => { work.setEvidenceState({ dirty, pending: busy, unresolved: outstanding }); }, [dirty,busy,outstanding,work.setEvidenceState]);
    useEffect(() => () => work.setEvidenceState({ dirty:false,pending:false,unresolved:false }), [work.setEvidenceState]);
    function current(g: number, k = key) { return epoch.current === g && latestKey.current === k && latest.current.isGenerationCurrent(work.generation); }
    function fail(e: unknown, live: () => boolean) {
        if (!live()) return;
        setError(e);
        latest.current.setError(e);
        if (isCOAuthorityError(e)) { epoch.current++; setFile(null); setRecord(null); setSelected(null); setResult(null); setRecovery(null); if (input.current) input.current.value = ''; }
    }
    useEffect(() => {
        const g = ++epoch.current; const live = () => current(g);
        setFile(null); setRecord(null); setSelected(null); setError(null); setLoading(true);
        if (input.current) input.current.value = '';
        if (!usable) { setLoading(false); return () => { epoch.current++; }; }
        void fetchEvidenceSelection({ customerId: work.accepted!.customer_id, draftId: h!.draft_id!, draftVersion: h!.draft_version! },live)
            .then(e => { if (live()) setSelected(e); }).catch(e => fail(e,live)).finally(() => { if (live()) setLoading(false); });
        return () => { epoch.current++; };
    }, [key,usable,retry]);
    function binding(): EvidenceDraftBinding {
        return { customerId:work.accepted!.customer_id,month:work.accepted!.report_month,draftId:h!.draft_id!,previousDraftVersion:h!.draft_version!,customerVersion:h!.customer_version,generation:work.generation };
    }
    function match(e: EvidenceRecord, b: EvidenceDraftBinding) {
        if (e.customer_id!==b.customerId || e.draft_id!==b.draftId || e.report_month!==b.month || e.customer_version!==b.customerVersion || e.draft_version!==b.previousDraftVersion)
            throw new Error('Lampiran terikat pada versi lain. Perbarui dan tinjau sumber secara eksplisit.');
    }
    async function run(action: (live:()=>boolean)=>Promise<void>, allowRecovery=false) {
        if(lock.current || (!allowRecovery && !usable) || !work.current() || blocked || work.pending || (!allowRecovery && (work.evidenceBlocked || outstanding))) return;
        const g=epoch.current, live=()=>current(g);
        lock.current=true;setBusy(true);setError(null);
        try { await action(live); } catch(e) { fail(e,live); }
        finally { lock.current=false; if (latest.current.current()) setBusy(false); }
    }
    async function importResult(value: NonNullable<typeof result>, live:()=>boolean) {
        const e=await fetchEvidence(value.kind === 'command' ? value.receipt.id : value.evidence.id,live);
        if (value.kind === 'command') {
            if(e.customer_id!==value.receipt.customer_id || e.version!==value.receipt.version && value.receipt.operation==='finalize_evidence') throw new Error('Hasil lampiran tidak sesuai.');
            sender.getCommittedIdentity(value.receipt);
        } else if(e.state !== 'finalized' || JSON.stringify(e) !== JSON.stringify(value.evidence)) throw new Error('Hasil lampiran teramati berubah.');
        const b=value.binding ?? {...binding(),previousDraftVersion:e.draft_version};
        match(e,b);
        if(e.state==='finalized') {
            const accepted=await work.rebindDraftAfterEvidence(b,async(fresh,ownerLive)=>{
                const checked=await fetchEvidence(e.id,ownerLive);
                match(checked,b);
                if (value.kind === 'observation' && JSON.stringify(checked) !== JSON.stringify(value.evidence)) throw new Error('Hasil lampiran asli berubah.');
                if(checked.state!=='finalized'||checked.finalized_draft_version!==fresh.draft?.draft_version)throw new Error('Versi final lampiran tidak sesuai.');
                const chosen=await fetchEvidenceSelection({customerId:b.customerId,draftId:b.draftId,draftVersion:fresh.draft!.draft_version!},ownerLive);
                if(!chosen || chosen.id!==checked.id || chosen.version!==checked.version || chosen.finalized_draft_version!==checked.finalized_draft_version || value.kind === 'observation' && JSON.stringify(chosen) !== JSON.stringify(checked))throw new Error('Pilihan lampiran tidak sesuai.');
                if (value.kind === 'command') await sender.acknowledgeRecovered(ownerLive);
                if(!ownerLive())throw new Error('Editor berubah.');
            });
            if(!accepted)return;
            // Rebind intentionally advances the key; its guarded confirmation already checked lifetime.
            setSelected(e);setFile(null);setRecord(null);setResult(null);setRecovery(null);if(input.current)input.current.value='';
        } else {
            if (value.kind !== 'command') throw new Error('Lampiran teramati belum final.');
            if(h?.draft_version!==e.draft_version)throw new Error('Versi draft lampiran berubah.');
            const accepted = await work.verifyRegisteredEvidence(b, async ownerLive => {
                const identity = sender.getCommittedIdentity(value.receipt);
                if (identity.draft_id !== e.draft_id) throw new Error('Sumber registrasi lampiran tidak sesuai.');
                await sender.acknowledgeRecovered(ownerLive);
            });
            if (!accepted || !live()) return;
            setRecord(e);setResult(null);setRecovery(null);
        }
    }
    async function resolveConflict(value: NonNullable<typeof result>, live: () => boolean) {
        if (!confirmDiscard) return;
        const discard = await confirmDiscard('Buang isian laporan yang belum disimpan, akui hasil lampiran asli, dan buka laporan terkini untuk ditinjau ulang?');
        if (!discard || !live()) return;
        const e = await fetchEvidence(value.kind === 'command' ? value.receipt.id : value.evidence.id, live);
        const registration = value.kind === 'command' && value.receipt.operation === 'register_evidence';
        if (value.kind === 'command') {
            const identity = sender.getCommittedIdentity(value.receipt);
            // A command outcome remains pinned to its original five-field receipt and source.
            if (e.id !== value.receipt.id || e.customer_id !== value.receipt.customer_id
                || e.customer_version !== value.receipt.customer_version || e.customer_id !== work.accepted!.customer_id
                || e.report_month !== work.accepted!.report_month || e.draft_id !== h!.draft_id
                || (registration ? identity.draft_id !== e.draft_id || value.receipt.version !== '1' || BigInt(e.version) < 1n
                    : identity.target_id !== e.id || e.state !== 'finalized' || e.version !== value.receipt.version))
                throw new Error('Hasil lampiran asli tidak sesuai.');
        } else {
            // An observed same-creator finalization has no local command to acknowledge.
            // Keep its full checked immutable record and original editor binding instead.
            match(e, value.binding);
            if (e.state !== 'finalized' || JSON.stringify(e) !== JSON.stringify(value.evidence))
                throw new Error('Hasil lampiran teramati berubah.');
        }
        const b = value.kind === 'observation' ? value.binding : { ...binding(), previousDraftVersion: e.draft_version, customerVersion: e.customer_version };
        const accepted = await work.discardOverlayAfterEvidenceConflict(b, async (fresh, ownerLive) => {
            const checked = await fetchEvidence(e.id, ownerLive);
            if (JSON.stringify(checked) !== JSON.stringify(e)) throw new Error('Hasil lampiran asli berubah.');
            // A later attachment may be selected. Check that current sidecar separately.
            await fetchEvidenceSelection({ customerId: b.customerId, draftId: b.draftId, draftVersion: fresh.draft!.draft_version! }, ownerLive);
            if (value.kind === 'command') await sender.acknowledgeRecovered(ownerLive);
            if (!ownerLive()) throw new Error('Editor berubah.');
        }, registration ? 0n : 1n);
        if (!accepted) return;
        setFile(null); setRecord(null); setResult(null); setRecovery(null); setError(null);
        if (input.current) input.current.value = '';
    }
    async function attach(live:()=>boolean) {
        let e=record;
        const b=binding();
        if(!e) {
            if(!file)throw new Error('Pilih berkas terlebih dahulu.');
            const receipt=await sender('register_evidence',{draft_id:b.draftId,expected_draft_version:b.previousDraftVersion,expected_customer_version:b.customerVersion,filename:file.filename,mime_type:file.mime_type,byte_size:file.byte_size,sha256:file.sha256});
            if(!live())return;
            const value: EvidenceResult={kind:'command',receipt,binding:b};setResult(value);
            await importResult(value,live);
            if(!live())return;
            e=await fetchEvidence(receipt.id,live);match(e,b);
        }
        e=await fetchEvidence(e.id,live);match(e,b);
        if(e.state==='pending') {
            if(!file)throw new Error('Pilih kembali berkas yang sama untuk melanjutkan verifikasi.');
            await uploadEvidence(e.id,file.bytes,live);
            e=await fetchEvidence(e.id,live);match(e,b);setRecord(e);
        }
        if(e.state==='verified') {
            const receipt=await sender('finalize_evidence',{evidence_id:e.id,expected_evidence_version:e.version,expected_draft_version:b.previousDraftVersion,expected_customer_version:b.customerVersion});
            if(!live())return;
            const value: EvidenceResult={kind:'command',receipt,binding:b};setResult(value);
            await importResult(value,live);
        } else if(e.state==='finalized') {
            const value: EvidenceResult={kind:'observation',evidence:e,binding:b};setResult(value);await importResult(value,live);
        }
    }
    const disabled=busy||blocked||work.evidenceBlocked||outstanding||loading;
    return <section className="rounded-lg border border-gray-200 p-3 text-sm space-y-2" aria-label="Lampiran laporan opsional">
        <p>Lampiran laporan (opsional)</p><p>PDF, PNG, atau JPEG, maksimum 10 MiB. Berkas hanya diunduh, tidak ditampilkan atau diimpor.</p>
        {selected && <button type="button" className={CO_BUTTON} disabled={busy||blocked} onClick={()=>void run(async live=>saveBlob(await downloadEvidence(selected,live),selected.filename,live),true)}>Unduh {selected.filename}</button>}
        {!selected&&!loading&&<p>Tanpa lampiran tetap dapat disimpan dan diposting.</p>}
        {usable&&<><label>Pilih lampiran<input ref={input} aria-label="Pilih lampiran" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={disabled} onChange={event=>{const chosen=event.target.files?.[0];if(!chosen)return;void run(async live=>{const prepared=await prepareEvidenceFile(chosen,live);if(live())setFile(prepared);});}}/></label>
        {file&&<p>{file.filename} · belum terpasang</p>}{record&&<p role="status">{record.state==='pending'?'Unggahan belum terverifikasi. Periksa lalu lanjutkan dengan berkas yang sama.':'Berkas terverifikasi, pemasangan belum dikonfirmasi.'}</p>}
        <button type="button" className={CO_BUTTON} disabled={disabled||(!file&&!record)} onClick={()=>void run(attach)}>Verifikasi dan pasang lampiran</button>
        {(file||record)&&!outstanding&&<button type="button" className={CO_BUTTON} disabled={busy} onClick={()=>{setFile(null);setRecord(null);if(input.current)input.current.value='';}}>Batalkan pilihan lampiran</button>}</>}
        {sender.hasUnresolved()&&!result&&<button type="button" className={CO_BUTTON} disabled={busy||blocked||work.pending} onClick={()=>void run(async live=>{const recovered=await sender.reconcile();if(live())setRecovery(recovered);},true)}>Pulihkan permintaan lampiran</button>}
        {recovery?.status==='committed'&&!result&&<><p>Hasil lampiran ditemukan. Periksa sebelum melanjutkan.</p><button type="button" className={CO_BUTTON} disabled={busy} onClick={()=>void run(async live=>{const value: EvidenceResult={kind:'command',receipt:recovery.receipt};setResult(value);await importResult(value,live);},true)}>Buka hasil lampiran tersimpan</button><button type="button" className={CO_BUTTON} disabled={busy} onClick={()=>setRecovery(null)}>Pertahankan isian lampiran</button></>}
        {recovery?.status==='abandoned'&&<p>Permintaan sebelumnya tidak tersimpan. Pilih kembali untuk melanjutkan.</p>}
        {result&&<><p role="alert">Lampiran sudah tersimpan; hasil lengkap belum diimpor. Isian laporan tetap dipertahankan.</p><button type="button" className={CO_BUTTON} disabled={busy||work.pending} onClick={()=>void run(live=>importResult(result,live),true)}>Coba buka hasil lampiran</button>{confirmDiscard&&<button type="button" className={CO_BUTTON} disabled={busy||blocked||work.pending} onClick={()=>void run(live=>resolveConflict(result,live),true)}>Selesaikan konflik lampiran</button>}</>}
        {busy&&<p role="status">Memeriksa lampiran…</p>}{error&&<COFailure error={error} retry={()=>setRetry(n=>n+1)}/>}
    </section>;
}
