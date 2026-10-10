import { CORevisionAttachment } from './COEvidenceAttachment';
import { useState } from 'react';
import { isCOAuthorityError } from './COReportWorkspace';
import { fetchCOReportRows } from '../../lib/co/rpc';
import type { COReportRow } from '../../lib/co/validation';
import { COFailure, useCOActor, useCORead } from './COShared';
import COMonthlySalesGrid from './COMonthlySalesGrid';
import COAllocationDetails from './COAllocationDetails';
/** Explicit immutable revision; never project current effective rows into original evidence. */
export default function COReportRevisionEvidence({ customerId, month, customerVersion, revisionId, isEffective = false, onAuthorityFailure }: {
    customerId: string;
    month: string;
    customerVersion: string;
    revisionId: string;
    isEffective?: boolean;
    onAuthorityFailure?: (error: unknown) => void;
}) {
    const actor = useCOActor(`report-evidence:${customerId}:${month}:${customerVersion}:${revisionId}`), [page, setPage] = useState(1);
    const args = { p_customer_id: customerId, p_month: month, p_view: 'revision' as const, p_revision_id: revisionId, p_expected_draft_version: null, p_expected_customer_version: customerVersion, p_page: page, p_page_size: 100 };
    const read = useCORead(actor, 'report-revision', args, async o => {
        const notify = onAuthorityFailure;
        try { return await fetchCOReportRows(args, o); }
        catch (error) {
            if (actor.isCurrent() && isCOAuthorityError(error)) notify?.(error);
            throw error;
        }
    });
    return <section className="rounded-xl border border-gray-200 p-4 space-y-3"><h3 className="font-semibold break-all">Bukti revisi {isEffective ? 'efektif' : 'historis'} {revisionId}</h3><p className="text-xs">Baris dan alokasi asli yang tersimpan, termasuk baris nol tanpa alokasi. {isEffective ? 'Revisi ini masih efektif.' : 'Bukan versi efektif saat ini.'}</p>{read.isError ? <COFailure error={read.error} retry={() => void read.refetch()}/> : !read.data ? <p role="status">Memuat bukti revisi…</p> : <COMonthlySalesGrid rows={read.data.rows as COReportRow[]} entries={{}} editable={false} disabled={read.isFetching} onChange={() => { }} page={page} total={read.data.total} onPage={setPage} allocation={() => <COAllocationDetails customerId={customerId} month={month} customerVersion={customerVersion} revisionId={revisionId} onAuthorityFailure={onAuthorityFailure}/>}/>}<CORevisionAttachment customerId={customerId} revisionId={revisionId} onAuthorityFailure={onAuthorityFailure}/></section>;
}
