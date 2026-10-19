# Team leave calendar: unpublished backend source proposal

Baseline: verified upstream `29eb48ab6c088b1bdeaee44ca4e8fad57acb88db` bytes. The local snapshot commit is not the upstream commit identity. This file describes the reviewed source, not installed or deployed behavior.

## Boundaries

`sql/weekly-leave-calendar-candidate.sql` adds two minimized read endpoints and one private roster helper. It extends the existing user-authority invalidation trigger to manager transfers and adds roster insertion/deletion invalidation. Existing leave tables, row policies, commands, request decisions, assignments, immutable snapshots, balances, holiday calendars, and grant records are unchanged.

This is a SQL proposal, not a migration history entry. The Supabase CLI was unavailable, so no migration filename was invented. A later authorized installer must use the supported migration-generation workflow, re-audit the exact target, and obtain approval for the new read access before hosted installation. Public endpoint execution is revoked from PUBLIC, anon and service_role and granted only to authenticated. Fixed search paths and active-actor checks protect both public security-definer entry points; the private roster helper is not client-executable. No table access is granted.

## Calendar audience rules

- Active IHR Directors can view all active application staff. Director rows can be present but remain unconfigured with no personal leave facts. Executive application role alone does not establish Director authority.
- Sales Heads see active Sales Persons, Sales Managers and Sales Heads.
- Sales Managers see themselves, active sales direct reports and active Sales Heads.
- Sales Persons see themselves and active Sales Person peers with the same non-null, active current manager.
- PO Admin and CO Admin share a role-defined calendar team. This visibility rule does not assert or configure their reporting relationship.
- Existing own, explicitly assigned team and calendar-grant audiences remain available. Own uses the existing eligible employee/manager predicate, not application role alone.

Roster rows include authorized staff with no leave request or no leave setup. Inactive/revoked leave members expose no absence facts and no inferred work schedule. Users cannot self-edit their role/manager authority under the existing profile-update guard.

## Privacy and source of truth

Pending details are visible only to the request owner, an active IHR Director, or the exact existing `ihr_leave_is_assigned_request` predicate. That predicate resolves request/cancellation-attempt assignments, audited reassignments, revocation, activity and effective windows. Current reporting-manager relationship and a general calendar grant never confer request review authority.

For peers, submitted requests disappear entirely and cancellation-pending leave is projected as approved availability. Filtering and status projection happen before pending-first ordering, pagination or totals. There are no hidden pending counters, flags, request identifiers, reasons, approver names, balances, or source snapshots in the response. A withdrawn hidden request cannot change peer ordering or totals.

Recorded absence minutes and full/partial labels come from immutable request-day snapshots. Current work schedule, holidays and off-duty days come independently from the existing employee-specific working-day resolver. Missing setup stays unconfigured. No national holiday list is substituted for missing employee setup, no historical charge is recomputed, and no clock-time interval is fabricated from hours.

## Contract

`leave_team_calendar_context_v1(p_audience)` returns scopeVersion, allowed calendarAudiences, defaultDate and defaultDateState. The default is today's date in the unique confirmed calendar timezone among configured authorized employee rows. Unconfigured rows remain in the roster but do not invent a timezone. No known timezone or mixed confirmed timezones yields a null default requiring explicit date selection.

`leave_team_calendar_v1(p_period_start,p_view,p_audience,p_page,p_page_size)` accepts only a Monday week or the first day of a calendar month. It returns exact 7-day weeks or 28–31-day months, at most 100 employee rows per page, total authorized roster size, stable pending-first/name/ID ordering, and the current authority scope version. Request status changes do not create new authority; callers still need the fresh shared authority/read proof already used by the application.

## Separate unresolved organization configuration

The current approval route supports an explicitly assigned Director for PO Admin employees, but does not support CO Admin employees. This patch intentionally does not change that. Implementing CO Admin-to-Director approval requires a separate reviewed change to `ihr_leave_is_approver`, `ihr_leave_guard_approver`, `ihr_leave_set_approver`, and `ihr_leave_assignment_active`, plus explicit authorized configuration of actual reporting/approval records. Existing requests and cancellation attempts must not be silently rebound or rewritten.

## Verification and limits

The real PostgreSQL suite uses fictional fixtures and actual anon/authenticated roles in a disposable loopback database. The candidate and fixture mutations share one transaction and roll back. The guarded runner rejects non-loopback/unknown databases, wrong users, malformed ports, inherited connection overrides and missing fixture markers before applying source. Run `node --test tests/database/ihr/weekly-runner-guard.mjs`, then the configured local `scripts/test-ihr-weekly-db.mjs` runner.

Red evidence covers the missing weekly API, the superseded Director-roster default proposal, and the subsequently approved Week/Month API. Current checks cover exact projections, own/peer/Director scope, shared admins, manager transfers, self-authority update denial, inactive actors/managers/members, grant/assignment revocation, cancellation-attempt ownership, withdrawals, stable multi-page ties, month lengths, holidays, frozen minutes, and mixed/unconfirmed timezone defaults.

No hosted installation, hosted synthetic records, security grants, production migration, publication or signed-in browser validation was performed. The existing disposable baseline contains the repository's IHR chain and PO Admin route; its synthetic role enum was extended locally for CO Admin tests, without changing the hosted database. Backend evidence does not claim a clean full TypeScript aggregate; the UI owner coordinates that verification.
