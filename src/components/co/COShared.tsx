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
export const CO_INPUT = 'min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary disabled:bg-gray-50 disabled:text-gray-500';
export const CO_BUTTON = 'rounded-lg border border-gray-200 px-4 py-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-brand-primary';
export const CO_PRIMARY = `${CO_BUTTON} bg-brand-primary text-white hover:bg-brand-hover`;
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
    return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error instanceof Error ? error.message : 'Data CO belum tersedia.'} {retry && <button type="button" className="underline" onClick={retry}>Coba lagi</button>}</div>;
}
export function COCard({ title, children }: {
    title: string;
    children: ReactNode;
}) {
    return <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <h2 className="mb-4 text-base font-medium text-gray-900">{title}</h2>{children}</section>;
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
    return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500" aria-busy={pending}>
    <p>{quantityText(start.toString())}–{quantityText(end.toString())} dari {quantityText(total)}</p>
    <nav aria-label="Halaman hasil" className="flex flex-wrap items-center gap-3">
    <button type="button" className={CO_BUTTON} disabled={pending || page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</button>
    <span>Halaman {page} dari {quantityText(last.toString())}</span>
    <button type="button" className={CO_BUTTON} disabled={pending || BigInt(page) >= last || page >= 2147483647} onClick={() => onPage(page + 1)}>Berikutnya</button>
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
    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">{CO_LIFECYCLE[status]}</span>
    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">{CO_PROGRESS[progress]}</span>
    </div>;
}
export function COFreshness({ value }: {
    value: COReportingFreshness;
}) {
    const labels = { no_recorded_activity: 'Belum ada aktivitas stok tercatat', complete: 'Laporan periode wajib lengkap', missing_completed_period: 'Laporan bulan selesai belum lengkap', current_unreported: 'Bulan berjalan belum dilaporkan', current_partial: 'Laporan bulan berjalan masih parsial' };
    return <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
    <p>{labels[value.status]}</p>{value.next_required_report_month && <p>Periode berikutnya yang perlu dilengkapi: {value.next_required_report_month.slice(0, 7)} · {quantityText(value.pending_report_month_count)} periode belum lengkap</p>}{value.zero_stock_reporting_pending && <p>Stok tercatat nol; laporan wajib tetap perlu diselesaikan.</p>}<p>Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.</p>
    </div>;
}
/** Recovery asks to inspect first; only an explicit result acceptance may replace dirty work. */
export function CORecoveryPanel({ sender, accept, current }: {
    sender: COTransactionSender;
    accept: (receipt: COReceipt) => Promise<boolean>;
    current: () => boolean;
}) {
    const authority = useContext(COSourceAuthorityContext);
    const [result, setResult] = useState<CORecovery | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
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
    if (!sender.hasUnresolved() && !result && !error)
        return null;
    return <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
    <p>Hasil penyimpanan sebelumnya perlu dipulihkan. Permintaan yang sudah dikirim tidak dibatalkan oleh perpindahan halaman.</p>
    {error && <p role="alert">{error}</p>}
    {result?.status === 'unknown' && <p role="alert">Hasil belum dapat dipastikan. Jangan buat permintaan baru.</p>}
    {result?.status === 'abandoned' && <p>Permintaan lama dibatalkan secara aman. Anda dapat menyimpan kembali.</p>}
    {result?.status === 'committed' ? <button type="button" className={CO_BUTTON} disabled={busy} onClick={() => void run(async () => { const accepted = await accept(result.receipt); if (accepted === true && current()) setResult(null); })}>Lihat hasil tersimpan</button> : sender.hasUnresolved() && <button type="button" className={CO_BUTTON} disabled={busy} onClick={() => void run(async () => { const recovered = await sender.reconcile(); if (current())
        setResult(recovered); })}>Pulihkan hasil penyimpanan</button>}
  </div>;
}
