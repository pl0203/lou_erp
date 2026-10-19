# Director calendar and roster correction

Source-only candidate based on verified deployed source 29eb48ab6c088b1bdeaee44ca4e8fad57acb88db. Not installed or published.

## Authorized boundary

An active application executive who is also an active iHR Director can configure company calendars and publish Saturday rosters. Existing global-configure access continues to work. No roles, accounts, grants, calendar data or employee setup are installed by this candidate.

The new computed `calendarConfigure` capability is separate from `configure`, `adjust`, `readPrivate` and `manageAccess`. Generic grant helpers, personal leave exclusion, employee administration, policies, balances, access management and approval-assignment guards remain unchanged. The Director settings tab opens the existing calendar editor directly, not the member administration screen.

## Same-group continuations

The schedule-only list offers a fixed continuation for an active employee or manager whose current group ends in the future. The new interval starts exactly at that end, stays in the same calendar lineage and group, has a finite end inside the latest confirmed calendar, and requires published Saturday rows throughout. No group selector, new assignment, interval replacement, self setup, past/current changes or overlapping memberships are allowed.

The Director command additionally carries the server's source fingerprint covering calendar/registry, predecessor membership, group and dated roster. It is revalidated in the existing mutation path after setup/assignment/scope locks. Expected member versions and database overlap constraints remain enforced. The Director branch does not update any member column: the new membership has its own version and scope invalidation. Generic member guards remain untouched. The normal command envelope preserves idempotency and recovery; a committed replay still requires current Director authority but does not reapply or recheck obsolete data versions.

Reads are scope/actor-bound, strictly decoded and paginated. Loading, errors and revoked authority do not display stale schedule rows. Existing uncertainty metadata storage and dirty-editor guards are reused. Role or active-state changes invalidate scope; calendar authority proof includes current user/member role and active states.

## Separate approved data setup

The proposed data setup remains 20 October–31 December 2026 for the six existing configured employees, unchanged alternating groups, with only 25 December excluded. Cuti bersama on 24 December follows the normal schedule. Old leave/ledger records are not rewritten. 2027 policy/setup remains separate.

That data setup is not part of this SQL candidate. Before any separately approved installation/application, re-read current Jakarta date, active scope, source versions, zero impacts and historical fingerprints. If 20 October is no longer future in Asia/Jakarta, stop and obtain a revised effective boundary. Do not spoof an authenticated actor or bypass public command guards.

## Deployment compatibility

Older clients ignore the additive capability. New clients with an older backend do not admit Director calendar access. Generic non-Director legacy calendar entry remains guarded by the backend. The only overlap with the separate weekly-grid patch is the small LeaveTabs settings hunk; its team-calendar discovery hook must be preserved on integration. No migration file or hosted apply is implied by this candidate.
