# Scalability progress

## Current status as of 1 October 2026

Code `2158b792` / tree `3fb406ec` passes 494 app tests and normal PostgreSQL security/parity/12-race checks. Final 30k run 36877297640 passes all 242 pooled successes/33 denials and rollback, after fixing customer repeated scans and sales sixth-plan failure. Future-scale latency remains unaccepted (observed stats 22.942 s maximum; not p95). Hosted staging apply/API/UI and production release remain gated. The authoritative current package is [staging rollout](scalability-staging-packet.md), with [verification](scalability-verification.md) and [recovery](scalability-rollback.md).

The entries below are historical checkpoints, not current deployment instructions.

## Contract gate

Baseline local commit 487b2b68 is source-tree equivalent to deployed remote 27d988e; tree 0eac 624305f0e971eb 28aba 572b971c966de 727c. Baseline verification: 35 files and 192 tests passed.

Canonical types and semantic contract independently reviewed and approved for interface freeze. Protocol tests observed red then green: 3 passing. Cap regression suite: three intended red failures (0 versus 1500 POs, 10000 versus 50000 outstanding value, 100 versus 101 search matches). No assertions skipped. Full Task 1 fixture/characterization evidence is still being completed.

Ruling: freeze reviewed interfaces before ancillary characterization polishing finishes, allowing isolated SQL/client work to proceed. This changes execution sequencing only; downstream contract changes still require coordinated review. Cost if wrong: contract changes would require coordinated rework before integration.

Ruling: preserve legacy returned PO statuses while limiting new filter choices to the approved subset. Existing all-status rows must remain readable. Cost if wrong: historical rows could otherwise be rejected by a strict decoder.

No database writes, performance measurements, push, or deployment have occurred in this contract work.

## Task 1 evidence follow-up

Named valid response/argument examples now cover all eleven RPCs. Seventeen shared decoding cases were observed red before the adapter existed and passed against the primary client's separately authored decoder. Six small-data characterization tests exercise the unchanged dashboard, statistics, customer/sales performance, revenue, team, and manager-customer reads; all six passed in UTC, Asia/Jakarta, and America/Los_Angeles. The mixed-price SKU quantity and legacy status cases are included. Full local suite at this point: 255 pass, only the three planned pre-migration cap regressions fail. Typecheck and diff-check pass. No SQL execution or live capacity evidence is implied.

The primary client's foundation and decoder commits were imported solely to validate shared fixtures. Their local equivalents are 4f12fdd and dabbffb (upstream worker commits 30bed 26 and ccb 165a); avoid duplicate integration.

## Supporting read candidate

Complete reads now cover owned PO catalogs, promotion metadata, Girard customer/manager directories, schedule windows and related-ID enrichment. Thirteen independent 1, 001-row boundary tests passed after reproducing truncation. The transport bridge requires actual row arrays and exact counts, preserves backend errors, and forwards cancellation. Read failures get explicit retry feedback instead of success-shaped empty totals; six UI error tests passed. Customer statistic cards distinguish missing completed results from loading and preserve exact decimal labels. Intentional customer-history bounds remain 10 and 20 with ID tie-breakers.

Ruling: use PostgreSQL's literal regex director with escaped PostgREST imatch values for customer/product contains search. This preserves literal punctuation, including the LIKE asterisk alias, while keeping existing server-side pagination and RLS. Cost if wrong: the target API could reject a filter, so actual hosted PostgREST punctuation cases remain a staging gate. References: https://www.postgresql.org/docs/17/functions-matching.html#POSIX-METASYNTAX and https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters . Ten serialization/transport tests and two actual-client page-query tests passed; these are not hosted matching tests.

Candidate verification: full local suite 300 pass, only the three planned cap regressions remain red pending list/report integration. Typecheck, production build, and diff-check pass. Build retains its existing large-chunk warning (main JS 218.45 kB gzip); no browser/performance claim is made. No DB write, import, push, or deployment occurred.
