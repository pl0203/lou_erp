import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
vi.mock('../src/components/poImport/PODocumentImport', () => ({ default: () => null }))
import { createPO } from '../src/pages/athel/PONew'
const files = ['src/lib/poImport/usePOImport.ts', 'src/components/poImport/PODocumentImport.tsx', 'src/components/poImport/DocumentPreview.tsx', 'src/components/poImport/POImportReview.tsx']
test('importer boundary has no document-bearing network, storage, logs or transaction client', () => {
 for (const file of files) {
  const source = readFileSync(file, 'utf8')
  expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|caches|console)\b|supabase|orderTransactions|createPO/)
 }
})
test('ordinary Save payload includes no source file or preview fields', async () => {
 const send = vi.fn().mockResolvedValue({ id: 'synthetic' })
 await createPO({ customer_id: 'c', po_number: 'synthetic', order_date: '2026-10-05', expected_delivery_date: '', notes: '', lineItems: [{ _key: 'local', product_id: 'p', product_name: 'Synthetic', sku: 'SYN', quantity: 1, unit_price: 12 }] }, send as any)
 expect(send.mock.calls[0][1]).toEqual({ customer_id: 'c', po_number: 'synthetic', order_date: '2026-10-05', expected_delivery_date: null, notes: null, items: [{ product_id: 'p', product_name: 'Synthetic', sku: 'SYN', quantity: 1, unit_price: 12 }] })
})
