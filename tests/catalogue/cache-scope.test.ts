import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'vitest'
import { catalogueKeys, invalidateCatalogueProjections, synchronizeCatalogueIdentity } from '../../src/lib/catalogue/queryKeys'
const identity = { backend: 'https://catalogue.example.invalid', actorId: '00000000-0000-4000-8000-000000000001', role: 'co_admin' as const }
const args = { kind: 'product' as const, purpose: 'catalogue' as const, status: 'all' as const, search: '', page: 1, page_size: 25 }
test('every backend/actor/role/contract/semantic/page dimension scopes the key', () => {
 const key = catalogueKeys.read(identity, args)
 for (const scope of [{ ...identity, backend: 'https://other.example.invalid' }, { ...identity, actorId: '00000000-0000-4000-8000-000000000002' }, { ...identity, role: 'po_admin' as const }]) expect(catalogueKeys.read(scope, args)).not.toEqual(key)
 for (const patch of [{ kind: 'customer' as const }, { status: 'disabled' as const }, { search: 'new' }, { page: 2 }, { page_size: 50 }, { purpose: 'all-for-history' as const }]) expect(catalogueKeys.read(identity, { ...args, ...patch })).not.toEqual(key)
 expect(key).toContain(1); expect(catalogueKeys.authority(identity)).toContain(2)
})
test('invalidate only changed catalogue kind, lookup projections and same-identity CO customers', async () => {
 const client = new QueryClient(); const keys = [catalogueKeys.read(identity, args), catalogueKeys.read(identity, { ...args, kind: 'customer' }), ['products', 'complete', 'po-new'], ['customers'], ['co', identity.backend, identity.actorId, identity.role, 'customers', {}], ['co', identity.backend, identity.actorId, identity.role, 'orders', {}], ['co', 'other', identity.actorId, identity.role, 'customers', {}], ['unrelated']]
 keys.forEach(key => client.setQueryData(key, [])); await invalidateCatalogueProjections(client, identity, 'product')
 expect(keys.map(key => client.getQueryState(key)?.isInvalidated)).toEqual([true, false, true, false, false, false, false, false])
 await invalidateCatalogueProjections(client, identity, 'customer'); expect(client.getQueryState(keys[4])?.isInvalidated).toBe(true); expect(client.getQueryState(keys[5])?.isInvalidated).toBe(false)
})
test('identity synchronization cancels/removes obsolete catalogue data without clearing other modules', async () => {
 const client = new QueryClient(), old = catalogueKeys.read({ ...identity, backend: 'https://old.example.invalid' }, args), current = catalogueKeys.read(identity, args)
 client.setQueryData(old, ['old']); client.setQueryData(current, ['current']); client.setQueryData(['unrelated'], ['keep'])
 await synchronizeCatalogueIdentity(client, identity)
 expect(client.getQueryData(old)).toBeUndefined(); expect(client.getQueryData(current)).toEqual(['current']); expect(client.getQueryData(['unrelated'])).toEqual(['keep'])
})
