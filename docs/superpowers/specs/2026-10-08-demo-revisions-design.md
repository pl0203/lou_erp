# October 8 demo revisions

Status: written specification and Unassigned fallback approved October 8, 2026. The user also approved proceeding without further spec/plan pauses, while preserving scope and required-permission gates.

## Intent and approval boundary

Make Athel PO Admin the order-entry owner, give sales current stock-backed product highlights, and support manager-approved sales visit planning with useful store context before check-in. Preserve existing transaction, historical-evidence, pricing, and access safeguards.

The user approved the full scope on October 8, 2026, including implementation, testing, and staging deployment. The approval explicitly accepts warning-and-continue for promo shortages, zero-floor promo allocation, excess PO quantities at their entered price, 14-day returned-SJ editing from Complete, manager approval for salesperson date/store changes, editable visit notes, and two-month store PO status.

The user subsequently confirmed: each admin-entered PO counts toward the salesperson assigned to that store when the PO is created. The assignment is snapshotted and is not rewritten by later store reassignment.

The user additionally approved allowing one salesperson to own multiple stores while each store has one assigned salesperson. Remove only the existing one-store-per-salesperson uniqueness restriction after verifying dependencies; preserve store uniqueness, foreign keys, actual assignments, and historical PO credit.

This written specification records the approved scope. Reviewed code/test publication to `pl0203/lou_erp` and staging deployment through `fix/pilot-database` are explicitly authorized. It does not authorize unrelated production deployment, broad security-policy changes, or changes to the concurrent HR work. Publication, hosted migration, and staging verification must be coordinated by the release owner.

## Source baseline and constraints

- Repository: `pl0203/lou_erp`; staging working branch: `fix/pilot-database` (verified through the connected repository).
- Verified staging integration baseline: `18ec064e43466dc8b567482a628b3ef91f886ce4`, including the published Padiwan theme/sidebar, HR Director-route change `bc48d9fbe32495be7a309cab2a680aad210fbd68`, and password-reset change `a66beac0e3667521dd063111ee37f00ce58d84b4`. All three releases passed their exact-source checks. Preserve their routes, public adapter APIs, behavior, and source protections.
- React/TypeScript/Vite frontend and Supabase PostgreSQL/Auth/Storage backend.
- Existing `pilot_order_transaction` and request reconciliation provide atomic writes, actor-derived authority, optimistic PO versions, and idempotent recovery.
- Existing completed PO content remains locked. Delivered line identity and price remain immutable, including voided delivery history.
- Existing check-in finalization atomically writes visit/photo/completion, with server timestamps and immutable completed evidence.
- Current promotion management is in Girard for sales head/executive, is date-based, and has no image or stock quantity.
- `PONew` supplies `product_id`, but PO line SQL currently discards it. Catalog identity must precede reliable promo allocation.
- Current manager schedule UI locks today/tomorrow. There is no salesperson proposal/approval workflow; schedule status `pending` means executable, not awaiting approval.
- A schedule can establish salesperson customer access. Unapproved proposals must not do so.
- Existing store PO reads do not reliably expose new admin-entered POs to assigned sales. Broadening PO header RLS also broadens child-table visibility; use a narrow projection.

## Scope mapping

1. Returned-SJ date editable for 14 days from Complete.
2. Athel PO Admin creates product-highlight promos for sales.
3. New PO entry only through Athel administrative flow; Girard ordering removed.
4. Promos support images and stock; PO entry consumes promo stock; insufficient stock warns and permits Continue.
5. Remove the existing visit date-edit cutoff.
6. Salespeople edit their own visit notes and propose their own visits/date/store changes for manager approval.
7. Add visit notes to check-in.
8. Before check-in, show latest PO date and store PO statuses for the rolling previous two months within existing store access.

## Architecture and ownership

Extend the existing transaction architecture with focused helpers and bounded read/write contracts. Avoid a UI-only stock counter and avoid introducing a general warehouse-inventory subsystem.

Implementation boundaries:

- Orders/SJ: exclusive owner of order RPC integration, PO line catalog identity, returned-date operation, and removal of server-side sales ordering.
- Promotions: promotion schema/ledger/helpers, image storage contracts, administration UI, sales highlight UI, and typed shortage response. Integrate stock helpers through the Orders/SJ owner rather than concurrently rewriting the order RPC.
- Visits/store context: proposal/approval schema and RPCs, check-in note extension, note audit writes, and scoped store PO summary/history.
- Coordinator: shared routing/navigation, migration order, cross-domain contract integration, aggregate checks, review, and release packet.

## A. Returned-SJ date and PO entry ownership

### Returned-date operation

Add a dedicated operation that accepts SJ ID, returned date, expected PO version, and stable request ID. It updates only `sj_date_returned`, associated audit evidence, and the PO resource version.

Authority is the current active Athel administrative authority (`po_admin` and the existing executive administration path). The SJ must belong to the locked PO and must not be voided. Reject inaccessible/invalid targets without exposing unrelated records.

For a completed PO, allow the operation through `completed_at + interval '14 days'`; the deadline is authoritative on the server and displayed consistently by the client. The cutoff must not depend on the editable SJ date or the browser clock. Missing completion evidence fails closed. For incomplete eligible POs, preserve current returned-date editing access.

Retain the seven-day rule for other completed-SJ edits/void operations and retain the immediate completed-PO content lock. Returned-date-only edits do not reconcile fulfillment or change `completed_at`. Do not introduce a new completion window by backfilling the current time.

Use the existing idempotent request/recovery pattern. A stale PO version produces the existing conflict behavior. Audit old/new returned dates with actor and server timestamp.

### Girard ordering retirement

Remove new-order controls and item entry from `VisitPage`, including adding highlighted products to an order. Remove ordinary navigation to the old active submission/review flow; keep historical order records available through a clearly historical view.

Reject all new `submit_sales` operations on the backend, including calls from cached old clients and sales leadership accounts. A previously committed request must remain reconcilable, but a delayed uncommitted submission must not execute after cutover. New PO creation remains in Athel with active administrative authorization.

Inventory pending legacy Girard orders before cutover. Preserve them and their audit links; do not silently delete, cancel, duplicate, or auto-convert them. The release packet must state their reviewed disposition. If legacy administrative conversion is retained during that disposition, it must use the same product/promo accounting path and cannot enable new sales submissions.

### Salesperson credit and KPI continuity

Existing Girard revenue/performance/team order metrics read `girard_orders`. Extend their source contracts to include new admin-entered POs, credited to the store's assigned salesperson at creation as the user confirmed.

The server derives the assignment and records the salesperson ID, assignment-source identity, and server snapshot time in the same PO creation transaction. Do not accept a salesperson ID as authoritative client input, use whoever is viewing the PO, or derive credit afresh when a report runs. Later reassignment, date edits, and ordinary PO edits cannot rewrite attribution. Lock/validate the assignment source during capture so a concurrent reassignment has a defined commit ordering.

Use a unique explicit store-to-salesperson assignment as the source. A historical visit, current viewer, product choice, or salesperson suggestion is not an assignment. The existing code does not expose an assignment-management UI; the target inventory must establish which explicit assignments exist before enabling attribution. The approved fallback is to allow a PO without a unique active assignment, record it as unassigned with a visible label, and include it in store totals without inventing salesperson credit. Do not silently credit it later. Any assignment-management expansion or retrospective correction is a separate scoped decision.

Keep a canonical reporting source identity so one legacy Girard order and its linked PO count once, not twice. Preserve legacy attribution as recorded; do not backfill imported/historical POs from today's assignment. New attribution applies to the approved new admin-entry path after cutover. Legacy conversion retains its original submitter lineage without pretending the conversion is a fresh unrelated sale.

Preserve each existing report's date/status/value contract. Revenue currently includes approved legacy submissions; its new-PO equivalent includes confirmed/in-progress/completed admin POs and excludes cancelled/draft POs. Salesperson performance and team order counts currently include all legacy submission statuses; retain that history and include all new committed admin-PO statuses on the same created-at basis, including cancellation history. Do not turn a count of entered orders into delivered revenue. Existing customer-performance reports already based on PO/SJ data retain their calculations. Test counts, amounts, cancellation, edited PO value, and deduplication explicitly.

Value-source rule: legacy Girard rows retain their recorded submission `total_value`, including existing linked-PO behavior. New admin-entered POs use their current `purchase_orders.total_value`, so permitted quantity/price edits update those report amounts while creation timestamp and salesperson credit remain fixed. Apply each report's status eligibility independently. This rule does not reprice or recalculate historical Girard submissions.

New reporting reads apply current active actor/team authority to the fixed credited salesperson, with nullable authorized customer labels. An unassigned bucket is visible only to existing appropriate administrative/leadership roles, not indiscriminately to salespeople. Implement bounded server projections rather than broadening generic PO/line/audit visibility.

The performance month selector currently derives its earliest month only from schedules. Include the earliest authorized canonical-order creation timestamp as well, so a credited admin PO remains reachable in reports even when that salesperson has no schedule in that month. Preserve bounded/current-authority reads rather than exposing a global earliest timestamp.

## B. Stock-backed promotions

### Promotion model and display

An enabled stock-backed promotion belongs to a validated catalog product and has an uploaded image, opening stock, remaining available stock, and version. Positive stock means running; zero stock means exhausted. An explicit administrative pause remains available. Old date fields must not expire a newly converted stock-backed promo while stock remains.

Promotion administrators are `po_admin` and the existing executive administrative role. Salesperson, manager, and sales-head roles are read-only for promotions. Replace the old sales-head mutation policy and revoke direct browser promotion INSERT/UPDATE/DELETE, routing administrative writes through ledger-aware RPCs. Add the Athel administration route and remove/redirect the old Girard management route to a read-only view. This preserves the existing executive administration exception; “PO-admin-only” describes the Athel administrative workflow and excludes all Girard order entry.

Only one enabled stock-backed campaign per product is allowed at a time, including an exhausted campaign awaiting replenishment. This avoids ambiguous allocation. Pausing/archiving a campaign preserves its allocation and ledger history. Returning quantity to a paused campaign does not reactivate it.

Keep existing price-tier semantics and explicit zero-price support. Promotion stock does not implicitly change PO line prices. A highlight is visible to sales as read-only product/image/remaining-quantity information; it contains no ordering action.

Keep legacy promotion records for history. Before cutover, intended running campaigns require reviewed opening quantities and their images; never invent their stock from old order history.

### Product identity

Persist validated `product_id` on new PO lines. Keep stored historical name/SKU/price snapshots. A catalog selection supplies authoritative identity; manually entered/imported SKU can resolve only to an exact unique normalized SKU (`trim` plus case normalization). Product-name similarity is not identity.

Reject inconsistent supplied product ID/SKU combinations. Ambiguous normalized SKUs require correction. Manual noncatalog lines remain supported where no matching catalog product can be established, but cannot claim a promo allocation. The UI must make an unresolved identity visible instead of guessing.

Historical product-ID backfill is limited to reviewed unambiguous matches and does not rewrite snapshots, quantities, prices, or allocation history.

Carry identity through PONew, POEdit read snapshots, create/edit RPC payloads, document-import application, and any retained legacy conversion. Delivered-history immutability includes `product_id`, even when name/SKU text looks unchanged. Do not reject an unchanged historical line solely because a later catalog SKU edit differs from its stored snapshot; revalidate identity when the line's product actually changes, not during unrelated edits.

### Atomic accounting

Use a server-owned balance and append-only movement ledger. Each allocation has durable promotion, PO, line identity, actor/request identity, quantity delta, event kind, and timestamp. Removing a PO line must not cascade-delete its ledger evidence.

At successful PO creation, allocate from the matching enabled promo. Aggregate all lines for the same product before checking stock. PO writes, allocation changes, balance updates, audit, and request receipt commit or roll back together.

Allocation rules:

- Available promo stock never falls below zero.
- When requested quantity exceeds available stock, allocate only the available units; excess units remain on the PO at their entered price.
- Quantity increases require only incremental allocation; decreases release the applicable allocation, preserving the existing delivered minimum.
- Eligible removed lines release their allocation once.
- Permitted PO cancellation releases its remaining allocation once; existing cancellation/delivery safeguards remain.
- SJ creation does not deduct a second time. SJ returned-date edits do not restock. A void/correction of delivery evidence is not automatically a physical return.
- Stock adjustments use explicit ledger movements and an administrative reason, never a raw balance overwrite.
- Replaying a request returns its prior result without duplicate movement. Reusing an ID with a different payload fails.

The accounting helper must define allocation changes from the previously stored allocation, not merely the currently displayed balance. Aggregate incremental demand after eligible releases within the same transaction, then assign scarce units to stable line identities in a deterministic server order, never current UI order. Concurrent PO changes lock the PO and all affected product/promotion resources in a deterministic order. Campaign changes use a compatible lock order. Successful changes invalidate affected PO and promotion read caches.

Make the incremental rule exact using allocation slices that retain their original campaign identity. If a line increases from old quantity Q to new quantity N, allocate up to `min(N - Q, currently available promo stock)` from the currently enabled campaign for that product. Existing slices stay bound to their original campaigns even after pause/replacement. If quantity decreases, remove unallocated excess first, then release newest allocation slices first in a deterministic server sequence. Thus an order of 10 with 5 allocated promo units can shrink to 6 without returning promo stock, then to 4 by releasing one unit. Replenishing a campaign does not retroactively allocate old excess quantities. Removing/cancelling releases every remaining slice to its original campaign without reactivating a paused campaign. For eligible undelivered product changes, release the old slices and evaluate the new product in the same transaction; preserve delivered identity restrictions.

### Warning and Continue

Show a clear per-product warning before committing an insufficient allocation:

`Stok promo [nama produk / SKU] tersisa [X]; PO meminta [Y]. Tetap lanjutkan?`

Provide a Continue action. Its payload acknowledges the exact edited payload plus product quantities, campaign IDs/versions, available stock, and PO version. The server rechecks the quote and current stock under the transaction lock. If the allocation facts changed, return a fresh review and commit nothing until the admin continues against the new facts. This includes a campaign being paused or replaced, or replenishment removing the shortage: show the current allocation, including zero where no campaign is enabled, and keep entered PO prices unchanged.

The authoritative response must carry a typed SQL refusal code and structured product, remaining, requested, incremental-requested, and shortage quantities. The refusal rolls back all business writes and its request claim. Preserve error details through the client transport; the current generic sender discards structured details and cannot treat an ID-less success response as a stock quote. Continue uses a fresh request identity with the acknowledged payload after a confirmed refusal. For edits, shortage checking concerns newly requested units, not previously acknowledged excess or previously allocated units; the warning still shows the complete requested PO quantity and identifies the additional quantity. A notes-only change or a decrease does not demand a fresh acknowledgment of unchanged old excess. Preserve the form and entered price. A network-ambiguous outcome must reconcile before a changed payload or new request is sent.

### Images and permissions

Use a private promotion-image bucket separate from visit evidence. Validate MIME/type, size, ownership, random immutable path, and expected promotion linkage. Restrict upload/link/replace to current promotion administrators. Authorize the intended active sales audience when minting linked-image signed URLs, with a maximum five-minute lifetime and refresh on an authorized read. Anonymous/inactive/unrelated/unlinked requests cannot mint new URLs or list raw objects. An already minted signed URL is a bearer capability until expiry; do not promise immediate revocation after deactivation or unlinking. Test the bounded revocation behavior explicitly.

An upload alone is not successful publication. Link the verified uploaded object through the promotion write contract. Keep the old linked image until the new link commits. Failed/abandoned uploads may remain private orphans; automatic destructive cleanup is outside this change.

## C. Visits and store context

### Editable schedules and proposals

Remove the current proximity-based date cutoff. Preserve genuine role, ownership, version, uniqueness, and completed-evidence restrictions.

Create a separate visit-request table with request kind (new schedule or amendment), requester, desired store/date, notes, optional source schedule and base version, decision status, reviewer, decision time, and audit history. Unapproved requests never enter `sales_schedules` and never grant customer access or permit check-in.

Salespeople propose only for themselves and only for stores they can currently access. Their currently assigned manager may approve/reject only within the existing team/customer authority. Do not permit self-approval or fabricate a reviewer when no valid manager exists. Existing head/executive oversight remains bounded by its established authority.

Approval atomically locks and validates the request, manager authority, customer access, source schedule/version, and store/date uniqueness. It then creates or changes the approved schedule and records the decision. Repeated approval cannot duplicate schedules. Approval racing check-in must preserve the committed check-in; a stale or already visited amendment fails safely.

Route all relevant manager schedule creation/edit/removal through the same versioned server write boundary and revoke corresponding direct browser mutation permissions during compatible cutover. The existing schedule-origin trigger currently forbids changing `outlet_id` even before check-in; revise only that planned-store restriction for this controlled boundary while retaining immutable creator/created-at/record ID and the separate completed-evidence trigger. For an approved new proposal, `assigned_by` is the approving manager, with requester attribution retained separately in the proposal. Every schedule change increments its version; initial version backfill does not change historical timestamps. Do not add a client-controlled session flag or raw-write escape hatch. Preserve audit/request evidence when an unvisited planned schedule is removed; never cascade away its decision history.

Bind photo upload and finalization to the schedule version and approved store/date actually displayed before capture. Finalization must validate expected schedule version, store, and date under the schedule lock before inserting visit or photo metadata. A store/date amendment that wins first invalidates the old capture attempt; reject it and ask for a refreshed check-in rather than silently attaching old-store evidence to the new schedule. The client must discard the old capture after that confirmed stale-binding refusal and require a new capture. Reject missing bindings from older clients after cutover. Do not invalidate an already committed check-in's recovery merely because an independently editable note changed afterward.

An existing approved schedule stays effective until its amendment is approved. Pending new requests cannot be checked into. Rejected or withdrawn requests remain historical. Approval does not rewrite completed visit identity/date/photo/time/location evidence.

Managers edit eligible planned schedules without the old date cutoff. Changes to a completed visit's factual evidence are not introduced by this feature. Notes are editable through an audited path.

### Check-in and later notes

Add an optional bounded plain-text `Catatan kunjungan` field to the check-in page. Extend atomic visit finalization to save it in the existing `outlet_visits.notes` column with the visit/photo/completion transaction.

Later own-note updates use a versioned, actor-checked operation and record old/new note text with editor and timestamp. They never change checked-in actor, store, schedule linkage, photo, timestamp, or coordinates. Use safe text rendering.

Retain entered notes across recoverable form errors. Recovery metadata stores request identity/hash only, not note contents. If a finalize outcome is unknown, reconcile it before changing the request payload. Display saved notes in check-in detail and existing visit history.

Provide salesperson-accessible paginated own-visit history with note editing and immutable evidence display; the current manager-only history route and four-day schedule view are insufficient for “edit anytime.” Keep own history and scoped team history distinct. Do not broaden access to other salespeople's visits/photos through this route.

### Operation-aware recovery

Provide explicit recovery contracts for schedule proposals/amendments, decisions, manager schedule writes, note edits, and returned-date edits. Each endpoint validates current operation-specific ownership/authority before exposing a receipt; it supports exact-payload replay, mismatch rejection, durable committed receipts, and safe abandonment tombstones. Wrong recovery endpoints cannot expose or abandon another operation. Do not route new salesperson operations through the existing default recovery branch that requires PO-admin authority, or through visit recovery that only accepts finalize_visit. Recovery of committed evidence does not rerun the business action.

### Latest PO and rolling history

Place the store-order summary on the customer overview and before the check-in action, so sales can use it without checking in first.

Return latest PO order date over the accessible store's recorded PO history, plus a paginated status list for the rolling two-calendar-month interval ending today. For October 8, the visible date range is August 8 through October 8. Clamp month subtraction at month-end. Derive and return the range on the server so pagination stays on one defined window.

Preserve status truth: include cancelled and legacy status rows in the recent list, label them accurately, and do not silently reinterpret status or monetary metrics. The latest date can be outside the displayed two-month interval; label it separately. This adds no new sales access to line prices, audit logs, or delivery documents.

Use a narrow server-authorized projection for PO number, order date, status, and required summary metadata. Do not expand generic PO-header RLS solely for this feature. Authenticate active actor and verify current store access on each call, using established assignment/schedule semantics. A proposal never satisfies that check.

Cache by actor, role, store, and window. Revalidate on authority/customer changes; pending or failed reads cannot display a misleading zero or stale other-store result. Maintain pagination, safe missing/access-denied behavior, and loading/error retry states.

## Migration and cutover safety

1. Rebase/reconcile against the exact published HR/password-reset source before release; do not rewrite their migrations or permission grants.
2. Capture actual target schema/function/policy/ACL metadata. Existing synthetic fixtures are test contracts, not a deployable baseline.
3. Use forward additive migrations with source/metadata preflight and explicit postflight checks. Preserve request ledgers, tombstones, import provenance, PO/SJ data, visit evidence, and storage links.
4. Review active promotions/opening stock/images, unmatched or ambiguous SKUs, pending Girard submissions, unresolved requests, and legacy completion evidence before cutover.
5. Do not retroactively deduct historical POs. Link historical catalog identity only where unambiguous and reviewed.
6. Existing manager-created schedules remain effective; new request tables start empty.
7. Apply compatible backend and client changes in a coordinated staging release. Old clients cannot retain a bypass through direct table writes or legacy RPC operations.
8. Verify actual Auth/PostgREST/Storage behavior and final pinned deployment. Rollback after real writes uses a reviewed forward repair or validated restore, not dropping ledgers or reopening unsafe direct writes.

## Verification and acceptance

Use TDD for every change and independent review before integration. Run the existing aggregate frontend suite, typecheck, build, synthetic SQL role/ACL tests, and concurrent-session tests against the final source. Distinguish those results from hosted integration.

Required scenarios:

- Returned-date deadlines immediately before/at/after day 14; other SJ changes still restricted after day 7; completed PO content stays locked; stale version and replay.
- Every role's PO entry permission, including direct RPC calls and cached old clients; prior submission recovery; historical records retained.
- Server-derived salesperson attribution, concurrent reassignment, unchanged credit after later reassignment, explicit unassigned state, no legacy backfill, legacy linked-PO deduplication, report date/status/value parity, and selectable order months without schedules.
- Promo image failure/retry/replacement, restricted object reads, missing prices, zero-price lines, exhausted/paused/replenished state.
- Duplicate SKU lines, invalid identities, exact stock, shortage Continue, stock changing after warning, two admins consuming the same final units, request replay, transaction rollback, quantity decrease/increase, removal/cancellation, and no double deduction on SJ.
- Visit editing today/tomorrow and outside previous range; own versus other salesperson; inaccessible store; manager reassignment/deactivation; duplicate decisions; unique store/date conflict; approval versus check-in race; original schedule remains valid while amendment waits.
- Check-in note save/recovery, later note edit/audit, unauthorized note update, and immutable photo/time/location evidence.
- Two-month boundaries and month-end clamping, latest date older than the window, cancelled/legacy statuses, paging, unauthorized store, reassignment, stale cache, and safe loading/error/empty states.
- Desktop/phone layouts, repeated clicks, Cancel/Back, navigation with dirty form, lost responses, and recovering after reload.
- Regression checks for the password-reset fix and concurrent HR patch.

## Completion evidence

For each staged checkpoint report the exact changed files and migration identifiers, tests run and results, independent-review findings, unresolved blockers, and the pinned source identity. Before claiming staging completion, record the actual migration result, protected-data/readback checks, deployed commit, required CI result, and bounded real-role/browser/Storage verification.

No production deployment, unrelated reporting rewrite, warehouse inventory, automatic historical stock reconciliation, physical returns workflow, or HR redesign is included.
