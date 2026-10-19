# Received-date-only Surat Jalan correction

Source-only backend candidate, not applied to a hosted database. UI deployment does not install the RPC extension. Any backend execution needs separate approval, exact target binding and recovery review.

## Contract

`pilot_order_transaction(request_id, 'edit_sj_received_date', payload)` accepts exactly `sj_id`, `expected_updated_at` (the reviewed parent PO version, including microseconds), and `sj_date_received` (canonical real `YYYY-MM-DD` or JSON null).

Only active `po_admin` / `executive` may write or recover. Parent locking, `PT409` optimistic conflicts, actor/request advisory locking, receipt `{id: sj_id, po_id, updated_at}`, safe abandonment and authorization before replay remain intact. Confirmed/in-progress POs retain existing eligibility. Completed POs permit correction through the inclusive fourteen-day server-wall-clock boundary, evaluated after parent and selected-SJ locks. Missing/nonfinite completion timestamps, cancelled POs and voided SJs fail closed. Full delivery/quantity changes and voids retain seven days.

The action changes only the received date and parent version, plus normal audit/receipt records. It does not rewrite lines, returned date, status or completion time, and skips fulfillment reconciliation. One explicit `sj_date_received` record captures actor and old/new values. The observed native `log_sj_changes()` also emits its existing generic `sj_updated` record, whose header text omits date-only changes. Exact replay creates neither again.

No received/returned/SJ chronology ordering rule was present in reviewed ordinary-PO source or the observed native SJ constraints. No ordering rule is invented. Calendar validation rejects malformed dates, timestamps, infinity, impossible dates and non-date JSON.

## Exact append-only profiles

`202610190001_sj_received_date.sql` has two finite, mutually exclusive profiles:

1. No catalogue markers: three exact post-CO functions, ordinary order RPC, recovery and legacy fence.
2. All three catalogue markers: ten exact installed bodies from the reviewed catalogue sources, as observed on 2026-10-19. Generation 1 remains generation 1 with tracking unavailable. The migration never changes cutover or policy state.

Partial markers, body drift, mixed old/new state, security metadata drift and unsupported generation state refuse. Complete old and resulting body hashes, exact replacement counts and fixed search paths are checked. Every preexisting function metadata field, including ACLs and owners, is compared after mutation. A bounded ledger lock and shared cutover-row lock protect one transaction. Reapplication is a no-op only for the entire exact final profile. No business/history update or grant is made.

Catalogue changed-function inventory:

- `public.pilot_order_transaction`: router admission only; authorized terminal replay remains before cutover routing.
- `public.pilot_reconcile_request`: durable recovery admission.
- `private.catalog_po_legacy_transaction_v1`: isolated received-date branch and reconciliation exclusion.
- `private.catalog_po_transaction_core_v2`: the same branch under existing master locks, lifetime admission and checked capabilities.
- `private.demo_order_execution_fence`: new operation admission; its existing SECURITY DEFINER mode, writer drain, generation checks and exact replay exemption remain.
- `private.catalog_po_assert_event_v2`: deferred request-operation admission.
- `private.catalog_por_extract_event_v1`: exact payload/version and audit-field grammar; existing delivery and PO lineage edges are reused unchanged.
- `private.catalog_history_extract_v1`: version-2 operation admission before the existing version-1 normalization.
- `private.catalog_history_producers_v1`: only the resulting core/extractor MD5 pins.
- `private.catalog_assert_checked_graph_v2`: only the resulting fence/event-assertion SHA-256 pins.

The extractor's old profile selector is retained for existing callers. It does not itself prove provenance of the new producer: this is a separately full-body-hash-pinned additive grammar extension. No unrelated producer pin, trigger topology check, history parser or policy predicate is relaxed. Historical catalogue candidate files remain unchanged. A future catalogue reinstall/rebase must preserve these ten extended bodies; replaying the old installer is not a supported upgrade.

## Inherited native catalogue limitation

Observed native staging was generation 1, `tracking_ready=false`. Its existing graph/history guards still pin synthetic audit hook names/bodies, while native `log_sj_changes()` has a different body and trigger name. The generic native `sj_updated` audit grammar is also intentionally unsupported by the existing history parser. These are inherited limitations, not repaired here.

Native generation-2 fresh commands therefore remain fail-closed. This candidate is not a cutover-readiness claim. Tests preserve the existing `CATALOG_TRACKING_INCOMPLETE` refusals, with no new receipt/audit/business mutation, while proving terminal generation-1 replay/recovery still works. Generation-2 feature behavior is proved separately on the coherent original synthetic graph, explicitly not asserted for native staging. No cutover, audit-grammar widening or unrelated native contract repin is included.

## Reproducible verification

The additive Pilot safety step runs after final CO composition using its existing source/run/server-bound disposable identity. `node scripts/test-sj-received-date-ci.mjs` does not provision/reset a database or accept a hosted URL.

It proves the three-function profile, including observed-lock races, then restores only the verified empty-feature-receipt disposable baseline. It assembles 17 unchanged, individually pinned catalogue sources with two finite previously reviewed native auth/policy adaptations. All ten starting function bodies, metadata and ACLs match the observed installed contract. Coherent synthetic generation-two tests run before the native SJ hook is installed. The native hook then runs the generic regression, native compatibility/limitation checks and real races.

The fixture is a finite contract reconstruction, not a full production clone: no business data, credentials or bulk hosted metadata export is included. Its native hook is exact; unrelated native schema behavior beyond the reviewed contract is not certified.

Coverage includes:

- Both migration profiles: partial installation/body/security refusal, injected late-install rollback, exact no-op retry, unchanged metadata/business state and exact changed-function count.
- Roles/revocation, real dates/null/exact payload, active/expired/missing completion, inclusive boundary and one-microsecond cutoff, immutable fields/lines, explicit audit, stale version, recovery after deadline, abandonment, late-receipt rollback, cancelled PO and voided SJ.
- Retained generation-1 and normalized generation-2 history, exact receipt identity, unsupported execution zero, unchanged lineage edges and explicit audit admission; runtime graph/producer checks remain active.
- Native existing returned-date/full-SJ/ordinary PO/catalogue create/edit flows, generic plus explicit audit, and inherited generation-two refusal.
- Real concurrent sessions: parent-lock competitor receives `PT409`; same-request advisory-lock competitor receives the same receipt; a blocked request crossing the deadline is refused after acquiring locks. Barriers and server time are observed, not inferred from sleeps. Race-owned rows are cleaned and expanded business, actor, catalogue identity/context and function fingerprints compared. Catalogue races reuse a reserved disposable customer so retained identity tombstones are neither created nor deleted by cleanup.

Vitest source tests protect complete resulting bodies, fixture source/adaptation identities and additive CI wiring. They are separate from, not substitutes for, real PostgreSQL execution.

## Bounded rollback design (not authorized for execution)

Before successful backend application, there is nothing to revert. An error before COMMIT must roll back the whole transaction. An uncertain COMMIT must be reconciled against the complete exact profile before retrying.

If no `edit_sj_received_date` receipts exist, separately reviewed exact previous-body restoration may be possible after draining writers and proving absence again under lock. It must preserve all metadata and the applicable catalogue profile; the local fixture restoration helper is not a deployment tool.

Once any such receipt exists, blindly restoring old allowlists would break durable replay/recovery and history extraction. Prefer a separately reviewed forward rollback that rejects fresh received-date requests while preserving current authorization, exact terminal replay, recovery, receipt/history interpretation, audit evidence and all fences. Do not delete ledger/audit rows or silently restore dates. UI rollback alone leaves corrected data intact. No rollback execution is included or authorized.
