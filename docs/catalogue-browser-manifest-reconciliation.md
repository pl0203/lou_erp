# Catalogue browser input reconciliation — five historical and two status entries

The stale36-entry manifest recovered from the exact e95bdaff source checkout is preserved byte-for-byte in `tests/ui/fixtures/catalogue-browser-manifest-60bb38a.json`, SHA256 `5cb3165b593300b6f7cad6c4fd0b3d98219d46e9d03fff5f3232432df5a68007`. Its historical `public_source_head` metadata says60bb38a; the fixture filename labels that metadata, **not** the commit containing these manifest bytes. It is not a copy of the manifest as stored at commit60bb38a. The earlier reconciliation kept the same36paths and changed exactly five input blob/SHA256/byte-size triples, leaving31entries identical. The separately reviewed status transition below adds two exact updates; the current manifest still has36paths, with29entries identical to the historical fixture. No paths are added, removed or excluded.

## Five historical changes: reviewed behavior, not blanket current-code acceptance

- `src/components/ui/Dialog.tsx`: owner-linked return-focus traversal; restore targets must be connected, enabled and visible, including ancestor inert/hidden states. Pending dismissal and topmost modal ownership remain. Approved workspace§8 requires keyboard/focus restoration; nine existing dialog tests exercise pending, Escape, disconnected fallback, nested owner removal and containment. Native browser behavior is not newly claimed verified.
- `src/index.css`: three narrowly scoped login rules retain visible pending text in the mounted public sign-in form. Explicit Oct26 auth redesign request/verification and auth-transition tests establish this intent. They do not expose private content during authentication.
- `src/styles/ui.css`: four CO status color classes; existing text labels remain authoritative, not color alone. Approved compact workspace/status direction supports this styling-only delta.
- `package.json`: exact ExcelJS4.4.0, saxes6.0.0 and @types/node25.5.2 additions support accepted XLSX parsing, guarded streamed XML and compilation. No other dependency versions are changed here.
- `package-lock.json`:192new public-registry entries; no new hasInstallScript flags. Four existing entries change: root dependency metadata and dev flags for graceful-fs/saxes/xmlchars. Existing versions do not change. The bounded XLSX guard enforces expansion/structure limits and rejects macros/external content; source inspection and accepted sample tests are not a comprehensive parser security proof.

The user explicitly chose to skip a fresh npm audit. No alternative dependency-metadata transmission or audit retry is authorized. No claim of zero vulnerabilities is made. A prior dated audit is not current assurance, and no automatic dependency upgrade/install is part of this reconciliation.

## Provenance versus future candidate identity

`public_source_head=e95bdaff33b9fcb8cd18114f364e23198c290ba3` records the base source of these36public inputs. **It is not the current uncommitted candidate or a future release SHA.** The unchanged browser runner separately requires the real future `CATALOGUE_BROWSER_SOURCE_SHA` to equal checked-out git HEAD, binds manifest bytes to tracked HEAD, binds every source/harness input to tracked blobs, and rejects symlinks/uncommitted inputs before isolated browser execution. Those protections are not removed or redirected to old source.

This metadata change is tested locally; the required exact checkout/CI/native-browser run remains a separate later verification. No CI trigger, publication, production deployment or hosted change is performed here.

## Negative guards

The loading coverage test validates the finite manifest before reading any listed file, requires immutable historical bytes, exact36unique paths, five named historical updates and two named status updates, and verifies all current content hashes/sizes. Mutation tests reject missing/duplicate/extra paths, a traversal path, changed reviewed/unchanged hashes and incorrect source provenance. Consequently future arbitrary current-file drift cannot automatically repin itself into acceptance.


## Separate automatic status-confirmation transition

Public runtime commit `a1308c2b5cc16edbb5920c32d3e8b93bb22c8781` contains the reviewed status fix. Only these two additional existing inputs are rebound; no runtime changes are included in this manifest correction:

- `src/lib/catalogue/useCataloguePage.ts`: validated successful `set_enabled` receipts automatically use the existing canonical read/version checks and acknowledgment path. No optimistic receipt-to-row write or command resend. Failed/denied reads, stale actor/version results, uncertain replies and acknowledgment lock-release failure retain recovery.
- `src/components/catalogue/CatalogueStatusActions.tsx`: close the confirmation dialog after current-owner successful completion, including when automatic acknowledgment has cleared durable recovery. Existing pending, authority and current-owner guards remain.

The status transition is a separate finite overlay; the five earlier bindings and frozen historical fixture remain unchanged. Page integration tests cover both catalogues, one-command dispatch, denied canonical refresh, stale/newer versions, actor changes and failed lock release. Manifest mutation tests reject either old status entry, altered Git blob/SHA256/byte size, missing or extra paths, and provenance drift. The browser runner still binds the manifest and every allowlisted input to the actual checked-out commit; no runner changes or skipped checks are needed.

## Required Tipe feature transition

The preceding sections describe the earlier36-input stage. The Tipe candidate preserves that historical fixture and both earlier overlays. It updates exactly eight existing input bindings: contracts, validation, reads, backend allowlist, transaction sender, form commands, catalogue page hook and query-key synchronization. It adds exactly one dependency, `src/lib/catalogue/productType.ts`, containing the seventeen approved literal categories. There are37current inputs;22historical entries remain unchanged. `public_source_head=9a65660a1418d032e558f9e26104e675b6ffb2e0` identifies the deployment base for this additive feature, not an unpublished candidate SHA.

Behavioral rationale: product reads explicitly negotiate a strictv2 envelope, including nullable legacy classification; customer and v1 read contracts remain strict and unchanged. Product form saves require a valid Tipe and dispatch the domain-separated v2 command through the existing durable request/reconciliation mechanism. Status-only commands remainv1 and keep canonical confirmation. No unversioned fallback, raw writes, price changes, actor-check removal or recovery bypass is introduced. Tests cover missing-type no-dispatch, exact labels, receipt recovery, legacy customer compatibility and actor-bound catalogue reads.

The finite overlay pins exact reviewed dependency bytes; it does not derive expected hashes from current source at test time. Negative tests reject changed hashes/sizes for every updated or added Tipe dependency, missing/duplicate/extra/traversal paths and wrong base provenance. The native browser runner still requires the real tracked future commit and unchanged source-integrity checks. Updating this record is not a claim that browser or database integration verification has run.

The query-key synchronization transition guards cancellation cleanup by the latest per-client generation. A rapid A→B→A regression and mutation test demonstrate that an obsolete sweep cannot delete a newly current actor scope; obsolete identities remain cancelled and removed. Existing authority/actor, StrictMode and unrelated-cache preservation checks remain in force.

## Native Tipe browser scenario

The next finite browser stage adds two exact source dependencies, ProductList and the shared POProductLookup, bringing the allowlist from37 to39 inputs. Historical fixture and prior overlays remain unchanged. The original customer native-browser sequence runs first without removed assertions; a separate synthetic product scenario then verifies the17-option required selector, rejected missing-type dispatch, legacyNULL status compatibility/classification, exact create/edit/status receipts, desktop/narrow/short modal geometry and bold-SKU/two-line keyboard lookup. Native platform primitives and off-origin/worker/websocket restrictions remain unchanged. The harness and new source-contract test are bound to checked-out HEAD. This authored extension is not native rendered acceptance until its actual CI run passes.
