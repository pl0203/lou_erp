import { useState } from 'react';
import type { ReactNode } from 'react';
import type { COReportRow } from '../../lib/co/validation';
import { CO_INPUT, CO_BUTTON, COPagination, enteredQuantity } from './COShared';
export default function COMonthlySalesGrid({ rows, entries, editable, disabled, onChange, page, total, onPage, allocation }: {
    rows: COReportRow[];
    entries: Record<string, string>;
    editable: boolean;
    disabled: boolean;
    onChange: (row: COReportRow, raw: string) => void;
    page: number;
    total: string;
    onPage: (page: number) => void;
    allocation?: (row: COReportRow) => ReactNode;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    return <><div className="space-y-3">{rows.map(row => {
            const raw = entries[row.stock_key_id] ?? row.sold_quantity ?? '';
            let remaining: string | null = null;
            try {
                if (raw !== '' && row.eligible_quantity !== null)
                    remaining = (BigInt(row.eligible_quantity) - BigInt(enteredQuantity(raw, true))).toString();
            }
            catch { /* Invalid raw input is retained, never rounded. */ }
            return <div key={row.stock_key_id} className="rounded-lg border border-gray-200 p-3 text-sm"><div className="grid gap-3 sm:grid-cols-3"><div><p className="font-medium break-words">{row.product_name}</p><p>{row.display_sku}</p><p>Tersedia: {row.eligible_quantity ?? 'Belum tersedia'}</p></div><label>Terjual {editable ? <input id={`co-sold-${row.stock_key_id}`} className={CO_INPUT} inputMode="numeric" aria-label={`Terjual ${row.product_name}`} disabled={disabled} value={raw} onChange={e => onChange(row, e.target.value)}/> : <span>{row.sold_quantity ?? 'Belum diisi'}</span>}</label><div><p>{editable ? 'Sisa provisional' : 'Sisa periode tercatat'}: {remaining ?? 'Belum tersedia'}</p>{allocation && <button type="button" className={CO_BUTTON} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>Alokasi {row.product_name}</button>}</div></div>{expanded === row.id && allocation?.(row)}</div>;
        })}</div><COPagination page={page} total={total} pageSize={100} pending={disabled} onPage={onPage}/></>;
}
