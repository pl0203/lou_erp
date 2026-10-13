# Reviewed staging import

The compiler prepares private SQL artifacts; it has no database connection or execution CLI. Real workbook rows, contacts, mappings and generated packets must remain outside this public repository. The CI runner uses only fixed fictional data on a guarded temporary PostgreSQL service.

## Prerequisites

1. Freeze the approved source copy and its modified time, raw value hashes, clean/held whole-PO partition and independent quantity/money controls. Do not substitute a similarly named workbook or silently repair ambiguous identities, units, prices or deliveries.
2. Apply and verify the reviewed nullable-price/Others migration and matching frontend before importing any NULL/Others rows. Preserve existing catalog values. Each new imported product has all five catalog prices NULL; historical order prices remain exact.
3. Verify the exact staging project in the authenticated management interface. A database named `postgres` or a comment containing a project reference is not server-identity proof. The compiler also denies the known production-reference hash. No production import is authorized by this procedure.
4. Read the compiler's bounded baseline query under UTC and an empty search path. Pin the schema, required function bodies, all 25 relation fingerprints and the exact approved active actor UUID/email/role. No credential or service key is needed.
5. Obtain approval for the exact import population and actor. Preserve source business DATEs; audit, creation and completion timestamps reflect import processing. Completed orders' existing correction window starts then. Imported masters receive no invented sales/manager assignments.
6. Generate and independently review every final packet/hash and one resolved target-ID map. Earlier analysis IDs are provisional. Freeze the compiler's normalized manifest and plan hashes alongside the original reviewed source/eligibility hash.

## Packet behavior

The first transaction inserts the approved masters and one complete real PO with all its shipments. That normal create-PO request provides a durable ownership anchor if the committed response is lost. It stores the master model and full current master-row hash in the existing private request ledger. Each other PO stores only its own canonical source model in its own create request.

Later packets contain compact source hashes/request identifiers and their current whole-PO batch. Prior models are loaded only from verified committed ledger entries and checked by exact UTF-8 digest/length before parsing. The same strict checks then compare saved request payloads, current headers/line tuples/deliveries, optimistic versions, actor/audit records and the protected original baseline. A changed row, collision, missing model, noncontiguous prefix or schema drift stops the packet. No destructive upsert or trigger/RLS disabling is used.

Every transaction contains complete POs and their shipments. Normal `create_po` and `save_delivery` RPCs enforce business invariants; deferred constraints are forced before verification and COMMIT. Generated timestamps are not backdated. Historical line descriptions and prices, source units, consignment labels, shipment/received/returned dates and source sender provenance are retained without inventing invoices or payments.

## Execution and recovery

- Use a quiet staging write window and the exact reviewed packet bytes. Keep statement/process bounds unchanged. Choose the real batch size only after the corresponding synthetic size/late-prefix test passes; never change the frozen plan halfway through an import.
- Execute in order with a stop-on-error transport. PostgreSQL simple-query execution stops at the first error; file execution must use `psql` with `ON_ERROR_STOP=1`. Do not use a transport that ignores SQL errors and continues to a later receipt statement.
- Check the fresh run/error state and the new post-COMMIT receipt. Compare manifest/plan hashes, packet index, skipped flag and verified prefix counts. Never treat a retained old result grid as a new success or confuse planned totals with verified totals.
- On an uncertain response, use the exact same packet after checking the target and actor. A previously committed packet is verified and skipped; an uncommitted packet is allowed only after the original baseline and prior prefix are verified. Do not allocate a new plan or request identity to bypass uncertainty.
- On any data/schema conflict, stop. Earlier committed packets remain preserved. Review the actual changed state and seek a bounded reconciliation decision; never overwrite later user edits, force a hash match, delete imported history or remove constraints to continue.
- Once NULL/Others data exists, keep a compatible frontend. Restoring an older client or default-zero/NOT NULL model is unsafe. Recovery normally means a data-preserving forward fix; destructive rollback needs separate review and approval.

## Final checks

Verify exact master/PO/line/shipment counts, independent ordered/delivered/outstanding values and per-unit quantities, held-record absence, expected actor/timestamps, request ownership and unchanged original records. Refresh the actual app and check master lists, full PO count and sampled line/delivery/audit histories. Use a report date range covering the whole imported cohort when comparing full manifest totals; default recent-window cards are a different population.

The fictional size test establishes bounded importer behavior, not hosted API p95 or production readiness. Existing large-history report latency and broader pilot UAT gates remain separate.
