import type { QueryClient } from '@tanstack/react-query'
import type { CatalogueIdentity, CatalogueKind, CataloguePageArgs } from './contracts'
import { catalogueEnum, exactCatalogueFields, invalidCatalogue, parseCataloguePageArgs, parseCatalogueText, parseCatalogueUUID } from './validation'

export function validateCatalogueIdentity(value: CatalogueIdentity): CatalogueIdentity {
  const row = exactCatalogueFields(value, ['backend', 'actorId', 'role'])
  const backend = parseCatalogueText(row.backend)
  if (!backend) invalidCatalogue('backend')
  return { backend, actorId: parseCatalogueUUID(row.actorId), role: catalogueEnum(['co_admin', 'po_admin', 'executive', 'sales_person', 'sales_manager', 'sales_head'] as const, row.role) }
}
function scope(identity: CatalogueIdentity) {
  const { backend, actorId, role } = validateCatalogueIdentity(identity)
  return ['catalogue', backend, actorId, role] as const
}
export const catalogueKeys = {
  all: ['catalogue'] as const,
  identity: scope,
  authority: (identity: CatalogueIdentity) => [...scope(identity), 2, 'authority'] as const,
  read: (identity: CatalogueIdentity, input: CataloguePageArgs) => {
    const args = parseCataloguePageArgs(input)
    return [...scope(identity), 1, 'read', args.kind, args.purpose, args.status, args.search, args.page, args.page_size] as const
  },
}
function sameIdentity(key: readonly unknown[], identity: CatalogueIdentity) {
  return key[1] === identity.backend && key[2] === identity.actorId && key[3] === identity.role
}
/** Await cancellation before removal so a late completion cannot repopulate obsolete scopes. */
export async function synchronizeCatalogueIdentity(client: QueryClient, value: CatalogueIdentity | null): Promise<void> {
  const identity = value === null ? null : validateCatalogueIdentity(value)
  const filters = { queryKey: catalogueKeys.all, predicate: (query: { queryKey: readonly unknown[] }) => !identity || !sameIdentity(query.queryKey, identity) }
  await client.cancelQueries(filters)
  client.removeQueries(filters)
}
/** Refresh only catalogue/lookup projections. Saved orders and unrelated private modules stay separate. */
export async function invalidateCatalogueProjections(client: QueryClient, value: CatalogueIdentity, kind: CatalogueKind): Promise<void> {
  const identity = validateCatalogueIdentity(value)
  catalogueEnum(['customer', 'product'] as const, kind)
  const legacy = kind === 'customer'
    ? new Set(['athel_customers', 'all_customers', 'customers', 'girard_customer', 'manager_customers', 'my_customers'])
    : new Set(['products', 'all_products'])
  await client.invalidateQueries({ predicate: ({ queryKey: key }) =>
    key[0] === 'catalogue' && sameIdentity(key, identity) && key[4] === 1 && key[5] === 'read' && key[6] === kind
    || legacy.has(String(key[0]))
    || key[0] === 'co' && sameIdentity(key, identity) && key[4] === (kind === 'customer' ? 'customers' : 'catalog'),
  })
}
