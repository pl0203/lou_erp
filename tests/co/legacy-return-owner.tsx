import React, { useRef, useState } from 'react';
import COReturnDialog, { type COReturnSelection } from '../../src/components/co/COReturnDialog';
import { customer } from './stock-ui-harness';

/** Explicit historical editor-owner test mount; not a current App navigation entry.
 * The fixture supplies the current customer version that the former parent read.
 * Do not use this shell to claim today's app permits new legacy draft creation.
 */
export function LegacyReturnOwner({ state, selection, openerLabel = 'Retur barang belum terjual' }: { state: { cv: string }; selection?: COReturnSelection; openerLabel?: string }) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    return <><h1>Legacy return owner</h1><button ref={trigger} onClick={() => setOpen(true)}>{openerLabel}</button>
        {open && <COReturnDialog customerId={customer} customerVersion={state.cv} selection={selection} returnFocus={trigger.current} onClose={() => setOpen(false)}/>}</>;
}
