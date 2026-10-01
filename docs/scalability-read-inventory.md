# Scalable read inventory

Base tree `0eac624305f0e971eb28aba572b971c966de727c`. This inventory reconciles the implemented read-scale slices against the approved scope. Source implementation and isolated tests do not replace final combined or hosted acceptance; see [verification](scalability-verification.md).

| Screen or source | Implemented read contract | Boundary and evidence |
|---|---|---|
| Athel POList | `orders.fetchPOPage` → `pilot_po_page_v1` | Server search across all visible matches, exact count, 10-row pages; `created_at DESC,id DESC`; no 100-customer prefilter |
| Athel SalesOrders; Girard MyOrders; VisitPage order history | `fetchSalesOrderPage` → `pilot_sales_order_page_v1`; selected order uses `detailReads.fetchSalesOrderLines` | Page/count/status pills cover the same active filters; no nested line payload cap; currently authorized parent survives nullable related labels |
| Athel Dashboard and charts | `reports.fetchDashboardData` → summary and daily RPCs | Database aggregates facts; complete daily buckets fail as a group if interrupted; each RPC has its own statement timestamp, not a shared multi-request snapshot |
| CustomerStats; DailySchedule; MyVisits; GirardCustomerDetail | `fetchCustomerStatAggregates` → `pilot_customer_stats_v1` in ≤100-ID batches | Complete batch success required; exact decimal text preserved; absent authorized rows show unavailable rather than zero |
| CustomerPerformance; GirardPerformance; GirardRevenue | Paged aggregate RPCs via `reports.ts` | 50-row display pages plus separate whole-cohort summary; existing date, status, target and percentage populations preserved |
| GirardTeam | Complete allowed directory input plus `pilot_team_activity_v1` batches | Missing activity fails closed; no team KPI computed from a capped history array |
| ManagerCustomers | `pilot_manager_customers_v1` | Current manager-assignment narrowing, exact full summary and paged rows; independent overdue/on-track flags |
| POEdit and PODetail quantities | `detailReads.fetchCompletePOLines` → version-pinned `pilot_po_lines_v1` pages | Complete authoritative active-delivery totals; void history still locks historical identity/pricing; partial or stale loads cannot initialize a writable form |
| PODetail delivery and audit history | `fetchDeliveryPage` and `fetchAuditPage` | 20-row headers/history; SJ date ascending then ID; audit changed date descending then ID; displayed page does not determine remaining quantities |
| Selected delivery correction | `fetchDeliveryForEdit` plus complete selected-SJ lines | Reads all lines and rechecks PO version; failed/interrupted read does not open a partial correction form |
| PONew; POEdit; VisitPage; Promotions catalogs | Explicit projections through complete-read helpers | Stable ID iteration; sort labels after completion; shape-specific product cache keys retain `products` invalidation prefix |
| CustomerList and ProductList | Existing 10-row server pages plus stable ID tie and `literalSearchFilter` | Literal punctuation via escaped `imatch` value; SDK serialization tests pass; actual hosted matching is pending |
| DailySchedule, MyVisits, ManagerSchedule | Complete selected-date-window schedules and batched related IDs | Existing own/team/role predicates preserved; unique ties; backend failures are explicit, not empty schedules |
| GirardCustomers; GirardManagers; manager/team choices | Complete narrow directory/assignment/catalog inputs | Related IDs bounded to 100; counts computed only from complete authorized input |
| Promotion history, active promotions and banner | Complete narrow metadata reads | Existing active/status/price predicates unchanged; no pricing redesign |
| GirardCustomerDetail recent visits and orders | Intentional limits of 10 visits / 20 POs with unique ID ties | These are recent-history displays, not whole-history statistics |
| Earliest-date lookups, individual records, AthelNav count | Intentional 1-row/single/head-count reads | Not full-population arrays; retained bounds do not certify unrelated histories |
| IHR user administration and unrelated write flows | Outside this read-scale change | Account creation/role/invitation remains a separate launch gate; no claim of application-wide capacity |

## Shared guarantees and limits

`readComplete` requests chunks of 500, advances by the actual returned length, validates exact count and unique IDs, forwards errors/abort, and permits one whole-read restart when totals change. `readCompleteQuery` preserves the caller's explicit projection and filters. A missing count, repeated ID or empty page before the known total fails closed. Generic metadata iteration is not a database snapshot: concurrent replacement that leaves the count unchanged may still span revisions. It is not used as a replacement for report SQL aggregation. PO edit/detail state additionally pins its server version.

`rpc.decodeRead` rejects missing/wrong protocol version, malformed pages, unsafe counts and numeric money. The decoder and report adapters jointly validate complete expected monthly/daily buckets. No adapter silently falls back to old raw report queries when an RPC is absent. Report money strings reach exact formatting; report-total numeric conversion is limited to chart presentation. Separately, `detailReads.priceForEdit` validates the exact decimal-to-number round trip before using the unchanged numeric unit-price write payload; unsafe or lossy conversions block editing. The [frozen metric contract](scalability-read-contracts.md) is authoritative for preserved populations and relation visibility.

No export exists in this scope. A future export must iterate the entire authorized result, reconcile counts, and define its consistency rule before shipping. The current complete metadata reads are not an export implementation.

## Evidence and open checks

The integration manifest includes contract/decoder characterizations, simulated cap regressions, partial-read failures, stable ties, complete detail state, report adapters and product-cache navigation. SQL suites check real RLS/ACL and parent/child boundaries around 1,000. The final combined suite must pass all cap regressions. Hosted relation/search behavior, rapid filter/retry/navigation, account switches, mobile rendering, scale/concurrency measurements and the production gate remain separate checks.
