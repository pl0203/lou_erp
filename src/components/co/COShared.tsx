import { Notice, StatusBadge } from '../ui/Feedback';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COSourceAuthorityContext } from '../../lib/co/authority';
import { useAuth } from '../../lib/AuthContext';
import { coKeys, synchronizeCOIdentity } from '../../lib/co/queryKeys';
import type { COReadOptions } from '../../lib/co/rpc';
import type { COReceipt, CORecovery } from '../../lib/co/contracts';
import type { COTransactionSender } from '../../lib/co/transactions';
import { parseEnteredQuantity } from '../../lib/co/validation';
import type { COReportingFreshness } from '../../lib/co/validation';
import { formatCOReportMonth } from '../../lib/co/presentation';
export const CO_INPUT = 'ui-control focus:outline-none focus:ring-2 focus:ring-brand-primary disabled:bg-brand-canvas disabled:text-brand-secondary';
export const CO_BUTTON = 'ui-action ui-action--secondary';
export const CO_PRIMARY = 'ui-action ui-action--primary';
export const quantityText = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export function enteredQuantity(text: string, allowZero = false) {
    if (!/^(0|[1-9]\d*)$/.test(text))
        throw new Error('Jumlah harus berupa bilangan bulat, bukan kosong atau pecahan.');
    return parseEnteredQuantity(Number(text), allowZero);
}
/** A retained handler/read can never act after unmount, actor replacement or document replacement. */
export function useCOActor(document = '') {
    const auth = useAuth();
    const authority = useContext(COSourceAuthorityContext);
    const client = useQueryClient();
    const mounted = useRef(true);
    const allowed = !auth.loading && !auth.error && auth.user && auth.profile?.id === auth.user.id && auth.profile.is_active && ['co_admin', 'executive'].includes(auth.profile.role);
    const actorId = allowed ? auth.user!.id : '';
    const role = allowed ? auth.profile!.role : '';
    const scope = `${actorId}:${role}:${document}`;
    const latest = useRef(scope);
    latest.current = scope;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => synchronizeCOIdentity(client, actorId ? { actorId, role } : null), [client, actorId, role]);
    const isCurrent = useCallback(() => mounted.current && !!actorId && latest.current === scope && (!authority || authority.current()), [actorId, scope, authority]);
    function rejectAuthority(error: unknown) { if (isCurrent()) authority?.reject(error); }
    async function protect<T>(run: () => Promise<T>, live: () => boolean = isCurrent): Promise<T> {
        try { return await run(); }
        catch (error) { if (live()) rejectAuthority(error); throw error; }
    }
    return { identity: { actorId, role }, enabled: !!actorId && (!authority || authority.current()), scope, isCurrent, client, rejectAuthority, protect };
}
export function useCORead<T>(actor: ReturnType<typeof useCOActor>, resource: string, args: unknown, read: (options: COReadOptions) => Promise<T>, enabled = true) {
    return useQuery({ queryKey: coKeys.read(actor.identity, resource, args), queryFn: ({ signal }) => actor.protect(() => read({ signal, isCurrent: actor.isCurrent }), () => !signal.aborted && actor.isCurrent()), enabled: actor.enabled && enabled, retry: false });
}
export function COFailure({ error, retry }: {
    error: unknown;
    retry?: () => void;
}) {
    return <Notice tone="error" title={error instanceof Error ? error.message : 'Data CO belum tersedia.'} actions={retry && <Button type="button" variant="quiet" size="compact" onClick={retry}>Coba lagi</Button>}/>;
}
export function COCard({ title, children }: {
    title: string;
    children: ReactNode;
}) {
    return <Section title={title}>{children}</Section>;
}
export function COPagination({ page, total, pageSize = 20, pending, onPage }: {
    page: number;
    total: string;
    pageSize?: number;
    pending: boolean;
    onPage: (page: number) => void;
}) {
    const count = BigInt(total);
    const last = count === 0n ? 1n : (count + BigInt(pageSize) - 1n) / BigInt(pageSize);
    useEffect(() => {
        // last < an already bounded page, so this conversion is exact and safe.
        if(!pending && BigInt(page)>last)onPage(Number(last));
    },[pending,page,last,onPage]);
    const start = count === 0n ? 0n : BigInt(page - 1) * BigInt(pageSize) + 1n;
    const finish = BigInt(page) * BigInt(pageSize);
    const end = finish < count ? finish : count;
    return <div className="ui-pagination" aria-busy={pending}>
    <p>{quantityText(start.toString())}–{quantityText(end.toString())} dari {quantityText(total)}</p>
    <nav aria-label="Halaman hasil" className="flex flex-wrap items-center gap-3">
    <Button type="button" variant="quiet" size="compact" disabled={pending || page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</Button>
    <span>Halaman {page} dari {quantityText(last.toString())}</span>
    <Button type="button" variant="quiet" size="compact" disabled={pending || BigInt(page) >= last || page >= 2147483647} onClick={() => onPage(page + 1)}>Berikutnya</Button>
    </nav>
  </div>;
}
export const CO_LIFECYCLE = { active: 'Aktif', closed: 'Ditutup', cancelled: 'Dibatalkan' };
export const CO_PROGRESS = { not_started: 'Belum dikirim', partial: 'Terkirim sebagian', complete: 'Terkirim penuh' };
export function COBadges({ status, progress }: {
    status: keyof typeof CO_LIFECYCLE;
    progress: keyof typeof CO_PROGRESS;
}) {
    return <div className="flex flex-wrap gap-2">
    <StatusBadge tone={status === 'cancelled' ? 'warning' : status === 'closed' ? 'success' : 'neutral'}>{CO_LIFECYCLE[status]}</StatusBadge>
    <StatusBadge tone="neutral">{CO_PROGRESS[progress]}</StatusBadge>
    </div>;
}
export function COFreshness({ value, compact = false }: {
    value: COReportingFreshness;
    compact?: boolean;
}) {
    const labels = { no_recorded_activity: 'Belum ada aktivitas stok tercatat', complete: 'Laporan periode wajib lengkap', missing_completed_period: 'Laporan bulan selesai belum lengkap', current_unreported: 'Bulan berjalan belum dilaporkan', current_partial: 'Laporan bulan berjalan masih parsial' };
    const tone = value.status === 'complete' ? 'success' : value.status === 'no_recorded_activity' ? 'neutral' : 'warning';
    if (compact) return <div className="mt-2 space-y-1 text-[13px] text-brand-secondary"><StatusBadge tone={tone}>{labels[value.status]}</StatusBadge>{value.next_required_report_month && <p>Berikutnya: {formatCOReportMonth(value.next_required_report_month)} · {quantityText(value.pending_report_month_count)} belum lengkap</p>}{value.zero_stock_reporting_pending && <p>Stok nol; laporan masih wajib.</p>}</div>;
    // Reporting freshness is static source metadata, so this opt-in adapter has no live role.
    return <div className={`ui-notice ui-notice--${tone === 'neutral' ? 'info' : tone} mt-3`}><p className="ui-notice__title">{labels[value.status]}</p><div className="ui-notice__content">{value.next_required_report_month && <p>Periode berikutnya yang perlu dilengkapi: {formatCOReportMonth(value.next_required_report_month)} · {quantityText(value.pending_report_month_count)} periode belum lengkap</p>}{value.zero_stock_reporting_pending && <p>Stok tercatat nol; laporan wajib tetap perlu diselesaikan.</p>}<p>Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.</p>
    </div></div>;
}
/** Recovery asks to inspect first; only an explicit result acceptance may replace dirty work. */
export function CORecoveryPanel({ sender, accept, current, pending = false, confirmed = false }: {
    confirmed?: boolean;
    pending?: boolean;
    sender: COTransactionSender;
    accept: (receipt: COReceipt) => Promise<boolean>;
    current: () => boolean;
}) {
    const authority = useContext(COSourceAuthorityContext);
    const [result, setResult] = useState<CORecovery | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const unresolved = sender.hasUnresolved();
    // The owning form may acknowledge a recovered receipt through its own canonical
    // readback action. Retire only that acknowledged outcome, never a live request.
    const acknowledged = result?.status === 'committed' && !unresolved && !confirmed && !pending;
    useEffect(() => {
        if (acknowledged) { setResult(null); setError(''); }
    }, [acknowledged]);
    async function run(action: () => Promise<void>) {
        if (lock.current || !current())
            return;
        lock.current = true;
        setBusy(true);
        setError('');
        try {
            await action();
        }
        catch (e) {
            if (current()) {
                authority?.reject(e);
                setError((e as Error).message);
            }
        }
        finally {
            lock.current = false;
            if (current())
                setBusy(false);
        }
    }
    if (pending) return <Notice tone="info" aria-live="polite" title="Sedang memproses. Mohon tunggu hasilnya."/>;
    // The owning form presents its known saved result and explicit readback action.
    if (confirmed) return error ? <COFailure error={new Error(error)}/> : null;
    if (acknowledged || !unresolved && !result && !error)
        return null;
    return <Notice tone="warning" title={result?.status === 'abandoned' && !unresolved ? 'Pemeriksaan selesai. Permintaan sebelumnya tidak tersimpan.' : 'Hasil penyimpanan sebelumnya perlu dipulihkan. Permintaan yang sudah dikirim tidak dibatalkan oleh perpindahan halaman.'}>
    {error && <p role="alert">{error}</p>}
    {result?.status === 'unknown' && <p role="alert">Hasil belum dapat dipastikan. Jangan buat permintaan baru.</p>}
    {result?.status === 'abandoned' && !unresolved && <p>Permintaan lama dibatalkan secara aman. Anda dapat menyimpan kembali.</p>}
    {result?.status === 'committed' ? <Button type="button" variant="quiet" size="compact" disabled={busy} onClick={() => void run(async () => { const accepted = await accept(result.receipt); if (accepted === true && current()) setResult(null); })}>Lihat hasil tersimpan</Button> : unresolved && <Button type="button" variant="quiet" size="compact" disabled={busy} onClick={() => void run(async () => { const recovered = await sender.reconcile(); if (current())
        setResult(recovered); })}>Pulihkan hasil penyimpanan</Button>}
  </Notice>;
}
