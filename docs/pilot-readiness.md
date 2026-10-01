# Pilot readiness

## Current decision as of 1 October 2026

**Not cleared for real-order launch.** The read-scale implementation is being integrated; correctness/RLS SQL suites passed on the SQL checkpoint, while final combined verification, 6,000/30,000-PO measurement and hosted role/browser acceptance remain open. See [the current evidence matrix](scalability-verification.md).

Demo target: Monday 5 October at approximately 10:00 WIB (03:00 UTC). The user plans to create real administrator accounts during the demo; those administrators will enter orders. Before real use, verify account invitation delivery, authentication, active profile creation, administrator role assignment, permitted/denied actions and the actual deployed invitation Edge Function. Source hardening alone does not establish that deployment or the invitation journey works.

A historical spreadsheet import is a separate pending workflow. Obtain the workbook and selected population, then review field mapping, duplicates, dates/statuses, partial deliveries and exact reconciliation in an isolated dry run. Do not treat the scalability fixtures as import data or load business records before specific approval.

Launch blockers are: final combined CI/review; safe additive staging apply and hosted RPC checks; actual-role order/edit/partial-delivery/correction/cancellation and account-switch UAT; invitation/admin setup; actual device camera/GPS and Storage recovery; measured scale results with any justified index review; restorable backups and separate production approval. Optional expiry notifications and new action lists are deferred.

## Historical transaction candidate checkpoint

The earlier counts and single-user test notes below are retained as historical evidence. They are superseded by the current verification matrix for the read-scale candidate. The existing security, transaction, Storage and restore acceptance scenarios remain required.

**Not cleared for real-order launch.** This branch pairs database migrations with matching application changes. Do not deploy its frontend against an unmigrated database. The earlier application-only draft remains a separate review step.

## Implemented in this candidate
- Fail-closed, active-profile authentication and account-isolated caches; preserve unfinished forms during token refresh
- Scoped salesperson/team/head/executive visibility, protected privilege fields, private profile/directory APIs, and scoped visit-photo Storage policies
- Atomic order creation, approval/rejection, PO corrections and delivery changes through authenticated database functions
- Actor-scoped idempotency and durable request recovery, including reconciliation of unknown outcomes and protection against delayed retries
- Per-item delivery limits and completion, optimistic edit checks, preserved delivery-void history and restricted cancellation
- Validated quantities/prices, legitimate zero-price handling, promotional price checks, and explicit unavailable reporting
- Corrected relation handling/types, regression tests and non-breaking dependency security updates

## Verification so far
- 82 application tests passed at the reviewed checkpoint; typecheck and production build passed
- Production dependency audit: zero findings at that checkpoint; two moderate development-only Vitest/mocker findings require a major upgrade
- Real PostgreSQL single-user SQL compilation, explicit guard/helper checks, rollback, serial idempotency and delivery invariants passed
- Independent code review completed; a second reviewer checked the separate-session concurrency harness
- GitHub Actions is prepared with synthetic data, a temporary PostgreSQL service and no production credentials; its actual run must be checked separately

Single-user PostgreSQL bypasses RLS even after SET ROLE. It cannot validate genuine row-level authorization or concurrent sessions. Tests intentionally guard against a false RLS pass. The large Vite bundle warning remains.

## Remaining release gates
1. Pass normal-session RLS and independent-session race tests in isolated CI
2. Apply the reviewed, transaction-wrapped setup only to the new empty staging project; verify actual hosted policies, Auth/JWT, PostgREST and Storage behavior
3. Configure the staging frontend exclusively for that test project before enabling its preview or entering dummy orders
4. Test login and the complete manager → salesperson → admin → partial/final delivery → director journey using the actual role permissions and phones
5. Test check-in/photo interrupted-upload recovery; this multi-step workflow is not certified atomic by the order transaction work
6. Review existing-data compatibility, including legacy ownerless photos, delivery history, API row limits and historical records; do not silently alter production data
7. Establish a restorable production backup, Storage-file backup, rollback procedure, named support owner and daily pilot reconciliation
8. Obtain separate approval for production migrations, security changes, Edge Function deployment and application release

Existing signed photo URLs may remain usable for their validity/cache period. Scope changes do not recall copies already obtained. Hosted signed-link behavior still needs verification.

## Pilot acceptance scenarios
- Legitimate and denied actions for each role, inactive/missing profiles, cross-team IDs and privilege edits
- Simultaneous approval, approval versus rejection, two edits, last-unit deliveries, repeat requests and reconcile versus late-arriving requests
- Interrupted saves leave no partial order; failed delivery edits retain original quantities
- Zero-price permitted items, invalid numbers, missing relations, query errors and reconciliation of ordered versus delivered values
- Account changes and token refresh during an unfinished form
- Upload and read own/team photos while denying unrelated folders and inactive identities
- Restore database and Storage into an isolated environment and reconcile sample counts, totals and links

## Primary guidance
- [PostgreSQL transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html)
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [ERP go-live checklist](https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/prepare-go-live-checklist)
