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
