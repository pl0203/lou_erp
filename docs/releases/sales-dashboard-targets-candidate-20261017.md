# Sales dashboard and monthly targets: unpublished candidate

Base: `d7e669e3b1a2066fca81448997b4b3bbd8e57873` (pl0203/lou_erp).
Status: local implementation and synthetic testing only. No push, deployment, hosted database change, permission grant, account change or production action is included in this work.

## What changes

- Personal daily priorities and five separate outcomes: distinct PO count, ordered PO value, delivered PO value, distinct shipped CO count, and reported CO sales. These stages are never added together or called a conversion rate.
- Manager team performance by salesperson; Sales Head scope follows verified descendants. Individual targets roll up once, including a manager's own exclusively assigned portfolio where present.
- Monthly target menu with proposal, saved drafts, review, submission, Head OR Director approval, reasoned return/revision, and immutable audit evidence. Managers/reviewers can expand the latest 100 plan events, with a truncation notice, to inspect before/after target values, reasons, actor/time and prior-version links. Salesperson projections omit that history. Director uses the existing `executive` role. No self-approval.
- Three independent monetary target bases. Count targets are not introduced. Unpublished/absent targets and incomplete CO reports do not become zeros.
- Three completed months of assigned-customer history support suggestions; six months provide context. No automatic uplift. Missing historical coverage requires explicit manual review, not invented zero-sales months. Current PO actuals remain exact eligible recorded-ledger totals and can be compared with matching targets; historical coverage is not a blanket gate on current recorded PO results.
- Current-month results are provisional. Completed-month comparisons use the same metric basis and selected authorized cohort; no automatic personnel ranking or employment decisions.
- Small lists remain simple; large lists use search and pagination. Server-backed search, monetary-value sorting and narrowly defined attention filters apply before pagination. Summary totals cover the complete matching scope, not only a page. A filtered customer subtotal is not compared against a full-person target.
- A narrowly scoped existing mobile customer-target color bug is corrected to use sales achievement rather than visit achievement.

## Corrected source interpretation

The latest base migration `20261009061801_unify_store_owner_credit.sql` supersedes the earlier assumption that `customer_manager_assignments` represents supervision only. Its `manager_id` column is the canonical exclusive responsible owner, including a salesperson or leadership member. `users.manager_id` defines supervision. Legacy `customer_sales_rep_assignments` is no longer the ownership authority. No extra personal-portfolio attestation is required.

Historical PO/CO credit remains immutable and separate from current customer ownership used for planning. Transfers require explicit treatment where inherited orders or consignment stock remain credited elsewhere. Published monthly responsibility is frozen rather than silently moved to a new manager. Today’s activity and approval queues independently use current hierarchy, not historical financial responsibility.

## Activation is a separate decision

The front-end defaults off. Dashboard flag: `VITE_SALES_DASHBOARD_V3=true`. Target workflow flag: `VITE_SALES_TARGETS_V1=enabled`, with a matching server capability handshake. SQL defaults disabled and grants no client execution. Installation drafts live under `supabase/sales_targets/v1`, outside automatic migrations.

Before any live application, present the reviewed exact SQL, target project and permission bundle for approval. The proposed access is limited to:

1. A salesperson's own permitted dashboard aggregates and own published target lines. No other person's target plan, customer-history proposal or predecessor details.
2. A manager's direct team and own canonical portfolio, including customer-month history necessary to propose targets. This history can include revenue credited to predecessors outside the manager's previous reporting scope. It is a new narrowly scoped aggregate visibility, not raw PO/CO administrative access.
3. A Sales Head's verified descendant teams and plans; an existing Director can review and approve. Manager proposals may be approved by either one, never by their own proposer.
4. Narrow CO shipment aggregates for the five-KPI dashboard. Existing operational CO administration endpoints and permissions remain unchanged.
5. Draft/save/submit/return/approve/revise commands and actor-scoped reconciliation through new wrappers. No direct target-table grants.

Proposed public wrappers: `pilot_sales_dashboard_v3`, `pilot_sales_target_baseline_v1`, `pilot_sales_target_plan_v1`, `pilot_sales_target_plans_v1`, `pilot_sales_targets_capability_v1`, `pilot_sales_target_command_v1`, and `pilot_sales_target_reconcile_v1`. Their bodies enforce active identity, hierarchy, request scope and capability. Public wrapper visibility never replaces those checks.

## Safe application and rollback plan

- Confirm the exact staging project and latest deployed source before applying anything. Production is excluded.
- Check source schema, function metadata, ownership, hierarchy and assignment constraints. Do not repair accounts or mappings implicitly.
- Install additive schema/functions with capability disabled and wrapper grants absent. Do not convert existing legacy targets or change historical credit.
- Inspect installation and synthetic test evidence. Obtain scoped access activation approval, then separately enable only reviewed wrappers and front-end flags.
- Verify real signed-in roles, phone/laptop rendering, target proposal/approval and staging database binding before any pilot recommendation.
- If validation fails, keep or restore feature flags off, disable the new server capability and revoke only new wrapper execution through an authorized change. Preserve target/audit data for investigation. Do not delete published evidence or automatically drop tables.
- Existing reporting remains available while new capabilities are off; legacy targets keep their original meaning.

## Validation limitations

Synthetic tests are not staging login verification. PostgreSQL runs only in a new temporary loopback-only cluster with synthetic fixtures; hosted database URLs and credentials are not accepted by the runner. AF_UNIX socket creation is unavailable in this runtime; supported loopback testing was used instead and the owned cluster is removed afterward.

Actual browser rendering remains unverified. Local Chromium failed to create its runtime socket. The separate cloud browser could not reach the loopback Vite server. An interactive inline bundle exceeded its review size limit; a smaller no-script static artifact was then rejected because browser policy permits only HTTP/HTTPS URLs. No workaround, external hosting or publication was used after that denial.

The target scripts also passed additive installation and smoke checks against the full existing synthetic source schema through CO stage 08. This does not establish hosted parity.

Final test counts, file hashes and outstanding review findings belong in the accompanying verification receipt, generated after the candidate is stable.
