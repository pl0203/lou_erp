# Disposable daily preaggregation experiment plan

Status: source candidate prepared for independent review and disposable CI;
no deployable migration or hosted change.

## Evidence and fixed hypothesis

At commit084d3e6b545db41b3e5e55d07c9b8388f1c7e54c, diagnostic
[run36926471668](https://github.com/pl0203/lou_erp/actions/runs/36926471668)
passed all six exact daily query/oracle/restoration packets on the unchanged30k
fictional fixture with the accepted experimental authorization helper.

The PO-admin actual plan materialized120,004 eligible delivery-line rows and
rescanned them1,003 times, rejecting120,354,009 pairs at the header equality join.
It read514,026 temporary blocks. Manager rescanned60,004 rows503 times, rejecting
30,177,009 pairs and reading129,014 temporary blocks. Estimates at the final
nested join were one row. These are instrumented plan observations.

Actual RPC custom/generic/auto times were manager4216.794/4223.295/4215.998ms and
admin9340.341/9414.004/9377.622ms. Exact response checks and metadata restoration
passed each time. Replanning alone is not supported as the remedy by these data.

## One algebraic change

Keep the original materialized `pos`, visible eligible `lines`, page `days`,
all argument guards, envelope, sort and final zero-coalescing unchanged.
Add a materialized delivery-value relation grouped by `surat_jalan_id` from
visible `sj_line_items` joined to the existing eligible `lines`, summing the
same exact numeric quantity-times-price expression.

Join those per-shipment values to the same visible/nonvoid headers, eligible
header parents and page days. Sum their values by day and retain
`count(DISTINCT s.id)` for shipment count. Both header-parent and line-parent
membership remain required independently. Do not add equality between those
parents, an extra historical-date cutoff, a price/quantity filter or new
fulfillment behavior. A header with no qualifying visible line remains absent;
a header with a qualifying zero-valued line still counts. No floating-point
arithmetic, rounding, clamping or early coalescing is introduced.

## Small correctness gate before timing

Use an empty guarded disposable fixture with the actual installed policies and
accepted helper. Create literal facts exercising:

- multiple lines and shipments, duplicate references to one line, exact cents
- zero quantity and zero price; empty headers and voided headers
- visible header with hidden line, hidden header, both visible but different PO
- line-parent or header-parent outside the date/status cohort independently
- first/last/next day, leap February, year boundary, page1/page2/empty page
- every active role, inactive/missing/NULL identity and rejected arguments

Negative quantities/prices are prohibited by existing table checks. Keep those
checks enabled and verify rejection; do not seed invalid negative business rows
by weakening constraints. The candidate keeps the original signed numeric SUM
expression without adding an absolute-value or positive-only filter.

Compare the full normalized original/candidate JSON response, excluding only
statement timestamp and normalizing numeric representation, and independent
literal daily amount/count expectations for all15 fixed cases. Preserve extra
item keys so unexpected response fields also fail equivalence.
Use a prepared connection with role and filter changes past five calls. Require
negative controls that deliberately drop line-parent membership or count empty
headers to fail the literal oracle, preventing vacuous baseline equivalence.

Original002 query bytes remain the baseline. Store the candidate only under
`tests/database/experiments`; any temporary installed replacement is guarded,
transaction-local, invoker/STABLE/empty-search-path and preserves exact function
OID/signature/defaults/owner/ACL/attributes. Helper/query/policy/index catalogs
must match the expected trial state, then restore exactly after rollback.

## Bounded performance comparison

After the small parity gate, use the unchanged fixed30k fixture and identical
manager/PO-admin September page parameters. Both arms use the same accepted
experimental helper. Run shared-buffer warmups and balanced AB/BA pairs with
complete daily oracle checks outside RPC timing. Two observations per arm are
screening medians, not p95 or pooled capacity evidence.

Capture actual inner plans separately from timed calls to check whether repeated
materialized-line rescans and temporary reads disappeared. Preserve60-second
statement limits and finite process/job bounds; failed or missing observations
fail the gate. No new index, planner setting, RLS policy or helper rewrite.

Any eventual candidate promotion requires the unchanged full6k/30k role and
242-success/33-denial session gates again, plus relevant security/race checks.
The accepted helper's existing correctness evidence remains recorded separately.
No hosted application is included in this plan.

The small matrix has226 observations:113 per arm, comprising eight repeated
manager calls followed by seven active roles across15 cases. Inactive, orphan,
NULL and anonymous identities are separate rejection probes. Four warmup, eight
AB/BA and four instrumented-plan packets each require exact role, full oracle
and restoration markers. Actual runtime SQL compilation/parity and performance
are still unverified until the reviewed candidate runs.
