# Populated-staging read rollout

Status: review packet, not permission to execute. Its purpose is to validate hosted PostgREST/JWT/UI behavior on the existing isolated staging project. It is not a production release or an accepted future-scale latency result. The exact project identity and baseline fingerprints belong in the private execution packet and user approval. Production and unknown targets are excluded.

## Reviewed source and exact order

Application/source candidate: `2158b7926a0711af9a81e09af3f218d3a4448761`, tree `3fb406ecdeaf7eb7871776e179dbe1ad836aae9a`. Later documentation-only commits may retain that source tree's evidence only when migration/client bytes match. See [verification](scalability-verification.md).

| Ordered migration under `supabase/migrations/` | SHA-256 | Allowed effect |
|---|---|---|
| `202610010001_scalable_order_reads.sql` | `071ea9280adf79b6ba5c0eb405e7b66706332f2ce2e183a9983a312a025614da` | 3 public read RPCs and 2 private guards; scoped EXECUTE grants |
| `202610010002_scalable_report_reads.sql` | `8a7ee2a24e942f1c0d82d48b3d122ad88b25d48a090a88cc35f194d3882f03e4` | 8 public report RPCs and 2 private guards; scoped EXECUTE grants |
| `202610010004_scalable_order_lookup_index.sql` | `9e8d5afba857af858e743b33a516eaf3f240738f7c2a5ea544f8fdc171ba0088` | One nonunique girard_orders(po_id) btree if no usable equivalent exists |
| `202610010007_read_policy_plans.sql` | `7cf626f169b52d993c00724c0ba34ba96438c85e03adea8b2c646a2e1a51c9dd` | 9 guarded policy-predicate changes; replace summary SELECT with exact typed execution |
| `202610010008_customer_delivery_aggregation.sql` | `9bc0fb3cf69cf0273025bfbe7d2af36cce55bde5460cfee3d27fdbeaa2ef868a` | Replace customer report SELECT with equivalent per-shipment preaggregation |
| `202610010009_sales_page_enrichment.sql` | `40f8109d8e5bb449c2ea65ac54843915d80ac3ecd0431aeff33fb661427edd74` | Replace sales-page SELECT with nullable label joins after materialized page |

There is no 202610010003 migration. Earlier 202609300003 is Storage security. Rejected 202610010005/006 live only in `tests/database/experiments/` and must never enter hosted migration discovery. Do not run every repository SQL file, a fixture, topology overlay, bootstrap or reset on populated staging.

Net result: 11 public read RPCs and 4 private validation helpers, all invoker/STABLE with empty search paths; one conditional nonunique index; 9 existing policy predicates changed; 3 of the new read function bodies replaced with measured query plans. The 9 policies are four restrictive SELECT parent-membership predicates (PO lines, PO audit, shipment headers, shipment lines) plus five restrictive active-profile USING/WITH CHECK predicates using statement-scoped scalar role reads. Policy names/commands/roles/permissiveness and all other predicates remain unchanged. Authorization helpers, transaction functions, triggers, table/column grants, business data, Auth identities and Storage objects must remain unchanged.

## Read-only preflight and approval

1. Independently verify the exact isolated staging project in the authorized management surface and API destination. SQL database name, a connection label or a supplied GUC cannot prove project identity. Reject production, aliases and unknown targets. Recheck the browser/connection state rather than relying on historical availability.
2. Run the reviewed private read-only preflight and cost-plan scripts before requesting mutation approval. They pin UTC/search path; capture schema owners/grants, table/column types/defaults/grants, enums, constraints, policies, function security/signatures/body hashes, triggers, indexes and role metadata. Business/profile/ledger and Storage rows return counts/content hashes only. Auth fingerprinting uses explicitly safe identity fields, excluding passwords/tokens. The owner EXPLAIN is cost-only, not RLS or runtime proof.
3. Save the fresh result privately and compare it to the exact migration contracts. All 15 new function signatures must be absent. Unknown prior migrations, changed helper bodies/ACLs, policy/FK drift, rejected experimental indexes or unexpected objects stop the packet. 007 fails closed on these contracts; do not weaken guards or reconstruct hosted policies to make it apply.
4. Establish a short staging no-write window and preserve the baseline/fingerprints, exact source hashes and schema recovery artifact. The scripts do not create a full database or Storage-byte backup. Atomic schema rollback is appropriate for this zero-data-change staging packet; a data restore requires its own verified recovery point and approval.
5. Obtain explicit approval naming the exact staging target, all six files, index lock risk, 9 policy changes, 3 read-function replacements, zero data delta and compatible-client testing. Approval for disposable CI or source publication is not hosted-change approval. Include the precisely bounded rollback action in that approval if automatic recovery is wanted.

## Apply only the reviewed private bundle

The preferred private packet combines the six exact migration bodies into one transaction, removing only their outer BEGIN/COMMIT wrappers; 004's DO body is unchanged. Its wrapper requires fresh baseline/schema fingerprints, expected function absence and bounded locks/timeouts, then verifies only allowlisted metadata changes and zero data delta before COMMIT. Reviewer must verify body identity and wrapper integrity. No apply packet is executable while baseline placeholders remain.

Ordinary CREATE INDEX can briefly block writes. Use the approved no-write window, 5-second lock timeout and 60-second statement ceiling. Do not silently substitute concurrent DDL, raise limits or retry an unknown outcome. The bundle commits all or nothing; a lost response requires read-only state reconciliation before another action. Raw files have independent transactions (004 is one atomic DO statement); if they were applied separately, recover according to the partial-state table in [rollback](scalability-rollback.md), never blindly rerun CREATE FUNCTION.

After a confirmed commit, retain the exact post-state fingerprint and whether 004 created an index or reused one. Verify 15 function signatures/ACLs/security flags and final body hashes; exactly 9 intended policy changes; unchanged untargeted schema/grants/triggers; unchanged business/ledger/Auth-safe/Storage fingerprints. The bundle uses PostgREST's [transactional schema-cache notification](https://docs.postgrest.org/en/stable/references/schema_cache.html#schema-cache-reloading-with-notify); confirm actual API visibility afterward. Unexpected differences stop client enablement and preserve evidence.

## Hosted smoke and client gate

Use existing synthetic staging records. No 6k/30k load, workbook import, new identities or real customer data is authorized here. Additional records/accounts or representative hosted load need their own bounded plan/approval.

- Exercise all 11 RPCs with actual authenticated JWTs through PostgREST for the available sales/manager/head/executive/PO-admin roles. Compare exact IDs, counts, values and nullable hidden labels; verify inactive/missing/unauthenticated denial and cross-team narrowing. Missing roles remain untested, not a pass. Never put tokens/keys in logs.
- Check first/last/empty pages, tied ordering, selected-status counts, literal punctuation search, decimal decoding, zero-price products, older-PO current-month delivery, voided shipments, target history and visit boundaries. Confirm explicit error/retry behavior on API failures.
- Verify the selected preview's build guard actually covers its branch and points to this staging backend. Current `fix/pilot-scale-sql` automatic deployment remains disabled. A guard scoped only to `fix/pilot-database` does not protect another branch. Enable the compatible client only after separate target/configuration verification and authorization; never fall back to capped raw reports.
- Browser smoke includes filters/page changes, detail→edit→cancel/recovery, refresh/deep links, account switch/token refresh and mobile layout. Existing atomic write/recovery flows must continue to work. Zero data delta is the schema-apply gate; later state-changing UAT requires its separately bounded authorization and must record the expected synthetic row changes. Record pass/fail/unrun and exact deployed commit.
- Camera/GPS/Storage proof, invitation/admin provisioning and complete role journeys remain separate launch gates where not already evidenced. Source/SQL tests cannot establish those managed-provider/device behaviors.

## Performance boundary

Normal PostgreSQL CI verifies exact 6k and 30k fixtures, roles and pooled-session correctness; see [evidence](scalability-verification.md). It does not establish hosted capacity or API/browser p95. At 30k, mixed-case observed RPC maxima include customer stats 22.942 s, line pages 18.042 s, daily 15.907 s and summary 14.739 s. Future-scale latency remains unaccepted. The fixture deliberately uses ten lines and two partial shipments per PO.

Retain proposed API p95 goals below 1 s for list/search and below 2 s for summaries as unmet/unmeasured goals. A later accepted performance study needs a fixed representative workload, tier/region, request counts/bytes, warm/cold distinction, at least 100 measured requests per named case after 10 warmups, and 1/5/10-user concurrency. No large hosted fixture is authorized by this packet. An API/UI smoke pass on existing small synthetic data is useful staging evidence, not a future-scale performance claim.
