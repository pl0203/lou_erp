# iHR leave design: durable approved review text

This is a text reconstruction from the unchanged durable PDF `LOU_iHR_Leave_Design_Review.pdf`, not recovery of the lost original Markdown. PDF SHA-256: b676a9ee95cb2211bb38b7c4a0909623c782319a092a108624bded0c03055092.

The subsequent implementation approval explicitly approved pending reservations and one active request per employee/date. Other proposed real setup values remain unapproved and blocked. The authoritative PDF text follows; page layout whitespace and page footers were removed.

---

LOU iHR leave management design
Written design for approval
2 October 2026


1 Decision for review
Build an employee leave service inside /ihr/leave, with three views: Cuti Saya, Persetujuan, and
Kalender Tim. Directors use their assigned approval inbox only; this leave policy does not give them an
allowance or let them submit their own leave. Give explicitly authorized HR administrators a separate
settings area. Employees should understand their remaining allowance before submitting, approvers
should see only requests assigned to them, and colleagues should see availability without private
reasons.
The agreed policy is a 90-hour annual allowance, available upfront each January 1 for already eligible
employees, with no carryover. It supports hourly, half-day and full scheduled-day requests, including the
alternate-Saturday rota. Directors are approval-only. The confirmed rules and the remaining decisions
are separated below so this document can be reviewed before implementation planning.
Written-design approval is the next gate. A detailed implementation plan follows design approval.
Database changes, staging tests and production deployment require separate review and approval.

2 Confirmed policy and required configuration
Confirmed company policy
   Annual leave allowance is 12 days at 7.5 hours per day, equivalent to 90 hours. This does not define
    allowances for sickness, parental leave or other categories.
   Managers approve requests from their assigned team members. Directors approve requests from
    managers assigned to them. These are alternative one-step routes according to the requester, not
    two approvals for every employee request.
   The company works Monday through Saturday. Groups attend alternate Saturdays. A scheduled
    Saturday is 3.75 working hours and its full-shift absence deducts 3.75 hours from the annual
    allowance. Off-duty Saturdays deduct nothing.
   Employees can request 1, 2, 3, 4, 5 or 6 hours, a half-day of 3.75 hours, or a full scheduled day, and
    can apply across multiple dates. One selected duration applies across the request; different
    durations require separate forms. Full scheduled day means 7.5 hours on a weekday and 3.75 hours
    on a working Saturday. Store exact integer minutes; display hours and an optional day equivalent.
   For already eligible staff, the full 90-hour allowance is granted upfront each January 1 for the
    calendar year. Unused allowance does not carry over to the next year. New-hire first eligibility and
    first-grant handling remain separate HR configuration requirements.
   Directors are outside this leave policy. They approve assigned managers' requests but receive no
    annual allowance and cannot submit their own leave requests under it. No other director absence
    system is included.
   The initial three-view design, private request detail, balance visibility and audited approvals are
    accepted in principle, with employee views shown only to eligible policy members.

Setup must require explicit answers
Unconfigured policy is a visible setup blocker, never an invented default. HR may prepare configuration
without enabling employee submission. Each employee becomes eligible to submit only after their
account, calendar and approval route pass validation.
1. Saturday rota: group names and members, the anchor Saturday and group mapping for the
   confirmed alternate-Saturday pattern, effective membership dates, exceptions and how far the
   published rota extends. Duration-only requests do not require a fabricated AM/PM shift assignment.
2. New-hire first entitlement: confirm the employment start date, verified eligibility date and first-grant
   handling for each newly eligible employee. Established eligible staff receive the confirmed full 90-hour
   grant on January 1; do not defer a person who completes 12 continuous months mid-year to the
   following January or prorate a first grant below the applicable minimum. HR must review late-year first
   entitlement, expiry and transition into the calendar-year cycle. New-hire automation remains disabled
   until that policy is approved. Monthly accrual is outside this release.
3. Opening position: an effective opening date and verified allowances, leave already used and
   existing future approved absences. The system must not grant 12 additional days on top of an
   imported remaining balance or count the same historic absence twice.
4. Calendar: confirm the company timezone, holiday source and any location-specific exceptions.
   Asia/Jakarta is a proposal, not an enabled default. Sunday is proposed as non-working, consistent
   with the stated Monday-to-Saturday week.
5. People and authority: name the HR administrators and their scope; identify the director/executive
   accounts that approve managers; assign an approver for PO Admin, Sales Head and every other
   participating employee. Directors must be marked approval-only and excluded from employee policy
   assignments and annual grant generation. Any participating employee without an eligible approver
   stays blocked until a named alternative is approved.
6. Request rules: required or optional reasons; advance-notice and booking-horizon rules; treatment of
   past dates; whether negative balances are ever allowed. Until explicitly configured, backdated and
   negative-balance requests remain unavailable.
7. Cancellation and visibility: the permitted cancellation window; who can approve cancellations if the
   original approver is unavailable; which team members may see each other in the calendar. A private
   request audience does not automatically authorize the same people to see all HR records.
The 90-hour bank is the agreed company conversion of the stated company allowance. This document
does not assert that an hours bank is legally interchangeable with every statutory working-day
entitlement. New-hire eligibility, late-year first entitlement and immediate expiry need HR/legal review
before those accounts are enabled; the approved January 1 cycle for established eligible staff must not
erase a first entitlement. Use verified employment dates, never Auth account creation, invitation date or
the date an employee first logs in. Do not add automatic deductions or recovery from termination pay.
The recommended balance treatment reserves allowance while a request is pending. Confirm this in
written-design review. The page must distinguish those reservations from approved usage.
The proposed MVP records dates and one duration selection rather than clock times. It permits one
active leave request per employee/date. This supports the requested choices without inventing shift-start
or unpaid-break rules. The same-date restriction is a technical recommendation for approval in this
written review, not an already confirmed company policy. Exact from/to times and multiple separate
requests on one date would require a revised interval-based overlap design and confirmed working-time
rules.

3 Scope and alternatives
The recommended approach adds a small, dedicated leave domain to the existing React and Supabase
application. It reuses authentication, navigation and transaction-safety patterns while defining its own
permissions, calendar and balance model.
A page-only tracker would be quicker but could not reliably protect balances, private reasons or
concurrent decisions. A full HR/payroll engine would add employment contracts, accrual rules and
integrations that are not required to deliver this leave service. Neither is the recommended first release.
The first enabled type is annual leave. HR can see leave-type settings, but additional types cannot
become active until their own deduction, eligibility and privacy rules are explicitly approved. The 12-day
annual allowance must not be applied to every category.
The request form supports one duration choice: 1-6 hours, half-day (3 hours 45 minutes), or full
scheduled day, across one or more dates. A read-only per-date preview applies that same selection to
every scheduled date. Different duration choices require separate forms; there are no editable per-date
duration rows.
A fixed-hours or half-day choice keeps its exact duration on each included working date. A scheduled
Saturday permits 1, 2 or 3 hours, or 3 hours 45 minutes; 4 hours or more is invalid. Full scheduled day is
a distinct semantic mode that uses 7 hours 30 minutes on weekdays and 3 hours 45 minutes on working
Saturdays. Off-duty dates and holidays are excluded with an explanation. Do not silently truncate an
invalid fixed-hours preset to fit Saturday.
Exact clock-time intervals, arbitrary free-form minute amounts, multiple active same-date requests,
partial cancellation, direct amendment of submitted requests, payroll integration, automatic accrual and
multilevel approval are deferred under the proposed duration-only MVP. Carryover is prohibited by the
confirmed policy. Amendments use withdrawal or approved cancellation followed by a new request.
Attachments are deferred. No medical certificate field or upload bucket should be introduced until the
company specifies the requirement, permitted readers and retention policy. External email/WhatsApp
messages are also deferred. The MVP uses in-app approval counts and request status updates without
a new notification framework or dependence on email delivery.

4 Employee and approver experience
Cuti Saya
For eligible employees only, show the selected entitlement period, allowance and adjustments,
approved usage, pending reservations and available balance. Directors do not see a personal balance
or leave-request view, and the server denies attempts to create those records for an approval-only
director. Explain that approved future leave is included in approved usage; it is not all leave already
taken. A balance-history drawer explains each allocation, adjustment, reservation, approval and
reversal.
The request form shows the leave type, date range, one duration selector, private reason if enabled,
resolved approver and a server-calculated day-by-day preview. For each date, identify scheduled
working hours, Saturday group duty, an excluded holiday/off-duty day, and the allowance charge. Use
unambiguous labels such as "3h 45m (half-day)" and "7h 30m (full weekday)", with a total in
hours/minutes and optional days. Missing rota coverage or employee membership produces a setup
error, not a zero-day charge. Reject reversed or malformed date ranges, a request with no chargeable
dates, and a fixed-duration choice that exceeds any included working date's capacity. A validation failure
must not save only the valid dates as a partial request.

Before submission show the total charge, affected entitlement periods and remaining available balance.
Submission revalidates the quote on the server. A changed calendar, entitlement, approver or balance
must return a clear conflict and a refreshed preview for review.
Drafts are in-memory form state in this MVP; there is no draft autosave or offline store of private
reasons. Protect unsaved forms on close, navigation and reload. History is paginated and shows
decisions, withdrawal and cancellation progress. Rejected and withdrawn requests remain readable by
their owner.

Persetujuan
Show a server-paginated inbox for the caller's explicit assignments, with separate leave and cancellation
decisions. Each detail shows the requested duration and scheduled capacity on each date, private
request reason when that audience is authorized, relevant balance context and a privacy-safe team
absence view. Require a rejection reason and show the current version before acting.
One request has one active final approver. Directors retain their assigned managers' approval inbox and
the minimum related calendar context, while their personal leave and balance views remain unavailable.
No self-approval is permitted, including for HR administrators. HR administration is not permission to
approve a request. Bulk decisions, automatic approval and an optional HR second approval step are
outside this release.

Kalender Tim and HR settings
The calendar displays approved absences and approved absences awaiting cancellation review. It does
not display drafts, pending requests or rejected requests to peers. Return only the permitted employee
display name, date, approved absence duration and availability label. A partial-day entry must say that
clock times are not recorded; the calendar cannot claim a particular morning/afternoon or continuous
coverage window. A full scheduled-day entry can say absent for the scheduled shift. Do not return leave
type, reason, balance, rejection notes or private history in a peer-calendar response.
Calendar audience is explicitly configured. Until that audience is approved, employees see only
themselves and approvers see the minimum assigned-team availability necessary to review requests.
Cross-team and company-wide views require a separately named scope; application role alone does not
grant them.
HR settings cover named access grants, approvers, leave types, policy versions, entitlement opening
entries, working calendars, Saturday groups/rota and audited adjustments. Configuration changes show
affected employees and requests before saving. There is no silent bulk reassignment or retroactive
recalculation.
Keep the existing mobile-friendly iHR styling. Add role-aware entry points from Athel and Girard.
/ihr/users stays restricted under its existing policy, and employee iHR navigation must not route users
into executive-only /landing or expose User Management controls.


5 Approval assignments and sensitive data boundaries
Existing users.manager_id may suggest an initial approver but is not authoritative. It is optional, its form
does not cover PO Admin or Executive, and it does not enforce a complete leave hierarchy. Explicit
leave assignments must validate active accounts, forbid self-reference, and distinguish employee,
manager and approval-only director responsibilities without changing the global application-role enum
merely to label a director. Director status must exclude the account from leave-policy membership,
grants and request submission at the database boundary, not only hide controls. The mapped

director/executive accounts retain only their explicitly assigned approval scope; that does not grant HR
administration rights.
At submission, store the resolved approver and assignment version. Later team transfers do not silently
give the new manager access to all historical private requests. Pending requests may be reassigned
only through an authorized audited action. A removed or inactive approver loses access immediately;
the request remains pending until an approved replacement is assigned. The replacement cannot be the
requester.
Use separate capabilities for leave configuration/adjustments, private HR request review, and request
approval. Each HR grant names its audience scope. Initial HR grants need explicit approval; nobody
receives full HR rights solely because they are executive, sales_head or po_admin. Ordinary leave
configuration permission must not permit an administrator to expand their own scope, add their own
approval capability or grant themselves extra allowance. An administrator's own entitlement adjustment
requires a different explicitly authorized administrator; access-grant changes require a separately
designated access-management capability.
Do not reuse the existing sales and purchase-order access helper, whose business-data scope is
intentionally broad, or return the full user-management directory payload to employees. Provide a
minimal authorized leave directory. Requesters can see their own data; the current authorized approver
can see their assigned request; any broader HR reader requires an explicit grant. Historical decision
actors retain only the history access deliberately granted by policy, not automatic perpetual access to
private reasons.
Private reasons may contain health information even when the form does not ask for it. Keep them out
of peer responses, application logs, error telemetry, analytics, notification text and browser recovery
storage. Do not collect diagnostic details for annual leave. Production retention and access-review rules
must be approved before real employee data is enabled; no automated purge is included in this release.

6 Working calendars and the Saturday rota
Resolve each employee's scheduled daily working capacity, then charge the approved requested
duration. The confirmed full weekday is 450 minutes, a half-day is 225 minutes, and a scheduled
Saturday is 225 minutes. The annual 12-day allocation is 5,400 minutes. An off-duty Saturday has zero
working capacity and no charge.
Use effective-dated employee group memberships, with no overlapping active Saturday-group
assignment for an employee. Use the confirmed alternate-Saturday rule with an explicitly selected
anchor Saturday and group mapping. Generate a reviewable proposed roster, then publish explicit dated
duty/off entries for each group within a declared coverage interval. The alternating pattern alone does
not establish which group works on any particular date. No anchor or group membership is inferred, and
exceptions require explicit recorded changes.
The quote resolves the employee's group on each requested date. Monday-to-Friday working capacity
comes from the confirmed base calendar, Sunday is non-working once configured, and Saturday comes
from the published group roster. Approved holidays remove the working capacity for the relevant date. A
roster row marked off-duty is distinct from an absent/unpublished row. Missing membership, rota
coverage or calendar version blocks requests touching that date.
Store all capacities, requested amounts and ledger changes as integer minutes, never floating-point
hours or binary day fractions. Valid weekday presets are 60, 120, 180, 240, 300, 360, 225 and 450
minutes. Valid scheduled-Saturday presets are 60, 120, 180 and 225 minutes. The half-day preset
always means 225 minutes; it must not mean half of Saturday's already shortened shift. The "full

scheduled day" action resolves to 450 minutes on a weekday and 225 minutes on a scheduled
Saturday, and its resolved value is shown before submission.
A duration-only record does not establish the time of day taken. The proposed one-active-request-per-
date constraint prevents ambiguous overlap and limits total leave to that day's scheduled capacity. It
trades flexibility for clear accounting: an employee who needs more leave on the same date replaces the
existing request through the normal withdrawal/cancellation flow. Do not infer actual attendance, exact
team coverage or payroll hours from this design.
Store dates as SQL DATE, action times as timestamptz, and the policy timezone as an IANA name.
Calculate company-local "today" server-side; browser timezone does not decide notice or cancellation
deadlines. Never count days by dividing elapsed milliseconds by 24 hours.
Submission freezes each selected date, scheduled capacity, requested minutes,
calendar/rota/membership/policy versions, entitlement-period allocation and charge. Approval must
detect a relevant changed configuration and refuse a stale decision with a clear re-quote/withdraw-and-
resubmit path. Approved requests retain their original charge snapshot. Calendar or group changes
cannot recalculate history or issue refunds automatically. Any change that affects an approved absence
needs explicit review and, if necessary, an audited adjustment or cancellation workflow.

7 Balances and request lifecycle
For each employee, leave type and entitlement period:
   Allowance is the sum of grants and approved credit/debit adjustments to entitlement.
   Approved usage is the sum of approved request charges less approved cancellation reversals,
    including approved future leave.
   Pending is the sum of active submitted-request reservations.
   Available is allowance minus approved usage minus pending.
Ledger events are append-only. For each employee and leave type, effective entitlement periods cannot
overlap and each charged date must resolve to exactly one authoritative period/account. A missing or
multiply matched period is a blocking configuration error. Enforce a unique employee/type/period
account as well as a unique grant source. Period edits cannot remap existing request charges or ledger
entries. A request spanning entitlement periods is allocated by its actual charged dates, and each
affected period must be configured. For established eligible staff, excluding approval-only directors, the
period is January 1 through December 31 and the full 5,400-minute grant becomes effective on January
1 in the confirmed company timezone. Display all affected balances before submission. Annual grant
creation must be server-authoritative, exactly once and recoverable if processing is delayed; a browser
clock or page refresh must not create extra entitlement. Future-year booking must follow the configured
booking horizon and confirmed eligibility, never borrow the current year's remainder.
First entitlement is a separate gate: an administrator must verify employment/eligibility and an approved
first-grant rule before enabling a newly eligible employee. Do not infer an immediate December 31
expiry for a late-year first grant. If the reviewed first-grant rule requires a validity period or allocation
structure incompatible with this calendar-year account model, revise the design before enabling those
employees rather than force the rule into the wrong period.
For the established-staff calendar-year policy, unused allowance expires at the end of December 31 and
cannot fund leave in the next year. This automatic expiry is not applied to an unreviewed new-hire first
grant. Keep prior-period history readable, but show expired remaining allowance separately from
spendable balance. An approved cancellation or adjustment credited to an expired period remains in
that original period; it must never revive old hours as current-year allowance. Each annual grant has a

unique employee/type/period source so a retry, scheduled run or later repair cannot allocate 90 hours
twice. Approval may not shift a request to another entitlement period to bypass expiry.

 Current state         Action and authority                Result and balance effect

 Local draft           Employee submits a valid quote      Submitted; reserve the confirmed minutes

                                                           Approved; release the reserved minutes and
 Submitted             Assigned approver approves
                                                           record usage atomically

                       Assigned approver rejects with
 Submitted                                                 Rejected; release reservation
                       reason

 Submitted             Requester withdraws                 Withdrawn; release reservation

                       Requester asks to cancel within     Cancellation pending; retain usage and calendar
 Approved
                       configured rules                    absence

 Cancellation          Authorized cancellation approver    Cancelled; reverse usage exactly once and
 pending               accepts                             remove calendar absence

 Cancellation          Authorized cancellation approver    Approved; retain usage and record the declined
 pending               declines with reason                attempt


Cancellation is for the whole request in this release. Past-date cancellation is unavailable until its policy
is explicitly configured. The currently valid cancellation approver must be resolved and recorded, with no
self-approval or automatic HR override. There is no destructive deletion of submitted history. A new
request replacing a cancelled one has a new identity and its own validation; it cannot be silently
submitted while the original still occupies any of the same dates.
The same request may not be approved, rejected, withdrawn or refunded twice. A cancellation request
can be declined and later resubmitted if policy permits, but only one successful reversal can exist for an
approved charge. Every adjustment records its amount, affected period, business reason, actor and
timestamp. Every balance-affecting mutation must preserve nonnegative available balance unless a
separately approved exception policy applies. An adjustment may not reduce allowance below existing
approved usage plus reservations; resolve the affected records explicitly before applying such a
reduction. Corrections use compensating entries rather than edits to old ledger rows.

8 Domain boundaries and proposed storage
Keep the page shell small. Separate the personal view, request form/preview, approval detail, calendar
and HR settings. A typed leave client owns request contracts, recovery metadata, query keys and
invalidation. Database functions own eligibility, calendar resolution, authorization, balance arithmetic and
state transitions.
The storage design requires these logical records; exact migration names belong in the later
implementation plan:

 Record                   Responsibility and constraints

 Leave type and policy    Annual type, effective period, permitted durations, notice/cancellation rules and
 version                  explicit configuration readiness

 Calendar version and
                          Timezone, base daily working capacity and approved holidays/non-working dates
 date exceptions

 Saturday groups and      Group definitions, date-bound employee membership and no overlapping
 effective memberships    membership

 Published Saturday       Explicit anchor/group pattern, published group/date duty or off-duty state, 225-
 roster                   minute duty capacity, version and coverage

 Leave assignments
                          Effective approver routing and independently scoped HR capabilities
 and access grants

                          HR-verified employment start/eligibility dates, established-cycle versus first-grant
 Leave eligibility        status and the applicable approved policy; approval-only directors excluded; never
                          inferred from Auth metadata

                          Unique employee/type/entitlement-period identity, non-overlapping periods and
 Leave account            one date-to-period mapping; one row serves as the serialization lock for balance
                          changes

                          Owner, one duration mode/value, date range, resolved approver, status/version,
 Leave request
                          private fields and decision/cancellation metadata

                          Immutable date, capacity and requested-minute snapshots, source versions and
 Request-day charges
                          entitlement allocation; active date occupancy maintained transactionally

                          Append-only grant, reservation, release, usage, adjustment and reversal entries,
 Balance ledger
                          with unique source-event keys

                          Append-only transition/version history, actor, timestamp and required decision
 Request audit events
                          reason in the private audience

                          Per-actor idempotency key, canonical input and result or terminal abandonment
 Private request ledger
                          record; no direct client access


Under the proposed duration-only scope, an active occupancy uniqueness rule prevents two active
requests from reserving the same employee/date, regardless of requested duration. A multi-day
application holds one occupancy per charged date. Historical date/charge snapshots remain after
occupancy is released. If multiple requests on one date are required, stop and revise this boundary to an
approved clock-interval model before implementation.
Indexes should support own history, assigned pending inboxes, employee/period accounts, request-day
date ranges, current assignments and group/date roster lookup. Lists remain bounded and server-
paginated. The implementation plan must establish realistic dataset sizes and measured performance
targets.

9 API and transaction contracts
Proposed versioned contracts:
   leave_context_v1: caller capabilities, readiness errors, policy summary and own period balances.
   leave_requests_page_v1: bounded own history or authorized approval inbox, consistent
    filters/counts and stable ordering.
   leave_request_detail_v1: authorized request detail, charge explanation and paginated private
    history.
   leave_calendar_v1: a bounded date range and permitted audience, returning minimized availability
    fields only.
   leave_quote_v1: authoritative preview derived from the request's single duration mode/value, with
    per-date capacities/charged minutes, exclusions, rota dependencies, period balances and resolved
    approver/version.
   leave_transaction_v1: typed submit, decision, withdrawal, cancellation, audited adjustment and
    configuration/reassignment operations. Each operation has independent authorization and
    validation.
   leave_reconcile_request_v1: recover a committed write or record terminal abandonment before a
    different attempt is permitted.
These are design contracts, not implemented endpoints. Input schemas must reject unknown
operations, malformed dates/UUIDs, unsupported durations, excessive ranges and out-of-scope
identifiers. Server code derives the actor and timestamp from authentication/database state. The
application never accepts the browser as the authority for balances, approvers or leave charges.
For a mutation, serialize the actor/request idempotency key, relevant employee calendar/assignment
state, request row and affected leave-account periods in a documented consistent order. Submission
must also serialize the employee's overlapping date checks. Revalidate authorization and configuration
within that transaction; concurrent access revocation, group changes or rota publication must not leave
a decision using stale authority or a mixed calendar snapshot.
Commit the request transition, occupancy changes, ledger entries and audit event together. Account
locks apply to all adjustments and requests, including concurrent requests with different IDs. Unique
event references independently prevent duplicate usage or refunds. Version checks give competing
reviewers a conflict instead of last-write-wins behavior.
Retries with the same actor/key and identical canonical input return the original result after current
authorization is checked. Reusing a key with different input is rejected. A lost response must be
reconciled; do not generate a new request key and resubmit blindly. Browser recovery metadata
contains only request UUID, input hash and minimal result identity, never reason text or
calendar/employee details. Include backend, actor and form scope in its storage key.
Reusing the existing transaction-sender pattern may need a narrowly scoped adapter because its
current operation names and messages are order-specific. Do not route leave writes through the order
RPC or introduce an unsafe direct-table fallback when a migration is missing.

10 Database access and client consistency
Enable RLS and explicit least-privilege grants on every new exposed table. Anonymous and inactive
accounts have no access. Direct browser writes to transaction-owned records, balances, audit history
and private request ledgers are denied. Security-definer functions use a fixed safe search_path,
validate every operation and cannot be used to enumerate an unrelated person's record through IDs,
counts or distinguishable error details.

Use dedicated leave authorization helpers rather than modify the existing sales/PO helpers. Peer-
calendar responses and full private request detail are separate contracts. UI hiding is never an
authorization control. Do not broaden global table or storage permissions as a convenience.
Query keys include backend, identity, leave authorization scope/version, filters and period/date range.
Cancel obsolete reads; prevent previous-user or previous-scope placeholders from reappearing. Clear
sensitive caches on sign-out, identity or scope change. A same-role manager reassignment can change
leave scope, so identity plus application role alone is insufficient.
After a confirmed mutation or recovered success, invalidate the affected request detail, personal history,
period balances, approval count and calendar. Keep network failures distinct from empty results. Disable
repeated decisions while pending, preserve useful form input after recoverable validation errors, and
surface stale-version conflicts with refresh/review rather than pretending the action succeeded.

11 Verification and release gates
Before release, verification must cover the application, real database permissions and concurrent
operations. The following acceptance requirements define the evidence needed from implementation
and staging tests.
1. Permission matrix: anonymous/inactive callers; employee own versus peer detail; assigned and
   unrelated managers; manager requests routed to named directors; directors denied self-service
   views, direct request submission, policy membership and annual grants while retaining assigned
   approvals; PO Admin/Sales Head/Executive without HR grants; explicitly scoped HR configuration,
   private review and approval grants. Test raw reads/writes, RPCs, guessed IDs, aggregates and
   calendar payloads.
2. Calendar and rota: 450-minute Mon-Fri capacity; alternate 225-minute Saturdays; explicit
   anchor/group mapping; missing versus off-duty roster entries; holidays on a scheduled Saturday;
   group transfers on the effective date; no overlapping membership; unpublished future dates; rota
   edits affecting pending/approved requests; company/browser timezone boundaries, leap days and
   year transitions.
3. Durations, balances and history: exactly 5,400 minutes for the confirmed 12-day/90-hour annual
   grant; 225-minute Saturday deduction; every 1-6-hour/half/full preset; one duration choice across the
   request; rejection of fixed 240-360 minutes on Saturday; full-scheduled-day mode resolving to 450 or
   225 minutes; no silent clipping or hidden per-date overrides; correct hours/minutes/day display;
   opening imported usage without double counting; cross-period requests; January 1 full grants for
   already eligible staff; delayed/retried grant processing; mid-year first eligibility not deferred to
   January; late-year first-grant expiry blocked pending HR policy; rejected overlapping/missing
   entitlement periods; no remapping posted ledger entries; debit adjustments cannot underfund
   commitments; no carryover; expired-period refunds never spendable in a later period; unique annual
   grants; concurrent adjustments; reservation release; rejected and declined cancellation attempts;
   exactly-once final reversal; immutable history.
4. Races and recovery: competing requests using the last available minutes; same-date requests with
   different request keys; approval versus rejection/withdrawal; duplicate cancellation approval; current-
   role revocation and approver reassignment; group/rota edits versus submission; same-key retries,
   changed payloads, lost responses, reload recovery and delayed request versus abandonment. Use
   independent sessions and observed lock waits, not timing-only tests.
5. UI and privacy: role-aware navigation and deep links, phone layouts, keyboard/dialog focus,
   loading/error/empty states, repeated clicks, back/close/reload, stale quotes, stale decisions, cache
   clearing after scope change and no private payloads in calendar/logs/recovery storage.

6. Hosted integration: verify actual staging Auth JWT/PostgREST behavior for every authorized
   audience. Synthetic SQL tests and a successful build do not establish hosted RLS, authentication or
   production readiness.
Before staging application, review an additive migration packet with the exact target, existing-schema
preflight, required configuration, rollback/forward-repair boundary and compatible client. Never reset a
populated project or load synthetic fixtures into it. Unknown baseline differences block rollout rather than
being silently repaired.
Before real use, reconcile opening balances, named authority grants and published rota coverage;
approve retention and backup/restore readiness; complete role-based UAT; verify the exact released
commit and CI evidence; obtain explicit release approval. Keep this service disabled when setup is
incomplete. After real transactions exist, recovery must preserve ledger, audit, occupancy history and
request tombstones; do not drop them or restore broad direct-write permissions to revert a client.

12 Indonesian policy research and the chosen allocation rule
The selected policy is upfront January 1 allocation for already eligible staff after reviewing the distinction
between company policy and statutory minimums. Article 79(3)-(4), reproduced and discussed in
Constitutional Court decision 168/PUU-XXI/2023, page 589, describes at least 12 working days after 12
continuous months, with implementation governed by the employment agreement, company regulations
or collective agreement. The annual January 1 grant is LOU's selected administration rule, not a claim
that the statute mandates that grant date.
Mekari Talenta's official policy configuration guide supports monthly, annual and anniversary
approaches and a separate first-emergence setting. This demonstrates available configuration patterns,
not evidence that any one method is universally used in Indonesia. LOU's selected regular cycle is
annual upfront allocation; a monthly accrual engine is not required for this release.
The remaining HR review concerns the first entitlement and its transition into that cycle, including a late-
year first grant combined with no carryover. Do not use policy configuration to defer an already
qualifying employee's first entitlement until the next January, reduce an applicable minimum or expire it
immediately. The 90-hour working conversion remains a company accounting convention requiring
HR/legal validation against the actual working-day entitlement.

13 Benchmark rationale
Benchmarks inform the interaction and data-integrity design; they do not establish this company's policy
or legal entitlement.
   Salesforce HR Service emphasizes employee self-service, integrated workflows and granular
    access. Use that employee-facing clarity and permission discipline; its service portal is not a
    substitute for defining LOU's leave calculations.
   BambooHR Time Off illustrates balance visibility, request/approval flows and a who-is-out calendar.
    Its Time Off API separates requests from balance-affecting history. That supports a request state
    machine plus an auditable ledger, rather than an editable remaining-balance number.
   Zoho People leave settings make cancellation authority and timing configurable. LOU should
    explicitly set those rules; this design does not copy Zoho's partial-cancellation semantics or its
    administrator defaults.

14 Short review checklist
   Confirm the three views and named HR capabilities, with annual leave as the first enabled type.
   Review the confirmed full 90-hour January 1 grant with no carryover for already eligible staff; supply
    opening balances and approve pending-reservation treatment.
   Approve new-hire first eligibility, first-grant validity and transition rules separately, using employment
    dates and HR/legal review.
   Supply Saturday groups, an anchor date/group mapping and effective-dated membership for the
    confirmed alternate-Saturday pattern; approve explicit dated roster publication.
   Confirm the single-duration multi-day form and approve the proposed one-active-request-per-date
    restriction. Different duration choices use separate forms; exact clock times and multiple same-date
    requests need a revised design.
   Name employee-to-manager and manager-to-director approvers and separately authorized HR
    administrators. Confirm the director accounts are approval-only, outside employee allowance and
    request eligibility.
   Confirm timezone, holiday source, calendar audience, notice/backdate/cancellation rules and
    private-data retention.
   Approve this written design before an implementation plan is prepared. Implementation and
    deployment need separate approval.
