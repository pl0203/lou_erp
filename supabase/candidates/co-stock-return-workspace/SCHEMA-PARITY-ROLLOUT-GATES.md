# Return workspace schema parity / rollout gates

This document defines verification gates, not deployment authorization. Publication and hosted execution require explicit approval and exact reviewed artifact identity.

## Two new disposable CI cases

Keep all prior nine jobs unchanged. Add `stock-return-sql` with matrix baseline `[legacy,current]`, each invoking:

```
node scripts/test-co-return-workspace-db.mjs --case returns --baseline "$FIXED_BASELINE"
```

The precise new profile is `github-co-return-workspace-v1`, workflow `CO workspace runtime`, job `stock-return-sql`. It still requires repository `pl0203/lou_erp`, clean exact checked-out SHA/tree, actual GitHub run identifiers, loopback PostgreSQL17 service on5432, fixed synthetic credentials/marker, no ambient URL/password override, and immutable server/source/run identity checked independently in race children. Existing workspace-sql and pilot-safety profiles are unchanged. No wildcard job identity or unsafe runner flag exists.

## Installation evidence

1. Compose existing stages01–08 through unchanged guarded runner; for current profile add the exact catalogue/HR generation-one baseline.
2. Install reviewed import/unit dependency candidate in disposable fixture.
3. Capture `return-workspace-parity.sql`: existing public/private function source and metadata; relation owner/ACL/RLS; columns/defaults; constraints; indexes; policies; triggers. Exclude only this candidate's exact new schema-qualified objects and generated FK trigger dependencies.
4. Inject a late candidate exception. Verify rollback leaves endpoint/table absent and exact previous schema snapshot unchanged.
5. Install candidate normally. Assert exact existing snapshot equality. Check all six new RPC owner/security-definer/search-path/ACL properties, no anonymous/service-role execute, only authenticated execute; private ledger RLS enabled and no API table grants/policies.
6. Execute behavior, replay, failure and real observed concurrent-lock tests on BOTH profiles. Require all emitted case markers. Bind all code and receipts to the same source SHA.

Expected markers include `CO_RETURN_WORKSPACE_INSTALL_PARITY_PASSED`, `CO_RETURN_WORKSPACE_ACL_PASSED`, all behavior markers and `CO_RETURN_WORKSPACE_REAL_RACES_PASSED`. Static source tests do not satisfy these runtime gates.

## Before any later hosted apply

- Obtain explicit release-owner approval bound to reviewed candidate SHA and target project; never infer authorization from CI green.
- Read-only live schema comparison must identify exact helper/router source+metadata and unit declarations/ACL/RLS expected from the tested current fixture. Whole-database schema snapshots contain local OIDs and cannot be compared byte-for-byte across servers; normalize OIDs to schema-qualified identities, owner/role names, definitions and dependency identities. Do not accept a loose names-only comparison.
- Verify catalogue execution generation is1, full catalogue profile, HR actor authorities, public router semantics, import/unit dependency and current deployed history. Unknown drift means STOP; do not replace helper bodies or weaken policy/actor checks to obtain a match.
- Candidate preflight performs presence/authority checks, not full source-equivalence attestation. An additional reviewed source preimage gate or externally bound schema attestation is mandatory before applying to a live target.
- Ensure none of the candidate objects already exist; partial/uncertain earlier apply must be investigated, never replaced via `CREATE OR REPLACE` or drop/recreate.
- Generate final migration using CLI after verification; record source SHA, candidate SHA, exact live schema attestation, authorization and post-apply readback. Single transaction must remain intact. No resets or destructive data migration.
- Post-apply verify definitions/ACLs, canonical readback and permission boundaries using approved synthetic-only activity, not real sales data. Never alter UTC ledger cutoff in this additive rollout; WIB-edge UI disclosure remains required.

Actual PostgreSQL execution and hosted schema attestation require source-bound runtime receipts; static inspection is insufficient.

## Executable cross-server attestation

`tests/database/co/return-workspace-preflight.sql` is an explicit `BEGIN READ ONLY` transaction. It validates the bare or full generation-one/tracking-disabled profile; rejects partial catalogue, missing kernel/unit dependencies, and any partial/already-present new return candidate. It never calls the locking generation guard or reads customer/business rows.

The output normalizes function identities/types, source SHA256 (not bodies), owner/security/search path/config/ACL; relevant table columns/default expressions/column ACL, RLS/table ACL, constraints, indexes, policies, trigger definitions, and view hashes. Roles and objects are named, never emitted as local OIDs. Defaults are hashed from deparsed function arguments rather than raw PostgreSQL internal expression trees. The attestation includes PostgreSQL major version and reviewed catalogue profile.

CI emits `CO_RETURN_WORKSPACE_PREFLIGHT` followed by JSON binding the deterministic attestation and its digest to source commit/tree, candidate SHA256 and preflight-SQL SHA256, before executing the candidate. The release owner may later execute this exact SQL read-only against the explicitly authorized target and compare the normalized document/digest to the **current** CI profile bound to the final tested SHA. A mismatch is a stop condition, not permission to overwrite definitions. The script contains no apply path. Its PostgreSQL execution must itself pass before relying on the attestation.
