import { expect, test } from 'vitest'
import { parseCatalogPrice, resolveCatalogPrice, resolvePromotionPrice, formatCatalogPrice } from '../src/lib/catalogPricing'
const product = { harga_pokok: 0, luar_kota: 12000, dalam_kota: null, depo_bangunan: 15000, unit_price: 999 }
test('resolves only the selected known tier and preserves real zero', () => {
  expect(resolveCatalogPrice(product, 'harga_pokok')).toBe(0)
  expect(resolveCatalogPrice(product, 'dalam_kota')).toBeNull()
  for (const tier of ['others', 'unknown', null, undefined]) expect(resolveCatalogPrice(product, tier)).toBeNull()
})
test('promotion resolves same tier only, preserves zero and fails closed for Others', () => {
  expect(resolvePromotionPrice({ harga_pokok: 0 }, 'harga_pokok')).toBe(0)
  expect(resolvePromotionPrice({ dalam_kota: null }, 'dalam_kota')).toBeNull()
  expect(resolvePromotionPrice({ luar_kota: 1 }, 'others')).toBeNull()
  expect(resolvePromotionPrice({ luar_kota: null }, 'luar_kota')).toBeNull()
})
test('blank catalog prices stay null while zero and exact cents are valid', () => {
  expect(parseCatalogPrice('')).toBeNull(); expect(parseCatalogPrice('  ')).toBeNull()
  expect(parseCatalogPrice('0')).toBe(0); expect(parseCatalogPrice('12.34')).toBe(12.34)
  expect(parseCatalogPrice('999999999999.99')).toBe(999999999999.99)
  for (const text of ['NaN','Infinity','-1','1.001','12oops','1e4','1000000000000']) expect(() => parseCatalogPrice(text)).toThrow()
  expect(formatCatalogPrice(null)).toBe('Belum diisi'); expect(formatCatalogPrice(0)).toBe('Rp 0')
})

test('malformed or out-of-range stored prices cannot become selectable prices', () => {
 for (const value of [NaN, Infinity, -1, 1.001, 1.000001, 0.000001, 1000000000000]) expect(resolveCatalogPrice({ luar_kota: value }, 'luar_kota')).toBeNull()
})
