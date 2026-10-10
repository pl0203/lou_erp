# One store owner and PO credit

Local candidate only. No hosted database change, code publication, or deployment is authorized by this file.

## Behavior

The existing customer assignment field becomes **Penanggung Jawab Toko**. The same explicit active person supplies field ownership and the PO sales-credit snapshot. Salespeople join the existing manager/head/executive options. One person can own many stores; one store has one owner. No second selector or new account role is introduced.

The existing `customer_manager_assignments.manager_id` stores this owner. A salesperson's current reporting manager retains oversight through `users.manager_id`; no supervisor is copied into an assignment. Old hidden sales-rep assignment records are retained but no longer decide ownership or credit. Existing schedule-based salesperson access remains intact.

Only sales head/executive may assign, as before. Assignment writes now require the original row ID and version, are audited, and reject stale edits; direct client writes are revoked. Clearing retains the same row ID and increments its version with an empty owner, so a stale empty form cannot undo another leader’s intervening assign-and-clear decision. No PO-creation privilege or self-approval rule changes.

## Existing test records

This cutover corrects every existing PO once from the explicit existing field. An absent, inactive, or ineligible owner becomes explicitly unassigned. It does not invent an owner or use the hidden secondary assignment as a fallback. Existing conflicts are shown in the preview; the visible assignment is canonical by the user's instruction.

Amounts, statuses, dates, lines, deliveries and original Girard records stay unchanged. PO `updated_at` advances so an already-open editor cannot silently overwrite a corrected record. A private append-only audit retains before/after credit. The immutable credit trigger is suspended only while the migration holds exclusive locks, then restored in the same transaction. Subsequent assignment changes do not move historical credit.

Converted legacy POs report the fixed PO owner while retaining the original Girard amount, date and approval metric. A unique lineage index and a canonical union count each converted PO once, including when the original submitter is on another team. Unconverted historical submissions retain their original actor. Revenue eligibility and the existing all-status entered-order performance metric remain distinct, unchanged definitions.

## Rollout gates

1. Verify exact code base and migration source checksums; merge only this candidate delta with concurrent UI work.
2. Run `scripts/store-owner-preflight.sql` read-only against the intended staging project. Review owner/source changes, missing/ineligible owners, hidden-assignment conflicts and linked-PO counts. Any duplicate/mismatched legacy linkage is a blocker.
3. Obtain explicit approval for the scoped current owner/team store-read rule, checked assignment RPC, and one-time test-PO credit correction. The approval must identify the verified project and counts. No unrelated cleanup or deletion.
4. Assemble an immutable apply packet wrapping the migration's transaction. After its existing locks and before any changes, compare the reviewed `mapping_fingerprint` and `credit_fingerprint` against a fresh evaluation of the preview. Abort on any difference; never replace expected fingerprints automatically.
5. Run the complete UI suite, typecheck, production build, composed PostgreSQL cutover/ACL tests, and real concurrency tests on the final candidate. Review the exact packet separately. Hosted application remains a separate approval boundary.
6. Apply database-first during a brief assignment-edit maintenance window. Old frontend assignment writes fail closed once direct grants are revoked; deploy the matching frontend immediately afterward. Do not leave an old tab retrying. Reload affected customer/report queries.
7. Verify all existing POs have one audited assigned/unassigned correction, the immutable trigger is enabled, assignment versions are present, and the expected owner/team report totals match the preview. Confirm affected amounts/statuses/lines/deliveries remained intact and check an owner field edit + new PO flow under real allowed roles.

Rollback is a reviewed forward correction using the immutable audit, not an automatic downgrade or broad trigger bypass. Do not restore obsolete access/credit semantics just to resolve a UI deployment problem.
