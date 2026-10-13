# LOU Scalability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the existing order lists and operational reports complete, predictable, and measurable at 6,000 and 30,000 POs without changing transaction rules or access boundaries.

**Architecture:** Freeze versioned read contracts first. Add narrow SECURITY INVOKER SQL functions for cross-table search and aggregates; migrate existing screens through typed adapters. Keep ordinary detail/catalog reads bounded or explicitly complete, and tune only measured query bottlenecks.

**Tech Stack:** Existing React 19, TypeScript, TanStack Query 5, Supabase/PostgREST, PostgreSQL 17, Vitest 3, and the existing synthetic PostgreSQL CI service. No new runtime package is required.

**Spec:** The approved [October 1 LOU scalability design](https://chatgpt.com/api/library/files/libfile_7789f848c5088191a8ff3b5ef86b88d0/download). Copy its Markdown counterpart into `docs/superpowers/specs/2026-10-01-scalability-design.md` when execution starts; it must travel with this plan. Save this plan to `docs/superpowers/plans/2026-10-01-scalability-implementation-plan.md`. The reviewed baseline is remote commit `27d988e53d6a333f60b8a38171515f4c1fcb927f`, tree `0eac624305f0e971eb28aba572b971c966de727c`.

## Decision summary

Approve the task sequence and choose an execution method before work starts. Recommended: subagent-driven execution with a fresh reviewer per task and a final whole-branch review. SQL and client work can run in parallel only after Task 1 freezes their shared interfaces. Staging schema changes and large fixture loads need a reviewed test packet; production remains a separate approval.

This plan preserves existing date and status meanings, including the documented dashboard scope asymmetries. It does not add expiry reminders, action lists, exports, a warehouse, offline sync, or automatic deployment.

## Global Constraints

- “Keep the PO list's existing default size and filters.” Default remains 10 rows; ordinary API page sizes are validated from 1 through 100. The daily-bucket endpoint alone allows 1 through 366.
- “New read functions use SECURITY INVOKER, a restricted search path, qualified relations, typed parameters, and no dynamic SQL.” Use `STABLE`, `SET search_path = ''`, and revoke PUBLIC/anon execution before granting authenticated execution.
- “Existing RLS policies remain enabled and authoritative for every underlying row.” Supplied IDs only narrow visibility. No browser service key, table-grant expansion, RLS bypass, or role-helper rewrite.
- “Preserve current metric definitions while fixing completeness.” Keep current cutoff calculations and status predicates; do not silently repair separate date or business-rule inconsistencies.
- “No incomplete read may be presented as a successful total.” Reject malformed envelopes and interrupted reads; never substitute zero or a truncated fallback.
- “Keep atomic writes, version-conflict checks, duplicate-safe retries, audit records, void history, and request reconciliation intact.” Do not modify transaction RPC signatures or prune retained history.
- “Proposed review targets are p95 under one second for list/search API reads and under two seconds for report summary API reads on the agreed staging profile, with zero correctness or authorization failures.” These remain unmeasured targets.
- No production fixtures, migrations, index execution, push, or deployment is authorized by this plan alone.

## Review Focus

1. A different role or account reuses cached search/report data: Task 4 tests cache clearing and cross-role isolation.
2. A page contains repeated timestamps, or its final row is removed: Task 4 tests deterministic ID tie-breakers and page recovery.
3. A child table exceeds the API cap while its parent does not: Tasks 3 and 6 test independent caps and fail-closed completeness.
4. A literal search contains `%`, `_`, commas, quotes, or backslashes: Task 2 proves literal matching and unchanged authorization.
5. A report spans a time-zone boundary or a PO changes while detail pages load: Tasks 3 and 6 pin date semantics and version-consistent edit input.

## Shared interfaces to freeze in Task 1

Create `src/lib/reads/contracts.ts`, `rpc.ts`, `orders.ts`, `reports.ts`, and `completeReads.ts`. Keep domain row types in `contracts.ts`; screens retain their existing labels and calculation meanings. `rpc.ts` exports `callRead<T>(name: ReadRpcName, args: Record<string, unknown>, signal?: AbortSignal): Promise<T>` and rejects absent versions, invalid counts, unsafe numeric conversions, and incomplete pages.

Every SQL function below returns one JSON object: `{version: 1, as_of: string, ...payload}`. `Page<T>` includes those envelope fields plus `{items: T[], total: number, page: number, page_size: number}`. Page/count predicates run within one SQL statement snapshot. Validate positive integer pages, bounded sizes, statuses, date order, and UUID-array lengths. PO status accepts all/draft/confirm/in_progress/complete/cancelled; sales status accepts all/pending/approved/rejected/cancelled. Empty authorized results return an exact zero and an empty array. Money is serialized as decimal text and formatted without summing it again in JavaScript; chart projections may convert to finite numbers for plotting only. Counts must remain safe integers. `ReadRpcName` is the exhaustive union of the function names below.

Reserve these additive migration files; verify no conflicting version exists before execution:

- `supabase/migrations/202610010001_scalable_order_reads.sql`
- `supabase/migrations/202610010002_scalable_report_reads.sql`
- `supabase/migrations/202610010003_scalability_indexes.sql`, created only if measured plans justify specific indexes

### Order contracts

- `pilot_po_page_v1(p_status text, p_search text, p_page integer, p_page_size integer)` returns `Page<POSummary>`. Copy the currently displayed PO fields; customer relation is nullable, and nested SJ arrays are omitted. Search uses escaped literal contains predicates and EXISTS; order is `created_at DESC, id DESC`.
- `pilot_sales_order_page_v1(p_status text, p_own_only boolean, p_page integer, p_page_size integer, p_customer_id uuid DEFAULT NULL, p_visit_id uuid DEFAULT NULL)` returns `Page<SalesOrderSummary>` plus `status_counts`. `p_own_only` adds `submitted_by = auth.uid()`; false does not bypass RLS. Counts use the same active filters across the entire matching set. Return no line arrays; fetch selected-order lines separately. Order is `created_at DESC, id DESC`.
- `pilot_po_lines_v1(p_po_id uuid, p_page integer, p_page_size integer, p_expected_updated_at timestamptz DEFAULT NULL)` returns `Page<POLineState>`, `po_updated_at`, and `po_has_delivery_history`. A line includes existing line fields, exact active `delivered_quantity`, and `has_delivery_history` including voided history. Reject a supplied stale PO version with SQLSTATE `40001`. This separates authoritative quantities from paged delivery/audit presentation.

### Report contracts

All input dates and timestamp bounds come from the existing client boundary helpers, characterized before replacement; do not substitute database CURRENT_DATE or a different reporting timezone. For customer/sales performance, a sales-manager adapter passes its own ID and SQL requires it to equal `auth.uid()`. The customer cohort is its assigned customers; the sales cohort is its active team plus itself. Head/executive adapters pass NULL and receive the existing all-visible cohort. SQL derives the role and preserves RLS in either case; an executive's own ID must not accidentally become a manager filter. Other callers gain no visibility beyond existing RLS.

- `pilot_athel_summary_v1(p_from date, p_to date, p_rolling_from date, p_status text, p_fulfillment text)` returns existing `DashboardData` fields except `dailySeries`: KPIs, 12 month buckets, customer share, status breakdown, top 10 customers, and top 10 outstanding items. Customer-share/status arrays are bounded by the existing categories.
- `pilot_athel_daily_v1` takes those same five arguments plus `p_page integer, p_page_size integer` and returns `Page<DailyBucket>`, ordered by calendar day. Daily pages are at most 366 buckets. The adapter loads every requested date bucket before showing that chart; no new business date-range limit is introduced. Each request has its own snapshot, explicitly distinct from the single-snapshot summary; a refresh or mutation invalidates the entire chart. Never merge an old-filter page into a new chart.
- `pilot_customer_stats_v1(p_customer_ids uuid[], p_cutoff date, p_top_limit integer)` accepts at most 100 customer IDs and top limit 1–10. Return one aggregate per visible requested customer: ID, first order date, recent order count, delivered sales, and ranked `{name, revenue}` items. Existing batch and detail adapters select their existing fields; no raw order history is returned.
- `pilot_customer_performance_v1(p_manager_id uuid, p_year_month text, p_visit_from timestamptz, p_visit_until timestamptz, p_page integer, p_page_size integer)` returns `Page<CustomerRow>` plus `summary: {total_sales, active_customers, total_customers, total_visits, total_target_visits, visit_percent, top_customer}`. `visit_percent` is the rounded ratio of full visits to targets, or zero when the denominator is zero. Resolve the latest target at or before the selected month in SQL, and latest visit per customer in SQL. Apply the role/cohort contract above; no client role string is accepted.
- `pilot_revenue_v1(p_from timestamptz, p_to timestamptz, p_page integer, p_page_size integer)` returns `Page<CustomerRevenue>` plus `{total_sales, total_orders, active_customers, top_customer}` for the whole approved-order set. Order by sales descending, then customer ID.
- `pilot_sales_performance_v1(p_manager_id uuid, p_date_from date, p_date_to date, p_order_from timestamptz, p_order_to timestamptz, p_year_month text, p_page integer, p_page_size integer)` returns `Page<PerformanceData>` plus `summary: {total_visited, total_scheduled, total_orders, total_sales, average_visit_rate}`. Preserve its existing order-status basis and latest-effective target behavior. Average visit rate is the rounded mean of each member's already-rounded rate, not the global visited/scheduled ratio; empty teams yield zero.
- `pilot_team_activity_v1(p_user_ids uuid[], p_day date, p_order_from timestamptz, p_order_to timestamptz, p_week_from timestamptz)` accepts at most 100 IDs; return daily schedule/visited/order counts and weekly visit counts per visible user. IDs do not establish authorization.
- `pilot_manager_customers_v1(p_manager_id uuid, p_visit_from timestamptz, p_as_of timestamptz, p_page integer, p_page_size integer)` returns `Page<CustomerWithStats>` plus `summary: {on_track, overdue, total}`. Preserve the existing 30-day target calculation and overdue reference instant; SQL and client use the same supplied `p_as_of`.

Task 1 must copy the exact existing row and summary fields into the contract file and examples. Freeze that reviewed file before downstream tasks; do not let separate workers infer competing DTO shapes.

## Read path inventory and ownership

| Existing source | Required contract | Owner |
| --- | --- | --- |
| Athel POList; SalesOrders; Girard MyOrders; VisitPage order history | Order page RPCs; selected-order line read | Tasks 2 and 4 |
| Athel Dashboard; dashboard chart types/options | Summary RPC plus complete daily buckets | Tasks 3 and 5 |
| CustomerStats; DailySchedule/MyVisits stats; GirardCustomerDetail statistics | Customer aggregate RPC | Tasks 3 and 5 |
| CustomerPerformance; GirardRevenue; GirardPerformance | Paged aggregate rows plus independent full totals; latest targets/visits in SQL | Tasks 3 and 5 |
| GirardTeam; ManagerCustomers | Aggregate RPCs and complete directory inputs | Tasks 3, 5, and 6 |
| PODetail and POEdit line state; delivery/audit history | Versioned line state; paged headers/audit; separately complete selected-SJ lines | Tasks 2, 4, and 6 |
| PONew, POEdit, VisitPage, Promotions product/customer choices; ManagerSchedule choices | Explicit complete master-data reads, with stable ID iteration and abort/error handling | Task 6 |
| CustomerList and ProductList | Existing server ranges plus ID tie-breaker and literal-search handling | Task 6 |
| DailySchedule, MyVisits, ManagerSchedule | Complete reads for their selected date window; unique ID tie-breaker; batched related IDs | Task 6 |
| GirardCustomers, GirardManagers, manager/team assignment/directory inputs | Complete paged reads; aggregate counts never from a capped fragment | Task 6 |
| GirardCustomerDetail recent visits/orders; earliest-date lookups; individual profiles/PO/schedule/visit; AthelNav count | Intentionally bounded 10/20/1/single/head reads; preserve bounds, add ties/errors where needed | Task 6 review |
| Promotion history/active promotion reads and user-directory helpers consumed above | Complete narrow metadata reads; no pricing or permission change | Task 6 |
| IHR user administration and unrelated write flows | Record as outside this PO/report change; do not claim app-wide capacity coverage | Task 8 inventory |

No export currently exists in this scope. Document that a future export must iterate authorized full results and reconcile count; do not implement one now.

## Task 1 Freeze contracts and red regression fixtures

**Files:** Create `docs/scalability-read-contracts.md`, `docs/scalability-read-inventory.md`, `src/lib/reads/contracts.ts`, `tests/scalability/fixtures.ts`, `read-contracts.test.ts`, and `current-cap-regressions.test.ts`. Modify `package.json` to add `test:scalability` = `vitest run tests/scalability`.

**Interfaces:** Produces the exact RPC/DTO contract above, fixture builders, and shared named response examples. No production query changes in this task.

- [ ] Write named tests with these desired assertions: `latestThreeMonthPOCount === 1500` for 6,000 POs at 500/month; `outstandingValue === '50000.00'` for 500 POs × 10 undelivered lines × 10; `search.total === 101` for 101 matching customers. Port the existing in-memory reproductions into maintained tests, without runtime source-string extraction.
- [ ] Run `npm run test:scalability`; capture the three expected red failures before replacing reads. Add small complete-data characterization snapshots for every migrated metric, including its current asymmetric date/status scope.
- [ ] Extract only the required row types and pure boundary helpers; define every returned summary field, decimal serialization, null relation, ordering, error, and RPC parameter in the contract examples. Add adapter decoding tests for malformed envelopes and out-of-safe-range counts.
- [ ] Independently review contract parity with the approved design. Freeze the reviewed interfaces and run the unchanged baseline via `npm test -- --exclude 'tests/scalability/**'`; commit only contract/fixture scaffolding as `test: characterize scalable read contracts`. Record the new suite as intentionally red until the owning implementation turns it green; do not skip or disable assertions, and do not publish an intermediate red branch as release-ready.

## Task 2 Implement order read functions

**Files:** Create migration `202610010001_scalable_order_reads.sql`, `tests/database/scalable-order-reads.sql`, and `tests/scalability/order-rpc.test.ts`. Consumes Task 1; produces the three order RPCs.

- [ ] Write SQL assertions: 101 customer/SJ matches remain complete; duplicate matching SJs yield one PO; tied timestamps sort by ID; all page sizes and invalid inputs follow the contract; each role sees only authorized rows; active/voided history produces correct line flags and quantities; stale detail version raises `40001`.
- [ ] Run the SQL suite against the existing disposable `pilot_test` fixture before adding functions; verify missing-function failures, then implement invoker functions with explicit revoke/grant statements and preaggregated delivery quantities.
- [ ] Rerun SQL assertions under authenticated roles, plus anon and inactive cases. Check `pg_proc.prosecdef = false`, stable volatility, restricted search path, and no unexpected EXECUTE grants. Run `npm test -- tests/scalability/order-rpc.test.ts` for wire shapes and literal punctuation fixtures.
- [ ] Fresh review must inspect search EXISTS authorization, decimal serialization, count/page parity, and version checks. Commit the reviewed migration and tests as `feat: add scoped order read endpoints`.

## Task 3 Implement report read functions

**Files:** Create migration `202610010002_scalable_report_reads.sql`, `tests/database/scalable-report-reads.sql`, and `tests/scalability/report-contracts.test.ts`. Consumes Task 1; produces all eight report RPCs.

- [ ] Write assertions for the three cap boundaries 999/1,000/1,001 independently on POs, PO lines, SJs, and SJ lines. Include older PO/current-month shipment, zero-price lines, cancelled/voided history, two deliveries on one line, multiple targets with latest-effective selection, and repeated visits per customer.
- [ ] Run SQL tests red against the disposable fixture. Implement per-child aggregation before joins, then group to each approved metric. Use SQL numeric aggregates and decimal-text money output; never multiply sums through raw one-to-many joins.
- [ ] Run the suite under each real test role and compare against independent direct-SQL ground truth. Assert fixed-size top rankings, exact full totals when row groups exceed one page, daily bucket paging, manager-own-team versus executive-all-visible cohorts, rejection of a mismatched manager ID, and no leaked counts for hidden customers or team members.
- [ ] Run characterization tests in UTC, Asia/Jakarta, and America/Los_Angeles; preserve existing boundary behavior. A separate metric inconsistency is reported, not silently changed. Fresh review and commit as `feat: add complete operational report reads`.

## Task 4 Migrate order lists and authoritative detail state

**Files:** Create `src/lib/reads/rpc.ts`, `orders.ts`, `usePagedRead.ts`, `src/components/PaginationControls.tsx`, and `tests/scalability/order-pages.test.tsx`. Modify `POList.tsx`, `SalesOrders.tsx`, `MyOrders.tsx`, `VisitPage.tsx`, `PODetail.tsx`, and `POEdit.tsx` in their current page directories; update affected existing mocks without dropping assertions.

**Interfaces:** Consumes frozen order contracts and `callRead`; list adapters return exact page envelopes. `usePagedRead<T,F>(key: string, initialFilters: F, fetcher: (filters:F, page:number, signal:AbortSignal)=>Promise<Page<T>>)` returns `{data, filters, page, setFilters, setPage, isPending, isError, refetch}`. `setFilters` resets page to one in the same update. Detail adapters retain PO version across loaded line pages. `PaginationControls` takes `{page, total, pageSize, pending, onPageChange}`.

- [ ] Write UI tests for 10-row pages, exact count, 300 ms component-local debounce, simultaneous filter/page reset, pending old-row indication, disabled repeated Next, stale response exclusion, deleted final page recovery, and identity-cache clearing.
- [ ] Run tests red. Replace list queries with typed RPC adapters; remove unused nested histories; load line details when selected. Preserve approve/reject/submit mutations and normal recovery flow.
- [ ] Replace delivery-derived edit quantities with versioned line state. Tests must show that a paged delivery history cannot cause over-delivery, omitted-line deletion, or lost immutable-history flags; interrupted or changed-version loads block save until refreshed. Keep existing transaction expected-version checks.
- [ ] Run new tests and existing order, delivery, form, navigation, and recovery tests; fresh review and commit as `feat: make order browsing complete and predictable`.

## Task 5 Migrate reports without redefining metrics

**Files:** Create `src/lib/reads/reports.ts`, `money.ts`, and `tests/scalability/report-pages.test.tsx`. Modify Athel `Dashboard.tsx`, `components/athel/dashboardChartOptions.ts` and `DashboardCharts.tsx`, `lib/CustomerStats.ts`, and Girard `CustomerPerformance.tsx`, `GirardRevenue.tsx`, `GirardPerformance.tsx`, `GirardTeam.tsx`, `ManagerCustomers.tsx`, and their existing report tests.

**Interfaces:** Consumes report contracts. Existing screen-facing helpers remain adapters so callers change minimally; grouped report rows page at 50, while cards use server full totals. `formatMoney(value: string, style: 'full'|'millions'): string` uses decimal-safe rounding: full output preserves Indonesian grouping with at most three decimals and no unnecessary trailing zeros; millions output has one decimal. Tests pin `formatMoney('50000.00','full') === '50.000'` and `formatMoney('1500000.00','millions') === '1.5'`; existing labels retain their Rp prefix and M suffix. `moneyToChartNumber(value: string): number` rejects non-finite projections. Chart conversion never feeds totals or mutation payloads. Existing numeric write payloads and server validation remain unchanged.

- [ ] Write tests asserting all current small-data metric snapshots, no page-derived totals, no zero on failed summaries, all daily buckets before chart display, complete batch stats in chunks of 100 IDs, and correct invalidation after relevant writes.
- [ ] Run tests red; replace raw-history queries and repeated client `.find`/`.filter` aggregation with adapters. Remove obsolete target-history and latest-visit scans. Keep existing month helpers and documented metric asymmetries.
- [ ] Make the three regression expectations green. Run all existing customer statistics, report month/cross-month, chart lifecycle/render, and error tests in the three timezones. Fresh review and commit as `feat: render complete database report summaries`.

## Task 6 Close supporting read completeness gaps

**Files:** Create `src/lib/reads/completeReads.ts`, `tests/scalability/complete-reads.test.ts`, and `history-pages.test.tsx`; modify the Task 6 inventory sources. Coordinate POEdit/PODetail ownership with Task 4 rather than editing the same files concurrently.

**Interfaces:** `readComplete<T>(fetchPage: (offset: number, limit: number, signal?: AbortSignal) => Promise<{items:T[]; total:number}>, keyOf: (row:T)=>string, signal?:AbortSignal): Promise<T[]>` uses chunks of 500 and advances by actual returned rows. Exact totals, stable unique ordering, duplicate detection, empty-before-total detection, abort propagation, and bounded one-time retry on a changed collection prevent silent partial success. `chunkIds(ids: string[], size=100)` bounds related-ID filters. This helper is for metadata or one-entity detail, never bulk report facts.

- [ ] Write tests where the API returns 100 rows despite a requested 500, where page 2 fails, where totals change, and where an ID repeats. Assert complete final data or an explicit incomplete-read error, never a partial array.
- [ ] Run tests red; add stable IDs to intentional bounded reads, complete the catalog/directory/schedule inputs, and split one-to-many line histories into their own reads. Catalog iteration uses ID order; apply existing name ordering after completion. Keep all existing role predicates.
- [ ] Page audit history by `changed_at DESC,id DESC`, delivery headers by `sj_date ASC,id ASC`, default 20. Fetch selected delivery lines completely before opening a correction form. Load all PO edit lines with version consistency; displayed history pagination must not determine business quantities.
- [ ] Rerun catalog, schedule, visit-relation, delivery-history, and form-safety tests. Update the inventory with each actual read contract; fresh review and commit as `fix: remove silent supporting read caps`.

## Task 7 Prepare and run isolated scale validation

**Files:** Create `tests/scalability/generate-fixtures.mjs`, `measure-reads.mjs`, `tests/database/scalability-ground-truth.sql`, `scripts/verify-scale-target.mjs`, and `docs/scalability-staging-packet.md`. Modify `.github/workflows/pilot-safety.yml` to run new small-fixture SQL tests; large hosted runs remain manual and gated.

- [ ] First write guard tests: generation/loading refuses a production or unrecognized target, missing disposable marker, missing explicit permit, excessive requested rows, and non-synthetic identities. Default generator mode prints a manifest only; it never connects or writes.
- [ ] Define deterministic 6,000 and 30,000 PO fixtures with 10 lines per PO, two delivery headers per PO, and split quantities generating 20 delivery lines per PO: respectively 60,000/300,000 PO lines, 12,000/60,000 headers, and 120,000/600,000 delivery lines. Add a separate edge-case set for no delivery, partial delivery, void/cancel, timestamps, role boundaries, audit, and request-ledger growth; publish its exact counts and expected totals in the generated manifest. Avoid expensive per-row business triggers in bulk setup only inside the disposable synthetic contract; separately exercise real transaction RPC behavior with the existing safety suites.
- [ ] Review the packet with exact target project, dataset bytes/counts, fixture mechanism, role accounts, cleanup, timeouts, and schema/index changes. Obtain staging-run approval before loading large data or applying migrations. Never disable production triggers or constraints.
- [ ] Capture baseline and candidate query plans and API/browser measurements using the same fixture, roles, tier, region, and network/device profile. Use at least 100 measured requests per named API case after 10 warmups for p50/p95; record cold runs separately. Include first/middle/final PO pages, broad/exact/no-match search, reports, details, and concurrent synthetic sessions at 1, 5, and 10 users. Record errors, bytes, requests, SQL buffers, API latency, and browser-perceived load separately.
- [ ] Inspect actual indexes and EXPLAIN ANALYZE under application roles. Only then create `202610010003_scalability_indexes.sql` with the smallest justified non-overlapping indexes. Recheck plans, write overhead, and exact totals. A concurrent-build production strategy, if needed, is reviewed separately because it cannot be wrapped in the usual migration transaction.
- [ ] Produce a result matrix: correctness and authorization must have zero failures; list/search p95 target <1 second and summary p95 target <2 seconds on the declared profile. Failures trigger diagnosis, not a capacity claim. Fresh review and commit only reviewed harness, evidence, and justified index definitions.

## Task 8 Final review and release packet

**Files:** Update `docs/database-rollout.md`, `docs/pilot-readiness.md`, and `docs/scalability-staging-packet.md`; create `docs/scalability-verification.md` and `docs/scalability-rollback.md`.

- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`; run all existing SQL security/transaction/concurrency suites plus new scalable-read suites on the exact final commit. Preserve existing assertions. Record passed, failed, and not-run stages separately.
- [ ] Perform browser QA on real supported transport: loading, retry, rapid filtering, Back/Forward, detail return, identity switch, partial delivery, correction, and mobile layouts. If browser or hosted-role access is unavailable, record the unrun gate; do not mark release-ready.
- [ ] Fresh whole-branch review compares the read inventory and every design requirement to code, tests, SQL grants, real-role staging evidence, and query plans. Resolve blockers and rerun affected checks after any edit.
- [ ] Prepare additive-backend-first rollout and compatible-client validation. Production requires separate approval and backup/restore readiness. Rollback disables the new read surface or shows an explicit temporary report failure; it never restores truncated totals, broad grants, or unsafe write paths. Do not drop objects with active consumers or delete business/request history.
- [ ] Commit reviewed documentation as `docs: record scalability verification and rollout gates`. Return exact commit, tests, latency evidence, remaining gates, and proposed release action. Do not push or deploy without its required authorization.

## Dependency and execution decision

Task 1 is a hard gate. After its interface review, the SQL track (Tasks 2–3) and client track (Tasks 4–5 using frozen mocked responses) may proceed in parallel with different file owners. Integration waits for both. Task 6 follows conflicting page edits; Task 7's guard/manifest work can proceed independently, while database runs wait for the approved packet and integrated candidate. Task 8 reviews the final combined result.

Recommended method: **Subagent-driven**, because count correctness, financial aggregation, and authorization mistakes warrant independent gates. **Native** is the lower-overhead alternative: one implementer follows the same tasks, then a fresh reviewer examines the whole branch. Approval of this plan and selection of one method are both required before implementation.
