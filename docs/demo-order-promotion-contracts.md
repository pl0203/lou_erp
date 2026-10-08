# Demo order and promotion contracts

Candidate migration: `202610081101_demo_order_promotions.sql`. Requires the reviewed `bc48d9fb` order/security/read baseline, including the nullable-price and stale-conflict migrations. This document describes local tested behavior; it does not claim hosted deployment or provider Storage validation.

## Authority, identity, and recovery

All mutations and recoveries authenticate a currently active profile. PO/promotion mutations require `po_admin` or `executive`; sales, managers, and sales heads are promotion read-only. The mutation transaction locks the actor's authority row so a concurrent revocation has a defined ordering. Browser promotion INSERT/UPDATE/DELETE are revoked. Existing PO/SJ RPC-only permissions remain unchanged.

Each mutation uses a fresh UUID request ID for a genuinely new confirmed attempt. Exact-payload replay returns its existing receipt. Changed-payload reuse rejects with SQLSTATE `22023`. Reconciliation precedes any changed payload after an uncertain network result. A confirmed SQL refusal rolls back the business mutation and request claim. A durable abandonment tombstone rejects delayed execution with `55000`.

Promotion requests use `private.pilot_promotion_requests`, separate from the existing order and schedule families. Recovery of an unknown ID in the wrong family cannot abandon a future request in another family. Existing order recovery only accepts its explicit order operation allowlist; it rejects visit/schedule rows before disclosing or changing them. Receipt recovery always checks current authority.

- Orders: `pilot_order_transaction(p_request_id uuid,p_operation text,p_payload jsonb)` and existing `pilot_reconcile_request(p_request_id uuid,p_abandon boolean)`.
- Promotions: `pilot_promotion_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb)` and `pilot_reconcile_promotion_v1(p_request_id uuid,p_abandon boolean)`.
- Mutation promotion receipt: `{ "id": "promotion UUID", "stock_version": 1 }`.
- Promotion recovery: `{ "state":"committed", "operation":"create_promotion", "result": {"id":"promotion UUID","stock_version":1} }`, `{ "state":"unknown" }`, or `{ "state":"abandoned" }`.
- Orders preserve existing `{id,updated_at}` / `{id,po_id,updated_at}` receipts.

New `submit_sales` execution is retired for every role, including old uncommitted request rows. The private order ledger has a server-owned `execution_version` column: historical entries remain 0; the replacement RPC hardcodes 1 on new claims. A ledger insert trigger fences already-entered old order bodies without using any client payload flag or GUC. For old order execution version 0, it permits only exact already committed same-actor/operation/payload replay or nonbusiness recovery tombstones; old stored payloads/results are unchanged. A previously committed request remains exactly replayable/reconcilable by its actor with current sales/customer authority. Retained `approve_sales` conversion uses a private helper that loads trusted Girard items itself, validates quantity/price limits, preserves recorded product/name/SKU/price snapshots even after a catalog rename, and applies normal promo accounting. Client-supplied replacement items cannot invoke this historical path. An unresolved historical product ID remains null. The original Girard link and legacy attribution remain intact.

## Promotion mutation payloads

All listed keys are required, including explicit null price fields. Unknown keys are rejected. JSON quantities and versions are numbers, not strings. Tier prices accept null or a nonnegative number with at most two decimal places; explicit zero is a valid price. Missing prices never become zero implicitly.

`create_promotion`:

```json
{
  "id": "de500000-0000-0000-0000-000000000001",
  "product_id": "de200000-0000-0000-0000-000000000001",
  "opening_quantity": 5,
  "image_path": "promotions/de000000-0000-0000-0000-000000000001/de500000-0000-0000-0000-000000000001/de900000-0000-0000-0000-000000000001.webp",
  "harga_pokok": 0,
  "luar_kota": null,
  "dalam_kota": 20,
  "depo_bangunan": 10,
  "is_active": true
}
```

Opening quantity is an integer between 0 and 2,147,483,647. Generate the promotion UUID before uploading its image. Catalog product must exist. A second enabled stock-managed campaign for the same product is rejected, including when the existing campaign is exhausted. `is_active:false` creates a paused campaign. Legacy campaigns remain unchanged; create a reviewed stock-managed successor rather than inventing stock from history.

`edit_promotion`:

```json
{
  "promotion_id": "de500000-0000-0000-0000-000000000001",
  "expected_stock_version": 1,
  "image_path": "promotions/de000000-0000-0000-0000-000000000001/de500000-0000-0000-0000-000000000001/de900000-0000-0000-0000-000000000001.webp",
  "harga_pokok": 0,
  "luar_kota": null,
  "dalam_kota": 20,
  "depo_bangunan": 10
}
```

Product identity cannot change. An unchanged linked image is retained even when another authorized administrator originally uploaded it. Replacing it requires a newly uploaded, currently owned, correctly linked object; the old path remains linked if the transaction fails.

`adjust_stock`:

```json
{"promotion_id":"de500000-0000-0000-0000-000000000001","expected_stock_version":2,"quantity_delta":3,"reason":"Reviewed replenishment"}
```

Delta must be a nonzero integer, absolute value at most 2,147,483,647, with a nonblank reason of at most 1,000 characters. Available balance cannot become negative. Available plus outstanding allocated stock cannot exceed 2,147,483,647, preserving headroom for later releases. This writes an append-only movement. It does not reactivate a paused campaign or allocate existing excess PO quantities retroactively.

`set_active`:

```json
{"promotion_id":"de500000-0000-0000-0000-000000000001","expected_stock_version":3,"is_active":false}
```

Stale campaign versions produce SQLSTATE `PT409`, details `{ "code":"PROMOTION_VERSION_CONFLICT" }`. Every stock allocation/release or administrative edit also advances `stock_version`.

## Promotion reads

`pilot_promotions_v1(p_include_inactive boolean)` returns:

```json
{
  "version": 1,
  "as_of": "2026-10-08T12:00:00Z",
  "items": [{
    "id": "de500000-0000-0000-0000-000000000001",
    "product_id": "de200000-0000-0000-0000-000000000001",
    "product_name": "Synthetic product", "sku": "DEMO-1", "size": null,
    "harga_pokok": 0, "luar_kota": null, "dalam_kota": 20, "depo_bangunan": 10,
    "is_active": true, "stock_managed": true, "remaining_quantity": 5, "stock_version": 1,
    "image_path": "promotions/actor-uuid/promotion-uuid/random-uuid.webp",
    "start_date": "2026-10-08", "end_date": "2026-10-08", "created_at": "2026-10-08T12:00:00Z"
  }]
}
```

The example path is abbreviated in the read shape only. Real paths always follow the UUID shape. Existing date metadata remains non-null. Managed campaigns ignore dates: enabled positive stock is running; enabled zero stock is exhausted; disabled is paused. `false` returns only enabled managed campaigns, including exhausted ones. `true` requires current `po_admin`/`executive` authority and includes paused and legacy rows. Other active sales roles can read `false` only.

Nonmanaged legacy rows project `remaining_quantity: null` to indicate that no managed stock balance exists. Their stored migration defaults remain `stock_managed = false`, `remaining_quantity = 0`, and `stock_version = 1`; this read projection does not change historical data or establish opening stock. The client displays legacy history without stock controls. Managed rows retain their actual nonnegative integer balance (including zero for an exhausted campaign), a positive stock version, and their linked image; malformed managed balances are rejected.

## PO identity and immutable attribution

New and edited lines accept `product_id: string | null`; `pilot_po_lines_v1` returns it on every item, preserving its current pagination/version contract and string monetary fields. Supplied product ID and SKU must agree after trim/case normalization. A new manual SKU resolves only to one exact normalized catalog SKU; ambiguous matches reject. Unmatched manual lines remain null and receive no promotional allocation. Names are never used for resolution.

An existing line's unchanged product ID/SKU pair is historical evidence. This includes a null ID whose unchanged old SKU now matches a catalog product: an unrelated or quantity edit does not backfill it. Linked historical snapshots also survive later catalog SKU changes. Product/price/name/SKU changes on a line with any delivery history, including voided history, are rejected. A genuinely changed undelivered identity is revalidated.

Server IDs for newly inserted lines derive deterministically from request identity and normalized canonical item ordering. User-supplied IDs on creation are not authoritative. Existing line IDs remain stable. The allocation order sorts these persisted IDs, not the UI array order. New identifiers are checked against persisted PO lines and all identities reserved in the draft; a conflict fails safely with SQLSTATE `23505`. Every encountered persisted line receives ownership, delivered-history, and minimum-quantity validation before mutation. Genuinely new items are INSERT-only, so a later uniqueness conflict can never fall back to updating an existing line. Exact committed request replay returns its stored receipt before allocating identities.

New admin-created PO fields:

- `sales_person_id_at_creation`: UUID or null
- `sales_assignment_source_id`: UUID or null, durable source identity without a delete-cascading assignment FK
- `sales_attributed_at`: server timestamp
- `sales_attribution_state`: `assigned` or `unassigned`

The server snapshots exactly one explicit store assignment to an active `sales_person`. No unique active assignment yields Unassigned. Assignment capture uses a table SHARE lock, including the absent-assignment case, and locks the selected active profile. This is intentionally conservative: simultaneous PO creations coexist; assignment-table writes wait for capture transactions. Later reassignments and PO edits never rewrite credit. All pre-cutover POs and retained legacy conversions have `legacy` and null snapshot fields. No historical identity, allocation, or credit backfill occurs.

## Shortage refusal and Continue

PO create/edit and retained conversion aggregate incremental demand for each catalog product, after eligible releases. Existing acknowledged excess is not new demand. Each refusal uses SQLSTATE `PT409` and JSON-encoded error details:

```json
{
  "code": "PROMO_STOCK_WARNING",
  "shortages": [{
    "promotion_id":"de500000-0000-0000-0000-000000000001",
    "product_id":"de200000-0000-0000-0000-000000000001",
    "product_name":"Synthetic product", "sku":"DEMO-1",
    "remaining_quantity":5, "requested_quantity":10,
    "incremental_quantity":10, "shortfall":5, "stock_version":1
  }],
  "ack": { "version":1, "payload_hash":"opaque", "po_version":null, "shortages":[] }
}
```

The example `ack` is illustrative: clients must retain the entire actual structured `ack` unchanged. It binds the exact payload (excluding `promo_stock_ack`), PO version, campaign IDs/versions, full requested/incremental quantities, and locked available balances. Do not synthesize it. After the confirmed SQL refusal, Continue uses a new request ID with the unchanged draft plus root `promo_stock_ack: ack`. A changed draft or changed warning facts gets a fresh typed refusal and commits nothing until reconfirmed, even if a paused/replaced campaign or replenishment makes the current shortage array empty. A network-ambiguous call must reconcile first.

For an initial shortage, `PROMO_STOCK_WARNING` keeps its original top-level shape. A stale supplied acknowledgment instead returns SQLSTATE `PT409` with:

```json
{
  "code": "PROMO_STOCK_CHANGED",
  "shortages": [],
  "allocations": [{
    "product_id": "de200000-0000-0000-0000-000000000001",
    "product_name": "Synthetic product", "sku": "DEMO-1",
    "promotion_id": null, "stock_version": null,
    "remaining_quantity": 0, "requested_quantity": 10,
    "incremental_quantity": 10, "allocation_quantity": 0
  }],
  "ack": { "version": 1, "payload_hash": "opaque", "po_version": null, "shortages": [], "allocations": [] }
}
```

The `ack` example is illustrative only; retain the actual entire returned object. It now binds all incremental catalog-product allocation facts as well as shortages and the exact draft/PO version. Allocation entries have nonnegative integer quantities, `requested_quantity >= incremental_quantity > 0`, and paired UUID/integer-version or null/null campaign fields. For enabled campaigns, `allocation_quantity = min(incremental_quantity, remaining_quantity)`. A null campaign means no enabled promotional allocation: its eligible remaining/allocation quantities are zero. This does not claim that a paused campaign's physical balance vanished. Arrays may both be empty after a changed draft removes all incremental catalog demand.

The client must explicitly display refreshed facts and require Continue again for `PROMO_STOCK_CHANGED`; it must not treat an empty shortage array as a generic PO conflict or silently reuse the stale acknowledgment. Replenishment can show no shortages and a fully covered new allocation. Initial drafts with no acknowledgment and no active campaign retain normal behavior. Entered line prices never change.

Suggested text: `Stok promo [nama produk / SKU] tersisa [X]; PO meminta [Y]. Tetap lanjutkan?` Keep incremental requested quantity visible for edits. Excess remains at the entered PO price; allocation never reprices any line.

Slices retain original campaign, PO, stable line, actor/request, and insertion sequence. Quantity reductions remove unallocated excess first, then release newest slices first. Thus 10 ordered / 5 allocated -> 6 releases zero -> 4 releases one. Increases allocate only additional units from the currently enabled campaign. Removal/cancellation releases all residual slices once to their original campaigns, without reactivation. Ledger line UUIDs have no cascade-delete FK. SJ writes and returned-date corrections never allocate or restock. A failure at any later receipt/audit stage rolls the whole transaction back.

Locks are request identity, PO where applicable, products in UUID order, then campaigns in UUID order. Product `FOR NO KEY UPDATE` serialization is compatible with existing PO-line foreign-key KEY SHARE locks, avoiding a lock-upgrade deadlock between two new POs.

## Returned-SJ date

`edit_sj_returned_date` has exactly these keys:

```json
{"sj_id":"de600000-0000-0000-0000-000000000001","expected_updated_at":"2026-10-08T12:00:00Z","sj_date_returned":"2026-10-08"}
```

Returned date may be null to clear it. Receipt is `{id: sj_id, po_id, updated_at}`. The server locks its PO and checks the existing optimistic version (`PT409` on stale). A nonvoid SJ on an eligible incomplete PO is editable. Completed POs are eligible through `completed_at + interval '14 days'` inclusive, evaluated with server wall clock after locks; missing/nonfinite completion evidence fails closed. Only the returned date, an explicit old/new audit entry, and PO version change. Completion state/time are unchanged. Other full-SJ edits/voids retain the existing seven-day rule; completed PO contents stay locked.

## Private images and bounded signer

Bucket: `promotion-images`, private, 5 MiB maximum, MIME allowlist `image/webp`, `image/png`, `image/jpeg`. Immutable path: `promotions/{current actor UUID}/{promotion UUID}/{random UUID}.webp|png|jpg`. Upload with `upsert:false`. Upload INSERT requires a currently active promotion admin, exact actor owner/prefix, and path shape. Link validates exact owner, promotion ID, suffix/MIME agreement, and stored numeric byte size 1..5,242,880. Replacements keep old linkage until commit. Private orphans are not automatically deleted.

There is no browser object SELECT/list/update/delete for this bucket, so the browser cannot bypass the TTL using direct Storage signing. The support Edge Function is `supabase/functions/promotion-image-url/index.ts`; deploy only with the coordinated reviewed release, using the existing platform environment. No credentials are created or configured by this change.

- POST body: `{ "promotion_id": "UUID" }`, with normal user Authorization.
- Success: `{ "promotion_id":"UUID", "signed_url":"https://…", "expires_in":300 }`.
- Call from the client with `supabase.functions.invoke('promotion-image-url',{body:{promotion_id}})`.
- The function first calls `pilot_promotion_image_v1(p_promotion_id uuid)` using that user's token. It signs only the returned canonical linked path using the platform's server credential, with exactly `expiresIn:300`. Client paths and expiry overrides reject before external calls.
- Each refresh rechecks current active audience and linkage. Inactive, anonymous, unlinked, or nonadmin paused-campaign requests cannot mint a new URL.
- An already minted URL remains a bearer capability until its five-minute expiry. Deactivation/unlinking does not revoke a previously issued token immediately.

Synthetic PostgreSQL tests validate real role/RLS metadata rules. Node tests validate the signer HTTP boundary, canonical path, TTL, repeated authorization, error handling, and secret nondisclosure. Actual Auth/PostgREST headers, Storage upload MIME/size behavior, signed URL access/expiry, and provider revocation timing still require staging tests; SQL metadata fixtures are not that evidence.

## Reproducible local checks

Use normal disposable PostgreSQL 17, a dedicated loopback server, database `pilot_test`, owner `postgres`, with no actual records. Load `tests/database/fixture.sql`, then `tests/database/demo/storage-fixture.sql`. Apply historical migrations in order, inserting `tests/database/hosted-read-policy-fixture.sql` immediately before `202610010001_scalable_order_reads.sql`, followed by this migration. The fixture is test-only and must never be applied to hosted schemas.

Run `psql -X -v ON_ERROR_STOP=1 -f tests/database/demo/order-promotions.sql` and `node tests/database/demo/order-promo-concurrency.mjs`. Set normal local `PGHOST`, `PGPORT`, `PGUSER`, and `PGDATABASE`; the concurrency suite enforces loopback/disposable markers and switches actual roles. It uses observed PostgreSQL lock waits across independent sessions, not serial single-user simulation.

Run `VITE_SUPABASE_URL=https://example.invalid VITE_SUPABASE_ANON_KEY=synthetic-test-key npm test`, `npm run typecheck`, and the release owner's controlled build. The signer is also standalone typecheckable with `tsc --noEmit --target es2023 --module esnext --moduleResolution bundler --lib ES2023,DOM supabase/functions/promotion-image-url/index.ts`.

## Cutover fencing and release procedure

The migration first requests `SHARE ROW EXCLUSIVE NOWAIT` on the legacy request ledger. Any old transaction already writing that ledger makes the migration fail and roll back without waiting in a potentially inverted schedule/order lock order. Do not automatically retry: pause new writes, observe/drain or safely reconcile existing requests, refresh the pending legacy-order/protected-data inventory, and retry the exact reviewed migration only when the gate is clear. No stored unresolved rows is not proof that no transaction is in flight.

In the same atomic migration, the server-owned execution-version column and INSERT fence reject old order-function bodies that entered before cutover but resume before their ledger INSERT afterward. Every business order operation is covered, including create/edit/delivery/cancel and retired sales submission. A client JSON `execution_version` key cannot control the private column. Existing committed receipts continue to replay/reconcile. This protects the accounting boundary; staging still requires coordinated compatible-client rollout, reviewed opening campaigns/images, and the visit owner's separate finalized-evidence fence.

`tests/database/demo/order-promo-cutover.mjs` must run against the exact pre-demo baseline. It uses separate sessions to prove NOWAIT rollback for an active legacy ledger writer and rejection of exact old submit/create/edit function bodies paused before insertion, including an attempted client payload marker. It verifies old committed replay/recovery afterward. Do not apply the candidate before this suite; the suite itself applies it. The supplemental `tests/database/demo/order-promotion-review.sql` runs after the candidate and covers encoded UUID protection, historical conversion, changed quote lifecycles, and optional later visit-ledger recovery isolation.

The additive private ledger column changes whole-row metadata/digests. Review protected-history comparisons and import provenance for forward compatibility; do not rewrite historical stored payload/result hashes or provenance receipts to disguise the new schema.
