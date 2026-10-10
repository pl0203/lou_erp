import { useState } from 'react';
import type { ReactNode } from 'react';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import ReturnedDateDialog from '../ReturnedDateDialog';
import { Link } from 'react-router-dom';
import type { COOperation } from '../../lib/co/contracts';
import { CO_BUTTON, CO_PRIMARY, CO_INPUT, COFailure } from './COShared';
export default function COStatusActions({ id, customerId, allowed, blockers, onSJ, onCancel, onResolve, onClose, pending }: {
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
    return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">{allowed.includes('edit_co') && <Link className={CO_BUTTON} to={`/athel/co/${id}/edit`}>Ubah CO</Link>}<button type="button" className={CO_PRIMARY} disabled={pending || !allowed.includes('save_sj_draft')} onClick={onSJ}>Tambah Surat Jalan</button>
    <Link className={CO_BUTTON} to={`/athel/co/reports?customer=${customerId}`}>Catat penjualan bulanan</Link>
    <Link className={CO_BUTTON} to={`/athel/co/stock?customer=${customerId}&co=${id}`}>Retur barang belum terjual</Link>{allowed.includes('cancel_co') && <button type="button" className={CO_BUTTON} disabled={pending} onClick={onCancel}>Batalkan CO</button>}</div>
    <div className="flex flex-wrap gap-2">
        <button type="button" className={CO_BUTTON} disabled={pending || !allowed.includes('resolve_undelivered')} onClick={onResolve}>Selesaikan sisa belum dikirim</button>
        <button type="button" className={CO_BUTTON} disabled={pending || !allowed.includes('close_co') || blockers.stock_remains || blockers.undelivered_remains || blockers.missing_month_count !== '0'} onClick={onClose}>Tutup CO</button>
    </div>{blockers.stock_remains && <p className="text-xs text-amber-800">Stok tercatat masih tersisa.</p>}{blockers.undelivered_remains && <p className="text-xs text-amber-800">Sisa belum dikirim belum diselesaikan.</p>}{blockers.missing_month_count !== '0' && <p className="text-xs text-amber-800">{blockers.missing_month_count} laporan bulan belum lengkap.</p>}</div>;
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
    return <>{unsaved.dialog}<ReturnedDateDialog labelledBy="co-cancel-title" pending={pending} onClose={close} returnFocus={returnFocus} fallbackFocus={() => null}>
    <h2 id="co-cancel-title" className="font-semibold">Batalkan CO?</h2>
    <p className="text-sm mt-2">Alasan disimpan dalam audit. Pembatalan hanya tersedia tanpa riwayat pengiriman.</p>
    {readFailure}<label className="block mt-4 text-sm">Alasan pembatalan<textarea aria-label="Alasan pembatalan" className={CO_INPUT} value={reason} onChange={e => setReason(e.target.value)} disabled={pending || blocked}/>
    </label>{error && <COFailure error={new Error(error)}/>}<div className="flex flex-wrap justify-end gap-2 mt-4">
    <button type="button" className={CO_BUTTON} disabled={pending} onClick={close}>Batal</button>
    <button type="button" className={CO_PRIMARY} disabled={pending || blocked || !reason.trim()} onClick={() => void onConfirm(reason)}>Konfirmasi pembatalan</button>
    </div>
    </ReturnedDateDialog>
    </>;
}
