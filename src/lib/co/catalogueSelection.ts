type Product = { id: string; sku: string; name: string; is_enabled: boolean };
export type COSelectedStockKey = { id: string; product_id: string | null; normalized_sku: string; display_sku: string; product_name: string };
const normalizeSKU = (sku: string) => sku.trim().toLowerCase();

/** New demand must resolve the selected master before any customer/SKU key is considered. */
export function requireCOCatalogueProduct<T extends Product>(id: string | null, sku: string, products: readonly T[]): T {
    const product = products.find(row => row.id === id);
    if (!product?.is_enabled || !normalizeSKU(sku) || normalizeSKU(product.sku) !== normalizeSKU(sku))
        throw new Error('Barang baru harus dipilih dari katalog aktif dengan SKU yang sesuai.');
    return product;
}

/** A saved key may retain its label, never replace the selected product identity. */
export function selectCOStockIdentity(product: Product, source: COSelectedStockKey | Record<string, unknown>) {
    if (typeof source.id !== 'string' || typeof source.product_name !== 'string' || typeof source.display_sku !== 'string' || !product.is_enabled || source.product_id !== product.id || source.normalized_sku !== normalizeSKU(product.sku)
        || normalizeSKU(source.display_sku) !== normalizeSKU(product.sku))
        throw new Error('SKU memiliki identitas stok lama yang berbeda atau tanpa produk katalog. Pilih produk lain; identitas stok tidak dapat diganti.');
    return { stock_key_id: source.id, product_id: product.id, product_name: source.product_name, sku: source.display_sku };
}

/** Saved/manual lines retain their rules; only inactive references impose a per-line ceiling. */
export function coHistoricalMaximum(productId: string | null, savedQuantity: string, customerEnabled: boolean, products: readonly Product[]): string | undefined {
    return !customerEnabled || productId !== null && !products.find(row => row.id === productId)?.is_enabled ? savedQuantity : undefined;
}
