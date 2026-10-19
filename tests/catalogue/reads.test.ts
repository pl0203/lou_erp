import { describe, expect, test, vi } from 'vitest'
import { fetchCataloguePage, fetchCatalogueOptions } from '../../src/lib/catalogue/reads'
import type { CataloguePageArgs } from '../../src/lib/catalogue/contracts'

const actor = '00000000-0000-4000-8000-000000000001'
const identity = { backend: 'https://catalogue.example.invalid', actorId: actor, role: 'co_admin' as const }
const row = (n: number, enabled = true) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `Item ${n}`, sku: `SKU${n}`, size: null, unit_price: null, harga_pokok: 0, luar_kota: null, dalam_kota: null, depo_bangunan: null, is_enabled: enabled, catalog_version: '9007199254740993' })
const args: CataloguePageArgs<'product'> = { kind: 'product', purpose: 'all-for-history', status: 'all', search: '', page: 1, page_size: 2 }
function envelope(a: CataloguePageArgs, rows: unknown[], count = '3') { return { version: 1, actor_id: actor, role: identity.role, ...a, total_count: count, rows } }
function setup(reply = (a: CataloguePageArgs) => envelope(a, a.page === 1 ? [row(2), row(3, false)] : [row(4)])) {
  const rpc = vi.fn(async (_name, input) => ({ data: reply({ kind: input.p_kind, purpose: input.p_purpose, status: input.p_status, search: input.p_search, page: input.p_page, page_size: input.p_page_size }), error: null }))
  return { rpc, options: { identity, transport: { backend: identity.backend, rpc }, pageSize: 2, isCurrent: () => true } }
}
describe('typed complete catalogue reads', () => {
  test('binds the exact semantic request and keeps bigint text/disabled history', async () => {
    const r = setup(); const page = await fetchCataloguePage(args, r.options)
    expect(page.rows[0].catalog_version).toBe('9007199254740993'); expect(page.rows[1].is_enabled).toBe(false)
    expect(r.rpc).toHaveBeenCalledWith('pilot_catalog_page_v1', { p_kind: 'product', p_purpose: 'all-for-history', p_status: 'all', p_search: '', p_page: 1, p_page_size: 2 }, undefined)
    expect((await fetchCatalogueOptions('product', 'all-for-history', r.options)).map(r => r.id)).toEqual([row(2).id, row(3).id, row(4).id])
  })
  test('zero visible rows is a validated empty list', async () => { const r = setup(a => envelope(a, [], '0')); expect(await fetchCatalogueOptions('product', 'all-for-history', r.options)).toEqual([]); expect(r.rpc).toHaveBeenCalledTimes(1) })
  test.each(['duplicate', 'count drift', 'incomplete', 'wrong scope', 'number version', 'missing status'])('rejects %s without returning a partial list', async fault => {
    const r = setup(a => {
      const result: any = envelope(a, a.page === 1 ? [row(2), row(3)] : [row(fault === 'duplicate' ? 3 : 4)], fault === 'count drift' && a.page > 1 ? '4' : '3')
      if (fault === 'incomplete') result.rows = [row(2)]
      if (fault === 'wrong scope') result.actor_id = row(9).id
      if (fault === 'number version') result.rows[0].catalog_version = 9007199254740993
      if (fault === 'missing status') delete result.rows[0].is_enabled
      return result
    }); await expect(fetchCatalogueOptions('product', 'all-for-history', r.options)).rejects.toThrow()
  })
  test('never turns an RPC error into empty or default-enabled rows', async () => {
    const r = setup(); r.rpc.mockResolvedValue({ data: null, error: { message: 'read denied' } } as any)
    await expect(fetchCataloguePage(args, r.options)).rejects.toMatchObject({ message: 'read denied' })
  })
  test('rejects mismatched backend, invalid request and stale/aborted result', async () => {
    const r = setup(); await expect(fetchCataloguePage(args, { ...r.options, identity: { ...identity, backend: 'https://other.example.invalid' } })).rejects.toThrow(); expect(r.rpc).not.toHaveBeenCalled()
    await expect(fetchCataloguePage({ ...args, purpose: 'enabled-for-order' }, r.options)).rejects.toThrow()
    let current = true; r.rpc.mockImplementation(async (_n, p) => { current = false; return { data: envelope({ ...args, page: p.p_page }, [row(2), row(3)]), error: null } })
    await expect(fetchCataloguePage(args, { ...r.options, isCurrent: () => current })).rejects.toThrow()
    const controller = new AbortController(); controller.abort(); await expect(fetchCataloguePage(args, { ...r.options, signal: controller.signal })).rejects.toThrow()
  })
  test('order reads are enabled-only and no unspecified catalogue option purpose is accepted', async () => {
    const r = setup(a => envelope(a, [row(2, false)], '1')); await expect(fetchCatalogueOptions('product', 'enabled-for-order', r.options)).rejects.toThrow()
    await expect(fetchCatalogueOptions('product', 'catalogue' as any, r.options)).rejects.toThrow()
  })
})

test('large authorised catalogues page completely without an implicit 250-row cap', async () => {
 const r = setup(a => envelope(a, Array.from({ length: Math.max(0, Math.min(a.page_size, 503 - (a.page - 1) * a.page_size)) }, (_, index) => row((a.page - 1) * a.page_size + index + 2)), '503'))
 const rows = await fetchCatalogueOptions('product', 'all-for-history', { ...r.options, pageSize: 250 })
 expect(rows).toHaveLength(503); expect(r.rpc).toHaveBeenCalledTimes(3)
})
