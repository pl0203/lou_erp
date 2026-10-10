# Foundation command authority race gate

This is a reconstructed execution recipe, not executed evidence. Only the coordinator-owned, reviewed PostgreSQL 17 lifecycle may run it in its fresh synthetic `pilot_test` cluster after verifying the `disposable-pilot-ci` marker and exact input hashes. Do not create a second database framework or contact a hosted backend.

## Stable interface and time/snapshot boundary

- Public signatures remain `leave_transaction_v1(uuid,text,jsonb)` and `leave_reconcile_request_v1(uuid,boolean)`; no caller actor or clock is accepted.
- Both are VOLATILE and require READ COMMITTED. Unsupported isolation raises `55000` / `UNSUPPORTED_COMMAND_ISOLATION` before command locking or writes.
- Per-actor/key lock: `pg_advisory_xact_lock(hashtextextended('ihr-command:' || actor::text || ':' || request_id::text,0))`.
- After waiting, a new query obtains `private.ihr_leave_require_actor()` and one `clock_timestamp()` into `actor, authorized_at`, before any command branch. Existing and new abandoned outcomes cannot bypass that refresh.
- `private.ihr_leave_authorize_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS void` is STABLE. Its actor/non-null-time preamble and all temporal reads share the fresh calling-query snapshot. Later migrations extend only the static CASE, with exact payload keys and independently scoped authority.
- `private.ihr_leave_dispatch_command(p_actor uuid,p_operation text,p_payload jsonb,p_authorized_at timestamptz) RETURNS jsonb` receives the same instant. Production dispatch remains deny-all in this foundation.
- Commands must explicitly pass that instant to `ihr_leave_has_grant(actor,capability,employee,at)`, `ihr_leave_is_approver(actor,employee,at)` and `ihr_leave_can_read_employee(actor,employee,at)`. Their `statement_timestamp()` defaults are reserved for read-only STABLE context/directory calls. Context scope revision and capability publication share one statement snapshot.
- Membership/grant/assignment write triggers are additional stricter boundaries with current server times. Assignment trigger time and active-actor checks occur after its own advisory wait. No caller-settable GUC supplies authority.
- Later handlers must refresh actor/time/current authority after every further authorization-relevant blocking wait. Preserve command → global setup when needed → sorted assignment → scope revision → sorted occupancy → fixed request/account → ledger/audit order. Never take occupancy after account locks or introduce inverse user/scope locking. These command envelopes acquire no user/scope row lock.

## Minimal independent-session recipe

Use fictional actors from `seed.sql`; holder/waiter must actually execute as `authenticated`, with their synthetic JWT subject and verified `rolsuper=false, rolbypassrls=false`. Owner may orchestrate fixture setup, inspect locks and perform the synthetic revocation. Use the Task 1 SECURITY INVOKER assertion helpers for protected-call assertions.

1. Prepare the exact fixture and migration in the already-approved fresh lifecycle. For supported-operation tests only, install the rollback/disposable-only `fixture_probe` authorizer/dispatcher from `foundation.sql`; keep the four-argument STABLE authorizer and explicit time propagation. Restore the production deny-all definitions before closing the fixture. No probe operation enters migrations.
2. Holder starts a transaction, takes the exact command advisory key and reports readiness only after it holds the lock. Waiter begins the protected RPC. Owner confirms the identified waiter PID is actually waiting on that advisory lock using `pg_stat_activity`/`pg_locks` before changing authority. A fixed sleep alone is not proof of contention.
3. Make one change below, COMMIT it, then release the holder. For deadline tests use a database-derived explicit upcoming deadline, prove the waiter statement began before it, and release only after the database clock crosses it. If the start missed the deadline, reset the fixture instead of calling that a race.
4. Require SQLSTATE `42501` and the specified machine code, no returned private/minimal result, and no new command or side effect. Existing command rows must stay unchanged. Inspect those rows as the owner, not as permission evidence. Bound waits using the lifecycle's existing timeouts.

| Case | Waiting call/state | Change before release | Required result |
|---|---|---|---|
| Actor A inactive | Reconcile true; no command row | Deactivate actor and commit | ACTIVE_ACTOR_REQUIRED; no new tombstone |
| Actor A inactive | Existing abandoned row; reconcile false and true variants | Deactivate actor and commit | ACTIVE_ACTOR_REQUIRED; no abandoned result disclosure |
| HR A inactive | New fixture_probe, same-key replay, committed reconcile false/true variants | Deactivate actor and commit | ACTIVE_ACTOR_REQUIRED; no writes/result disclosure |
| HR grant deadline | Same supported-operation variants | Cross explicit configure-grant effective_until | ACCESS_DENIED; no writes/result disclosure |
| HR grant revoked | Same supported-operation variants | Revoke/delete grant and commit | ACCESS_DENIED using fresh row visibility |
| Director assignment deadline/revocation | Static disposable-only approval probe using is_approver(directorA,managerA,p_authorized_at) | Cross deadline or revoke mapping and commit | ACCESS_DENIED; no writes/result disclosure |

Retain positive controls: unchanged authority succeeds; same input replays original result; changed input yields 55000; actor keys stay separate; abandonment fences later execution and cannot overwrite commits. Verify deactivation commits while the waiting command holds no user/scope row lock. Extend to the assignment-trigger wait and later domain waits when those supported handlers exist.

The single-session `foundation.sql` also asserts REPEATABLE READ/SERIALIZABLE command refusal and retained consistent read-only context. It ends with `IHR_FOUNDATION_PERMISSIONS_AND_COMMAND_ENVELOPE_PASSED` only after every assertion and rollback. Source-contract tests do not substitute for this runtime/race gate.
