import { expect, test } from 'vitest'
import { summarizePOAudit } from '../../src/lib/orderPresentation'

test('received-date audit is explicit and separate from document return with old and new dates', () => {
 const entry = { id: 'audit', changed_at: '2026-10-19T00:00:00Z', field_changed: 'sj_date_received', old_value: '2026-10-01', new_value: '2026-10-02', users: { full_name: 'Admin PO' } }
 expect(summarizePOAudit(entry)).toBe('Admin PO mengubah tanggal SJ diterima toko: 1 Oktober 2026 → 2 Oktober 2026.')
 expect(summarizePOAudit({ ...entry, new_value: null })).toBe('Admin PO mengubah tanggal SJ diterima toko: 1 Oktober 2026 → —.')
})
