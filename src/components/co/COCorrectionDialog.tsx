import COEvidenceAttachment from './COEvidenceAttachment';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { COCompletedReportDraft, COReceipt, COReviewedOperation, COReviewSets, COSourceContext, COPreview, COReopenImpact } from '../../lib/co/contracts';
import type { COTransactionSender } from '../../lib/co/transactions';
import { previewCOOperation } from '../../lib/co/rpc';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import ReturnedDateDialog from '../ReturnedDateDialog';
import { CO_BUTTON, CO_PRIMARY, CO_INPUT, COFailure, CORecoveryPanel } from './COShared';
import COChangePreview, { readAllCOImpacts } from './COChangePreview';
import type { COReviewSnapshot } from './COChangePreview';
import { useCOReportWorkspace, COReportFields, reportBinding, isCOAuthorityError } from './COReportWorkspace';
/** Source owner retains canonical identity, original revision and result validation. No source reconstruction here. */
export interface COCorrectionProps {
    operation: COReviewedOperation;
    customerId: string;
    source: Record<string, unknown>;
    selectedMonth?: string;
    sender: COTransactionSender;
    current: () => boolean;
    blocked?: boolean;
    readFailure?: ReactNode;
    onAccepted: (receipt: COReceipt) => Promise<boolean>;
    onRecovered?: (receipt: COReceipt) => Promise<boolean>;
    onClose: () => void;
    returnFocus: HTMLElement | null;
    /** Embedded SJ/report owners already own route/signout protection. */
    ownUnsaved?: boolean;
    embedded?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
    onPendingChange?: (pending: boolean) => void;
    /** Use the existing source-level discard dialog for nested recovery. */
    confirmDiscard?: (message: string) => Promise<boolean>;
    /** Source owners must immediately hide their private subtree and require a canonical retry. */
    onAuthorityFailure?: (error: unknown) => void;
}
export default function COCorrectionDialog(props: COCorrectionProps) { return props.ownUnsaved === false ? <ReviewBody {...props}/> : <GuardedReview {...props}/>; }
function GuardedReview(props: COCorrectionProps) {
    const [dirty, setDirty] = useState(false);
    const unsaved = useUnsavedChanges(dirty);
    useBeforeSignOut(signal => unsaved.confirmDiscardDecision({ signal }),
        JSON.stringify([props.customerId, props.operation, props.source]));
    return <>
        {unsaved.dialog}
        <ReviewBody
            {...props}
            onDirtyChange={setDirty}
            confirmDiscard={message => unsaved.confirmDiscardDecision({ message })}
            onClose={() => unsaved.confirmDiscard(props.onClose)}
        />
    </>;
}
function ReviewBody({ operation, customerId, source, selectedMonth, sender, current, blocked = false, readFailure, onAccepted, onRecovered, onClose, returnFocus, embedded = false, onDirtyChange, onPendingChange, confirmDiscard, onAuthorityFailure }: COCorrectionProps) {
    const [reason, setReason] = useState(''), [review, setReview] = useState<COReviewSnapshot | null>(null), [required, setRequired] = useState<string[]>([]), [reopen, setReopen] = useState<COReopenImpact[]>([]), [completed, setCompleted] = useState<Record<string, COCompletedReportDraft>>({}), [ack, setAck] = useState<COReviewSets['acknowledged_reopen_orders']>([]), [context, setContext] = useState<COSourceContext | null>(null), [activeMonth, setActiveMonth] = useState<string | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<unknown>(null), [confirmed, setConfirmed] = useState<COReceipt | null>(null), [childDirty, setChildDirty] = useState(false);
    const [childPending, setChildPending] = useState(false);
    const anyPending = pending || childPending;
    useEffect(() => {
        onPendingChange?.(anyPending);
        return () => onPendingChange?.(false);
    }, [anyPending, onPendingChange]);
    const busy = useRef(false), mounted = useRef(true), epoch = useRef(0), sourceKey = JSON.stringify([operation, customerId, source]);
    const lastSource = useRef(sourceKey);
    if (lastSource.current !== sourceKey) {
        lastSource.current = sourceKey;
        epoch.current++;
    }
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { setReview(null); setContext(null); setCompleted({}); setAck([]); setRequired([]); setReopen([]); }, [sourceKey]);
    const live = () => mounted.current && current();
    const locked = pending || blocked || sender.hasUnresolved() || !!confirmed;
    useEffect(() => onDirtyChange?.(!!reason || !!activeMonth || childDirty || Object.keys(completed).length > 0 || ack.length > 0), [reason, activeMonth, childDirty, completed, ack, onDirtyChange]);
    async function inspect() {
        if (busy.current || locked || !live() || !reason.trim())
            return;
        busy.current = true;
        setPending(true);
        setError(null);
        setReview(null);
        const e = epoch.current;
        const valid = () => live() && epoch.current === e;
        try {
            const payload = { ...source, reason: reason.trim(), completed_report_drafts: Object.values(completed), acknowledged_reopen_orders: ack };
            const header = await previewCOOperation(operation, payload, { isCurrent: valid }) as COPreview;
            const snap: COReviewSnapshot = { operation, payload, header };
            const [issues, missing, reopens] = await Promise.all([readAllCOImpacts(snap, 'issue', { isCurrent: valid }), readAllCOImpacts(snap, 'missing_month', { isCurrent: valid }), readAllCOImpacts(snap, 'reopen', { isCurrent: valid })]);
            if (!valid())
                return;
            const months = new Set(missing.map(r => r.report_month));
            for (const issue of issues)
                if (issue.report_month && ['CO_REPORT_INCOMPLETE', 'CO_REPORT_REVISION_REQUIRED', 'CO_PARTIAL_MONTH_INCOMPLETE', 'CO_MISSING_REQUIRED_MONTH'].includes(issue.code))
                    months.add(issue.report_month);
            if (operation === 'correct_report' && selectedMonth)
                months.delete(selectedMonth);
            setRequired([...months].sort());
            setReopen(reopens);
            if (header.source_context_fingerprint) {
                const core = { ...source, reason: reason.trim() };
                setContext({ operation, payload: core, source_context_fingerprint: header.source_context_fingerprint } as COSourceContext);
            }
            else if (months.size)
                throw new Error('Sidik konteks sumber belum tersedia. Siapkan ulang sumber asli.');
            const exact = reopens.every(r => !!r.expected_co_version) && reopens.length === ack.length && reopens.every(r => ack.some(a => a.co_id === r.co_id && a.expected_co_version === r.expected_co_version));
            if (!exact && ack.length) {
                setAck([]);
                setReview(null);
            }
            else
                setReview(snap);
        }
        catch (error) {
            if (valid()) {
                if (isCOAuthorityError(error)) onAuthorityFailure?.(error);
                else setError(error);
            }
        }
        finally {
            busy.current = false;
            if (live())
                setPending(false);
        }
    }
    async function apply() { if (busy.current || locked || !review?.header.can_post || !live() || required.length || !exactAck())
        return; busy.current = true; setPending(true); setError(null); const e = epoch.current; try {
        const receipt = await sender(operation, { ...review.payload, preview_fingerprint: review.header.preview_fingerprint });
        if (!live() || e !== epoch.current)
            return;
        setConfirmed(receipt);
        const accepted = await onAccepted(receipt);
        if (live() && e === epoch.current && accepted) {
            setConfirmed(null);
            setReview(null);
        }
    }
    catch (err) {
        if (live() && e === epoch.current) {
            if (isCOAuthorityError(err)) onAuthorityFailure?.(err);
            else setError(err);
            setReview(null);
        }
    }
    finally {
        busy.current = false;
        if (live())
            setPending(false);
    } }
    function exactAck() { return reopen.length === ack.length && reopen.every(r => r.expected_co_version && ack.some(a => a.co_id === r.co_id && a.expected_co_version === r.expected_co_version)); }
    async function recover(receipt: COReceipt): Promise<boolean> { if (receipt.customer_id !== customerId || receipt.operation !== operation)
        throw new Error('Hasil pemulihan tidak sesuai perubahan ini.'); if (onRecovered)
        return onRecovered(receipt); /* Source owner validates canonical result before acknowledgment. */ throw new Error('Buka pemulihan dari editor sumber untuk memeriksa hasil kanonis dan menyetujui penggantian isian.'); }
    const previewEpoch = epoch.current;
    const rejectPreviewAuthority = (error: unknown) => {
        if (live() && epoch.current === previewEpoch) onAuthorityFailure?.(error);
    };
    const monthEditor = activeMonth && context ? <ReviewMonth
        key={`${activeMonth}:${context.source_context_fingerprint}`}
        customerId={customerId}
        month={activeMonth}
        context={context}
        blocked={blocked}
        current={live}
        confirmDiscard={confirmDiscard}
        onAuthorityFailure={onAuthorityFailure}
        onDirty={setChildDirty}
        onPending={setChildPending}
        onCancel={() => {
            if (!childDirty) {
                setActiveMonth(null);
                setReview(null);
            }
        }}
        onCompleted={binding => {
            setCompleted(old => ({ ...old, [activeMonth]: binding }));
            setActiveMonth(null);
            setChildDirty(false);
            setReview(null);
            epoch.current++;
        }}
    /> : null;
    const body = <><h2 id="co-correction-title" className="font-semibold text-lg">Tinjau perubahan tercatat</h2><p className="text-xs mt-2 break-all">Operasi {operation} · sumber {String(source.report_head_id ?? source.delivery_head_id ?? source.return_head_id ?? source.draft_id)}{source.original_revision_id ? ` · revisi asli ${source.original_revision_id}` : ''}{source.expected_report_version ?? source.expected_delivery_version ?? source.expected_return_version ? ` · versi asli ${source.expected_report_version ?? source.expected_delivery_version ?? source.expected_return_version}` : ''}</p><p className="text-xs mt-2">Semua periode, stok, pendapatan dan atribusi diterapkan bersama. Riwayat asli tetap tersimpan.</p><div className="space-y-4 mt-4">{readFailure}{error && <COFailure error={error}/>}<CORecoveryPanel sender={sender} current={() => live() && !pending && !busy.current} accept={recover}/>{monthEditor ? monthEditor : <>
 <label className="block text-sm">Alasan perubahan<textarea className={CO_INPUT} aria-label="Alasan perubahan" disabled={locked} value={reason} onChange={e => { if (locked)
            return; setReason(e.target.value); setReview(null); setContext(null); setCompleted({}); setAck([]); setRequired([]); setReopen([]); epoch.current++; }}/></label>
 {required.map(m => <button type="button" className={CO_BUTTON} key={m} disabled={locked || !context} onClick={() => { setActiveMonth(m); setReview(null); epoch.current++; }}>Lengkapi periode {m.slice(0, 7)}</button>)}{Object.keys(completed).length > 0 && <p className="text-sm">Draft periode siap dalam paket: {Object.keys(completed).map(m => m.slice(0, 7)).join(', ')}. Tinjau ulang seluruh paket.</p>}
 {reopen.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm"><p>{reopen.length} CO perlu dibuka ulang, termasuk stok nol dengan pengiriman/laporan belum lengkap.</p><div className="max-h-40 overflow-y-auto">{reopen.map(r => <p key={r.co_id} className="break-all">{r.co_id} · versi {r.expected_co_version ?? 'Tidak tersedia'}</p>)}</div><label><input type="checkbox" checked={exactAck()} disabled={locked || reopen.some(r => !r.expected_co_version)} onChange={e => { setAck(e.target.checked ? reopen.map(r => ({ co_id: r.co_id, expected_co_version: r.expected_co_version! })) : []); setReview(null); epoch.current++; }}/> Saya menyetujui pembukaan ulang tepat {reopen.length} CO dan versi yang tercantum</label></div>}
 <button className={CO_PRIMARY} disabled={locked || !reason.trim()} onClick={() => void inspect()}>Tinjau semua dampak</button>{review && <COChangePreview snapshot={review} selectedMonth={selectedMonth} onAuthorityFailure={rejectPreviewAuthority}/>} {review?.header.can_post && exactAck() && !required.length && <button className={CO_PRIMARY} disabled={locked} onClick={() => void apply()}>Terapkan perubahan</button>}</>}
 {confirmed && <div role="alert"><p>Perubahan sudah tersimpan. Periksa hasil sumber sebelum membuat perubahan baru.</p><button className={CO_BUTTON} disabled={pending} onClick={() => { if (busy.current || !live())
        return; busy.current = true; setPending(true); void onAccepted(confirmed).then(ok => { if (live() && ok)
        setConfirmed(null); }).catch(setError).finally(() => { busy.current = false; if (live())
        setPending(false); }); }}>Buka hasil perubahan tersimpan</button></div>}
 <button className={CO_BUTTON} disabled={anyPending} onClick={onClose}>Kembali ke sumber</button></div></>;
    return embedded ? <section aria-labelledby="co-correction-title">{body}</section> : <ReturnedDateDialog labelledBy="co-correction-title" pending={anyPending} onClose={onClose} returnFocus={returnFocus} fallbackFocus={() => null}>{body}</ReturnedDateDialog>;
}
function ReviewMonth({
    customerId, month, context, blocked, current, confirmDiscard, onAuthorityFailure, onDirty, onPending, onCancel, onCompleted,
}: {
    customerId: string;
    month: string;
    context: COSourceContext;
    blocked: boolean;
    current: () => boolean;
    confirmDiscard?: (message: string) => Promise<boolean>;
    onAuthorityFailure?: (error: unknown) => void;
    onDirty: (dirty: boolean) => void;
    onPending: (pending: boolean) => void;
    onCancel: () => void;
    onCompleted: (binding: COCompletedReportDraft) => void;
}) {
    const work = useCOReportWorkspace(customerId, month, onAuthorityFailure);
    const [prepared, setPrepared] = useState(false);
    const [zero, setZero] = useState(false);
    const [count, setCount] = useState('0');
    const ready = prepared && work.header?.source_context_fingerprint === context.source_context_fingerprint;
    useEffect(() => onDirty(work.dirty || work.pending), [work.dirty, work.pending, onDirty]);
    const retainsResult = work.pending || work.evidenceState.pending || work.evidenceState.unresolved || work.sender.hasUnresolved() || !!work.confirmed;
    useEffect(() => {
        onPending(retainsResult);
        return () => onPending(false);
    }, [retainsResult, onPending]);
    const ignore = (promise: Promise<unknown>) => void promise.catch(() => {});

    async function recover(receipt: COReceipt) {
        if (receipt.operation !== 'save_report_draft') {
            throw new Error('Hasil pemulihan bukan draft periode ini.');
        }
        const generation = work.generation;
        if (work.dirty) {
            if (!confirmDiscard) throw new Error('Buka pemulihan melalui editor sumber untuk menyetujui penggantian isian.');
            const accepted = await confirmDiscard('Buang isian periode ini dan buka hasil draft yang dipulihkan?');
            if (!accepted || !current() || !work.isGenerationCurrent(generation)) return false;
        }
        const accepted = await work.acceptCanonical(receipt, true);
        if (accepted && current()) setPrepared(true);
        return accepted;
    }
    async function retryCommitted() {
        if (!work.confirmed || !current()) return;
        const accepted = await work.acceptCanonical(work.confirmed);
        if (accepted && current()) setPrepared(true);
    }
    async function finish() {
        try {
            const header = await work.save();
            if (!header || !header.complete || header.context_issue || !current()
                || header.source_context_fingerprint !== context.source_context_fingerprint) {
                throw new Error('Lengkapi semua baris dengan konteks sumber terbaru.');
            }
            const binding = reportBinding(header);
            const effective = work.accepted?.effective;
            onCompleted({
                draft_id: binding.draft_id,
                expected_draft_version: binding.expected_draft_version,
                eligible_set_fingerprint: binding.eligible_set_fingerprint,
                ...(effective ? {
                    original_revision_id: effective.revision_id,
                    expected_report_version: effective.report_version,
                } : {}),
            } as COCompletedReportDraft);
        } catch (error) {
            work.setError(error);
        }
    }
    if (work.denied) return <COFailure error={work.authorityError} retry={work.retryAuthority}/>;
    return <div className="space-y-3">
        <h3>Lengkapi periode {month.slice(0, 7)}</h3>
        <p className="text-xs">Isian tersimpan dipertahankan. SKU tambahan wajib diisi, termasuk nol eksplisit.</p>
        <CORecoveryPanel
            sender={work.sender}
            current={() => current() && work.current() && !work.pending}
            accept={recover}
        />
        {work.confirmed && <div role="alert">
            <p>Draft periode sudah tersimpan. Baca hasilnya sebelum melanjutkan; isian yang belum terkirim tetap dipertahankan.</p>
            <button className={CO_BUTTON} disabled={work.pending || blocked}
                onClick={() => ignore(retryCommitted())}>Buka hasil laporan tersimpan</button>
        </div>}
        {!ready ? <button className={CO_BUTTON}
            disabled={blocked || work.pending || !work.accepted || !current() || !!work.confirmed || work.sender.hasUnresolved()}
            onClick={() => ignore(work.initialize(context).then(header => {
                if (header && current()) setPrepared(true);
            }))}>Perbarui periode terhadap sumber usulan</button> : <>
            <COReportFields work={work}/><COEvidenceAttachment work={work} confirmDiscard={confirmDiscard} blocked={blocked || !current()} sourceFingerprint={context.source_context_fingerprint}/>
            <button className={CO_BUTTON} disabled={blocked || work.frozen}
                onClick={() => ignore(work.save())}>Simpan Draft periode</button>
            <button className={CO_BUTTON} disabled={blocked || work.frozen}
                onClick={() => ignore(work.save().then(header => {
                    if (header && current()) {
                        setCount(header.missing_count);
                        setZero(true);
                    }
                }))}>Isi sisa periode dengan nol</button>
            {zero && <div role="alert">
                <p>{count} baris kosong di seluruh periode, termasuk halaman belum dibuka. Isi nol?</p>
                <button className={CO_BUTTON} onClick={() => setZero(false)}>Batal nol</button>
                <button className={CO_BUTTON} disabled={work.frozen || blocked}
                    onClick={() => { setZero(false); ignore(work.fillZero()); }}>Konfirmasi nol periode</button>
            </div>}
            <button className={CO_PRIMARY} disabled={blocked || work.frozen}
                onClick={() => void finish()}>Gunakan draft periode lengkap</button>
        </>}
        {!ready && work.error && <COFailure error={work.error}/>}
        <button className={CO_BUTTON} disabled={work.dirty || work.pending || work.evidenceState.pending || work.evidenceState.unresolved || work.sender.hasUnresolved() || !!work.confirmed}
            onClick={onCancel}>Kembali ke peninjauan</button>
        {work.dirty && <p>Simpan isian periode sebelum kembali.</p>}
    </div>;
}
