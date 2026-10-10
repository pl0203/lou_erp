import { useEffect, useRef, useState } from 'react';
import { coKeys } from '../../lib/co/queryKeys';
import { completeCORead, fetchCOReport, fetchCOReportRows } from '../../lib/co/rpc';
import type { COReadOptions } from '../../lib/co/rpc';
import type { COReportHeader, COReportRow, COReadResult } from '../../lib/co/validation';
import { invalid } from '../../lib/co/validation';
import type { COReceipt, COSourceContext, COSaveReportDraftPayload, COReportPreviewPayload } from '../../lib/co/contracts';
import { useCOTransactionSender, sendCOCommand } from '../../lib/co/transactions';
import type { COTransactionSender } from '../../lib/co/transactions';
import { CO_INPUT, COFailure, enteredQuantity, useCOActor, useCORead } from './COShared';
import COMonthlySalesGrid from './COMonthlySalesGrid';
export function reportBinding(header: COReportHeader): COReportPreviewPayload {
    if (!header.draft_id || !header.draft_version || !header.eligible_set_fingerprint || header.consumed || header.context_issue)
        throw new Error('Draft perlu diperbarui sebelum dilanjutkan.');
    return { draft_id: header.draft_id, expected_draft_version: header.draft_version, expected_customer_version: header.customer_version, eligible_set_fingerprint: header.eligible_set_fingerprint };
}
export type EvidenceDraftBinding = {customerId:string;month:string;draftId:string;previousDraftVersion:string;customerVersion:string;generation:number};
const metadata = (h: COReportHeader | null) => ({ report_reference: h?.report_reference ?? '', received_date: h?.received_date ?? '', notes: h?.notes ?? '' });
export { isCOAuthorityError } from '../../lib/co/authority';
import { isCOAuthorityError } from '../../lib/co/authority';
function validateReportPage(result: COReadResult, header: COReportHeader, editing: boolean) {
    if (result.total !== header.row_count || result.draft_id !== (editing ? header.draft_id : null)
        || result.revision_id !== (editing ? null : header.revision_id)
        || result.eligible_set_fingerprint !== header.eligible_set_fingerprint
        || result.source_context_fingerprint !== header.source_context_fingerprint
        || JSON.stringify(result.source_context_link) !== JSON.stringify(header.source_context_link)
        || result.context_issue !== header.context_issue || result.generation_id !== header.generation_id)
        invalid('report page snapshot');
}
/** One mounted document, sparse raw edits, no browser-persisted payloads. Nested use has no router blocker. */
export function useCOReportWorkspace(customerId: string, month: string, onAuthorityFailure?: (error: unknown) => void) {
    const actor = useCOActor(`report:${customerId}:${month}`);
    const rawSender = useCOTransactionSender({ formScope: `report:${month}`, customerId });
    const [authorityFailure, setAuthorityFailure] = useState<unknown>(null);
    const root = useCORead(actor, 'report', { customerId, month }, o => fetchCOReport(customerId, month, null, o), !authorityFailure);
    const [accepted, setAccepted] = useState<COReadResult | null>(null);
    const [editing, setEditing] = useState(false);
    const [entries, setEntries] = useState<Record<string, string>>({});
    const [meta, setMeta] = useState(metadata(null));
    const [baseMeta, setBaseMeta] = useState(metadata(null));
    const [page, setPage] = useState(1);
    const [pending, setPending] = useState(false);
    const [evidenceState,setEvidenceState] = useState({dirty:false,pending:false,unresolved:false});
    const [error, setError] = useState<unknown>(null);
    const [stale, setStale] = useState(false);
    const [confirmed, setConfirmed] = useState<COReceipt | null>(null);
    const [generation, setGeneration] = useState(0);
    const [focusTarget, setFocusTarget] = useState<string | null>(null);
    const rowPages = useRef(new Map<string, number>());
    const busy = useRef(false), generationRef = useRef(generation), denied = useRef(false);
    generationRef.current = generation;
    const latest = useRef({ entries, meta });
    latest.current = { entries, meta };
    if (isCOAuthorityError(root.error))
        denied.current = true;
    if (root.isSuccess && !root.isFetching && !authorityFailure)
        denied.current = false;
    const accepting = useRef(false);
    function clearPrivate() {
        rowPages.current.clear();
        latest.current = { entries: {}, meta: metadata(null) };
        setFocusTarget(null);
        setEvidenceState({dirty:false,pending:false,unresolved:false});
        setError(null);
        setStale(false);
        setAccepted(null);
        setEntries({});
        setMeta(metadata(null));
        setBaseMeta(metadata(null));
        setEditing(false);
        setConfirmed(null);
        setPending(false);
        generationRef.current++;
        setGeneration(generationRef.current);
    }
    function handleFailure(failure: unknown, isCurrent = actor.isCurrent) {
        if (!isCurrent()) return;
        if (!isCOAuthorityError(failure)) {
            if (!denied.current) setError(failure);
            return;
        }
        // All authority sources share one immediate latch, including imperative RPCs.
        denied.current = true;
        setAuthorityFailure(failure);
        clearPrivate();
        const queryKey = coKeys.identity(actor.identity);
        void actor.client.cancelQueries({ queryKey });
        actor.client.removeQueries({ queryKey });
        onAuthorityFailure?.(failure);
    }
    async function withAuthority<T>(action: () => Promise<T>, isCurrent?: () => boolean): Promise<T> {
        const g = generationRef.current;
        const live = isCurrent ?? (() => actor.isCurrent() && generationRef.current === g);
        try {
            return await action();
        } catch (failure) {
            if (isCOAuthorityError(failure)) handleFailure(failure, live);
            throw failure;
        }
    }
    const sender: COTransactionSender = Object.assign(
        (operation: Parameters<COTransactionSender>[0], payload: unknown) =>
            withAuthority(() => rawSender(operation, payload)),
        {
            hasUnresolved: rawSender.hasUnresolved,
            reconcile: () => withAuthority(() => rawSender.reconcile()),
            acknowledgeRecovered: (live?: () => boolean) => withAuthority(() => rawSender.acknowledgeRecovered(live)),
            getCommittedIdentity: rawSender.getCommittedIdentity,
        },
    );
    useEffect(() => {
        if (isCOAuthorityError(root.error)) handleFailure(root.error);
    }, [root.error, actor.scope]);
    const header = (editing ? accepted?.draft : accepted?.effective ?? accepted?.draft) as COReportHeader | null;
    const dirty = Object.keys(entries).length > 0 || JSON.stringify(meta) !== JSON.stringify(baseMeta) || evidenceState.dirty;
    const current = () => actor.isCurrent() && !denied.current && !authorityFailure;
    function hydrate(value: COReadResult, edit = !!value.draft && !value.effective, clear = false) {
        setAccepted(value);
        setEditing(edit);
        const h = edit ? value.draft : value.effective ?? value.draft;
        if (clear) {
            setEntries({});
            setMeta(metadata(h));
            setBaseMeta(metadata(h));
            setGeneration(g => g + 1);
            setPage(1);
        }
        setStale(false);
        setConfirmed(null);
        actor.client.setQueryData(coKeys.read(actor.identity, 'report', { customerId, month }), value);
    }
    useEffect(() => { if (!accepted && root.data && current())
        hydrate(root.data, !!root.data.draft && !root.data.effective, true); }, [root.data, accepted, actor.scope]);
    const snapshotBinding = (value: COReadResult) => JSON.stringify([value.customer_version,value.generation_id,...[value.draft,value.effective].map(h=>h ? [h.draft_id,h.draft_version,h.revision_id,h.report_version,h.row_count,h.eligible_set_fingerprint,h.source_context_fingerprint,h.source_context_link,h.context_issue,h.consumed,h.coverage_through_date,h.is_partial_month] : null)]);
    const drift = !!(accepted && root.data && snapshotBinding(accepted)!==snapshotBinding(root.data));
    const evidenceBlocked = !current() || pending || busy.current || root.isFetching || root.isError || stale || drift || sender.hasUnresolved() || !!confirmed;
    const frozen = evidenceBlocked || evidenceState.pending || evidenceState.unresolved || evidenceState.dirty;
    const rowsRead = useCORead(actor, 'report-rows', { customerId, month, view: editing ? 'draft' : 'effective', version: header?.draft_version, revision: header?.revision_id, cv: accepted?.customer_version, page }, async (o) => {
        const result = await fetchCOReportRows({ p_customer_id: customerId, p_month: month, p_view: editing ? 'draft' : 'effective', p_expected_draft_version: editing ? header!.draft_version : null, p_expected_customer_version: accepted!.customer_version, p_page: page, p_page_size: 100 }, o);
        validateReportPage(result, header!, editing);
        return result;
    }, !!header && !denied.current && !authorityFailure);
    if (isCOAuthorityError(rowsRead.error))
        denied.current = true;
    useEffect(() => {
        if (isCOAuthorityError(rowsRead.error)) handleFailure(rowsRead.error);
    }, [rowsRead.error, actor.scope]);
    const rows = (rowsRead.data?.rows ?? []) as COReportRow[];
    rows.forEach(row => rowPages.current.set(row.stock_key_id, page));
    useEffect(() => { if (!focusTarget || pending || rowsRead.isFetching)
        return; const input = document.getElementById(`co-sold-${focusTarget}`); if (input) {
        input.focus();
        setFocusTarget(null);
    } }, [focusTarget, pending, rowsRead.data, rowsRead.isFetching]);
    function editRow(row: COReportRow, raw: string) { if (busy.current || frozen || rowsRead.isError || rowsRead.isFetching || !editing)
        return; setEntries(old => { const next = { ...old }; if (raw === (row.sold_quantity ?? ''))
        delete next[row.stock_key_id];
    else
        next[row.stock_key_id] = raw; return next; }); }
    function editMeta(key: keyof typeof meta, value: string) { if (!busy.current && !frozen && !rowsRead.isError && !rowsRead.isFetching && editing)
        setMeta(old => ({ ...old, [key]: value })); }
    async function readCanonical(receipt?: COReceipt, options: COReadOptions = { isCurrent: current }) {
        const value = await withAuthority(() => fetchCOReport(customerId, month, null, options), options.isCurrent);
        if (receipt && (receipt.customer_id !== customerId || !['save_report_draft', 'post_report', 'correct_report'].includes(receipt.operation) || (receipt.operation === 'save_report_draft' ? value.draft?.draft_id !== receipt.id : value.effective?.report_head_id !== receipt.id)))
            throw new Error('Hasil tersimpan tidak sesuai pelanggan/periode ini.');
        return value;
    }
    async function run<T>(action: (isCurrent: () => boolean) => Promise<T>, allowStale = false): Promise<T | undefined> {
        if (busy.current || !current() || evidenceState.dirty || evidenceState.pending || evidenceState.unresolved || sender.hasUnresolved() || confirmed || (!allowStale && (root.isFetching || root.isError || rowsRead.isError || rowsRead.isFetching || stale || drift)))
            return;
        busy.current = true;
        setPending(true);
        setError(null);
        const g = generationRef.current;
        const live = () => current() && generationRef.current === g;
        try {
            return await action(live);
        }
        catch (e) {
            if (live()) {
                handleFailure(e, live);
                if ((e as { code?: string }).code === 'PT409') setStale(true);
            }
            throw e;
        }
        finally {
            busy.current = false;
            if (current())
                setPending(false);
        }
    }
    async function initialize(context?: COSourceContext) {
        return run(async (live) => {
            const fresh = await readCanonical(undefined, { isCurrent: live });
            const d = fresh.draft as COReportHeader | null;
            const payload: COSaveReportDraftPayload = { action: 'initialize', customer_id: customerId, report_month: month, expected_customer_version: fresh.customer_version, ...(d ? { draft_id: d.draft_id!, expected_draft_version: d.draft_version! } : {}), ...(context ? { source_context: context } : {}) } as COSaveReportDraftPayload;
            const receipt = await sendCOCommand(sender, 'save_report_draft', payload);
            if (!live())
                return;
            setConfirmed(receipt);
            const value = await readCanonical(receipt, { isCurrent: live });
            if (!live())
                return;
            // Refresh never drops local quantities or metadata. Saving them is a separate deliberate step.
            hydrate(value, true);
            const nextMeta=metadata(value.draft);
            if (JSON.stringify(latest.current.meta)===JSON.stringify(baseMeta)) setMeta(nextMeta);
            setBaseMeta(nextMeta);
            return value.draft as COReportHeader;
        }, true);
    }
    async function flushInside(live: () => boolean): Promise<COReportHeader> {
        if (!editing || !header)
            throw new Error('Siapkan draft terlebih dahulu.');
        let h = header;
        const values = Object.entries(latest.current.entries).map(([stock_key_id, raw]) => { try {
            return { stock_key_id, sold_quantity: raw === '' ? null : enteredQuantity(raw, true) };
        }
        catch (e) {
            setPage(rowPages.current.get(stock_key_id) ?? page);
            setFocusTarget(stock_key_id);
            throw e;
        } });
        for (let i = 0; i < values.length; i += 500) {
            const chunk = values.slice(i, i + 500);
            const receipt = await sendCOCommand(sender, 'save_report_draft', { action: 'upsert_lines', ...reportBinding(h), lines: chunk });
            if (!live())
                throw new Error('Editor berubah.');
            setConfirmed(receipt);
            // Each acknowledged chunk advances only its saved baseline; later failures retain remaining input.
            setEntries(old => { const next = { ...old }; for (const r of chunk)
                delete next[r.stock_key_id]; return next; });
            h = { ...h, draft_version: receipt.version };
            setAccepted(old => old ? { ...old, draft: h } : old);
            const value = await readCanonical(receipt, { isCurrent: live });
            if (!live())
                throw new Error('Editor berubah.');
            h = value.draft;
            hydrate(value, true);
        }
        if (JSON.stringify(latest.current.meta) !== JSON.stringify(baseMeta)) {
            const m = latest.current.meta;
            const receipt = await sendCOCommand(sender, 'save_report_draft', { action: 'set_metadata', draft_id: h.draft_id!, expected_draft_version: h.draft_version!, expected_customer_version: h.customer_version, report_reference: m.report_reference || null, received_date: m.received_date || null, notes: m.notes || null });
            if (!live())
                throw new Error('Editor berubah.');
            setConfirmed(receipt);
            setBaseMeta(m);
            const value = await readCanonical(receipt, { isCurrent: live });
            if (!live())
                throw new Error('Editor berubah.');
            h = value.draft;
            hydrate(value, true);
        }
        return h;
    }
    const save = () => run(flushInside);
    const fillZero = () => run(async (live) => { const h = await flushInside(live); const receipt = await sendCOCommand(sender, 'save_report_draft', { action: 'fill_remaining_zero', ...reportBinding(h) }); if (!live())
        return; setConfirmed(receipt); const value = await readCanonical(receipt, { isCurrent: live }); if (live())
        hydrate(value, true); return value.draft as COReportHeader; });
    async function acceptCanonical(receipt: COReceipt, recovered = false) {
        if (accepting.current || !current()) return false;
        const g = generationRef.current;
        const live = () => current() && generationRef.current === g;
        accepting.current = true;
        setPending(true);
        setError(null);
        try {
            const value = await readCanonical(receipt, { isCurrent: live });
            if (!live()) return false;
            if (recovered) await sender.acknowledgeRecovered();
            if (!live()) return false;
            hydrate(value, receipt.operation === 'save_report_draft',
                recovered || receipt.operation !== 'save_report_draft');
            return true;
        } catch (failure) {
            handleFailure(failure, live);
            throw failure;
        } finally {
            accepting.current = false;
            if (current()) setPending(false);
        }
    }
    /** Registration does not advance a draft. Verify current state without importing over local edits. */
    async function verifyRegisteredEvidence(binding: EvidenceDraftBinding,
        confirm: (isCurrent: () => boolean) => Promise<void>): Promise<boolean> {
        if (busy.current || accepting.current || !current() || !accepted?.draft || sender.hasUnresolved() || confirmed) return false;
        const g = generationRef.current, old = accepted;
        const live = () => current() && generationRef.current === g;
        if (binding.generation !== g || binding.customerId !== customerId || binding.month !== month
            || binding.draftId !== old.draft!.draft_id) throw new Error('Editor lampiran berubah.');
        busy.current = true; accepting.current = true; setPending(true);
        try {
            const fresh = await readCanonical(undefined, { isCurrent: live });
            if (!live()) return false;
            if (!fresh.draft || fresh.draft.draft_id !== binding.draftId || fresh.draft.draft_version !== binding.previousDraftVersion
                || fresh.customer_version !== binding.customerVersion || fresh.generation_id !== old.generation_id
                || JSON.stringify(fresh.draft) !== JSON.stringify(old.draft) || JSON.stringify(fresh.effective) !== JSON.stringify(old.effective)) {
                setStale(true);
                throw new Error('Versi draft lampiran berubah.');
            }
            await confirm(live);
            return live();
        } catch (failure) { handleFailure(failure, live); throw failure; }
        finally { busy.current = false; accepting.current = false; if (live()) setPending(false); }
    }
    /** Explicit discard only: never preserve an old overlay over a later report edit. */
    async function discardOverlayAfterEvidenceConflict(binding: EvidenceDraftBinding, confirm: (fresh:COReadResult,isCurrent:()=>boolean)=>Promise<void>, minimumDraftAdvance = 1n):Promise<boolean> {
        if (busy.current || accepting.current || !current() || !accepted?.draft || sender.hasUnresolved() || confirmed) return false;
        const g=generationRef.current, live=()=>current() && generationRef.current===g;
        if(binding.customerId!==customerId || binding.month!==month || binding.generation!==g || binding.draftId!==accepted.draft.draft_id)
            throw new Error('Editor lampiran berubah.');
        busy.current=true;accepting.current=true;setPending(true);setError(null);
        try {
            const fresh=await readCanonical(undefined,{isCurrent:live});
            if(!live())return false;
            const next=fresh.draft;
            if(fresh.customer_id!==customerId || fresh.report_month!==month || !next || next.draft_id!==binding.draftId
                || BigInt(next.draft_version!)<BigInt(binding.previousDraftVersion)+minimumDraftAdvance
                || BigInt(fresh.customer_version)<BigInt(binding.customerVersion))
                throw new Error('Hasil laporan terkini tidak sesuai lampiran tersimpan.');
            const editNext = !next.consumed;
            const nextHeader = (editNext ? next : fresh.effective ?? next) as COReportHeader;
            let firstPage: COReadResult | undefined;
            // Discard must not consume recovery before every canonical row has been checked.
            await completeCORead(async page => {
                const rows = await withAuthority(() => fetchCOReportRows({ p_customer_id: customerId, p_month: month,
                    p_view: editNext ? 'draft' : 'effective', p_expected_draft_version: editNext ? nextHeader.draft_version : null,
                    p_expected_customer_version: fresh.customer_version, p_page: page, p_page_size: 100 }, { isCurrent: live }), live);
                validateReportPage(rows, nextHeader, editNext);
                if (page === 1) firstPage = rows;
                return rows;
            });
            if (!live()) return false;
            await confirm(fresh,live); // Validate the original evidence/receipt and await pinned recovery acknowledgement.
            if(!live())return false;
            rowPages.current.clear();
            actor.client.setQueryData(coKeys.read(actor.identity, 'report-rows', { customerId, month,
                view: editNext ? 'draft' : 'effective', version: nextHeader.draft_version, revision: nextHeader.revision_id,
                cv: fresh.customer_version, page: 1 }), firstPage);
            hydrate(fresh,editNext,true); // User explicitly discarded edits; replace both overlay and saved baseline.
            return true;
        } catch(failure) {handleFailure(failure,live);throw failure;}
        finally {busy.current=false;accepting.current=false;if(live())setPending(false);}
    }
    async function rebindDraftAfterEvidence(binding: EvidenceDraftBinding, confirm: (fresh:COReadResult,isCurrent:()=>boolean)=>Promise<void>):Promise<boolean> {
        if (busy.current || accepting.current || !current() || !accepted?.draft || sender.hasUnresolved() || confirmed) return false;
        const g=generationRef.current, old=accepted, d=old.draft!;
        const finalVersion=(BigInt(binding.previousDraftVersion)+1n).toString();
        const live=()=>current() && generationRef.current===g;
        if(binding.customerId!==customerId||binding.month!==month||binding.generation!==g||binding.draftId!==d.draft_id||binding.customerVersion!==old.customer_version||![binding.previousDraftVersion,finalVersion].includes(d.draft_version!)) throw new Error('Evidence binding changed; refresh explicitly.');
        busy.current=true;accepting.current=true;setPending(true);setError(null);
        try {
            const fresh=await readCanonical(undefined,{isCurrent:live});
            if(!live())return false;
            const next=fresh.draft;
            // Finalization changes only the draft version. No concurrent row/metadata/source edit is imported.
            const unchanged=(h:COReportHeader)=>JSON.stringify({...h,draft_version:null});
            if(!next||next.draft_id!==binding.draftId||next.draft_version!==finalVersion||fresh.customer_id!==customerId||fresh.report_month!==month||fresh.customer_version!==binding.customerVersion||fresh.generation_id!==old.generation_id||next.consumed||next.context_issue||unchanged(next)!==unchanged(d)||JSON.stringify(fresh.effective)!==JSON.stringify(old.effective)) {
                setStale(true);throw new Error('CO evidence draft changed; refresh and review explicitly.');
            }
            await confirm(fresh,live);
            if(!live())return false;
            // Only this exact version-only transition proves the displayed rows unchanged.
            // Seed that same page so changing its version key does not unmount raw inputs.
            if (editing && rowsRead.data && rowsRead.data.draft_id===binding.draftId
                && [binding.previousDraftVersion,finalVersion].includes(String(rowsRead.data.draft_version))) {
                actor.client.setQueryData(coKeys.read(actor.identity,'report-rows',{
                    customerId,month,view:'draft',version:finalVersion,revision:next.revision_id,
                    cv:fresh.customer_version,page,
                }),{...rowsRead.data,draft_version:finalVersion});
            }
            hydrate(fresh,editing,false); // Keep entries, metadata, saved baseline, page and edit mode.
            return true;
        } catch(failure) {handleFailure(failure,live);throw failure;}
        finally {busy.current=false;accepting.current=false;if(live())setPending(false);}
    }
    return {
        actor, sender, root,
        authorityError: authorityFailure ?? (isCOAuthorityError(rowsRead.error) ? rowsRead.error : root.error),
        retryAuthority: () => {
            denied.current = false;
            setAuthorityFailure(null);
            void root.refetch();
        },
        accepted, header, editing, entries, meta, page, setPage, pending, evidenceState, setEvidenceState, evidenceBlocked, verifyRegisteredEvidence, rebindDraftAfterEvidence, discardOverlayAfterEvidenceConflict,
        frozen: frozen || rowsRead.isError || rowsRead.isFetching,
        dirty, error, setError: handleFailure, stale: stale || drift,
        confirmed, setConfirmed, generation,
        isGenerationCurrent: (g: number) => current() && generationRef.current === g,
        current, denied: denied.current || !!authorityFailure,
        rowsRead, rows, editRow, editMeta, initialize, save, fillZero, run, acceptCanonical,
    };
}
export type COReportWorkspace = ReturnType<typeof useCOReportWorkspace>;
export function COReportFields({ work, allocation }: {
    work: COReportWorkspace;
    allocation?: (row: COReportRow) => React.ReactNode;
}) {
    return <div className="space-y-4">{work.root.isError && <COFailure error={work.root.error} retry={() => void work.root.refetch()}/>}<fieldset disabled={work.frozen || !work.editing} className="grid gap-3 sm:grid-cols-2">{(['report_reference', 'received_date', 'notes'] as const).map(k => <label key={k} className="text-sm">{{ report_reference: 'Referensi laporan', received_date: 'Tanggal diterima', notes: 'Catatan laporan' }[k]}<input className={CO_INPUT} type={k === 'received_date' ? 'date' : 'text'} aria-label={{ report_reference: 'Referensi laporan', received_date: 'Tanggal diterima', notes: 'Catatan laporan' }[k]} value={work.meta[k]} onChange={e => work.editMeta(k, e.target.value)}/></label>)}</fieldset>
    {work.rowsRead.isError && <COFailure error={work.rowsRead.error} retry={() => void work.rowsRead.refetch()}/>} {work.rowsRead.data ? <COMonthlySalesGrid rows={work.rows} entries={work.entries} editable={work.editing} disabled={work.frozen || work.rowsRead.isFetching} onChange={work.editRow} page={work.page} total={work.header!.row_count} onPage={work.setPage} allocation={allocation}/> : !work.rowsRead.isError && <p role="status">Memuat baris laporan…</p>}
    {work.header && <p className="text-sm">{work.header.entered_count} dari {work.header.row_count} baris tersimpan terisi · {work.header.missing_count} belum diisi</p>}{work.error && <COFailure error={work.error}/>} {work.stale && <p role="alert">Versi atau sumber berubah. Isian tetap disimpan di editor; perbarui sumber dan tinjau kembali.</p>}</div>;
}
