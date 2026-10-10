import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import ReturnedDateDialog from '../ReturnedDateDialog';
import COCorrectionDialog from './COCorrectionDialog';
import COSourceBoundary from './COSourceBoundary';
import { completeCORead, fetchCompleteCOLines, fetchCompleteCOSJDraft, fetchCODetail, fetchCODetailSection } from '../../lib/co/rpc';
import type { COOrderRecord, COOrderLine, CODeliveryRevision } from '../../lib/co/validation';
import { useCOTransactionSender } from '../../lib/co/transactions';
import type { COReceipt } from '../../lib/co/contracts';
import { CO_BUTTON, CO_INPUT, CO_PRIMARY, COFailure, CORecoveryPanel, enteredQuantity, useCOActor, useCORead } from './COShared';
type SJInput = {
    id: string;
    name: string;
    sku: string;
    quantity: string;
    pending: string;
    available: boolean;
};
export type CODeliveryCorrectionSelection = { headId: string; revisionId: string; version: string; action: 'replace' | 'void' };
const sjSnapshot = (number: string, date: string, received: string, notes: string, rows: SJInput[]) => JSON.stringify([number, date, received, notes, rows]);
type CODeliveryDialogProps = {
    co: COOrderRecord;
    draftId?: string;
    correctionSource?: CODeliveryCorrectionSelection;
    onClose: () => void;
    returnFocus: HTMLElement | null;
    onSaved?: () => void;
    readBlocked?: boolean;
    readFailure?: ReactNode;
    onAuthorityFailure?: (error: unknown) => void;
};
/** All ordinary and correction reads/commands belong to this source lifetime. */
export default function CODeliveryDialog(props: CODeliveryDialogProps) {
    return <COSourceBoundary source={`sj:${props.co.id}:${props.draftId ?? JSON.stringify(props.correctionSource) ?? 'new'}`}
        check={options => fetchCODetail(props.co.id, null, options)} onAuthorityFailure={props.onAuthorityFailure}>
        {checked => <DeliveryEditor {...props} co={checked?.co ?? props.co}/>}
    </COSourceBoundary>;
}
function DeliveryEditor({ co, draftId, correctionSource, onClose, returnFocus, onSaved,
    readBlocked = false, readFailure, onAuthorityFailure }: CODeliveryDialogProps) {
    const actor = useCOActor(`sj:${co.id}:${draftId ?? JSON.stringify(correctionSource) ?? 'new'}`);
    const sender = useCOTransactionSender({ formScope: `sj:${co.id}`, customerId: co.customer_id, coId: co.id });
    const [number, setNumber] = useState('');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [received, setReceived] = useState('');
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<SJInput[]>([]);
    const [sources, setSources] = useState<COOrderLine[]>([]);
    const [stale, setStale] = useState(false);
    const [baseline, setBaseline] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [saved, setSaved] = useState<Record<string, any> | null>(null);
    const [binding, setBinding] = useState(co);
    const [pending, setPending] = useState(false);
    const [reviewing, setReviewing] = useState(false);
    const [reviewDirty, setReviewDirty] = useState(false);
    const [reviewPending,setReviewPending]=useState(false);
    const [error, setError] = useState('');
    const [generation, setGeneration] = useState(0);
    const [allowed, setAllowed] = useState<string[]>([]);
    const [confirmed, setConfirmed] = useState<COReceipt | null>(null);
    const busy = useRef(false);
    const accepted = useRef(false);
    const latest = useRef({ generation, number, date, received, notes, rows });
    latest.current = { generation, number, date, received, notes, rows };
    const dirty = loaded && sjSnapshot(number, date, received, notes, rows) !== baseline;
    const unsaved = useUnsavedChanges(dirty || reviewDirty);
    useBeforeSignOut(signal => unsaved.confirmDiscardDecision({ signal }), `${actor.scope}:${generation}`);
    const read = useCORead(actor, 'sj-preparation', { co_id: co.id, co_version: binding.co_version, customer_version: binding.customer_version, draftId, correctionSource }, async (o) => {
        const detail = await fetchCODetail(co.id,binding.co_version,o);
        const lines = await fetchCompleteCOLines(co.id, binding.co_version, binding.customer_version, o);
        let original: CODeliveryRevision | null = null;
        let draft = draftId ? await fetchCompleteCOSJDraft(co.id, draftId, binding.co_version, binding.customer_version, o) : null;
        if (correctionSource && !draftId) {
            if (!detail.allowed_operations.includes('correct_sj')) throw new Error('Koreksi SJ tidak diizinkan.');
            const heads = await completeCORead(page=>fetchCODetailSection({p_co_id:co.id,p_section:'deliveries',p_parent_id:correctionSource.headId,p_expected_version:binding.co_version,p_expected_customer_version:binding.customer_version,p_page:page,p_page_size:100},o));
            original = (heads as CODeliveryRevision[]).find((r:CODeliveryRevision)=>r.id===correctionSource.revisionId&&r.head_id===correctionSource.headId&&r.current_revision_id===correctionSource.revisionId&&r.head_version===correctionSource.version&&r.is_effective) ?? null;
            if (!original || correctionSource.action==='void' && original.is_void) throw new Error('Revisi SJ berubah. Tutup dan pilih revisi efektif terbaru; isian tidak diterapkan.');
            const sourceLines = correctionSource.action==='replace' ? await completeCORead(page=>fetchCODetailSection({p_co_id:co.id,p_section:'delivery_lines',p_parent_id:original!.id,p_expected_version:binding.co_version,p_expected_customer_version:binding.customer_version,p_page:page,p_page_size:100},o)) : [];
            if(correctionSource.action==='replace'&&String(sourceLines.length)!==original.line_count)throw new Error('Bukti baris SJ belum lengkap.');
            draft = {header: {sj_number:original.sj_number,sj_date:original.sj_date,received_date:original.received_date,notes:original.notes},lines:sourceLines.map(l=>({...l,source_available:lines.some(source=>source.id===l.co_line_id)}))};
        }
        return { lines, detail, draft, original };
    });
    function restore(header: Record<string, any> | null, lines: Record<string, any>[], draftLines?: Record<string, any>[]) {
        const next = (draftLines ?? lines).map(l => { const source = lines.find(s => s.id === (l.co_line_id ?? l.id)); return { id: l.co_line_id ?? l.id, name: l.product_name ?? source?.product_name ?? 'Sumber tidak tersedia', sku: l.display_sku ?? source?.display_sku ?? '', quantity: draftLines ? l.quantity : '0', pending: source?.pending_quantity ?? '0', available: draftLines ? l.source_available : true }; });
        const n = header?.sj_number ?? '';
        const d = header?.sj_date ?? new Date().toISOString().slice(0, 10);
        const r = header?.received_date ?? '';
        const nt = header?.notes ?? '';
        setSources(lines as COOrderLine[]);
        setRows(next);
        setNumber(n);
        setDate(d);
        setReceived(r);
        setNotes(nt);
        setSaved(header?.draft_version ? header : null);
        setStale(false);
        setBaseline(sjSnapshot(n, d, r, nt, next));
        setLoaded(true);
    }
    useEffect(() => { if (!loaded && read.data && actor.isCurrent())
        { restore(read.data.draft?.header ?? null, read.data.lines, read.data.draft?.lines); if(correctionSource?.action==='void')setReviewing(true); } }, [read.data, loaded, actor]);
    useEffect(()=>{if(read.data&&actor.isCurrent())setAllowed(read.data.detail.allowed_operations)},[read.data,actor]);
    const correction = saved?.mode === 'delivery_correction' || !!correctionSource;
    const original = read.data?.original;
    const sourceTarget = saved?.mode === 'delivery_correction' ? { delivery_head_id: saved.bound_delivery_head_id, original_revision_id: saved.bound_delivery_revision_id, expected_delivery_version: saved.bound_delivery_version } : original ? { delivery_head_id: original.head_id, original_revision_id: original.id, expected_delivery_version: original.head_version } : null;
    const voiding = correctionSource?.action === 'void';
    const unavailable = rows.some(r => !r.available);
    const blocked = readBlocked || sender.hasUnresolved() || confirmed !== null;
    const dataReady = loaded && !stale && !read.isFetching && !read.isError && actor.isCurrent();
    function dismiss() { if (pending || reviewPending)
        return; unsaved.confirmDiscard(onClose); }
    async function refreshSources() {
        if (busy.current || blocked || !actor.isCurrent()) return;
        const g = generation;
        const isCurrent = () => actor.isCurrent() && latest.current.generation === g;
        busy.current = true; setPending(true); setError('');
        try {
            // A failed old binding cannot be fixed by fetching old-version pages first.
            const fresh = await fetchCODetail(co.id, null, { isCurrent });
            const current = fresh.co as COOrderRecord;
            const lines = await fetchCompleteCOLines(co.id, current.co_version, current.customer_version, { isCurrent });
            if (correctionSource && !saved) {
                const heads = await completeCORead(page=>fetchCODetailSection({p_co_id:co.id,p_section:'deliveries',p_parent_id:correctionSource.headId,p_expected_version:current.co_version,p_expected_customer_version:current.customer_version,p_page:page,p_page_size:100},{isCurrent}));
                if(!heads.some((r:CODeliveryRevision)=>r.id===correctionSource.revisionId&&r.current_revision_id===correctionSource.revisionId&&r.head_version===correctionSource.version&&r.is_effective))throw new Error('Revisi SJ berubah. Tutup dan pilih revisi efektif terbaru.');
            }
            if (saved) {
                const draft = await fetchCompleteCOSJDraft(co.id, saved.id, current.co_version, current.customer_version, { isCurrent });
                if (draft.header.draft_version !== saved.draft_version || draft.header.consumed)
                    throw new Error('Draft SJ berubah. Tutup dan buka kembali draft untuk memeriksa versi tersimpan.');
            }
            if (!isCurrent()) return;
            setBinding(current); setAllowed(fresh.allowed_operations); setSources(lines as COOrderLine[]);
            setRows(previous => previous.map(row => {
                const source = lines.find(line => line.id === row.id);
                return { ...row, pending: source?.pending_quantity ?? '0', available: !!source };
            }));
            // Explicit source review permits re-save, never Post with an old stored binding.
            setSaved(previous => previous ? { ...previous, bindings_current: false } : null);
            setStale(false); setGeneration(value => value + 1);
        } catch (e) { if (isCurrent()) { actor.rejectAuthority(e); setError((e as Error).message); } }
        finally { busy.current = false; if (actor.isCurrent()) setPending(false); }
    }
    async function prepareReceipt(receipt: COReceipt): Promise<() => void> {
        if (receipt.customer_id !== co.customer_id || !['save_sj_draft', 'post_sj', 'correct_sj'].includes(receipt.operation))
            throw new Error('Hasil pemulihan bukan SJ untuk pelanggan ini.');
        if (receipt.operation === 'correct_sj' && receipt.id !== sourceTarget?.delivery_head_id)
            throw new Error('Hasil koreksi tidak sesuai pengiriman asli.');
        const fresh = await fetchCODetail(co.id, null, { isCurrent: actor.isCurrent });
        const current = fresh.co as COOrderRecord;
        if (receipt.operation === 'save_sj_draft') {
            const draft = await fetchCompleteCOSJDraft(co.id, receipt.id, current.co_version, current.customer_version, { isCurrent: actor.isCurrent });
            const lines = await fetchCompleteCOLines(co.id, current.co_version, current.customer_version, { isCurrent: actor.isCurrent });
            return () => { setAllowed(fresh.allowed_operations);setBinding(current); restore(draft.header, lines, draft.lines); setGeneration(g => g + 1); setConfirmed(null); onSaved?.(); };
        }
        const canonical = await fetchCODetailSection({ p_co_id: co.id, p_section: 'deliveries', p_parent_id: receipt.id, p_expected_version: current.co_version, p_expected_customer_version: current.customer_version, p_page: 1, p_page_size: 20 }, { isCurrent: actor.isCurrent });
        if (!canonical.rows.some((r: Record<string, any>) => r.head_id === receipt.id))
            throw new Error('Pengiriman tersimpan belum dapat dibuka untuk CO ini.');
        return () => { setConfirmed(null); onSaved?.(); unsaved.runWithoutPrompt(onClose); };
    }
    async function importReceipt(receipt: COReceipt, g = generation) {
        const apply = await actor.protect(() => prepareReceipt(receipt), () => actor.isCurrent() && latest.current.generation === g);
        if (actor.isCurrent() && latest.current.generation === g) {
            apply();
            return true;
        }
        return false;
    }
    async function recovered(receipt: COReceipt) {
        if (accepted.current)
            return false;
        const g = generation;
        const ok = await unsaved.confirmDiscardDecision({ message: 'Permintaan SJ sebelumnya sudah tersimpan. Buang isian sekarang dan lihat hasil tersebut?' });
        if (!ok || !actor.isCurrent() || latest.current.generation !== g)
            return false;
        accepted.current = true;
        setPending(true);
        const acceptedWork = sjSnapshot(latest.current.number, latest.current.date, latest.current.received, latest.current.notes, latest.current.rows);
        try {
            const apply = await actor.protect(() => prepareReceipt(receipt), () => actor.isCurrent() && latest.current.generation === g);
            if (!actor.isCurrent() || latest.current.generation !== g || sjSnapshot(latest.current.number, latest.current.date, latest.current.received, latest.current.notes, latest.current.rows) !== acceptedWork)
                return false;
            await sender.acknowledgeRecovered();
            if (actor.isCurrent() && latest.current.generation === g) {
                apply();
                return true;
            }
            return false;
        }
        finally {
            accepted.current = false;
            if (actor.isCurrent())
                setPending(false);
        }
    }
    async function execute(post: boolean) {
        if (busy.current || !dataReady || blocked || unavailable || !allowed.includes(post?'post_sj':correction?'correct_sj':'save_sj_draft'))
            return;
        const g = generation;
        busy.current = true;
        setPending(true);
        setError('');
        try {
            if (post) {
                if (correction || !saved || dirty || !saved.bindings_current || !saved.preparation_ready || saved.consumed)
                    throw new Error('Periksa dan simpan draft dengan versi terbaru sebelum Post.');
                const receipt = await sender('post_sj', { draft_id: saved.id, expected_draft_version: saved.draft_version, expected_co_version: binding.co_version, expected_customer_version: binding.customer_version });
                if (actor.isCurrent() && latest.current.generation === g) {
                    setConfirmed(receipt);
                    await importReceipt(receipt, g);
                }
            }
            else {
                if (correction && !sourceTarget) throw new Error('Sumber koreksi SJ belum terverifikasi.');
                if (!number.trim())
                    throw new Error('Nomor SJ wajib diisi.');
                const selected = rows.map(row => ({ co_line_id: row.id, quantity: enteredQuantity(row.quantity, true) })).filter(row => row.quantity > 0);
                if (!selected.length)
                    throw new Error('Isi minimal satu jumlah dikirim positif.');
                for (const row of selected) {
                    const source = rows.find(r => r.id === row.co_line_id)!;
                    if (!correction && BigInt(row.quantity) > BigInt(source.pending))
                        throw new Error('Jumlah dikirim melebihi sisa CO.');
                }
                const receipt = await sender('save_sj_draft', { co_id: co.id, expected_co_version: binding.co_version, expected_customer_version: binding.customer_version, sj_number: number.trim(), sj_date: date, received_date: received || null, notes: notes || null, lines: selected, ...(saved ? { draft_id: saved.id, expected_draft_version: saved.draft_version } : {}), ...(correction ? sourceTarget : {}) });
                if (actor.isCurrent() && latest.current.generation === g) {
                    setConfirmed(receipt);
                    await importReceipt(receipt, g);
                }
            }
        }
        catch (e) {
            if (actor.isCurrent() && latest.current.generation === g) actor.rejectAuthority(e);
            if (actor.isCurrent() && latest.current.generation === g) {
                setError((e as Error).message);
                if ((e as { code?: string }).code === 'PT409') setStale(true);
            }
        }
        finally {
            busy.current = false;
            if (actor.isCurrent())
                setPending(false);
        }
    }
    return <>{unsaved.dialog}<ReturnedDateDialog labelledBy="co-sj-title" pending={pending || reviewPending} onClose={dismiss} returnFocus={returnFocus} fallbackFocus={() => null}>
    <h2 id="co-sj-title" className="font-semibold text-lg">{draftId ? 'Draft Surat Jalan' : 'Tambah Surat Jalan'}</h2>
    <p className="mt-2 text-xs text-gray-500">Draft tidak menambah stok atau pendapatan. Post menambah stok tercatat pada tanggal SJ; bukan pendapatan.</p>
    <p className="mt-1 text-xs text-gray-500">SJ Kembali adalah pengembalian dokumen, bukan retur barang.</p>
    <div className="space-y-4 mt-4">{readFailure}
    <CORecoveryPanel sender={sender} current={()=>actor.isCurrent()&&!pending&&!reviewPending} accept={recovered}/>{read.isError && <COFailure error={read.error}/>}{(stale || read.isError) && <button type="button" className={CO_BUTTON} disabled={pending || blocked} onClick={() => void refreshSources()}>Muat sumber SJ terbaru</button>}{!loaded && !read.isError && <p role="status">Memuat seluruh sumber CO…</p>}
      {reviewing && (saved || voiding && sourceTarget) ? <COCorrectionDialog embedded ownUnsaved={false} operation={correction ? 'correct_sj' : 'post_sj'} customerId={co.customer_id} source={{ expected_co_version: binding.co_version, expected_customer_version: binding.customer_version, ...(voiding ? { action: 'void', ...sourceTarget } : { draft_id: saved!.id, expected_draft_version: saved!.draft_version, ...(correction ? { action: 'replace', ...sourceTarget } : {}) }) }} sender={sender} current={actor.isCurrent} blocked={readBlocked || !dataReady || pending} readFailure={readFailure} onDirtyChange={setReviewDirty} onPendingChange={setReviewPending} onClose={() => unsaved.confirmDiscard(() => { if(voiding)onClose();else { setReviewing(false); setReviewDirty(false); } })} onAuthorityFailure={error => { actor.rejectAuthority(error); onAuthorityFailure?.(error); }} confirmDiscard={message => unsaved.confirmDiscardDecision({ message })} onRecovered={recovered} onAccepted={async receipt => { setConfirmed(receipt); return importReceipt(receipt); }} returnFocus={returnFocus}/> : loaded && <>
        <fieldset disabled={pending || blocked || !dataReady} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">Nomor SJ<input aria-label="Nomor SJ" className={CO_INPUT} value={number} onChange={e => setNumber(e.target.value)}/>
        </label>
        <label className="text-sm">Tanggal SJ<input type="date" aria-label="Tanggal SJ" className={CO_INPUT} value={date} onChange={e => setDate(e.target.value)}/>
        </label>
        <label className="text-sm">Tanggal diterima<input type="date" aria-label="Tanggal diterima" className={CO_INPUT} value={received} onChange={e => setReceived(e.target.value)}/>
        </label>
        <label className="text-sm">Catatan SJ<textarea aria-label="Catatan SJ" className={CO_INPUT} value={notes} onChange={e => setNotes(e.target.value)}/>
        </label>
        </fieldset>
        <label className="block text-xs">Tambahkan sumber CO<select aria-label="Tambahkan sumber CO" className={CO_INPUT} value="" disabled={pending || blocked || !dataReady} onChange={e => { const line = sources.find(l => l.id === e.target.value); if (line)
            setRows(prev => [...prev, { id: line.id, name: line.product_name, sku: line.display_sku, quantity: '0', pending: line.pending_quantity, available: true }]); }}>
        <option value="">Pilih sumber CO untuk ditambahkan</option>{sources.filter(l => !rows.some(r => r.id === l.id)).map(l => <option key={l.id} value={l.id}>{l.display_sku} · {l.product_name}</option>)}</select>
        </label>
        <div className="space-y-2">{rows.map(row => <div key={row.id} className="rounded-lg border border-gray-100 p-3 text-sm">
            <p className="break-words">{row.name} · {row.sku}</p>{!row.available ? <div role="alert" className="text-amber-800">
                <p>CO_SJ_SOURCE_UNAVAILABLE · Sumber {row.id} tidak tersedia. Jumlah tersimpan: {row.quantity}. Perbaiki secara sengaja sebelum menyimpan atau posting.</p>
                <button type="button" className={CO_BUTTON} disabled={pending || blocked} onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}>Hapus sumber tidak tersedia</button>
                </div> : <label className="block mt-2 text-xs">Jumlah dikirim (sisa {row.pending})<input type="text" inputMode="numeric" aria-label={`Jumlah dikirim ${row.name}`} className={CO_INPUT} value={row.quantity} disabled={pending || blocked || !dataReady} onChange={e => setRows(prev => prev.map(r => r.id === row.id ? { ...r, quantity: e.target.value } : r))}/>
                </label>}</div>)}</div>
        </>}
      {confirmed && <div className="rounded-lg bg-amber-50 p-3 text-sm">
        <p>SJ sudah tersimpan, tetapi hasil lengkap belum dapat dibuka. Jangan buat permintaan baru.</p>
        <button type="button" className={CO_BUTTON} disabled={pending} onClick={() => { setPending(true); setError(''); void importReceipt(confirmed).catch(e => { actor.rejectAuthority(e); if (actor.isCurrent())
            setError((e as Error).message); }).finally(() => { if (actor.isCurrent())
            setPending(false); }); }}>Buka hasil SJ tersimpan</button>
        </div>}{saved && !saved.bindings_current && <p role="alert" className="text-amber-800">Sumber berubah. Periksa semua isian dan simpan ulang untuk mengikat versi terbaru.</p>}{error && <COFailure error={new Error(error)}/>}<div className="flex flex-wrap justify-end gap-2">
    <button type="button" className={CO_BUTTON} onClick={dismiss} disabled={pending || reviewPending}>Batal</button>{!reviewing && <>
        <button type="button" className={CO_PRIMARY} disabled={!dataReady || pending || blocked || unavailable || saved?.consumed || !allowed.includes(correction?'correct_sj':'save_sj_draft')} onClick={() => void execute(false)}>Simpan Draft SJ</button>
        {!correction && <button type="button" className={CO_PRIMARY} disabled={!dataReady || pending || blocked || unavailable || !saved || dirty || !saved.bindings_current || saved.consumed || !allowed.includes('post_sj')} onClick={() => void execute(true)}>Post SJ</button>}
        <button type="button" className={CO_PRIMARY} disabled={!dataReady || pending || blocked || unavailable || !saved || dirty || !saved.bindings_current || !saved.preparation_ready || saved.consumed || !allowed.includes(correction ? 'correct_sj' : 'post_sj')} onClick={() => setReviewing(true)}>Tinjau perubahan SJ</button>
        </>}</div>
    </div>
    </ReturnedDateDialog>
    </>;
}
