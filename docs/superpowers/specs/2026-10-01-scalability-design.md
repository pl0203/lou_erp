# LOU scalability design

October 1 2026

## Decision for review

Keep the existing order workflows and improve the read paths: complete search, predictable pagination, database-calculated summaries, and measured query tuning. The goal is accurate, usable screens at 500 POs per month, with tests at 6,000 and 30,000 POs plus their related records. This is a design for approval before an implementation plan. It does not approve a production migration or establish a live capacity guarantee.

The approved scope is pagination and search correctness, report aggregation with existing access controls, evidence-based indexes, and synthetic correctness and load testing. Expiry follow-up and action lists are a later phase.

## Evidence and scale

The PO list already requests 10 rows per page from the server. It is not downloading every PO. It sorts only by creation time, requests an exact count on every page, and searches customer names and SJ numbers through preliminary queries limited to 100 matches. A broad search can therefore omit legitimate results.

The dashboard reads a rolling window of POs and then raw line items, delivery notes, and delivery lines without pagination. Customer statistics and several Girard reports also read unpaged datasets. The repository's local API configuration caps a response at 1,000 rows; the production setting has not been inspected.

Three in-memory reproductions ran unchanged source logic against that simulated cap:

- With 6,000 POs at 500 per month, a latest-three-month selection should contain 1,500 POs. The dashboard reports zero after fetching the oldest 1,000 first.
- With 500 POs and 10 lines each, undelivered value should be 50,000 synthetic currency units. The dashboard reports 10,000 after the line-item response truncates.
- With 101 matching customers and one PO per customer, search reports 100 matches.

These demonstrate correctness defects under the specified cap, not production response times. At an illustrative 10 lines and two deliveries per PO, five years means 30,000 POs, 300,000 PO lines, and 60,000 delivery headers. Delivery-line volume depends on how those shipments are split. Audit and request-history growth must also be included in measurements.

## Approach and boundaries

Recommended: add a small, versioned SQL read layer for summaries and cross-table PO search; retain the current React screens and transactional RPCs. Ordinary lists remain server-paginated. This removes raw-history downloads without introducing a separate reporting service, cache invalidation system, or warehouse.

Client-side paging of every raw report input is a possible temporary repair, but payload and request counts still grow with history, and separate reads can observe different moments. Raising the API row cap alone only moves the failure point. Materialized reporting tables or a warehouse add unnecessary maintenance at this stage and should be considered only if measured queries justify them.

The change covers the PO list, sales-order lists, Athel dashboard, customer statistics and performance, Girard revenue and sales performance, and existing visit/team summaries that calculate totals from raw lists. Existing customer/product selection and PO-detail reads must have an explicit bounded or complete-read contract. No new export feature, reminder service, business workflow, write privilege, or archival policy is included.

## Pagination and search contract

Keep the PO list's existing default size and filters. Sort by creation time descending and unique PO ID descending. Customer/product lists similarly need a unique ID after their display-name sort. Offset pagination is retained for numbered pages; switch to cursor pagination only if measured deep-page cost warrants a separately reviewed navigation change.

The PO search read function accepts typed search text, allowed status, page, and bounded page size. It searches PO number, customer name, and SJ number in SQL using parameterized predicates and EXISTS. It returns one row per PO, a bounded page, and an exact filtered count. Search text is treated as literal text, including punctuation and wildcard characters. It must not be concatenated into SQL or PostgREST filter syntax. Count and page are calculated from the same authorized predicate and SQL statement snapshot.

The page response includes only displayed summary fields. Unused nested SJ histories are removed from the normal PO list payload. Sales-order and personal-order lists receive server pagination; expandable line details are loaded for the selected order rather than for every historical order. Status counts are calculated independently over the authorized filtered collection, never from the currently visible page.

When a request is pending, the screen clearly marks old rows as updating and prevents repeated Next clicks from presenting them as the new page. Filter changes reset the page together with the filter state. Out-of-range pages recover after deletions or status changes. Search debounce is component-local, cleaned up on navigation, and obsolete reads are cancelled where supported. Query keys include every filter and page; identity transitions continue clearing the cache.

## Report read contract

Use narrowly scoped, versioned read functions matching the existing screen data contracts. The dashboard returns its metric object, date-series buckets, and bounded top-customer and outstanding-item rankings. Other report screens return complete totals plus bounded or pageable grouped rows. Scalar JSON envelopes must contain only summaries and bounded arrays; they must not conceal thousands of raw rows inside one API result.

Each query first aggregates delivery quantities by PO line, excluding voided deliveries where the existing measure excludes them. It then joins one delivery aggregate to one PO line and aggregates to PO, customer, day, or month. Never join several unaggregated one-to-many tables and sum the multiplied rows. Preserve numeric precision in SQL; formatting happens in the client.

Preserve current metric definitions while fixing completeness. Characterization tests use small, fully available datasets as the reference, and SQL ground truth validates larger datasets. The existing boundaries to retain are:

- Athel PO count and PO value use selected PO dates, status, and fulfillment filters. Delivered and outstanding KPI values follow the selected PO cohort. Delivery time series use shipment dates within their current windows.
- The current monthly PO series is constrained by the selected PO cohort. The outstanding-item breakdown uses the wider fetched PO window, while fulfillment filtering applies to the PO KPI cohort. These asymmetries must be documented and tested, not silently redefined in this change. Any semantic correction needs a separate explicit decision before implementation.
- Customer statistics count recent POs, calculate delivered sales by SJ date, and rank items using their existing order-line basis. Customer performance counts POs in the selected month and includes deliveries from older eligible POs in that shipment month.
- Girard revenue currently uses approved sales orders. Sales performance currently sums submitted orders in its selected period. Their measures must not be silently unified.

Preserve cancellation and void-history rules, zero-price lines, role visibility, calendar-date boundaries, and existing status labels. No incomplete read may be presented as a successful total. If a required read fails, show an error and retry path rather than zero or a partial sum.

## Access controls and data safety

New read functions use SECURITY INVOKER, a restricted search path, qualified relations, typed parameters, and no dynamic SQL. Revoke default PUBLIC execution and grant only the required authenticated access. Existing RLS policies remain enabled and authoritative for every underlying row, including nested search matches and report totals. A caller-supplied user or customer ID narrows access; it never establishes authority.

Do not use the service role in the browser, disable RLS, broaden table grants, or change existing SECURITY DEFINER transaction functions to make reports work. Existing role-helper functions and their row-dependent checks remain unchanged unless a separate security-reviewed optimization is justified. Test unauthenticated, inactive, own-record, team, executive, and cross-team cases through actual role/JWT paths in isolated staging.

Keep atomic writes, version-conflict checks, duplicate-safe retries, audit records, void history, and request reconciliation intact. Read-path work must not weaken those guarantees. Do not delete old request IDs or business history as a performance shortcut.

## Index and read completeness review

Inspect the actual staging index inventory and query plans before proposing indexes. Versioned migrations do not establish a complete production index inventory. Candidate shapes include PO creation-time/ID and status/creation-time/ID ordering, order-date and customer/date filtering, child foreign-key joins, SJ shipment dates, and the links used by role-scope predicates. Review existing unique indexes for overlap. Consider trigram indexes for contains-search only after representative search plans justify their storage and write cost.

Run EXPLAIN ANALYZE with buffers on synthetic staging data under the real application role, not only a privileged owner. Measure exact-count cost separately. Keep exact business counts; do not silently replace them with estimates. Preserve the benefits of per-PO reads on detail/edit screens. Page audit and delivery history, and make quantities used to edit or fulfill an order authoritative and complete even when displayed history is paged.

Customer/product pickers must use bounded server search or an explicitly complete paged load; they must not silently hide records beyond the API cap. No export feature currently belongs to this change. Any later export must use the same authorized filters, bounded batches, stable ordering, a defined consistency point, and reconciliation against the full count rather than exporting the visible page.

## Verification and performance acceptance

Prepare deterministic fixture generators and exact expected sums without writing large fixtures yet. The implementation packet will specify the isolated target, expected row and byte counts, runtime limits, cleanup, and index/migration changes before the 6,000- and 30,000-PO tests run. Never seed synthetic data into production or use a production snapshot by default.

Cover 999, 1,000, and 1,001 rows independently for each parent and child table; more than 100 customer/SJ search matches; tied sort timestamps; first, middle, and last pages; empty filters; old POs delivered this month; partial deliveries; zero-price items; voids; cancellations; repeated navigation; and lost or delayed responses. Compare exact database sums and counts to every displayed measure under each authorized role. Concurrent inserts must not duplicate an ID within a returned page; cross-request offset-page movement is documented unless a snapshot or cursor contract is adopted.

For both scale levels, record database execution time, end-to-end API time, bytes returned, request count, browser render time, and errors. Test cold and warm runs on a named staging tier/region, with documented network/device conditions and single-user plus five- and ten-user synthetic concurrency. Report p50 and p95 with the number of runs. Cache hits and network wait are reported separately.

Proposed review targets are p95 under one second for list/search API reads and under two seconds for report summary API reads on the agreed staging profile, with zero correctness or authorization failures. These are acceptance targets to validate, not current guarantees. If targets fail, inspect plans and payloads before changing pagination architecture. Baseline and after-change measurements must use the same fixtures, roles, and conditions.

## Rollout and decision gates

1. Approve this written design, including preservation of the current metric scopes. Then review the implementation plan and choose its execution method.
2. Build regression tests, additive versioned read functions, client adapters, and any justified index migrations in an isolated branch. Review SQL privileges and query plans. No migration runs merely because a file exists.
3. Approve the isolated staging test packet before applying schema/index changes or loading the scale fixtures. Target preflight rejects production and unrecognized projects. Verify API cap handling, real-role permissions, concurrent behavior, exact totals, browser behavior, and latency evidence.
4. Obtain separate production rollout approval after staging results, backup/restore readiness, migration review, and compatible-client verification. Additive read functions go live before their compatible client is enabled. No automatic push or deployment is implied by design approval.
5. If rollout fails, disable the new read surface or show a clear temporary report error; do not fall back to known-truncated totals. Preserve existing write safety and data history. Remove only unused additive objects through a reviewed rollback or forward repair; never restore broader privileges as a fallback.

Expiry follow-up and action lists remain separate. The existing optional date is customer PO expiry, not a promised delivery date. Later decisions must define which statuses qualify, warning thresholds, ownership, dismissal behavior, and any reminder channel or repeat cadence. No outgoing or repeated notifications are authorized by this design.

## Source references

Reviewed source tree `0eac624305f0e971eb28aba572b971c966de727c`, corresponding to deployed application commit `27d988e53d6a333f60b8a38171515f4c1fcb927f`.

- `src/pages/athel/POList.tsx`, fetchPOs and matching-ID helpers, lines 37–138
- `src/pages/athel/Dashboard.tsx`, fetchDashboardData, lines 164–404
- `src/lib/CustomerStats.ts`, batch and detail functions, lines 10–177
- `src/pages/girard/CustomerPerformance.tsx`, lines 120–240; `GirardRevenue.tsx`, lines 27–71; `GirardPerformance.tsx`, lines 129–170
- `src/pages/athel/SalesOrders.tsx`, lines 36–51; `src/pages/girard/MyOrders.tsx`, lines 38–53
- `src/pages/athel/PODetail.tsx`, lines 82–118; `POEdit.tsx`, lines 59–102; `PONew.tsx`, lines 53–68
- `supabase/config.toml`, API max_rows; security and order/visit transaction migrations dated September 30 2026
