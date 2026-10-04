# Proposed pilot security change

Local review only. Do not deploy this migration independently of its matching frontend and order-transaction migration. Production deployment requires approval and successful isolated staging tests.

## Scope

- Active salesperson: assigned customers and own order/visit history
- Active manager: assigned customers and records belonging to self/direct reports
- Active head/executive: all sales records
- PO administrator: operational customer/order records
- Inactive/missing profile: no application-table access

Customer assignment means an explicit rep assignment or a sales schedule assigned to the salesperson. A historical schedule currently continues to establish customer access until deleted/reassigned. This is an interpretation of the current application's assignment model, not a new assignment-management feature. Confirm this interpretation at deployment review. Customer-manager assignments define manager customer scope; user.manager_id defines team actor scope. Legacy outlets/orders are separate identities from current customers and are never equated by ID.

Historical own/team order and visit rows remain visible after customer reassignment; a currently unauthorized customer relationship can be null. Existing historical screens render a missing-name fallback; opening an inaccessible customer detail may fail safely. History visibility does not grant new-order authority.

## Data boundaries

RLS restricts headers and their line items, delivery documents, audit entries, visits and photo metadata. Product catalog/pricing visibility is unchanged; product-price field sensitivity is a separate business decision. Storage object policies are addressed by migration 3 below and require hosted verification; metadata RLS alone cannot protect object downloads or invalidate an already-issued URL.

The users table exposes only id, full_name, role, manager_id and is_active directly, subject to row scope. Own email comes from pilot_my_profile. Executives use pilot_list_users for administration. Managers/head/executive use pilot_team_directory for existing contact cards, scoped to their team or all sales for head/executive; it does not return birth dates. All these RPCs use the authenticated actor, not a caller-supplied user ID.

Self role, manager and active-state changes are blocked. Identity metadata is immutable through profile editing. Safe self name/phone/birth-date edits remain possible. Executives can manage other profiles. Delete privileges for users/customers/outlets are removed to prevent destructive cascading history deletion; no matching current UI deletion workflow was found. Unused rep-assignment writes and unused legacy-order writes are disabled pending defined workflows.

## Verification

- Both final candidate migrations compiled together in PostgreSQL 17's standalone backend from a clean metadata fixture
- The previous self-authority mutation behavior was reproduced in the metadata fixture, and the new trigger explicitly rejects it
- A React regression test demonstrates own-profile loading when raw users private columns are unavailable
- Security-migration-1 checkpoint: 71/71 application tests, typecheck and production build passed (large-bundle warning remains); concurrent transaction-client work is separate and requires a fresh final integrated run
- `supabase/tests/security/explicit_guards.sql` passed explicit function/trigger checks; integrated order transaction serial tests also passed
- `supabase/tests/security/pilot_security.sql` is the actual RLS/grant matrix and intentionally requires row_security_active('public.users') to be true

PostgreSQL standalone mode bypasses RLS even after SET ROLE authenticated. It cannot provide a valid RLS or grant test result. No policy suite pass should be claimed from that backend. Execute the matrix in an isolated normal PostgreSQL/Supabase environment with the synthetic auth.uid test fixture; do not run dummy fixtures in production. JWT verification, PostgREST relationship embedding, Storage access and normal-session concurrency require staging integration tests.

## Deployment review blockers

1. Real-role RLS/grant matrix in a normal isolated database
2. Matching RPC frontend deployed together with migrations
3. Storage buckets/policies and attachment access review
4. Historical missing-related-record UI check and customer-assignment interpretation sign-off
5. Backup/restore, rollback plan and end-to-end role UAT

Avoid rollback by restoring broad grants or old write policies while new client code is active. Stop writes and assess data compatibility before applying any reviewed rollback.

## Visit Storage policy candidate

Migration 3 tightens the existing private `visits` bucket policies. It uses `owner_id` (the supported JWT-sub-derived owner field), not deprecated `owner`. Uploads retain the current `visits/{schedule_id}/{filename}` format and happen before visit/photo metadata. The uploader must be active, assigned that schedule and allowed its customer; the object owner must be that uploader. A photo metadata insert requires an existing object owned by the same actor, in addition to migration 2's visit/folder linkage.

Read/sign permissions require a linked photo, matching schedule folder, matching object owner and authorized own/team/head/executive visit scope. Unlinked/orphan uploads and ownerless or mismatched-owner legacy files fail closed. Existing images must be checked in staging before rollout; no repair, reassignment or production object change has been performed. PO administrators are not newly granted visit-photo access. There is no browser overwrite/delete permission for visit evidence.

`storage_helpers.sql` passed explicit helper checks against a deliberately minimal local Storage metadata stand-in. `storage_rls.sql` intentionally stops in standalone mode because real RLS is inactive there. Neither result validates Supabase Storage HTTP behavior, CDN behavior, file contents or signed URL authorization.

Hosted staging must test:

- Upload under own schedule, then visit + photo metadata, then sign/download successfully
- Wrong schedule/owner, inactive/missing profile, foreign metadata links, missing objects and malformed paths denied
- Raw download/list/sign rejected for an unrelated salesperson; own manager and head/executive permitted
- Orphans unreadable; existing ownerless/mismatched legacy files surfaced for review
- Overwrite, move and delete denied for visit evidence
- Cross-team transfer and account deactivation stop NEW signed URL issuance

Already-issued signed URLs remain bearer links until their expiry. The current client requests a one-hour URL; RLS changes cannot invalidate a URL already issued. Production rollout must explicitly account for that expiry window. Database policy checks alone cannot prove hosted signed-link behavior.

Supabase also documents a separate Smart CDN cache duration: a cached signed response can be served beyond token expiry until its cache duration ends. Verify the actual project's CDN configuration and response cache headers rather than assuming the one-hour token is a hard revocation bound. Sources: [private downloads](https://supabase.com/docs/guides/storage/serving/downloads), [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn), [object ownership](https://supabase.com/docs/guides/storage/security/ownership).
