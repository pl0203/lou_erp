# Read-scale verification record

Current tested code: `2158b7926a0711af9a81e09af3f218d3a4448761`, tree `3fb406ecdeaf7eb7871776e179dbe1ad836aae9a`. Evidence below is from 1 October 2026. Documentation updates do not transfer results to changed code or a hosted deployment.

| Gate | Verified evidence | State |
|---|---|---|
| Application/source | [Safety run 36877297581](https://github.com/pl0203/lou_erp/actions/runs/36877297581): 494 tests, TypeScript and production build; independent source review | Passed |
| Normal PostgreSQL security/business checks | Same safety run: real-role/RLS, five migration-drift rejections, 620 policy observations/rollback, order/report/date tests, original/new summary/customer/sales parity, 12 concurrency races | Passed on PostgreSQL 17 CI |
|6k correctness/session checkpoint | [Run 36871610997](https://github.com/pl0203/lou_erp/actions/runs/36871610997), source 17c0bc61 (through 008): seven-role exact ground truth, 242 pooled successes/33 denials and final rollback marker | Passed checkpoint; 009 subsequently tested at 30k and in normal suites |
| Final 30k correctness/session | [Run 36877297640](https://github.com/pl0203/lou_erp/actions/runs/36877297640): exact fixed fixture, all seven active roles plus inactive denial, 242 pooled successes/33 denials, all 11 RPCs 22 successful cases each, default/generic identity/filter transitions, final rollback marker, zero SQL errors | Passed |
| Final 30k sales-plan recovery | Fresh manager auto 2.293 s/forced-generic 2.327 s; formerly the sixth identical call timed out 60 s; exact nullable-label/page/count parity passed | Timeout repaired; latency goal not accepted |
| Hosted staging apply | Fresh read-only baseline, exact guarded bundle/rollback and specific target approval required | Pending |
| Actual JWT/PostgREST and hosted search | Real role/cohort checks, punctuation search, decimal protocol and managed schema cache | Pending |
| Browser/device UAT | Exact deployed source, navigation/report parity, mobile, camera/GPS/Storage proof, role/admin/invitation journeys | Pending or separately recorded; SQL is not browser UAT |
| API/browser p50/p95 and 1/5/10-user load | No accepted 100-request/per-case study on declared hosted tier/network | Unrun |
| Production release | Data reconciliation/import, backup/restore and explicit release approval | Not approved |

## Measured limits

The 30k fixture has 500 POs/month over 60 months, ten lines and two partial shipments per PO, plus seven edge orders; it is a deliberately heavy synthetic workload. Final database size was 225, 654, 451 bytes at the ground-truth checkpoint, not a hosted storage/WAL or capacity guarantee.

Pooled results mix roles, filters and repeated/default/generic modes. Their maxima are observations, not percentiles:

| RPC family | Observed maximum database RPC time |
|---|---:|
| PO page |4.528 s|
| Sales page |2.311 s|
| PO lines |18.042 s|
| Dashboard summary |14.739 s|
| Daily report |15.907 s|
| Customer stats |22.942 s|
| Customer performance |14.008 s|
| Revenue |0.064 s|
| Sales performance |0.113 s|
| Team activity |0.056 s|
| Manager customers |0.010 s|

Separate full-history manager summary calls reached 19.047 s. Future-scale latency remains unaccepted despite exact outputs. Owner plans, direct SQL, pooled correctness and API/browser measurements are different evidence. Do not present these results as meeting proposed API p95 goals below 1 s for lists or below 2 s for summaries.

## Checkpoint history and remaining evidence

Earlier failed trials remain documented in [disposable CI history](scalability-disposable-ci-packet.md): false-green shell propagation was repaired; rejected 005/006 are excluded from deployment; parent-set/scalar policies were proven equivalent before packaging; customer preaggregation and bounded sales enrichment repaired measured repeated scans. Passing later tests does not erase those limitations or authorize hosted changes.

Use the current [staging packet](scalability-staging-packet.md) and [recovery plan](scalability-rollback.md). Record fresh private catalog/content fingerprints and exact target before approval. Verify the assembled atomic packet in disposable PostgreSQL, then actual hosted API/UI on existing small synthetic data. No large hosted fixture or production action follows from the CI results.
