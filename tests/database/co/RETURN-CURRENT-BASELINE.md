# Current Stock Return fixture composition

This is synthetic test schema, not an application migration. The existing minimal baseline remains the default for all other callers. Only the fixed return CI profile can select the current schema adapter. No live rows, connection identifiers or metadata snapshots are included.

## Finite differences represented

- Five initial public table declarations preserve native column positions, UUID defaults, missing timestamps, primary-key naming and foreign-key cascade semantics. The customers shape is already represented by the published legacy customer-category contract. Other fields retain their existing types and constraints. The adapter rejects any changed complete minimal-fixture source before transforming it.
- Original CO stages and current catalogue/HR compositions still execute with their original source checks. No cutover flags are changed.
- The unchanged, SHA-pinned SJ received-date migration supplies ten existing source postimages. The exact two private director helpers are extracted from the already-published director review source; its three public endpoints are not introduced.
- An explicit finite policy composition replaces only fictional users/assignment policies. Existing restrictive actor/customer/procurement policies remain. Thirty-four existing function grants are reproduced individually: twenty-seven service-role EXECUTE grants and seven authenticated EXECUTE grants. This does not grant access to new return endpoints or use default privileges.
- Original import and workspace-read candidates install before the full read-only attestation. The return candidate then undergoes installation rollback, preimage parity, ACL, behavior and concurrency tests.

## Gates

The normalization selector and comparison remain unchanged. Full normalized current-profile metadata must exactly match the separately authorized read-only target attestation before a rollout; these source mappings are not equality proof. Any additional difference is a stop condition, not a reason to exclude an object. Both the legacy return job and all prior jobs remain required. Unit/guard tests cannot establish PostgreSQL compilation or runtime parity.
