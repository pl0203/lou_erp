# Usability improvements: 10 October 2026

This candidate follows the six-role first-use review. It starts from staging commit `0a68a747f9e3abca67c06e242d857b261e670cf9` and changes existing interface behavior and explanations. It does not change database migrations, accounting calculations, authorization policies, role grants, or stored business dates.

## Coverage

| Review item | Implemented behavior | Main regression coverage |
| --- | --- | --- |
| 1. Saving and recovery | Ordinary active saves show neutral progress; genuinely uncertain outcomes retain the original durable submission identity and recovery route. Known saved results retain precise canonical-readback errors and their next action. | `transaction-recovery-feedback`, `order-transaction-client`, `usability/visit-saving-feedback`, `co/usability`, existing CO recovery suites |
| 2. Visit rate | Label the existing equally weighted staff-rate mean, its population, individual/final rounding and zero-schedule treatment. Show pooled visit counts separately. An empty population is unavailable. | `reporting-usability` |
| 3. Scheduling conflicts | Customer/day conflicts use actionable Indonesian guidance. A link is offered only for an already visible matching schedule. New drafts and corrected inputs clear stale errors. Date-only inputs reject invalid calendar dates. | `usability/visit-workflows`, `usability/visit-date-and-read-contracts` |
| 4. Sales order handoff | Explain Admin PO responsibility and a handoff checklist using existing workplace channels. Sales does not gain PO creation access or a new notification/request endpoint. | `po-usability` |
| 5. Reporting scope | Put period, population, source basis, filters and completeness beside summaries. Distinguish missing reports, posted zeros, excluded order types and zero personal attribution. Separate this CO from customer-wide report history. Explain different monthly chart source windows. | `reporting-usability`, `dashboard-charts`, `co/usability`, `co/sales-metrics-ui` |
| 6. Lifecycle | Explain that a full active SJ fulfills a PO by shipped quantity; receipt and returned-document dates are separate. CO guidance explains shipment, monthly sales, settlement and closure, and links to a required report month. | `po-usability`, `co/usability`, `co/monthly-report` |
| 7. Pending requests and cadence | Keep a request receipt/status link and a server-backed pending-request summary separate from scheduled visits. Date-specific messages use the selected day. Explain that the old late badge measured customer revisit cadence, not appointment lateness; show the UTC cadence cutoff or never-visited state. | `usability/visit-workflows`, `usability/visit-saving-feedback` |
| 8. Team and personal history | Name personal history explicitly. Team day/person/status links use existing authorized schedule routes. Daily filters do not falsely redefine the existing open-ended recent-visit window. | `usability/visit-team-links`, `usability/visit-workflows`, `usability/visit-date-and-read-contracts` |
| 9. Desktop readability | Keep PO actions sticky, give identity columns space, expose keyboard-focusable overflow and clearer cues, and reduce repeated CO stock warnings while aligning quantities. | `po-usability`, `co/customer-stock`, `reporting-usability` |
| 10. Language and audit | Share Indonesian PO statuses, use readable date-only values and explicitly UTC timestamps, match Promosi navigation to headings/states, and describe audits with faithful technical details available on demand. | `po-usability`, `co/usability`, `demo/promotion-highlights`, `demo/store-po-context` |
| 11. Visit selection | Search authorized customers by company, city and branch/address. Keep native selection keyboard behavior and label assignees with visible role/team context. | `usability/visit-workflows`, `usability/visit-date-and-read-contracts` |
| 12. Money and chart labels | Show small nonzero amounts in full rupiah; larger compact labels name juta/miliar. Average PO value names all filtered POs, with completion count separate. Full branch labels and exact chart values are available in a keyboard-accessible table. | `scalability/money`, `dashboard-charts`, `reporting-usability` |
| 13. Classification and manual items | Explain category independence from the price tier, exact-tier pricing and retained defaults. Manual PO lines are order-only; manual CO SKU identities can be reused for the same customer without creating a global catalog product. | `po-usability`, `co/master-data-access`, `co/usability` |

## Preserved meanings

- The visit-rate percentage is still the existing staff mean, not a newly introduced pooled rate.
- Customer revisit cadence keeps its existing elapsed-time threshold. Scheduling remains date-only.
- Team recent-visit counts keep their existing lower-bound-to-now source window.
- PO completion follows shipped quantities. CO shipment completion is not CO closure.
- CO shipment is not revenue; posted monthly sold allocations remain the revenue source.
- A person with no positive CO allocation does not establish whether a customer has a posted zero report.
- Category, pricing tier, manual price validation, attribution, permissions and transaction payloads remain unchanged.

## Verification and release boundary

The complete non-environment source snapshot was verified against staging blob identities. Environment contents were not used for local verification. All test/build backend values must be synthetic, for example:

```sh
VITE_SUPABASE_URL=https://example.invalid VITE_SUPABASE_ANON_KEY=synthetic-test-key npm test -- --maxWorkers=1
npm run typecheck
VITE_SUPABASE_URL=https://example.invalid VITE_SUPABASE_ANON_KEY=synthetic-test-key npm run build
git diff --check
```

The repository does not define a lint script or install the dependencies named by its ESLint configuration. No new dependency is required by these changes.

Component, contract and rendering tests do not replace authenticated browser acceptance. Before a deployment is called verified, check the combined candidate at approximately 1165–1180px with expanded navigation, keyboard-only controls, edited date submission, normal saves, genuine uncertain-result recovery and role-specific access. No live hosted migration, role change, synthetic-record cleanup or real external transaction is part of this candidate.

The local review branch `fix/usability-findings-local-20261010` has an explicit Vercel no-auto-deploy flag. Staging and existing nondeploy branch flags are preserved. Publication and deployment require separate authorization; production/main is outside this change.
