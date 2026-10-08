# Demo Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Athel-only ordering, stock-backed highlights, safe SJ corrections, approved sales visits, visit notes, store context, and fixed salesperson attribution to staging.

**Architecture:** Keep existing atomic PO and visit transactions. Add four forward migrations for order/promotion accounting, visit workflow/store reads, canonical sales reporting, and approved salesperson assignment cardinality; pair them with typed frontend clients. Isolated implementation domains proceed in parallel, followed by shared-route integration, fresh independent review, and a pinned backend/client rollout.

**Tech Stack:** React 19, TypeScript, React Query 5, Vite 6, Supabase PostgreSQL/Auth/Storage, Vitest 3, PostgreSQL 17 synthetic tests.

**Spec:** `docs/superpowers/specs/2026-10-08-demo-revisions-design.md`

## Global Constraints

- Integration base is verified `18ec064e43466dc8b567482a628b3ef91f886ce4`; preserve the released HR, password-reset, and Padiwan theme/sidebar changes.
- User-visible module labels are Procurement, Sales, and HR; the PO navigation label is Purchase Order. Existing `/athel`, `/girard`, `/ihr` routes and internal IDs stay unchanged. Integrate through the separately approved collapsible-sidebar adapters.
- New PO entry uses Athel administrative authority (`po_admin` and the existing executive administrative role); Girard cannot create new order submissions.
- Returned-SJ dates use `completed_at + interval '14 days'`; other completed-SJ edits retain seven days, and completed PO content remains locked.
- Shortages warn with product, remaining, and requested quantity, then permit Continue. Promo stock never goes negative and excess PO units retain their entered price.
- Assignment credit is server-derived at PO creation, immutable after reassignment, and explicitly Unassigned when no unique active explicit store assignment exists.
- Approved assignment cardinality: one salesperson may own multiple stores; each store has one salesperson. Task 7 removes only the verified salesperson uniqueness restriction, with no invented assignments or historical-credit changes.
- Salesperson new visits and date/store changes require manager approval; the current approved schedule remains effective until an amendment is approved.
- Editable visit notes cannot rewrite photo, timestamp, location, actor, or completed schedule evidence.
- Store PO context is limited to accessible stores and a rolling two-calendar-month status window; latest PO date may be older.
- No historical stock invention, retroactive credit, destructive history cleanup, production deployment, or broad generic PO access expansion.
- All new writes and recoveries require current server-side authority, stable request identity, payload mismatch rejection, and safe uncertain-outcome recovery.
- Do not publish worker branches or apply hosted migrations independently. The coordinator owns the reviewed combined release and exact approval evidence.

## Review Focus

- A second admin consumes the last stock after the first warning: refreshed facts precede a new Continue and no negative balance appears (Task 1/2).
- A schedule amendment commits while a photograph uploads: stale capture cannot attach to the amended store (Task 3).
- A salesperson loses assignment/role while an earlier request has an uncertain result: recovery checks present authority and never duplicates a mutation (Tasks 1/3).
- A legacy Girard order and its linked PO coexist: reporting counts the sale once, without rewriting historical credit (Task 4).
- A new admin PO has no corresponding schedule: its reporting month remains selectable, while unauthorized earliest-order dates remain hidden (Task 4).

## Shared contracts and file ownership

Task 1 owns SQL order/promotion persistence and the contract reference below. Task 2 owns `src/lib/orderTransactions.ts`, promotion/PO frontend adapters, PO pages, and promotion components. Task 3 owns all visit/schedule/customer-context frontend files and its migration. Task 4 owns sales-report functions/adapters/pages. Task 5 alone owns `src/App.tsx`, navigation integration, workflow wiring, and shared test reconciliation.

Task 2 and Task 3 must not both edit `VisitPage.tsx`: Task 3 removes its Girard order entry while preserving historical access elsewhere. Task 2 must not change routes/nav; it returns the exact exports/route requirements to Task 5. Existing migrations are immutable; forward replacements preserve expected metadata/ACL and add reviewed preflight/postflight checks.

### Stable cross-domain interfaces

- Existing `pilot_order_transaction(uuid,text,jsonb)` remains the PO mutation endpoint. New operation `edit_sj_returned_date` accepts `{sj_id, expected_updated_at, sj_date_returned}` and returns the existing transaction receipt shape.
- PO line create/edit/read contracts preserve `product_id: string | null`. Delivered-history identity protection includes it. New PO attribution fields are `sales_person_id_at_creation`, `sales_assignment_source_id`, `sales_attributed_at`, and `sales_attribution_state` (`assigned`, `unassigned`, or legacy).
- `pilot_promotions_v1(p_include_inactive boolean)` returns `{version:1, as_of, items}`. Each item carries `id`, `product_id`, product name/SKU/size, existing tier prices, `is_active`, `stock_managed`, `remaining_quantity`, `stock_version`, `image_path`, and legacy date metadata. Reads use current active-role authority.
- `pilot_promotion_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb)` and `pilot_reconcile_promotion_v1(p_request_id uuid,p_abandon boolean)` use the common durable request contract. Operations: `create_promotion`, `edit_promotion`, `adjust_stock`, `set_active`; exact payload validation lives with Task 1 and is documented before Task 2 consumes it.
- Insufficient stock raises a typed SQL refusal with details `{code:'PROMO_STOCK_WARNING', shortages:[{promotion_id,product_id,product_name,sku,remaining_quantity,requested_quantity,incremental_quantity,shortfall,stock_version}], ack}`. The client retains opaque structured `ack` and resubmits the unchanged draft plus `promo_stock_ack: ack` only after Continue. The server validates exact payload/resource/campaign facts. A SQL refusal rolls back; a network ambiguity reconciles first.
- Task 2 exports safe structural shortage parsing from `src/lib/promotionStock.ts` and allows the additional named visit/promotion RPC families through the common transaction transport without weakening receipt validation.
- `pilot_schedule_transaction_v1(p_request_id uuid,p_operation text,p_payload jsonb)` and `pilot_reconcile_schedule_v1(p_request_id uuid,p_abandon boolean)` own versioned schedule/proposal/note operations. Operations: `propose_visit`, `amend_visit`, `approve_request`, `reject_request`, `withdraw_request`, `create_schedule`, `edit_schedule`, `delete_schedule`, `edit_visit_note`.
- Schedule and editable note versions are monotonic integers. Finalize visit requires `{schedule_id, expected_schedule_version, customer_id, scheduled_date, storage_path, lat, lng, notes}`. Current schedule identity/date/version is verified before inserting evidence; committed retry/recovery is recognized without re-execution.
- `pilot_store_po_context_v1(p_customer_id uuid,p_page integer,p_page_size integer)` returns `{version:1, as_of, latest_po_date, range_from, range_through, items:[{id,po_number,order_date,status}],total,page,page_size}`. Server derives the window; maximum page size 50; client default 20.
- New report contracts retain existing RPC signatures unless a reviewed additive version is needed. Bounded projection helpers must not grant sales direct PO-table access.

## Task 1: Atomic orders, promo accounting, and attribution backend

**Files:**
- Create `supabase/migrations/202610081101_demo_order_promotions.sql`
- Create `tests/database/demo/order-promotions.sql`, `tests/database/demo/order-promo-concurrency.mjs`
- Create `tests/demo/order-promotion-contracts.test.ts`
- Create `docs/demo-order-promotion-contracts.md`
- Update only synthetic fixture/support files necessary for these tests; report shared CI wiring to Task 5.

**Interfaces:** Produces the order/promotion/shortage/attribution contracts above; consumes existing catalog, explicit assignments, PO versioning, and private request ledger. Task 2 consumes its exact JSON shapes. Task 4 consumes immutable new attribution and current PO total.

- [ ] Write failing SQL tests for admin-only submission retirement, old committed recovery, day-14 returned-date updates versus day-7 full-SJ limits, and immutable completed PO content. Run the cases against the baseline and record their expected failure.
- [ ] Implement forward server changes for `product_id` persistence/readback, delivered-history identity, server-derived credit, and the dedicated returned-date operation without changing existing migration files.
- [ ] Write failing conservation tests: quantity 10 with allocation 5 reduced to 6 releases 0, then to 4 releases 1; cancellation releases all slices once; replacement campaign receives only incremental units; released units return to original campaigns. Cover transaction rollback and replay.
- [ ] Implement private ledger/allocation slices, deterministic lock/allocation order, exact warning acknowledgments, and zero-floor balances. Do not auto-allocate historical POs or create stock from history.
- [ ] Write failing role/storage tests for sales-head mutation denial, admin image linking, wrong owner/path, unlinked image signing, and bounded signed-URL behavior. Implement promotion mutation/read functions and reviewed private-bucket policies.
- [ ] Run synthetic PostgreSQL tests with actual authenticated/anon role switching and independent-session stock/assignment races. Document any provider-only storage assertions separately.
- [ ] Update `docs/demo-order-promotion-contracts.md` with exact create/edit/adjust/set-active payloads and error structures, provide synthetic examples, and notify Task 2 before it wires clients.
- [ ] Commit the task's files locally with focused test evidence and self-review. Return the changed-file manifest, migration SHA256, and review report; no hosted apply or publication.

## Task 2: Athel PO/promo frontend and safe shortage continuation

**Files:**
- Create `src/lib/promotionStock.ts`, `src/lib/promotionTransactions.ts`, `src/components/PromoStockWarning.tsx`
- Create `src/pages/athel/Promotions.tsx`; adapt the existing Girard promotion page into read-only presentation if retained.
- Modify `src/lib/orderTransactions.ts`, `src/lib/promotions.ts`, `src/lib/reads/contracts.ts`, `src/lib/reads/orders.ts`
- Modify `src/pages/athel/PONew.tsx`, `POEdit.tsx`, `PODetail.tsx`, `src/components/POLineItems.tsx`, `src/components/ActivePromotionsBanner.tsx`
- Create `tests/demo/promo-stock-warning.test.tsx`, `promotion-admin.test.tsx`, `sj-returned-date.test.tsx`, and `promo-transport.test.ts`

**Interfaces:** Consumes Task 1 RPC contracts and existing `TransactionSender`. Produces Athel `Promotions` default export and read-only highlights. Supplies route requirements to Task 5. It does not own VisitPage or navigation.

- [ ] Write failing transport tests preserving typed refusal details, fresh request after confirmed shortage, unchanged draft+ack after Continue, and reconcile-before-change after an ambiguous response. Include malformed detail rejection.
- [ ] Extend transport options to the named promotion/schedule families while preserving existing operation/receipt validation. Implement typed parsers and message rendering with product, remaining quantity, and requested quantity.
- [ ] Write failing PONew/POEdit tests for shortage Continue/cancel, changed-stock refresh, preserved user prices, repeated clicks, and product identity on edit/import. Implement form integration without clearing the draft on warning.
- [ ] Write failing tests for the returned-date-only control on days 8–14, server deadline/conflict feedback, and no access to full-SJ editing after day 7. Implement the dedicated form/action in PODetail.
- [ ] Write failing promotion tests for admin create/image upload, stock adjustment reason, exhausted versus paused state, image replacement failure, and sales read-only highlights. Implement the Athel page and image upload/link flow using private objects and short-lived authorized image URLs.
- [ ] Add accessible Unassigned/snapshot credit display on admin PO detail, without allowing arbitrary credit edits. Preserve old records' legacy/unknown labeling.
- [ ] Run focused Vitest suites and typecheck. Commit only owned files and return exact exports/route requirements plus test evidence for independent review.

## Task 3: Visit planning, version-bound check-in, notes, and store context

**Files:**
- Create `supabase/migrations/202610081102_demo_visit_workflow.sql`
- Create `src/lib/visitTransactions.ts`, `src/lib/visitPlanning.ts`, `src/components/VisitRequestInbox.tsx`, `src/components/StorePOContext.tsx`, `src/pages/girard/OwnVisitHistory.tsx`
- Modify `src/pages/girard/DailySchedule.tsx`, `ManagerSchedule.tsx`, `VisitPage.tsx`, `GirardCustomerDetail.tsx`, `src/lib/visitCheckIn.ts`
- Create `tests/demo/visit-planning.test.tsx`, `visit-notes.test.tsx`, `store-po-context.test.tsx`, `tests/database/demo/visit-workflow.sql`, `tests/database/demo/visit-races.mjs`
- Modify existing affected visit/date tests to express the approved behavior; preserve unrelated tests.

**Interfaces:** Produces schedule/proposal/note RPCs, bound finalize payload, own-history page, and store-context RPC above. Uses existing private request ledger with operation-aware recovery. Supplies routing requirements to Task 5; coordinates transport name additions with Task 2.

- [ ] Write failing SQL tests showing proposals neither create schedules nor grant access/check-in; own-only proposals; current-manager-only approval; stale versions; duplicate approval; and no self-approval. Implement separate requests/audit tables and scoped read/write/recovery contracts.
- [ ] Write failing tests for manager direct-write denial and controlled pre-check-in store/date amendment. Implement the RPC-only manager write boundary, preserve immutable creator/record timestamps, and retain completed-evidence freeze.
- [ ] Write and run the two-way check-in/amendment race: check-in wins => amendment denied; amendment wins => stale photo finalization denied. Implement expected schedule version/store/date, new-capture recovery UI, and committed-result recovery.
- [ ] Write failing client tests removing today's/tomorrow's edit restriction, proposing own new visits/changes, rendering manager approval decisions, and keeping the original schedule effective while waiting. Implement those flows with dirty-form/repeated-click handling.
- [ ] Write failing atomic note/check-in and later note-history tests. Implement optional note entry, versioned own-note edits, and paginated salesperson own-visit history without changing photo/time/location evidence.
- [ ] Remove new Girard item entry and `submit_sales` actions from VisitPage; preserve a route to historical orders. Verify no hidden callback/direct RPC path remains in current frontend.
- [ ] Write failing store-context tests for authorized stores, latest date older than the range, August 8–October 8 window, month-end clamp, legacy/cancelled statuses, page errors, and identity/cache changes. Implement the narrow read RPC/component on customer overview and before check-in.
- [ ] Run focused Vitest/typecheck, PostgreSQL role tests, and independent-session visit races. Commit owned files and return the migration hash, exact route changes, and review evidence. No hosted apply or publication.

## Task 4: Canonical sales reporting with fixed creation credit

**Files:**
- Create `supabase/migrations/202610081103_demo_sales_reporting.sql`
- Modify `src/pages/girard/GirardPerformance.tsx` and relevant typed report adapters only where necessary.
- Create `tests/database/demo/sales-reporting.sql`, `tests/demo/sales-credit-reporting.test.ts`, and `tests/demo/performance-order-months.test.tsx`

**Interfaces:** Consumes Task 1 attribution fields and legacy Girard links; produces the existing revenue/performance/team-activity outputs without broadly changing table grants. Uses current PO total for new admin POs, stored submission total for legacy Girard rows, and immutable creation timestamp/credit.

- [ ] Write failing parity tests for a legacy linked PO counted once, new assigned and Unassigned POs, later store reassignment, permitted PO value edits, cancellation/status differences, and current actor/team visibility.
- [ ] Implement an explicitly authorized canonical source projection and integrate revenue/performance/team counts while retaining each report's created-at and status basis. Do not backfill historical credit.
- [ ] Write a failing month-selector test with an October credited PO and no schedules viewed in November. Implement earliest authorized month from schedules plus canonical orders through a bounded read contract.
- [ ] Run focused SQL/Vitest tests including report aggregates against independently computed expected totals and no cross-team disclosure. Commit the task and provide review evidence.

## Task 5: Shared integration and complete verification

**Files:**
- Modify `src/App.tsx`, `src/components/AthelNav.tsx`, `src/components/GirardNav.tsx`, `.github/workflows/pilot-safety.yml`
- Modify only affected shared tests/fixture manifests after all component owners finish.
- Create `docs/demo-revision-rollout.md`, `scripts/test-demo-revisions-ci.mjs`, and source/metadata-pinned preflight/readback scripts.

**Interfaces:** Consumes completed Task 1–4 exports, migration files, review reports, and the final published theme commit. Produces one compatible, pinned candidate and its exact migration/client release packet.

Task 5A owns shared routes/navigation, shared-test reconciliation and the composed CI runner. Task 5B independently owns new guarded rollout packet scripts, focused packet tests and the rollout document. Final reviewed Task 7 cardinality migration is also a required integration input. Neither subset may publish or apply a provisional source.

- [ ] Integrate the final theme source without overwriting its branding, focus, contrast, or mobile controls. Resolve shared navigation once: Athel promo administration, sales own-visit history, manager requests, historical orders, and no Girard new ordering.
- [ ] Add all new migrations and real PostgreSQL role/concurrency suites to disposable CI in dependency order; preserve the HR immutable-source checkpoints.
- [ ] Generate and inspect the complete diff against the real upstream base, excluding generated assets, dependency directories, scratch outputs, and credentials. Run full `npm test -- --maxWorkers=1`, `npm run typecheck`, and `npm run build` with the synthetic CI environment.
- [ ] Obtain fresh independent spec/quality review per domain and a whole-candidate review. Fix important findings through reviewed owner changes; rerun affected tests and the aggregate checks after integration.
- [ ] Build target-specific metadata preflight and postflight assertions, stock/assignment/pending-order inventories, expected grants/policies, immutable-data checks, and rollback boundary. No historical data correction is embedded in schema migration.
- [ ] Commit the reviewed integration locally and return exact source/migration hashes, complete test results, and any hosted verification prerequisites.

## Task 6: Authorized publication and pinned staging rollout

- [ ] Verify latest `fix/pilot-database` and final theme source; rebase the candidate logically/with exact diffs if either moved, then rerun affected checks. Publish only the reviewed source/tests under the user's explicit repository authorization, using a nondeploying candidate branch and draft PR when appropriate.
- [ ] Require green CI for the exact published candidate, not merely the old HR commit. Review target metadata/inventory through the approved staging route and obtain any action-time security review required for the exact migration.
- [ ] Apply the reviewed migrations to staging in order, verify committed outcomes and readback, and deploy only the compatible pinned client. A failed or uncertain apply is reconciled before retry; never bypass denied actions.
- [ ] Verify actual role-denial cases, warning/Continue including concurrency, image upload/signing, check-in/approval/notes, two-month store history, attribution/reporting, responsive layouts, and recovery flows with bounded synthetic staging data.
- [ ] Report source/deployment identity, CI and hosted checks, remaining limitations, and completion. Continue monitoring the actual authorized deployment until terminal status; do not declare completion on source publication alone.

## Task 7: Approved store-to-salesperson cardinality

**Files:**
- Create `supabase/migrations/202610081104_demo_sales_assignment_cardinality.sql`
- Create `tests/database/demo/sales-assignment-cardinality.sql`, `tests/demo/sales-assignment-cardinality.test.ts`
- Document exact preflight/postflight and dependency assertions for Task 5's rollout packet.

**Interfaces:** The existing assignment table and attribution contracts remain unchanged. The live constraint is `customer_sales_rep_assignments_sales_rep_id_key = UNIQUE (sales_rep_id)`; retain `customer_sales_rep_assignments_customer_id_key = UNIQUE (customer_id)`, the primary key, and all foreign keys. Actual assigned rows are preserved and no assignment-management UI or new mutation grant is introduced.

- [ ] Write failing SQL cases proving two stores can reference the same salesperson, while a second salesperson for an already assigned store is rejected. Use explicit synthetic users/stores; verify no historical credit rewrite.
- [ ] Verify the actual constraint/index definition and incoming dependencies before dropping the exact uniqueness constraint, without CASCADE. Refuse unexpected equivalent unique indexes, incompatible dependencies, or a different constraint definition. Allow a verified already-desired fixture state only when customer uniqueness and all other invariants remain intact.
- [ ] Implement the additive forward migration with bounded locks and metadata/data preservation assertions; do not copy private staging data into repository tests.
- [ ] Run real PostgreSQL role/schema tests and focused source-contract tests. Check table ACL/RLS/FKs and assignment row snapshots are unchanged apart from the intended uniqueness restriction.
- [ ] Commit locally, report migration hash, red/green evidence, and dependency/readback requirements for independent review. No direct staging apply or assignment inserts outside synthetic tests.

## Plan self-review

All approved requirements map to Tasks 1–4; shared navigation/brand migration and cross-domain tests map to Task 5; publication/deployment evidence maps to Task 6. Transaction transport is owned by Task 2; Task 3 consumes named endpoint options only. VisitPage is owned only by Task 3. Existing report functions are owned only by Task 4. New migrations are ordered 1101, 1102, 1103; no task rewrites historical migrations. The five review-focus cases each have a named verification task. Any later contract correction is recorded before changing another owner's consumer.
