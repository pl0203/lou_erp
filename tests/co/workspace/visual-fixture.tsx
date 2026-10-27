/** Test-only synthetic 100-SKU data. Never registered as an application route.
 * A DOM render proves neither geometry nor native accessibility/PDF behavior.
 */
import { useState } from 'react';
import COImportReviewTable from '../../../src/components/co/COImportReviewTable';
import COStockTable from '../../../src/components/co/COStockTable';
import { validateReview } from '../../../src/lib/co/import/review';
import type { ReviewInput } from '../../../src/lib/co/import/types';
import type { COStockPageV2, StockFilters } from '../../../src/lib/co/contracts';
import { parseQuantity } from '../../../src/lib/co/validation';
import { input, row } from '../import/reviewFixture';
const id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const customer=id(2),month='2026-09-01';
const freshness={cutoff_date:'2026-10-09',next_required_report_month:month,pending_report_month_count:'2',overdue_report_month_count:'1',next_required_month_end:'2026-09-30',days_since_pending_month_end:'9',status:'missing_completed_period',zero_stock_reporting_pending:false};
export const VISUAL_VIEWPORTS = [{ width: 1180, height: 757 }, { width: 1440, height: 900 }, { width: 360, height: 800 }, { width: 390, height: 844 }] as const;
export const APPROVED_SCREENS = [
  ['Pesanan CO', '/athel/co'], ['Detail CO', `/athel/co/${id(10)}`],
  ['Laporan Penjualan Bulanan', `/athel/co/reports?customer=${customer}`],
  ['Upload laporan', `/athel/co/reports/${customer}/${month}`],
  ['Periksa laporan', 'same monthly route, loaded source'],
  ['Laporan tercatat', 'same monthly route, committed immutable revision'],
  ['Stok Pelanggan semua toko', '/athel/co/stock?pageSize=100'],
  ['Stok Pelanggan toko/SKU', `/athel/co/stock?customer=${customer}&sku=SKU-1&pageSize=100`],
] as const;
export function visualReview(): ReviewInput {
  const extracted = input().extracted;
  extracted.periodCandidates = [month];
  extracted.sourceRows = Array.from({ length: 100 }, (_, i) => row({ id: `r${i}`, name: i === 0 ? 'Nama barang sangat panjang untuk uji kepadatan dan akses teks lengkap' : `Barang sintetis ${i + 1}`, sourceSku: `SKU-${i + 1}`, unit: i % 2 ? 'BOX' : 'PCS', ref: { ...row().ref, row: String(i + 1) } }));
  extracted.sections[0].rowIds = extracted.sourceRows.map(r => r.id);
  return input({ scope: { actorId: id(1), customerId: customer, reportMonth: month, epoch: 1 }, extracted, mappings: extracted.sourceRows.map((r, i) => ({ rowId: r.id, stockKeyId: id(1001 + i), ledgerUnit: r.unit, quantity: parseQuantity('2'), conversion: null, included: true, exclusionReason: null, confirmed: true })) });
}
export function visualStock(): COStockPageV2 {
  return { version: '2', as_of: '2026-10-09T00:00:00Z', customer_id: null, customer_version: null, generation_id: null, sku: null, normalized_search: '', stock_as_of: null, period_start: '2026-10-01', coverage_date: '2026-10-09', sort: 'sku', direction: 'asc', page: 1, page_size: 100, total: '100', reporting_freshness: null,
    rows: Array.from({ length: 100 }, (_, i) => ({ id: id(1001 + i), stock_key_id: id(1001 + i), customer_id: customer, customer_name: 'Toko sintetis dengan nama panjang', customer_version: '1', generation_id: id(8000), normalized_sku: `sku-${i + 1}`, display_sku: `SKU-${i + 1}`, product_name: i === 0 ? 'Nama barang sangat panjang untuk menguji akses teks tanpa baris setinggi paragraf' : `Barang ${i + 1}`, product_id: null, unit: i % 3 === 0 ? null : i % 3 === 1 ? 'PCS' : 'BOX', unit_basis: i % 3 === 0 ? 'unknown' : 'declared_by_cutoff', unit_declaration: i % 3 === 0 ? null : { id: id(3000 + i), version: '1', unit: i % 3 === 1 ? 'PCS' : 'BOX', declared_at: '2026-08-01T00:00:00Z' }, opening_quantity: i === 0 ? '0' : '100', delivered_quantity: '0', sold_quantity: i === 0 ? '0' : '70', returned_quantity: '0', recorded_quantity: i === 0 ? '0' : '30', has_delivery_history: i !== 0, last_report_month: null, coverage_through_date: null, reporting_freshness: freshness, contract_stock_value: null, contract_currency: null, contract_unit_price: null, price_state: 'unknown', valuation_basis: null })).sort((a,b)=>a.normalized_sku.localeCompare(b.normalized_sku)) } as COStockPageV2;
}
export default function VisualFixture({ surface = 'stock' }: { surface?: 'stock' | 'review' }) {
  const [review, setReview] = useState(visualReview);
  const [filters, setFilters] = useState<StockFilters>({ customerId: null, sku: null, search: '', asOf: null, sort: 'sku', direction: 'asc', page: 1, pageSize: 100 });
  const stock = visualStock();
  const eligible = review.mappings.map(m => ({ stockKeyId: m.stockKeyId!, unit: m.ledgerUnit!, available: parseQuantity('100') }));
  return surface === 'stock' ? <COStockTable result={stock} filters={filters} onFiltersChange={setFilters} onOpenMovement={() => {}}/> : <COImportReviewTable input={review} validation={validateReview(review, eligible)} onChange={setReview}/>;
}
