import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { coKeys } from '../../lib/co/queryKeys';
import { completeCORead, fetchCOCustomerBatches, fetchCOCustomerStock, fetchCompleteCOReturn } from '../../lib/co/rpc';
import type { COReadOptions } from '../../lib/co/rpc';
import type { COReceipt } from '../../lib/co/contracts';
import { useCOTransactionSender } from '../../lib/co/transactions';
import type { COTransactionSender } from '../../lib/co/transactions';
import { formatMoney } from '../../lib/reads/money';
import ReturnedDateDialog from '../ReturnedDateDialog';
import COCorrectionDialog from './COCorrectionDialog';
import { isCOAuthorityError } from './COReportWorkspace';
import { CO_BUTTON, CO_INPUT, CO_PRIMARY, COFailure, COPagination, CORecoveryPanel, enteredQuantity, useCOActor, useCORead } from './COShared';

export type COReturnSelection = {
    view: 'draft' | 'effective' | 'revision';
    id: string;
    draftVersion?: string;
    revisionId?: string;
    returnVersion?: string;
    action?: 'replace' | 'void';
};
type Props = {
    customerId: string;
    customerVersion: string;
    selection?: COReturnSelection;
    returnFocus: HTMLElement | null;
    onClose: () => void;
    onSaved?: () => void;
    blocked?: boolean;
    readFailure?: ReactNode;
    onAuthorityFailure?: (error: unknown) => void;
};
type Source = Record<string, any>;
type Entry = { source: Source; raw: string; available: string | null; original: string };
type Form = { date: string; reference: string; reason: string; notes: string; entries: Record<string, Entry> };
const snapshot = (form: Form) => JSON.stringify([form.date, form.reference, form.reason, form.notes,
    Object.entries(form.entries).filter(([, e]) => e.raw !== '').map(([id, e]) => [id, e.raw]).sort()]);

/** A denial tears down all source fields before an explicit checked retry can mount a fresh editor. */
export default function COReturnDialog(props: Props) {
    const actor = useCOActor(`return-gate:${props.customerId}:${JSON.stringify(props.selection)}`);
    const [failure, setFailure] = useState<unknown>(null);
    const [version, setVersion] = useState(props.customerVersion);
    const [retrying, setRetrying] = useState(false);
    const epoch = useRef(0);
    const retryLock = useRef(false);
    function reject(error: unknown) {
        if (!actor.isCurrent() || !isCOAuthorityError(error)) return;
        epoch.current++;
        setFailure(error);
        const queryKey = coKeys.identity(actor.identity);
        void actor.client.cancelQueries({ queryKey });
        actor.client.removeQueries({ queryKey });
        props.onAuthorityFailure?.(error);
    }
    async function retry() {
        if (retryLock.current || !actor.isCurrent()) return;
        retryLock.current = true;
        setRetrying(true);
        const generation = epoch.current;
        const live = () => actor.isCurrent() && epoch.current === generation;
        try {
            const fresh = await fetchCOCustomerStock({ p_customer_id: props.customerId, p_as_of: null, p_search: '',
                p_expected_customer_version: null, p_page: 1, p_page_size: 1 }, { isCurrent: live });
            if (live()) { setVersion(fresh.customer_version); setFailure(null); }
        } catch (error) { if (live()) setFailure(error); }
        finally { retryLock.current = false; if (actor.isCurrent()) setRetrying(false); }
    }
    if (!actor.enabled) return null;
    if (failure) return <COFailure error={failure} retry={retrying ? undefined : () => void retry()}/>;
    return <ReturnEditor {...props} customerVersion={version} observedVersion={props.customerVersion} key={`${actor.scope}:${epoch.current}`} onAuthorityFailure={reject}/>;
}
function ReturnEditor({ customerId, customerVersion, observedVersion, selection, returnFocus, onClose, onSaved,
    blocked = false, readFailure, onAuthorityFailure }: Props & { observedVersion: string }) {
    const actor = useCOActor(`return:${customerId}:${JSON.stringify(selection)}`);
    const rawSender = useCOTransactionSender({ formScope: 'return', customerId, retainCommitted: true });
    const [version, setVersion] = useState(customerVersion);
    const [readBinding, setReadBinding] = useState({ version: customerVersion, selection });
    const [form, setForm] = useState<Form>({ date: new Date().toISOString().slice(0, 10), reference: '', reason: '', notes: '', entries: {} });
    const [baseline, setBaseline] = useState('');
    const [header, setHeader] = useState<Source | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [pending, setPending] = useState(false);
    const [reviewPending, setReviewPending] = useState(false);
    const [reviewDirty, setReviewDirty] = useState(false);
    const [reviewSource, setReviewSource] = useState<Source | null>(null);
    const [action, setAction] = useState<'replace' | 'void' | undefined>(selection?.action);
    const [error, setError] = useState<unknown>(null);
    const [stale, setStale] = useState(false);
    const [needsReview, setNeedsReview] = useState(false);
    const [requiresSave, setRequiresSave] = useState(false);
    const [confirmed, setConfirmed] = useState<COReceipt | null>(null);
    const [posted, setPosted] = useState(false);
    const [page, setPage] = useState(1);
    const generation = useRef(0);
    const busy = useRef(false);
    const accepting = useRef(false);
    const departed = useRef(false);
    const denied = useRef(false);
    const latest = useRef(form);
    latest.current = form;
    const latestReview = useRef(reviewSource);
    latestReview.current = reviewSource;
    const refreshState = useRef({ blocked, reviewPending, confirmed });
    refreshState.current = { blocked, reviewPending, confirmed };
    const reviewPendingChanged = useCallback((value: boolean) => {
        if (actor.isCurrent() && !departed.current && !denied.current
            && (latestReview.current === reviewSource || !value && latestReview.current === null)) {
            setReviewPending(value);
        }
    }, [actor.scope, reviewSource]);
    const current = () => actor.isCurrent() && !departed.current && !denied.current;
    function failure(value: unknown) {
        if (!current()) return;
        if (isCOAuthorityError(value)) {
            denied.current = true;
            generation.current++;
            setForm({ date: '', reference: '', reason: '', notes: '', entries: {} });
            setHeader(null);
            setConfirmed(null);
            setReviewSource(null);
            onAuthorityFailure?.(value);
        } else {
            setError(value);
            if ((value as { code?: string })?.code === 'PT409') { setStale(true); setReviewSource(null); }
        }
    }
    async function protect<T>(run: () => Promise<T>) {
        const g = generation.current;
        try { return await run(); }
        catch (value) { if (current() && g === generation.current) failure(value); throw value; }
    }
    const sender: COTransactionSender = Object.assign(
        (operation: Parameters<COTransactionSender>[0], payload: unknown) => protect(() => rawSender(operation, payload)),
        { hasUnresolved: rawSender.hasUnresolved, reconcile: () => protect(rawSender.reconcile), acknowledgeRecovered: (live?: () => boolean) => protect(() => rawSender.acknowledgeRecovered(live)), getCommittedIdentity: rawSender.getCommittedIdentity },
    );
    const dirty = loaded && snapshot(form) !== baseline;
    const unsaved = useUnsavedChanges(dirty || reviewDirty);
    useBeforeSignOut(signal => unsaved.confirmDiscardDecision({ signal }), actor.scope);
    async function sources(cv: string, options: COReadOptions) {
        return completeCORead(p => fetchCOCustomerBatches({ p_customer_id: customerId, p_stock_key_id: null,
            p_expected_customer_version: cv, p_page: p, p_page_size: 100 }, options));
    }
    const read = useCORead(actor, 'return-preparation', { customerId, readBinding }, async options => {
        const target = readBinding.selection;
        const batches = await sources(readBinding.version, options);
        const saved = target ? await fetchCompleteCOReturn({ p_customer_id: customerId, p_target_id: target.id,
            p_view: target.view, p_expected_customer_version: readBinding.version, p_expected_draft_version: target.draftVersion ?? null }, options) : null;
        if (target?.action && saved && (saved.header.revision_id !== target.revisionId || saved.header.head_version !== target.returnVersion)) {
            throw new Error('Sumber retur telah digantikan. Pilih revisi efektif terbaru.');
        }
        if (target?.action === 'void' && saved?.header.is_void) throw new Error('Retur ini sudah dibatalkan.');
        return { batches, saved };
    });
    function entriesFor(batches: Source[], lines: Source[], preserve?: Record<string, Entry>) {
        const entries: Record<string, Entry> = {};
        for (const batch of batches) entries[batch.id] = { source: batch, raw: '', available: batch.available_quantity, original: '0' };
        for (const line of lines) entries[line.batch_id] = { source: { ...line, ...entries[line.batch_id]?.source }, raw: line.quantity,
            available: entries[line.batch_id]?.available ?? null, original: line.quantity };
        for (const [id, old] of Object.entries(preserve ?? {})) {
            entries[id] = { ...old, source: entries[id]?.source ?? old.source, available: entries[id]?.available ?? null };
        }
        return entries;
    }
    useEffect(() => {
        if (read.isError) { failure(read.error); return; }
        if (!read.data || loaded || !current()) return;
        const h = read.data.saved?.header ?? null;
        const next = { date: h?.return_date ?? (new Date().toISOString().slice(0, 10)), reference: h?.reference ?? '',
            reason: h?.reason ?? '', notes: h?.notes ?? '', entries: entriesFor(read.data.batches, read.data.saved?.lines ?? []) };
        setForm(next); setBaseline(snapshot(next)); setHeader(h); setLoaded(true);
        if (h && !h.bindings_current && h.target_kind === 'draft') setStale(true);
    }, [read.data, read.error]);
    const parentStale = BigInt(observedVersion) > BigInt(version);
    const readonly = !!header && (header.consumed || header.target_kind === 'revision' && !action);
    const frozen = pending || reviewPending || blocked || parentStale || read.isError || read.isFetching || stale || needsReview || !!confirmed || sender.hasUnresolved();
    function edit(patch: Partial<Form>) {
        if (frozen || readonly) return;
        generation.current++;
        setForm(old => ({ ...old, ...patch }));
        setReviewSource(null);
    }
    function payloadLines() {
        const lines = Object.entries(latest.current.entries).filter(([, entry]) => entry.raw !== '').map(([batch_id, entry]) => {
            const quantity = enteredQuantity(entry.raw);
            const allowed = entry.available === null ? 0n : BigInt(entry.available);
            const capacity = allowed + (action === 'replace' ? BigInt(entry.original) : 0n);
            if (BigInt(quantity) > capacity) throw new Error(`Jumlah retur ${entry.source.product_name} melebihi sumber tersedia. Periksa sumber terbaru.`);
            return { batch_id, quantity };
        });
        if (!lines.length) throw new Error('Pilih setidaknya satu sumber dan jumlah retur positif.');
        return lines;
    }
    async function canonical(receipt: COReceipt): Promise<boolean> {
        if (accepting.current || !current() || blocked) return false;
        accepting.current = true;
        try { return await importCanonical(receipt); }
        finally { accepting.current = false; }
    }
    async function importCanonical(receipt: COReceipt): Promise<boolean> {
        if (!current() || blocked) return false;
        const g = generation.current;
        const live = () => current() && g === generation.current;
        if (receipt.customer_id !== customerId || !['save_return_draft', 'post_return', 'correct_return'].includes(receipt.operation)) {
            throw new Error('Hasil pemulihan tidak sesuai retur pelanggan ini.');
        }
        if (receipt.operation === 'correct_return' && header?.head_id && receipt.id !== header.head_id) throw new Error('Hasil koreksi berbeda dari sumber retur.');
        if (receipt.operation === 'save_return_draft' && header?.target_kind === 'draft' && receipt.id !== header.id) throw new Error('Hasil draft berbeda dari sumber retur.');
        const result = await protect(() => fetchCompleteCOReturn({ p_customer_id: customerId, p_target_id: receipt.id,
            p_view: receipt.operation === 'save_return_draft' ? 'draft' : 'effective', p_expected_customer_version: receipt.customer_version,
            p_expected_draft_version: receipt.operation === 'save_return_draft' ? receipt.version : null }, { isCurrent: live }));
        if ((receipt.operation === 'save_return_draft' ? result.header.draft_version : result.header.head_version) !== receipt.version) throw new Error('Versi hasil retur tidak sesuai tanda terima.');
        if (receipt.operation === 'post_return' && header?.target_kind === 'draft') {
            const consumed = await protect(() => fetchCompleteCOReturn({
                p_customer_id: customerId, p_target_id: header.id, p_view: 'draft',
                p_expected_customer_version: receipt.customer_version,
                p_expected_draft_version: (BigInt(header.draft_version) + 1n).toString(),
            }, { isCurrent: live }));
            if (!consumed.header.consumed || consumed.header.head_id !== receipt.id) {
                throw new Error('Draft asal tidak terhubung ke hasil retur yang diterima.');
            }
        }
        if (!live()) return false;
        const batches = await protect(() => sources(receipt.customer_version, { isCurrent: live }));
        if (!live()) return false;
        await sender.acknowledgeRecovered(live);
        if (!live()) return false;
        const next: Form = { date: result.header.return_date, reference: result.header.reference ?? '', reason: result.header.reason ?? '', notes: result.header.notes ?? '',
            entries: entriesFor(batches, result.lines) };
        setReadBinding({ version: receipt.customer_version, selection: {
            view: receipt.operation === 'save_return_draft' ? 'draft' : 'effective', id: receipt.id,
            ...(receipt.operation === 'save_return_draft' ? { draftVersion: receipt.version } : {}),
        } });
        generation.current++;
        setForm(next); setBaseline(snapshot(next)); setHeader(result.header); setVersion(receipt.customer_version);
        setConfirmed(null); setReviewSource(null); setReviewDirty(false); setAction(undefined); setError(null); setStale(false);
        setPosted(receipt.operation !== 'save_return_draft');
        setRequiresSave(false);
        onSaved?.();
        void actor.client.invalidateQueries({ queryKey: coKeys.identity(actor.identity), predicate: q => !['return-preparation', 'preview-impact'].includes(String(q.queryKey[4])) });
        return true;
    }
    async function recover(receipt: COReceipt) {
        if (busy.current || !current() || blocked || pending || reviewPending) return false;
        const g = generation.current;
        if (dirty || reviewDirty) {
            const ok = await unsaved.confirmDiscardDecision({ message: 'Buang isian retur sekarang dan lihat hasil yang sudah tersimpan?' });
            if (!ok || !current() || generation.current !== g) return false;
        }
        busy.current = true; setPending(true);
        try { setConfirmed(receipt); return await canonical(receipt); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    async function save() {
        if (busy.current || frozen || readonly || !current()) return;
        busy.current = true; setPending(true); setError(null);
        const g = generation.current;
        try {
            const value = latest.current;
            if (!value.reference.trim() && !value.reason.trim()) throw new Error('Isi referensi atau alasan retur.');
            const receipt = await sender('save_return_draft', {
                customer_id: customerId, expected_customer_version: version, return_date: value.date,
                reference: value.reference.trim() || null, reason: value.reason.trim() || null, notes: value.notes.trim() || null,
                lines: payloadLines(), ...(header?.target_kind === 'draft' ? { draft_id: header.id, expected_draft_version: header.draft_version } : {}),
            });
            if (!current() || generation.current !== g) return;
            setConfirmed(receipt);
            await canonical(receipt);
        } catch (value) { if (current() && g === generation.current) failure(value); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    async function resolveCommittedConflict() {
        if (!confirmed || busy.current || accepting.current || pending || reviewPending || blocked || !current()) return;
        const receipt = confirmed, g = generation.current;
        const live = () => current() && generation.current === g;
        const discard = await unsaved.confirmDiscardDecision({ message: 'Buang isian retur yang belum disimpan, akui tanda terima asli, dan buka retur terkini untuk ditinjau?' });
        if (!discard || !live()) return;
        busy.current = true; setPending(true); setError(null);
        try {
            const identity = sender.getCommittedIdentity(receipt);
            if (receipt.customer_id !== customerId || !['save_return_draft', 'post_return', 'correct_return'].includes(receipt.operation)
                || identity.customer_id !== customerId || identity.operation !== receipt.operation
                || identity.target_id && identity.target_id !== receipt.id) throw new Error('Identitas hasil retur asli tidak sesuai.');
            const fresh = await protect(() => fetchCOCustomerStock({ p_customer_id: customerId, p_as_of: null, p_search: '',
                p_expected_customer_version: null, p_page: 1, p_page_size: 1 }, { isCurrent: live }));
            if (BigInt(fresh.customer_version) < BigInt(receipt.customer_version)) throw new Error('Sumber pelanggan mendahului tanda terima asli.');
            const view = receipt.operation === 'save_return_draft' ? 'draft' : 'effective';
            const result = await protect(() => fetchCompleteCOReturn({ p_customer_id: customerId, p_target_id: receipt.id,
                p_view: view, p_expected_customer_version: fresh.customer_version, p_expected_draft_version: null }, { isCurrent: live }));
            const currentVersion = view === 'draft' ? result.header.draft_version : result.header.head_version;
            if (BigInt(currentVersion) < BigInt(receipt.version)) throw new Error('Hasil retur terkini mendahului tanda terima asli.');
            if (receipt.operation === 'post_return') {
                if (!identity.draft_id) throw new Error('Identitas draft asal retur tidak tersedia.');
                const consumed = await protect(() => fetchCompleteCOReturn({ p_customer_id: customerId, p_target_id: identity.draft_id!,
                    p_view: 'draft', p_expected_customer_version: fresh.customer_version, p_expected_draft_version: null }, { isCurrent: live }));
                if (!consumed.header.consumed || consumed.header.head_id !== receipt.id) throw new Error('Draft asal tidak terhubung ke hasil retur yang diterima.');
            }
            const batches = await protect(() => sources(fresh.customer_version, { isCurrent: live }));
            if (!live()) return;
            await sender.acknowledgeRecovered(live); // Reconcile the unchanged five-field original, never the newer header.
            if (!live()) return;
            const next: Form = { date: result.header.return_date, reference: result.header.reference ?? '',
                reason: result.header.reason ?? '', notes: result.header.notes ?? '', entries: entriesFor(batches, result.lines) };
            setReadBinding({ version: fresh.customer_version, selection: { view, id: receipt.id,
                ...(view === 'draft' ? { draftVersion: result.header.draft_version } : {}) } });
            generation.current++;
            setForm(next); setBaseline(snapshot(next)); setHeader(result.header); setVersion(fresh.customer_version);
            setConfirmed(null); setReviewSource(null); setReviewDirty(false); setAction(undefined); setStale(false);
            setNeedsReview(true); setRequiresSave(view === 'draft'); setPosted(view !== 'draft'); setLoaded(true);
            onSaved?.();
        } catch (value) { if (live()) failure(value); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    async function refresh() {
        if (busy.current || pending || reviewPending || blocked || !current() || confirmed || sender.hasUnresolved()) return;
        busy.current = true; setPending(true);
        const decisionGeneration = generation.current;
        const decisionSource = reviewSource;
        let g = decisionGeneration;
        const live = () => current() && g === generation.current;
        try {
            if (reviewSource && reviewDirty) {
                const accepted = await unsaved.confirmDiscardDecision({
                    message: 'Buang alasan peninjauan dan isian periode yang belum disimpan sebelum memuat sumber retur terbaru?',
                });
                if (!accepted || !live() || latestReview.current !== decisionSource) return;
            }
            const latestState = refreshState.current;
            if (!live() || latestState.blocked || latestState.reviewPending || latestState.confirmed || sender.hasUnresolved()) return;
            g = ++generation.current;
            setError(null); setReviewSource(null); setReviewDirty(false);
            const fresh = await protect(() => fetchCOCustomerStock({ p_customer_id: customerId, p_as_of: null, p_search: '',
                p_expected_customer_version: null, p_page: 1, p_page_size: 1 }, { isCurrent: live }));
            const batches = await protect(() => sources(fresh.customer_version, { isCurrent: live }));
            const saved = header ? await protect(() => fetchCompleteCOReturn({ p_customer_id: customerId,
                p_target_id: header.target_kind === 'draft' ? header.id : header.head_id, p_view: header.target_kind === 'draft' ? 'draft' : 'effective',
                p_expected_customer_version: fresh.customer_version, p_expected_draft_version: header.target_kind === 'draft' ? header.draft_version : null }, { isCurrent: live })) : null;
            if (saved && action && saved.header.revision_id !== header?.revision_id) throw new Error('Sumber koreksi telah digantikan. Buka revisi efektif terbaru.');
            if (!live()) return;
            setForm(old => ({ ...old, entries: entriesFor(batches, saved?.lines ?? [], old.entries) }));
            setVersion(fresh.customer_version);
            setHeader(saved?.header ?? null);
            setReadBinding({ version: fresh.customer_version, selection: saved ? {
                view: saved.header.target_kind === 'draft' ? 'draft' : 'effective',
                id: saved.header.target_kind === 'draft' ? saved.header.id : saved.header.head_id,
                ...(saved.header.target_kind === 'draft' ? { draftVersion: saved.header.draft_version } : {}),
                ...(action ? { action, revisionId: saved.header.revision_id, returnVersion: saved.header.head_version } : {}),
            } : undefined });
            setStale(false);
            setNeedsReview(true);
            setRequiresSave(!action);
        } catch (value) { if (live()) failure(value); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    function review() {
        if (frozen || !current()) return;
        try {
            if (action && header?.head_id) {
                setReviewSource({ return_head_id: header.head_id, original_revision_id: header.revision_id,
                    expected_return_version: header.head_version, expected_customer_version: version, action,
                    ...(action === 'replace' ? { return_date: form.date, reference: form.reference.trim() || null, notes: form.notes.trim() || null, lines: payloadLines() } : {}) });
            } else if (header?.target_kind === 'draft' && !dirty && !header.consumed && !requiresSave && header.bindings_current) {
                setReviewSource({ draft_id: header.id, expected_draft_version: header.draft_version, expected_customer_version: version });
            }
        } catch (value) { failure(value); }
    }
    const dismiss = () => {
        if (pending || reviewPending || busy.current) return;
        unsaved.confirmDiscard(() => { departed.current = true; generation.current++; onClose(); });
    };
    const entries = Object.entries(form.entries).filter(([, entry]) => !readonly || entry.raw !== '');
    const visible = entries.slice((page - 1) * 20, page * 20);
    if (!actor.enabled || denied.current) return null;
    return <>{unsaved.dialog}<ReturnedDateDialog labelledBy="co-return-title" pending={pending || reviewPending} onClose={dismiss} returnFocus={returnFocus} fallbackFocus={() => null}>
        <div className="space-y-4">
            <h2 id="co-return-title" className="text-lg font-semibold">{action ? 'Koreksi retur barang' : 'Retur barang belum terjual'}</h2>
            <p className="text-sm">Satu retur pelanggan dapat mencakup beberapa CO. Draft tidak mengubah stok atau pendapatan. SJ Kembali hanya pengembalian dokumen.</p>
            {readFailure}{error && <COFailure error={error}/>}
            <CORecoveryPanel sender={sender} current={() => current() && !pending && !reviewPending && !blocked} accept={recover}/>
            {confirmed && <div role="alert">
                <p>Retur sudah tersimpan. Baca hasil kanonis sebelum membuat perubahan baru.</p>
                <button className={CO_BUTTON} disabled={pending || reviewPending || blocked} onClick={() => {
                    if (busy.current || !current()) return;
                    busy.current = true; setPending(true);
                    void canonical(confirmed).catch(failure).finally(() => { busy.current = false; if (current()) setPending(false); });
                }}>Buka hasil retur tersimpan</button>
                <p className="text-sm">Jika sumber telah berubah, tanda terima asli tetap berlaku hanya untuk hasil sebelumnya. Buka keadaan terkini secara terpisah.</p>
                <button className={CO_BUTTON} disabled={pending || reviewPending || blocked} onClick={() => void resolveCommittedConflict()}>Selesaikan konflik retur</button>
            </div>}
            {posted && <p role="status">Retur sudah tercatat</p>}
            {!loaded && !read.isError && <p role="status">Memuat seluruh sumber retur…</p>}
            {read.isError && <COFailure error={read.error} retry={() => void read.refetch()}/>}
            {(stale || parentStale) && <p role="alert">Sumber berubah. Isian tetap disimpan; muat sumber terbaru dan periksa lagi.</p>}
            {loaded && !readonly && <button className={CO_BUTTON} disabled={pending || reviewPending || blocked || !!confirmed || sender.hasUnresolved()} onClick={() => void refresh()}>Muat sumber retur terbaru</button>}
            {needsReview && <div role="alert"><p>Ketersediaan diperbarui. Pilihan lama belum disetujui ulang.</p>
                <button className={CO_BUTTON} disabled={pending || blocked} onClick={() => { setNeedsReview(false); setReviewSource(null); }}>Saya sudah memeriksa sumber terbaru</button></div>}
            {reviewSource ? <COCorrectionDialog embedded ownUnsaved={false} operation={action ? 'correct_return' : 'post_return'}
                customerId={customerId} source={reviewSource} sender={sender} current={current} blocked={blocked || pending || stale || parentStale || read.isError}
                readFailure={readFailure} returnFocus={returnFocus} onDirtyChange={setReviewDirty} onPendingChange={reviewPendingChanged}
                confirmDiscard={message => unsaved.confirmDiscardDecision({ message })} onAuthorityFailure={failure}
                onAccepted={async receipt => { setConfirmed(receipt); return canonical(receipt); }} onRecovered={recover}
                onClose={() => unsaved.confirmDiscard(() => { setReviewSource(null); setReviewDirty(false); })}/>
                : loaded && <>
                    {header && <p className="text-xs break-all">{header.line_count} sumber tersimpan · {header.target_kind === 'draft' ? `Draft ${header.id} v${header.draft_version}` : `Revisi ${header.revision_id} v${header.head_version}`}{header.consumed ? ' · sudah diposting' : ''}</p>}
                    {readonly && <p>Riwayat retur tersimpan, hanya baca.{header?.is_void ? ' Retur dibatalkan.' : ''}</p>}
                    <fieldset disabled={frozen || readonly || action === 'void'} className="grid gap-3 sm:grid-cols-2">
                        <label>Tanggal retur<input type="date" aria-label="Tanggal retur" className={CO_INPUT} value={form.date} onChange={e => edit({ date: e.target.value })}/></label>
                        <label>Referensi retur<input aria-label="Referensi retur" className={CO_INPUT} value={form.reference} onChange={e => edit({ reference: e.target.value })}/></label>
                        <label>Alasan retur<textarea aria-label="Alasan retur" className={CO_INPUT} value={form.reason} onChange={e => edit({ reason: e.target.value })}/></label>
                        <label>Catatan retur<textarea aria-label="Catatan retur" className={CO_INPUT} value={form.notes} onChange={e => edit({ notes: e.target.value })}/></label>
                    </fieldset>
                    <div className="space-y-3">{visible.map(([id, entry]) => <div key={id} className="rounded-lg border p-3 text-sm space-y-1">
                        <p>{entry.source.sj_number ?? 'Sumber tersimpan'} · {entry.source.display_sku} · {entry.source.product_name}</p>
                        <Link className="text-brand-primary" to={`/athel/co/${entry.source.co_id}`}>{entry.source.co_number}</Link>
                        <p>Harga asli Rp {formatMoney(entry.source.unit_price, 'full')} · PIC asli {entry.source.sales_person_name ?? 'Lihat bukti CO'} · tanggal SJ {entry.source.sj_date ?? 'Lihat bukti sumber'}</p>
                        <p>Tersedia tercatat: {entry.available ?? 'Sumber tidak tersedia pada pilihan positif saat ini'}</p>
                        <p className="text-xs break-all">Batch asli {id}</p>
                        <label>Jumlah retur<input aria-label={`Jumlah retur ${entry.source.sj_number ?? 'tersimpan'} ${entry.source.product_name}`} className={CO_INPUT} inputMode="numeric"
                            value={entry.raw} disabled={frozen || readonly || action === 'void'} onChange={e => edit({ entries: { ...form.entries, [id]: { ...entry, raw: e.target.value } } })}/></label>
                    </div>)}</div>
                    <COPagination page={page} total={String(entries.length)} pending={pending || reviewPending} onPage={setPage}/>
                    {requiresSave && <p className="text-sm">Simpan ulang draft untuk mengikat sumber yang baru diperiksa sebelum post.</p>}
                    {!readonly && <div className="flex flex-wrap gap-2">
                        {!action && <button className={CO_PRIMARY} disabled={frozen} onClick={() => void save()}>Simpan Draft retur</button>}
                        <button className={CO_PRIMARY} disabled={frozen || !action && (!header || dirty || header.consumed || requiresSave || !header.bindings_current)} onClick={review}>{action ? 'Tinjau koreksi retur' : 'Tinjau / post retur'}</button>
                    </div>}
                </>}
            <button className={CO_BUTTON} disabled={pending || reviewPending} onClick={dismiss}>Tutup retur</button>
        </div>
    </ReturnedDateDialog></>;
}
