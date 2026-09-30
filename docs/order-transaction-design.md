# Transaction safety design (staging only)

This design uses the metadata-only live public schema observed September 30, 2026. It is not a production deployment plan. Exact existing functions, grants, policies and triggers must be loaded before migration implementation. No customer records were copied.

## Server boundary
- Add transaction RPCs for sales submission, manual PO creation, approve/reject, PO edits and delivery-note create/update
- Derive actor from auth.uid(); require a current active profile and allowed role/resource scope inside every operation
- Keep the existing Girard/Athel role matrix. Sales submissions require actor-owned visit and matching customer; admin PO mutations require po_admin/executive
- SECURITY DEFINER may be necessary to deny direct table writes while exposing controlled operations. Use a fixed empty search_path, fully qualified names, and REVOKE PUBLIC/anon execution; grant authenticated only. Review every dependency/trigger
- Revoke browser direct INSERT/UPDATE/DELETE on the transactional tables only during coordinated backend/client rollout. Until then existing preview continues its existing paths; never switch a client to an undeployed RPC

## Retry identity
Use a small request ledger keyed by (actor_id, request_id), storing operation, canonical JSONB input and result. Claim with INSERT ON CONFLICT then row lock. An identical committed retry returns its previous result. Reuse with a different operation/payload fails. A failed transaction rolls back its ledger claim and business writes together. No credentials or private customer contact details belong in this ledger

## Transaction invariants
1. Validate all line payloads before first business write: nonempty named lines; positive integer quantities; finite/nonnegative prices; database numeric precision; legitimate zero-price promotion lines remain valid
2. Compute totals from stored lines, never accept a client total. Preserve generated line_total columns and verified existing audit/completion behavior
3. Sales approval/rejection locks the source sales-order row, checks pending status, and commits decision plus PO/lines/link in one transaction. A second different request cannot create another PO
4. PO edits lock the PO and compare expected_updated_at. Reject stale edits. Verify line IDs belong to this PO and occur once. Preserve delivered line identity/name/SKU/price and forbid deletion of delivered lines. Quantity cannot fall below cumulative deliveries. Customer cannot change once delivery history exists
5. Delivery create/update locks its parent PO, checks expected_updated_at, and validates every line belongs to the same PO. Compute remaining quantity against other delivery notes in the locked transaction. Updating a delivery replaces rows atomically, not as browser calls
6. All mutations advance updated_at to act as the resource version. Direct browser writes must be removed from the rollout surface or these locking/version guarantees cannot hold
7. Hard deletion of real orders/delivery history is not automatically included. Use reviewed cancellation/correction semantics; do not silently erase audit history

## Verification
- Metadata fixture: preserve exact columns/enums/generated expressions/constraints; apply PK/UNIQUE before FKs. Label the external auth.users stub explicitly
- Run server-side validation, rollback, idempotent replay, stale version and line ownership tests with dummy UUIDs
- Run separate-session duplicate approval, approve/reject, and overdelivery races in a permitted staging server
- This executor currently supports real PostgreSQL single-user SQL tests but cannot create a local server socket. Do not treat serial tests as concurrency, JWT/PostgREST or deployed-RLS verification

## Open review points
- Existing trigger definitions may require restructuring to avoid intermediate completion states during atomic delivery replacement
- Existing customer_sales_rep_assignments UNIQUE(sales_rep_id) permits one customer per rep. Confirm intended cardinality before any alteration
- Legacy PO status values remain present. RPCs should explicitly accept supported current transitions and reject unsupported legacy states without rewriting historical data
- Backend migration deployment and feature enablement require separate approval and a restore/reconciliation plan
