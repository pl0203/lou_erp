# Padiwan interface acceptance scope and gates

This records coverage, limitations, and required acceptance gates. It is not release approval or a statement that every gate has passed. Terminal results for the exact candidate belong in the release report and PR25, with passed, failed, skipped, and unrun checks distinguished.

## Coverage

- The approved inventory contains 37 page patterns across six application roles: salesperson, Sales manager, Sales head, executive, PO admin, and CO admin. Root/unmatched login redirects and the shared CO shell are counted separately.
- The route suite defines all 222 page/role pairings and 136 protected-route cases for signed-out, missing-profile, inactive-profile, and mismatched-identity states. It also checks real route declarations and inherited gates, role homes, Sales schedule selection, personal own-visits title scope, redirects, and initial loading/main ownership.
- These checks use the real App router, ProtectedRoute, role-home logic, and CO layout, with synthetic authentication and inert leaf screens. They do not establish record access, current server HR capability grants, real navigation behavior, or complete screen behavior. CO-shell landmark checks mock navigation and leaves; they prove shell-owned main targeting, not landmarks inside actual leaf loading/error/private-data states.
- The reachable-source audit includes lazy dashboard charts and embedded performance panels. It guards exact operational-action base classes and identified supporting/field/table font and pale-text utilities. Native disclosures, navigation, fields/file inputs, and explicitly styled domain controls retain their semantics. Source checks cannot measure rendered contrast, font appearance, geometry, or control size.
- Module-level regressions cover synthetic draft, conflict, receipt, recovery, and authority states within their documented scope. Focused authentication required-field/error-focus checks are not exhaustive certification of every form's validation presentation.

## Required candidate gates

1. Complete independent review of the final code and acceptance document. Opening a sibling target editor in the same actor/scope must not silently discard an existing draft; the safeguard requires regression evidence and review before publication. Preserve record-level authority, capability freshness, transaction identity, and unknown-result recovery.
2. Freeze the candidate after all code, test, and document changes. Run these checks on that candidate and record terminal exits, counts, warnings, and any exclusions:
   - `npm test -- tests/ui/route-inventory.test.tsx --maxWorkers=1`
   - `npm test -- --maxWorkers=1`
   - `npm run typecheck`
   - `npm run build`
   - `git diff --check <approved-base>..<candidate>`
   Local unit tests use `VITE_SUPABASE_URL=https://example.invalid` and `VITE_SUPABASE_ANON_KEY=synthetic-test-key`, without hosted credentials. The configured build/preview-backend guard remains enabled. First-party changes must be whitespace-clean; report the retained upstream font-license trailing-space warning separately and preserve its official bytes.
3. Publish the full reviewed candidate to PR25 and require successful CI for that exact published head. In “Pilot safety checks,” “Verify immutable source checkpoint” compares checkout HEAD with the PR head and logs `PILOT_CI_COMMIT_SHA` and `PILOT_CI_TREE_SHA`. The release report/PR25 must identify that commit, tree, and matching CI run; a different head's success does not satisfy this gate.
4. Only after that CI gate, deploy to staging and verify the staging target corresponds to the checked candidate. The authorized live scope is the CO Admin staging subset. Record actual observations and failures; this subset cannot establish all-route, six-role, or device acceptance. No main-branch, staging/production database, or production-deployment changes are authorized by this workflow. Preserve the existing session; if it expires, pause affected checks without an overnight sign-in request. Existing disposable synthetic CI fixtures do not authorize writes to hosted data.

## Blocked or unverified acceptance

- Desktop, 768px, 390px, and 320px layouts; 200% text enlargement and 400% reflow; long values, phone keyboard, actual contrast, and visual focus positioning remain unverified.
- Browser keyboard operation, modal background isolation/focus return, and a real screen reader remain unverified. Unit event assertions do not replace these manual checks.
- Physical-phone camera/GPS, native file selection, and local PDF behavior remain unverified.
- Local rendered acceptance was blocked: Chromium cannot start normally because of an EPERM process restriction, and the supported cloud browser cannot reach the local development server. No alternate launch or tunnel bypass established coverage. Authorized staging live checks are a separate gate, not evidence already obtained.
- The reported HR native date-picker interruption remains unresolved. Required native popup/focus/input traces and safe browser regression acceptance are blocked. HR presentation changes do not establish a picker repair.
- Complete all-form validation, error-summary/focus, and responsive-form acceptance has not been established by the selected component and authentication regressions.

The release report must retain these limitations unless matching acceptance is actually verified. Passing code checks or the authorized staging subset alone cannot establish full interface release readiness.
