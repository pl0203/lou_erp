# Customer category review and staged rollout

## Boundary and current gates

The approved [design](superpowers/specs/2026-10-02-customer-category-design.md) adds one nullable customer classification. Preparation is not permission to execute SQL or deploy. Production, the held groups, and any newer-workbook import remain outside this change. The release owner chooses and records the exact staging target, window, approver, migration bytes and compatible client revision before any later approved rollout.

`scripts/build-customer-category-review.mjs` only returns SQL strings. It has no database connection, credential lookup, execution, file access, CLI or rollout runner. Its tests exercise parameter rejection, emitted projections/hash/status contracts, deterministic ordering, and read-only boundaries. They do not execute PostgreSQL or establish hosted permissions or browser behavior.

Required later evidence, not claimed by these preparation tools:

- Disposable PostgreSQL execution of the generated baseline and v1 audit, including category-only edits, original-field edits, missing IDs, and unexpected source schema
- The reviewed category/import GitHub CI on the exact integrated revision, including old v1 bytes failing closed, future v2 validation and retries, and migration/access/pricing/history preservation
- Fresh read-only evidence from the independently verified staging target, compared with the approved original inventory
- Actual authorized and denied role checks through staging Auth/PostgREST and Athel/Girard browser/mobile flows, including errors, stale choices and cache refresh without losing an unsaved PO
- Separately approved migration-before-client rollout; no production switch is included

## Pure generator interfaces

The migration preflight and the new pure pre-apply gate share one inspectable contract producer, `scripts/customer-category-preapply.mjs`. The committed migration's entire preflight must be byte-identical to `buildCustomerCategoryPreflightSql()`; the guarded SQL builder and CI reject source divergence. The migration and `buildCustomerCategoryPreapplyMetadataSql()` use the same catalog SELECT and the same explicit contracts.

The two supported starting layouts are the unchanged canonical fictional fixture and the explicitly verified legacy layout. Each pins physical positions, names, types, nullability, exact default expressions, empty identity/generated fields, null column ACLs, validated named `PRIMARY KEY (id)`, and its own exact table ACL. The legacy layout uses phone/email/created_at before address, requires created_at, retains its `extensions.uuid_generate_v4()` default and historical `suppliers_pkey` name, and keeps authenticated SELECT/INSERT/UPDATE privileges. The canonical fixture retains its existing order, nullable created_at, UUID default, `customers_pkey`, and existing SELECT/INSERT/UPDATE/DELETE privileges. Neither contract authorizes changing existing metadata or widening access. Unknown combinations and drift refuse before snapshots or ALTER.

Before applying the migration, prepare and execute the separately reviewed bounded read-only metadata query on the independently verified target, preserve its complete single JSON result privately, and require `evaluateCustomerCategoryPreapply(result)` to return `accepted=true`, `complete=true`, and the expected layout. The query reads only catalog metadata, captures partition/inheritance/dropped-attribute facts, and requires the existing postgres inspection/owner context. It has no business-row or saved-hash input. Its pure generator/evaluator never connects or executes SQL. The migration rechecks the same contract under its existing exclusive lock.

Older baseline captures omit partition, inheritance, dropped attributes and category attributes hidden by dropped-column filtering. `evaluateCustomerCategoryCapturedBaseline()` can compare their observed ordered columns/defaults/ACL/PK semantics, but always returns `accepted=false`, `complete=false` with the missing evidence. This historical-capture result cannot open the rollout gate. The original names/types/source-row audit can still match despite order or nullability drift; its original projection and saved master-row hash remain unchanged and provide a separate source-data check.

Disposable PostgreSQL CI verifies complete pre-apply metadata for both supported layouts before the category migration, then runs the separate fictional legacy fixture's guarded rollback regression. It proves the frozen old preflight refuses that layout, the corrected migration preserves its existing rows and metadata, and unexpected order/type/nullability/default/identity/ACL/PK/security drift still refuses. The canonical SQL and original v1/v2 import lifecycles remain required.

Import either function from `scripts/build-customer-category-review.mjs` in an offline preparation script:

- `buildCustomerCategoryBaselineSql()` takes no arguments and returns one bounded SQL transaction with one JSONB result named `customer_category_baseline`
- `buildCustomerCategoryLegacyAuditSql({ customerIds, productIds, expectedMasterRowsMd5 })` returns one bounded SQL transaction with one JSONB result named `customer_category_legacy_audit`

The caller may save the returned SQL locally for review. No generated artifact is executed by the module. Use a private local destination for SQL containing real IDs, baseline results and receipts; do not check them into source, test fixtures, public artifacts or logs.

The audit requires the original saved customer and product UUID sets, each containing 1–10,000 values, plus the saved 32-hex-character `master_rows_md5`. It rejects missing/unknown parameters, empty/sparse/oversized arrays, malformed UUIDs, case-insensitive duplicates and invalid hashes before producing SQL. Valid UUIDs and the hash normalize to lowercase, UUIDs sort deterministically, and caller arrays are not mutated. There are no inferred IDs, default cohorts or newly generated request IDs. Do not substitute `master_model_sha256`, a compiler SHA256 or a new hash for the saved master-row MD5.

Both transactions use repeatable-read, read-only isolation, UTC, empty `search_path`, `row_security=off`, a 30-second statement/idle timeout, a 5-second lock timeout and `ROLLBACK`. They do not create temporary tables/functions or call application functions. `row_security=off` makes an RLS-filtered scan fail rather than accepting a partial-cohort hash; it does not grant visibility or bypass permissions. Use an independently approved inspection role with the required existing access. A missing relation/column, permission denial or timeout is a stop, not a reason to widen grants, remove the bound, disable protections or accept a partial result.

### Baseline output

`customer_category_baseline` contains:

- `review_version` and `identity`: capture timestamp, actual database/current user/session user, server address/port/version and transaction settings
- `schema` and `schema_md5`: actual schema/type/enum, table owner/ACL/RLS, column type/nullability/default/ACL, constraints, policies, function definitions/metadata, triggers, indexes, roles and memberships for the relevant schemas; `schema.category_column` is null when absent, otherwise its actual definition
- `protected_data`: deterministic relation-keyed `{ rows, content_md5 }` fingerprints of the original ten-column customer projection, complete products/promotions, PO/SJ headers and lines, their totals/quantities/prices, assignments/users and the remaining existing import-baseline relations
- `request_states`: every actual request's actor/request IDs, operation, creation time, derived `state`, `completed` (result is non-null), `abandoned`, available source/model/plan/manifest/master/PO-model hashes and byte counts, payload/result MD5, result object and directly exposed result/payload IDs
- `category_column_present`, `category_rows` and `invalid_category_ids`: classification is deliberately separate from original source fields; rows include null and currently invalid values

The baseline is one potentially large JSONB value: the original cohort alone has 2,515 request records, and `request_states` includes every current request plus its result JSON, alongside schema/function evidence. Before accepting it, obtain the complete raw/exported result and verify it is valid, untruncated JSON; require `request_states.length` to equal `protected_data['private.pilot_order_requests'].rows` and reconcile all original request IDs against the saved inventory. A collapsed/truncated browser or SQL-editor cell is not a verified baseline. An incomplete capture or timeout leaves the gate open; do not infer completeness from visible prefixes, displayed row count of one, or hashes alone.

The auth-user fingerprint uses only the established safe fields `id,email,role,aud,created_at`; it never hashes or returns full auth rows, passwords, tokens or credential columns. Business row payloads are hashes/counts except for the intentionally explicit classification and request review fields. Snapshot results are still private business/security evidence and need restricted storage.

The baseline fingerprints are review evidence, not replacement import pins. The customer projection excludes category; other business rows retain their complete current shape. Actual schema evidence exposes additional fields. This snapshot's schema representation and ordering are not the compiler's original baseline contract. Never feed its hashes into a rewritten v1 packet or ledger to make an old plan pass.

Database/user/server identity does not prove a Supabase project URL. Immediately before any later approved migration, the release owner must independently verify the target project URL/header and exact destination in the browser, verify fresh source/artifact bytes, and recapture this bounded baseline. A historic snapshot or matching database name is insufficient.

### Separate v1 audit output and hash contract

The master-row digest retains v1's PostgreSQL construction: JSONB object with ordered `customers` and `products` arrays, each ordered by original ID, then MD5 of that JSONB object's PostgreSQL text. Empty observed arrays remain JSONB `[]`. Hashing is done by the eventual PostgreSQL query, not by a JavaScript JSON serializer.

The explicit customer projection is exactly:

`id,name,address,city,phone,email,pricing_tier,visit_frequency_days,last_visit_date,created_at`

The explicit original product projection retains every column v1 hashed, including all five nullable catalog prices and the provider `created_at` field:

`id,name,sku,size,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan,created_at`

This is the complete ten-column original provider contract, not the intentionally minimal nine-column base test fixture. The reviewed `scripts/test-po-import-ci.mjs` adds `products.created_at` as `timestamptz`; v1 `import_master_hash()` hashes the full persisted product row. Its separate source-model comparison strips `created_at`, but that comparison is not the saved master-row hash. The audit must include the persisted timestamp unchanged. Any further product columns/types report source-schema drift; they are never silently discarded or accommodated by repinning the saved hash.

`customer_category_legacy_audit` returns the saved and independently reconstructed `expected_master_rows_md5` / `actual_master_rows_md5`, original requested IDs, missing IDs, actual/expected source-column/type maps, `source_projection_matches_schema`, `source_status` and `source_match`:

1. `ID_MISSING` when any original customer or product ID is absent, even if a supplied digest otherwise equals the observed rows
2. `SOURCE_FIELDS_CHANGED` when the hash differs or source columns/types differ from the original contract; only the added customer category is excluded from that schema comparison
3. `MATCH` otherwise; `source_match` is true only for this status

The original source projection cannot silently accept later added customer/product fields. Unexpected additions/type changes are reported even if the projected digest is equal. Missing columns fail SQL preparation/execution closed. Later legitimate source edits are evidence requiring manual reconciliation, not instructions to repair business rows or repin saved provenance.

Classification has independent `category_column_present`, `category_status` (`NOT_PRESENT`, `INVALID_VALUES` or `VALID`), `category_rows` and `invalid_category_ids`. Null remains a valid Unclassified legacy value. Absent category before migration is distinguishable from all-null category after migration. A category-only edit leaves the original digest and source status unchanged; a valid source match does not assert that classifications are approved or that category constraints/access are correct. Source-field drift and missing IDs do not disappear when a category is valid. The baseline's actual category schema/constraint/privilege evidence must also be reviewed.

## Preserve the completed original import

The original 14 packets are complete: 290 customers, 2,082 products, 1,274 POs, 2,900 PO lines, 1,241 delivery notes and 2,319 delivery-note lines. Preserve their original source models, saved payload bytes, actor/request IDs, ID map, provenance and all 14 receipts. There is no replay, reopening, new retry identity or automatic fingerprint repair in this work.

The approved archive identifiers are:

- Packet-manifest SHA256: `001544c40ea026752254e6d02f92cdc7fb949a5d1b4dc703c30768c61e78d90f`
- Original compiler SHA256: `88ec522c2abbf1edf6d5fec1c503da9830ca237debf05b9b210faa034e022320`
- Saved ID-map SHA256: `4cfc00cb1cf05e7fe2d4148669b3da870c61b42e2701c24c728cd0f2b2af6b4c`

These identify completed artifacts; they do not authorize another import. Real archive records and IDs stay outside source and tests.

Reconcile actual request states against that private, approved packet inventory by original actor/request ID and available plan/source/result evidence. Compare saved receipts and result identities, not global row totals. Report missing original IDs, inconsistent results/provenance or genuinely unresolved original-plan responses for separate resolution under their original plan before changing schema. A row having both `completed=true` and `abandoned=true` is contradictory evidence to investigate.

The snapshot enumerates unrelated pending requests so they can be classified explicitly; it does not label them incomplete original packets. The 1,178 intentionally held PO groups and the newer-workbook delta are excluded, not unfinished commits. Later synthetic records and unrelated requests explain why global counts need not equal imported-cohort counts. The release owner owns actual saved-ID inventory matching and deciding whether a new unresolved conflict affects the rollout.

Provenance is not uniform: original PO requests expose model/manifest/plan/source/master-row/PO-model evidence; the anchor alone may carry master-model hashes. Delivery provenance can contain only source key/sender and plan hash, without manifest/master/PO-model hashes or a parent PO link inside provenance. The tool returns null for unavailable fields. A result or payload may separately expose `po_id`; that is directly observed evidence, not an invented provenance field. Do not claim a missing provider/ledger field was verified or fill it by guessing from global counts.

## Later approved staging sequence

1. Record the exact target/project verification, window, approver, migration artifact `supabase/migrations/202610020001_customer_categories.sql` and its hash, compatible client commit/tree, current role/access/schema contract, and fresh original-inventory controls. Do not pick up unrelated migrations or regenerate import artifacts.
2. Refresh the read-only baseline, explicit-original-ID audit, and complete shared-contract pre-apply metadata query on that independently verified destination immediately before the approved migration. Require complete accepted pre-apply metadata for the expected layout, and review actual table/column privileges and RLS policies without widening access. Stop on genuinely unresolved relevant responses, uncertain original-plan outcomes, unexpected schema/access, missing IDs, invalid preexisting category state or unexplained protected-data/source mismatch. Reconcile separately; never repair or repin automatically.
3. After exact disposable CI and explicit staging authorization, apply the reviewed additive migration before deploying any client that selects/writes `customer_category`. Capture its actual result and rerun the approved bounded review queries. Require the expected single nullable text addition/CHECK, legacy categories initially null, unchanged original-source hash/IDs, pricing tiers, all five catalog prices, promotions, historical PO/SJ identity/values/totals, assignments/users and import ledger/receipts. Reconcile any concurrent legitimate changes rather than declaring all global differences safe.
4. Deploy only the pinned compatible client after the schema gate passes. Verify Athel and Girard create-required/edit-nullable behavior, all five values, Unclassified labels, mobile layouts, assignment-only preservation, stale caches, failed reads/saves and permission denials with actual staging roles. Preserve unsaved PO forms and existing Others/missing-price behavior.
5. Save private pre/post evidence and the exact outcomes. A schema, UI, SQL, browser or runtime gate without a successful recorded run remains **not run**, not implicitly passed. Production requires its own approval and is not switched by this sequence.

## Forward-only import and rollback boundaries

Future `po-import-v2` plans are only for separately approved new imports. They must pin the new explicit category semantics, source, actor/role, baseline and retry checks. An explicitly reviewed Unclassified mapping may use null; never infer a business category. Do not use v2 to refresh or resume the completed v1 cohort, import held groups or ingest the newer delta. The original v1 mutation bytes must continue to fail closed after schema changes; do not bypass drift checks or rewrite payloads/IDs.

Application rollback stops selecting/writing/showing the feature while retaining the nullable customer column and every entered category. Keep all five catalog prices nullable and preserve prices, promotions, orders, deliveries, assignments, user access and import evidence. Do not drop the column, erase classifications, backfill guesses, restore old price defaults, replay packets or re-grant access as rollback. A failed migration transaction rolls back atomically; a post-release issue needs a reviewed, data-preserving forward fix.
