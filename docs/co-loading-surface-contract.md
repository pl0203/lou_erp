# Finite CO loading surface review — seven owners only

## Intent and provenance

The reviewed CO workspace contract requires explicit upload review, immutable original evidence/revisions, distinct missing versus zero values, source/version-bound confirmation, no duplicate posting, and access preservation across asynchronous transitions. Loading, empty and error states must remain distinguishable. Persisted-source and reload acceptance alone do not establish error or authority handling.

This review maps only the seven owners below to those contracts and independently exercised behavior. It is not permission to change their data/access rules. Runtime implementation provenance: e95bdaff and its CO workspace/compact-table changes. Existing newer legacy-discard and audit changes do not alter these loading predicates.

## Expected behavior and evidence

| Owner | Original → current loading branches | Contract, including preceding siblings not captured by AST ancestry | Behavior proof |
|---|---:|---|---|
| COChangePreview | 2 → 3 | Existing summary/selected-month loading stays exact. New import reopen-identity read must finish without error before readiness; missing labels must never grant exact acknowledgement. | loading-report-contract: delayed/error reopen identities never ready; correction-review: missing identity rejects acknowledgement and exact101-order set remains required |
| COLegacyReportEdit | 0 → 2 | Denied source renders error before missing accepted-data loader. Canonical original rows load only for pinned effective revision; initialization stays disabled until all rows complete; canonical failure is error, not silent empty original. | loading-report-contract: root pending, canonical pending/error, denied-before-loader; correction-review: explicit original seed/version and no implicit correction; legacy-import-harness wrong-scope negatives |
| CORecordedReportTable | 0 → 1 | Any source/rows/allocation failure precedes loading. Table requires all three reads, with immutable revision/customer versions, no current-draft substitution or fabricated totals. | loading-report-contract: each of3mandatory reads separately delayed→failed, no table or commands; legacy-import-harness rejects wrong customer/month/revision; source-authority historical revision denial case only (other legacy cases remain red) |
| COReportRevisionEvidence | 1 → 1 | Original recorded evidence is delegated to its independently gated table. Delta error precedes its own loader; a failed delta is not zero changes or current effective data. | loading-report-contract delta pending→error; legacy-import-harness exact immutable identity and wrong-scope negatives; historical zero display test remains red and is not claimed cleared |
| COStockHistory | 1 → 2 | Parent blocked masks table and disables read. Initial/mid-refresh absent/current data is hidden; error precedes unblocked loading and is never a verified zero. Generation mismatch still requires explicit reload. | loading-stock-contract blocked-no-RPC, pending/refetch→error masks rows; customer-stock generation/pagination/scope tests |
| COStockTable | 0 → 1 | Expanded price batches require completed pinned customer/stock/generation/date read; errors precede no-data/refetch loader. No invented batch quantity/price or fallback to other scope. | loading-stock-contract actual mixed-price expansion delayed→error never renders source batches; strict batch-parent decoder and existing source tests |
| COCustomerStock | 1 → 1 | Invalid period stays validation, not loading. Error precedes table/pending. Valid request without accepted result or during refetch masks numeric table; missing is not zero. | loading-stock-contract pending→transport failure no table/numbers; customer-stock future-period, unavailable-not-zero, generation and exact-page tests |

The fixture is a finite explicit old/new map, not a generated-at-test-time expectation. Original e484102branch fixture SHA256 remains `5c99104f6ce0c648ec921fcf84647325852b181296fad56881a05762a20003f7`; HR overlay remains `b561c84420e69a17025e99b092e063dad46a46b319d697cdbaff6bbf15812b02`. This CO overlay SHA256 is `e2b09f641c3be8ee163ae55f2c0f720bab773e997f589d8394c1a5716c95c6d9`.

## Exact owner mappings

Below hashes are SHA256 of canonical JSON row arrays (sorted object keys, compact separators), not whole runtime file hashes. They bind the reviewed title/predicate substitutions; they do not approve unrelated runtime changes.

| Owner | Before → after count | Before rows SHA256 | After rows SHA256 |
|---|---:|---|---|
| `src/components/co/COChangePreview.tsx` | 2 → 3 | `930f9e2221cb18bc25ab55d39da6f6da2fc9b63674d61f707c61e449b7e33761` | `84e5869dcbcfc02fc6cebaff75dc9197e2cfae56a34745d884197c9a2146e393` |
| `src/components/co/COLegacyReportEdit.tsx` | 0 → 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | `0f414633e812890d7fe8ea840fb5b9a5070d105602387f479b82853d4f1d09a5` |
| `src/components/co/CORecordedReportTable.tsx` | 0 → 1 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | `8be30190cb87a3ff0edbd4c6d9ee798d772005281046513bb282106d821a0d7e` |
| `src/components/co/COReportRevisionEvidence.tsx` | 1 → 1 | `a1bc023e71b2b0dca6253a858bdd5a3d6a21ccfaad2de1658b8d6d04248f5f77` | `cd67bf3b7e3796e4c01c88423e0008e1b1e2793697685673853a44f40e973e28` |
| `src/components/co/COStockHistory.tsx` | 1 → 2 | `aabdb60d1ee7b0488c7cfcc02f7f90799cd64c69000b2b302cd43a752c3815ef` | `3a5dc07a905451fc6a0346241cd507c037811e6f66175c519690687c20a24fdc` |
| `src/components/co/COStockTable.tsx` | 0 → 1 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | `16f0cb0b7594f913801e730268c960cf7e79cb90389245e3c3cd01e23775c297` |
| `src/pages/athel/co/COCustomerStock.tsx` | 1 → 1 | `81d700443dc69677dd2f650d6154ab5f2e6f3eb3f3113b79a5e3c2ed65ad78d7` | `cc18421674bd4e344aacb348b73213e73baa91f7274fa6262169b39d6a12484c` |

## Fail-closed checks and limits

Overlay tests require exact7unique owners and exact5before/11after counts; each before array must match existing historical rows. They reject fixture-byte tamper, missing original guards, duplicate/extra owners, missing/new current surfaces and weakened current predicates. The two unchanged COChangePreview guards are included, not excluded. Actual component tests cover preceding denied/error siblings because a JSX-ancestor inventory alone cannot prove their ordering.

The complete current inventory comparison remains red for unsupported COMonthlyReport and COSourceProposalResume changes. Five browser-manifest byte changes remain red; no manifest or dependency hashes are repinned. No runtime edits. These are synthetic client/read-port behavior proofs, not hosted SQL, RLS, parser-security or native-browser QA. Existing role/currentness/version tests complement, rather than get replaced by, this finite loading map.


### Verification scope disclosure

Expanded8suite check `co-loading-reviewed-groups.log` produced76passed/14failed: the two intentionally unresolved loading checks plus12known preexisting legacy workflow failures (source-authority3, ui/co-reporting9). These whole suites are NOT cleared and their failing assertions cannot be counted as proof. In particular, historical zero-row visual presentation and some old manual-report authority scenarios remain unverified by those old tests. The finite loading proof consists of the new actual-component pending/error tests, passing stock/correction/immutable identity checks, exact source guard review, and the approved expected behavior—not a claim that all adjacent behavior is green. No skips or deletions were introduced to hide the twelve failures.

## Later reconciliation (supersedes the historical remaining-blocker statement above)

The five manifest entries were separately reviewed in `catalogue-browser-manifest-reconciliation.md`, preserving31unchanged entries and original36-entry fixture. The final two owners are now separately mapped in `monthly-source-loading-contract.md`, including the actual source-owner error correction and behavior tests. The original seven-owner fixture remains unchanged. Earlier report pending proofs are explicitly qualified by the missing non-target allocations fixture and are now rerun with a strict scoped allocation response, stable pending checks, and a positive nonempty table control; see that document. None of these later changes retroactively claims the old whole-suite failures were passing.
