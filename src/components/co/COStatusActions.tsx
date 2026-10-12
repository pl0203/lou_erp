import { Section } from '../ui/Section';
import { Field } from '../ui/Field';
import { FormActions } from '../ui/FormActions';
import { ActionLink } from '../ui/ActionLink';
import { Button } from '../ui/Button';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { Dialog } from '../ui/Dialog';
import type { COOrderRecord } from '../../lib/co/validation';
import type { COOperation } from '../../lib/co/contracts';
import { CO_INPUT, COFailure } from './COShared';
export default function COStatusActions({ id, customerId, allowed, blockers, onSJ, onCancel, onResolve, onClose, pending, co }: {
    co: COOrderRecord;
    id: string;
    customerId: string;
    allowed: COOperation[];
    blockers: {
        stock_remains: boolean;
        undelivered_remains: boolean;
        missing_month_count: string;
    };
    onSJ: () => void;
    onCancel: () => void;
    onResolve: () => void;
    onClose: () => void;
    pending: boolean;
}) {
    const next = co.status === 'closed' ? 'CO sudah ditutup. Riwayat tetap dapat dibaca.'
        : co.status === 'cancelled' ? 'CO sudah dibatalkan. Riwayat tetap dapat dibaca.'
        : BigInt(co.summary.pending_quantity) > 0n ? 'Siapkan dan posting Surat Jalan untuk sisa barang. Jika sisa tidak akan dikirim, gunakan Selesaikan sisa belum dikirim.'
        : blockers.stock_remains || blockers.missing_month_count !== '0' ? 'Lengkapi laporan penjualan bulanan pelanggan; catat retur untuk barang belum terjual yang dikembalikan.'
        : 'Periksa penyelesaian, lalu pilih Tutup CO jika tindakan tersedia.';
    const nextMonth = co.reporting_freshness.next_required_report_month?.slice(0, 7);
    return <div className="space-y-3">
    <Section title="Pengiriman → Penjualan bulanan → Penyelesaian → Penutupan" role="region" aria-label="Alur CO dan langkah berikutnya" aria-labelledby={undefined}>
        <p><strong>Langkah berikutnya:</strong> {next}</p>
        <p className="text-[13px] text-brand-secondary">Surat Jalan yang diposting mencatat pengiriman. Tanggal diterima mencatat penerimaan terpisah. Terkirim penuh tetap aktif sampai CO ditutup; sisa yang diselesaikan juga dihitung dalam progres pengiriman.</p>
        <p className="text-[13px] text-brand-secondary">Penutupan memerlukan stok tercatat habis, sisa pengiriman selesai, dan seluruh laporan wajib lengkap.</p>
    </Section>
    <div className="flex flex-wrap gap-2">{allowed.includes('edit_co') && <ActionLink variant="secondary" to={`/athel/co/${id}/edit`}>Ubah CO</ActionLink>}<Button type="button"  disabled={pending || !allowed.includes('save_sj_draft')} onClick={onSJ}>Tambah Surat Jalan</Button>
    <ActionLink variant="secondary" to={`/athel/co/reports?customer=${customerId}${nextMonth ? `&month=${nextMonth}` : ''}`}>Catat penjualan bulanan</ActionLink>
    <ActionLink variant="secondary" to={`/athel/co/stock?customer=${customerId}&co=${id}`}>Retur barang belum terjual</ActionLink>{allowed.includes('cancel_co') && <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Batalkan CO</Button>}</div>
    <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={pending || !allowed.includes('resolve_undelivered')} onClick={onResolve}>Selesaikan sisa belum dikirim</Button>
        <Button type="button" variant="secondary" disabled={pending || !allowed.includes('close_co') || blockers.stock_remains || blockers.undelivered_remains || blockers.missing_month_count !== '0'} onClick={onClose}>Tutup CO</Button>
    </div>{blockers.stock_remains && <p className="text-[13px] text-amber-800">Stok tercatat masih tersisa.</p>}{blockers.undelivered_remains && <p className="text-[13px] text-amber-800">Sisa belum dikirim belum diselesaikan.</p>}{blockers.missing_month_count !== '0' && <p className="text-[13px] text-amber-800">{blockers.missing_month_count} laporan bulan belum lengkap.</p>}</div>;
}
export function COCancelDialog({ editorKey, pending, blocked = false, readFailure, error, onClose, onConfirm, returnFocus }: {
    editorKey: string;
    blocked?: boolean;
    readFailure?: ReactNode;
    pending: boolean;
    error: string;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void>;
    returnFocus: HTMLElement | null;
}) {
    const [reason, setReason] = useState('');
    const unsaved = useUnsavedChanges(!!reason);
    useBeforeSignOut(signal => unsaved.confirmDiscardDecision({ signal }), editorKey);
    const close = () => { if (!pending)
        unsaved.confirmDiscard(onClose); };
    return <>{unsaved.dialog}<Dialog labelledBy="co-cancel-title" pending={pending} onClose={close} returnFocus={returnFocus} fallbackFocus={() => null}>
    <h2 id="co-cancel-title" className="font-semibold">Batalkan CO?</h2>
    <p className="text-base mt-2">Alasan disimpan dalam audit. Pembatalan hanya tersedia tanpa riwayat pengiriman.</p>
    {readFailure}<Field id="co-cancel-reason" label="Alasan pembatalan">{control => <textarea {...control} aria-label="Alasan pembatalan" className={CO_INPUT} value={reason} onChange={e => setReason(e.target.value)} disabled={pending || blocked}/>}</Field>{error && <COFailure error={new Error(error)}/>}<FormActions className="mt-4">
    <Button type="button" variant="secondary" disabled={pending} onClick={close}>Batal</Button>
    <Button type="button"  disabled={pending || blocked || !reason.trim()} onClick={() => void onConfirm(reason)}>Konfirmasi pembatalan</Button>
    </FormActions>
    </Dialog>
    </>;
}
