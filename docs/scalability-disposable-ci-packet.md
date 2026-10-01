# Scalability validation packet

## Current execution boundary

The generator and SQL measurement harness target a fresh, disposable local CI PostgreSQL database only. This packet does not approve or perform hosted staging or production writes. A hosted packet must identify its project, existing synthetic records, exact load/cleanup scope, expected storage, approved identities and credentials handoff before execution. Do not remove the local-only guards to reuse these scripts on a hosted database.

The SQL candidate branch has Vercel deployment disabled. Read migrations remain additive; application write RPCs, privileges and policies are unchanged. No new index is proposed without measured plans and an existing-index comparison.

## Deterministic workloads

Run each workload in a separate fresh `pilot_test` service initialized with `tests/database/fixture.sql` and the reviewed migrations. The actual fixture marker must exist, and every business/identity/request/object table must be empty before loading. The loader refuses an existing scale manifest. It never deletes or truncates records.

| Base workload | Monthly rate/history | PO lines | SJ headers | SJ lines | PO value | Active delivered | Outstanding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6,000 POs | 500/month, Oct 2025–Sep 2026 | 60,000 | 12,000 | 120,000 | 6,000,000 | 3,000,000 | 3,000,000 |
| 30,000 POs | 500/month, Oct 2021–Sep 2026 | 300,000 | 60,000 | 600,000 | 30,000,000 | 15,000,000 | 15,000,000 |

Each PO has ten lines, quantity ten and price ten. Two deliveries fulfill two then three units per line. The half-delivered baseline exercises outstanding quantities and values. Linked sales orders/items, two audit events and one retained request result per PO are included in the manifest. There are 101 synthetic customers, ten products, two salespeople and two managers, plus executive/admin/head/inactive profiles. Alternating POs balance team ownership exactly; all customer mappings follow that ownership.

Seven separately counted edge POs cover undelivered, partial, complete, cancelled, voided delivery, zero price and an old PO delivered in the current month. Together they add seven PO lines, five SJ headers/lines, PO value 600, active delivery value 180 and outstanding value 420. All edges belong to team A. Counts for linked sales, audit and request rows are explicit in the generated JSON manifest.

Scheduled visits and target histories are bounded dimensions. No photos, Storage files or camera-proof claims are created. These workloads test PO/report history growth, not large visit-photo capacity. Heap-byte estimates are rough and exclude indexes/WAL/provider overhead; actual database bytes must be recorded after isolated loading before proposing a hosted load.

## Safe local preparation

`node tests/scalability/generate-fixtures.mjs --rows 6000` prints a manifest only. It never opens a connection or writes data. `--rows 30000` selects the larger declared workload; other sizes are rejected.

All CI database commands use `scripts/run-disposable-psql.mjs`, which validates the declared loopback/database/permit before spawning psql and supplies the same allowlisted environment for bootstrap, migrations, fixture loading and checks. Connection override variables never reach those commands. The SQL packet checks the actual marker after fresh bootstrap.

Only explicit `--emit-sql --target local-ci --permit disposable-pilot-ci` emits an unexecuted SQL packet. Review that packet before applying it to the approved disposable service. It checks `current_database()`, the actual fixture marker and empty tables before any writes; bulk setup alone uses transaction-local replica mode, restores it and analyzes the fixture before committing. Real transaction/security suites remain mandatory separately. Failed setup rolls back; reruns require a fresh disposable database rather than deleting records.

Run `tests/database/scalability-ground-truth.sql` with `ON_ERROR_STOP=1` after setup. It verifies exact counts and independent sums, then role-scoped page/summary totals with effective RLS. Every statement retains a 60-second limit. Its reported durations are individual CI SQL calls, not API p95. A timeout is a failed/incomplete result requiring diagnosis, not permission to raise limits and claim success.

## Measurement and decision gates

The measurement harness defaults to a dry-run manifest. Execution requires loopback host, database `pilot_test`, explicit permit, declared size and an actual fixture marker. It strips connection override environment variables, establishes an authenticated synthetic identity in each read transaction, and verifies effective RLS. It must not print credentials.

After plan/correctness checks avoid runaway baseline scans, use at least ten warmups and one hundred measured samples per selected case/role. Record PostgreSQL/version/resources, exact commit, parameters, sample count, SQL execution timing, process-wall timing, representative JSON payload bytes, plans and errors. Failed/incomplete samples do not produce a passing percentile claim.

Direct database timing is distinct from API transport and browser rendering. Hosted API/browser p50/p95, cold runs, 5/10-user concurrency, device/network profile and provider-tier acceptance remain unrun unless separately executed and recorded. The proposed one-second list/search and two-second report API targets are not validated by SQL-only timings. Staging and production release need the approved target packet, actual role/JWT/PostgREST evidence, restore readiness and separate rollout approval.

## Reviewed PR3 validation entry point

The separate `Disposable scalability SQL validation` workflow is restricted to same-repository PR3, head branch `fix/pilot-scale-sql`, base `fix/pilot-database`, and changes to the named fixture/guard/read-migration files. Its workload is fixed to 6,000 POs in the reviewed source. Parent publication of that reviewed candidate is the execution gate. It does not load arbitrary sizes, run on unrelated PRs, deploy an app, or access a hosted database.

Each run provisions its own official PostgreSQL 17 service, records the exact merge commit and has a 20-minute job bound. No repository production credentials are referenced. Synthetic manifest, emitted SQL and ground-truth/query diagnostics are retained for 7 days, including failures. Measurement repetitions are not enabled by this first validation workflow. A separately reviewed fixed 30,000-PO candidate and later measurement selection follow only after useful, correct 6,000-PO evidence. No default-branch merge is needed to run these checks.

## First 6,000-PO result and diagnostic follow-up

Run [36844384850](https://github.com/pl0203/lou_erp/actions/runs/36844384850) at source `d139abb97930604e04845c73c1cef4a246240699` loaded the fixture and recorded 53,010,959 database bytes. Validation is **incomplete/failed**, despite the original green Actions badge: an implicit shell without `pipefail` let `tee` hide a SQL timeout. The corrected workflow requires both successful pipeline status and the final completion marker. Artifact upload remains enabled after failure.

The completed full-history summary calls took 48.336/48.346 seconds for the two managers, 46.399/46.431 seconds for the two salespeople, and 7.174 seconds for executive. Each number is one summary RPC plus its immediate assertions, in this synthetic CI database. Parameters were `2021-01-01,2026-09-30,2025-10-01,all,all`, so the test intentionally included all 6,000 base POs and seven edge cases, narrowed by each actor's RLS. These are not ordinary recent-window dashboard timings or percentiles.

The PO-admin statement timed out at its 60-second whole-actor budget: its count phase used 0.384 seconds, followed by about 59.615 seconds in summary before cancellation. PO-admin summary, sales-head and inactive checks did not complete. The sixth invocation's position may matter to cached query planning; this is a hypothesis, not an established role-specific cause.

The next fixed diagnostic packets run in four separate guarded psql sessions: recent-window manager/admin (July–September 2026, rolling October 2025), and full-history admin with default versus transaction-local `force_custom_plan`. The recent window narrows selected KPI dates, but the preserved rolling-year base still scans the 6,000 base POs. Each packet is read-only, asserts actual RLS, retains the 60-second statement limit, and records `EXPLAIN ANALYZE` timing/buffers for the actual RPC. Function internals may remain opaque in that plan. These are one-shot diagnostics; a fresh default call alone cannot prove or disprove later cached-plan behavior. All four are attempted, any error or missing marker fails the diagnostic step, and mandatory ground truth still runs if fixture loading succeeded. No product planner setting, index, policy or timeout is changed.

## Nested-plan diagnostic candidate (not a validation pass)

Follow-up run [36845963887](https://github.com/pl0203/lou_erp/actions/runs/36845963887) correctly failed required ground truth. Fresh admin full-history auto/custom completed in6.258/6.249 seconds; recent admin6.261 seconds; recent manager41.563 seconds. The sixth same-session admin call again timed out. This supports investigating cached-plan reuse and role-filter overhead; it does not establish the precise expensive internal node yet.

The next source candidate is explicitly named **Disposable scalability SQL diagnostics**. It retains the required ground-truth step but temporarily skips it through the checked-in `SCALE_DIAGNOSTIC_ONLY` flag, avoiding a repeat of the known five-minute failure while gathering new evidence. A diagnostic run cannot close the outstanding6k correctness or latency gate. Remove that flag and restore the validation name before any remedy is accepted; the unchanged role assertions and completion marker are still required then.

Three fresh sessions capture recent-manager default, full-history admin default, and full-history admin `force_generic_plan`. Generic mode is an intentional diagnostic stress mode, not a proposed product setting or a claim that every production query uses that plan. After disposable-marker checks, each session loads the official bundled `auto_explain` module, enables nested slow-statement logging at1second to NOTICE, and disables nested analyze/timing instrumentation. The real RPC still runs under authenticated RLS with its60second ceiling. Costed nested plans plus the outer actual timing can locate likely expensive access paths without instrumenting millions of short helper calls. No persistent configuration, privilege, index or hosted database is changed. See [PostgreSQL17 auto_explain](https://www.postgresql.org/docs/17/auto-explain.html).

## First measured index experiment

Nested-plan run [36847247372](https://github.com/pl0203/lou_erp/actions/runs/36847247372) captured the manager's repeated authorization predicates over PO headers, lines and shipment headers. The existing linked-order point lookup scanned6,007 rows to return one. Fresh forced-generic admin also timed out independently, so generic planning is a separate reproduced risk.

Migration `202610010004` proposes only a nonunique btree on `girard_orders(po_id)`. It verifies the expected UUID column, recognizes an existing valid nonpartial leading-key btree even under another name, and refuses a conflicting unusable object name. It does not change RLS, helper functions, actor visibility, uniqueness or report cohorts. The expected benefit is cheaper repeated PO-to-sales-order authorization lookups; improvement is not claimed until the same role queries/plans are measured again.

The candidate restores the full ground-truth step and validation workflow name. The same diagnostic cases remain, including forced generic mode; all required role assertions and the final completion marker must complete. Catalog tests verify a usable access path, no new uniqueness rule, repeat application, and recognition of a differently named equivalent index, within a rolled-back disposable transaction.

The index consumes disk and adds maintenance work to sales-order inserts/po_id changes. Record its measured size in CI before a hosted proposal. Ordinary index creation blocks writes while it builds; a future populated deployment requires a separately approved maintenance window or concurrent-build procedure. Rollback would remove only this new access path and restore prior performance, without changing business data; never drop a preexisting equivalent index that caused this migration to skip creation. No hosted index operation is authorized by these CI results.

## Index-trial result and scoped plan comparison

Run [36848182280](https://github.com/pl0203/lou_erp/actions/runs/36848182280) used the new index (319,488bytes). The one-shot recent-manager diagnostic decreased from48.843seconds to26.979seconds across CI runs, while full-role assertions still failed at the sixth admin call and forced-generic admin still timed out. Keep the index as a measured partial improvement; these results do not meet the latency/role-completeness gate. Normal safety CI separately verified index reapplication/equivalent-name handling,454 app tests and12 concurrency cases.

The next diagnostic-only packet derives the exact summary SELECT from the checked-in candidate function, removes only PL/pgSQL's INTO target and converts the five named parameters to PREPARE bindings. Fresh admin sessions compare cost-only custom/generic EXPLAIN EXECUTE plans, with the function's empty search_path. They do not execute the slow generic SELECT or claim that a standalone prepared plan proves PL/pgSQL's precise cache choice.

A separate authenticated-manager packet profiles four real query components with EXPLAIN ANALYZE: required rolling-year parent cohort, matching PO lines, active shipment headers, and matching delivery lines. It preserves child RLS and the required parent/date scope. Component times include repeated parent scans and are not additive; the delivery probe omits the summary's additional PO-line join, so it isolates access cost rather than proving metric equivalence. Each statement keeps its60second limit. Cost-only source generation has no network access. The workflow is explicitly diagnostic-only again; full required ground truth remains an unresolved acceptance gate and must be restored for a remedy. No additional index or policy change is included in this packet.

## Scoped child-read and summary-plan trial

Run [36849498117](https://github.com/pl0203/lou_erp/actions/runs/36849498117) exposed the generic inner plan: one estimated parent and three estimated lines caused repeated whole-child scans. The actual manager PO-line component took23.937seconds, visited60,007 rows, rejected30,000 through RLS and recorded540,875 shared buffer hits. These observations support the next bounded experiment.

Migration005 adds nonunique leading-key btrees for PO lines by purchase_order_id and delivery lines by surat_jalan_id, with the same compatible-index/schema checks as004. Migration006 replaces only the summary function: its SQL text is fixed, five typed arguments are bound with USING, and only that query is replanned through PL/pgSQL EXECUTE. Redundant authorized-parent membership predicates supplement the existing joins; every child RLS check, date/history cohort, money expression, guard, volatility and invoker setting remains. Existing ACLs survive CREATE OR REPLACE. No caller text is interpolated and no global plan setting is changed.

The parity suite uses an untouched copy of migration002's summary as its independent oracle on30 synthetic POs: seven active actors, full/recent windows, all six status-filter values and all four fulfillment modes, zero-priced mixed items, voids, old/future orders and an authorized parent with a hidden customer. Both functions run under actual RLS; the candidate also rejects injection-shaped invalid filter input and inactive identity. Unit source comparison permits exactly the two redundant membership predicates plus fixed typed binding. Existing independent cap/boundary/role suites remain mandatory.

The validation workflow restores full-role ground truth and runs both the actual summary RPC diagnostics (including forced generic mode) and current-candidate cost/component plans. Index catalog tests cover both new child access paths and repeated/equivalent-name application. A runtime/latency result is pending; this source trial is not scale acceptance. The same index disk/write-cost and separately approved hosted-build/rollback constraints apply as for004.

## Rejected combined trial and controlled comparison

Run [36850881022](https://github.com/pl0203/lou_erp/actions/runs/36850881022) passed small role/metric parity but regressed the6k workload: fresh default/generic admin timed out, manager recent summary took56.559seconds, and required all-role validation timed out on executive. Migration005/006 is **not accepted for deployment**. The ANY predicates reduced estimated custom-plan child cardinalities enough to choose expensive nested loops; delivery RLS changed from hashed visibility to repeated parent lookups. The fallback for hosted users remains the unchanged deployed client/database. For SQL experiment comparison, source9eb8b823 with004 alone is the last correctness-safe baseline; it still failed latency and generic-plan acceptance.

The next diagnostic uses seven fixed packets on the fresh synthetic6k database: A untouched002 static summary with004 only; B untouched002 static summary with005 child indexes; C the same untouched query with fixed typed EXECUTE and005 indexes. Each variant has an admin/full-history and manager/recent-window call, plus one C forced-generic admin discriminator. No ANY filters are present. Each call retains60seconds; observations that time out are failures, not measurements.

A verifies both candidate index names, tables, UUID keys, nonunique/valid/ready btree shapes and actual fixture markers before dropping those two indexes inside its transaction. Every packet uses only session-temporary invoker functions and ends with ROLLBACK. Index restoration is checked after rollback before the success marker. A failed psql session closes its uncommitted transaction; the next packet rechecks both indexes before proceeding. No business rows, persistent function definitions, roles or policies are changed. This diagnostic deliberately uses a write-capable transaction for temporary function/index DDL and is limited to the approved disposable database; it must never be applied to hosted staging or production. The validation hold is explicit until a reviewed remedy is selected.

## Completed A/B result and remaining D combination

Run [36852926750](https://github.com/pl0203/lou_erp/actions/runs/36852926750) completed all seven diagnostic and post-rollback restoration markers. Same-run one-shot admin/manager timings were A3.582/9.547seconds, B5.076/10.252seconds, C5.086/10.136seconds; C forced-generic admin completed in5.088seconds. This supports rejecting the ANY filters and testing the fixed statement independently; these full-summary pairs did not establish a benefit from the child indexes. Full-role scale acceptance remains open.

The next packet runs only the missing D combination: typed EXECUTE with the untouched query and004 lookup index alone, for admin, manager and forced-generic admin. It uses the identical guarded rollback/removal/restoration mechanism. Each measured invocation also checks independent role/cohort KPI constants: admin6,007POs/value6,000,600/delivered3,000,180/outstanding3,000,420; manager recent756POs/value750,500/delivered375,130/outstanding375,370. Full DTO parity remains covered by the small baseline suite; these constants specifically guard the measured6k cohort. No additional product migration or policy change is included.
