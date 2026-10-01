# Read-scale recovery boundary

This packet preserves business records and the existing secure write path. An additive read release must not be recovered by deleting data, resetting the project, restoring broad table grants, or re-enabling capped raw-report queries.

## Before an apply

Keep a private snapshot of existing function definitions/ACLs, policies, triggers, grants, indexes and business/identity/Storage fingerprints. Verify the exact staging destination and migration hashes. Establish a supported backup/restore route and a short no-write window. The exact approval identifies the target and additive functions; it does not authorize destructive rollback or production changes.

## Failure cases

| Failure | Safe immediate action | Required next evidence |
|---|---|---|
| Target, baseline, hash or schema drift | Stop before mutation; keep the client disabled | Reconcile current project and obtain review of the changed packet |
| Error inside a migration transaction | Confirm rollback and exact function inventory; preserve error details privately | Determine whether that file committed; never infer from a timeout or lost response |
| First file committed, second did not | Leave additive functions in place and client disabled | Compare signatures/ACLs/hashes, diagnose second-file failure, review an exact continuation |
| Unknown apply outcome | Query migration/function state through the authorized read-only surface | Do not blindly replay `CREATE FUNCTION`, drop objects or switch to replacement definitions |
| New client cannot use RPC or fails strict decoding | Stop enabling the candidate and show explicit temporary read failure | Compare hosted protocol, grants/schema cache and source hashes; preserve write transactions |
| Incorrect aggregate or visibility | Disable the affected read surface using an approved maintenance action; retain records and evidence | Reproduce under the same role and fixture, review a forward fix and rerun correctness/security checks |
| Performance misses targets | Keep the candidate gated; inspect plans, selectivity, payloads and actual index overlap | Reviewed minimal tuning with exact totals and write-cost regressions |
| Post-apply business fingerprint mismatch | Stop client enablement and preserve both snapshots | Reconcile concurrent writes or unexpected changes; no automated deletion or rewind |

A previous compatible client may be retained during backend-first testing only if it does not depend on partially installed functions. After enabling read-scale, do not revert users to known truncated reports as a silent fallback. Use an explicit unavailable state or a separately reviewed compatible release. Revoking function execution, dropping objects or restoring a backup can affect active consumers and requires its own reviewed, authorized action.

The two read migrations do not change write transactions, request UUID handling, tombstones, delivery voids or audits. Never drop those histories, disable RLS, relax grants or mutate ownership to make rollback easier. A data restore is a last-resort separately approved operation with a verified recovery point and reconciliation of all writes and Storage objects since that point.

## Close the incident before retry

Record the actual source tree, target, committed objects, preserved fingerprints, user impact and proposed fix. Re-run the affected unit/SQL/real-role checks and full combined checks where interfaces changed. Obtain the required target-specific authorization before the next state-changing step. Resume the client only after the migration inventory, exact results, access boundaries and hosted behavior are verified.
