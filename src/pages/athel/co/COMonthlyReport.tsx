import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBeforeSignOut } from '../../../lib/AuthContext';
import { useUnsavedChanges } from '../../../lib/useUnsavedChanges';
import { parseMonth, parseUUID } from '../../../lib/co/validation';
import type { COPreview, COReceipt } from '../../../lib/co/contracts';
import { previewCOOperation } from '../../../lib/co/rpc';
import { sendCOCommand } from '../../../lib/co/transactions';
import { formatMoney } from '../../../lib/reads/money';
import { CO_BUTTON, CO_PRIMARY, COFailure, COFreshness, CORecoveryPanel, useCOActor } from '../../../components/co/COShared';
import { useCOReportWorkspace, COReportFields, reportBinding } from '../../../components/co/COReportWorkspace';
import COEvidenceAttachment, { CORevisionAttachment } from '../../../components/co/COEvidenceAttachment';
import COChangePreview from '../../../components/co/COChangePreview';
import type { COReviewSnapshot } from '../../../components/co/COChangePreview';
import COAllocationDetails from '../../../components/co/COAllocationDetails';
import ReturnedDateDialog from '../../../components/ReturnedDateDialog';
import COReportRevisionEvidence from '../../../components/co/COReportRevisionEvidence';
import COCorrectionDialog from '../../../components/co/COCorrectionDialog';
export default function COMonthlyReport() { const { customerId, month } = useParams(); const [search] = useSearchParams(); const revision = search.get('revision'); const actor = useCOActor(`report-route:${customerId}:${month}`); try {
    parseUUID(customerId);
    parseMonth(month);
    if (revision)
        parseUUID(revision);
}
catch {
    return <COFailure error={new Error('Pelanggan atau bulan laporan tidak valid.')}/>;
} if (!actor.enabled)
    return null; return <ReportReady key={actor.scope} customerId={customerId!} month={month!} revision={revision}/>; }
function ReportReady({ customerId, month, revision }: {
    customerId: string;
    month: string;
    revision: string | null;
}) {
    const [previousRevision, setPreviousRevision] = useState<string | null>(null);
    const work = useCOReportWorkspace(customerId, month), [review, setReview] = useState<COReviewSnapshot | null>(null), [zero, setZero] = useState<'remaining' | 'post' | null>(null), [zeroCount, setZeroCount] = useState('0'), [correction, setCorrection] = useState(false), [correctionDirty, setCorrectionDirty] = useState(false);
    const unsaved = useUnsavedChanges(work.dirty || correctionDirty);
    useBeforeSignOut(signal => unsaved.confirmDiscardDecision({ signal }), `${work.actor.scope}:${work.generation}`);
    const version = useRef(0), trigger = useRef<HTMLElement | null>(null);
    const changeKey = JSON.stringify([work.entries, work.meta, work.header?.draft_version, work.header?.customer_version, work.header?.eligible_set_fingerprint, work.stale]);
    const previous = useRef(changeKey);
    if (previous.current !== changeKey) {
        previous.current = changeKey;
        version.current++;
    }
    useEffect(() => { if (review)
        setReview(null); }, [changeKey]);
    const ignore = (p: Promise<unknown>) => void p.catch(() => { });
    async function inspect() { setReview(null); try {
        const h = await work.save();
        if (!h || !work.current())
            return;
        const payload = reportBinding(h);
        await work.run(async (live) => { const v = version.current; const result = await previewCOOperation('post_report', payload, { isCurrent: live }); if (live() && v === version.current)
            setReview({ operation: 'post_report', payload: { ...payload }, header: result as COPreview }); });
    }
    catch (e) {
        work.setError(e);
    } }
    async function publish(confirmedZero = false) { if (!review || !review.header.can_post || work.dirty || work.frozen)
        return; if (work.header?.sold_quantity === '0' && !confirmedZero) {
        trigger.current = document.activeElement as HTMLElement;
        setZero('post');
        return;
    } ignore(work.run(async (live) => { const receipt = await sendCOCommand(work.sender, 'post_report', { ...reportBinding(work.header!), preview_fingerprint: review.header.preview_fingerprint }); if (!live())
        return; work.setConfirmed(receipt); await work.acceptCanonical(receipt); if (live())
        setReview(null); })); }
    async function askZero() { trigger.current = document.activeElement as HTMLElement; try {
        const h = await work.save();
        if (h && work.current()) {
            setReview(null);
            setZeroCount(h.missing_count);
            setZero('remaining');
        }
    }
    catch (e) {
        work.setError(e);
    } }
    async function recovered(receipt: COReceipt): Promise<boolean> { if (work.pending)
        return false; const g = work.generation; const ok = await unsaved.confirmDiscardDecision({ message: 'Buang isian saat ini dan buka hasil laporan yang dipulihkan?' }); if (!ok || !work.isGenerationCurrent(g))
        return false; return work.acceptCanonical(receipt, true); }
    if (work.denied)
        return <COFailure error={work.authorityError} retry={work.retryAuthority}/>;
    if (!work.accepted)
        return work.root.isError ? <COFailure error={work.root.error} retry={() => void work.root.refetch()}/> : <p role="status">Memuat laporan pelanggan…</p>;
    const sourceGeneration = work.generation;
    const rejectChildAuthority = (error: unknown) => {
        if (work.isGenerationCurrent(sourceGeneration)) work.setError(error);
    };
    const h = work.header;
    const context = !!h?.source_context_link;
    return <div className="mx-auto max-w-5xl space-y-5">{unsaved.dialog}<Link to="/athel/co/reports" className="text-sm">← Laporan bulanan</Link><h2 className="text-xl font-semibold">{h?.customer_name ?? customerId} · {month.slice(0, 7)}</h2><COFreshness value={work.accepted.reporting_freshness}/><CORecoveryPanel sender={work.sender} accept={recovered} current={() => work.current() && !work.pending}/>
 {h ? <><p className="text-sm">{work.editing ? 'Draft' : 'Posted'}{h.report_version && BigInt(h.report_version) > 1n ? ` · Revised v${h.report_version}` : ''} · Cakupan tercatat sampai {h.coverage_through_date}{h.is_partial_month ? ' · bulan berjalan parsial' : ''}</p>{!work.editing && <p>Revisi efektif: {h.revision_id} · versi {h.report_version} · pendapatan periode Rp {formatMoney(h.revenue!, 'full')}</p>}<COReportFields work={work} allocation={row => <COAllocationDetails customerId={customerId} month={month} customerVersion={h.customer_version} revisionId={work.editing ? undefined : h.revision_id ?? undefined} snapshot={work.editing ? review ?? undefined : undefined} stockKeyId={row.stock_key_id} onAuthorityFailure={rejectChildAuthority}/>}/>{work.editing && h.draft_id && !h.consumed && !h.context_issue ? <COEvidenceAttachment work={work} confirmDiscard={message=>unsaved.confirmDiscardDecision({message})}/> : work.accepted.effective?.revision_id ? <CORevisionAttachment key={`${work.accepted.effective.revision_id}:${work.generation}`} customerId={customerId} revisionId={work.accepted.effective.revision_id} onAuthorityFailure={rejectChildAuthority}/> : null}</> : <p>Belum ada laporan untuk periode ini. Siapkan draft dari sumber tercatat.</p>}
 {(revision || previousRevision) && <COReportRevisionEvidence key={`${revision ?? previousRevision!}:${work.generation}`} customerId={customerId} month={month} customerVersion={work.accepted.customer_version} revisionId={revision ?? previousRevision!} isEffective={(revision ?? previousRevision) === work.accepted.effective?.revision_id} onAuthorityFailure={rejectChildAuthority}/>}
 {context && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">Laporan terikat ke perubahan sumber. Siapkan ulang sumber asli melalui <Link to="/athel/co">Orders</Link> atau <Link to={`/athel/co/stock?customer=${customerId}`}>Customer Stock</Link>, lalu lengkapi dan tinjau semua periode bersama. Isian tersimpan tetap dipertahankan; tautan konteks tidak memuat seluruh usulan.</div>}
 {work.confirmed && <div role="alert"><p>Perintah sudah tersimpan; hasil lengkap perlu dibaca sebelum melanjutkan.</p><button className={CO_BUTTON} disabled={work.pending} onClick={() => ignore(work.acceptCanonical(work.confirmed!).catch(e => work.setError(e)))}>Buka hasil laporan tersimpan</button></div>}
 <div className="flex flex-wrap gap-2">{(!h || !work.editing || work.stale || h.context_issue) && !context && <button className={CO_BUTTON} disabled={work.pending || work.evidenceState.pending || work.evidenceState.dirty || work.evidenceState.unresolved || work.sender.hasUnresolved() || !!work.confirmed || work.root.isFetching || work.root.isError} onClick={() => ignore(work.initialize())}>{h?.status === 'posted' ? 'Siapkan revisi laporan' : 'Siapkan / perbarui draft'}</button>}{work.editing && <><button className={CO_PRIMARY} disabled={work.frozen || !!work.rowsRead.error} onClick={() => ignore(work.save())}>Simpan Draft</button><button className={CO_BUTTON} disabled={work.frozen || !!work.rowsRead.error} onClick={() => void askZero()}>Isi sisa kosong dengan nol</button>{!context && (work.accepted.effective ? <button className={CO_PRIMARY} disabled={work.frozen || work.dirty || !h?.complete} onClick={() => { trigger.current = document.activeElement as HTMLElement; setCorrection(true); }}>Tinjau koreksi laporan</button> : <button className={CO_PRIMARY} disabled={work.frozen || !!work.rowsRead.error} onClick={() => void inspect()}>Tinjau laporan</button>)}</>}</div>
 {review && !work.dirty && !work.stale && <><COChangePreview snapshot={review} selectedMonth={month} onAuthorityFailure={rejectChildAuthority}/><button className={CO_PRIMARY} disabled={work.frozen || !review.header.can_post} onClick={() => void publish()}>Post laporan</button></>}
 {zero && <ReturnedDateDialog labelledBy="report-zero" pending={work.pending} returnFocus={trigger.current} fallbackFocus={() => null} onClose={() => setZero(null)}><h3 id="report-zero">{zero === 'remaining' ? 'Konfirmasi isi nol' : 'Konfirmasi bulan tanpa penjualan'}</h3><p className="my-3 text-sm">{zero === 'remaining' ? `${zeroCount} baris belum diisi, termasuk halaman yang belum dibuka. Semua isian tersimpan tetap dipertahankan.` : 'Seluruh laporan ini mencatat penjualan nol. Konfirmasi bahwa tidak ada penjualan pada periode ini.'}</p><div className="flex gap-2"><button className={CO_BUTTON} onClick={() => setZero(null)}>Batal</button><button className={CO_PRIMARY} disabled={work.pending} onClick={() => { const mode = zero; setZero(null); if (mode === 'remaining')
        ignore(work.fillZero());
    else
        void publish(true); }}>Konfirmasi nol</button></div></ReturnedDateDialog>}
 {correction && work.editing && h && work.accepted.effective && <COCorrectionDialog operation="correct_report" customerId={customerId} selectedMonth={month} source={{ ...reportBinding(h), report_head_id: work.accepted.effective.report_head_id, original_revision_id: work.accepted.effective.revision_id, expected_report_version: work.accepted.effective.report_version }} sender={work.sender} current={work.current} blocked={work.frozen} onDirtyChange={setCorrectionDirty} onClose={() => unsaved.confirmDiscard(() => { setCorrection(false); setCorrectionDirty(false); })} onAuthorityFailure={work.setError} confirmDiscard={message => unsaved.confirmDiscardDecision({ message })} onRecovered={recovered} onAccepted={async (receipt) => { const original = work.accepted?.effective?.revision_id; const ok = await work.acceptCanonical(receipt); if (ok && original)
        setPreviousRevision(original); if (ok) {
        setCorrection(false);
        setCorrectionDirty(false);
    } return ok; }} returnFocus={trigger.current} ownUnsaved={false}/>}
 </div>;
}
