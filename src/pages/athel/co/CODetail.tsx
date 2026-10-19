import { LoadingState } from '../../../components/ui/LoadingState'
import { PageHeader } from '../../../components/ui/PageHeader';
import { SummaryList } from '../../../components/ui/SummaryList';
import { ActionLink } from '../../../components/ui/ActionLink';
import { Button } from '../../../components/ui/Button';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { fetchCODetail, fetchCODetailSection } from '../../../lib/co/rpc';
import type { COOrderRecord, COSection } from '../../../lib/co/validation';
import { useCOTransactionSender } from '../../../lib/co/transactions';
import { coKeys } from '../../../lib/co/queryKeys';
import { formatDisplayDate, formatAuditTimestamp } from '../../../lib/displayDate';
import { CO_AUDIT_ACTIONS, formatCOReportMonth } from '../../../lib/co/presentation';
import { formatMoney } from '../../../lib/reads/money';
import type { CODeliveryCorrectionSelection } from '../../../components/co/CODeliveryDialog';
import CODeliveryDialog from '../../../components/co/CODeliveryDialog';
import COReturnDialog from '../../../components/co/COReturnDialog';
import type { COReturnSelection } from '../../../components/co/COReturnDialog';
import COSettlementDialog from '../../../components/co/COSettlementDialog';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import { isCOAuthorityError } from '../../../components/co/COReportWorkspace';
import COStatusActions, { COCancelDialog } from '../../../components/co/COStatusActions';
import { COBadges, COCard, COFailure, COFreshness, COPagination, CORecoveryPanel, quantityText, useCOActor, useCORead } from '../../../components/co/COShared';
export default function CODetail() {
    const { id } = useParams();
    return <COSourceBoundary source={`detail:${id}`} check={options => fetchCODetail(id!, null, options)}><CODetailOwner key={id}/></COSourceBoundary>;
}
function CODetailOwner() {
    const { id } = useParams();
    const actor = useCOActor(`detail:${id}`);
    const [authorityFailure, setAuthorityFailure] = useState<unknown>(null);
    const query = useCORead(actor, 'detail', { id }, o => fetchCODetail(id!, null, o), !!id && !authorityFailure);
    const authorityDenied = useRef(false);
    const errorCode = (query.error as { code?: string } | null)?.code;
    const denied = query.isError && ['42501', '28000', '28P01', 'PT401', 'PT403', 'PGRST301', 'PGRST302', 'PGRST303'].includes(errorCode ?? '');
    if (denied) authorityDenied.current = true;
    function rejectAuthority(error: unknown) {
        if (!actor.isCurrent() || !isCOAuthorityError(error)) return;
        actor.rejectAuthority(error);
        authorityDenied.current = true;
        setAuthorityFailure(error);
        const queryKey = coKeys.identity(actor.identity);
        void actor.client.cancelQueries({ queryKey });
        actor.client.removeQueries({ queryKey });
    }
    useEffect(() => {
        if (denied) rejectAuthority(query.error);
    }, [denied, query.error, actor.client, actor.scope]);
    if (query.isSuccess && !query.isFetching && !authorityFailure) authorityDenied.current = false;
    if (!actor.enabled)
        return null;
    if (authorityFailure) return <COFailure error={authorityFailure} retry={() => {
        authorityDenied.current = false;
        setAuthorityFailure(null);
        void query.refetch();
    }}/>;
    if (query.isError && (!query.data || authorityDenied.current))
        return <COFailure error={query.error} retry={() => void query.refetch()}/>;
    if (!query.data)
        return <LoadingState title="Memuat CO…" shape="detail" />;
    return <DetailReady onAuthorityFailure={rejectAuthority} key={actor.scope} co={query.data.co as COOrderRecord} allowed={query.data.allowed_operations} blockers={query.data.close_blockers} reload={() => void query.refetch()} refreshing={query.isFetching || query.isError} readError={query.isError ? query.error : null}/>;
}
function DetailReady({ co, allowed, blockers, reload, refreshing, readError, onAuthorityFailure }: {
    co: COOrderRecord;
    allowed: any;
    blockers: any;
    reload: () => void;
    refreshing: boolean;
    readError: unknown;
    onAuthorityFailure: (error: unknown) => void;
}) {
    const actor = useCOActor(`detail-ready:${co.id}`);
    const sender = useCOTransactionSender({ formScope: `cancel:${co.id}`, customerId: co.customer_id, coId: co.id });
    const [sj, setSJ] = useState<{
        draftId?: string;
        correctionSource?: CODeliveryCorrectionSelection;
    } | null>(null);
    const [cancel, setCancel] = useState(false);
    const [returnSelection, setReturnSelection] = useState<COReturnSelection | null>(null);
    const [settlement, setSettlement] = useState<'resolve_undelivered' | 'close_co' | 'recovery' | null>(null);
    const settlementSender = useCOTransactionSender({ formScope: `settlement:${co.id}`, customerId: co.customer_id, coId: co.id, retainCommitted: true });
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const trigger = useRef<HTMLElement | null>(null);
    const busy = useRef(false);
    const [selected, setSelected] = useState<{
        section: COSection;
        parent: string;
        draftVersion?: string;
        title: string;
    } | null>(null);
    async function cancelOrder(reason: string) { if (busy.current || !actor.isCurrent() || !allowed.includes('cancel_co') || refreshing)
        return; busy.current = true; setPending(true); setError(''); try {
        await sender('cancel_co', { co_id: co.id, expected_co_version: co.co_version, expected_customer_version: co.customer_version, reason });
        if (actor.isCurrent()) {
            setCancel(false);
            reload();
            actor.client.invalidateQueries({ queryKey: ['co'] });
        }
    }
    catch (e) {
        actor.rejectAuthority(e);
        if (actor.isCurrent())
            setError((e as Error).message);
    }
    finally {
        busy.current = false;
        if (actor.isCurrent())
            setPending(false);
    } }
    const readFailure = readError ? <COFailure error={readError} retry={reload}/> : null;
    const sections: [
        COSection,
        string
    ][] = [['lines', 'Barang CO'], ['sj_drafts', 'Draft Surat Jalan'], ['deliveries', 'Riwayat Surat Jalan'], ['reports', 'Laporan bulanan pelanggan (semua CO)'], ['return_drafts', 'Draft retur pelanggan (semua sumber CO)'], ['returns', 'Retur barang CO (bagian sumber CO ini)'], ['audit', 'Audit CO dan laporan pelanggan']];
    return <div className="max-w-6xl mx-auto space-y-6">
    <ActionLink variant="quiet" size="compact" to="/athel/co">← Kembali</ActionLink>
    <PageHeader title={co.co_number} description={`${co.customer_name} · ${formatDisplayDate(co.order_date)}`} actions={<COBadges status={co.status} progress={co.summary.delivery_progress}/>}/>
    <COCard title="Ringkasan CO ini">
    <p className="mb-3 text-base text-brand-secondary">Sejak pembuatan CO sampai sumber tercatat terbaru. Pendapatan berasal dari penjualan bulanan yang diposting dan dialokasikan ke CO ini; nilai rencana bukan pendapatan.</p>
    <SummaryList items={[
        ...[['Dikirim', co.summary.delivered_quantity], ['Terjual', co.summary.sold_quantity], ['Retur belum terjual', co.summary.returned_quantity], ['Sisa stok tercatat', co.summary.remaining_quantity], ['Belum dikirim', co.summary.pending_quantity], ['Sisa diselesaikan', co.summary.resolved_undelivered_quantity]].map(([label, value]) => ({ label, value: quantityText(value) })),
        { label: 'Nilai rencana CO', value: `Rp ${formatMoney(co.summary.planned_value, 'full')}` },
        { label: 'Pendapatan terjual', value: `Rp ${formatMoney(co.summary.revenue, 'full')}` },
    ]}/>
    <p className="mt-4 text-base">PIC asli: <span>{co.sales_person_name ?? 'Belum ditetapkan'}</span>
    </p>
    <p className="text-[13px] text-brand-secondary mt-1">Pelanggan, harga kesepakatan dan atribusi saat pembuatan tetap tersimpan.</p>
    {co.notes && <p className="mt-3 text-base whitespace-pre-wrap break-words">{co.notes}</p>}</COCard>
    <COCard title="Pelaporan pelanggan (semua CO)">
        <p className="text-base text-brand-secondary">Mencakup semua CO {co.customer_name}, termasuk aktivitas sebelum CO ini dibuat. Kelengkapan laporan pelanggan tidak menunjukkan bahwa CO ini sudah dikirim atau terjual.</p>
        <p className="text-base mt-3">Laporan terakhir: {formatCOReportMonth(co.last_report_month)} · Cakupan sampai: {formatDisplayDate(co.coverage_through_date)} (tanggal UTC server)</p>
        {!co.last_report_month && <p className="text-[13px] mt-2">Belum ada laporan yang diposting. Angka nol tercatat belum memverifikasi tidak adanya penjualan.</p>}
        <COFreshness value={co.reporting_freshness}/>
    </COCard>
    {!sj && !cancel && !returnSelection && !settlement && readFailure}
    <COStatusActions co={co} id={co.id} customerId={co.customer_id} allowed={allowed} blockers={blockers} pending={pending || refreshing || sender.hasUnresolved()} onSJ={() => { trigger.current = document.activeElement as HTMLElement; setSJ({}); }} onCancel={() => { trigger.current = document.activeElement as HTMLElement; setCancel(true); }}
        onResolve={() => { trigger.current = document.activeElement as HTMLElement; setSettlement('resolve_undelivered'); }}
        onClose={() => { trigger.current = document.activeElement as HTMLElement; setSettlement('close_co'); }}/>

    {settlementSender.hasUnresolved() && <Button type="button" variant="quiet" size="compact" disabled={refreshing || pending} onClick={e => { trigger.current = e.currentTarget; setSettlement('recovery'); }}>Pulihkan penyelesaian CO</Button>}
    <CORecoveryPanel pending={pending} sender={sender} current={actor.isCurrent} accept={async (r) => { if (r.operation !== 'cancel_co' || r.id !== co.id)
        throw new Error('Pemulihan tidak sesuai CO.'); await sender.acknowledgeRecovered(); if (actor.isCurrent()) {
        setCancel(false);
        reload();
        return true;
    } return false; }}/>
    {sections.map(([section, title]) => <COHistorySection key={section} co={co} section={section} title={title} onAuthorityFailure={onAuthorityFailure} renderRow={row => {
                if (section === 'lines')
                    return <div className="grid sm:grid-cols-3 gap-2">
                    <span>{row.product_name} · {row.display_sku}</span>
                    <span>Dipesan {quantityText(row.ordered_quantity)} · Dikirim {quantityText(row.delivered_quantity)}</span>
                    <span>Harga Rp {formatMoney(row.unit_price, 'full')} · <ActionLink variant="quiet" size="compact" to={`/athel/co/stock?customer=${co.customer_id}&sku=${row.stock_key_id}`}>Riwayat stok pelanggan/SKU</ActionLink>
                    </span>
                    </div>;
                if (section === 'sj_drafts')
                    return <div className="flex flex-wrap justify-between gap-2">
                    <span>{row.sj_number} · {formatDisplayDate(row.sj_date)} · {row.consumed ? 'Sudah diposting' : row.mode === 'delivery_correction' ? 'Draft koreksi' : 'Draft'}</span>
                    <Button variant="quiet" size="compact" type="button" disabled={refreshing || row.consumed} onClick={e => { trigger.current = e.currentTarget; setSJ({ draftId: row.id }); }}>Buka draft</Button>
                    </div>;
                if (section === 'deliveries')
                    return <div className="space-y-2">
                    <p>{row.sj_number} · {formatDisplayDate(row.sj_date)} · Revisi {row.revision_no} · {row.is_effective ? 'Efektif' : 'Historis'}{row.is_void ? ' · Dibatalkan' : ''}</p>
                    <p className="text-[13px] text-brand-secondary">Diterima: {formatDisplayDate(row.received_date)}</p>
                    {row.is_effective && row.current_revision_id === row.id && allowed.includes('correct_sj') && <div className="flex flex-wrap gap-2"><Button variant="quiet" size="compact" disabled={refreshing} onClick={e=>{trigger.current=e.currentTarget;setSJ({correctionSource:{headId:row.head_id,revisionId:row.id,version:row.head_version,action:'replace'}})}}>Siapkan pengganti SJ</Button>{!row.is_void&&<Button variant="danger-quiet" size="compact" disabled={refreshing} onClick={e=>{trigger.current=e.currentTarget;setSJ({correctionSource:{headId:row.head_id,revisionId:row.id,version:row.head_version,action:'void'}})}}>Batalkan SJ dengan koreksi</Button>}</div>}
                    <Button variant="quiet" size="compact" type="button" onClick={() => setSelected({ section: 'delivery_lines', parent: row.id, title: `Barang ${row.sj_number} revisi ${row.revision_no}` })}>Lihat barang SJ</Button>
                    </div>;
                if (section === 'reports')
                    return <ActionLink variant="quiet" size="compact" to={`/athel/co/reports/${co.customer_id}/${row.report_month}${row.revision_id ? `?revision=${row.revision_id}` : ''}`}>{formatCOReportMonth(row.report_month)} · Revisi {row.revision_no ?? row.report_version} · Bukti revisi tersimpan</ActionLink>;
                if (section === 'return_drafts') return <div className="space-y-2">
                    <p>{row.reference ?? row.reason ?? 'Draft retur'} · {formatDisplayDate(row.return_date)} · {row.line_count} sumber seluruh pelanggan{row.consumed ? ' · Sudah diposting' : ''}</p>
                    <Button variant="quiet" size="compact" disabled={refreshing} onClick={e => {
                        trigger.current = e.currentTarget;
                        setReturnSelection({ view: 'draft', id: row.id, draftVersion: row.draft_version });
                    }}>Buka draft retur</Button>
                </div>;
                if (section === 'returns') return <div className="space-y-2">
                    <p>{row.reference ?? row.reason ?? 'Retur'} · {formatDisplayDate(row.return_date)} · Revisi {row.revision_no}{row.is_void ? ' · Dibatalkan' : ''}</p>
                    <Button variant="quiet" size="compact" disabled={refreshing} onClick={e => {
                        trigger.current = e.currentTarget;
                        setReturnSelection({ view: 'revision', id: row.id });
                    }}>Lihat revisi retur</Button>
                    {row.is_effective && row.current_revision_id === row.id && <div className="flex flex-wrap gap-2">
                        <Button variant="quiet" size="compact" disabled={refreshing} onClick={e => {
                            trigger.current = e.currentTarget;
                            setReturnSelection({ view: 'effective', id: row.head_id, revisionId: row.id, returnVersion: row.head_version, action: 'replace' });
                        }}>Siapkan pengganti retur</Button>
                        {!row.is_void && <Button variant="danger-quiet" size="compact" disabled={refreshing} onClick={e => {
                            trigger.current = e.currentTarget;
                            setReturnSelection({ view: 'effective', id: row.head_id, revisionId: row.id, returnVersion: row.head_version, action: 'void' });
                        }}>Batalkan retur dengan koreksi</Button>}
                    </div>}
                </div>;
                return <div className="space-y-2">
                <p>Pengguna tercatat {CO_AUDIT_ACTIONS[row.operation] ?? 'mencatat perubahan'} {row.report_revision_id ? 'untuk pelanggan (semua CO)' : `pada ${co.co_number}`}.</p>
                <p className="text-[13px] text-brand-secondary">{formatAuditTimestamp(row.created_at)}</p>
                {row.reason && <p className="text-base">Alasan: {row.reason}</p>}
                <details className="text-[13px]"><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer">Detail teknis audit</summary><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(row, null, 2)}</pre></details>
                <Button type="button" variant="quiet" size="compact" onClick={() => setSelected({ section: 'audit_changes', parent: row.id, title: 'Detail perubahan audit' })}>Lihat perubahan</Button>
                </div>;
            }}/>)}
    <p className="text-[13px] text-brand-secondary">SJ Kembali adalah pengembalian dokumen. Retur barang belum terjual adalah tindakan stok yang terpisah.</p>
    {selected && <COCard title={selected.title}>
        <Button type="button" variant="quiet" size="compact" onClick={() => setSelected(null)}>Tutup rincian</Button>
        <COHistorySection co={co} section={selected.section} parent={selected.parent} title={selected.title} onAuthorityFailure={onAuthorityFailure} renderRow={r => <p>{r.display_sku ?? r.path} · {r.product_name ?? (r.side === 'before' ? 'Sebelum' : r.side === 'after' ? 'Sesudah' : r.side)} · {r.quantity ?? r.value ?? '—'}</p>}/>
        </COCard>}
    {sj && <CODeliveryDialog onAuthorityFailure={onAuthorityFailure} key={JSON.stringify(sj)} co={co} draftId={sj.draftId} correctionSource={sj.correctionSource} readBlocked={refreshing} readFailure={readFailure} returnFocus={trigger.current} onClose={() => setSJ(null)} onSaved={reload}/>}
    {returnSelection && <COReturnDialog key={JSON.stringify(returnSelection)} customerId={co.customer_id} customerVersion={co.customer_version}
        selection={returnSelection} returnFocus={trigger.current} onClose={() => setReturnSelection(null)} onSaved={reload}
        blocked={refreshing} readFailure={readFailure} onAuthorityFailure={onAuthorityFailure}/>}
    {settlement && <COSettlementDialog key={settlement} co={co} operation={settlement} returnFocus={trigger.current}
        onClose={() => setSettlement(null)} onSaved={reload} blocked={refreshing} readFailure={readFailure} onAuthorityFailure={onAuthorityFailure}/>}
    {cancel && <COCancelDialog editorKey={`cancel:${actor.scope}`} pending={pending} blocked={refreshing} readFailure={readFailure} error={error} onClose={() => setCancel(false)} onConfirm={cancelOrder} returnFocus={trigger.current}/>}
  </div>;
}
/** Later stages can reuse bounded exact section paging, with explicit scope and immutable parent identity. */
export function COHistorySection({ co, section, title, parent = null, renderRow, onAuthorityFailure }: {
    co: COOrderRecord;
    section: COSection;
    title: string;
    parent?: string | null;
    renderRow: (row: Record<string, any>) => ReactNode;
    onAuthorityFailure?: (error: unknown) => void;
}) {
    const actor = useCOActor(`history:${co.id}:${co.customer_id}:${co.co_version}:${co.customer_version}:${co.generation_id}:${section}:${parent}`);
    const [page, setPage] = useState(1);
    const args = { p_co_id: co.id, p_section: section, p_parent_id: parent, p_expected_version: co.co_version, p_expected_customer_version: co.customer_version, p_page: page, p_page_size: 20 };
    const query = useCORead(actor, `section:${section}`, args, async o => {
        const notify = onAuthorityFailure;
        try { return await fetchCODetailSection(args, o); }
        catch (error) {
            if (actor.isCurrent() && isCOAuthorityError(error)) notify?.(error);
            throw error;
        }
    });
    useEffect(() => setPage(1), [co.id, co.co_version, co.customer_version, parent]);
    return <COCard title={title}>{section === 'audit' && <p className="mb-3 text-base text-brand-secondary">Perubahan yang terkait CO ini serta laporan seluruh pelanggan. Laporan pelanggan dapat mendahului pembuatan CO ini. Identitas aktor lengkap tersedia pada detail teknis.</p>}{query.isError ? <COFailure error={query.error} retry={() => void query.refetch()}/> : query.isPending ? <LoadingState title="Memuat riwayat…" shape="list" /> : <>
        <div className="divide-y divide-gray-100">{query.data?.rows.map((r: Record<string, any>) => <div className="py-3 text-base break-words" key={r.id}>{renderRow(r)}</div>)}</div>{query.data?.rows.length === 0 && <p className="text-base text-brand-secondary">Belum ada catatan.</p>}<COPagination page={page} total={query.data?.total ?? '0'} pending={query.isFetching} onPage={setPage}/>
        </>}</COCard>;
}
