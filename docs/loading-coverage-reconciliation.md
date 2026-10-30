# Current loading coverage reconciliation — partial, not release clearance

The immutable `all-page-loading-guards.json` is still the 102-branch e484 motion baseline (SHA-256 `5c99104f6ce0c648ec921fcf84647325852b181296fad56881a05762a20003f7`). It has not been regenerated. The old all-page-motion document describes that historical change, not all later runtime behavior.

## Restored reviewed HR/employee delta

`tests/ui/fixtures/hr-continuity-loading-guards.json` preserves the previously reviewed guard rows exactly; descriptive provenance metadata is neutralized for public publication. The public file SHA-256 is `b561c84420e69a17025e99b092e063dad46a46b319d697cdbaff6bbf15812b02`. Independently pinned unchanged guard-row SHA-256 is `abe07e0ca81c5a29a99049750896ed4159baf05e4346cdfc14acd99e6b78b469` (UTF-8 JSON with updates,added property order). This metadata-only change does not authorize any predicate or access change.

The reviewed continuity contract permits previously verified information during a bounded same-session check while actions are disabled. Failure/revocation clears it; cancellation, error, denial, timeout, logout, identity/backend changes and feature exit invalidate display. Display never grants action authority; fresh mounts and reopened private readers require completed reads.

The finite overlay names 12 owners/30 HR loading guards, with exact before/after predicates, plus two employee UI access/loading surfaces. HR implementation provenance is commit379e366 and employee release dcc6d1c. All 12 recovered after-groups exactly match the current e95 source. Historical received/returned SJ mapping remains separate and exact.

Tests pin both fixture byte hashes, require exact/unique mapped owner names and before rows, compare the current supported surfaces, and reject missing/tampered overlays, duplicate/unmapped owners, missing baseline guards, unexpected surfaces and weakened predicates. The full current inventory equality remains active and **still fails for unresolved later changes**.

## Not yet reconciled

- The three auth loaders now have a finite separately tested SessionLoading mapping; request/verification provenance and exact guards are documented in current-loading-route-inventory.md. This does not clear the CO or browser-manifest blockers.
- Four old CO loading surfaces became 19 across workspace/report/source-recovery changes (6c46dd8,44ced7a,e95bdaf). Implementation history alone is insufficient to approve all new guard semantics.
- The old browser source manifest differs for Dialog.tsx,index.css,styles/ui.css,package.json,package-lock.json. The latter adds192packages and changes4entries. These exact current-byte bindings remain unchanged, not repinned. Dependency and dialog/CSS changes require their source-backed feature review evidence before updating manifest provenance.
- Current route inventory independently tests44paths. current-loading-route-inventory.md now enumerates them separately; the unchanged historical motion document still describes38. Missing/duplicate/unregistered current route documentation fails independently.

Native browser visual/accessibility/device QA is NOT RUN for this reconciliation. Current117 LoadingState consumers include the separately known promotion identity surface; this count is descriptive, not an accepted replacement specification. No production code, dependency, lockfile, database, permission or hosted state was changed by this reconciliation.
