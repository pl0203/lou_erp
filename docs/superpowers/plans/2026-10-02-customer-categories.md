# Customer category implementation plan

For review | 2 October 2026

Binding specification: [Customer category design](../specs/2026-10-02-customer-category-design.md)

The category design is approved. This plan adds the five categories to Athel and Girard, verifies import compatibility, and prepares a staging-only release. Approving this plan allows implementation to begin after choosing an execution approach. The exact database rollout receives a separate target-specific approval before writes.

## Scope and protections

Categories are Supermarket Besar, Supermarket Sedang, Supermarket Kecil, Tradisional Market, and Perorangan. Existing null categories display Unclassified and remain editable. New customer forms require an explicit choice. Category never selects a price tier or changes catalog prices, historical order prices, quantities, deliveries, or totals. There is no automatic classification or new reporting feature.

The completed import remains complete: 14 committed packets and 1,274 POs, including 290 customers and 2,082 products. The 1,178 held groups and newer workbook delta are separate; neither is imported by this plan. Production deployment is excluded.

## Task 1: Define the shared category and database contract

Add one shared set of category values and labels, plus a nullable text column with a five-value CHECK constraint. The null default preserves existing records and compatible older clients. Existing owners, privileges and customer visibility remain unchanged.

Tests prove all five labels and values, Unclassified formatting, required selection for new forms, allowed legacy null, rejection of invalid stored values, unchanged existing data and permissions, and refusal of an unexpected pre-existing schema definition. Review this change before moving on.

## Task 2: Update Athel and Girard customer flows

Add the same labeled category control to both creation and editing flows, and show category separately from Price Tier on desktop lists and phone cards. Preserve classification during assignment-only changes. Refresh relevant customer caches without clearing an unsaved PO.

Tests cover a blank new form blocked from saving, each valid category, existing Unclassified customers edited without a forced guess, saved category changes, assignment preservation, and failed or denied saves retaining the user's inputs. A regression test keeps an edited PO's quantity and manual price intact during customer refetch.

## Task 3: Version future imports and preserve existing packet identity

Keep existing v1 packet generation byte-for-byte stable, including hashes and request IDs. Add a v2 contract for separately approved future imports, with an explicit category entry on every customer. Valid categories are accepted; a reviewed legacy mapping can explicitly use null. Missing or invalid mappings fail before any SQL is generated.

Tests compare frozen synthetic v1 packet bytes and identities, deterministic v2 output, explicit null handling, and preserved Others pricing with null catalog prices. A changed plan is never treated as a retry of an earlier plan. Do not add cross-version mutation-resume behavior, rewrite provenance, or regenerate unfinished request IDs.

## Task 4: Prepare read-only baseline and legacy verification

Prepare read-only queries that capture the actual starting schema, privileges, relevant data fingerprints and import request states. Check request states against the approved packet inventory, so unrelated pending requests or intentionally excluded groups are not mistaken for unfinished imports.

A separate legacy audit compares the original v1 customer and product fields using original IDs and hashes, excluding only the new category from that original projection. Category is checked separately. Category-only edits leave the original projection unchanged; later source-field changes are reported for reconciliation, never repaired or repinned automatically.

Tests prove parameter validation, explicit field projections, deterministic ordering, no database writes, and detection of source-field drift. These preparation tools have no database connection or execution capability.

## Task 5: Integrate the PO improvements and verify the full candidate

Coordinate with the separately reviewed PO search and quick-entry changes. Integrate only their final approved revision; do not overwrite that work or assume the current candidate is final. Preserve stable item focus, duplicate handling, keyboard and phone behavior, missing-price rules, delivery locks, and unsaved changes.

Run all application tests, TypeScript checks, and the guarded production build. In the existing disposable PostgreSQL CI environment, run the original v1 lifecycle before the category migration, then prove old packets reject the changed schema without writes. Verify v2 imports, lost-response retries, same-session retries, partial-batch failure, valid and null categories, invalid mappings, and unchanged historical prices and totals.

Test both customer forms at desktop and 375-pixel phone widths, including failed saves, assignment changes and customer refetch during an unsaved PO. A fresh whole-change review follows. Report the exact combined revision and every passed, failed or unrun check before proposing release.

## Task 6: Release to staging and preserve rollback data

Capture a fresh read-only baseline immediately before rollout and independently verify the exact staging target. Reuse the completed import evidence without replaying its records. Stop for an actual unresolved batch, unexpected schema or permission change, or mismatched protected data.

Present the exact migration and target for required approval. Apply the additive migration first; verify its definition, defaults, privileges and unchanged protected values; then deploy the compatible application. Complete authorized staging smoke checks and compare cohort identities, prices, quantities and totals with the fresh baseline.

If release verification fails, stop and report it. Application rollback retains the nullable column and all classifications already entered. Do not drop the column, erase category data, restore old price defaults, or replay old import packets. No production switch or newer-workbook import is included.

## Review and execution choice

I recommend step-by-step implementation with a fresh implementer and independent reviewer for each task, followed by an integration review. The extra review is useful because database compatibility and import retry identity are sensitive to small mistakes. A single implementer with one final independent review is the faster alternative.

Please approve this plan and choose the execution approach. No implementation has started. The remaining launch inputs are the exact staging target, migration and client revisions, current schema and privileges, fresh baseline, rollout window and approver.
