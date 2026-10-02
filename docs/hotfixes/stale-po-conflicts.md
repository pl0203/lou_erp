# Stale PO conflicts on PostgREST 14

Supabase documents infinite internal transaction retries when a business rule manually raises SQLSTATE `40001` on PostgREST 14. This is distinct from a genuine database serialization failure. The safe business-conflict response is `PT409`, which PostgREST maps to HTTP 409. Existing looping backends require a separate, carefully targeted stop after the body fix.

Source: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

## Candidate scope

- Additive migration `202610020003_stale_po_conflicts.sql`, preserving applied migration history
- Exactly one complete raise statement changed in `pilot_po_lines_v1` and one in the effective `pilot_order_transaction` body from migration `202610010010`
- Both version checks remain in place; the mutation check still covers edit, delivery save, delivery void and cancellation
- Full catalog function metadata is compared before/after. Grants, ownership, RLS, data, idempotency and all business checks remain unchanged
- Read conflicts preserve their code, receive an actionable message and cannot automatically retry a pinned version, including remount, focus, reconnect or failed manual refresh
- A manual retry first obtains the header, then fetches lines against its version. Route/generation guards cancel obsolete reads and prevent old conflict state leaking into another PO
- Edit conflicts require deliberate reload and inspection. No mutation is automatically retried or resubmitted against the newer version

## Operational procedure

1. Independently verify staging destination. Run `scripts/stale-po-conflict-preflight.sql` read-only and retain the full two-function metadata result
2. Build the exact staging apply, rollback candidate and read-only postcheck with `buildStalePOConflictPacket`. It accepts only the reviewed staging project, the two expected source hashes and exact verified metadata/ACLs
3. Review final packet hashes and test evidence independently. Do not run concurrent DDL on these functions during apply
4. Execute the complete reviewed apply packet. Require an error-free COMMIT and successful read-only postcheck. If either fails, stop and investigate
5. Reverify each logged looping backend immediately before stopping it. Bind PID plus full backend start, role, application name, address/port and the logged RPC query ID. Require patched function hashes first; never stop all authenticator connections
6. Verify the original sessions have exited and that newly observed retry errors/setup rate stop. Signal acceptance alone does not prove backend exit. If a mid-stop identity changes, inspect any prior notices because already sent stop signals cannot be rolled back
7. Do not automatically execute rollback: restoring `40001` reintroduces the incident risk

## Verification boundaries

Local Vitest tests establish frontend behavior, assembly/guard contracts and preservation of ordinary database/transport retry policy. Typecheck and production build are separate checks.

The existing disposable PostgreSQL CI service now applies the exact additive migration, exercises twelve negative metadata/source guard cases and runs `tests/database/stale-po-conflicts.sql`. That SQL checks stale read/no partial result, all four stale mutations/no row or request delta, missing-version protection, valid versions, committed replay and rejected-request reconciliation. Existing concurrent delivery/edit tests retain one-winner/no-overdelivery assertions with `PT409` as the losing business-conflict code.

There is no local PostgreSQL or PostgREST executable in the editing environment. SQL runtime checks must pass in the authorized disposable CI service before staging apply. Provider PostgREST-14 HTTP/retry integration is not established by PostgreSQL-only CI or mocked frontend tests; do not claim it passed. Do not load-test a hosted project to obtain that evidence.
