# Read rollout recovery

This staging-only recovery preserves all business data and the existing secure write path. Never reset the project, delete records, disable RLS, restore broad grants or drop audit/request/tombstone/visit evidence to undo these read changes. Production recovery is outside this packet.

## Atomic execution and unknown outcomes

The reviewed private bundle is one transaction containing exact 001/002/004/007/008/009 bodies. A confirmed SQL error before COMMIT rolls back its metadata/index changes. A timeout, disconnect or lost response is an unknown outcome until a read-only catalog/fingerprint check proves baseline, full post-state or unexpected state. Do not blindly replay the bundle.

Before mutation, preserve exact private baseline policy definitions, metadata/ACL fingerprints and safe content fingerprints; after success preserve exact final state and 004 index provenance. Snapshot hashes detect change but are not a full data backup. A short no-write window makes pre/post data comparison meaningful. Provider backups/object-byte recovery must be verified separately before any data restore.

## Separately committed or partial states

The following is reconciliation guidance, not permission to execute arbitrary recovery SQL:

| Observed committed prefix | Metadata state | Safe immediate action |
|---|---|---|
| None | Baseline policies/functions/indexes | Keep candidate disabled; diagnose failed preflight |
|001 only |3 public RPCs+2 guards | Preserve objects; review exact continuation or guarded removal |
|001+002 |11 public RPCs+4 guards | Same; no policy change yet |
|Through 004 | Usable existing or newly created po_id index | Record provenance; do not drop a preexisting/reused index |
|Through 007 |9 policy predicates changed; summary replaced | Compare exact policy/function state before any restoration |
|Through 008 | Customer report preaggregation also installed | Preserve its exact body hash and review continuation |
|Through 009 | Full reviewed candidate | Proceed only to approved post-checks/hosted smoke |
|Any other mix/drift | Unexpected metadata or dependency | Stop; obtain independent review of the actual state |

## Exact guarded rollback package

Prepare rollback from the verified baseline and confirmed post-state, not an inferred migration count. The private rollback guard must require the exact staging target and expected schema/function/policy hashes, then capture current data fingerprints inside its own transaction. It restores only the nine prior predicates from the baseline; removes only the 15 functions that were absent before this release, with dependency-restricting drops; and removes 004's index only if the apply record proves it was created by this rollout and its current definition still matches. Reused/existing indexes remain untouched. No CASCADE drops, schema reconstruction or data changes are allowed.

Verify restored schema/ACL metadata against baseline (accounting only for an explicitly retained new index, if approved), and require identical before/after rollback data fingerprints. Any mismatch aborts rollback. Commit and API schema-cache refresh occur only within the specifically approved recovery scope. The guard must refuse changed functions/policies, new dependencies or altered index provenance; a forward repair may then be safer.

Do not run rollback while a candidate client is serving users without an approved maintenance/disable plan. Removing RPCs makes that client explicitly unavailable. Do not silently route users back to known truncated reports. If user approval covered only apply, ask before the separate hosted rollback action. A data restore, credential/account change or cleanup requires separate authorization and a verified restore point.

## Closeout

Record source SHA/tree, target identity, exact apply/rollback hashes, confirmed committed state, fingerprints, error and user impact privately. Rerun affected correctness/security/provider checks before enabling a compatible client. Performance target misses remain open even when exact read results and access checks pass.
