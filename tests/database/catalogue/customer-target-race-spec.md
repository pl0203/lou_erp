# Raw customer target candidate: fictional proof contract

Status: source checks only. SQL and exported barrier cases are AUTHORED / UNRUN.
This is not an installable activation package. Do not derive readiness from it.

Use only an separately approved disposable synthetic PostgreSQL harness. Load
reviewed fixture/migrations/foundation, then the candidate. Record exact source
hashes, PostgreSQL version and isolation. No hosted data/configuration is input.
The lifecycle SQL owns no transaction and must be wrapped in rollback. It adds a
fictional CASCADE variant, not a claim about a selected remote database.
The race module creates no sessions: an authorized runner must supply distinct
connections plus fresh, committed fictional customers and an active executive.
Run cases in separate disposable fixture namespaces/databases, clean up through
the harness, and verify rollback/terminal session state. Observer is fixture owner.

## Authored executable cases

- Actual-row lifecycle: unchanged existing target, discarded supplied-ID conflict,
  actual conflict UPDATE retaining OLD+NEW, deletion, savepoint rollback, fictional
  cascade+tombstone, executive raw insert/delete, immutable binding and setter
  refusal, deferred assertion flush, readiness false, no unused allocation.
- Reversed raw statements: both actual completed writes acknowledged, observer
  verifies granted advisory locks and no blockers; second writer's reverse key
  fails specifically with CATALOG_IDENTITY_BUSY (timeout is not a pass), rollback;
  survivor completes, flushes assertions and commits exactly two targets/two used
  identities. This is a two-key evidence test, not a universal master graph proof.
- Relation maintenance: observer verifies granted ACCESS EXCLUSIVE evidence lock;
  competing actual target insert must NOWAIT-refuse, not time out, and leave zero
  target rows. Holder then rolls back.

## Required unimplemented runtime gates (must stay unavailable)

1. All roles/active state/scope/visibility fields: exact pre/post role-switched
   matrix including sales_head, executive, denied roles, inactive/missing actor,
   supplied IDs, numeric NULL variants, immutable month/timestamps and multirow
   duplicates. Compare permitted outcomes to the same fixture without candidate.
2. Missing identity must fail with no repair; forced immediate assertions without
   valid used proof must fail without taking locks/writing; insert-then-delete,
   savepoint acquired-lock release and retained prior evidence all verified.
3. Target-versus-guarded-delete, insert/update/delete, both winners at READ COMMITTED
   and REPEATABLE READ. Guarded delete implementation does not yet exist here.
   Require real final parent lock/current-link check/evidence reread; never use a
   fake delete wrapper to label this application gate passed.
4. Every final writer entrypoint, identity creation/recreation/uniqueness conflicts,
   same typed reservation, exact relation lock modes, maintenance drain and abort.
   No private table UPSERT repairs, no absent-row reservation by row lock alone.
5. Actual import packet master creates and multiple PO/delivery commands, role
   switching/forced constraints, replay, contention and atomic rollback. No change
   to frozen packet pins or execution of an import is authorized by this test.
6. Actual business-held/evidence-held reverse cycle with pg_locks barriers; early
   request/state/replay remain untouched. Reproduce or explicitly bound the wider
   master/FK cycle: T target(C1), D delete(C2) then waits for C1, T raw update(C2).
   NOWAIT evidence alone does not remove this master/FK cycle. Ordinary deadlock
   errors roll back the transaction; uncertain transport remains unknown outcome.
7. Complete install/cutover lock graph and trusted full-inventory scan. Existing
   unmodified historical target identities remain unknown; no retroactive unused.

No claim of complete target parity, complete reference tracking, universal
transaction deadlock freedom, fresh-unused creation or guarded deletion readiness.
