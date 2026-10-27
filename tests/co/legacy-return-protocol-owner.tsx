import React, { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import App from '../../src/App';
import AthelNav from '../../src/components/AthelNav';
import COSourceBoundary from '../../src/components/co/COSourceBoundary';
import COReturnDialog from '../../src/components/co/COReturnDialog';
import COStockTable from '../../src/components/co/COStockTable';
import { COFailure, useCOActor, useCORead } from '../../src/components/co/COShared';
import { fetchCOStockV2 } from '../../src/lib/co/rpc';
import type { COStockPageV2, StockFilters } from '../../src/lib/co/contracts';

// Test-only host for retained legacy protocol. The normal stock-page action now
// navigates to Stock Return; these tests do not assert that old create UI exists.
// Real authority boundaries, query observers, dialog and navigation guards run.
export default function LegacyReturnProtocolOwner({ customerId }: { customerId: string }) {
    const location = useLocation();
    const filters: StockFilters = { customerId, sku: null, search: '', asOf: null, sort: 'sku', direction: 'asc', page: 1, pageSize: 25 };
    if (location.pathname !== '/athel/co/stock') return <App/>;
    return <><AthelNav/><COSourceBoundary source="stock" check={options => fetchCOStockV2(filters, options)}><Owner filters={filters}/></COSourceBoundary></>;
}
function Owner({ filters }: { filters: StockFilters }) {
    const actor = useCOActor(`stock:${JSON.stringify(filters)}`);
    const stock = useCORead(actor, 'customer-stock-v2', filters, async options => await fetchCOStockV2(filters, options) as COStockPageV2);
    const [returning, setReturning] = useState(false);
    const trigger = useRef<HTMLElement | null>(null);
    const result = stock.data;
    const blocked = stock.isFetching || stock.isError || !result;
    if (!actor.enabled) return null;
    return <>
        <button disabled={blocked} onClick={event => { trigger.current = event.currentTarget; setReturning(true); }}>Retur barang belum terjual</button>
        {stock.isError ? <COFailure error={stock.error}/> : result && !stock.isFetching ? <COStockTable result={result} filters={filters} onFiltersChange={() => {}} onOpenMovement={() => {}}/> : null}
        {returning && result && <COReturnDialog key={`${actor.scope}:return`} customerId={filters.customerId!} customerVersion={result.customer_version!} returnFocus={trigger.current} onClose={() => setReturning(false)} blocked={blocked} readFailure={stock.isError ? <COFailure error={stock.error}/> : null} onAuthorityFailure={actor.rejectAuthority} onSaved={() => { void stock.refetch(); }}/>}
    </>;
}
