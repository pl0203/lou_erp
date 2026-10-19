import type { CustomerCategory } from '../customerCategory'
import type { PriceTier } from '../catalogPricing'

declare const catalogueDecimal: unique symbol
/** Positive PostgreSQL bigint carried as decimal text, never a JavaScript Number. */
export type DecimalVersion = string & { readonly [catalogueDecimal]: 'version' }
export type CatalogueCount = string & { readonly [catalogueDecimal]: 'count' }
export type CatalogueKind = 'customer' | 'product'
export type CataloguePurpose = 'enabled-for-order' | 'all-for-history' | 'catalogue'
export type CatalogueStatus = 'all' | 'enabled' | 'disabled'
export type CatalogueMaintainerRole = 'co_admin' | 'po_admin' | 'executive'
export type CatalogueRole = CatalogueMaintainerRole | 'sales_person' | 'sales_manager' | 'sales_head'
export type CatalogueDeleteMode = 'none' | 'guarded' | 'direct'
export type CatalogueOperation = keyof CatalogueOperationPayloads

export interface CatalogueIdentity { backend: string; actorId: string; role: CatalogueRole }
export interface CatalogueState { catalog_version: DecimalVersion; is_enabled: boolean }
export interface CatalogueCustomerValues {
  name: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  pricing_tier: PriceTier | 'others'
  customer_category: CustomerCategory | null
}
export interface CatalogueProductValues {
  name: string
  sku: string
  size: string | null
  harga_pokok: number | null
  luar_kota: number | null
  dalam_kota: number | null
  depo_bangunan: number | null
}
export type CatalogueCustomerRow = CatalogueCustomerValues & CatalogueState & { id: string }
export type CatalogueProductRow = CatalogueProductValues & CatalogueState & { id: string; unit_price: number | null }
export type CatalogueRows = { customer: CatalogueCustomerRow; product: CatalogueProductRow }
export type CatalogueRow<K extends CatalogueKind = CatalogueKind> = CatalogueRows[K]
export interface CataloguePageArgs<K extends CatalogueKind = CatalogueKind> {
  kind: K
  purpose: CataloguePurpose
  status: CatalogueStatus
  search: string
  page: number
  page_size: number
}
/** SQL must emit version as JSON number 1, total_count::text and catalog_version::text. */
export interface CataloguePage<K extends CatalogueKind = CatalogueKind> extends CataloguePageArgs<K> {
  version: 1
  actor_id: string
  role: CatalogueRole
  total_count: CatalogueCount
  rows: CatalogueRow<K>[]
}

type CatalogueValuesByKind = { customer: CatalogueCustomerValues; product: CatalogueProductValues }
type ValuesPayload<Edit extends boolean> = {
  [K in CatalogueKind]: { kind: K; values: Edit extends true ? Partial<CatalogueValuesByKind[K]> : CatalogueValuesByKind[K] }
}[CatalogueKind]
export interface CatalogueTarget { kind: CatalogueKind; id: string; expected_version: DecimalVersion }
export interface CatalogueOperationPayloads {
  create: ValuesPayload<false>
  edit: ValuesPayload<true> & { id: string; expected_version: DecimalVersion }
  set_enabled: CatalogueTarget & { is_enabled: boolean }
  delete_unused: CatalogueTarget
}
/** Only this minimal binding, a digest and a receipt may be retained for recovery. */
export type CatalogueRequestBinding =
  | { operation: 'create'; kind: CatalogueKind }
  | ({ operation: 'edit' | 'delete_unused' } & CatalogueTarget)
  | ({ operation: 'set_enabled'; is_enabled: boolean } & CatalogueTarget)
export type CatalogueReceiptBinding = CatalogueRequestBinding & { request_id: string; actor_id: string }
export interface CatalogueReceipt {
  version: 1
  request_id: string
  actor_id: string
  operation: CatalogueOperation
  kind: CatalogueKind
  id: string
  before: CatalogueState | null
  after: CatalogueState | null
  committed_at: string
}
export type CatalogueRecovery =
  | { status: 'committed'; receipt: CatalogueReceipt }
  | { status: 'abandoned' }
  | { status: 'unknown' }
export interface ProcurementAccessV2 {
  version: 2
  as_of: string
  actor_id: string
  role: CatalogueMaintainerRole
  customer_create: boolean
  customer_edit: boolean
  customer_delete: boolean
  product_create: boolean
  product_edit: boolean
  product_delete: boolean
  customer_set_enabled: boolean
  product_set_enabled: boolean
  customer_delete_mode: CatalogueDeleteMode
  product_delete_mode: CatalogueDeleteMode
}
