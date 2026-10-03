# Customer category design

For review | 2 October 2026

Add a separate customer category to Athel and Girard so the team can classify customers consistently without changing how orders are priced. The product direction was approved on 2 October. This written specification is the next review gate; implementation planning and deployment follow separate approval.

## Customer behavior

The category choices are Supermarket Besar, Supermarket Sedang, Supermarket Kecil, Tradisional Market, and Perorangan. Use the stable values supermarket_besar, supermarket_sedang, supermarket_kecil, tradisional_market, and perorangan respectively.

Existing customers start with a null category, displayed as Unclassified. The team chooses classifications deliberately; no category or supermarket size is inferred from a name, address, sales value, price tier, or previous source label. Existing Unclassified customers remain editable without forcing a guess.

Both Athel and Girard customer-creation forms start with no category selected and block saving until the user chooses one. Category is shown on their customer lists and mobile cards and can be changed in their customer-edit flows. Assignment-only changes preserve category. Labels remain distinct from Price Tier. Lookup and customer-directory caches refresh after a category update without clearing an unsaved PO.

The existing price tiers remain Harga Pokok, Luar Kota, Dalam Kota, Depo Bangunan, and Others. Categories do not select a price tier. No category reports, dashboard breakdowns, automatic backfill, unit conversion, or bulk reclassification are included.

## Data and access contract

Add customers.customer_category as nullable text with a CHECK constraint allowing only the five stable values when non-null. The default is null. Do not alter the pricing enum or any existing price column. Nullability preserves existing records and compatible older clients; new interactive creation is validated in both current forms. A future legacy-data import may retain null only through an explicitly reviewed Unclassified mapping, never by silently assigning a business category.

Keep customer identity, current visibility, and authorized editor roles unchanged. Use the existing customer read/write routes with the added narrow field projection. Verify live table and column privileges and row-level policies before rollout; do not widen access to make a form work. Invalid stored values are rejected by the database. Read or save failures are visible and retain the user's form values.

Category edits preserve pricing_tier, all five catalog prices, promotions, historical PO line identity, prices, quantities, delivery history, and order totals. Saving a category must not recalculate historical prices. The existing Others and missing-price behavior remains unchanged.

## Completed import and future compatibility

The approved import is complete and reconciled. Its 14 committed packets cover 290 customers, 2,082 products, 1,274 POs, 2,900 PO lines, 1,241 delivery notes, and 2,319 delivery-note lines. Final receipt counts match the independent reconciliation. The 1,178 held PO groups were intentionally excluded; they are not incomplete commits. A newer workbook delta is separate and has no import authorization under this design. Later synthetic test records also mean global database counts are not the imported-cohort counts.

The importer pins schema and baseline fingerprints and hashes full customer rows. An added nullable column changes those fingerprints. Its plan hash also determines request IDs, so regenerating an unfinished import against a new schema would change retry identity.

Use a forward-only compatibility boundary:

Preserve the completed import's source models, original request IDs, saved payloads, provenance, and receipts. Do not replay or reopen the completed cohort.

Before migration, capture a fresh read-only baseline of the actual target, schema, policies, relevant data, and request state. Stop on a genuinely unresolved batch or uncertain response. Resolve any such new conflict separately under its original plan before changing schema; do not treat excluded groups as unresolved work.

Version future import support for the new schema. Pin its customer projection and category semantics explicitly, validate classifications, and preserve exact baseline, source, role, and retry checks. New plans are for separately approved new imports only.

Old mutation packets continue to fail closed after schema changes. Never bypass their drift checks, rewrite their ledger payloads, or create new IDs to force a retry.

Provide a separate read-only legacy audit using an explicit v1 projection: id, name, address, city, phone, email, pricing_tier, visit_frequency_days, last_visit_date, and created_at. Retain original product projections and cohort IDs. Compare original source-owned fields and saved hashes without including the new category. Validate category separately. Report later legitimate source-field edits or other mismatches for reconciliation; do not repair them or update fingerprints automatically.

An additive customer column is chosen over a separate classification table because the current requirement is a single field in existing customer flows. A second table would add joins and permission rules while still changing the global schema fingerprint. Cross-version mutation-resume machinery is unnecessary for the completed cohort and is not included.

## Verification and release boundaries

Before release, prove that legacy records remain Unclassified, new customer forms require a choice, valid edits persist in Athel and Girard, assignment-only edits preserve category, and mobile forms and list labels are usable. Cover failed reads/saves, stale cached choices, and permission denials. Test all five accepted values and rejection of invalid stored values.

Disposable database tests must cover additive migration, old-client inserts with the field omitted, versioned new imports and safe retries, old packets rejecting the changed schema, and the read-only v1 audit after category changes. Unrelated source-field or baseline drift must still be detected. Compare pre/post cohort identities, pricing tiers, catalog prices, historical order and delivery values, and counts; category changes must be the only authorized data difference.

Deploy the reviewed migration before the client that selects and writes the new field. Application rollback stops using the feature while retaining the nullable column and every entered classification. Do not drop the column, erase classifications, or revert nullable catalog prices as normal rollback; use a data-preserving forward fix.

## Review decision and launch configuration

Approve or revise this written specification before preparing the implementation plan. No application or database change is authorized by this document alone.

Release configuration will be verified from fresh evidence: exact target environment, migration artifact and expected starting schema, compatible client revision, existing editor permissions, read-only baseline timestamp and cohort controls, and the rollout window and approver. These are release inputs, not unfinished product decisions or a reason to reopen the completed import. Production deployment and any newer-workbook import remain outside this approval.

## Evidence

Repository inspection uses staging revision 8d5190ec3a0ca89f527224c3fa75318506eda41f, particularly customer CRUD, catalogPricing, order validation, and the state-pinned import compiler. Import completion was checked against receipts 00 through 13 and the independent reconciliation recorded at 2026-10-01 19:03 UTC. The saved database reconciliation's earlier UI-smoke status is separate from commit completion and is not a current UI-readiness claim.
