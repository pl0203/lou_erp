# Stock Return workspace — database candidate

This candidate requires both disposable PostgreSQL profiles, source/schema attestation and rollout authorization before deployment.
This is deliberately outside `supabase/migrations`. The filename identifies this candidate, not a generated/applied migration. Generate the final migration using the Supabase CLI only after local execution, advisor/security review and separate rollout approval.

## Dependencies and invariants
- Existing CO stages 01–08 plus deployed import/unit candidate `20261026100000_co_import_manifest.sql`.
- Bare historical engine or fully composed catalogue generation one. Fresh writes/read workspace fail closed on unsupported generation; actor-authorized receipt replay/recovery remains available after cutover.
- Additive surfaces only. No original router, helper, immutable revision, source price, sales PIC, or legacy RPC contract is replaced.
- Private actor/request ledger serializes exact requests. Different payload same key conflicts. A network timeout is uncertain; retain the exact request. A `not_found` read is **not** abandonment proof.
- One atomic SQL invocation saves internal draft, allocates current unsold stock FIFO, previews/rejects sales changes, posts through existing public kernel, reads canonical head/revision, and stores receipt. Any exception rolls back everything.
- Rejects changed sales allocation signature, report republication, revenue, PIC credit, or order reopen. Backdating cannot silently rewrite prior sales even if totals match.
- Unit declaration UUID/version/label all pinned. No conversion or inferred default unit. Historical unknown-unit list quantities remain labeled unknown.
- Customer and item page sizes max100; search max200; submit max100 distinct SKUs; payload max256KiB; per-item quantity integer1..2147483647; reason<=1000/reference<=200/notes<=4000.
- This only reduces customer-held consignment stock. It does not update a warehouse inventory module.

## Runtime acceptance
Run the fixed runner in the existing approved disposable PostgreSQL17 environment after freezing reviewed source:

```
node scripts/test-co-return-workspace-db.mjs --case returns --baseline legacy
node scripts/test-co-return-workspace-db.mjs --case returns --baseline current
```

It retains existing `coWorkspaceConnection` and immutable source/server/run marker checks; accepts no arbitrary URL, SQL path or credentials. It builds the existing fixture, installs the candidate transactionally, verifies deliberately failed installation rollback, composes rollback-only SQL behavior fixtures, then launches real authenticated concurrent sessions with observed advisory/customer lock barriers.

Authored cases include multiSKU rollback, late-fault rollback, same-key retries, conflicting payload, canonical recovery, competing operators, overstock/sold/fraction/empty/duplicates, wrong/inactive actors, cross-customer identities, unit/generation/version pins, 105-SKU pagination, unknown units, depleted-customer history filter, differing-batch FIFO/value, differing PICs, same-date/backdated sales invariance, and generation2 recovery/fresh-write denial.

PostgreSQL compile/execution, real lock observations, full composed-suite regression, security/advisor review and deployment approval remain gates. A passing static test never substitutes for them.

## Known date boundary (preserved kernel contract)
The existing return kernel defines its future-date ceiling using UTC, although app display/default timezone is WIB. This additive adapter intentionally retains that UTC eligibility check. During 00:00–06:59 WIB, WIB's current calendar date is ahead of the ledger ceiling. UI must not silently backdate actual returns: leave the date unset and disclose the ledger cutoff if its default would be invalid. Fixing the kernel business-day semantics requires a separately reviewed change, not session-timezone manipulation or date coercion.

## Hosted migration envelope

The standalone reviewed candidate remains byte-identical, including its own transaction.
For a migration runner that owns the transaction, `scripts/co-return-migration-envelope.mjs`
derives SQL by removing only the pinned outer `BEGIN;\n` and final `COMMIT;\n` bytes.
All remaining bytes, including function bodies, are unchanged. It emits a separate
candidate/body SHA256 and removal-offset manifest. Create the final filename via CLI,
then copy the exact tested derived body; do not apply the standalone wrapper via a
runner that could commit before its migration-history bookkeeping.

Both disposable profiles retain standalone late-failure rollback and additionally test
runner-owned transaction success plus late-DDL and synthetic history-insert failure.
They require absent new objects, zero history rows and identical existing schema after
failure, then exact source-bound history plus existing behavior/ACL/race checks after
success. Synthetic history tests do not establish private Management API internals;
hosted deployment still requires exact schema AND actual history readback, with no
blind retry after an uncertain response. No runtime/authorization rules are changed.
