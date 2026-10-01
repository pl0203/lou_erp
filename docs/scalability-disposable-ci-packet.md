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

The next diagnostic uses seven fixed packets on the fresh synthetic6k database: A untouched 002 static summary with004 only; B untouched 002 static summary with005 child indexes; C the same untouched query with fixed typed EXECUTE and005 indexes. Each variant has an admin/full-history and manager/recent-window call, plus one C forced-generic admin discriminator. No ANY filters are present. Each call retains60seconds; observations that time out are failures, not measurements.

A verifies both candidate index names, tables, UUID keys, nonunique/valid/ready btree shapes and actual fixture markers before dropping those two indexes inside its transaction. Every packet uses only session-temporary invoker functions and ends with ROLLBACK. Index restoration is checked after rollback before the success marker. A failed psql session closes its uncommitted transaction; the next packet rechecks both indexes before proceeding. No business rows, persistent function definitions, roles or policies are changed. This diagnostic deliberately uses a write-capable transaction for temporary function/index DDL and is limited to the approved disposable database; it must never be applied to hosted staging or production. The validation hold is explicit until a reviewed remedy is selected.

## Completed A/B result and remaining D combination

Run [36852926750](https://github.com/pl0203/lou_erp/actions/runs/36852926750) completed all seven diagnostic and post-rollback restoration markers. Same-run one-shot admin/manager timings were A3.582/9.547seconds, B5.076/10.252seconds, C5.086/10.136seconds; C forced-generic admin completed in5.088seconds. This supports rejecting the ANY filters and testing the fixed statement independently; these full-summary pairs did not establish a benefit from the child indexes. Full-role scale acceptance remains open.

The next packet runs only the missing D combination: typed EXECUTE with the untouched query and004 lookup index alone, for admin, manager and forced-generic admin. It uses the identical guarded rollback/removal/restoration mechanism. Each measured invocation also checks independent role/cohort KPI constants: admin6,007POs/value6,000,600/delivered3,000,180/outstanding3,000,420; manager recent756POs/value750,500/delivered375,130/outstanding375,370. Full DTO parity remains covered by the small baseline suite; these constants specifically guard the measured6k cohort. No additional product migration or policy change is included.

## Additional final acceptance gate: connection reuse

The current measurement harness opens a fresh psql process for each sample. Its warmups can warm shared database buffers, but do not reproduce pooled-session plan reuse. Final acceptance must also run relevant RPCs repeatedly beyond the generic-plan threshold in one authenticated connection, including actor and filter changes, and assert unchanged authorization and totals. Keep that repeated-session evidence separate from fresh-session percentiles. The summary's forced-generic D result does not establish cache behavior for every other static read RPC. This harness extension follows the isolated policy-equivalence trial; it is not covered by the current timings.

## Isolated parent-set policy equivalence experiment

The D-only run [36854123673](https://github.com/pl0203/lou_erp/actions/runs/36854123673) verified all three independent KPI and rollback/restoration markers. Its default/forced-generic admin calls took8.268/8.225seconds and manager27.012seconds. These varied materially from the preceding runner's absolute times; use controlled same-run comparisons, not unsupported cross-run latency conclusions. Normal safety CI separately passed461 tests, summary parity and12 races.

The next experiment changes no product migration. It reconstructs the reviewed five-table permissive role topology as sanitized synthetic setup, preserving the restrictive active-profile gate, helpers, parent policy, grants and write policies. This fidelity adjustment matters: the minimal fixture's permissive true predicates are not the hosted policy topology, and prior timings cannot establish hosted latency. Two minimal-fixture FK delete actions are transactionally aligned with the reviewed contract before baseline observations.

First, an empty disposable schema receives eight synthetic profiles and a14-PO cohort inside a transaction. The role/state matrix must compare620 exact observations per old/new variant: literal sorted row IDs, anonymous/inactive/missing denial, current and legacy links, mixed-team history, hidden/reassigned customers, one generic prepared query through identity/authority changes, denied raw writes and normal create/replay/audit outcomes. The deliberately altered drift probe must be rejected. This packet rolls back to verified empty state with matching function, policy, table/column ACL and constraint metadata before the unchanged6k fixture is loaded.

Only after that step passes does a separate6k packet compare baseline and candidate admin/manager summary calls. The candidate replaces four restrictive SELECT predicates with membership in the RLS-visible parent/header sets. It preserves all other policy commands/roles/USING/WITH CHECK clauses; no scalar active-profile initPlan optimization is mixed in. Exact role/FK/policy/helper preconditions and symmetric metadata checks precede changes. Calls retain the D query,004-only index setup and independent KPI assertions. Every policy/index change rolls back; metadata and index restoration precede the final marker. No hosted execution is permitted by this packet.

This experiment is not a release candidate. Large-dataset full-role ground truth, final equivalent hosted topology, pooled-session behavior and fresh measurements remain acceptance gates after a remedy is selected. The ten-line/two-shipment stress fixture is deliberately heavier than a typical source-shaped order and remains unchanged; a later representative-workload comparison must be labeled separately rather than weakening this test.

## First actual policy-equivalence result

Run [36857402617](https://github.com/pl0203/lou_erp/actions/runs/36857402617) passed the complete small620-observation matrix for both variants, the deliberate drift rejection, metadata restoration and rollback-to-empty checks. The unchanged6k fixture then loaded. Under the reconstructed hosted-equivalent topology, the baseline admin summary timed out at60seconds before candidate timing; no candidate latency conclusion follows from that failure.

The diagnostic now emits four independent rollback packets (baseline/candidate × admin/manager), each with the same60second ceiling. The existing runner attempts every packet and still marks any timeout or missing restoration marker as failure. Each packet prints a cost-only plan for the exact parameterized inner query before the timed RPC, so a timeout cannot hide the estimated join shape. This separation gathers missing candidate evidence without converting an incomplete baseline into success. The small parity gate remains mandatory before loading6k.

## Isolated scalar active-profile experiment

Run [36858223722](https://github.com/pl0203/lou_erp/actions/runs/36858223722) again passed small parity and restoration. On the same hosted-equivalent6k fixture, both old-policy baseline roles timed out 60 seconds; the parent-set candidate completed admin2.769seconds and manager4.761seconds with exact KPI and restoration markers. The estimated plans now use hashed visible-parent/header sets, but still evaluate the row-independent active-profile function on large child scans. The overall comparison remains failed because the old baseline timed out; candidate acceptance is still pending.

The next isolated trial keeps parent-set policies in both arms. It changes only the five pilot_active_profile USING/WITH CHECK predicates to scalar SELECT calls of the unchanged STABLE role helper. Permissive policies, row-dependent helpers, role semantics and all other expressions stay protected by exact metadata assertions. The same620-observation read/write/prepared-identity matrix runs before the6k load, including a new rejected drift probe and rollback-to-empty checks.

Each large packet additionally records an actual RLS count plan for delivery lines, separately from the report timing, so InitPlan execution counts can be inspected. Both arms get that same probe; it is not an API sample and it warms shared buffers. The fixed summary, independent KPI totals,60second per-statement limits, separate role packets and final restoration guards remain unchanged. This is still disposable-only diagnostics, with full-role, pooled-session,30k and hosted/API acceptance outstanding.

## Clean installed-candidate validation

The scalar comparison in run [36859858055](https://github.com/pl0203/lou_erp/actions/runs/36859858055) passed the 620-observation matrix and restoration checks. On the same fixture, parent-set alone versus parent-set plus scalar active-profile checks measured admin 2.724→1.594 seconds and manager 4.785→3.856 seconds. Actual count plans showed statement InitPlans running once per occurrence. These are individual SQL observations; the manager result remains above the latency target and does not establish API/browser p95.

The next packet installs one clean candidate and restores mandatory validation. The deployable scalability inventory is exactly:

- `supabase/migrations/202610010001_scalable_order_reads.sql`
- `supabase/migrations/202610010002_scalable_report_reads.sql`
- `supabase/migrations/202610010004_scalable_order_lookup_index.sql`
- `supabase/migrations/202610010007_read_policy_plans.sql`
- `supabase/migrations/202610010008_customer_delivery_aggregation.sql`
- `supabase/migrations/202610010009_sales_page_enrichment.sql`

There is no 202610010003 migration. Existing 202609300003 is the earlier Storage migration. Rejected 202610010005/006 files are retained only under `tests/database/experiments/`, outside automatic migration discovery. The clean candidate never drops an existing index; it rejects named rejected-index state for separate review. 007 atomically guards the exact role, policy, helper source, FK and summary-base contracts; preserves untargeted functions, table/column grants and policies; applies the measured parent-set/scalar predicates; and uses the original report query with fixed typed execution. No authorization helper or permissive policy is rewritten.

Disposable CI alone reconstructs the reviewed hosted-equivalent policy/FK topology before 007. Five negative preflight tests must reject ACL, policy, FK, helper-source and experimental-index drift. Their wrapper executes only the exact preflight inside rollback transactions, never the migration COMMIT. Hosted rollout must inspect the actual catalog and apply no synthetic reconstruction.

Before large loading, the installed candidate must pass the literal 620-case read/write/state matrix and roll back to verified empty state. The unchanged 6,000-PO fixture then runs three bounded public-RPC diagnostics, full-role exact ground truth, and a single-connection pooled regression with 242 successful calls and 33 fail-closed calls across all 11 read RPCs. Each RPC has a separate 60 second statement boundary. The pooled sequence includes six default-mode calls before actor/filter changes, forced-generic calls, inactive/missing/anonymous denial, and restored identity. Exact row/metric expectations come from independent fixture aggregates; existing small parity suites additionally cover ranking, date boundaries and hidden labels.

Required evidence includes every final marker, successful normal security/transaction/concurrency suites, and complete logs even on failure. Explicit bash pipefail and required output markers prevent incomplete SQL from producing a false-green result. Final 6k compilation/correctness/session results are pending until this candidate runs. The fixed 30k candidate follows those gates; fresh-session percentile sampling and actual hosted/API/browser measurements remain separate. No hosted migration approval follows from this packet. 007 rollout must be reviewed separately, and rollback must restore exact prior policies/summary from the approved artifact; 004 should only be removed if deployment records prove this rollout created it.

Candidate migration SHA-256 inventory (source identity, not execution evidence):

- `supabase/migrations/202610010001_scalable_order_reads.sql`: `071ea9280adf79b6ba5c0eb405e7b66706332f2ce2e183a9983a312a025614da`
- `supabase/migrations/202610010002_scalable_report_reads.sql`: `8a7ee2a24e942f1c0d82d48b3d122ad88b25d48a090a88cc35f194d3882f03e4`
- `supabase/migrations/202610010004_scalable_order_lookup_index.sql`: `9e8d5afba857af858e743b33a516eaf3f240738f7c2a5ea544f8fdc171ba0088`
- `supabase/migrations/202610010007_read_policy_plans.sql`: `7cf626f169b52d993c00724c0ba34ba96438c85e03adea8b2c646a2e1a51c9dd`

## First clean-candidate runtime evidence

Run [36865407948](https://github.com/pl0203/lou_erp/actions/runs/36865407948) passed all five preflight rejection cases, the installed 620-case matrix/rollback, unchanged 6k load, all three fresh summary diagnostics, and the complete seven-role ground-truth marker. Fresh summary observations were admin 1.283s, forced-generic admin 1.287s and manager 3.585s. Normal safety run 36865407669 separately passed 475 app tests, SQL/security/parity checks and 12 races.

The pooled stage remained incomplete: the wrapper's 15-minute total-process limit stopped it after 238 of 242 success assertions and all 33 denials. There was no PostgreSQL statement-timeout error or mismatched-result assertion in the completed log. The final rollback/completion marker was absent, so this is a failed acceptance gate. Twenty-one customer-performance assertions consumed 606.754seconds including independent oracle work; privileged-role cases took54.6–58.3 seconds each. Their RPC/oracle split was not available because the evidence table printed only at successful completion.

The next harness-only revision streams RPC completion time before the oracle and separate oracle/total times after each assertion. Only the exact pooled test file receives an 18-minute total-process budget, supported by the observed nearly complete 15-minute run; all other process limits remain 15 minutes, every SQL statement remains 60 seconds and the job remains 20 minutes. Coverage, same-session transitions, strict failure propagation and final rollback marker stay required. This budget accommodates the comprehensive correctness matrix; it does not relax any product latency target or explain away the unresolved customer-report cost.

## Customer-report bottleneck diagnostic

Run [36867791145](https://github.com/pl0203/lou_erp/actions/runs/36867791145) passed the installed-policy and full-role ground-truth gates again, but its pooled run stopped at a genuine 60-second SQL timeout inside the executive July customer-performance RPC after 102 successful assertions. Completed manager customer RPCs took 29.37–30.00 seconds while oracle-and-validation took 86–98 milliseconds. The whole-process budget was not reached. This confirms a query bottleneck; it does not establish that cached plans are its sole cause.

The next run is explicitly diagnostic-only. Full-role and pooled acceptance commands remain unchanged but held; they must be restored on a remedy candidate. Nine fixed read-only packets use the exact 002 customer SELECT, removing only INTO and binding six arguments plus the two derived month dates. A source-body hash checks the installed function before execution. Four cost plans cover manager September/executive July under custom/generic modes. One cost-only prepared sequence executes five manager EXPLAINs then an executive sixth EXPLAIN and prints generic/custom counters; it diagnoses planner choice, not six actual RPC executions. Three fresh public-RPC probes use manager auto, executive auto and executive forced-generic modes, each with session-only nested cost logging and independent count/sales constants. One manager custom inner-query ANALYZE probe records actual rows/buffers with timing overhead disabled. Cost output precedes timed execution. All retain real RLS, 60-second statements, separate transactions and rollback markers; every case is attempted and any timeout still fails the diagnostic job. No product query, helper, policy or index changes accompany this packet.


## Query-only customer delivery preaggregation trial

Run [36870118479](https://github.com/pl0203/lou_erp/actions/runs/36870118479) captured the exact manager plan: 60,005 visible delivery rows were rescanned 504 times, with 30,237,516 join-filter rejections and 31.484 seconds of execution. Fresh executive auto and forced-generic calls both timed out at 60 seconds. Thus the repeated scans occur even without pooled cache reuse. A diagnostic assertion incorrectly expected 125130 for September manager sales; that was the dashboard PO-date cohort. Customer revenue includes an additional 50 delivered against an older PO, so the corrected independent constant is 125180. Product metric semantics were not changed to fit the incorrect diagnostic.

Candidate 008 changes only the customer report SELECT. A materialized CTE sums the same visible delivery-line quantity×visible PO-line price by shipment ID once. Existing customer, eligible PO, nonvoid shipment and shipment-month joins sum those exact values. It adds no PO-date restriction and no new line/header parent constraint. Policies, helpers, privileges, function signature and security attributes stay unchanged; a base-body guard rejects unexpected source state.

Before the unchanged 6k load, a new SQL suite compares the untouched 002 query against 008 for all seven active identities, three months and two pages under forced-generic plans. Independent facts additionally pin an older-PO current-month delivery, a zero-price promotion, current-month order count, fractional visit boundary, future latest visit and target history. Inactive access remains rejected. The diagnostic generator reads the installed 008 body and checks its hash. Full-role and the unchanged 242-success/33-denial pooled gates are restored for this trial. Acceptance and performance remain pending actual runtime results.

Candidate SHA-256: `supabase/migrations/202610010008_customer_delivery_aggregation.sql`: `9bc0fb3cf69cf0273025bfbe7d2af36cce55bde5460cfee3d27fdbeaa2ef868a`

## Verified 6k correctness and fixed 30k continuation

Run [36871610997](https://github.com/pl0203/lou_erp/actions/runs/36871610997) passed all seven-role ground truth, exact customer-query parity, nine diagnostic markers, all 242 pooled successes and 33 denials, and the final rollback marker. The delivery scan now ran once over 60,005 visible rows, then aggregated 6,005 shipments once. Customer RPCs ranged 0.786–0.887 seconds for global roles and 2.698–2.957 seconds for team roles. Normal safety run 36871611040 passed 483 app tests and 12 races. This closes 6k correctness/session behavior. Mixed-case pooled maxima remain daily 7.420s,stats 4.556s,summary 3.854s,line page 3.649s; these are not p95 samples or a latency acceptance claim.

The next fixed candidate uses 30,000 base POs, 500 per month over 60 months ending September 2026, with the same ten lines/two partial shipments per PO and seven edges. No product migration changes accompany this step. Pooled guards accept only the two reviewed manifest sizes, verify actual table counts using independent base-plus-edge arithmetic, and keep all 242 successes/33 denials and date/filter/actor transitions unchanged. Owner snapshots naturally extend first-order/all-time facts; recent-quarter 1,500 and rolling-year 6,000 cohorts remain fixed. Unit tests compare the SQL count expressions with both approved manifests; actual 30k SQL remains the execution gate.

The 6k pooled matrix took about 6 minutes 11 seconds. The fixed 30k pooled file alone receives a finite 40-minute process budget and the job 45 minutes, allowing fivefold history growth plus setup margin for this comprehensive matrix. 6k pooled retains 18 minutes and other SQL files 15 minutes. Every SQL statement retains its 60-second limit, timing splits stream immediately, and timeouts/missing markers fail. These are correctness-harness bounds, not permitted application latency. Actual 30k results, API/browser tests, stable percentiles and separately approved hosted rollout remain open.

## 30k sales-page plan failure

Run [36873667768](https://github.com/pl0203/lou_erp/actions/runs/36873667768) loaded the exact 30k fixture and passed customer diagnostics and full seven-role ground truth. Pooled validation stopped after 11 successes: five identical manager sales-page calls took 4.27–4.33 seconds, then the sixth timed out at 60 seconds inside the RPC before its finish marker. No 40-minute process limit was involved, and no final pooled marker exists. 30k correctness/session acceptance is therefore incomplete. Full-history manager summary calls also took about 36 seconds; passing exact totals does not meet a latency target.

The next source packet is diagnostic-only with unchanged full-role/pooled commands held. Five read-only packets bind the exact 001 sales-page SELECT and verify its installed source hash: custom and generic cost plans, six identical auto-mode cost EXPLAINs with planner counters, and fresh auto/forced-generic actual RPC calls. The same real manager identity, 30k manifest, 15007 matching rows, ten-row page, 60-second statements and rollback/failure markers remain. Session-only nested cost logging accompanies actual RPCs. No policy, helper, index or product-query change is included. The plan must distinguish repeated nullable-label joins from a broader authorization cost before selecting the next narrow remedy; all acceptance commands must return unchanged afterward.


## Sales-page late-label trial

Run [36875622342](https://github.com/pl0203/lou_erp/actions/runs/36875622342) confirmed the sales-page plan change: five custom plans followed by one generic plan, with the generic estimating one order and nesting full customer/user scans. Fresh auto completed 4.378 seconds; forced-generic timed out 60 seconds. Customer/user relations are PK-unique nullable labels and do not participate in this RPC's filters, sort or counts.

Candidate 009 therefore keeps matching orders and all filter/count/status logic together, materializes the bounded created_at/id page, then enriches only those rows through the same RLS-filtered nullable joins within the same statement. It does not force planner settings or change helpers/policies. Exact base-body and relation-PK guards precede replacement; signature/defaults/security attributes remain unchanged.

A new rollback-only oracle compares untouched 001 and 009 across all seven roles, five status selections, both own flags, optional customer/visit filters, tied dates, first/second/empty pages. Independent checks retain exact total/status counts and authorized rows whose customer and submitter labels are hidden. The fixture uses a test-only restrictive user-label policy to exercise the latter without granting access. Existing PO punctuation/literal-search tests remain required; the sales RPC has no text-search argument. Full 30k ground truth and unchanged 242+33 pooled gates are restored, with diagnostics bound to 009. Runtime equivalence and improvement remain pending.

Candidate SHA-256: `supabase/migrations/202610010009_sales_page_enrichment.sql`: `40f8109d8e5bb449c2ea65ac54843915d80ac3ecd0431aeff33fb661427edd74`
