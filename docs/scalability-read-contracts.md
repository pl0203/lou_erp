# Scalable read contract v1

Canonical types and parameter order: `src/lib/reads/contracts.ts`. SQL and client owners must use this file, rather than deriving their own DTOs. This document freezes the missing implementation details of the approved design, without changing business rules. The independent review gate must pass before consuming reads are implemented.

## Wire and security rules

Every RPC returns one JSON object with `version: 1` and `as_of`, the database statement timestamp. A Page has `items`, exact authorized `total`, requested `page`, and `page_size`. Page and count use the same authorized predicate and one statement snapshot. Out-of-range pages return empty items with the true total; the client recovers to the last valid page. Valid empty results are distinct from errors.

All money fields, including order totals, unit prices, targets, sums, averages, and ranked-item revenue, are plain decimal strings without exponent notation. Preserve PostgreSQL numeric precision; do not round aggregates merely to cross the wire. Quantity/count/rank and percentage fields remain finite JSON numbers; adapters reject unsafe integers for count/quantity/rank. Display rounding belongs to the money adapter, and chart number conversion never feeds a financial total or write payload.

Returned PO statuses include the full existing enum: draft/confirmed/shipped/delivered/delayed/cancelled/confirm/in_progress/complete. The input filter remains all/draft/confirm/in_progress/complete/cancelled. An all-status read must retain legacy rows, and adapters use existing fallback labels for those rows; no new filter controls are added.

SQL functions are STABLE SECURITY INVOKER with `SET search_path = ''`, qualified tables/functions, revoked PUBLIC/anon execution, and authenticated execution only. No dynamic SQL, role argument, service key, permission expansion, or RLS bypass. An ID is a narrowing filter, never proof of authority. Validate non-null required arguments, positive integer pages, page size 1–100 (daily size 1–366), date order, exact allowed status/fulfillment values, top limit 1–10, and ID-array cardinality at most 100. Invalid input is an error, never a zero result. Empty ID arrays return empty items; duplicate IDs produce one item per visible ID, sorted by ID.

An allowed parent must survive a hidden related customer/user: use LEFT JOIN semantics and nullable `customers`/`users`. Never SELECT users.*. Customers and submitter labels are limited to currently allowed selected columns. Unknown PO access gives no line/page information. A supplied stale PO version raises `40001`; missing/inaccessible PO uses the same not-found error so it cannot expose existence.

## Stable ordering and summary scopes

- PO and sales pages: `created_at DESC, id DESC`. Only displayed summary fields; no nested SJ or order-line arrays.
- PO lines: `id ASC`. `po_updated_at` and all line aggregates come from the same statement. `po_has_delivery_history` includes voided headers; a line's `has_delivery_history` includes any SJ-line history. `delivered_quantity` sums only nonvoid SJ quantities. The expected version is optional on the first page and mandatory on later complete-load pages; changed versions restart the read or block the form.
- Sales `status_counts` applies the selected status AND every other active filter across the full collection, not just the current page. Thus other statuses are zero under a selected-status filter. This deliberately preserves the existing pills; it is not a new cross-status badge design.
- Customer and sales performance pages: display name ascending, then ID. Revenue: total sales descending, then customer ID. Manager customers: name ascending, then ID. Stats/team item envelopes: ID ascending. Daily chart buckets: calendar date ascending.
- Top/ranking ties get deterministic keys: customer ID for customers and grouping key for products. This resolves previously unspecified ties without changing sums. Dashboard colors, localized status labels, month/day labels, and display formatting are added by the client; the wire carries `status` keys and calendar keys, not presentation colors.

## Exact metric populations

### Athel summary and daily series

Set the base PO window to `[min(p_from,p_rolling_from),p_to]` using order_date, and apply p_status unless all. Join only visible records. Aggregate active deliveries per line before joining PO lines; retain zero-price lines. PO cohort for KPIs is then order_date in `[p_from,p_to]` and the existing fulfillment test: undelivered means delivered **value** is zero; complete means outstanding quantity is zero and PO total value is positive; partial means delivered value and outstanding quantity are both positive. Do not change this to quantity-only classification.

KPI count/value, delivered value, outstanding value, completed count, customer share, status breakdown, and top customers use that filtered cohort. Delivered/outstanding KPI values use those POs' available active delivery history, rather than adding a new shipment-date cutoff. Average PO value is total/count, zero for an empty cohort.

The monthly PO series uses the filtered PO cohort and months from p_rolling_from. Monthly delivered and daily delivered/SJ-count series use the base PO window before fulfillment filtering, filtered by their respective SJ date windows. The 12 month keys start at p_rolling_from; values outside p_to are zero. Daily emits every calendar date p_from through p_to, including zero days. Its p_fulfillment argument is validated but intentionally does not change its current population.

Outstanding item ranking also uses the base PO window before the narrower KPI date/fulfillment selection. Group by `coalesce(sku, product_name)` exactly, retaining an empty SKU as a key. Include every line with positive remaining quantity, including zero-priced lines, in the grouped quantity; only after grouping discard groups whose summed outstanding value is <= 0. Order by value descending plus stable grouping key, and return 10. Use a deterministic first line ID only to select a label when a grouping key has differing historical labels. Customer share returns top five plus Lainnya for the remainder; top customer ranking returns ten. Cancelled rows remain governed by the same selected-status basis; do not invent a new exclusion.

### Customer statistics

For each visible requested customer: first order is earliest order_date; recent count uses order_date >= p_cutoff, no new status or upper-date filter. Top items sum all-time ordered quantity × unit_price across all statuses, grouped by product_name, revenue descending then name. Delivered sales use eligible PO statuses in_progress/complete, nonvoid SJs, and sj_date >= p_cutoff, without a new upper bound. Visible customers with no orders return zero count/sales, null first date, and empty top items. Batch adapter uses top three; detail adapter uses top ten and retains existing screen-facing field names.

### Customer and sales performance

For sales-manager callers, p_manager_id must equal auth.uid(). Customer cohort is assignments to that manager; sales cohort is active direct team plus the manager. Head/executive adapters pass NULL for the current all-visible cohort. SQL derives role and validates the appropriate mapping; it does not interpret an executive's own ID as a manager filter. RLS remains authoritative. Preserve the existing active role set for the sales cohort.

Customer performance: PO count uses selected month order dates, with all current statuses. Sales use nonvoid SJs in that month for eligible in_progress/complete POs of any order date. Visit timestamps use `[p_visit_from,p_visit_until)` exactly. Latest visits use MAX over visible visits. Latest target is the record with maximal year_month <= selected month, per customer. Target visits is ceil(days-in-month/frequency). active_customers means monthly order_count > 0; top_customer comes from the entire visible cohort, so a nonempty zero-sales cohort still has a top row. Summary visit percent is `round(100 * total_visits / total_target_visits)`, or zero when the denominator is zero.

Sales performance: preserve p_date_from/p_date_to for schedule dates and inclusive p_order_from/p_order_to for order timestamps, including the current 23:59:59 endpoint. Sum all existing order statuses. Per-member visited means a schedule has a visible visit; missed means status missed and no visible visit. Member visit_rate is rounded visited/scheduled, or zero. Summary average_visit_rate is rounded mean of these already-rounded member rates, not a global ratio. Latest target uses maximal year_month <= selected month. Preserve the current calendar helper outputs rather than silently normalizing timezones.

### Revenue and activity

Revenue uses approved sales orders within inclusive timestamp bounds, including the existing final 23:59:59 second. Keep a visible order even when its customer label is hidden; fallback customer_name is Unknown and manager_name is null. Aggregate once per customer ID; summary totals cover every group, not the visible group page. Tied top customers use ID for deterministic selection.

Team activity uses requested visible user IDs, selected day schedule dates, inclusive order timestamp bounds, and visits >= p_week_from for the weekly count. Return zero aggregates for a visible requested user with no matching activity. No extra upper bound is introduced for weekly visits.

Manager customers preserves the supplied manager-assignment filter under RLS, without a new universal self-only restriction. Current UI still passes profile.id for every role; there is no new manager-selection interface. Head/executive callers can narrow to a manager already visible under existing table access. Visits use checked_in_at >= p_visit_from without a new upper bound. Target visits is ceil(30/frequency); on_track is actual >= target. Overdue uses p_as_of and the existing DATE-at-UTC-midnight interpretation of last_visit_date; missing date is overdue. on_track and overdue are independent flags, not complements.

## Shared client ownership

Primary client owner implements `rpc.ts`, `orders.ts`, `reports.ts`, `money.ts`, `usePagedRead.ts`, and PaginationControls. It exports `fetchPOLinePage` from orders.ts. Detail owner consumes that export and owns `detailReads.ts`, including `fetchSalesOrderLines`, POEdit/PODetail/VisitPage integration, and complete lookups within those files. Contract owner implements `completeReads.ts` and supporting catalog/schedule sources elsewhere. Do not introduce a second PO-line RPC decoder.

`readComplete(fetchPage,keyOf,signal)` requests 500 rows, advances by actual returned count, verifies exact total/unique IDs, propagates failures/abort, and allows at most one full restart if collection totals change. `chunkIds` defaults to 100. Generic completeness is for metadata and one-entity detail; report facts must use SQL aggregation.

## Review decisions

- Preserve selected-status pill scope, exact existing date endpoints, and value-based fulfillment because the approved scope is read correctness, not metric redesign.
- Keep parent rows with nullable hidden relations because related-table RLS can be narrower than parent visibility.
- Keep current ManagerCustomers supplied-ID filtering while enforcing the approved own-ID/NULL mapping for the two performance RPCs; these are different existing cohorts.
- Separate SQL data from colors/localized labels; the adapter reconstructs the current chart presentation.
- Separate long daily chart requests from the compact summary. Each has its own as_of; a refresh invalidates every daily page, and no partial chart is shown. This does not claim a cross-request historical snapshot.
