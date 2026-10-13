# Consignment Order implementation plan

Padiwan • Version 1 • 9 October 2026 • Prepared for Patrick

## Decision and delivery sequence

The approved design can be built as one isolated candidate, with independently checked stages. The current staging and combined-release branches were verified read-only at commit 75d38e55aa886386441597e8c22bb2fd90013565 on 9 October 2026. This plan has not implemented or tested the feature.

1. Establish the private consignment records, stable customer SKU identities, and safe transaction contracts.
2. Build deliveries, monthly FIFO sales, goods returns, and fully audited corrections.
3. Enforce the two admin access boundaries while retaining HR/Cuti.
4. Build the three familiar Procurement tabs and private report attachments.
5. Connect clearly separated PO Order Value, PO Delivered Revenue, and CO Sold Revenue to scoped Sales summaries.
6. Run complete application, database, concurrency, access, and browser checks; prepare a reviewed deployment packet.

Recommended execution: stage-by-stage implementation with a separate review at each meaningful boundary, followed by a full integrated review. A single implementation pass followed by one final review is a faster alternative, but gives less early independent checking of stock and access changes.

Next approval requested: approve this plan and the recommended staged build and testing in an isolated branch/workspace, including local commits and disposable synthetic database tests. Publication, a draft PR, hosted migration application, account or role grants, and deployment remain separate approval steps. The exact hosted access changes must be reviewed at application time. No test-data clearing is included.

## Goal architecture and baseline

Goal: add Consignment Order operations with customer-wide monthly sell-through reporting and company-owned customer stock, while keeping PO order value distinct from delivered revenue.

Architecture: private CO tables and checked public RPCs own order, delivery, monthly report, return, and audit records. Deterministic replay produces immutable stock/allocation generations; one per-customer pointer selects the effective generation. React screens reuse established lookup, pagination, unsaved-change, and recovery patterns without inserting CO records into PO tables.

Tech stack: current React 19, TypeScript 5, React Router 7, TanStack Query 5, Vite 6, Supabase/PostgreSQL 17, Vitest 3 and Testing Library. Use the existing lockfile and supported Node engine: >=22.13.0 <23 or >=24.0.0 <25. No additional package is assumed by this plan.

Spec: Padiwan Consignment Order design for review, version 1, approved on 9 October 2026, together with the explicit approval of SJ-date stock eligibility, report-month sales, creation-time price/credit, Admin CO read/select-only master lists, preserved PO Admin authorized editing, and HR/Cuti for both.

Source baseline: pl0203/lou_erp, fix/pilot-database and fix/demo-revisions both at 75d38e55aa886386441597e8c22bb2fd90013565. The recursive source tree was complete; no AGENTS.md or repository skill directory appeared in it. Recheck the actual execution checkout before beginning. The previous release's passing checks are historical evidence, not tests of this new feature.

Important preserved release mapping: hosted migration receipt 20261009065443 corresponds to repository source 20261009061801_unify_store_owner_credit.sql. It is already applied. Do not reapply either owner correction or use a generic migration push that mistakes the naming difference for missing work.

## Global constraints

- Admin CO Procurement menus: Consignment Order, Customer List, Item List. Customer/item access is read/select only.
- Admin PO Procurement menus: Purchase Order, Customer List, Item List. Preserve actual backend-authorized master actions; do not add deletion rights to match a visible button.
- Both retain HR/Cuti. Existing PO Admin leave behavior stays intact. CO Admin uses explicit HR membership, balances and approvers; unconfigured HR shows truthful setup requirements without blocking CO operations.
- Executive receives CO operations; Sales audiences receive only authorized own/team/leadership aggregate summaries, never raw CO reports or evidence.
- SJ date starts eligible recorded consignment stock. Receipt date remains separate. Dispatch produces no CO revenue.
- One customer/month report covers SKU totals across all COs. Allocate oldest delivered stock first, preserve source agreed prices and CO-creation credit, and distinguish missing values from explicit zero.
- Draft SJ/report/return records have no stock, revenue, credit or effective-report effects.
- Posted corrections retain originals, preview all downstream impacts, validate nonnegative source stock, and commit atomically.
- Customer stock is recorded quantity with sales-report freshness, not a claim of verified real-time physical stock. Historical CO stock views use month-end, not invented sale-day histories.
- No historical opening stock is inferred. No warehouse cost valuation, sold-goods refunds, write-offs, invoicing, payments, customer portal, OCR or automatic report import is included.
- Existing PO/line/SJ/Girard business contents, promotion quantities and owner-correction evidence must remain unchanged by migration. Only the reviewed reporting definitions and access boundaries change.

## Review focus

These five failure classes have explicit tests in the tasks below.

1. A freeform SKU collides with a renamed or different catalog item: preserve stable identity and reject ambiguity instead of merging stock.
2. Multiple same-day delivery batches carry different prices or credited owners: deterministic FIFO must survive display order and correction revisions.
3. A large statement, missing month, backdated return or partial current month creates hidden stock gaps: compute all rows and all affected history, never borrow future stock.
4. Two admins, a stale preview, a role change or a lost network response overlap: one authorized outcome, no duplicated posting and no lost draft.
5. A hidden URL, direct RPC, storage endpoint or old recovery receipt bypasses the sidebar: server authority must enforce the same boundary while PO/HR continue to work.

## Shared data and API contract

### Records and immutable evidence

All CO tables are in private, with RLS and no PUBLIC, anon or authenticated direct table/sequence grants. Checked public RPCs are the only client entrypoints. Functions use empty search_path, fully qualified references and current active-role checks.

- co_stock_keys: stable UUID, customer, required display SKU, normalized SKU lower(btrim(sku)), optional catalog product ID and original identity. Unique customer/normalized SKU. Unknown freeform SKUs remain supported. An existing key is explicitly reused; catalog edits never rebind it. Conflicting product identity fails closed.
- co_orders and co_order_lines: active/closed/cancelled header, version, number/dates/notes, immutable customer and creation-credit snapshot; stable lines with stock key, ordered quantity, resolved-undelivered quantity and agreed price. Catalog price changes never reprice an existing CO line. Agreed prices and creation credit stay fixed; ordinary edits are limited to allowed quantities, notes and planning fields and cannot rewrite posted source identity.
- co_customer_state: customer version and effective generation pointer; serialization boundary across all that customer's COs.
- co_drafts and co_report_draft_lines: versioned SJ/report/return input; report lines are server-backed and nullable until explicitly entered. Drafts are separate from posted facts.
- co_delivery_heads/revisions/revision_lines, co_report_heads/revisions/revision_lines, co_return_heads/revisions/revision_lines: versioned heads point to immutable source revisions. Report heads are unique by customer and first-of-month report date. Composite foreign keys prove a revision belongs to its head.
- co_stock_batches: stable original delivery-line identity, source CO, original delivery creation order and agreed price/credit snapshots. Correction revisions do not gain new FIFO seniority.
- co_replay_generations, co_stock_movements and co_sale_allocations: immutable replay evidence. Operational and metric reads join the effective customer generation only.
- co_commands and co_audit_events: actor/request idempotency, recovery tombstones, immutable reason/actor/before-after/revision/generation evidence. No hard deletion of posted history.
- co_evidence: canonical customer/report/draft or revision link, private storage identity, type/size/digest and audit linkage; attachment download never trusts an arbitrary client-supplied path.

### Values and response envelopes

Money is decimal text, calculated in PostgreSQL numeric without JavaScript Number aggregation. Unit prices allow deliberate zero and at most two fractional digits, maximum 999999999999.99. Extended values use sufficient numeric precision, not a lossy fixed-width JavaScript amount.

Version is positive decimal bigint text. Aggregate Quantity is nonnegative integer text. Individual entered quantities are safe integers from 0 to 2147483647; zero is allowed for sold totals but returns/deliveries need positive quantities. A blank sold field is null.

COStatus = active | closed | cancelled. CO creation is active; there is no separate persisted CO activation workflow. Persisted drafts are SJ/report/return only.

COReceipt = {id, operation, version, customer_id, customer_version}. CORecovery = committed with operation and receipt, abandoned, or unknown. Only committed and abandoned are terminal. A minimal validated receipt may be retained for recovery; payloads, prices, evidence bytes and preview details may not.

COOperation = create_co | edit_co | cancel_co | save_sj_draft | post_sj | save_report_draft | post_report | save_return_draft | post_return | correct_sj | correct_report | correct_return | resolve_undelivered | close_co.

COPreview is a header: version, operation, customer_id, customer_version, optional draft_version, preview_fingerprint, can_post, before/after summary, and exact counts for report, stock, revenue, credit, reopen, issue and missing-month impacts. Detail is paginated, never an unbounded or silently truncated array. The fingerprint binds actor, payload, algorithm version, every relevant version/source fact and the entire computed plan. It is not an authorization token.

Errors: 22023 invalid input or identity; PT409 with CO_VERSION_CONFLICT or CO_PREVIEW_STALE for stale state; 23514 stock/completeness/closure invariant; 42501 authority; 55000 abandoned request or invalid terminal transition. Errors must not disclose another scope's private details.

### Public RPCs

Every RPC returns validated jsonb with version/as_of metadata. UUID/date/month identifiers and nullable filters are explicit; ordinary pages are 1 to 100 rows, with stable ordering and server totals.

- pilot_co_transaction_v1(p_request_id uuid, p_operation text, p_payload jsonb)
- pilot_reconcile_co_v1(p_request_id uuid, p_abandon boolean default false)
- pilot_co_preview_v1(p_operation text, p_payload jsonb)
- pilot_co_preview_impacts_v1(p_operation text, p_payload jsonb, p_preview_fingerprint text, p_kind text, p_page integer, p_page_size integer); kind = report | stock | revenue | credit | reopen | issue | missing_month
- pilot_co_page_v1(p_status text, p_search text, p_page integer, p_page_size integer)
- pilot_co_detail_v1(p_co_id uuid, p_expected_version text default null)
- pilot_co_reports_page_v1(p_customer_id uuid nullable, p_month text nullable, p_status text, p_page integer, p_page_size integer)
- pilot_co_report_months_v1(p_customer_id uuid)
- pilot_co_report_v1(p_customer_id uuid, p_month text, p_expected_customer_version text default null); returns header/completeness/freshness only
- pilot_co_report_rows_v1(p_customer_id uuid, p_month text, p_view text, p_expected_draft_version text nullable, p_expected_customer_version text, p_page integer, p_page_size integer); view = draft | effective
- pilot_co_report_allocations_v1(p_customer_id uuid, p_month text, p_revision_id uuid, p_expected_customer_version text, p_page integer, p_page_size integer)
- pilot_co_customer_stock_v1(p_customer_id uuid nullable, p_as_of date nullable, p_search text, p_expected_customer_version text nullable, p_page integer, p_page_size integer); as_of is null or calendar month-end; expected version requires a customer
- pilot_co_stock_movements_v1(p_customer_id uuid, p_stock_key_id uuid, p_as_of date nullable, p_page integer, p_page_size integer)
- pilot_sales_metrics_v2(p_manager_id uuid nullable, p_month_from date, p_month_until date, p_group_by text, p_order_type text, p_page integer, p_page_size integer); group_by = customer | person, order_type = po | co | all
- pilot_sales_metric_months_v2(p_manager_id uuid nullable, p_order_type text)
- pilot_procurement_access_v1(); explicit current-role customer/product create/edit/delete capabilities

### Monthly drafts and large statements

A report has no total SKU cap derived from transport limits. Initialize every eligible server-side stock key with sold_quantity null. Row reads page at 100; writes accept at most 500 unique rows per chunk. Header counts are advisory; preview and post recalculate exact coverage from all stored rows.

save_report_draft accepts a strict discriminated payload:
- initialize: customer_id, report_month, expected_customer_version
- upsert_lines: draft_id, expected_draft_version, expected_customer_version, eligible_set_fingerprint, lines [{stock_key_id, sold_quantity number|null}] with 1 to 500 entries
- fill_remaining_zero: draft_id, expected_draft_version, expected_customer_version, eligible_set_fingerprint; explicit user action fills every remaining null, including unloaded pages, and preserves entered values

post_report accepts draft_id, expected_draft_version, expected_customer_version, eligible_set_fingerprint and preview_fingerprint. It never trusts a client-assembled whole statement. Missing earlier reports in a correction are referenced as separately completed stored drafts. New deliveries/SKUs or revised history invalidate the pinned eligible set.

### Deterministic replay and period attribution

FIFO order is eligible SJ date, original delivery creation order, stable batch ID. Source keys survive revisions. Replay dated deliveries then source-specific returns; within the same date deliveries precede returns, and the report's cumulative depletion checkpoint follows its coverage boundary. This is processing order, not an assertion of actual sale days.

Completed reports cover month-end. Current-month posting is allowed with immutable coverage_through_date equal to the explicit UTC server calendar date used by current order writes and is_partial_month true. Future posted report months, SJ dates and return dates are rejected; unposted drafts may retain future plans. Extending current-month coverage is a reviewed revision. Never silently include sources after a report's coverage date.

Required reporting begins with opening/first eligible stock, covers months with stock or movements through final settlement, and ends when all COs are closed and stock is zero. Zero reports are explicit; required missing reports are never invented. A correction replays the complete affected customer chronology into a new generation, appends necessary downstream allocation revisions and switches pointers atomically. Every dated source balance must remain nonnegative.

## File structure and dependency order

Reserve additive migrations 20261009110000_co_role.sql; 01_co_foundation.sql; 02_co_orders_deliveries.sql; 03_co_monthly_fifo.sql; 04_co_returns_corrections.sql; 05_co_reads.sql; 06_co_reporting.sql; 07_co_access.sql; 08_co_evidence.sql. Each suffix is prefixed 202610091100. Check uniqueness on the execution branch; do not renumber/reapply existing migration history. The enum-only 00 transaction commits before any SQL uses co_admin.

Domain files: src/lib/co/{contracts,rpc,transactions,queryKeys,validation,catalog,evidence}.ts. New UI lives in src/pages/athel/co/ and src/components/co/. Shared role capability code lives in src/lib/procurementAccess.ts. New metrics adapter is src/lib/reads/salesMetrics.ts; existing report screens change labels and sources deliberately.

Database tests live in tests/database/co/; application tests in tests/co/. scripts/test-co-ci.mjs is the dedicated guarded composition; scripts/co-preflight.sql and scripts/build-co-rollout.mjs prepare future reviewed rollout evidence. Repository documentation destinations after execution approval: docs/superpowers/plans/2026-10-09-consignment-orders.md and docs/co-rollout.md. This planning artifact has not been committed or published.

Focused verification convention: scripts/test-co-ci.mjs accepts only --through 01, 02, 03, 04, 05, 06, 07 or 08; omission means all. Every invocation requires a fresh guarded disposable PostgreSQL service and creates pilot_co_test once. A fixed internal allowlist maps each stage to exact migrations and SQL tests, including fixture-only foundation helpers; it accepts no arbitrary path or database target. During development, run the numbered task's stated stage after writing its failing SQL test, then again after implementing that stage. For React/TypeScript tasks, run npm test -- tests/co/<listed-test-file> --maxWorkers=1 for every listed test file, first red then green. A connection/configuration failure is never a successful red test. Final CI runs all stages without a flag.

Tasks 1–6 build the shared backend. Task 7 enforces access. Tasks 8–10 are independent UI units after their contracts and access checks exist. Task 11 adds optional evidence. Task 12 integrates Sales presentation. Task 13 verifies the complete candidate. Every task has a red test, implementation step, green verification and reviewable local commit; none has been executed here.

## Task 1 Foundation stock identity and safe test harness

Files: create migrations 00 and 01 above; tests/database/co/{fixture,foundation}.sql; scripts/test-co-ci.mjs; tests/co/ci-runner.test.ts. Create shared CO value/receipt types in src/lib/co/contracts.ts.

Interfaces: produce private schema, customer serialization/version row, stable stock_key_id, immutable evidence constraints, and actor/request receipt/tombstone envelope. Consume current active-profile and creation-credit helpers without broadening their audiences.

- [ ] Write co_freeform_sku_has_stable_customer_identity: assert normalize(' SKU-A ')=normalize('sku-a'), same customer shares one key, another customer gets another; nullable catalog identity works and conflicting explicit product ID raises 22023 with no partial rows.
- [ ] Write co_posted_evidence_and_credit_are_immutable and co_command_identity_and_tombstone: assert UPDATE/DELETE denied for posted evidence; the fixture-only command helper returns one receipt for the identical request; changed payload/same UUID fails; abandoned request cannot later execute. Public operation integration follows in Tasks 2 and 5. Add runner guard tests for hosted/ambient libpq targets, marker, PostgreSQL 17 and enum commit order.
- [ ] Run npm test -- tests/co/ci-runner.test.ts --maxWorkers=1 and node scripts/test-co-ci.mjs --through 01. Expected red: missing new runner/schema/constraints, not a connection error counted as a test.
- [ ] Implement constraints, composite foreign keys, audit immutability and guarded harness. Validate pilot_test marker, loopback, approved port, postgres fixture owner and PostgreSQL 17; create fixed pilot_co_test and refuse an existing database. Whitelist environment, load exact baseline fixture stages and owner migration once, then explicit CO stages. No arbitrary database URL/name/SQL path CLI input.
- [ ] Rerun focused checks. Expected CO_FOUNDATION_AND_COMMANDS_PASSED once, all runner denials pass. Review and commit only task files with message “feat: add consignment ledger foundation”.

## Task 2 CO creation and delivery posting

Files: create migration 02 and tests/database/co/orders-deliveries.sql; extend tests/co/transactions.test.ts and shared operation payload types.

Interfaces: implement create_co, edit_co, cancel_co, save_sj_draft, post_sj using the command envelope. Produce stable source batches and independent delivery_progress. Creation captures current store owner server-side; reject client credit fields and freeze customer at creation.

- [ ] Write co_create_snapshots_owner_before_first_delivery: create with Alice, reassign to Bob, deliver later; credit remains Alice. Missing owner remains Unassigned. Write co_delivery_has_stock_but_zero_revenue: post 10 units at 10, assert stock='10' and all sales revenue='0'.
- [ ] Write co_delivery_progress_does_not_close, co_sj_draft_future_date_never_posts, co_delivery_rejects_cross_order_batch_and_overdelivery, and co_creation_never_consumes_promo_stock. Assert ordered 10/delivered 11 fails, foreign source fails, draft has no movements, and all PO/promotion baseline fingerprints stay identical.
- [ ] Run node scripts/test-co-ci.mjs --through 02 before implementation; expect missing operation/behavior failures. Implement source revisions/batches with actor/request/customer locks, integer limits and future-posting checks. Ordinary line edits cannot change agreed prices, creation credit or posted source identity.
- [ ] Rerun the suite with ON_ERROR_STOP=1; require CO_ORDERS_DELIVERIES_PASSED once and unchanged protected baseline data.
- [ ] Review and commit “feat: add consignment orders and deliveries”.

## Task 3 Monthly drafts completeness and FIFO

Files: create migration 03; tests/database/co/monthly-fifo.sql; tests/co/report-contracts.test.ts. Implement private.co_build_plan_v1(p_customer_id uuid,p_operation text,p_payload jsonb) returns jsonb as the shared pure read planner.

Interfaces: consume stable batches/drafts/customer versions; produce exact report heads/revisions, stored report-row chunks, complete eligible-set fingerprints and deterministic candidate allocations. Preview and apply call the same planner; clients never choose trusted price/credit/allocation results.

- [ ] Write co_fifo_orders_by_sj_then_original_creation_then_batch_id: A delivers 60 at Rp10,000 before B delivers 40 at Rp12,000; 70 sold gives A60+B10, revenue='720000.00', B remainder='30'. Reverse UI/JSON ordering and retain the same result; a catalog/owner change must not alter it.
- [ ] Write co_statement_601_skus_posts_every_stored_row: save 500+101 rows, then assert 601 complete rows and all allocations in server totals. Write bulk-zero-unloaded-pages, stale chunk retry, concurrent SKU602 invalidating preview, and paged impacts >500 without truncation.
- [ ] Write missing-month-versus-zero, null/duplicate/foreign SKU, current-month coverage and future-source tests. An October9 coverage cannot consume October10 stock even when read later; extending coverage requires revision.
- [ ] Run node scripts/test-co-ci.mjs --through 03 and the listed client tests and observe red; implement the complete draft/chunk/coverage/FIFO contract. Do not equate loaded rows with complete statement or initialize blanks as zero.
- [ ] Rerun tests, requiring CO_MONTHLY_FIFO_PASSED once, then review and commit “feat: add monthly consignment FIFO settlement”.

## Task 4 Returns corrections closure and real races

Files: create migration 04; tests/database/co/corrections.sql and races.mjs.

Interfaces: implement save_return_draft, post_return, correct_sj, correct_report, correct_return, resolve_undelivered and close_co. Correction payload names original effective revision, expected versions, reason, preview fingerprint, any completed missing-report drafts and exact acknowledged reopen set.

- [ ] Write downstream correction fixture: A10 at10, B8 at20; September12 gives140, October4 gives80. Revise September to8; assert September80, October60, B remainder6; old140/80 revisions remain and report-event count stays2.
- [ ] Write unsold-return fixture: after September12, return B2 in October before October4 sales; assert stock0, October revenue80 and return revenue0. Increasing prior sales enough to break the dated return must roll back every pointer/revision/audit/receipt change.
- [ ] Test reducing A delivery10→6 causes downstream shortage and atomic refusal; backdating first stock into August requires explicit August draft; a closed order revised from fully sold18 to14 previews reopening with4 stock and fails without the exact acknowledgement. Test each closure blocker and explicit undelivered cancellation reason separately.
- [ ] Run node scripts/test-co-ci.mjs --through 04 and observe the new SQL/race failures; implement full-customer replay and atomic generation switch. Lock active identity, request, customer, then entities in consistent order; preserve current users-before-assignment credit locking. Append downstream system-replay revisions tied to the initiating reason. Never truncate history.
- [ ] Run real concurrent sessions with observed lock barriers: one winner for conflicting customer-version posts; identical request commits once; recovery-before-execution tombstones delayed post; profile/owner races do not deadlock or move credit. Require CO_RETURNS_CORRECTIONS_PASSED and CO_REAL_RACES_PASSED, then review/commit “feat: add audited consignment returns and corrections”.

## Task 5 Operational reads and durable client transport

Files: create migration 05; src/lib/co/{rpc,transactions,queryKeys,validation,catalog}.ts; tests/database/co/reads.sql; tests/co/{read-contracts,rpc,transactions,recovery}.test.ts and cache-scope.test.tsx. Modify only needed CO type/RPC unions in src/lib/orderTransactions.ts.

Interfaces: implement the shared operational read RPCs; useCOTransactionSender(scope), validateCOReceipt(result,operation?,payload?), fetchCOPage/Detail/ReportsPage/Report/ReportRows/ReportAllocations/CustomerStock/StockMovements, previewCOOperation and paged impacts. coKeys include actor, role, customer, month and relevant versions.

- [ ] Write receipt tests rejecting wrong operation/customer/target or missing versions before clearing unresolved state. Test lost committed response/reload reuses UUID, changed payload remains blocked, abandoned request cannot execute, and role revocation denies recovery.
- [ ] Write page tests for duplicate/incomplete identities, bigint Quantity and Money text, all-record summaries independent of pagination, effective-generation-only totals, last-report freshness and month-end-only historical stock. Failed reads must be unavailable, not zero.
- [ ] Run npm test -- tests/co/read-contracts.test.ts tests/co/rpc.test.ts tests/co/transactions.test.ts tests/co/recovery.test.ts tests/co/cache-scope.test.tsx --maxWorkers=1 and node scripts/test-co-ci.mjs --through 05; expect red until the new contracts exist.
- [ ] Implement strict decoding and minimal recovery serialization using the existing sender. Missing RPC is upgrade-required, never a direct DML/PO fallback. Persist only request identity/hash/state and minimal validated receipt, never report contents/evidence/preview arrays.
- [ ] Rerun focused checks plus tests/order-transaction-client.test.ts; require CO_OPERATIONAL_READS_PASSED, review and commit “feat: add scoped consignment reads and recovery”.

## Task 6 Explicit Sales metrics backend

Files: create migration 06; src/lib/reads/salesMetrics.ts; tests/database/co/sales-metrics.sql; tests/co/{sales-metrics,sales-metrics-sql-contract}.test.ts. Extend existing reads contracts/rpc/reports without repurposing v1 result fields.

Interfaces: implement pilot_sales_metrics_v2 and pilot_sales_metric_months_v2 above. A private co_sales_metric_facts_v2 helper is not directly executable by clients. Month bounds are first-of-month inclusive/exclusive dates. Public responses aggregate before returning and expose no CO source/report/revision/batch/evidence identifiers.

- [ ] Pin po_order_value to active confirm/in_progress/complete PO amount by order_date and PO creation-credit; linked Girard is lineage only. Test September PO100 createdOctober with linkedGirardAugust999 gives September100 once, October0; draft/cancelled contributes0.
- [ ] Pin po_delivered_revenue to nonvoid SJ quantity × PO agreed price by sj_date, independent of order month. Test September order100, October3×10, November2×10 yields order100 inSeptember and delivered30/20 inOctober/November; voidingOctoberSJ makes October0 without rewriting order value.
- [ ] Pin co_sold_revenue to effective allocations by report month and source credit. Distinct PO order, delivered-PO and sold-CO counts are separate. Summary/customer co_report_event_count counts effective customer/month heads including zero; person co_contributing_report_count is explicitly nonadditive across people. Test one customer report split between two owners counts globally1, each contributor1.
- [ ] Run node scripts/test-co-ci.mjs --through 06 and the listed client contract tests to observe red; implement v2 facts and own/team/leadership scope, explicit Unassigned leadership bucket, decimal-safe sums and authorized earliest-month helper. Test exact half-open boundaries across session timezones and values above JS safe integer.
- [ ] Validate real authenticated-role SQL output through CO_SALES_METRICS_CONTRACT into the TS decoder test, require CO_SALES_METRICS_PASSED, review and commit “feat: separate PO order and delivery values from CO sales”.

## Task 7 Admin boundaries provisioning code and retained HR

Files: create migration 07; src/lib/procurementAccess.ts; tests/database/co/{access,hr-preservation}.sql; tests/co/{access-source,procurement-access}.test.ts and {access-routes,master-data-access,hr-access}.test.tsx. Modify App.tsx, navigationModules.ts, ProtectedRoute.tsx, AthelNav.tsx, IHRNav.tsx, Login.tsx, CustomerList.tsx, ProductList.tsx, UserManagement.tsx, invite-user/index.ts and relevant current route/invite tests.

Interfaces: centralized roleHome; fetchProcurementAccess(signal?) and identity-scoped useProcurementAccess return explicit actual capability booleans from pilot_procurement_access_v1. Unknown or failed capability reads disable mutation controls and handlers.

- [ ] Write route tests: CO Admin exactly CO/Customer/Item; PO Admin exactly PO/Customer/Item; both HR, executive existing+CO. Direct Dashboard/Promotions/other-order/hidden /athel/sales-orders is denied before data queries. Customer delete remains unavailable under the verified baseline; no new grant is introduced.
- [ ] Write authenticated/anonymous/inactive direct table/RPC/storage/recovery tests. CO master reads use table-specific policies; do not add co_admin to broad customer/assignment/user/target helper allowlists. CO master writes are denied both server-side and by guarded UI handlers.
- [ ] Restrict standalone promotion reads/writes/uploads/image minting/recovery for the two admins while preserving current Sales audiences and executive administration. Restrict legacy approve_sales/reject_sales and recovery to executive. Preserve PO create/edit/save_delivery/void_delivery/cancel/edit_sj_returned_date and internal promotion stock accounting; actual PO forms do not require promotion image/read exceptions at this baseline.
- [ ] Add co_admin only to executive-controlled role selector/invite allowlist; not Sales owner/manager lists. Test no HR membership can operate CO and sees HR setup required; explicitly configured CO employee uses ordinary manager approval; no inherited PO Admin→Director exception; existing PO Admin leave approval/cancellation/refund-once and privacy checks pass. No real users/grants/balances/approvers are created.
- [ ] Run the listed route/master/invite/HR tests and node scripts/test-co-ci.mjs --through 07, red before implementation and green after; require CO_ACCESS_BOUNDARIES_PASSED. Update only route expectations intentionally narrowed by the approval. Review and commit “feat: enforce separate Procurement admin access”.

Access entrypoint checklist: pilot_athel_summary_v1/daily_v1; pilot_promotions_v1/promotion_image_v1/promotion_transaction_v1/reconcile_promotion_v1; private.demo_can_upload_promotion; sales_order_page_v1; customer_stats_v1; revenue_v1; customer_performance_v1; sales_performance_v1; sales_report_months_v1; team_activity_v1; manager_customers_v1; store_po_context_v1; pilot_order_transaction/reconcile_request. Preserve only calls truly needed by allowed modules; a shared helper or unused hidden route must not restore wider access.

## Task 8 Orders and delivery UI

Files: create src/pages/athel/co/{COLayout,COOrders,COForm,CODetail}.tsx and src/components/co/{COLineItems,CODeliveryDialog,COStatusActions}.tsx; tests/co/{order-entry,order-detail,delivery-entry,unsaved-recovery}.test.tsx.

Interfaces: routes /athel/co, /new, /:id, /:id/edit with route-backed tabs; COForm({mode:create|edit}); COLineDraft {key,product_id|null,product_name,sku,quantity,agreed_price}; server allowed_operations and close_blockers drive actions. Reuse POCustomerLookup/POProductLookup and pricing helpers, not promotion-specific POLineRow copy.

- [ ] Write entry tests for keyboard/IME/repeated Enter, ambiguous/duplicate SKU focus, manual stable SKU, complete lookup pagination, missing versus deliberate zero price, and retaining manually agreed prices before creation.
- [ ] Write detail tests for independent lifecycle/delivery progress, full-delivery-but-open state, immutable customer/credit, and distinct AddSJ/MonthlySales/ReturnGoods actions. SJ Kembali must never reduce goods stock.
- [ ] Run red focused tests; implement familiar desktop table/mobile cards, customer/product fields, planned value distinct from revenue, detail stock summaries and delivery/audit sections.
- [ ] Test Back/Forward/tabs/Cancel/dismiss/signout/reload and recovered save. Future SJ draft has no stock; posting is rejected. Successful/recovered save bypasses unsaved protection once. Rerun PO entry and promo warning regressions.
- [ ] Review keyboard/mobile behavior and commit “feat: add consignment order and delivery screens”.

## Task 9 Monthly report and correction UI

Files: create src/pages/athel/co/{COMonthlyReports,COMonthlyReport}.tsx; src/components/co/{COMonthlySalesGrid,COAllocationDetails,COChangePreview,COCorrectionDialog}.tsx; tests/co/{monthly-report,report-preview,correction-review}.test.tsx.

Interfaces: /athel/co/reports and /reports/:customerId/:month. Paginated SKU rows show available Quantity, editable sold number|null, remaining Quantity and Money; expandable server allocations retain CO/SJ/date/price/PIC. Preview header plus paged impacts uses one pinned fingerprint and complete counts.

- [ ] Test one row per SKU across COs; 60×10000 +10×12000 gives720000 and30remaining. Test blank blocksPost, zero is explicit, SaveDraft changes no ledger, and confirmed bulk-zero fills unloaded pages without overwriting entered values.
- [ ] Test editing after review invalidates fingerprint; repeated Post dispatches once; stale preview keeps draft; role/customer/month changes cannot restore old results. A601-row statement posts every stored row and SKU602 invalidates review.
- [ ] Run red tests; implement customer/month/reference/received-date header, quantities grid, allocation expansion, SaveDraft/Review/Post, missing-month handling and current-month coverage label.
- [ ] Implement reasoned correction review with original revision, downstream revenue/credit/stock changes, exact reopen acknowledgement and paged blockers. Test no partial apply and retained audit history.
- [ ] Rerun focused and navigation/unsaved tests, review and commit “feat: add monthly CO sales and correction review”.

## Task 10 Customer stock returns and settlement UI

Files: create src/pages/athel/co/COCustomerStock.tsx, src/components/co/{COStockHistory,COReturnDialog}.tsx; tests/co/{customer-stock,return-goods}.test.tsx.

Interfaces: /athel/co/stock; customer/SKU filters; Current or calendar month-end only. Rows show selected-month opening+delivered−sold−returned=remaining (Current uses the current calendar month and recorded movements through now), latest reported month, coverage date, next required month and freshness. Returns reference selected original batch and expected version.

- [ ] Test old missing month remains overdue despite a new delivery; failed data never appears as zero; partial-month coverage is visible and arbitrary daily stock dates are unavailable.
- [ ] Test return B5 from remainingB30 gives25 and no revenue change; sold stock, over-return and future return fail; draft has no ledger effect and refresh cannot silently reuse stale batch selection.
- [ ] Run red tests; implement stock list, movement drill-down and return draft/preview/post using shared impact review/recovery components.
- [ ] Test closure blockers for on-hand stock, final report and undelivered remainder; resolve_undelivered records cancellation quantity/reason, not fictional delivery. Verify read-only historical movements and controlled reopen display.
- [ ] Rerun focused checks, review and commit “feat: add customer consignment stock and returns”.

## Task 11 Optional private report evidence

Files: create migration 08; src/lib/co/evidence.ts; src/components/co/COEvidenceAttachment.tsx; supabase/functions/co-evidence-download/index.ts; tests/co/{evidence,evidence-download}.test.ts and evidence-ui.test.tsx; tests/database/co/evidence.sql.

Interfaces: register evidence against canonical report/draft with expected version; finish upload by verified evidence ID; download by canonical evidence ID. Initial allowlist PDF/PNG/JPEG, maximum10MiB, optional on every draft/post. No OCR/import or public bucket.

- [ ] Test missing attachment works; oversize, SVG/HTML, unsupported type and file-signature mismatch fail; cross-report/customer IDs fail. Treat accepted documents as untrusted downloads, never executable or embedded active content.
- [ ] Test Sales roles, PO Admin, anonymous and inactive users cannot mint/download CO evidence; failed authorization never reaches privileged storage signing. A role downgrade clears retained UI links and prevents fresh download access.
- [ ] Run the listed tests and node scripts/test-co-ci.mjs --through 08 to observe red; implement private metadata/storage path binding, safe filenames, short-lived access and Content-Disposition attachment. Posted evidence cannot be overwritten; revisions retain originals. Do not accept arbitrary object paths from clients.
- [ ] Test lost upload/link responses reconcile before repeating; no duplicate attachments or exposed storage paths in Sales results. Require server-confirmed type/size metadata before an attachment becomes usable.
- [ ] Rerun evidence SQL/client tests, review and commit “feat: add private CO report evidence”.

## Task 12 Sales summary presentation

Files: create src/pages/girard/MySalesSummary.tsx, src/components/sales/SalesMetricSummary.tsx; tests/co/{sales-metrics-ui,sales-summary-access}.test.tsx. Modify App.tsx, GirardNav.tsx, GirardPerformance.tsx, CustomerPerformance.tsx, GirardRevenue.tsx and their reads adapters.

Interfaces: /girard/my-sales with “Penjualan Saya” for salesperson navigation, own-only server scope. Existing manager/leadership dashboard sections consume v2; legacy MyOrders remains history. GirardRevenue currently has no route, so update compatibility usage without adding an unrequested route.

- [ ] Write labelled metric tests showing POOrderValue1000000, PODeliveredRevenue300000 for100ordered/30sent at10000, alongside independent COSoldRevenue720000 from the FIFO example. Order value must never be added to revenue.
- [ ] Test whole-month filters, authorized earliest CO month without visits/POs, full totals beyond visible pagination, nonadditive person report counts, Unassigned leadership bucket and no CO raw-detail/evidence links.
- [ ] Run red tests; implement po/co/all filters and distinct count labels. Preserve PO-only daily delivery charts and label them; combined monthly totals never receive invented sale dates.
- [ ] Test forged manager/filter inputs do not widen own/team scope; neither admin can call general Sales metrics. Error states remain unavailable, not zero, and a correction changes values once without increasing order/report counts.
- [ ] Rerun report regressions with explicit new definitions, review and commit “feat: show distinct PO and consignment Sales metrics”.

## Task 13 Integrated verification and safe rollout packet

Files: create tests/database/co/rollout.sql, tests/co/migration-guards.test.ts, scripts/co-preflight.sql, scripts/build-co-rollout.mjs and docs/co-rollout.md; add final CO composition to .github/workflows/pilot-safety.yml without weakening existing checks.

- [ ] Write guard failures for wrong commit/source hash/project/receipt mapping, changed ACL/RLS/function metadata, invalid enum stage, duplicate apply, unexpected protected business data changes and hosted/ambient fixture targets. Review source/drift refusals before the apply packet exists.
- [ ] Build the packet from exact candidate files and read-only target snapshot. Pin commit/tree/blob hashes, migration history, owner mapping20261009065443→20261009061801source, function signatures/source/owner/volatility/search_path/security mode, ACL/RLS topology and immutable triggers. Expected fingerprints never refresh automatically after refusal.
- [ ] Run all planned gates: npm test -- tests/co --maxWorkers=1; npm test -- --maxWorkers=1; npm run typecheck; npm run build; node scripts/test-co-ci.mjs in its fresh PostgreSQL17 disposable service. Historical suites run at original checkpoints, new real-role suites after final CO migrations. Preserve existing baseline suites rather than rewriting their old permissions to fit new ones.
- [ ] Require exact-once markers CO_FOUNDATION_AND_COMMANDS_PASSED, CO_ORDERS_DELIVERIES_PASSED, CO_MONTHLY_FIFO_PASSED, CO_RETURNS_CORRECTIONS_PASSED, CO_REAL_RACES_PASSED, CO_OPERATIONAL_READS_PASSED, CO_SALES_METRICS_PASSED, CO_ACCESS_BOUNDARIES_PASSED and CO_FINAL_COMPOSED_DATABASE_PASSED. Pipe actual SQL metrics output into client-decoder tests. Exercise long histories and >500SKU statements with full computation or explicit failure, never truncation. Check all pages and mutation paths on desktop/mobile with interrupted and repeated flows.
- [ ] Review final branch, migration packet and access matrix independently; commit “test: verify CO rollout and operational safeguards”. Once publication is authorized, verify remote exact commit and its complete CI. Do not publish or apply merely because local tests pass.

## Hosted rollout and stopping conditions

Before any hosted action, recheck target/branch drift and review the exact access expansion/restriction with Patrick. New tables start empty. Actual CO-role assignment, HR memberships/balances/approvers, opening balances, and test-data deletion are separate actions; no migration invents them.

Apply database-first only after its specific approval, with committed enum stage followed by atomic forward-only migration stages, bounded lock/statement timeouts and postflight checks. An inert enum value may remain after a later-stage failure; it grants no access by itself. Deploy the matching frontend after the separately approved publication/deployment step. Old clients fail closed; there is no direct-write fallback. Verify schema cache refresh, exact deployed commit, role-specific smoke checks, preserved PO/promotion/HR contents and final access boundaries.

An uncertain apply result is resolved by its immutable receipt and read-only postconditions, never blind replay. Do not reapply the already-hosted owner migration or run a generic db-push. After business posting, rollback is a reviewed forward repair; never delete immutable history or restore obsolete broad access to work around a UI issue.

Current stopping point: plan review and selection/approval of execution approach. No CO implementation or tests have run. The next approved build can stop with a tested, reviewed isolated candidate and a precise release packet; hosted changes remain blocked until explicitly authorized.

## Source references

- Staging reference: https://github.com/pl0203/lou_erp/tree/fix/pilot-database
- Exact routes and role entrypoints: https://github.com/pl0203/lou_erp/blob/75d38e55aa886386441597e8c22bb2fd90013565/src/App.tsx
- Existing transaction recovery: https://github.com/pl0203/lou_erp/blob/75d38e55aa886386441597e8c22bb2fd90013565/src/lib/orderTransactions.ts
- Existing owner capture and reporting source: https://github.com/pl0203/lou_erp/blob/75d38e55aa886386441597e8c22bb2fd90013565/supabase/migrations/20261009061801_unify_store_owner_credit.sql
- Current Sales report semantics: https://github.com/pl0203/lou_erp/blob/75d38e55aa886386441597e8c22bb2fd90013565/supabase/migrations/202610081103_demo_sales_reporting.sql
- Existing guarded disposable composition: https://github.com/pl0203/lou_erp/blob/75d38e55aa886386441597e8c22bb2fd90013565/scripts/test-demo-revisions-ci.mjs
- Existing owner composition and one-time cutover: https://github.com/pl0203/lou_erp/blob/75d38e55aa886386441597e8c22bb2fd90013565/scripts/test-store-owner-ci.mjs
- Current CI gates: https://github.com/pl0203/lou_erp/blob/75d38e55aa886386441597e8c22bb2fd90013565/.github/workflows/pilot-safety.yml
