import { LoadingState } from '../../../components/ui/LoadingState'
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBeforeSignOut } from '../../../lib/AuthContext';
import { useUnsavedChanges } from '../../../lib/useUnsavedChanges';
import { parseMonth, parseUUID } from '../../../lib/co/validation';
import type { COPreview, COReceipt, COReportPreviewPayload } from '../../../lib/co/contracts';
import { previewCOOperation } from '../../../lib/co/rpc';
import { sendCOCommand } from '../../../lib/co/transactions';
import { formatCOReportMonth } from '../../../lib/co/presentation';
import { formatDisplayDate } from '../../../lib/displayDate';
import { formatMoney } from '../../../lib/reads/money';
import { COFailure, COFreshness, CORecoveryPanel, useCOActor } from '../../../components/co/COShared';
import { useCOReportWorkspace, COReportFields, reportBinding } from '../../../components/co/COReportWorkspace';
import COEvidenceAttachment, { CORevisionAttachment } from '../../../components/co/COEvidenceAttachment';
import COChangePreview from '../../../components/co/COChangePreview';
import type { COReviewSnapshot } from '../../../components/co/COChangePreview';
import COAllocationDetails from '../../../components/co/COAllocationDetails';
import { Dialog } from '../../../components/ui/Dialog';
import { Button } from '../../../components/ui/Button';
import { ActionLink } from '../../../components/ui/ActionLink';
import { PageHeader } from '../../../components/ui/PageHeader';
import { FormActions } from '../../../components/ui/FormActions';
import { Section } from '../../../components/ui/Section';
import { Notice, EmptyState } from '../../../components/ui/Feedback';
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
    const [reviewRequest, setReviewRequest] = useState<{ payload: COReportPreviewPayload; generation: number } | null>(null);
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
    // A save changes the rendered version and starts new canonical row reads. Keep the
    // review intent pinned to that acknowledged draft, then enter run from a fresh render.
    useEffect(() => {
        if (!reviewRequest) return;
        const { payload, generation } = reviewRequest, h = work.header;
        if (!work.isGenerationCurrent(generation) || work.dirty || work.stale || work.root.isError || work.rowsRead.isError
            || work.evidenceState.dirty || work.evidenceState.pending || work.evidenceState.unresolved
            || work.sender.hasUnresolved() || work.confirmed || !work.editing || !h || h.consumed || h.context_issue || h.source_context_link
            || h.draft_id !== payload.draft_id || h.draft_version !== payload.expected_draft_version
            || h.customer_version !== payload.expected_customer_version || h.eligible_set_fingerprint !== payload.eligible_set_fingerprint) {
            setReviewRequest(null);
            return;
        }
        if (work.frozen) return;
        setReviewRequest(null);
        ignore(work.run(async live => {
            const v = version.current;
            const result = await previewCOOperation('post_report', payload, { isCurrent: live });
            if (live() && v === version.current)
                setReview({ operation: 'post_report', payload: { ...payload }, header: result as COPreview });
        }));
    }, [reviewRequest, work]);
    async function inspect() {
        setReview(null);
        setReviewRequest(null);
        const generation = work.generation;
        try {
            const h = await work.save();
            if (h && work.isGenerationCurrent(generation))
                setReviewRequest({ payload: reportBinding(h), generation });
        } catch (e) {
            if (work.isGenerationCurrent(generation)) work.setError(e);
        }
    }
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
        return work.root.isError ? <COFailure error={work.root.error} retry={() => void work.root.refetch()}/> : <LoadingState title="Memuat laporan pelanggan…" shape="list" />;
    const sourceGeneration = work.generation;
    const rejectChildAuthority = (error: unknown) => {
        if (work.isGenerationCurrent(sourceGeneration)) work.setError(error);
    };
    const h = work.header;
    const context = !!h?.source_context_link;
    const noActivity = work.accepted.reporting_freshness.status === 'no_recorded_activity';
    const reviewed = !!review && !work.dirty && !work.stale;
    const posted = !work.editing && !!work.accepted.effective;
    // A receipt alone is not a posted result. Wait for the existing canonical readback
    // and its row/authority gates before offering the next navigation step.
    const canViewStock = posted && !work.frozen && !work.confirmed;
    const step = !h ? 1 : work.editing ? reviewed ? 3 : 2 : 4;
    return <div className="min-w-0 mx-auto max-w-5xl space-y-5">{unsaved.dialog}<ActionLink variant="quiet" size="compact" to={`/athel/co/reports?customer=${customerId}`}>← Laporan bulanan</ActionLink><PageHeader title={<>{h?.customer_name ?? customerId} · {formatCOReportMonth(month)}</>} description="Laporan pelanggan ini mencakup semua CO pada periode dipilih."/><COFreshness value={work.accepted.reporting_freshness}/><CORecoveryPanel confirmed={!!work.confirmed} pending={work.pending} sender={work.sender} accept={recovered} current={() => work.current() && !work.pending}/>
 <Section title={!h ? 'Mulai laporan pelanggan' : work.editing ? reviewed ? 'Tinjau sebelum posting' : 'Lanjutkan laporan' : 'Laporan sudah diposting'} aria-label="Langkah laporan" aria-labelledby={undefined} className="space-y-3">
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Tahapan laporan">
        {['Mulai laporan', 'Isi jumlah terjual', 'Tinjau dan post', 'Lihat sisa stok'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={step === index + 1 ? 'font-semibold text-brand-primary' : 'text-brand-secondary'}>{index + 1}. {label}</li>)}
    </ol>
    {!h ? noActivity
        ? <p>Posting Surat Jalan terlebih dahulu agar ada sumber aktivitas laporan. Draft Surat Jalan belum menjadi sumber laporan.</p>
        : <p>Halaman ini belum menyimpan draft. Pilih Mulai laporan untuk menyiapkan draft dari sumber tercatat, lalu isi jumlah terjual.</p>
        : work.editing ? <><p>Isi total terjual selama periode ini, bukan jumlah stok atau tambahan penjualan. Kosong berarti belum diketahui; isi 0 bila tidak ada penjualan.</p><p className="text-sm">{context ? 'Simpan isian draft, lalu kembali ke sumber perubahan untuk meninjau semua periode bersama.' : work.accepted.effective ? 'Simpan Draft sebelum meninjau koreksi. Koreksi tetap memerlukan alasan perubahan dan persetujuan seluruh dampak.' : 'Tinjau laporan menyimpan isian terlebih dahulu, lalu menampilkan dampak dan penghalang. Laporan belum lengkap tetap dapat ditinjau; posting menunggu semua syarat terpenuhi.'}</p></>
        : <p>Stok buku pelanggan, bukan hasil pemeriksaan stok fisik. Tautan berikut membuka stok terkini untuk pelanggan ini.</p>}
    {canViewStock && <ActionLink variant="primary" to={`/athel/co/stock?customer=${customerId}`}>Lihat sisa stok pelanggan</ActionLink>}
 </Section>
 {h ? <><p className="text-sm">{work.editing ? 'Draft' : 'Diposting'}{h.report_version && BigInt(h.report_version) > 1n ? ` · Revisi ${h.report_version}` : ''} · Cakupan tercatat sampai {formatDisplayDate(h.coverage_through_date)} (tanggal UTC server){h.is_partial_month ? ' · bulan berjalan parsial' : ''}</p><p className="text-sm">Terjual periode ini (tersimpan): {h.sold_quantity}{!h.complete ? ' · belum lengkap' : ''}{!work.editing && <> · pendapatan periode Rp {formatMoney(h.revenue!, 'full')}</>}</p><details className="text-sm"><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Detail teknis laporan</summary><div className="mt-2 space-y-2 break-all"><p>Pelanggan: {customerId} · versi {h.customer_version}</p>{work.editing ? <><p>Draft: {h.draft_id} · versi {h.draft_version}</p><p>Sidik sumber: {h.eligible_set_fingerprint}</p></> : <p>Revisi efektif: {h.revision_id} · versi {h.report_version}</p>}</div></details><COReportFields work={work} allocation={row => <COAllocationDetails customerId={customerId} month={month} customerVersion={h.customer_version} revisionId={work.editing ? undefined : h.revision_id ?? undefined} snapshot={work.editing ? review ?? undefined : undefined} stockKeyId={row.stock_key_id} onAuthorityFailure={rejectChildAuthority}/>}/>{work.editing && h.draft_id && !h.consumed && !h.context_issue ? <COEvidenceAttachment work={work} confirmDiscard={message=>unsaved.confirmDiscardDecision({message})}/> : work.accepted.effective?.revision_id ? <CORevisionAttachment key={`${work.accepted.effective.revision_id}:${work.generation}`} customerId={customerId} revisionId={work.accepted.effective.revision_id} onAuthorityFailure={rejectChildAuthority}/> : null}</> : <EmptyState title="Belum ada laporan untuk periode ini.">{noActivity ? 'Belum ada sumber pengiriman yang diposting.' : 'Draft baru disiapkan setelah tindakan Mulai laporan.'}</EmptyState>}
 {!h && work.root.isError && <COFailure error={work.root.error} retry={() => void work.root.refetch()}/>}
 {!h && work.error && <COFailure error={work.error}/>}
 {(revision || previousRevision) && <COReportRevisionEvidence key={`${revision ?? previousRevision!}:${work.generation}`} customerId={customerId} month={month} customerVersion={work.accepted.customer_version} revisionId={revision ?? previousRevision!} isEffective={(revision ?? previousRevision) === work.accepted.effective?.revision_id} onAuthorityFailure={rejectChildAuthority}/>}
 {context && <Notice tone="warning" title="Laporan terikat ke perubahan sumber."> Siapkan ulang sumber asli melalui <ActionLink variant="quiet" size="compact" to="/athel/co">Pesanan CO</ActionLink> atau <ActionLink variant="quiet" size="compact" to={`/athel/co/stock?customer=${customerId}`}>Stok pelanggan</ActionLink>, lalu lengkapi dan tinjau semua periode bersama. Isian tersimpan tetap dipertahankan; tautan konteks tidak memuat seluruh usulan.</Notice>}
 {work.confirmed && <Notice tone="warning" title="Perintah sudah tersimpan; hasil lengkap perlu dibaca sebelum melanjutkan."><Button variant="quiet" size="compact" disabled={work.pending} onClick={() => ignore(work.acceptCanonical(work.confirmed!).catch(e => work.setError(e)))}>Buka hasil laporan tersimpan</Button></Notice>}
 <FormActions role="group" aria-label="Tindakan draft laporan" className="justify-start">{(!h || !work.editing || work.stale || h.context_issue) && !context && (h || !noActivity) && <Button variant={canViewStock ? "secondary" : "primary"} disabled={work.pending || work.evidenceState.pending || work.evidenceState.dirty || work.evidenceState.unresolved || work.sender.hasUnresolved() || !!work.confirmed || work.root.isFetching || work.root.isError} onClick={() => ignore(work.initialize())}>{h?.status === 'posted' ? 'Siapkan revisi laporan' : h ? 'Siapkan / perbarui draft' : 'Mulai laporan'}</Button>}{work.editing && <><Button variant={(work.accepted.effective || context) && (work.dirty || !h?.complete || context) ? "primary" : "secondary"} disabled={work.frozen || !!work.rowsRead.error} onClick={() => ignore(work.save())}>Simpan Draft</Button><Button variant="quiet" size="compact" disabled={work.frozen || !!work.rowsRead.error} onClick={() => void askZero()}>Isi sisa kosong dengan nol</Button>{!context && (work.accepted.effective ? <Button variant={!review && !work.dirty && h?.complete ? "primary" : "secondary"} disabled={work.frozen || work.dirty || !h?.complete} onClick={() => { trigger.current = document.activeElement as HTMLElement; setCorrection(true); }}>Tinjau koreksi laporan</Button> : <Button variant={!reviewed && !work.stale && !h?.context_issue ? "primary" : "secondary"} disabled={work.frozen || !!work.rowsRead.error} onClick={() => void inspect()}>Tinjau laporan</Button>)}</>}</FormActions>
 {review && !work.dirty && !work.stale && <><COChangePreview snapshot={review} selectedMonth={month} onAuthorityFailure={rejectChildAuthority}/><FormActions role="group" aria-label="Tindakan posting laporan" className="justify-start"><Button variant="primary" disabled={work.frozen || !review.header.can_post} onClick={() => void publish()}>Post laporan</Button></FormActions></>}
 {zero && <Dialog labelledBy="report-zero" pending={work.pending} returnFocus={trigger.current} fallbackFocus={() => null} onClose={() => setZero(null)}><h3 id="report-zero" className="ui-dialog__title">{zero === 'remaining' ? 'Konfirmasi isi nol' : 'Konfirmasi bulan tanpa penjualan'}</h3><p className="my-3 text-sm">{zero === 'remaining' ? `${zeroCount} baris belum diisi, termasuk halaman yang belum dibuka. Semua isian tersimpan tetap dipertahankan.` : 'Seluruh laporan ini mencatat penjualan nol. Konfirmasi bahwa tidak ada penjualan pada periode ini.'}</p><FormActions><Button variant="quiet" size="compact" onClick={() => setZero(null)}>Batal</Button><Button variant="primary" disabled={work.pending} onClick={() => { const mode = zero; setZero(null); if (mode === 'remaining')
        ignore(work.fillZero());
    else
        void publish(true); }}>Konfirmasi nol</Button></FormActions></Dialog>}
 {correction && work.editing && h && work.accepted.effective && <COCorrectionDialog operation="correct_report" customerId={customerId} selectedMonth={month} source={{ ...reportBinding(h), report_head_id: work.accepted.effective.report_head_id, original_revision_id: work.accepted.effective.revision_id, expected_report_version: work.accepted.effective.report_version }} sender={work.sender} current={work.current} blocked={work.frozen} onDirtyChange={setCorrectionDirty} onClose={() => unsaved.confirmDiscard(() => { setCorrection(false); setCorrectionDirty(false); })} onAuthorityFailure={work.setError} confirmDiscard={message => unsaved.confirmDiscardDecision({ message })} onRecovered={recovered} onAccepted={async (receipt) => { const original = work.accepted?.effective?.revision_id; const ok = await work.acceptCanonical(receipt); if (ok && original)
        setPreviousRevision(original); if (ok) {
        setCorrection(false);
        setCorrectionDirty(false);
    } return ok; }} returnFocus={trigger.current} ownUnsaved={false}/>}
 </div>;
}
