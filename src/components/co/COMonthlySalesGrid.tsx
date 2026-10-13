import { useState } from 'react';
import type { ReactNode } from 'react';
import type { COReportRow } from '../../lib/co/validation';
import { CO_INPUT, COPagination, enteredQuantity } from './COShared';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
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
    return <><div role="region" aria-label="Baris penjualan laporan pelanggan" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded-[14px] focus-visible:outline-2 focus-visible:outline-brand-primary"><div className="min-w-[36rem] space-y-3">{rows.map(row => {
            const raw = entries[row.stock_key_id] ?? row.sold_quantity ?? '';
            let remaining: string | null = null;
            try {
                if (raw !== '' && row.eligible_quantity !== null)
                    remaining = (BigInt(row.eligible_quantity) - BigInt(enteredQuantity(raw, true))).toString();
            }
            catch { /* Invalid raw input is retained, never rounded. */ }
            return <div key={row.stock_key_id} data-co-report-row={row.stock_key_id} className="min-w-0 rounded-[14px] border border-brand-divider bg-brand-surface p-4 text-sm">
                <div className="grid grid-cols-3 gap-4">
                    <div className="min-w-0"><p className="font-semibold break-words">{row.product_name}</p><p>{row.display_sku}</p><p>Tersedia: {row.eligible_quantity ?? 'Belum tersedia'}</p></div>
                    {editable ? <Field id={`co-sold-${row.stock_key_id}`} label={`Terjual ${row.product_name}`}>
                        {control => <input {...control} className={CO_INPUT} inputMode="numeric" aria-label={`Terjual ${row.product_name}`} disabled={disabled} value={raw} onChange={e => onChange(row, e.target.value)}/>}
                    </Field> : <div><p>Terjual</p><span>{row.sold_quantity ?? 'Belum diisi'}</span></div>}
                    <div className="min-w-0"><p>{editable ? 'Sisa provisional' : 'Sisa periode tercatat'}: {remaining ?? 'Belum tersedia'}</p>{allocation && <Button type="button" variant="quiet" size="compact" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>Alokasi {row.product_name}</Button>}</div>
                </div>
                {expanded === row.id && allocation?.(row)}
            </div>;
        })}</div></div><COPagination page={page} total={total} pageSize={100} pending={disabled} onPage={onPage}/></>;
}
