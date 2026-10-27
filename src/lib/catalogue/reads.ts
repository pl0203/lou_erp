import type { CatalogueIdentity, CatalogueKind, CataloguePage, CataloguePageArgs, CatalogueRow, ProcurementAccessV2 } from './contracts'
import { catalogueEnum, decodeCataloguePage, decodeProcurementAccessV2, invalidCatalogue, parseCataloguePageArgs } from './validation'
import { validateCatalogueIdentity } from './queryKeys'

export type CatalogueReadRpcName = 'pilot_catalog_page_v1' | 'pilot_procurement_access_v2'
export interface CatalogueReadTransport {
  readonly backend: string
  rpc(name: CatalogueReadRpcName, args: Record<string, unknown>, signal?: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>
}
export interface CatalogueReadOptions {
  identity: CatalogueIdentity
  transport: CatalogueReadTransport
  signal?: AbortSignal
  /** Mandatory owner check, including actor/backend/role and mounted request epoch. */
  isCurrent(): boolean
  pageSize?: number
  search?: string
}
function current(options: CatalogueReadOptions, identity: CatalogueIdentity) {
  options.signal?.throwIfAborted()
  if (!options.transport || identity.backend !== options.transport.backend || typeof options.transport.rpc !== 'function'
    || typeof options.isCurrent !== 'function' || !options.isCurrent()
    || options.identity.backend !== identity.backend || options.identity.actorId !== identity.actorId || options.identity.role !== identity.role) invalidCatalogue('read scope')
}
export async function fetchCataloguePage<K extends CatalogueKind>(input: CataloguePageArgs<K>, options: CatalogueReadOptions): Promise<CataloguePage<K>> {
  const args = parseCataloguePageArgs(input), identity = validateCatalogueIdentity(options.identity)
  current(options, identity)
  const { data, error } = await options.transport.rpc('pilot_catalog_page_v1', { p_kind: args.kind, p_purpose: args.purpose, p_status: args.status, p_search: args.search, p_page: args.page, p_page_size: args.page_size }, options.signal)
  current(options, identity)
  if (error) throw error
  return decodeCataloguePage(data, identity, args)
}
/** A complete validated list, never a partial success or an enabled-by-default fallback. */
export async function fetchCatalogueOptions<K extends CatalogueKind>(kind: K, purpose: 'enabled-for-order' | 'all-for-history', options: CatalogueReadOptions): Promise<CatalogueRow<K>[]> {
  catalogueEnum(['enabled-for-order', 'all-for-history'] as const, purpose)
  const identity = validateCatalogueIdentity(options.identity)
  const args = parseCataloguePageArgs({ kind, purpose, status: purpose === 'enabled-for-order' ? 'enabled' : 'all', search: options.search ?? '', page: 1, page_size: options.pageSize ?? 250 })
  const scoped = { ...options, identity }
  let total: bigint | undefined, previousId: string | undefined
  const rows: CatalogueRow<K>[] = []
  do {
    const page = await fetchCataloguePage(args, scoped), count = BigInt(page.total_count)
    if (total !== undefined && total !== count) invalidCatalogue('count drift')
    total = count
    for (const row of page.rows) {
      if (previousId !== undefined && row.id <= previousId) invalidCatalogue('complete row order or duplicate')
      previousId = row.id; rows.push(row)
    }
    if (BigInt(rows.length) === total) break
    if (!page.rows.length || BigInt(rows.length) > total || args.page === 2147483647) invalidCatalogue('complete pagination')
    args.page++
  } while (true)
  current(options, identity)
  return rows
}
/** Authority is always obtained directly; callers must not substitute cached page/profile flags. */
export async function fetchCatalogueAccess(options: CatalogueReadOptions): Promise<ProcurementAccessV2> {
  const identity = validateCatalogueIdentity(options.identity)
  catalogueEnum(['co_admin', 'po_admin', 'executive'] as const, identity.role)
  current(options, identity)
  const { data, error } = await options.transport.rpc('pilot_procurement_access_v2', {}, options.signal)
  current(options, identity)
  if (error) throw error
  return decodeProcurementAccessV2(data, identity)
}
