import { useState } from 'react';
import type { COImpactKind, COImpactRows, COPreview, COReviewedOperation } from '../../lib/co/contracts';
import { fetchCOPreviewImpacts, completeCORead } from '../../lib/co/rpc';
import type { COReadOptions } from '../../lib/co/rpc';
import { isCOAuthorityError } from './COReportWorkspace';
import { invalid } from '../../lib/co/validation';
import { formatMoney } from '../../lib/reads/money';
import { CO_BUTTON, COFailure, COPagination, useCOActor, useCORead } from './COShared';
/** Immutable snapshot: every child read uses this exact payload and fingerprint. */
export interface COReviewSnapshot {
    operation: COReviewedOperation | 'post_report';
    payload: Record<string, unknown>;
    header: COPreview;
}
const labels: Record<COImpactKind, string> = { report: 'Laporan', stock: 'Stok', revenue: 'Pendapatan', credit: 'Kredit PIC', reopen: 'CO dibuka ulang', issue: 'Penghalang', missing_month: 'Periode wajib' };
export async function readAllCOImpacts<K extends COImpactKind>(snapshot: COReviewSnapshot, kind: K, options?: COReadOptions): Promise<COImpactRows[K][]> {
    return await completeCORead(async (page) => { const result = await fetchCOPreviewImpacts({ p_operation: snapshot.operation, p_payload: snapshot.payload, p_preview_fingerprint: snapshot.header.preview_fingerprint, p_kind: kind, p_page: page, p_page_size: 100 }, options); if (result.total !== snapshot.header.counts[kind])
        invalid('preview impact count'); return result; }, r => r.ref ?? (kind === 'stock' ? `${r.stock_key_id}:${r.batch_id}` : kind === 'credit' ? `${r.report_month}:${r.sales_person_id_at_creation}` : kind === 'issue' ? JSON.stringify(r) : r.report_month ?? r.co_id)) as COImpactRows[K][];
}
export default function COChangePreview({ snapshot, selectedMonth, onAuthorityFailure }: {
    snapshot: COReviewSnapshot;
    selectedMonth?: string;
    onAuthorityFailure?: (error: unknown) => void;
}) {
    const actor = useCOActor(`preview:${snapshot.header.preview_fingerprint}`), [kind, setKind] = useState<COImpactKind>('issue'), [page, setPage] = useState(1);
    async function guarded<T>(read: () => Promise<T>) {
        const notify = onAuthorityFailure;
        try { return await read(); }
        catch (error) {
            if (actor.isCurrent() && isCOAuthorityError(error)) notify?.(error);
            throw error;
        }
    }
    const args = { p_operation: snapshot.operation, p_payload: snapshot.payload, p_preview_fingerprint: snapshot.header.preview_fingerprint, p_kind: kind, p_page: page, p_page_size: 20 };
    const read = useCORead(actor, 'preview-impact', args, o => guarded(async () => { const r = await fetchCOPreviewImpacts(args, o); if (r.total !== snapshot.header.counts[kind])
        invalid('preview impact count'); return r; }));
    const selected = useCORead(actor, 'preview-selected-report', { snapshot, selectedMonth }, o => guarded(async () => (await readAllCOImpacts(snapshot, 'report', o)).find(r => r.month === selectedMonth) ?? null), !!selectedMonth);
    return <section aria-label="Peninjauan dampak" className="rounded-lg border border-blue-200 p-4 space-y-3 text-sm"><h3 className="font-semibold">Peninjauan seluruh dampak</h3><p>Seluruh riwayat pelanggan sebelum: Rp {formatMoney(snapshot.header.before.revenue, 'full')}</p><p>Seluruh riwayat pelanggan sesudah: Rp {formatMoney(snapshot.header.after.revenue, 'full')}</p><p>Total riwayat terjual: {snapshot.header.after.sold_quantity} · sisa tercatat: {snapshot.header.after.remaining_quantity}</p>{!snapshot.header.after.complete && <p role="alert">Provisional: laporan belum lengkap. Kosong bukan nol.</p>}{selectedMonth && (selected.isError ? <COFailure error={selected.error} retry={() => void selected.refetch()}/> : selected.isPending ? <p>Memeriksa periode dipilih di semua halaman dampak…</p> : selected.data ? <p>Pendapatan periode dipilih: Rp {formatMoney(selected.data.after_revenue, 'full')}{!selected.data.complete ? ' (provisional)' : ''}</p> : <p>Total periode dipilih belum tersedia pada hasil ini.</p>)}
 <div className="flex flex-wrap gap-2">{(Object.keys(labels) as COImpactKind[]).map(k => <button type="button" className={CO_BUTTON} aria-pressed={k === kind} key={k} onClick={() => { setKind(k); setPage(1); }}>{labels[k]} ({snapshot.header.counts[k]})</button>)}</div>
 {read.isError ? <COFailure error={read.error} retry={() => void read.refetch()}/> : !read.data ? <p role="status">Memuat dampak…</p> : <><ul className="space-y-2">{read.data.rows.map((r: Record<string, any>, i: number) => <li key={i} className="break-words border-b border-gray-100 pb-2">{impactText(kind, r)}</li>)}</ul>{read.data.total === '0' && <p>Tidak ada {labels[kind].toLowerCase()}.</p>}<COPagination page={page} total={read.data.total} pending={read.isFetching} onPage={setPage}/></>}
 <p className="text-xs break-all">Sidik peninjauan: {snapshot.header.preview_fingerprint}</p>{!snapshot.header.can_post && <p role="alert">Belum dapat diterapkan. Selesaikan semua penghalang dan tinjau ulang.</p>}</section>;
}
function impactText(kind: COImpactKind, r: Record<string, any>) { switch (kind) {
    case 'report': return `${r.month} · ${r.ref} · cakupan ${r.coverage} · ${r.before_sold_quantity} → ${r.after_sold_quantity} · Rp ${formatMoney(r.before_revenue, 'full')} → Rp ${formatMoney(r.after_revenue, 'full')}${r.complete ? '' : ' · belum lengkap'}`;
    case 'stock': return `SKU ${r.stock_key_id} · sumber ${r.batch_id} · ${r.before_quantity} → ${r.after_quantity}`;
    case 'revenue':
    case 'credit': return `${r.report_month}${kind === 'credit' ? ` · PIC asli ${r.sales_person_id_at_creation ?? 'Unassigned'}` : ''} · Rp ${formatMoney(r.before_amount, 'full')} → Rp ${formatMoney(r.after_amount, 'full')}`;
    case 'reopen': return `CO ${r.co_id} · versi ${r.expected_co_version ?? 'tidak tersedia'} · stok ${r.remaining_quantity} · belum dikirim ${r.pending_quantity ?? 'tidak tersedia'} · laporan wajib ${r.missing_month_count ?? 'tidak tersedia'}`;
    case 'issue': return `${r.code}${r.report_month ? ` · ${r.report_month}` : ''}${r.stock_key_id ? ` · SKU ${r.stock_key_id}` : ''}${r.co_id ? ` · CO ${r.co_id}` : ''}`;
    case 'missing_month': return `${r.report_month} · ${r.reason} · cakupan ${r.coverage_through_date ?? 'belum ada'}`;
} }
