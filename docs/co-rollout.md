# CO candidate: review and rollout contract

This is an offline release preparation tool, not an apply command. No deployment,
account, role assignment, HR setup, opening balance, data cleanup, or hosted fixture
is included. The application, database, Storage and Edge changes need separate
exact action-time review. Local compilation and synthetic tests do not establish
provider/runtime or remote CI success.

## Immutable input and target

Run `node scripts/build-co-rollout.mjs EXACT_COMMIT SNAPSHOT METADATA NEW_OUTPUT_DIR`
only on a clean checkout whose actual HEAD equals the 40-character candidate.
The tool reads immutable Git objects, verifies working bytes, pins Git tree/blob
and SHA-256 values, and refuses an existing output directory. The manifest hashes
a source descriptor and the generated files; it does not pin itself circularly.
It has no network, database connection, credentials, or apply path. No generic
`db push` is appropriate for this release.

The sole proposed target is staging `mqfpupsuthghubkeiuey`. The controller must
verify that exact connector project. SQL cannot attest the connector's identity.
The frozen full database receipt is timestamped `2026-10-10T01:18:23.717736Z`, PG
`170011`, repeatable-read/read-only, SHA-256
`8a194cf3f041853dd7fa2e6ca957a8a641b2cd93b95a8a056357424240ffa87e`.
The distinct branch/migration/Edge metadata receipt is SHA-256
`f340355e8291c1a7f6bcad18838062e8f7138ff384dd5532d95d0b148b46e173`.
It identifies upstream `75d38e55aa886386441597e8c22bb2fd90013565`, and exactly:

- `20261009014122`, `reviewed_demo_release_atomic_20261009`
- `20261009065443`, `unify_store_owner_credit`

Receipt `20261009065443` is the already-applied source
`20261009061801_unify_store_owner_credit.sql`, SHA-256
`117eba412ae0aeaef699f68ddfec9df7e1dc35d1cd0c49a462efb279dfc40057`.
Never replay it, restore its old data snapshot, or write migration history manually.
The baseline pins never refresh automatically after a refusal.

The database packet requires the same 35 authority/dependency function pins,
15 catalog sections, 41 protected business/HR table hashes and three authority
projections. Data hashing retains duplicate multiplicity; no underlying user,
HR, customer or business rows are exported. All counts/hashes must be available.
Missing schemas/columns or insufficient visibility are a failed preflight.

## Two approvals, two committed stages

1. Review/approve the exact generated `enum.sql` hash and inert `co_admin` label.
   Apply it as one separately committed migration. It grants nobody access.
2. Read back the actual connector-assigned receipt, exact statement bytes and enum
   postcondition. Bind its actual version/name to the approved enum source and
   packet SHA-256 values. Never guess the version from a clock or matching name.
3. Supply one readback JSON array to the optional final builder argument. Its
   single entry has `version`, `name`, `source_sha256`, `packet_sha256`,
   `statement_sha256`, and actual `statements`. Joined statement bytes must hash
   to the exact approved packet. If the connector serializes differently, stop
   for explicit review; do not silently normalize or accept a claimed hash.
4. Review/approve the newly assembled exact `forward.sql` hash and access delta.
   It atomically applies only source fragments 01–08. Until step 2 is independently
   verified, the builder emits only an explicitly failing `forward-review.sql`;
   there is no armed forward file.

A failure in 01–08 rolls that whole transaction back. The inert enum can remain.
The existing two history pins cannot be replaced by the enum parameter. Missing,
wrong, duplicate and inconsistent receipt bindings fail closed. The packet never
inserts, updates or deletes hosted migration history.

If a result is uncertain, perform a separately approved read-only reconciliation.
An exact unchanged baseline with no enum receipt is distinguishable from an exact
normalized enum-only state with a verified receipt. Neither authorizes replay.
A forward result requires its actual immutable receipt and full postflight proof;
if either is unavailable, preserve the uncertainty and obtain review rather than
rerun. After real CO posting, repairs are forward-only; never erase the ledger.

## Exact database and access delta

`scripts/co-rollout-delta.json` is the reviewed source-bound catalog contract:
935 portable changed/additional entries, including 24 new private tables, one
sequence, 112 new functions, 26 changed legacy functions and one changed legacy
customer visibility policy. New object definitions, ACLs, RLS, columns, indexes,
constraints and trigger functions are exact hashes. Generated FK-trigger OIDs
are replaced by portable constraint/function/type identities only in this delta;
the frozen original inventory digests remain unchanged.

Legacy metadata is target-authoritative. The hosted public functions have an
existing `service_role` EXECUTE grant that the synthetic baseline lacks. Therefore
local whole-function hashes are diagnostic, not replacements for hosted pins.
The 26 legacy transformations pin old/new function body and definition hashes
and preserve complete portable catalog metadata: owner, ACL, security-definer,
volatility, settings, defaults and every other captured semantic field. The
customer visibility policy changes only its exact USING expression; its other
fields stay unchanged. Every other existing catalog entry must be unchanged.
The 23 access-body rewrites and two evidence-publication hook guards retain
exact reviewed bodies and metadata checks, including their 69/20 negative probes.

Audiences of all 112 new functions, 24 tables and the sequence are explicitly
checked against the complete inventory, independently of name prefixes:

- Active CO Admin and Executive: authorized CO operations and reads, with
  customer/version/source checks and idempotent audited command boundaries.
- Authenticated clients: only the public CO/capability/report RPC entrypoints;
  no direct access to private CO tables or helper functions. The RPCs enforce
  each actor's role and scope. Anonymous access is denied.
- Service role: only the new evidence-attestation RPC; it cannot call other new
  CO/Sales v2/capability RPCs or directly access new CO tables/sequence. Existing
  legacy service grants remain preserved. Creation-time private revokes establish
  the reviewed hook metadata. Final cleanup follows the hook guards, so it cannot
  hide deliberately injected metadata drift. A real disposable provider-default
  simulation checks this boundary and service-role attestation.
- CO Admin can read customer/product master data without receiving sales/PO
  administration. Restrictive policies prevent CO sales/PO writes and prevent
  Procurement roles' Sales access. PO Admin retains its PO and approved Director
  leave route; existing HR grant/membership/balance/approver data is untouched.
- Sales roles receive scoped separate PO-order, delivered-PO and sold-CO metrics,
  with historical source-price and credited-person semantics. No CO ledger or
  evidence administration is added to Sales.

All 41 protected table contents and three authority projections must remain
identical. New CO tables must be empty at apply completion. No `public.users` role
assignment, customer ownership change, cutover data, or opening stock is supplied.

## Storage, Edge, frontend

Exactly one private `co-evidence` bucket is added: 10,485,760-byte maximum and PDF,
PNG, JPEG MIME types. Existing bucket metadata stays identical. Direct anonymous
and authenticated writes to this bucket are restricted; guarded Edge operations
bind actor, draft/customer versions, declared bytes/hash and provider object
version. SQL tests use provider-shaped synthetic metadata, not genuine provider
bytes or hosted runtime proof.

The proposed Edge source set is pinned in the manifest: shared CO evidence helper,
new `co-evidence-upload`, new `co-evidence-download`, and the changed `invite-user`
role allowlist. Existing hosted metadata showed only `invite-user` v2 and
`promotion-image-url` v1, active with JWT verification; it did not show CO endpoints.
A later Edge publication approval must enumerate exact bundled bytes/imports,
JWT configuration, target and runtime. Creating or assigning a CO account is a
separate authorization; updating the allowlist alone does not do it.

Apply database first, then separately approved matching Edge/frontend publication.
Recheck schema-cache visibility, exact deployed commit, role-specific smoke checks
and protected data. Old clients have no direct-write fallback. Local builds use
explicit `https://co-fixture.invalid` and a nonfunctional public placeholder; the
inherited `.env` is untouched and is not an approved staging target. The synthetic
build is static compilation, not deployed-target configuration approval.

## Bounds and evidence

Every packet has explicit 5-second lock waits and a repeatable-read transaction.
The protected/authority tables and bucket metadata are SHARE-locked before hashing,
so concurrent business writers cannot invalidate the pinned data silently.
Catalog/role administration must be quiescent during the reviewed maintenance
window; this packet is not a global catalog DDL lock. Recheck target and branch
at action time and stop on any unexpected concurrent schema/access activity.

Per-fragment statement limits are 60 seconds for 01–04/06–07 and 120 seconds for
05/08, preserving those source limits. Pre/postflight and enum use 60 seconds.
Local empty-baseline rehearsal measured the complete atomic forward in about
0.30 seconds and enum in about 0.009 seconds; these conservative bounds allow
hashing and hosted variability but do not establish hosted latency. The original
180-second per-process fixture cap and original 20-minute CI job cap are unchanged.
No increased cap, dropped 601/602 coverage, statistics-only fix, or replay rewrite
is used. The measured allocation change materializes the selected allocation and
generation-specific source-link relation once before display enrichment.

The workflow retains all original 32 gates verbatim and appends final CO checks
on its existing `postgres:17` service. The CI profile binds repository/job/run,
actual clean Git source, server system identifier/version/address/port, owner and
one-row marker. Primary, race clone and fresh pre-CO rollout companion are checked
independently. No fixture database can be reset, dropped or reused. The historical
demo checkpoint uses its existing hash-verified historical root and unchanged
81 protected pins, not a relaxed release builder.

Final acceptance requires final-schema SQL, real SQL-to-production decoders,
all 15 observed race barriers, exact source guards, full application regression,
typecheck, synthetic build and Edge checking. Local CI-profile simulation is not
remote CI. The actual browser gate remains blocked by loopback policy and OS
restrictions; no alternate host/tunnel/security workaround is permitted. Genuine
provider runtime/version/replacement races and the 10 MiB byte gate, approved
publication, remote exact-commit CI and deployment remain separate release gates.
