# Database rollout gates

## Current read-scale candidate as of 1 October 2026

**Production is not approved.** Follow [the populated-staging packet](scalability-staging-packet.md), [verification record](scalability-verification.md), and [rollback boundary](scalability-rollback.md) for the additive read migrations. Staging already contains users and business records. Do not run an empty-project bootstrap, synthetic fixture, reset, or cleanup against that project.

The exact ordered scalability allowlist is 202610010001, 002, 004, 007, 008, 009, with full names/hashes in the staging packet. It adds 11 public invoker RPCs/four private guards, conditionally adds one nonunique lookup index, changes nine proven-equivalent policy predicates and replaces three newly added read-function bodies. Existing transaction functions, authorization helpers, triggers, business data and table/column grants remain unchanged. Rejected 005/006 experiments are outside deployable migrations.

Current code `2158b792` / tree `3fb406ec` passed 494 app tests, normal real-role security/SQL suites and 12 races in run 36877297581. Final 30k run 36877297640 passed exact seven-role totals and all 242 pooled successes/33 denials with rollback. Future-scale latency remains unaccepted: observed customer stats reached 22.942 s. Actual hosted JWT/API/UI and separate production approval are still required. See the current verification record for precise limits.

## Historical transaction candidate notes

The notes below describe the earlier transaction/security rollout. Their empty-project bootstrap and single-user-only limitations are historical, not instructions to repeat setup or a description of the latest normal-session CI evidence. Existing write, evidence-preservation and hosted-validation safeguards still apply.

This branch is a coordinated database + client change. It is not approved for production deployment. Existing application-only preview work remains separate; automatic previews for this database branch are held until staging configuration is verified.

## Included
- Active-profile and own/team data boundaries, private profile/directory RPCs, scoped visit-object policies
- Atomic sales submit, manual PO create, approve/reject, versioned PO edits, delivery create/update/void and undelivered PO cancellation
- Server-derived actor and totals, per-line delivery limits, pending-only review decisions, immutable delivered product/price history
- Actor/request idempotency with canonical payload comparison; unknown outcomes survive reload through request UUID + payload hash only
- Safe request reconciliation: a completed result follows the form's normal success flow; an uncommitted request receives a terminal tombstone before a new attempt is permitted
- Delivery void retains evidence and reason. Active-delivery calculations exclude voids; detail history remains visible. PO cancellation updates linked approved sales orders to cancelled, excluding them from approved-sales metrics
- Transaction-owned tables reject direct browser mutation. The new client has no unsafe raw-write fallback

## Current verification
- Local PostgreSQL 17 compiles the observed-contract fixture and all candidate migrations; explicit RPC/trigger/rollback tests pass
- A separate sanitized synthetic fixture compiles with all candidate migrations
- Local standalone PostgreSQL bypasses RLS and cannot open the server socket. It does NOT establish actual RLS or concurrent correctness
- The approved GitHub Actions workflow uses an official PostgreSQL 17 service, synthetic data, read-only repository permissions, and no production credentials. Real role and concurrency suites must pass there
- Hosted Auth/PostgREST/Storage upload and signed-URL behavior still require the isolated staging project
- Dependency audit after in-range fixes: no production vulnerabilities; two moderate development-only Vitest/mocker findings remain, requiring a separate major upgrade. Do not expose the test development server or run untrusted projects through it

## Historical fresh-project deployment order (do not repeat on populated staging)
1. Review SQL, client diff, synthetic tests and fresh CI results. Keep private observed snapshots outside the public repository
2. Apply the reviewed fresh-project bootstrap only to isolated staging. Its preflight must reject any existing business tables; preserve provider auth/storage schemas
3. Exercise all roles through actual Auth JWTs and PostgREST, and test Storage upload → visit → photo metadata → signed URL. Use dummy users/data only
4. Test lost HTTP responses, same-key retry, reload/recovery, delayed request versus tombstone, two reviewers and two delivery edits. Verify no duplicate business records and no overwritten history
5. Reconcile existing production anomalies before migration: partial orders, invalid prices/quantities, duplicate conversions, unmatched deliveries, legacy status rows and ownerless/unlinked images. Do not auto-delete or reassign them
6. Verify backup AND restore of database plus object bytes. Obtain separate approval for production schema changes and matching client release. Pause old-client writes during cutover
7. Deploy compatible backend and client together; verify target environment before lifting the preview hold. Never point this branch's preview at production during testing

## Recovery / rollback boundary
A failed migration transaction rolls back. After successful rollout and real writes, do not drop request history, void metadata, or audit records to revert the schema. Stop writes and use a reviewed forward repair or validated restore/reconciliation plan. Do not restore old direct-write grants as an automatic fallback. Retain request/tombstone records while delayed clients could replay them.

## Remaining explicit gates
- Check-in now finalizes visit, photo, completion and customer date atomically with server timestamps; private unreadable orphan uploads remain possible and require a separately reviewed retention/cleanup process. Hosted Storage bytes and signed-URL tests remain required.
- Sales-head customer creation remains a role/workflow mismatch; no broader customer-write authority was silently granted
- More-than-API-limit reporting is now covered by source/SQL/6k/30k checks; hosted API parity and full data reconciliation remain required
- Synthetic provider stubs are not production schemas; real hosted integration is still mandatory

## Database-branch preview build guard
`npm run build` checks the process environment before Vite loads `.env` when
`VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=fix/pilot-database`. Configure these
[documented Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables)
and keep automatic exposure enabled. The targeted build requires an explicit
HTTPS URL for the approved staging project and a publishable client key or a
legacy `anon` JWT with the matching project reference. Secret/service-role,
malformed, missing and mismatched configuration fails without printing keys.
Publishable-key format checking cannot prove which project issued the key;
actual staging Auth/API tests must establish that. The legacy JWT is decoded
for role/reference checking, not cryptographically authenticated by the build.
Other branches, production and ordinary local/CI builds retain existing behavior.
The Vercel branch deployment hold remains until staging overrides are verified;
this guard does not authorize deployment or replace target verification.


## Atomic check-in rollout (migration 4)
Deploy migration 4 and its RPC-only client together after isolated tests. Preflight
refuses duplicate schedule visits, multiple photos per visit, reused photo paths,
and incomplete legacy evidence. Reconcile these manually before production;
never delete or invent historical proof to make migration succeed.

The finalize RPC locks the schedule, validates the active assigned actor/customer
and exact owned uploaded object, then saves visit/photo and completion in one
transaction. Visit/photo timestamps come from the database, rather than the
browser. Completed schedule identity and date are immutable. Direct visit/photo
inserts and unproven completed statuses are blocked. Uploads are permitted only
before completion. Missing or ambiguous upload responses must pass authoritative
finalization checks before success is reported.

Retries use stable upload UUIDs and photo hashes, plus the shared request ledger
and terminal recovery tombstones. Client recovery metadata contains no photo
bytes, coordinates or customer data. A reload can reconcile the prior request
without restoring the photograph; a cancelled request may leave an unreadable
orphan object. Proof timestamps mean server receipt, not verified capture time
or physical presence. Hosted JWT/Storage integration and real device camera/GPS
acceptance remain required; the SQL tests simulate claims and object metadata.
