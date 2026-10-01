# Disposable daily preaggregation experiment plan

Status: disposable correctness gates passed; the selective-filter latency
tradeoff remains unresolved. No deployable migration or hosted change.

## Evidence and fixed hypothesis

At commit084d3e6b545db41b3e5e55d07c9b8388f1c7e54c, diagnostic
[run 36926471668](https://github.com/pl0203/lou_erp/actions/runs/36926471668)
passed all six exact daily query/oracle/restoration packets on the unchanged30k
fictional fixture with the accepted experimental authorization helper.

The PO-admin actual plan materialized 120,004 eligible delivery-line rows and
rescanned them 1,003 times, rejecting 120,354,009 pairs at the header equality join.
It read 514,026 temporary blocks. Manager rescanned 60,004 rows 503 times, rejecting
30,177,009 pairs and reading129,014 temporary blocks. Estimates at the final
nested join were one row. These are instrumented plan observations.

Actual RPC custom/generic/auto times were manager 4216.794/4223.295/4215.998ms and
admin 9340.341/9414.004/9377.622ms. Exact response checks and metadata restoration
passed each time. Replanning alone is not supported as the remedy by these data.

## One algebraic change

Keep the original materialized `pos`, visible eligible `lines`, page `days`,
all argument guards, envelope, sort and final zero-coalescing unchanged.
Add a materialized delivery-value relation grouped by `surat_jalan_id` from
visible `sj_line_items` joined to the existing eligible `lines`, summing the
same exact numeric quantity-times-price expression.

Join those per-shipment values to the same visible/nonvoid headers, eligible
header parents and page days. Sum their values by day and retain
`count(DISTINCT s.id)` for shipment count. Both header-parent and line-parent
membership remain required independently. Do not add equality between those
parents, an extra historical-date cutoff, a price/quantity filter or new
fulfillment behavior. A header with no qualifying visible line remains absent;
a header with a qualifying zero-valued line still counts. No floating-point
arithmetic, rounding, clamping or early coalescing is introduced.

## Small correctness gate before timing

Use an empty guarded disposable fixture with the actual installed policies and
accepted helper. Create literal facts exercising:

- multiple lines and shipments, duplicate references to one line, exact cents
- zero quantity and zero price; empty headers and voided headers
- visible header with hidden line, hidden header, both visible but different PO
- line-parent or header-parent outside the date/status cohort independently
- first/last/next day, leap February, year boundary, page1/page2/empty page
- every active role, inactive/missing/NULL identity and rejected arguments

Negative quantities/prices are prohibited by existing table checks. Keep those
checks enabled and verify rejection; do not seed invalid negative business rows
by weakening constraints. The candidate keeps the original signed numeric SUM
expression without adding an absolute-value or positive-only filter.

Compare the full normalized original/candidate JSON response, excluding only
statement timestamp and normalizing numeric representation, and independent
literal daily amount/count expectations for all 15 fixed cases. Preserve extra
item keys so unexpected response fields also fail equivalence.
Use a prepared connection with role and filter changes past five calls. Require
negative controls that deliberately drop line-parent membership or count empty
headers to fail the literal oracle, preventing vacuous baseline equivalence.

Original002 query bytes remain the baseline. Store the candidate only under
`tests/database/experiments`; any temporary installed replacement is guarded,
transaction-local, invoker/STABLE/empty-search-path and preserves exact function
OID/signature/defaults/owner/ACL/attributes. Helper/query/policy/index catalogs
must match the expected trial state, then restore exactly after rollback.

## Bounded performance comparison

After the small parity gate, use the unchanged fixed 30k fixture and identical
manager/PO-admin September page parameters. Both arms use the same accepted
experimental helper. Run shared-buffer warmups and balanced AB/BA pairs with
complete daily oracle checks outside RPC timing. Two observations per arm are
screening medians, not p95 or pooled capacity evidence.

Capture actual inner plans separately from timed calls to check whether repeated
materialized-line rescans and temporary reads disappeared. Preserve 60-second
statement limits and finite process/job bounds; failed or missing observations
fail the gate. No new index, planner setting, RLS policy or helper rewrite.

Any eventual candidate promotion requires the unchanged full 6k/30k role and
242-success/33-denial session gates again, plus relevant security/race checks.
The accepted helper's existing correctness evidence remains recorded separately.
No hosted application is included in this plan.

The small matrix has 226 observations: 113 per arm, comprising eight repeated
manager calls followed by seven active roles across 15 cases. Inactive, orphan,
NULL and anonymous identities are separate rejection probes. Four warmup, eight
AB/BA and four instrumented-plan packets each require exact role, full oracle
and restoration markers. At source freeze, runtime SQL compilation/parity and performance were still
unverified; the following measured-result section records their subsequent pass.

## First measured result

The frozen test-only candidate at b159e09e4a335742205ee70d6e3d2ede69bf6017 passed
[run 36928572704](https://github.com/pl0203/lou_erp/actions/runs/36928572704).
Its226 small parity observations, both deliberate oracle-negative controls,
all 16 RPC/oracle observations and 20 restoration markers completed.

Same-run two-observation-per-arm medians were manager 3156.019→1905.129ms
(39.6% lower) and PO-admin 7554.113→2580.457ms (65.8% lower). These are
fresh-connection screening medians after shared-buffer warmups, not p95.

Actual plans aggregate 6004/12004 visible eligible shipment groups once. Temporary
reads fell from 129014/514026 blocks to 258/515 for manager/admin. The remaining
nested join still rejected 3,019,509/12,039,009 pairs, approximately ten times
fewer than baseline. Shared-buffer hits were unchanged in the paired plans;
this trial reduced intermediate-row work rather than removing RLS checks.

At the first screen, full 6k/30k same-session acceptance with this daily candidate
was pending. The combined acceptance result below subsequently closed that
correctness gate; helper-only evidence was not used as its substitute.
No deployable migration or hosted optimization has been applied.

## Combined correctness acceptance preparation

The next fixed workflow installs both reviewed bodies together only in disposable
PostgreSQL17. Separate6k/30k jobs retain the complete original all-role ground
truth and 242-success/33-denial same-connection suites, plus the small daily
literal matrix. No timeout increases: 60s statements, 18/40-minute pooled process
budgets and 20/45-minute jobs. Only the exact combined generated pooled filename
is added to the established bounded timeout classification.

The cross-session companion shares the already tested 15-suite/12-race runner,
with unchanged helper-only defaults. Its fixed combined entrypoint captures both
original bodies and full catalog evidence, atomically installs both candidates,
then atomically restores both originals. Only original-original and
candidate-candidate pairs are recognized; mixed pairs and metadata drift fail
without blind overwrite. Separate rollback-only negative probes deliberately
install each mixed pair and require the precise guard error.

All original helper-only and daily-screen generated packets remain byte-identical
to their previously verified versions. Combined runtime acceptance was a new gate; its source checks did not replace
the actual completion markers recorded below.

## Combined acceptance result and exact evidence

At `8ce752b9b0cf8af42b9491d47679709735833682`, tree
`656f551d51365f0d180a96ad98f0df3b5393f92c`,
[run 36930163790](https://github.com/pl0203/lou_erp/actions/runs/36930163790)
completed all three jobs:

| Job | ID | Verified result |
| --- | --- | --- |
| Fixed 6k | 110597183206 | All-role ground truth,226 daily parity cases,both mixed-state negatives,242 successes / 33 denials and original metadata restoration |
| Fixed 30k | 110597183199 | Same complete gates;22 successful observations for each of 11 RPCs |
| Isolated candidate races | 110597182923 | All 15 original SQL compatibility suites,12 real cross-session races and exact two-body/catalog/bucket restoration |

The race artifact's before/active/after receipts were downloaded and compared.
Before equals after exactly. Active preserves normalized catalog and bucket
fingerprints. Both individual body hashes and the combined hash match the exact
frozen original/candidate source bytes. Expected losing-race SQL errors are
assertions, not evidence of failed scenarios.

| Artifact ID | Contents | GitHub SHA-256 |
| --- | --- | --- |
| 11194664593 | Fixed 6k complete evidence | `667d7a741e88e0a35b96f795041e8370306821cb0ac5fd80516831909e60de53` |
| 11195174573 | Fixed 30k complete evidence | `25ef9ff8a98a10188d60b02a1888761fce63b05aa6b054dba8ad138eca39ac16` |
| 11195632106 | Two-body race lifecycle and receipts | `9e3edc2d504b8dd33576f69c573681f468b5e95019226950c80b2470ce533803` |

These artifacts are listed on the run and expire 2026-10-08 under the seven-day
retention setting. The race ZIP digest was independently checked after download.
Same-head [normal safety run 36930163571](https://github.com/pl0203/lou_erp/actions/runs/36930163571),
job 110597180111, passed764 application tests, type/build checks, SQL security and
transaction suites,12 races, guarded rollout lifecycle and importer recovery/size
checks. The original PR3-only scalability workflow was intentionally skipped.

Observed per-RPC maxima in the combined pooled runs (milliseconds):

| RPC | 6k | 30k |
| --- | ---: | ---: |
| PO page | 151.212 | 768.655 |
| Sales page | 616.170 | 3349.095 |
| PO lines | 651.247 | 3180.183 |
| Summary | 1178.871 | 3317.477 |
| Daily | 784.142 | 2922.950 |
| Customer stats | 845.437 | 4846.829 |
| Revenue | 72.984 | 78.928 |
| Customer performance | 671.435 | 3225.691 |
| Sales performance | 138.216 | 156.249 |
| Team activity | 63.897 | 71.131 |
| Manager customers | 12.728 | 13.679 |

These maxima are observations from a correctness matrix, not p95 estimates.
Broad paired screening gains do not establish uniformly improved latency:
combined 30k narrow daily observations were 796.665–2050.845ms, versus roughly
153–187ms in earlier helper-only runs. Separate runners/cache histories prevent
attributing a precise regression, but the potential narrow-filter tradeoff must
remain a release gate until matched narrow/broad comparisons are performed.
The combined correctness/session/race gates passed; unconditional latency and
hosted rollout approval did not. No further tuning is included in this packet.
