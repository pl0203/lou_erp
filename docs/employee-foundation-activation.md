# Employee Foundation: prepared activation and data-preserving recovery

**Status: prepared for independent review, not approved for hosted execution.**
These SQL files are outside automatic migration discovery. Preparing, publishing or testing
source does not authorize deployment, database grants, real employee records, account
mappings, invitations, or an HR workplace-timezone choice.

## Separate artifacts and dependencies

The HR installer is not a calendar installer. Keep the reviewed weekly-calendar and
Director-calendar candidates and their recovery artifacts separate. Combined verification
proves the candidates together; it does not create a new multi-feature hosted transaction.

Before any future activation:

1. Confirm the exact reviewed source commit/tree, all file hashes, target database,
   PostgreSQL 17 version, owner and effective role topology. Stop on any mismatch.
2. Confirm the existing security/read and iHR migrations through
   `202610021008_ihr_leave_context.sql`, then the existing PO Director option, using
   the approved dependency inventory. Preserve their historical tests at their original
   checkpoints. Do not reinstall or reset an existing database to obtain test conditions.
3. Keep calendar rollout paused until separately authorized. Its former setup start
   `2026-10-20` is no longer future in Asia/Jakarta from `2026-10-19 17:00 UTC`.
   A revised effective-date decision, fresh preview and separate hosted approval are
   required. Do not reuse the old setup payload.
4. Obtain separate target-specific approval for the HR installation and its narrow
   execution grants. Review backup/recovery, operator access, request admission and
   drain procedures. Real people or account mappings need their own approved cutover.
5. Confirm the HR workplace timezone independently. It starts **unset**. Neither the
   browser timezone nor the calendar's Jakarta context is an HR timezone decision.

The supported future order is existing dependencies, separately approved calendar
activation if still desired, then separately approved HR activation. HR verification does
not authorize either hosted step. Existing employee roles and operational access remain
unchanged; there is no new HR Admin role or CO approval-routing change.

## Exact HR package

Regenerate and compare the fixed artifacts with:

```sh
node scripts/assemble-employee-sql.mjs
```

The assembler accepts no source paths or SQL input and executes no SQL.
`sql/employee-foundation/catalog-manifest.json` binds the three candidate sources and
reviewed semantic topology. `objects.json` lists ten private tables, eight public wrappers,
eight private entrypoint implementations and sixteen private helpers.

- `sql/employee-foundation-activation.sql`: a single `BEGIN`/`COMMIT` installation.
  It refuses an existing complete, partial, colliding or unexpected employee topology.
  It never adopts a pre-existing employee object through `IF NOT EXISTS`. It checks
  exact definitions, ownership, ACLs, empty initial business tables and unset timezone,
  and preserves the unrelated catalog. Re-running it is not a repair strategy.
- `sql/employee-foundation-disable.sql`: an atomic, non-destructive close of the exact
  reviewed public **and private** entrypoint execution surfaces. Helpers and tables
  remain closed. It retains all records, lifetime number claims and links, episodes,
  reporting history, audit events, completed/abandoned operation receipts, settings
  and functions. It preserves unrelated schema usage and grants. It does not revoke
  schema-wide access, drop data, reset accounts or rewrite employment history.
- `sql/employee-foundation-reenable.sql`: a **separate future manual operation**, requiring
  renewed review and explicit approval. It restores only the reviewed narrow HR
  entrypoint EXECUTE grants, not helper/table privileges. It checks retained state and
  unrelated catalog equality. It is never automatically run after disable and conveys
  no permission to enable hosted access.

Do not edit a generated bundle in an SQL editor to bypass a failed check. Diagnose the
actual topology and obtain a newly reviewed artifact. Unexpected topology or privileges
must fail closed rather than be silently normalized. The owner preflight retains immediate
USAGE checks and also refuses direct/indirect application-role membership in postgres,
including NOINHERIT membership that could permit SET ROLE. Each known-topology assertion
checks effective table and column denial, helper denial, and the exact active/disabled
entrypoint execution matrix for PUBLIC, anon, authenticated and service_role. Direct ACL
equality alone is insufficient: inherited predefined data privileges must also fail closed.
For each application principal, the checks cover its current privileges plus all transitively
SET-reachable roles, including NOINHERIT memberships. PUBLIC is checked separately.
Active authenticated entrypoints require their current grants, but switching to a narrower
role is allowed; no reachable role may widen a denied helper, table, column or entrypoint.
No role membership or broad privilege correction is performed automatically.

## Quiescence is separate from ACL revocation

Revoking EXECUTE denies new invocations but does **not** cancel a call already admitted
inside a function. A complete future cutover requires separately verified request
quiescence and drain. Stop new admissions through an approved operational procedure,
identify owned in-flight work, allow legitimate admitted transactions to settle, then
verify no new HR calls and preserve all legitimate pre-drain commits. Do not terminate
shared sessions or add an unreviewed product off-switch.

If drain cannot be verified, report only that the ACL surface is closed to new calls.
Do not claim all writes have stopped. Capture a new retained-state fingerprint after
verified drain; a legitimate earlier commit must not be deleted to recreate an older
fingerprint. Operation recovery resumes only after separately approved re-enablement
and current Director authorization. Same-ID replay must return the original receipt;
an abandoned operation must remain abandoned.

## Synthetic tests are not production cleanup

The test-only `abort-atomic.sql` intentionally raises before COMMIT and proves absence
from a separate connection. `install-atomic.sql` adds an invocation-owned fixture
manifest before the same commit. These are not activation artifacts.

The disposable race runner cleans only its exact invocation token, reviewed function
inventory and recorded fictional user IDs. It checks preservation **before** cleanup,
then restores only the known fixture-trigger scope increment and proves the complete
baseline again. Its destructive disposal is appropriate only for those exact synthetic
objects. Never use it as recovery after real HR data exists. Never run synthetic
full-row fingerprinting against real auth or employee data.
