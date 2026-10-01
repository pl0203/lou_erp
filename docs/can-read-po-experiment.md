# Disposable PO authorization helper experiment

Repeated role and actor helper calls remain visible in the real-role read plans.
This experiment tests whether one qualified lookup of the active caller reduces
that cost without changing authorization. It changes no deployable migration,
policy, index, application query or hosted configuration.

The candidate lives in `tests/database/experiments/can-read-po-single-lookup.sql`.
Every installation occurs inside a guarded `pilot_test` transaction and rolls
back. The original body hash, owner, SQL language, signature, non-STRICT behavior,
STABLE/definer/search-path attributes, planner attributes and execute boundary
are checked first. Complete function metadata is compared after replacement.
Untargeted function, relation, column, constraint, index, trigger, role, membership, schema and policy metadata is preserved;
only physical relation statistics and freeze horizons are excluded from the
catalog comparison. Post-rollback metadata and original body must match before
the packet emits its success marker.

## Correctness gates

- Independent direct-helper oracle: 1,428 observations per variant, across 14
  caller identities, 17 PO/NULL inputs and six identity/status states
- Global active roles still return true for NULL or nonexistent PO IDs
- Missing, inactive and NULL callers return false, never SQL NULL
- Current and legacy links preserve own and immediate-manager history,
  including inactive and non-sales actors, duplicates and mixed teams
- NULL current/legacy links do not authorize NULL PO inputs; grandchildren do
  not create recursive team access
- Prepared generic reads cross caller switches, deactivation/reactivation,
  role demotion/restoration and manager transfer; linked-order and parent
  status do not filter helper access
- An authenticated-owned temporary `users` table cannot shadow qualified reads
- Malformed JWT subjects preserve SQLSTATE 22P02; anon access remains denied
- Deliberate false/true/NULL/parent-existence defects must fail the literal oracle
- The existing 620-observation policy/write/state suite runs unchanged under
  both bodies, then rolls back to an empty database before the large fixture

The normal safety workflow remains mandatory for the unchanged deployable code,
including query parity, permissions, transactions and 12 separate-session races.
Those separate race connections do not see a transaction-local experimental body;
they are not presented as candidate-helper concurrency evidence.

## Fixed 6k measurement

The existing fictional fixture is unchanged: 6,000 base POs over 12 months,
10 lines and two partial shipments per PO, plus seven edge POs. Both arms get a
warmup for each of manager, salesperson and PO admin. These warmups prime shared
data buffers only, since each packet opens a fresh connection; they do not warm
per-session function or prepared-plan caches. Each role then has the
same baseline/candidate/candidate/baseline sequence with identical parameters.
Every packet uses a fresh guarded connection, a 60-second statement ceiling and
verified rollback. The dedicated job has a finite 20-minute ceiling.

Only the RPC interval is timed. Exact independent KPI constants are checked
afterward. Helper, parent-count and summary plan probes run after all timing
arms, so they do not warm only one side of the comparison. Plan logging is
session-local. Per-statement and rollback failures fail the job; logs and plans
are retained even on failure.

The report uses the median of two measurements per arm as an initial screen.
A manager median improvement of at least 20%, a matching plan explanation and
no unexplained regression in other cases are needed to consider another step.
These observations are not p95, API/browser latency or capacity acceptance.
Fresh-connection timings also do not establish pooled-session performance.

No hosted rollout is included. Fixed 30k probes follow only after the
direct/policy/6k gates pass. Any eventual deployable proposal still
requires independent review, complete 6k and 30k role ground truth and the full
242-success/33-denial same-session matrix with final rollback markers, without
raising statement limits. Hosted authorization changes require separate approval.

## Verified 6k screening evidence

The repaired candidate at commit `b4214dee1fa8b49e524bc724d562eb083e66bbbf`
passed [experiment run 36917434083](https://github.com/pl0203/lou_erp/actions/runs/36917434083).
Both direct truth matrices, all four negative controls, both 620 policy matrices
and every rollback marker passed. The two-observation-per-arm RPC medians were:

| Caller | Original (ms) | Candidate (ms) | Reduction |
| --- | ---: | ---: | ---: |
| Manager | 3930.540 | 660.283 | 83.2% |
| Salesperson | 3683.555 | 689.053 | 81.3% |
| PO admin | 1412.092 | 990.444 | 29.9% |

The single-helper plan changed from four nested role scans plus actor-helper
work to one indexed caller lookup (actual loops 1). The manager parent-count
probe retained 3,007 visible and 3,000 filtered POs, with elapsed 928.190→95.306ms.
These support the intended mechanism; they do not establish pooled or p95 latency.
The same-head normal safety run passed 697 app tests, SQL gates,12 races and
rollout/import lifecycle checks on the unchanged deployable implementation.

## Fixed 30k screening candidate

The separate `helper-read-30k-experiment.yml` workflow retains the same helper
body, small truth/policy gates, disposable connection guard, 60-second statements
and 20-minute job limit. The unchanged fixture has 500 POs/month for 60 months,
ten lines/two partial shipments per PO and the same seven edge POs.

Four manager workloads use the existing acceptance-suite parameters: July
summary with the rolling 12-month cohort, September daily deliveries, July
customer stats for customers 1+2/top 3, and the first PO's ten lines. Each has both
buffer-warmup arms and an ABBA sequence, for 24 bounded calls total. The exact
owner-fact materialization, role checks, independent oracle and timing routine
are copied byte-for-byte from `scalable-pooled-reads.sql`, before its full driver.
For summary this compares six metrics, status buckets and monthly buckets;
ranking/label equivalence remains covered by the separate small summary suite.
The other selected workloads retain their complete existing normalized oracle.

Each call streams RPC time separately from oracle-and-validation cost. Missing
observations, mismatched oracles, timeout or missing restoration fail the screen.
Fresh connections still do not prove same-session or candidate race acceptance.
The screen passed at `a3ea078cb34dd4292f68edb539fa8d22a75f65f6` in
[run 36919498957](https://github.com/pl0203/lou_erp/actions/runs/36919498957).
All 24 RPC/oracle checks and 27 restoration markers completed. Manager paired
RPC medians were:

| Read | Original (ms) | Candidate (ms) | Reduction |
| --- | ---: | ---: | ---: |
| Summary | 28216.560 | 2783.404 | 90.1% |
| Customer stats | 43609.144 | 3759.185 | 91.4% |
| PO lines | 34933.844 | 2927.894 | 91.6% |
| Daily deliveries | 29755.092 | 4262.606 | 85.7% |

Oracle-and-validation intervals were 8–149 ms. Several candidate times remain
above the desired latency goals. This is screening evidence, not hosted latency,
p95 or full acceptance. Container shutdown logs included an autovacuum
cancellation during fixture loading; the actual test queries and markers passed.

## Full candidate acceptance preparation

`helper-read-acceptance.yml` uses separate fixed 6k and 30k jobs. It preserves the
complete existing all-role ground truth and 242-success/33-denial same-connection
suites byte-for-byte between callback-inserted helper setup and restoration.
Each RPC still has 60 seconds. The exact generated pooled path receives only
the existing 18/40-minute process budgets and 20/45-minute job budgets.
Every candidate helper replacement in these jobs rolls back.

A third job has its own fresh PostgreSQL17 service and `pilot_test` database.
That isolated companion temporarily commits the reviewed candidate so separate
race connections can observe it. Its runner captures and persists original
catalog/body/bucket fingerprints first, verifies the candidate changes only its
body, runs all 15 unchanged SQL compatibility suites and all 12 existing races,
then restores the exact original helper and verifies an empty synthetic fixture.
Original suite paths preserve relative includes; session 60-second and process
120-second bounds remain. The race subprocess itself has a finite five-minute
ceiling. Restoration is attempted after a failure, while the failure still makes
the gate fail. Unknown helper or catalog drift is never overwritten.

At this revision the full candidate acceptance stage is **not yet run**. It adds
no deployable migration, hosted helper change or migration-history repair.
Publication of its reviewed synthetic workflow remains the execution gate.
