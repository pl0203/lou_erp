# Padiwan all-page loading and motion review

This document describes the unpublished UI-only motion extension of the approved first pass. The combined review package also contains the separately reviewed SJ received-date feature and its source-only migration, described in `sj-received-date-correction.md`. Base: `e484367a2fae22b4f3530beb30e823aa8bb23d74` on `feat/catalogue-mutations-20261014`.

## Current recovery addendum (2026-10-24)

The historical motion-only description below remains a record of its original scope, not the current HR continuity contract. Subsequently approved HR behavior retains already loaded information during a same-session permission recheck, with actions disabled, for at most 10 seconds. Cancellation, failure, revocation, timeout, identity/backend change, or feature exit clears the protected display. New readers still need genuine completion receipts; retained display is not authority. See `employee-fields-recovery/harness-recovery.md` for approval provenance and verification.

The immutable 102-branch fixture is unchanged. `tests/ui/fixtures/hr-continuity-loading-guards.json` records explicit before/after predicates for 12 HR owners and two new employee loading surfaces; the separate SJ mapping and Procurement identity loader stay exact. Route coverage now includes the five employee patterns.

## Original design and safety boundaries

- One presentation-only `LoadingState` supports compact, list, detail, form and dashboard shapes. Decorative geometry is hidden from assistive technology and static, including while offline. The existing human-readable status remains.
- Newly mounted main-content surfaces fade in over 160 ms. The persistent CO layout does not need a keyed route or an extra wrapper. Existing children and drafts remain mounted when the original code retains them. Parameter changes and tabs that keep the same surface do not force a replay.
- Native dialogs enter over 180 ms with a 4 px movement; the mobile menu enters over 200 ms with a 12 px movement. Closing remains immediate. Focus traps, return-focus, Escape, pending locks, scrolling and navigation ownership are unchanged.
- New animation and transition declarations run only under `prefers-reduced-motion: no-preference`. Shared buttons keep the previous reduced-motion behavior and stable pending footprint. Skeletons do not shimmer or pulse.
- There are no minimum loading durations, artificial waits, delayed state updates, fetch changes, forced route remounts or new retained-data rules. This improves presentation, not database or network latency.
- The motion changes preserve all 102 original eligible loading branches. In the combined candidate, the separately reviewed SJ feature renames the date reread branch to shared received/returned state; an explicit exact test mapping covers only that branch, leaving the original fixture unchanged. The other 101 enclosing error, authorization and pending predicates remain exact. A 103rd identity presentation splits the existing loading/error Notice without changing its condition. Useful offline text and Notice children remain.
- HR private views still hide data while authority is checked. PO/dashboard retained results keep their existing labels; this retention is not generalized to HR or approval screens.
- The motion-only delta changes no library/auth/query/transaction code, database migrations, permissions, deployment configuration, packages or lockfiles. The separate SJ feature's source changes and unexecuted migration remain independently frozen and documented; no hosted state is changed by this combined review.

## Route coverage: 44 current paths (38 original + 5 employee routes + Stock Return)

Every active page below owns `MainContent` directly or through COLayout and receives shared mounted-content/control polish. The retired order-history URL now redirects to the Sales schedule. Sources are relative to `src/`. Shapes describe the changed loading presentation, not a new blocking condition.

| Route | Page or loading owner | Treatment |
|---|---|---|
| `/login` | `pages/Login` | Form-shaped auth loading; existing submit state |
| `/forgot-password` | `pages/ForgotPassword` | Existing form and pending button; no invented read loader |
| `/reset-password` | `pages/ResetPassword` | Compact link verification; invalid-link error unchanged |
| `/landing` | `pages/Landing` | Static chooser; entry and controls only |
| `/athel/dashboard` | `pages/athel/Dashboard` | Existing dashboard/chart skeletons and labelled retained results |
| `/athel/po` | `pages/athel/POList` | Existing responsive skeleton and applied-filter/page refresh disclosure |
| `/athel/po/new` | `pages/athel/PONew` | Existing visible draft and disabled catalogue controls; no blocking skeleton |
| `/athel/po/:id` | `pages/athel/PODetail` | Detail loading; compact delivery-line and version-review status |
| `/athel/po/:id/edit` | `pages/athel/POEdit` | Form initial loading; initialized draft stays under existing ownership |
| `/athel/customers` | `pages/athel/CustomerList` | List loading, including paused/offline wording |
| `/athel/products` | `pages/athel/ProductList` | List loading, including paused/offline wording |
| `/athel/sales-orders` | `pages/athel/SalesOrders` | List loading; approval-line read remains additive |
| `/athel/promotions` | `pages/athel/Promotions` | List, picker and version checks; identity denial stays an error |
| `/athel/co` | `pages/athel/co/COOrders` | List loading |
| `/athel/co/new` | `pages/athel/co/COForm` | Existing visible form and disabled controls; no new blocking condition |
| `/athel/co/:id/edit` | `pages/athel/co/COForm` | Form initial loading only; unsaved/recovery owner preserved |
| `/athel/co/:id` | `pages/athel/co/CODetail` | Detail and history loading; authority/transport distinction unchanged |
| `/athel/co/reports` | `pages/athel/co/COMonthlyReports` | Report list and compact period check |
| `/athel/co/reports/:customerId/:month` | `pages/athel/co/COMonthlyReport` | Customer-report and nested workspace read states |
| `/athel/co/stock/*` | `pages/athel/co/COCustomerStock` | Stock list and nested stock history |
| `/athel/co/returns` | `pages/athel/co/COStockReturns` | Recorded return list, bounded customer/item reads and canonical recovery; quiet reads remain non-blocking |
| `/girard/visit-requests` | `VisitRequestInbox`, `VisitRequestStatus` | List/selected-request status under existing identity/hash keys |
| `/girard/visit-history` | `pages/girard/OwnVisitHistory` | History list and latest-record check |
| `/girard/schedule` | `DailySchedule` or `ManagerSchedule` | Both role branches: schedule list loading |
| `/girard/visit/:scheduleId` | `pages/girard/VisitPage` | Detail and order lines; camera/photo/check-in progress untouched |
| `/girard/customer/:id` | `pages/girard/GirardCustomerDetail` | Customer detail and nested history/photo read states |
| `/girard/outlet/:id` | `pages/girard/OutletDetail` | Existing unavailable state; deliberately not a loader |
| `/girard/targets` | `SalesTargets`, `TargetWizard`, `TargetPlanInbox` | Compact access/wizard status, plan list and audit history |
| `/girard/my-sales` | `MySalesDashboardPanel` or `SalesMetricSummary` | Dashboard shapes in both feature-flag branches |
| `/girard/my-orders` | Compatibility redirect to `/girard/schedule` | Retired legacy page; no old order-history page or menu remains reachable |
| `/girard/promotions` | `ActivePromotionsBanner`, `PromotionImage` | List and compact authorized-image loading |
| `/girard/my-visits` | `pages/girard/MyVisits` | Visit list; inline counters stay inline |
| `/girard/team` | `pages/girard/GirardTeam` | Team/activity list loading |
| `/girard/dashboard` | `CustomerPerformance`, `GirardPerformance`, `MySalesDashboardPanel` | Customer and both new/legacy team branches receive dashboard shapes |
| `/girard/my-customers` | `pages/girard/ManagerCustomers` | Customer list loading |
| `/girard/customers` | `pages/girard/GirardCustomers` | Customer list; separate assignment/editor errors intact |
| `/girard/managers` | `pages/girard/GirardManagers` | Manager list loading |
| `/ihr/employees` | `pages/ihr/employees/EmployeeList` + `EmployeeUI` | Shared access boundary and list loading; retained display never grants actions |
| `/ihr/employees/new` | `pages/ihr/employees/EmployeeEditor` + `EmployeeUI` | Access check and form loading; no invented delay |
| `/ihr/employees/:employeeId` | `pages/ihr/employees/EmployeeDetail` + `EmployeeUI` | Shared detail/access loading; identity and authority invalidation clear display |
| `/ihr/employees/:employeeId/edit` | `pages/ihr/employees/EmployeeEditor` + `EmployeeUI` | Shared form/access loading; actions require fresh authority |
| `/ihr/employees/:employeeId/reporting` | `pages/ihr/employees/EmployeeReportingEditor` + `EmployeeUI` | Shared reporting/access loading; actions require fresh authority |
| `/ihr/users` | `pages/ihr/UserManagement` | Directory list; waiting-for-connection title and explanation preserved |
| `/ihr/leave` | `pages/ihr/LeaveManagement` and panels below | Context/access check and all eligible existing nested read states |

`/`, `*`, and the retired `/girard/my-orders` compatibility URL are immediate redirects. The last retains its existing Sales-role authentication boundary. App's initial authentication boundary and ProtectedRoute's defensive fallback also use LoadingState. There is still one semantic main landmark.

## Nested coverage and intentional exceptions

### iHR

Eligible explicit read states are covered in LeaveTabs, MyLeave balance history, LeaveRequestForm access checks, OwnLeaveHistory list/detail/events, OwnRequestActions, AssignedApprovalInbox/detail, TeamLeaveCalendar, DirectorLeaveOverview, LeaveAdminSettings, LeavePeopleSettings, LeaveBalanceSettings, LeaveAdminRotaPanel, LeaveRotaSettings, and all four private-panel families in LeaveAdminPrivatePanel.

LeaveAdministration/LeaveAdminWritePanels mixed unavailable/error/retry blocks, setup-incomplete states, unverified balances, approval business statuses and LeaveApprovalBadge are not fabricated as active loading. Existing scope rechecks and draft continuity remain in charge.

### CO, Sales and shared details

Eligible explicit read states are covered in COReportWorkspace, COStockHistory, COReportRevisionEvidence, COAllocationDetails, COChangePreview, CODeliveryDialog, COReturnDialog, COEvidenceAttachment, CustomerHistory, SalesOrderItems, StorePOContext, PendingVisitRequests, VisitRequestInbox, VisitRequestStatus, ActivePromotionsBanner, PromotionImage, TargetPlanInbox, TargetAuditDetails and TargetWizard.

TargetWizard pending and attachment checking can include command recovery, so their new compact feedback is additive only. Settlement/correction flows, unresolved-result recovery, source-denial boundaries, document-import progress and camera overlays keep their existing behavior. A skeleton is never used to mislabel an error or a business approval status.

Existing quiet reads are deliberately not turned into new blocking branches: create-PO/CO catalogue reads, PO delivery/audit initial sections, visit order-history/photo-URL acquisition and some attachment/settlement/member-editor reads. Their current disabled/readiness handling and common entry/control styling remain. Inline KPI/date-counter text stays span/paragraph-safe rather than receiving a block skeleton.

`pages/girard/GirardRevenue.tsx` and the retired `pages/girard/MyOrders.tsx` are not reachable from App. CustomerPerformance and GirardPerformance are reachable through named dashboard panel exports and are included. OutletDetail is routed but intentionally unavailable.

## Automated evidence and limits

- The existing route inventory independently tests all 38 paths and six roles, account/role mismatch, inactive/missing identity, public routes and CO main ownership.
- New tests assert exact branch signatures for all 102 preexisting loading consumers plus the identity-loading split, with one explicit integration mapping from the old returned-date state to the separately reviewed shared received/returned-date state. The original e484 fixture remains unchanged. They also check valid block placement, single status/aria-hidden decoration, immediate completion, draft/focus continuity, no route timers/keys, and all new animation declarations actually nested in the no-preference media branch.
- Existing application regressions cover errors, retry, concurrency, recovery, repeated actions, dialogs, navigation and private HR boundaries. The package's verification receipt records final aggregate counts separately.
- The current catalogue-browser source manifest is rebound to the reviewed UI bytes and includes LoadingState. Its allowlisted build is checked separately. Historical demo manifests/snapshots and the iHR SQL-source manifest remain immutable.
- Native browser visual/accessibility/device QA is NOT RUN in this restricted execution environment. jsdom/source tests cannot certify actual pixel geometry, scroll behavior, measured frame smoothness, touch target rendering or OS Reduce Motion integration. No screenshots or measured speed gains are claimed.

The combined review candidate includes the separately reviewed SJ received-date change. The motion delta over its frozen PODetail is only one import and three loading-render replacements; ownership/concurrency guards and all shared date-mode labels are preserved. The combined tests are recorded in the package receipt. Staging publication and backend migration execution still require separate approval.
