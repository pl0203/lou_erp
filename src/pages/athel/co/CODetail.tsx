import COSourceProposalResume from '../../../components/co/COSourceProposalResume';
import { coSourceProposalRequest } from '../../../lib/co/workspaceReads';
import COOrderDetailTable from '../../../components/co/COOrderDetailTable';
import { LoadingState } from '../../../components/ui/LoadingState'
import { ActionLink } from '../../../components/ui/ActionLink';
import { Button } from '../../../components/ui/Button';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { fetchCODetail, fetchCODetailSection } from '../../../lib/co/rpc';
import type { COOrderRecord, COOrderLine, COSection } from '../../../lib/co/validation';
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
import { COBadges, CO_LIFECYCLE, COCard, COFailure, COPagination, CORecoveryPanel, quantityText, useCOActor, useCORead } from '../../../components/co/COShared';
export default function CODetail() {
    const { id } = useParams();
    return <COSourceBoundary source={`detail:${id}`} check={options => fetchCODetail(id!, null, options)}><CODetailOwner key={id}/></COSourceBoundary>;
}
function CODetailOwner() {
    const { id } = useParams();
    const actor = useCOActor(`detail:${id}`);
    const location = useLocation();
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
    try { const request=coSourceProposalRequest(new URLSearchParams(location.search),query.data.co.customer_id);if(request)return <COSourceProposalResume key={JSON.stringify(request)} request={request} parentBlocked={query.isFetching||query.isError} parentFailure={query.isError?<COFailure error={query.error} retry={()=>void query.refetch()}/>:null} owner={{kind:'delivery',co:query.data.co as COOrderRecord}}/>; } catch(error) { return <COFailure error={error}/>; }
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
    const location = useLocation();
    const from = (location.state as { coOrdersURL?: unknown } | null)?.coOrdersURL;
    const listURL = typeof from === 'string' && /^\/athel\/co(?:\?[^#]*)?$/.test(from) ? from : '/athel/co';
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
    ][] = [['lines', 'Barang pesanan'], ['deliveries', 'Surat jalan'], ['sj_drafts', 'Draft Surat Jalan'], ['return_drafts', 'Pemulihan draft retur lama (semua sumber pelanggan)'], ['audit', 'Audit CO dan laporan pelanggan']];
    return <div className="co-detail max-w-6xl mx-auto">
    <nav aria-label="Jejak halaman CO"><ActionLink variant="quiet" size="compact" to={listURL}>Pesanan CO</ActionLink><span aria-hidden="true"> / </span><span aria-current="page">Detail pesanan</span></nav>
    {!sj && !cancel && !returnSelection && !settlement && readFailure}
    <COStatusActions heading={<div className="co-detail-heading"><div className="co-detail-heading__title"><h1>{co.co_number}</h1><COBadges status={co.status} progress={co.summary.delivery_progress}/></div><p>{co.customer_name} · {formatDisplayDate(co.order_date)}</p></div>} co={co} id={co.id} customerId={co.customer_id} allowed={allowed} blockers={blockers} pending={pending || refreshing || sender.hasUnresolved()} onSJ={() => { trigger.current = document.activeElement as HTMLElement; setSJ({}); }} onCancel={() => { trigger.current = document.activeElement as HTMLElement; setCancel(true); }}
        onResolve={() => { trigger.current = document.activeElement as HTMLElement; setSettlement('resolve_undelivered'); }}
        onClose={() => { trigger.current = document.activeElement as HTMLElement; setSettlement('close_co'); }}/>

    <COCard title="Ringkasan CO ini">
        <p className="mb-3 text-sm text-brand-secondary">Sejak pembuatan CO ini. Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.</p>
        <dl className="mb-4 text-sm"><div><dt className="text-brand-secondary">Status CO</dt><dd className="font-medium">{CO_LIFECYCLE[co.status]}</dd></div></dl>
        <dl className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><dt className="text-sm text-brand-secondary">Nilai rencana CO</dt><dd className="font-medium tabular-nums">Rp {formatMoney(co.summary.planned_value, 'full')}</dd></div>
            <div><dt className="text-sm text-brand-secondary">Pendapatan terjual</dt><dd className="font-medium tabular-nums">Rp {formatMoney(co.summary.revenue, 'full')}</dd></div>
        </dl>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><dt className="text-sm text-brand-secondary">Jumlah terkirim</dt><dd className="font-medium tabular-nums">{quantityText(co.summary.delivered_quantity)}</dd></div>
            <div><dt className="text-sm text-brand-secondary">Jumlah terjual</dt><dd className="font-medium tabular-nums">{quantityText(co.summary.sold_quantity)}</dd></div>
            <div><dt className="text-sm text-brand-secondary">Jumlah retur belum terjual</dt><dd className="font-medium tabular-nums">{quantityText(co.summary.returned_quantity)}</dd></div>
            <div><dt className="text-sm text-brand-secondary">Stok tercatat</dt><dd className="font-medium tabular-nums">{quantityText(co.summary.remaining_quantity)}</dd></div>
        </dl>
        <dl className="mt-4 text-sm"><div><dt className="text-brand-secondary">PIC dikreditkan saat CO dibuat (riwayat, hanya baca)</dt><dd className="font-medium">{co.sales_attribution_state === 'unassigned' ? 'Belum ditetapkan' : co.sales_person_name ?? 'Nama PIC tidak tersedia'}</dd></div></dl>
    </COCard>

    {settlementSender.hasUnresolved() && <Button type="button" variant="quiet" size="compact" disabled={refreshing || pending} onClick={e => { trigger.current = e.currentTarget; setSettlement('recovery'); }}>Pulihkan penyelesaian CO</Button>}
    <CORecoveryPanel pending={pending} sender={sender} current={actor.isCurrent} accept={async (r) => { if (r.operation !== 'cancel_co' || r.id !== co.id)
        throw new Error('Pemulihan tidak sesuai CO.'); await sender.acknowledgeRecovered(); if (actor.isCurrent()) {
        setCancel(false);
        reload();
        return true;
    } return false; }}/>
    {sections.map(([section, title]) => <COHistorySection key={section} co={co} section={section} title={title} collapsed={!['lines', 'deliveries'].includes(section)} onAuthorityFailure={onAuthorityFailure} renderRow={row => {
                if (section === 'sj_drafts')
                    return <div className="flex flex-wrap justify-between gap-2">
                    <span>{row.sj_number} · {formatDisplayDate(row.sj_date)} · {row.consumed ? 'Sudah diposting' : row.mode === 'delivery_correction' ? 'Draft koreksi' : 'Draft'}</span>
                    <Button variant="quiet" size="compact" type="button" disabled={refreshing || row.consumed} onClick={e => { trigger.current = e.currentTarget; setSJ({ draftId: row.id }); }}>Buka draft</Button>
                    </div>;
                if (section === 'deliveries')
                    return <tr className="border-t border-brand-divider">
                    <td className="px-3 py-2 font-medium">{row.sj_number}<small className="block text-brand-secondary">Revisi {row.revision_no}</small></td>
                    <td className="px-3 py-2">{formatDisplayDate(row.sj_date)}</td>
                    <td className="px-3 py-2">{row.is_void ? 'Dibatalkan' : row.is_effective ? 'Tercatat' : 'Historis'}{row.received_date && <small className="block text-brand-secondary">Dokumen kembali: {formatDisplayDate(row.received_date)}</small>}</td>
                    <td className="px-3 py-2"><Button variant="quiet" size="compact" type="button" onClick={() => setSelected({ section: 'delivery_lines', parent: row.id, title: `Barang ${row.sj_number} revisi ${row.revision_no}` })}>Lihat barang SJ</Button>
                    {row.is_effective && row.current_revision_id === row.id && allowed.includes('correct_sj') && <details className="mt-1"><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-sm font-medium">Tindakan lainnya</summary><div className="flex flex-wrap gap-2 mt-2"><Button variant="quiet" size="compact" disabled={refreshing} onClick={e=>{trigger.current=e.currentTarget;setSJ({correctionSource:{headId:row.head_id,revisionId:row.id,version:row.head_version,action:'replace'}})}}>Siapkan pengganti SJ</Button>{!row.is_void&&<Button variant="danger-quiet" size="compact" disabled={refreshing} onClick={e=>{trigger.current=e.currentTarget;setSJ({correctionSource:{headId:row.head_id,revisionId:row.id,version:row.head_version,action:'void'}})}}>Batalkan SJ dengan koreksi</Button>}</div></details>}
                    </td></tr>;
                if (section === 'reports')
                    return <ActionLink variant="quiet" size="compact" to={`/athel/co/reports/${co.customer_id}/${row.report_month}${row.revision_id ? `?revision=${row.revision_id}` : ''}`}>{formatCOReportMonth(row.report_month)} · Revisi {row.revision_no ?? row.report_version} · Bukti revisi tersimpan</ActionLink>;
                if (section === 'return_drafts') return <div className="space-y-2">
                    <p>{row.reference ?? row.reason ?? 'Draft retur'} · {formatDisplayDate(row.return_date)} · {row.line_count} sumber seluruh pelanggan{row.consumed ? ' · Sudah diposting' : ''}</p>
                    <Button variant="quiet" size="compact" disabled={refreshing || row.consumed} onClick={e => {
                        trigger.current = e.currentTarget;
                        setReturnSelection({ view: 'draft', id: row.id, draftVersion: row.draft_version });
                    }}>Pulihkan draft retur lama</Button>
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
                <p className="text-[13px] text-brand-secondary">{formatAuditTimestamp(row.created_at, 'WIB')}</p>
                {row.reason && <p className="text-base">Alasan: {row.reason}</p>}
                <details className="text-[13px]"><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer">Detail teknis audit</summary><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(row, null, 2)}</pre></details>
                <Button type="button" variant="quiet" size="compact" onClick={() => setSelected({ section: 'audit_changes', parent: row.id, title: 'Detail perubahan audit' })}>Lihat perubahan</Button>
                </div>;
            }}/>)}
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
export function COHistorySection({ co, section, title, parent = null, renderRow, onAuthorityFailure, collapsed = false }: {
    co: COOrderRecord;
    section: COSection;
    title: string;
    parent?: string | null;
    collapsed?: boolean;
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
    useEffect(() => {
        if (query.isFetching || !query.data) return;
        const count = BigInt(query.data.total);
        const last = count === 0n ? 1n : (count + 19n) / 20n;
        // Conversion is exact: last is smaller than an already bounded current page.
        if (BigInt(page) > last) setPage(Number(last));
    }, [query.isFetching, query.data?.total, page]);
    const body = <>{section === 'audit' && <p className="mb-3 text-sm text-brand-secondary">Perubahan CO ini dan laporan pelanggan yang sama (semua CO); identitas lengkap tersedia pada detail teknis.</p>}{query.isError ? <COFailure error={query.error} retry={() => void query.refetch()}/> : query.isPending ? <LoadingState title="Memuat riwayat…" shape="list" /> : <>
        {section === 'lines' ? <><p className="co-detail-price-context">Harga kesepakatan CO · IDR</p><COOrderDetailTable lines={(query.data?.rows ?? []) as COOrderLine[]} customerId={co.customer_id}/><div className="co-detail-total"><span>{query.data?.total ?? '0'} barang</span><strong>Nilai CO: Rp {formatMoney(co.summary.planned_value, 'full')}</strong></div></> : section === 'deliveries' ? <div className="overflow-x-auto" role="region" aria-label="Tabel riwayat surat jalan" tabIndex={0}><table aria-label="Riwayat surat jalan" className="w-full min-w-[36rem] text-sm"><thead className="bg-gray-50 text-brand-secondary"><tr>{['Nomor surat jalan', 'Tanggal', 'Status', 'Actions'].map(label => <th key={label} scope="col" className="px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead><tbody>{query.data?.rows.map((r: Record<string, any>) => <Fragment key={r.id}>{renderRow(r)}</Fragment>)}</tbody></table></div> : <div className="divide-y divide-gray-100">{query.data?.rows.map((r: Record<string, any>) => <div className="py-3 text-sm break-words" key={r.id}>{renderRow(r)}</div>)}</div>}
        {query.data?.rows.length === 0 && <p className="text-sm text-brand-secondary">Belum ada catatan.</p>}
        {BigInt(query.data?.total ?? '0') > 20n && <COPagination page={page} total={query.data?.total ?? '0'} pending={query.isFetching} onPage={setPage}/>}
    </>}</>;
    return collapsed ? <details data-co-history className="rounded-[14px] border border-brand-divider bg-brand-surface p-4"><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer font-medium">{title}</summary><div className="mt-3">{body}</div></details> : <COCard title={title}>{body}</COCard>;
}
