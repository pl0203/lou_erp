# Read-scale verification record

As of 1 October 2026, this is a review candidate, not a release certificate. The table separates source/test results from hosted and scale acceptance. Do not transfer a passing result to a different source tree without a fresh run.

| Gate | Evidence | State |
|---|---|---|
| Baseline source | Deployment `27d988e53d6a333f60b8a38171515f4c1fcb927f`, tree `0eac624305f0e971eb28aba572b971c966de727c`; 192 application tests at baseline | Recorded |
| Contract and regressions | Frozen v1 DTOs; examples for all 11 RPCs; unsafe-count/money/page decoder failures; current-metric characterizations; simulated missing-data regressions | Independently reviewed |
| Complete metadata helper | Actual-page-length advancement, exact total, duplicates/early-empty/abort/count-change failures; one full restart | Independently reviewed |
| Primary client | Owned commit `70cfaf7`: independent 316/316 tests, typecheck and diff check; local with detail lifecycle `fb4bfd0`: 321/321 plus build/type/diff | Passed for those source trees |
| Calendar populations | UTC, Asia/Jakarta and America/Los_Angeles each passed 27 report/calendar checks before the latest detail lifecycle addition | Recorded; rerun final tree |
| Supporting reads | `3fd4bd7` + `99cd56d`: reviewer independently passed 39 focused tests, including real query-cache navigation; final supporting build/type/diff passed | Independently reviewed |
| Supporting-only full suite | 301 pass / 3 deliberately red pre-migration cap tests; primary migration is absent from that branch | Not a combined-suite pass |
| Normal PostgreSQL SQL/RLS | SQL commit `63b1c199611520658fbd77a3e0f1005e7c0e78a8`, tree `dee3e1a742b303938e32e056116b5049a24dedab`, CI `36832401749`: all three new SQL suites, prior invariants/security suites and 12 concurrent scenarios passed | Passed SQL checkpoint |
| Final combined tree | Initial local integration `585b7f3` / tree prefix `a56005d`; successful-write invalidation gaps identified and under repair | Pending final SHA, full tests and independent review |
| 6,000/30,000 growth fixtures | Guarded generator/measurement harness and exact manifests being reviewed; no result recorded here | Pending correctness and timing |
| Hosted staging migrations / actual JWT/PostgREST | Populated-stage additive packet prepared; fresh drift check and exact apply approval required | Pending |
| Hosted literal search | Primary PostgreSQL/PostgREST documentation reviewed and SDK serialization tests passed; no local or hosted PostgREST matching run established | Pending |
| Browser/device UAT | Last transport recheck blocked 06:35 UTC; future state must be reverified | Unrun |
| API/browser p50/p95 and concurrency | No accepted 100-request/per-case or 1/5/10-user evidence | Unrun |
| Invitation, role assignment and real-admin journey | Source hardening exists; deployed Edge Function and complete account journey need evidence | Pending launch gate |
| Historical workbook import | Workbook/population and reviewed dry-run reconciliation outstanding | Separate pending workflow |
| Production release | Backup/restore, final staging acceptance and specific release approval required | Not approved |

## Observed SQL diagnostics

Earlier individual analyzed CI calls observed approximately 1.94 seconds for a manager dashboard, 3.8–4.2 seconds for child-heavy customer stats and 2.1–2.5 seconds for line reads around the boundary fixtures. Those are isolated SQL observations, not API p95, 6k/30k results or live capacity. Fixture planning changed materially after `ANALYZE`; environment, sample count and plan must accompany any comparison. Baseline fixture indexes are not evidence of the actual hosted index inventory.

## Required final evidence update

Record the exact final commit/tree, full test totals and logs, typecheck/build/diff status, database CI run and all suite markers, reviewer disposition, migration hashes and actual staging target. Reconcile the [read inventory](scalability-read-inventory.md) with the source. Preserve failed and unrun results; do not replace them with a single green label.

For scale results, save the reviewed manifest, roles, row/byte counts, schema/index inventory, query parameters/plans, environment and warm/cold/concurrency profile. Distinguish SQL execution/planning from local process time, API latency and client loading. Only then compare against the proposed goals in the [staging packet](scalability-staging-packet.md).
