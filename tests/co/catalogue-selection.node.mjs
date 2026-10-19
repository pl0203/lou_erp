import assert from 'node:assert/strict';
import test from 'node:test';
import { requireCOCatalogueProduct, selectCOStockIdentity, coHistoricalMaximum } from '../../src/lib/co/catalogueSelection.ts';
const product = { id: 'product-a', sku: 'SKU-A', name: 'Current name', is_enabled: true };
const key = { id: 'key-a', normalized_sku: 'sku-a', display_sku: 'Sku-A', product_id: product.id, product_name: 'Saved name' };
test('new selection requires extant enabled canonical product before stock reuse', () => {
  assert.equal(requireCOCatalogueProduct(product.id, ' SKU-A ', [product]), product);
  for (const [id, sku, rows] of [[null, 'SKU-A', [product]], ['missing', 'SKU-A', [product]], [product.id, 'OTHER', [product]], [product.id, product.sku, [{ ...product, is_enabled: false }]]]) {
    assert.throws(() => requireCOCatalogueProduct(id, sku, rows), /katalog aktif/);
  }
});
test('same-product reuse keeps the immutable saved label and selected product', () => {
  assert.deepEqual(selectCOStockIdentity(product, key), { stock_key_id: key.id, product_id: product.id, product_name: key.product_name, sku: key.display_sku });
});
test('legacy null, different product and mismatched SKU keys cannot be relinked', () => {
  for (const source of [{ ...key, product_id: null }, { ...key, product_id: 'old-product' }, { ...key, normalized_sku: 'other' }, { ...key, display_sku: 'OTHER' }]) {
    assert.throws(() => selectCOStockIdentity(product, source), /identitas stok/);
  }
});
test('disabled customer caps every saved line independently including manual history', () => {
  assert.equal(coHistoricalMaximum(null, '2', false, []), '2');
  assert.equal(coHistoricalMaximum(product.id, '7', false, [product]), '7');
});
test('disabled product caps its own saved line without constraining enabled/manual lines', () => {
  assert.equal(coHistoricalMaximum(product.id, '2', true, [{ ...product, is_enabled: false }]), '2');
  assert.equal(coHistoricalMaximum(product.id, '2', true, [product]), undefined);
  assert.equal(coHistoricalMaximum(null, '2', true, []), undefined);
});
test('renaming an enabled product does not cap or rewrite its saved historical identity', () => {
  assert.equal(coHistoricalMaximum(product.id, '2', true, [{ ...product, name: 'Renamed', sku: 'RENAMED' }]), undefined);
});
