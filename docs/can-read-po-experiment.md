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

No 30k experiment or hosted rollout is included. Fixed 30k probes may be prepared
only after the direct/policy/6k gates pass. Any eventual deployable proposal still
requires independent review, complete 6k and 30k role ground truth and the full
242-success/33-denial same-session matrix with final rollback markers, without
raising statement limits. Hosted authorization changes require separate approval.

At source preparation time, SQL compilation, runtime parity and timing results
are **not yet run**. Parent publication of the reviewed synthetic-only workflow
is the execution gate.
