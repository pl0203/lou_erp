# Monthly and source-proposal loading: final finite transition

## Authority and scope

The reviewed CO workspace contract requires immutable originals, version-bound confirmation, no duplicate effects, distinct error/loading/empty states, and authority across asynchronous transitions. These are behavior contracts, not acceptance of arbitrary current hashes. Persisted XLSX acceptance is supplementary happy-path evidence only.

The immutable e484102-row fixture and previous HR/auth/seven-CO mappings are unchanged. This separate fixture maps **only** COMonthlyReport1→6 and COSourceProposalResume0→4. SHA256 `201391ce1cc18564a6ce01c511c729633e80c71ff7e3400b0ebfb566ed04eafd`. Old/new exact predicates are readable in `tests/ui/fixtures/monthly-source-loading-guards.json`; full inventory equality remains mandatory. Missing old rows, extra/duplicate owners, missing/new surfaces, foreign rows, fixture tamper and each weakened current predicate are negative-tested. Expected rows are never generated from implementation during tests.

## Expected behavior per predicate

| Owner / predicate | Expected contract and sibling precedence | Actual behavior proof |
|---|---|---|
| Monthly `active ? false` | Authority boundary cannot mount private monthly work until current. Late resolved reads after actor loss cannot reveal it. | monthly-loading-contract actor loss during pending header; StrictMode header cases |
| Monthly `if !report.data` | Header errors precede no-data loader. Transport refresh may retain verified read-only report but locks Edit; authority denial clears it. No false-zero content or writes. | initial transport/42501 and retained transport/42501 cases |
| Monthly `if !name`, catalogue error/data ternaries | Catalogue pending is loading; error or completed absence is explicit failure, never invented customer name or upload permission. | catalogue pending→absence/error cases |
| Monthly `initialSeed===undefined`, `error ? false` | Edit waits for immutable original source and all original quantities. Source failure/mismatch cannot silently seed an empty/new report. Explicit mismatch choice is not an automatic write. | separate source/quantity pending and mismatch cases; source transport failure |
| Monthly saved-row error/data ternaries | Saved unfinished work is read-only; failed saved-row read is not empty successful data. | explicit legacy recovery pending/error, pinned draft/customer versions, no commands |
| Monthly history error/data ternaries | Failed revision history is error, not successful no-history. | posted report history pending/error, no fabricated revision links |
| Proposal `active ? false` | Current authority boundary precedes source-owner work; stale completion cannot mount review. | source proposal actor-loss and retry actor-loss cases |
| Proposal `!read.data&&!retained.current` | Initial proposal read must succeed before owner selection; errors precede loading. Retained original identity/reason may remain read-only on transport failure; fingerprint/version drift locks action and never substitutes draft. | initial pending/error/denial; retained reason DOM identity, wrong versions/fingerprint, no writes |
| Return proposal `!stock.data&&!retainedVersion.current` | Customer version must be read and match original binding before return review; error/denial before loader, retained identity never rebinds. | real return-owner pending/error/denial/version/retained cases |
| Report proposal `!work.accepted` | Root denial and root transport error precede loader. Retry is only existing root read, never initialize/reset/save. Wrong owner version cannot mount review; retained pending receipt enters real recovery before new proposal. | source proposal initial transport regression, explicit retry/no-write and late actor loss; actual unknown/committed request entry |

### Confirmed product bug, not a test waiver

New source-proposal tests exposed missing initial ReportOwner transport-error handling: no accepted data caused indefinite loading. The separately authorized/reviewed minimal runtime correction inserts root error with existing `root.refetch` after denial and before no-data loading. The four loader predicates themselves are unchanged; this required sibling fix and its actual negative tests are part of the evidence. JSX-ancestor hashes alone cannot establish preceding sibling behavior.

## Fixture correction and positive control

Earlier seven report-loading tests used a shared report fixture missing `pilot_co_report_allocations_v1`. The initial loader flash could coexist with a competing non-target fixture error, so that earlier proof is qualified rather than counted as sufficient. Local fixtures in `loading-report-contract` and `monthly-loading-contract` now supply a strict zero-allocation response only for the exact synthetic customer/month/revision/customer-version. Their persisted report row remains quantity7: no allocation evidence is invented, and the successful actual component renders that nonempty row with **Alokasi perlu diperiksa**. Each mandatory source/row/allocation delayed-read test waits through settled non-target reads, proves loader still present with no competing unhandled RPC, then proves its own explicit error replaces loading. All three valid reads have a positive successful-table control. No shared harness or runtime was changed for this repair.

These are synthetic client-port/component tests and strict production decoder checks, not hosted SQL/RLS, native-browser, mobile, or parser-security certification. npm audit was not run; no vulnerability assurance is implied. Full repository regression outcome is reported separately, not inferred from this finite cohort.
