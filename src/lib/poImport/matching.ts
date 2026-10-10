import type { Customer, Matches, ParsedPO, Product } from './contracts';
export function skuKey(value: string): string { return value.trim().toLowerCase(); }
export function nameKey(value: string): string { return value.trim().replace(/\s+/g, ' ').toLowerCase(); }
/** Suggestions only. Source buyer codes and barcodes are not ERP master identity. */
export function matchPODraft(parsed: ParsedPO, customers: Customer[], products: Product[]): Matches {
    const buyer = nameKey(parsed.buyer.value || '');
    return { customerIds: buyer ? customers.filter(c => nameKey(c.name) === buyer).map(c => c.id) : [], productIdsByRow: Object.fromEntries(parsed.rows.map(row => {
            const sku = skuKey(row.sku.value || ''), name = nameKey(row.name.value || '');
            return [row.id, products.filter(p => (sku && skuKey(p.sku) === sku) || (name && nameKey(p.name) === name)).map(p => p.id)];
        })) };
}
