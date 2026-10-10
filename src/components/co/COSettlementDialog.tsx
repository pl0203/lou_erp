import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { COConflictError, fetchCODetail, fetchCompleteCOLines } from '../../lib/co/rpc';
import type { COOrderRecord } from '../../lib/co/validation';
import type { COReceipt } from '../../lib/co/contracts';
import { useCOTransactionSender } from '../../lib/co/transactions';
import { isCOAuthorityError } from './COReportWorkspace';
import ReturnedDateDialog from '../ReturnedDateDialog';
import { CO_BUTTON, CO_INPUT, CO_PRIMARY, COFailure, CORecoveryPanel, enteredQuantity, useCOActor, useCORead } from './COShared';

export default function COSettlementDialog({ co, operation, blocked, readFailure, returnFocus, onClose, onSaved, onAuthorityFailure }: {
    co: COOrderRecord;
    operation: 'resolve_undelivered' | 'close_co' | 'recovery';
    blocked: boolean;
    readFailure?: ReactNode;
    returnFocus: HTMLElement | null;
    onClose: () => void;
    onSaved: () => void;
    onAuthorityFailure: (error: unknown) => void;
}) {
    const actor = useCOActor(`settlement:${co.id}:${operation}`);
    const rawSender = useCOTransactionSender({ formScope: `settlement:${co.id}`, customerId: co.customer_id, coId: co.id, retainCommitted: true });
    const [reason, setReason] = useState('');
    const [entries, setEntries] = useState<Record<string, string>>({});
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [confirmed, setConfirmed] = useState<COReceipt | null>(null);
    const [binding, setBinding] = useState(co);
    const [rechecked, setRechecked] = useState(true);
    const [stale, setStale] = useState(false);
    const [refreshEpoch, setRefreshEpoch] = useState(0);
    const [refreshReady, setRefreshReady] = useState(false);
    const busy = useRef(false), departed = useRef(false), generation = useRef(0);
    const current = () => actor.isCurrent() && !departed.current;
    const dirty = !!reason || Object.values(entries).some(Boolean);
    const unsaved = useUnsavedChanges(dirty);
    useBeforeSignOut(signal => unsaved.confirmDiscardDecision({ signal }), actor.scope);
    function failure(value: unknown) {
        if (!current()) return;
        if (isCOAuthorityError(value)) { departed.current = true; generation.current++; onAuthorityFailure(value); }
        else {
            setError(value);
            if ((value as { code?: string })?.code === 'PT409') {
                setStale(true); setRechecked(false); setRefreshReady(false);
            }
        }
    }
    async function protect<T>(fn: () => Promise<T>) {
        const g = generation.current;
        try { return await fn(); }
        catch (value) { if (current() && generation.current === g) failure(value); throw value; }
    }
    const sender = Object.assign((op: Parameters<typeof rawSender>[0], payload: unknown) => protect(() => rawSender(op, payload)), {
        hasUnresolved: rawSender.hasUnresolved, reconcile: () => protect(rawSender.reconcile), acknowledgeRecovered: (live?: () => boolean) => protect(() => rawSender.acknowledgeRecovered(live)), getCommittedIdentity: rawSender.getCommittedIdentity,
    });
    const read = useCORead(actor, 'settlement', { id: co.id, operation, version: binding.co_version, cv: binding.customer_version, refreshEpoch }, async options => {
        const detail = await fetchCODetail(co.id, binding.co_version, options);
        if (detail.co.customer_version !== binding.customer_version) throw new COConflictError();
        const lines = operation !== 'close_co' ? await fetchCompleteCOLines(co.id, binding.co_version, binding.customer_version, options) : [];
        return { detail, lines };
    });
    const retainedLines = useRef(read.data?.lines ?? []);
    if (read.data && !read.isError) retainedLines.current = read.data.lines;
    useEffect(() => { if (read.isError) failure(read.error); }, [read.error]);
    const allowed = operation !== 'recovery' && read.data?.detail.allowed_operations.includes(operation);
    const blockers = read.data?.detail.close_blockers;
    const closeBlocked = operation === 'close_co' && (!blockers || blockers.stock_remains || blockers.undelivered_remains || blockers.missing_month_count !== '0');
    const parentStale = BigInt(co.co_version) > BigInt(binding.co_version) || BigInt(co.customer_version) > BigInt(binding.customer_version);
    const locked = stale || parentStale || pending || blocked || read.isFetching || read.isError || !read.data || !allowed || closeBlocked || !rechecked || sender.hasUnresolved() || !!confirmed;
    function originalSettlement(receipt: COReceipt) {
        const identity = sender.getCommittedIdentity(receipt);
        if (!['resolve_undelivered', 'close_co'].includes(receipt.operation) || receipt.customer_id !== co.customer_id || receipt.id !== co.id
            || identity.operation !== receipt.operation || identity.co_id !== co.id || identity.target_id !== co.id)
            throw new Error('Identitas hasil penyelesaian asli tidak sesuai.');
    }
    async function accept(receipt: COReceipt) {
        const g = generation.current;
        const live = () => current() && generation.current === g;
        if (!live() || blocked) return false;
        originalSettlement(receipt);
        const result = await protect(() => fetchCODetail(co.id, receipt.version, { isCurrent: live }));
        if (result.co.customer_version !== receipt.customer_version || receipt.operation === 'close_co' && result.co.status !== 'closed') throw new Error('Hasil kanonis CO belum sesuai.');
        await protect(() => fetchCompleteCOLines(co.id, receipt.version, receipt.customer_version, { isCurrent: live }));
        if (!live()) return false;
        await sender.acknowledgeRecovered(live);
        if (!live()) return false;
        departed.current = true;
        unsaved.runWithoutPrompt(() => { onSaved(); onClose(); });
        return true;
    }
    async function recover(receipt: COReceipt) {
        if (busy.current || blocked || pending || !current()) return false;
        const g = generation.current;
        const ok = await unsaved.confirmDiscardDecision({ message: 'Buang isian penyelesaian dan buka hasil tersimpan?' });
        if (!ok || !current() || generation.current !== g) return false;
        busy.current = true; setPending(true);
        try { setConfirmed(receipt); return await accept(receipt); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    async function submit() {
        if (operation === 'recovery' || busy.current || locked || !reason.trim() || !current()) return;
        busy.current = true; setPending(true); setError(null);
        const g = generation.current;
        try {
            const lines = Object.entries(entries).filter(([, raw]) => raw !== '').map(([co_line_id, raw]) => {
                const quantity = enteredQuantity(raw);
                const row = read.data!.lines.find(line => line.id === co_line_id);
                if (!row || BigInt(quantity) > BigInt(row.pending_quantity)) throw new Error('Jumlah tambahan melebihi sisa belum dikirim.');
                return { co_line_id, quantity };
            });
            if (operation === 'resolve_undelivered' && !lines.length) throw new Error('Isi jumlah pembatalan tambahan yang positif.');
            const receipt = await sender(operation, { co_id: co.id, expected_co_version: binding.co_version,
                expected_customer_version: binding.customer_version, reason: reason.trim(), ...(operation === 'resolve_undelivered' ? { lines } : {}) });
            if (!current() || generation.current !== g) return;
            setConfirmed(receipt);
            await accept(receipt);
        } catch (value) { if (current() && generation.current === g) failure(value); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    async function resolveCommittedConflict() {
        if (!confirmed || busy.current || pending || blocked || !current()) return;
        const receipt = confirmed, g = generation.current;
        const live = () => current() && generation.current === g;
        const discard = await unsaved.confirmDiscardDecision({ message: 'Buang isian penyelesaian yang belum disimpan, akui tanda terima asli, dan buka CO terkini untuk ditinjau?' });
        if (!discard || !live()) return;
        busy.current = true; setPending(true); setError(null);
        try {
            originalSettlement(receipt);
            const result = await protect(() => fetchCODetail(co.id, null, { isCurrent: live }));
            const next = result.co;
            if (BigInt(next.co_version) < BigInt(receipt.version) || BigInt(next.customer_version) < BigInt(receipt.customer_version))
                throw new Error('CO terkini mendahului tanda terima asli.');
            const lines = await protect(() => fetchCompleteCOLines(co.id, next.co_version, next.customer_version, { isCurrent: live }));
            if (!live()) return;
            await sender.acknowledgeRecovered(live);
            if (!live()) return;
            if (operation === 'recovery' || operation !== receipt.operation) {
                departed.current = true;
                unsaved.runWithoutPrompt(() => { onSaved(); onClose(); });
                return;
            }
            generation.current++;
            retainedLines.current = lines;
            setBinding(next); setRefreshEpoch(value => value + 1); setReason(''); setEntries({});
            setConfirmed(null); setStale(false); setRechecked(false); setRefreshReady(true); setError(null);
            onSaved();
        } catch (value) { if (live()) failure(value); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    async function refresh() {
        if (busy.current || pending || blocked || !current() || confirmed || sender.hasUnresolved()) return;
        busy.current = true; setPending(true); setRefreshReady(false); setRechecked(false);
        const g = ++generation.current;
        try {
            const result = await protect(() => fetchCODetail(co.id, null, { isCurrent: () => current() && generation.current === g }));
            if (current() && generation.current === g) {
                setBinding(result.co); setRefreshEpoch(value => value + 1); setRefreshReady(true); setError(null);
            }
        } catch (value) { if (current() && generation.current === g) failure(value); }
        finally { busy.current = false; if (current()) setPending(false); }
    }
    const canRecheck = refreshReady && read.isSuccess && !read.isFetching && !pending && !blocked
        && !parentStale && !confirmed && !sender.hasUnresolved() && current();
    function recheck() {
        if (!canRecheck || busy.current) return;
        setStale(false); setRechecked(true); setRefreshReady(false);
    }
    const dismiss = () => { if (!pending) unsaved.confirmDiscard(() => { departed.current = true; generation.current++; onClose(); }); };
    const label = operation === 'close_co' ? 'penutupan' : 'penyelesaian';
    return <>{unsaved.dialog}<ReturnedDateDialog labelledBy="co-settlement-title" pending={pending} onClose={dismiss} returnFocus={returnFocus} fallbackFocus={() => null}>
        <div className="space-y-4">
            <h2 id="co-settlement-title" className="font-semibold">{operation === 'recovery' ? 'Pulihkan penyelesaian CO' : operation === 'close_co' ? 'Tutup CO' : 'Selesaikan sisa belum dikirim'}</h2>
            <p className="text-sm">{operation === 'recovery' ? 'Periksa hasil permintaan asli. Tindakan baru mengikuti izin CO terkini setelah pemulihan selesai.' : operation === 'close_co' ? 'Penutupan memerlukan stok nol, sisa rencana selesai dan laporan akhir bulan lengkap.' : 'Jumlah ini adalah tambahan pembatalan sisa rencana, bukan pengiriman atau retur. Tidak mengubah stok atau pendapatan.'}</p>
            {readFailure}{error && <COFailure error={error}/>}{read.isError && <COFailure error={read.error} retry={() => void read.refetch()}/>}
            <CORecoveryPanel sender={sender} current={() => current() && !pending && !blocked} accept={recover}/>
            {confirmed && <button className={CO_BUTTON} disabled={pending || blocked} onClick={() => {
                if (busy.current) return; busy.current = true; setPending(true);
                void accept(confirmed).catch(failure).finally(() => { busy.current = false; if (current()) setPending(false); });
            }}>Buka hasil penyelesaian tersimpan</button>}
            {confirmed && <div><p className="text-sm">Sumber terkini dapat berbeda dari tanda terima asli. Periksa keadaan terkini sebelum tindakan berikutnya.</p>
                <button className={CO_BUTTON} disabled={pending || blocked} onClick={() => void resolveCommittedConflict()}>Selesaikan konflik penyelesaian</button></div>}
            {operation !== 'recovery' && <><button className={CO_BUTTON} disabled={pending || blocked || !!confirmed || sender.hasUnresolved()} onClick={() => void refresh()}>Muat sumber penyelesaian terbaru</button>
            {!rechecked && refreshReady && <button className={CO_BUTTON} disabled={!canRecheck} onClick={recheck}>Saya sudah memeriksa sisa terbaru</button>}
            <fieldset disabled={locked} className="space-y-3">
                {retainedLines.current.map(line => <label key={line.id} className="block text-sm">{line.product_name} · sisa {line.pending_quantity}
                    <input aria-label={`Jumlah dibatalkan ${line.product_name}`} inputMode="numeric" className={CO_INPUT} value={entries[line.id] ?? ''}
                        onChange={e => { generation.current++; setEntries(old => ({ ...old, [line.id]: e.target.value })); }}/>
                </label>)}
                <label className="block">Alasan {label}<textarea aria-label={`Alasan ${label}`} className={CO_INPUT} value={reason}
                    onChange={e => { generation.current++; setReason(e.target.value); }}/></label>
            </fieldset></>}
            {(stale || parentStale) && <p role="alert">Versi CO berubah. Isian dipertahankan; muat sumber penyelesaian terbaru.</p>}
            {closeBlocked && <p role="alert">CO belum memenuhi seluruh syarat penutupan.</p>}
            <div className="flex flex-wrap gap-2">
                <button className={CO_BUTTON} disabled={pending} onClick={dismiss}>Batal</button>
                {operation !== 'recovery' && <button className={CO_PRIMARY} disabled={locked || !reason.trim()} onClick={() => void submit()}>Konfirmasi {label}</button>}
            </div>
        </div>
    </ReturnedDateDialog></>;
}
