import { Field } from '../ui/Field';
import { FormActions } from '../ui/FormActions';
import { ActionLink } from '../ui/ActionLink';
import { Button } from '../ui/Button';
import { useEffect, useId, useRef, useState } from 'react';
import './co-detail.css';
import type { ReactNode } from 'react';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { Dialog } from '../ui/Dialog';
import type { COOrderRecord } from '../../lib/co/validation';
import type { COOperation } from '../../lib/co/contracts';
import { CO_INPUT, COFailure } from './COShared';
export default function COStatusActions({ id, customerId, allowed, blockers, onSJ, onCancel, onResolve, onClose, pending, co, heading }: {
    heading?: ReactNode;
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
    const [open, setOpen] = useState(false);
    const popupId = useId();
    const container = useRef<HTMLDivElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);
    function dismiss(restore = false) { setOpen(false); if (restore) toggle.current?.focus(); }
    // Dialog owners capture the durable toolbar trigger, not a disappearing popup item.
    function invoke(action: () => void) { dismiss(true); action(); }
    const nextMonth = co.reporting_freshness.next_required_report_month?.slice(0, 7);
    const closeBlocked = pending || !allowed.includes('close_co') || blockers.stock_remains || blockers.undelivered_remains || blockers.missing_month_count !== '0';
    return <div className="co-detail-actions">
        <div className="co-detail-actions__heading">
            {heading}
            <Button className="co-detail-actions__primary" type="button" disabled={pending || co.status !== 'active' || BigInt(co.summary.pending_quantity) === 0n || !allowed.includes('save_sj_draft')} onClick={onSJ}>Buat surat jalan</Button>
        </div>
        <div className="co-detail-actions__toolbar">
            <div className="co-detail-actions__commands">
                {!pending && allowed.includes('edit_co') && <ActionLink variant="secondary" size="compact" to={`/athel/co/${id}/edit`}>Edit CO</ActionLink>}
                <div className="co-detail-actions__disclosure" ref={container}
                    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) dismiss(); }}
                    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); dismiss(true); } }}>
                    <button ref={toggle} type="button" className="ui-action ui-action--secondary ui-action--compact" aria-expanded={open} aria-controls={popupId} onClick={() => setOpen(value => !value)}>Actions <span aria-hidden="true">▾</span></button>
                    <div id={popupId} hidden={!open} className="co-detail-actions__popup" role="group" aria-label="Actions CO">
                        <ActionLink variant="secondary" size="compact" to={`/athel/co/stock?customer=${customerId}&co=${id}`} onClick={() => dismiss()}>Retur barang belum terjual</ActionLink>
                        <Button type="button" variant="secondary" size="compact" disabled={pending || !allowed.includes('resolve_undelivered')} onClick={() => invoke(onResolve)}>Selesaikan sisa belum dikirim</Button>
                        <Button type="button" variant="secondary" size="compact" aria-describedby={closeBlocked ? `${popupId}-reasons` : undefined} disabled={closeBlocked} onClick={() => invoke(onClose)}>Tutup CO</Button>
                        {closeBlocked && <div id={`${popupId}-reasons`} className="co-detail-actions__reasons">
                            {blockers.stock_remains && <p>Stok tercatat masih tersisa.</p>}
                            {blockers.undelivered_remains && <p>Sisa belum dikirim belum diselesaikan.</p>}
                            {blockers.missing_month_count !== '0' && <p>{blockers.missing_month_count} laporan bulan belum lengkap.</p>}
                        </div>}
                        {allowed.includes('cancel_co') && <Button type="button" variant="danger-quiet" size="compact" disabled={pending} onClick={() => invoke(onCancel)}>Batalkan CO</Button>}
                    </div>
                </div>
            </div>
            <nav className="co-detail-actions__related" aria-label="Halaman terkait CO"><span>Terkait</span>
                <ActionLink variant="secondary" size="compact" aria-label="Lihat stok toko" to={`/athel/co/stock?customer=${customerId}&co=${id}`}>Stok toko</ActionLink>
                <ActionLink variant="secondary" size="compact" aria-label="Lihat laporan bulanan" to={`/athel/co/reports?customer=${customerId}${nextMonth ? `&month=${nextMonth}` : ''}`}>Laporan bulanan</ActionLink>
            </nav>
        </div>
    </div>;

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
    <Button type="button" variant="quiet" size="compact" disabled={pending} onClick={close}>Batal</Button>
    <Button type="button" variant="danger" disabled={pending || blocked || !reason.trim()} onClick={() => void onConfirm(reason)}>Konfirmasi pembatalan</Button>
    </FormActions>
    </Dialog>
    </>;
}
