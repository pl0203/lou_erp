# Proposed staging validation of two read optimizations

This is a review proposal, not an executable rollout packet or deployment
approval. Staging contains imported real business data. Production is outside
this proposal. No hosted change has been made by either performance experiment.

## Candidate scope

Replace only the bodies of these existing functions:

- `private.pilot_can_read_po(uuid)`: one active-caller lookup and the same global,
  own-actor and direct-manager current/legacy link authorization
- `public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer)`: exact
  visible eligible delivery values aggregated once per shipment before the
  existing header/day joins

Retain both OIDs, signatures, names, return types, owners, grants, configuration,
volatility and security attributes. The private helper remains definer and the
public read remains invoker. No RLS policy, index, table, data, auth account,
credential, assignment, frontend or Edge Function change is included.

## Verification and remaining release decision

The combined candidate passed complete 6k/30k role and 242-success/33-denial
same-connection gates, plus the isolated 15-suite/12-race checks with exact
restoration, at `8ce752b9b0cf8af42b9491d47679709735833682`. See the exact
[run 36930163790](https://github.com/pl0203/lou_erp/actions/runs/36930163790)
and evidence inventory in the [experiment plan](daily-preaggregation-experiment-plan.md).

**Do not recommend the daily candidate as uniformly beneficial yet.** Broad
manager/admin paired screening improved, but the combined 30k pooled run observed
narrow daily calls of 796.665–2050.845ms. Earlier helper-only runs observed about
153–187ms for those narrow cases. These are separate-run observations, so they
do not prove a matched regression; they do identify a material selective-filter
tradeoff that remains unresolved. Require matched narrow/broad comparisons under
identical data, roles, cache mode and paired order before an unconditional daily
rollout recommendation. No further optimization experiment is included in this candidate.

Observed combined 30k maxima also included customer stats 4846.829ms and daily
2922.950ms. Correctness acceptance is separate from latency acceptance, hosted
p95 and production capacity. The prepared changes have not been applied to
staging or production. This proposal remains conditional on the latency review
and specific hosted approval.

## Required packet preparation after resolving the release decision

1. Freeze exact source hashes and reviewed CI evidence. Capture a fresh read-only
   staging fingerprint of both full function definitions/attributes, relevant
   role/helper contracts, all untargeted metadata and protected data counts/hashes.
   Verify the exact target, expected original bodies and current schema state.
2. Build one atomic state-pinned apply artifact: assert the fresh baseline,
   replace only the two bodies, compare all other metadata and data unchanged,
   then commit with a concise receipt. Fail closed on drift. Preserve the original
   definitions in a private receipt-bound recovery artifact.
3. Independently review the exact assembled bytes and exercise them against a
   representative fictional disposable fixture: good apply, wrong baseline,
   unexpected body/ACL drift, rollback, and intervening authorized data edits.
   Recovery restores only the confirmed function state while preserving current
   business data. No broad schema reset, row deletion or automatic account change.
4. Obtain specific user approval for the staging-only backend update and any
   SQL-editor warning before execution. Existing experimental authorization does
   not authorize hosted application. Keep raw catalog details and business data
   out of public repository artifacts.
5. Run the exact artifact once through the approved staging operator. Save its
   fresh commit receipt and independent read-only post-check. Resolve uncertain
   outcomes from current state before any retry.
6. Test actual authenticated API/UI reads with existing authorized accounts:
   role-scoped lists, hidden records, daily page/date/status boundaries, nullable
   prices, and full-range import-plus-fixture financial reconciliation. Preserve
   the known UI filter cohort when comparing totals. Measure hosted latency
   separately; do not infer it from owner SQL plans or CI timings.

If the combined candidate fails correctness, retain the verified current staging
functions and diagnose the exact failure. If correctness passes but latency is
still above the chosen goal, disclose that limit and treat any further query or
policy optimization as a separately reviewed scope.

## Migration-history release gate

The reviewed staging read at 2026-10-01T20:27:25Z found the CLI migration-history
relation absent. The deployed schema was separately verified. Neither absence
of the ledger nor local migration files establishes replay safety. No blind
`db push`, history repair or replay of earlier guarded migrations is authorized.
A future production rollout needs an explicit version/source/apply-receipt/
current-catalog reconciliation and separately approved history strategy.
