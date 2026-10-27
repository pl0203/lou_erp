/** Wire values stay decimal text. Parse at the RPC boundary; never aggregate via Number. */
declare const coValue: unique symbol
type DecimalText<Kind extends string> = string & { readonly [coValue]: Kind }

/** Nonnegative extended amount; PostgreSQL numeric has no unit-price-width cap. */
export type Money = DecimalText<'Money'>
export type SignedMoney = DecimalText<'SignedMoney'>
/** Nonnegative aggregate count, which may exceed JavaScript's safe integer range. */
export type Quantity = DecimalText<'Quantity'>
export type SignedQuantity = DecimalText<'SignedQuantity'>
/** Positive PostgreSQL bigint, encoded as base-10 text. */
export type Version = DecimalText<'Version'>

export type COStatus = 'active' | 'closed' | 'cancelled'
export type COOperation =
  | 'create_co' | 'edit_co' | 'cancel_co'
  | 'save_sj_draft' | 'post_sj'
  | 'save_report_draft' | 'post_report'
  | 'save_return_draft' | 'post_return'
  | 'correct_sj' | 'correct_report' | 'correct_return'
  | 'resolve_undelivered' | 'close_co'

/** The only durable client recovery data, after strict runtime validation. */
export interface COReceipt {
  id: string
  operation: COOperation
  version: Version
  customer_id: string
  customer_version: Version
}
export type CORecovery =
  | { status: 'committed'; operation: COOperation; receipt: COReceipt }
  | { status: 'abandoned' }
  | { status: 'unknown' }

/** Independent from CO status: delivery completion never closes an order. */
export type CODeliveryProgress = 'not_started' | 'partial' | 'complete'
export interface CODeliveryProgressSummary {
  delivery_progress: CODeliveryProgress
  ordered_quantity: Quantity
  delivered_quantity: Quantity
  resolved_undelivered_quantity: Quantity
  pending_quantity: Quantity
}

/** New line IDs are caller-generated UUIDs and remain stable through ordinary edits. */
export interface CONewLineInput {
  id: string
  sku: string
  product_name: string
  product_id?: string | null
  stock_key_id?: string | null
  /** Integer from 1 through 2147483647. */
  ordered_quantity: number
  /** Decimal text, at most two fractional digits and at most 999999999999.99. */
  unit_price: Money
}
export interface COExistingLineInput {
  id: string
  ordered_quantity: number
}
export interface COCreatePayload {
  customer_id: string
  /** Use "1" for a customer without CO state; stale values fail closed. */
  expected_customer_version: Version
  co_number: string
  /** ISO calendar date: YYYY-MM-DD. */
  order_date: string
  expected_delivery_date?: string | null
  notes?: string | null
  lines: CONewLineInput[]
}
export interface COOrderVersionBinding {
  co_id: string
  expected_co_version: Version
  expected_customer_version: Version
}
export interface COEditPayload extends COOrderVersionBinding {
  co_number?: string
  order_date?: string
  expected_delivery_date?: string | null
  notes?: string | null
  /** Complete desired set. Omitted never-referenced lines are removed with an audit before-image. */
  lines: (COExistingLineInput | CONewLineInput)[]
}
export interface COCancelPayload extends COOrderVersionBinding {
  reason: string
}
export interface COSJLineInput {
  co_line_id: string
  /** Positive safe integer; cumulative delivered + resolved cannot exceed ordered. */
  quantity: number
}
export type COSaveSJDraftPayload = COOrderVersionBinding & {
  sj_number: string
  /** Unposted plans may be future-dated. */
  sj_date: string
  received_date?: string | null
  notes?: string | null
  lines: COSJLineInput[]
} & (
  | { draft_id?: never; expected_draft_version?: never }
  | { draft_id: string; expected_draft_version: Version }
)
export interface COPostSJPayload {
  draft_id: string
  expected_draft_version: Version
  expected_co_version: Version
  expected_customer_version: Version
}
/** Expanded by subsequent operation stages; these five payloads are already implemented. */
export interface COOperationPayloads {
  create_co: COCreatePayload
  edit_co: COEditPayload
  cancel_co: COCancelPayload
  save_sj_draft: COSaveSJDraftPayload | COSaveSJCorrectionDraftPayload
  post_sj: COPostSJPayload | COReviewedPostSJPayload
}
export type COCommand<Operation extends keyof COOperationPayloads = keyof COOperationPayloads> = {
  [K in Operation]: { operation: K; payload: COOperationPayloads[K] }
}[Operation]

export interface COReportMetadata {
  report_reference?: string | null
  received_date?: string | null
  notes?: string | null
}
export interface COReportDraftBinding {
  draft_id: string
  expected_draft_version: Version
  expected_customer_version: Version
}
export type COReportInitialize = COReportMetadata & {
  action: 'initialize'
  customer_id: string
  /** ISO first-of-month calendar date. */
  report_month: string
  expected_customer_version: Version
} & (
  | { source_context?: COSourceContext; seed_effective_revision_id?: never }
  | { source_context?: never; seed_effective_revision_id: string }
) & (
  | { draft_id?: never; expected_draft_version?: never }
  | { draft_id: string; expected_draft_version: Version }
)
export interface COReportDraftLineInput {
  stock_key_id: string
  /** Explicit integer 0–2147483647; null means unanswered. */
  sold_quantity: number | null
}
type COReportMetadataChange =
  | (COReportMetadata & { report_reference: string | null })
  | (COReportMetadata & { received_date: string | null })
  | (COReportMetadata & { notes: string | null })
export type COSaveReportDraftPayload =
  | COReportInitialize
  | (COReportDraftBinding & { action: 'upsert_lines'; eligible_set_fingerprint: string; lines: COReportDraftLineInput[] })
  | (COReportDraftBinding & { action: 'fill_remaining_zero'; eligible_set_fingerprint: string })
  | (COReportDraftBinding & { action: 'set_metadata' } & COReportMetadataChange)
export interface COReportPreviewPayload extends COReportDraftBinding { eligible_set_fingerprint: string }
export interface COPostReportPayload extends COReportPreviewPayload { preview_fingerprint: string }
export interface COOperationPayloads {
  save_report_draft: COSaveReportDraftPayload
  post_report: COPostReportPayload
}
export type COImpactKind = 'report' | 'stock' | 'revenue' | 'credit' | 'reopen' | 'issue' | 'missing_month'
export interface COPlanSummary {
  sold_quantity: Quantity
  revenue: Money
  remaining_quantity: SignedQuantity
  /** False means provisional/incomplete; unanswered rows have not been confirmed zero. */
  complete: boolean
}
/** Bounded header. Details are always separately paginated. */
export interface COPreview {
  version: '1'
  as_of: string
  operation: COReviewedOperation | 'post_report'
  customer_id: string
  customer_version: Version
  draft_version: Version | null
  source_context_fingerprint?: string
  preview_fingerprint: string
  can_post: boolean
  before: COPlanSummary
  after: COPlanSummary
  counts: Record<COImpactKind, Quantity>
}
export interface COReportImpact {
  ref: string
  head_id: string | null
  revision_id: string | null
  month: string
  coverage: string
  is_partial_month: boolean
  report_reference: string | null
  received_date: string | null
  notes: string | null
  row_count: Quantity
  before_sold_quantity: Quantity
  after_sold_quantity: Quantity
  before_revenue: Money
  after_revenue: Money
  complete: boolean
}
export interface COStockImpact { stock_key_id: string; batch_id: string; before_quantity: SignedQuantity; after_quantity: SignedQuantity }
export interface CORevenueImpact { report_month: string; before_amount: Money; after_amount: Money }
export interface COCreditImpact extends CORevenueImpact { sales_person_id_at_creation: string | null }
export interface COReopenImpact { co_id: string; remaining_quantity: Quantity; expected_co_version?: Version; pending_quantity?: Quantity; missing_month_count?: Quantity }
export type COIssueCode =
  | 'CO_REPORT_INCOMPLETE' | 'CO_SOLD_EXCEEDS_ELIGIBLE' | 'CO_SOURCE_STOCK_NEGATIVE'
  | 'CO_REPORT_REVISION_REQUIRED' | 'CO_FUTURE_REPORT_MONTH' | 'CO_FUTURE_RECEIVED_DATE'
  | 'CO_CORRECTION_REASON_REQUIRED'
  | 'CO_MISSING_REQUIRED_MONTH' | 'CO_PARTIAL_MONTH_INCOMPLETE' | 'CO_REOPEN_REQUIRED' | 'CO_REVIEWED_CORRECTION_REQUIRED'
export interface COIssueImpact {
  code: COIssueCode
  report_month?: string
  stock_key_id?: string
  batch_id?: string
  co_id?: string
  date?: string
  sold_quantity?: Quantity
  eligible_quantity?: SignedQuantity
}
export interface COMissingMonthImpact { report_month: string; reason: 'missing' | 'partial_coverage'; head_id: string | null; coverage_through_date: string | null }
export interface COImpactRows {
  report: COReportImpact
  stock: COStockImpact
  revenue: CORevenueImpact
  credit: COCreditImpact
  reopen: COReopenImpact
  issue: COIssueImpact
  missing_month: COMissingMonthImpact
}
export interface COPreviewImpactPage<Kind extends COImpactKind = COImpactKind> {
  version: '1'
  as_of: string
  preview_fingerprint: string
  kind: Kind
  page: number
  page_size: number
  total: Quantity
  rows: COImpactRows[Kind][]
}

/** Reviewed sources are replayed as one version-bound customer transaction. */
export type COReviewedOperation = 'post_sj' | 'post_return' | 'correct_sj' | 'correct_report' | 'correct_return'
export type COCompletedReportDraft = {
  draft_id: string
  expected_draft_version: Version
  eligible_set_fingerprint: string
} & (
  | { original_revision_id?: never; expected_report_version?: never }
  | { original_revision_id: string; expected_report_version: Version }
)
export interface COReviewSets {
  completed_report_drafts: COCompletedReportDraft[]
  acknowledged_reopen_orders: { co_id: string; expected_co_version: Version }[]
}
export interface COReviewedPublication extends COReviewSets { reason: string; preview_fingerprint: string }
export type COReviewedPostSJPayload = COPostSJPayload & COReviewedPublication
export type COSaveSJCorrectionDraftPayload = COSaveSJDraftPayload & {
  delivery_head_id: string
  original_revision_id: string
  expected_delivery_version: Version
}
export interface COReturnLineInput { batch_id: string; quantity: number }
export type COSaveReturnDraftPayload = {
  customer_id: string
  expected_customer_version: Version
  return_date: string
  lines: COReturnLineInput[]
  notes?: string | null
} & ({ reference: string; reason?: string | null } | { reason: string; reference?: string | null }) & (
  | { draft_id?: never; expected_draft_version?: never }
  | { draft_id: string; expected_draft_version: Version }
)
export interface COPostReturnPayload extends COReviewSets {
  draft_id: string
  expected_draft_version: Version
  expected_customer_version: Version
  /** Required if publishing changed settled history. */
  reason?: string
  preview_fingerprint: string
}
export type COCorrectSJPayload = COReviewedPublication & {
  delivery_head_id: string
  original_revision_id: string
  expected_delivery_version: Version
  expected_co_version: Version
  expected_customer_version: Version
} & (
  | { action: 'replace'; draft_id: string; expected_draft_version: Version }
  | { action: 'void'; draft_id?: never; expected_draft_version?: never }
)
export type COCorrectReportPayload = COReviewedPublication & COReportPreviewPayload & {
  report_head_id: string
  original_revision_id: string
  expected_report_version: Version
}
export type COCorrectReturnPayload = COReviewedPublication & {
  return_head_id: string
  original_revision_id: string
  expected_return_version: Version
  expected_customer_version: Version
} & (
  | { action: 'replace'; return_date: string; lines: COReturnLineInput[]; reference?: string | null; notes?: string | null }
  | { action: 'void'; return_date?: never; lines?: never; reference?: never; notes?: never }
)
/** No completed-draft/reopen/final-preview fields: the source context cannot bind itself. */
type COSourceOnly<T> = T extends unknown ? Omit<T, keyof COReviewSets | 'preview_fingerprint'> : never
export type COSourceContext = {
  [K in COReviewedOperation]: { operation: K; payload: COSourceOnly<COReviewedPayloads[K]>; source_context_fingerprint: string }
}[COReviewedOperation]
export interface COReviewedPayloads {
  post_sj: COReviewedPostSJPayload
  post_return: COPostReturnPayload
  correct_sj: COCorrectSJPayload
  correct_report: COCorrectReportPayload
  correct_return: COCorrectReturnPayload
}
export interface COResolveUndeliveredPayload extends COOrderVersionBinding { reason: string; lines: COSJLineInput[] }
export interface COClosePayload extends COOrderVersionBinding { reason: string }
export interface COOperationPayloads {
  save_return_draft: COSaveReturnDraftPayload
  post_return: COPostReturnPayload
  correct_sj: COCorrectSJPayload
  correct_report: COCorrectReportPayload
  correct_return: COCorrectReturnPayload
  resolve_undelivered: COResolveUndeliveredPayload
  close_co: COClosePayload
}

/** Exact SKU text is independent from the UUID used to open movement history. */
export type StockFilters = {
  customerId: string | null; sku: string | null; search: string; asOf: string | null
  sort: 'sku' | 'customer' | 'balance'; direction: 'asc' | 'desc'
  page: number; pageSize: 25 | 50 | 100
}
export interface COReportingFreshness {
  cutoff_date: string; next_required_report_month: string | null
  pending_report_month_count: Quantity; overdue_report_month_count: Quantity
  next_required_month_end: string | null; days_since_pending_month_end: Quantity | null
  status: 'no_recorded_activity' | 'complete' | 'missing_completed_period' | 'current_unreported' | 'current_partial'
  zero_stock_reporting_pending: boolean
}
export interface COStockRowV2 {
  id: string; stock_key_id: string; customer_id: string; customer_name: string; customer_version: Version
  generation_id: string | null; normalized_sku: string; display_sku: string; product_id: string | null; product_name: string
  unit: string | null; unit_basis: 'unknown' | 'declared_by_cutoff' | 'declared_after_cutoff'
  unit_declaration: { id: string; version: Version; unit: string; declared_at: string } | null
  opening_quantity: Quantity; delivered_quantity: Quantity; sold_quantity: Quantity; returned_quantity: Quantity; recorded_quantity: Quantity
  has_delivery_history: boolean; last_report_month: string | null; coverage_through_date: string | null
  reporting_freshness: COReportingFreshness
  /** Surviving batches × retained CO prices; not report source prices, cost or revenue. */
  contract_stock_value: Money | null; contract_currency: 'IDR' | null; contract_unit_price: Money | null
  price_state: 'unknown' | 'single' | 'mixed'; valuation_basis: 'retained_co_batch' | null
}
export interface COStockPageV2 {
  version: '2'; as_of: string; customer_id: string | null; customer_version: Version | null; generation_id: string | null
  sku: string | null; normalized_search: string; stock_as_of: string | null; period_start: string; coverage_date: string
  sort: StockFilters['sort']; direction: StockFilters['direction']; page: number; page_size: 25 | 50 | 100
  total: Quantity; rows: COStockRowV2[]; reporting_freshness: COReportingFreshness | null
}
export type COOrdersPageFilters = {
  customerId: string | null; status: COStatus | 'all'; search: string
  sort: 'order_date' | 'co_number'; direction: 'asc' | 'desc'; page: number; pageSize: number
}

/** Restated composition from the current effective generation, through a concrete UTC cutoff. */
export type COCustomerBatchesV2Args = {
  p_customer_id: string; p_stock_key_id: string; p_as_of: string
  p_expected_customer_version: string; p_expected_generation_id: string
  p_page: number; p_page_size: number
}
export interface COCustomerBatchV2 {
  id: string; co_id: string; co_number: string; delivery_head_id: string
  delivery_revision_id: string | null; sj_number: string | null; sj_date: string | null
  available_quantity: Quantity; unit_price: Money; contract_value: Money
}
export interface COCustomerBatchesV2 {
  version: '2'; as_of: string; customer_id: string; stock_key_id: string
  customer_version: Version; generation_id: string; stock_as_of: string; coverage_date: string
  page: number; page_size: number; total: Quantity; recorded_quantity: Quantity
  contract_stock_value: Money; contract_currency: 'IDR'; rows: COCustomerBatchV2[]
}
