import { expect, test } from 'vitest';
import { requireCOCatalogueProduct, selectCOStockIdentity, coHistoricalMaximum } from '../../src/lib/co/catalogueSelection';
const product = { id: 'product-a', sku: 'SKU-A', name: 'Current name', is_enabled: true };
const key = { id: 'key-a', normalized_sku: 'sku-a', display_sku: 'Sku-A', product_id: product.id, product_name: 'Saved name' };
test('selection validates enabled canonical identity before preserving a same-product key label', () => {
    expect(requireCOCatalogueProduct(product.id, ' sku-a ', [product])).toBe(product);
    expect(selectCOStockIdentity(product, key)).toEqual({ stock_key_id: key.id, product_id: product.id, product_name: 'Saved name', sku: 'Sku-A' });
    for (const [id, sku, products] of [[null, 'SKU-A', [product]], ['missing', 'SKU-A', [product]], [product.id, 'other', [product]], [product.id, 'SKU-A', [{ ...product, is_enabled: false }]]] as const)
        expect(() => requireCOCatalogueProduct(id, sku, products)).toThrow(/katalog aktif/);
    for (const source of [{ ...key, product_id: null }, { ...key, product_id: 'different' }, { ...key, normalized_sku: 'different' }])
        expect(() => selectCOStockIdentity(product, source)).toThrow(/identitas stok/);
});
test('historical caps stay per-line and enabled renamed products/manual rows keep normal rules', () => {
    expect(coHistoricalMaximum(null, '2', false, [])).toBe('2');
    expect(coHistoricalMaximum(product.id, '7', false, [product])).toBe('7');
    expect(coHistoricalMaximum(product.id, '2', true, [{ ...product, is_enabled: false }])).toBe('2');
    expect(coHistoricalMaximum(product.id, '2', true, [{ ...product, name: 'Renamed', sku: 'RENAMED' }])).toBeUndefined();
    expect(coHistoricalMaximum(null, '2', true, [])).toBeUndefined();
});
