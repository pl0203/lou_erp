# Database safety candidate: rollout gates

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

## Required deployment order
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
- Check-in/photo upload remains a multi-step storage/database saga; retry can leave an orphan upload or visit without photo metadata, and duplicate visits/timestamp proof need separate hardening
- Sales-head customer creation remains a role/workflow mismatch; no broader customer-write authority was silently granted
- More-than-API-limit reporting pagination and full data reconciliation remain required
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
