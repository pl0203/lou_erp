# Pilot readiness and safety gaps

Source baseline: `9fe41d612003376877a92dae1301d25bd6d79eab`.
This patch contains application-level safeguards only; it does not apply live database changes or authorize production deployment. **Not cleared for real-order launch.**

## Implemented and tested locally
- Require an active, identity-matching profile before rendering protected routes
- Discard obsolete profile/session responses; clear/cancel cached private data on account changes or lost authorization
- Keep same-identity background session checks from destroying unsaved forms
- Show failed profile login errors and permit retry
- Require an active executive caller and known target role before invitations
- Reject nonfinite, negative, fractional/nonpositive quantities and invalid prices before order writes; permit legitimate zero prices
- Preserve actual zero delivered sales and propagate statistics query errors; show unavailable data rather than fabricated zero in customer views

All 69 automated tests pass. Automated tests mock Supabase and prohibit network fetches. They do not validate production policies or perform writes against the live project.

## Still blocked on verified database design
- Transactional order + line-item creation, PO approval/linking, edits and delivery-note replacement
- Idempotent retries, unique source-order conversion, concurrent approve/reject and concurrent delivery limits
- Database numeric checks, foreign keys, audit triggers, completion/total calculation and RLS tests
- Safe cancellation/correction versus hard deletion; immutable shipment/accounting history
- Complete pagination/aggregation above API row limits

Do not wire a client to a new RPC until its schema, grants, transaction logic and deployment are independently tested. Existing multi-request write flows still have partial-save failure windows.

## Verification limits
- Vite build passes, with the existing >500 kB bundle warning
- App typecheck passes. The baseline 30 diagnostics were resolved through type-only imports, correct chart prop types, unused-code removal, and tested to-one relation normalization. Generated database types remain a follow-up once the schema is available
- Browser/mobile staging smoke tests have not run
- Deno Edge Function deployment and real JWT/RLS enforcement have not run
- No live database schema was available when this patch was prepared
- Backup/restore, storage-object restoration and rollback rehearsal are unverified

## Required staged pilot scenarios (dummy data only)
1. Sales: log in, visit/check in, submit a normal order and a zero-price promotional item. Reject negative, empty, fractional and nonfinite quantity/price inputs without a header being written
2. Admin: approve the same pending sale from two sessions, concurrently reject/approve, and retry after a lost response. Exactly one business order must exist
3. Admin: fail each write step of create/edit/delivery operations. The entire operation must commit once or preserve the original state
4. Admin: create two concurrent deliveries for the last available units. Total delivered must never exceed ordered; edits must preserve historical quantities if any request fails
5. Sales/admin: draft a form, refresh the auth token/refocus the tab, and confirm draft survives. Switch account/sign out while requests are pending; previous data must never appear
6. Executive: test inactive/missing caller profile and invalid invitation role. Neither may send an invitation. Test a valid active executive with a test email only after authorization
7. Executive: reconcile zero delivery, partial delivery, failed stats reads, and more than 1,000 rows against database totals; unavailable data must be explicit
8. Each role: verify allowed and forbidden direct API operations, not just navigation. Test disabled accounts and role revocation
9. Recovery: rehearse database plus Storage backups, restoration and rollback; designate the person who can stop pilot operations and reconcile orders

## Best-practice basis
- [PostgreSQL transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html): related business writes commit atomically
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default, verify permissions for every operation
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): enforce authorization at the database boundary
- [ERP go-live checklist](https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/prepare-go-live-checklist): validate roles, realistic processes, migration/reconciliation and recovery before rollout
