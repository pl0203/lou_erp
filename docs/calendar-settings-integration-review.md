# Combined leave calendar and Director settings proposal

Status: UNPUBLISHED SOURCE ONLY. No hosted SQL, permission, configuration or business-data operation has been performed by this integration. This is separate from the UI-only release already deployed to staging.

## Verified source and composition

The integrated source is based on deployed commit `ef8a6cf209d8520af58ddcea7f13e759193b4367`, tree `34a44672db5e38ed542a12ce79d774d0dc9856b8`. Every one of its 1,169 non-environment blobs was verified against GitHub; `.env` was intentionally excluded. The local baseline commit is only a synthetic source snapshot.

The prior weekly and Director proposal documents retain their original 29eb48 source provenance. This document records their composition on ef8a6, not a rewrite of those historical receipts. The only production frontend overlap is LeaveTabs: weekly server-owned audience discovery is retained and the separate calendarConfigure capability opens only LeaveAdminRotaPanel for Director. Existing general administration, personal leave, approval, draft/uncertainty and route guards are retained.

SQL surfaces are disjoint. Deterministic proposed installation order is weekly SQL, then Director SQL, then the matching frontend after backend validation. The SQL files remain proposals, not registered migrations or permission to execute them. They must not be blindly reapplied: weekly uses CREATE for new functions/trigger, and Director replaces seven existing bodies that require exact pre-install drift checks.

## Persistent access effects requiring explicit approval

1. Team calendar read access: active iHR Directors can view the active staff roster; Sales Heads can view active sales staff; Sales Managers can view themselves, their active sales direct reports and Sales Heads; Sales Persons can view themselves and peers sharing the same active, non-null manager; PO and CO Admins share an admin-team audience. Existing own, explicitly assigned and granted audiences remain available. These are persistent server-enforced read rules, not new employee reporting or approval assignments.
2. Privacy: peers see approved availability only. Submitted/pending details require request ownership, the exact existing assigned-reviewer predicate, or active iHR Director oversight. Cancellation-pending leave is projected as approved for peers, before ordering/pagination. Responses exclude reasons, balances, request IDs, approver names and hidden-pending metadata. Recorded absence minutes remain immutable; missing work-calendar setup stays unconfigured.
3. Director calendar administration: an active application executive who is also an active iHR Director gains persistent calendar/roster access, future calendar version management, Saturday-roster publication and finite same-group membership continuations. This is NOT a one-login, six-person or one-time grant. Weekly Director read access does not require application executive role; calendar administration intentionally does.
4. Continuations are fixed server-reviewed intervals: same current group and calendar lineage, adjacent future start, finite end within confirmed calendar/roster coverage, no overlap or replacement, no employee/group/date picker. Current activity, authority, source fingerprint, expected versions, locks, impact checks, idempotency and recovery remain enforced. Existing member/predecessor rows are not rewritten.
5. Employee administration, policies, balances, private HR information, access management, approval-route logic and all generic grant helpers remain unchanged. No new role, account, table, column, table privilege or business-data write is part of installation.

Three new authenticated read APIs receive EXECUTE: leave_team_calendar_context_v1, leave_team_calendar_v1 and leave_roster_continuations_v1. Five new private helpers are not client-executable. All eight new functions explicitly revoke PUBLIC, anon, authenticated and service_role before granting authenticated only on the three public APIs. The Director proposal's two REVOKE lists were narrowed to this uniform guarantee during integration; existing function ACLs are not altered. Security-definer entry points retain fixed search paths and fresh active-actor checks.

## Exact backend object inventory

Weekly adds private.ihr_leave_weekly_roster(uuid,text,timestamptz), public.leave_team_calendar_context_v1(text), and public.leave_team_calendar_v1(date,text,text,integer,integer). It replaces the existing users update trigger ihr_leave_user_active_scope to invalidate on is_active, role or manager_id changes and adds ihr_leave_user_roster_scope for insertion/deletion. The existing membership scope-invalidation trigger is retained.

Director adds private.ihr_leave_is_calendar_director(uuid), private.ihr_leave_calendar_config(uuid,timestamptz), private.ihr_leave_can_continue_roster(uuid,uuid,uuid,date,date,timestamptz), private.ihr_leave_roster_continuation_fingerprint(uuid,uuid,date,date), and public.leave_roster_continuations_v1(uuid,integer,integer).

Director replaces only these seven existing function bodies: private.ihr_leave_calendar_impacts, public.leave_roster_preview_v1, private.ihr_leave_authorize_calendar_command, private.ihr_leave_set_membership, public.leave_admin_setup_v1, public.leave_context_v1 and public.leave_admin_rota_context_v1. Existing ACLs are preserved.

## Installation preflight and rollback boundaries

Before any separately approved staging installation, verify the exact project and current installed dependency chain, function definitions/owners/ACLs/default privileges, user and membership triggers, and absence of all new objects. Capture exact definitions and ACLs of the seven replaced bodies and both relevant users-trigger identities. Reconcile unexpected drift; do not overwrite it. Generate the migration through the supported repository workflow rather than inventing an applied migration record.

After explicit approval, install only the reviewed sources on the confirmed staging backend, verify exact definitions/ACLs and trigger fingerprints, and exercise positive/negative paths through genuine authenticated application actors. Management SQL with spoofed JWT claims is not an authenticated acceptance test. Publish/deploy matching frontend only after exact-head CI and backend compatibility checks. No production or alias/protection changes are included.

If rollback is necessary, reconcile pending/uncertain commands before revoking authority; never resend an uncertain operation with a fresh idempotency key. Roll back matching frontend, restore the exact seven old function bodies/ACLs and prior user-trigger definitions, and remove only newly introduced objects after dependency checks, without CASCADE. Preserve unrelated later changes. Verify fingerprints and current scope afterward. Permission/code rollback does not delete calendars, rosters, memberships, requests, snapshots, audit or ledger records; business-data reversal needs a separate prospective plan.

## Explicit exclusions and verification limits

No national-holiday or cuti-bersama rows, 2026 six-person setup, 2027 policies, reporting-manager changes, CO-Admin-to-Director approval route, membership reassignment or historical recalculation is included. Existing staging holiday/setup data remain untouched. A separate 2026 data operation has its own future-effective boundary and approval; this persistent capability must never be described as that one-off operation.

The review package records focused frontend tests, typecheck/build, independent merge/SQL review, both original frozen-candidate receipts and combined rollback-only PostgreSQL checks. No new full application aggregate, hosted installation, signed-in staging acceptance, browser/device or assistive-technology rendering is claimed. If publication is later approved, exact published-head CI remains required before staging deployment.
