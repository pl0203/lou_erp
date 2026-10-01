# Read-scale staging packet

Status: prepared for review, not permission to execute. It covers only the two additive read migrations and their compatible client. No fixtures, imports, account changes, index changes, production writes or deployments are authorized by this document.

## Decision and targets

- Permitted staging reference after fresh verification: `mqfpupsuthghubkeiuey` (`https://mqfpupsuthghubkeiuey.supabase.co`). Confirm the live project identity in the authorized management surface and independently match the connection/API destination.
- Production reference `mmfpogpsxibvmhptofww` is hard-denied for this packet. Reject unknown, missing, aliased or mismatched destinations. A local database name or connection label alone does not prove project identity.
- Existing staging is populated. Last reported 1 October checkpoint: 6 profiles, 4 customers, 4 assignments, 4 schedules, 5 POs, 0 Storage objects, 9 ledger records. These are historical observations, not an executable precondition. Users may have changed them.
- Browser transport last recheck was blocked at 06:35 UTC on 1 October. Reverify before scheduling hosted acceptance; do not infer it is permanently unavailable or claim UI acceptance from local tests.

## Exact candidate allowlist

| Migration | SHA-256 | Expected additions |
|---|---|---|
| `202610010001_scalable_order_reads.sql` | `071ea9280adf79b6ba5c0eb405e7b66706332f2ce2e183a9983a312a025614da` | 3 public read RPCs, 2 private guards, scoped function execution ACLs |
| `202610010002_scalable_report_reads.sql` | `8a7ee2a24e942f1c0d82d48b3d122ad88b25d48a090a88cc35f194d3882f03e4` | 8 public report RPCs, 2 private guards, scoped function execution ACLs |

Files are individually transaction wrapped and use `CREATE FUNCTION`, not a replacement of existing transaction functions. All 15 functions are invoker/STABLE with an empty search path and qualified references. Public/anon execution is revoked and authenticated execution is scoped explicitly. No business table, policy, trigger, existing write grant or data modification belongs in this allowlist. No index migration is currently approved. Recompute hashes from the final reviewed commit; any difference stops this packet until reviewed.

SQL checkpoint: `63b1c199611520658fbd77a3e0f1005e7c0e78a8`, tree `dee3e1a742b303938e32e056116b5049a24dedab`, CI `36832401749` passed. Final combined client SHA and its CI/review are pending and must be recorded before client enablement.

## Preflight before asking for the exact apply approval

1. Identify the actual connected staging project and hard-deny production/unknown targets before any mutation. Verify current environment, schema version and the four existing transaction/security migrations. Do not rerun those migrations or an empty-project bootstrap merely because they are present in the repository.
2. Capture a fresh private, timestamped baseline of tables, columns/types, enum values, RLS policies and enabled flags, trigger definitions, function definitions/ACLs, table/column grants and index inventory. Compare with reviewed required contracts. An unexpected definition, prior partial read migration or existing function-name collision stops the process for review; do not use `CREATE OR REPLACE`, broad grants or a forced reset to bypass it.
3. Preserve current business and identity state. Record counts and deterministic content fingerprints for every affected business table, profiles, assignments, schedules, visits/photos, targets/promotions, audit history, private request ledger, Auth identities and Storage metadata. Keep snapshots and any personal data private; do not publish raw rows, keys or session tokens in repository/CI logs. Record Storage object count and bytes separately where accessible. A count alone cannot establish unchanged content.
4. Compare the fresh baseline with the historical checkpoint. Unexpected rows or schema drift are a stop for reconciliation, not data to delete. Agree on a short no-write staging maintenance window, capture a final baseline immediately before apply, and stop if it changes during that window.
5. Verify backup/restore readiness appropriate to this staging project and preserve prior function/ACL snapshots. Keep the exact migration hashes, final branch SHA, expected additions, destination and recovery plan with the approval request. No destructive cleanup is part of the request.
6. Obtain the required exact staging schema/ACL apply approval. Existing code/plan approval alone is not that approval. The operator must have authorized access; missing permission or denied access stops the dependent action.

## Apply and immediately verify after approval

1. Recheck target, hashes, baseline and function absence. Apply only the two allowlisted files, in numeric order, using stop-on-error handling. Set a reviewed session lock timeout of 5 seconds and statement timeout of 60 seconds; a timeout stops for diagnosis rather than an automatic higher timeout or broad retry.
2. Each file commits independently. If the first commits and the second fails, keep the client disabled and record exactly which functions exist. Do not blindly rerun both files or drop the first set; follow [rollback](scalability-rollback.md).
3. Check migration completion and schema-cache visibility through the supported provider path. Query signatures, invoker/STABLE flags, search paths and ACLs against the expected 15-function allowlist. Compare every pre-existing policy, function, trigger, grant and index with the saved baseline.
4. Reconcile pre/post business counts and content fingerprints in the no-write window, including audit/ledger/Auth/Storage. The expected data delta is zero. Any unexplained change stops client enablement, preserves evidence and requires review. Do not repair by deleting records.
5. Test the 11 RPCs through actual authenticated PostgREST roles: legitimate own/team/head/executive/admin cohorts, nullable hidden relations, inactive/missing/unauthenticated denial, invalid inputs, cross-team narrowing and exact result/count parity. Record role identities privately without credentials. Check that no broader existing table grant was added.
6. Enable only an explicitly reviewed staging client preview whose environment points to the same staging reference. Apply migrations before that client; an unmigrated backend must show explicit failure. Never enable a raw capped-query fallback. Recheck the branch deployment hold and build target guard: the existing guard is branch-specific and does not automatically protect an arbitrary new integration branch.
7. Run hosted literal catalog-search punctuation cases; complete report/detail comparisons; page/filter/retry/Back/Forward; token refresh/account switch; PO create/edit/cancel; approval; partial/final delivery and correction; and mobile layouts. Separately verify invitation/admin setup and camera/GPS/Storage workflows before launch. Record passed, failed and unrun checks distinctly.

## Separate disposable scale validation

The generated 6k/30k fixtures belong only in a fresh loopback PostgreSQL `pilot_test` CI environment with the explicit disposable marker and permit. They must never be loaded into the populated staging project above. Generation defaults to manifest-only; emission/loading and the real target are independently guarded. No production snapshot or real credentials are used.

Draft growth population: 500 POs/month over 12 or 60 months ending September 2026, 101 customers, two salespeople/two managers, ten lines per PO, two delivery headers and twenty delivery lines per PO. Partial deliveries retain nonzero outstanding amounts. Seven edge POs are counted separately. Linked sales lines, audit events and request-ledger growth are included. The SQL owner's reviewed final manifest is authoritative for exact dimensions and decimal totals. Record generated bytes and actual loaded/database bytes; estimates excluding indexes/WAL are not storage capacity results.

After manifest/guard review and the appropriate disposable-run authorization, analyze fixtures and gather normal-role plans before expensive repeated runs. No hosted scale load is approved by this packet. Any later hosted scale test needs a separately identified empty target, fixture size/bytes, timeouts, cleanup and explicit approval. Never disable triggers or constraints on populated staging or production.

## Measurement acceptance

Correctness and authorization require zero unexplained failures. Record SQL execution separately from API latency and client-perceived loading. Named cases include first/middle/final pages, broad/exact/no-match search, reports and detail state. Use the same fixture, role, tier/region and device/network profile for baseline/candidate comparisons, 10 warmups and at least 100 measured requests per named API case; report cold runs separately and concurrency at 1, 5 and 10 synthetic users. Save errors, sample counts, bytes, request counts and SQL buffers. Proposed API p95 goals remain <1 second for list/search and <2 seconds for summaries; they are not measured guarantees.

Review actual index inventory and nested query plans before proposing an index. Exact counts and business metrics must remain exact. A missed target requires diagnosis and review, not a capacity claim. API/browser and concurrent-session evidence cannot be inferred from local `EXPLAIN` or one timing.
