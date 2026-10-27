import type { COOrderLine } from '../../lib/co/validation';
import { minorUnits } from '../../lib/co/validation';
import { formatCOMinorUnits } from '../../lib/co/catalog';
import { formatMoney } from '../../lib/reads/money';
import { ActionLink } from '../ui/ActionLink';
import { quantityText } from './COShared';

/** One version-bound page of existing decoded CO lines; never performs its own read. */
export default function COOrderDetailTable({ lines, customerId }: { lines: readonly COOrderLine[]; customerId: string }) {
    return <div className="overflow-x-auto" role="region" aria-label="Rincian barang pesanan" tabIndex={0}>
        <table aria-label="Barang pesanan CO" className="w-full min-w-[52rem] text-sm">
            <thead className="bg-gray-50 text-brand-secondary"><tr>{['SKU', 'Nama barang', 'Satuan', 'Dipesan', 'Dikirim', 'Belum dikirim', 'Harga satuan CO', 'Total baris CO'].map((label, index) => <th scope="col" key={label} className={`px-3 py-2 font-medium ${index > 2 ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
            <tbody>{lines.map(line => <tr key={line.id} className="border-t border-brand-divider">
                <td className="px-3 py-2 font-mono"><ActionLink variant="quiet" size="compact" aria-label={`Lihat mutasi ${line.display_sku}`} to={`/athel/co/stock?${new URLSearchParams({customer:customerId,sku:line.display_sku,stockKey:line.stock_key_id,movementCustomer:customerId})}`}>{line.display_sku}</ActionLink></td>
                <td className="px-3 py-2">{line.product_name}</td>
                <td className="px-3 py-2 text-brand-secondary"><span aria-label="Satuan tidak tersedia pada pembacaan ini" title="Satuan tidak tersedia pada pembacaan ini">—</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{quantityText(line.ordered_quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{quantityText(line.delivered_quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{quantityText(line.pending_quantity)}{BigInt(line.resolved_undelivered_quantity) > 0n && <small className="block text-brand-secondary">Diselesaikan: {quantityText(line.resolved_undelivered_quantity)}</small>}</td>
                <td className="px-3 py-2 text-right tabular-nums">Rp {formatMoney(line.unit_price, 'full')}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">Rp {formatMoney(formatCOMinorUnits(BigInt(line.ordered_quantity) * minorUnits(line.unit_price)), 'full')}</td>
            </tr>)}</tbody>
        </table>
    </div>;
}
