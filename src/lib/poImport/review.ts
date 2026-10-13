import type { Customer, FormDraft, Issue, ParsedPO, Product, ReviewDecision } from './contracts';
import { isValidPrice, resolveCatalogPrice } from '../catalogPricing';
import { nameKey, skuKey } from './matching';
import { decimalCents, validISODate } from './numbers';
import { issue } from './layouts/structural';
const FINANCIAL_REVIEW_CODES = new Set(['tax-review', 'total-mismatch', 'line-total-mismatch', 'catalog-price-difference', 'catalog-price-missing', 'unsupported-charge']);
/** The only financial warning codes that can be explicitly acknowledged. Integrity/validation blockers are excluded. */
export function isFinancialReviewIssue(issue: Issue): boolean {
    return FINANCIAL_REVIEW_CODES.has(issue.code);
}
function financialBinding(parsed: ParsedPO, decision: ReviewDecision, customer: Customer | null, products: Product[]): string {
    // Full, collision-free semantic serialization, not a short hash. At most 100 source rows participate.
    const rows = parsed.rows.map(row => {
        const reviewed = decision.rows[row.id];
        if (!reviewed)
            return [row.id, null];
        const candidates = products.filter(product => product.id === reviewed.productId);
        const product = candidates.length === 1 ? candidates[0] : null;
        return [row.id, reviewed.productId, reviewed.manual, reviewed.sku, reviewed.name,
            reviewed.quantity.trim(), reviewed.unitPrice?.trim() || null, reviewed.unitConfirmed,
            product ? [product.id, product.sku, product.name, resolveCatalogPrice(product, customer?.pricing_tier)] : null];
    });
    return JSON.stringify([customer ? [customer.id, customer.name, customer.pricing_tier] : [decision.customerId, null], parsed.currency.value, parsed.printedTotal, rows]);
}
function centsText(cents: bigint): string {
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
/** Apply a reviewed in-memory draft only. This module never writes an order. */
export function preparePOFormDraft(parsed: ParsedPO, decision: ReviewDecision, customers: Customer[], products: Product[]): {
    draft: FormDraft | null;
    issues: Issue[];
} {
    const issues: Issue[] = [];
    const add = (field: string, code: string, message: string, blocking = true, id = `${field}:${code}`) => issues.push(issue(field, code, message, blocking, id));
    const acknowledgements = new Set(decision.acknowledgedIssueIds);
    // Source integrity failures are never dismissible. Editable values are checked anew below.
    const editable = new Set(['poNumber', 'orderDate', 'expiry', 'buyer', 'currency']);
    for (const source of parsed.issues) {
        if (source.blocking && !editable.has(source.field))
            issues.push(source);
        else if (!source.blocking)
            issues.push(source);
    }
    if (!parsed.complete || !['photo-grid', 'unpriced-indent', 'priced-indent', 'depot-table'].includes(parsed.layout || ''))
        add('document', 'incomplete-extraction', 'Sumber tidak lengkap atau tidak didukung; gunakan input manual.');
    if (!parsed.rows.length || parsed.rows.length > 100)
        add('document', 'row-limit', 'Impor harus memuat 1–100 baris sumber.');
    const currentCustomers = customers.filter(c => c.id === decision.customerId);
    const customer = currentCustomers.length === 1 ? currentCustomers[0] : null;
    if (!customer)
        add('buyer', 'unresolved-buyer', 'Pilih pelanggan dari katalog yang tersedia saat ini.');
    if (!decision.poNumber.trim())
        add('poNumber', 'po-number-missing', 'Nomor PO wajib diisi.');
    if (!validISODate(decision.orderDate))
        add('orderDate', 'invalid-date', 'Tanggal pesanan wajib valid.');
    if (decision.expiry && !validISODate(decision.expiry))
        add('expiry', 'invalid-date', 'Tanggal expiry harus valid.');
    if (parsed.currency.value && parsed.currency.value !== 'IDR')
        add('currency', 'foreign-currency', 'Harga mata uang asing tidak dapat diterapkan sebagai IDR.');
    else if (!parsed.currency.value && !decision.idrConfirmed)
        add('currency', 'currency-unconfirmed', 'Konfirmasi harga dalam IDR terlebih dahulu.');
    const rowIds = parsed.rows.map(r => r.id);
    if (new Set(rowIds).size !== rowIds.length || Object.keys(decision.rows).length !== rowIds.length || Object.keys(decision.rows).some(id => !rowIds.includes(id)))
        add('rows', 'unreviewed-row', 'Setiap baris sumber harus ditinjau, tanpa menambah atau menghapus baris.');
    const lineItems: FormDraft['lineItems'] = [];
    let total = 0n;
    for (const row of parsed.rows) {
        const reviewed = decision.rows[row.id], prefix = `rows.${row.id}`;
        if (!reviewed) {
            add(prefix, 'unreviewed-row', 'Baris sumber belum ditinjau.');
            continue;
        }
        const selected = products.filter(p => p.id === reviewed.productId);
        const product = selected.length === 1 ? selected[0] : null;
        if (reviewed.manual && reviewed.productId)
            add(prefix, 'contradictory-mapping', 'Pilih satu barang katalog atau baris manual.');
        if (!reviewed.manual && !product)
            add(prefix, 'unresolved-product', 'Pilih barang dari katalog yang tersedia saat ini atau pilih manual.');
        if (product && !reviewed.manual && (skuKey(reviewed.sku) !== skuKey(product.sku) || nameKey(reviewed.name) !== nameKey(product.name)))
            add(prefix, 'stale-product', 'Nama atau SKU pilihan katalog berubah; pilih ulang barang.');
        if (!reviewed.name.trim())
            add(`${prefix}.name`, 'missing-name', 'Nama barang wajib diisi.');
        const quantityText = reviewed.quantity.trim(), quantity = Number(quantityText);
        if (!/^\d+$/.test(quantityText) || !Number.isSafeInteger(quantity) || quantity <= 0)
            add(`${prefix}.quantity`, 'invalid-quantity', 'Jumlah harus bilangan bulat positif; tidak ada konversi otomatis.');
        if (!reviewed.unitConfirmed)
            add(`${prefix}.uom`, 'unit-unconfirmed', 'Konfirmasi kesesuaian satuan dengan jumlah dan barang.');
        const priceText = reviewed.unitPrice?.trim() || '', price = priceText ? Number(priceText) : Number.NaN;
        if (!priceText) {
            const id = `${row.id}:missing-price`;
            add(`${prefix}.unitPrice`, 'missing-price', 'Harga belum diisi; isi di form sebelum menyimpan.', !acknowledgements.has(id), id);
        }
        else if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || !isValidPrice(price))
            add(`${prefix}.unitPrice`, 'invalid-price', 'Harga harus nol atau positif, maksimal dua desimal dan batas harga katalog.');
        else if (price === 0) {
            const id = `${row.id}:zero-price`;
            add(`${prefix}.unitPrice`, 'zero-price', 'Konfirmasi harga nol yang telah ditinjau.', !acknowledgements.has(id), id);
        }
        if (product && customer && !reviewed.manual) {
            const catalog = resolveCatalogPrice(product, customer.pricing_tier);
            if (catalog === null)
                add(`${prefix}.unitPrice`, 'catalog-price-missing', 'Harga tier pelanggan belum tersedia; tier lain tidak digunakan.', false);
            else if (priceText && decimalCents(String(catalog)) !== decimalCents(priceText))
                add(`${prefix}.unitPrice`, 'catalog-price-difference', 'Harga yang ditinjau berbeda dari harga tier katalog saat ini.', false);
        }
        // Keep source warnings visible; reviewed fields resolve their original uncertainty, not the integrity blockers.
        const resolvable = new Set(['fractional-quantity', 'unknown-number', 'unit-mismatch', 'quantity-mismatch', 'low-confidence', 'ambiguous-price', 'missing-name']);
        issues.push(...row.issues.filter(i => !['missing-price', 'zero-price'].includes(i.code)).map(i => ({ ...i, blocking: i.blocking && !resolvable.has(i.code) })));
        const cents = decimalCents(priceText);
        if (cents !== null && Number.isSafeInteger(quantity) && quantity > 0)
            total += BigInt(quantity) * cents;
        lineItems.push({ _key: row.id, product_id: reviewed.manual ? null : product?.id || null, product_name: reviewed.manual ? reviewed.name.trim() : product?.name || reviewed.name.trim(), sku: reviewed.manual ? reviewed.sku.trim() : product?.sku || reviewed.sku.trim(), quantity, unit_price: price });
    }
    const printed = decimalCents(parsed.printedTotal.value);
    if (printed !== null && lineItems.length === parsed.rows.length && lineItems.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0 && isValidPrice(line.unit_price))) {
        // Current reviewed amounts can resolve an old source mismatch or create a new one; never adjust them to the printout.
        for (let index = issues.length - 1; index >= 0; index--)
            if (issues[index].code === 'total-mismatch')
                issues.splice(index, 1);
        if (printed !== total)
            add('printedTotal', 'total-mismatch', `Total sumber ${parsed.printedTotal.raw} berbeda dari total barang yang ditinjau ${centsText(total)}. Periksa komponen biaya dan pajak; harga tidak diubah otomatis.`, false);
    }
    const binding = financialBinding(parsed, decision, customer, products);
    for (let index = 0; index < issues.length; index++) {
        const warning = issues[index];
        if (!isFinancialReviewIssue(warning))
            continue;
        const id = `${warning.id}:review:${encodeURIComponent(JSON.stringify([binding, warning.field, warning.code, warning.message]))}`;
        issues[index] = { ...warning, id, blocking: !acknowledgements.has(id) };
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER) * 100n)
        add('rows', 'total-overflow', 'Total pesanan terlalu besar.');
    if (issues.some(i => i.blocking))
        return { draft: null, issues };
    return { draft: { customerId: decision.customerId, poNumber: decision.poNumber.trim(), orderDate: decision.orderDate, expectedDelivery: decision.expiry, notes: decision.notes, lineItems }, issues };
}
