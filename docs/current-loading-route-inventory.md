# Current loading route inventory — not feature or release approval

This explicitly enumerates the 44 titled route paths in exact e95bdaff source. It supersedes only the *current route count* assertion, not the historical motion design. `all-page-motion-coverage.md` remains unchanged as the 38-route motion review. Five employee routes and the separate Stock Return route are the six additions. The independent `tests/ui/route-inventory.test.tsx` checks actual route registrations, inherited role gates and denied identities; this document does not grant a route permission or approve every enclosing loading predicate.

Native browser visual/accessibility/device QA is NOT RUN for this reconciliation.
Existing quiet reads are deliberately not turned into new blocking branches.

| Route | Page or loading owner | Observed treatment / review boundary |
|---|---|---|
| `/login` | `pages/Login` | Public login card remains mounted during session verification; submit remains gated |
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
| `/athel/co/reports` | `pages/athel/co/COMonthlyReports` | Current report list; upload/edit/recovery owners require independent guard review |
| `/athel/co/reports/:customerId/:month` | `pages/athel/co/COMonthlyReport` | Customer-report and nested workspace read states |
| `/athel/co/stock/*` | `pages/athel/co/COCustomerStock` | Stock list and nested stock history |
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
| `/ihr/users` | `pages/ihr/UserManagement` | Directory list; waiting-for-connection title and explanation preserved |
| `/ihr/leave` | `pages/ihr/LeaveManagement` and panels below | Context/access check and all eligible existing nested read states |
| `/athel/co/returns` | `pages/athel/co/COStockReturns` | Separate current return workspace; scoped reads, canonical recovery and authority tests; no loading-guard approval implied |
| `/ihr/employees` | `pages/ihr/employees/EmployeeList` | Employee directory access/loading gate; finite employee overlay |
| `/ihr/employees/new` | `pages/ihr/employees/EmployeeEditor` | New employee form; access gate before private form |
| `/ihr/employees/:employeeId` | `pages/ihr/employees/EmployeeDetail` | Employee detail under employee access gate |
| `/ihr/employees/:employeeId/edit` | `pages/ihr/employees/EmployeeEditor` | Edit form and employee access gate |
| `/ihr/employees/:employeeId/reporting` | `pages/ihr/employees/EmployeeReportingEditor` | Reporting editor and employee access gate |

## Scope and exceptions

`/` and `*` redirect immediately. `/girard/my-orders` remains the explicitly listed compatibility redirect under its Sales-role gate. Forgot/reset-password forms and static landing/outlet surfaces keep the exceptions described above; no fabricated data loading branch is added.

App/ProtectedRoute now use SessionLoading rather than the historical LoadingState auth presentation; the public login card stays mounted during verification. This is observed source behavior, not authorization to relax private route checks. HR continuity uses the separately recovered finite overlay with bounded same-actor display and locked actions; it is not generalized to CO or auth here.

The full current loading predicate comparison and browser input byte-manifest tests remain independent, active release blockers until their own provenance/behavior review is satisfied. This route inventory does not bless those changes or claim device/accessibility testing. The historical 102-branch fixture, original motion document and manifest hashes are untouched.

## Finite auth presentation transition reviewed separately

The compact session-check screen preserves session restoration and desktop login layout. Native mobile and fresh-password sign-in verification are outside this loading-contract evidence. Implementation provenance is b37ab09; this supports the specific session-loading transition, not unrelated loading replacements.

A finite three-owner test overlay removes only the three exact historical LoadingState auth entries while retaining the original bytes. It separately verifies exactly three SessionLoading consumers: private App restoration (`loading && !matchPath('/login', pathname)`), ProtectedRoute (`loading`), and initial Login restoration (`loading && !attemptedLogin.current`). Missing/extra consumers and weakened predicates fail. `tests/auth-loading-transition.test.tsx` exercises neutral single-status presentation, no private child before completed matching-profile read, and a submitted public login remaining mounted and disabled while verification runs (including no second submit). Existing route-role matrix and login completed-error retry tests remain active.

This does not generalize HR retained-data rules to private auth content. CO loading delta and browser-manifest drift remain unresolved; no hashes were repinned. Mobile and fresh-password live verification remain NOT RUN in this reconciliation.
