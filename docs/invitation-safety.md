# Invitation and password setup safety

Source-only changes for the Monday 5 October 2026, 10:00 WIB demo. No account, SMTP, redirect setting or hosted Edge Function was changed during implementation. Passing unit tests does not establish hosted email delivery.

## Verified source behavior

- The invite endpoint retains the existing five roles and requires the caller's current database profile to be an active executive
- It validates and normalizes required/optional fields, checks an assigned manager is active and has an existing management role, and checks for an existing public profile before requesting an invitation
- Supported email input is a simple business address, trimmed and lowercased. Whitespace, missing domain components and literal `*` are rejected. Literal `*` is intentionally unsupported to avoid PostgREST's ILIKE wildcard alias; `%`, `_` and backslash are escaped for the duplicate lookup
- The invitation redirect requires exact server configuration and a matching Origin. Missing or malformed configuration fails closed before any email request
- The profile insert still follows Auth's invitation request. These services are not atomic. The code does not delete accounts, upsert roles, or attempt automatic rollback/reconciliation
- Auth transport/5xx/unknown results and an invitation accepted before profile failure are explicit uncertain/partial outcomes. Neither proves delivery to an inbox
- The UI records a pending/unknown marker before making the invitation request, then clears it only for a confirmed successful or known-rejected outcome. Partial/unclassified/network responses retain the email block for manual reconciliation. It preserves this block through reopening, unmount and reload in the same browser tab's session storage. If storage cannot be written and read back before submission, no invitation request is made. If storage fails afterward, the pre-send marker is left in place. This is not a server idempotency key and does not protect a different browser/tab, cleared storage, direct API caller, or concurrent requests
- Cancel/reopen cannot let a previous mutation erase the new draft. Stale form errors are cleared and list-query failures are visible with Retry
- Password setup requires a valid invitation/recovery fragment captured before SDK initialization strips it, successful callback validation, and the exact resulting session. An expired/invalid callback never qualifies an existing logged-in account
- Password submission rechecks account identity, then uses an isolated memory-only Auth client bound to that checked account. A shared-session switch between check and write cannot change the other account's password. A same-account token refresh remains supported
- Repeated Enter/click submissions are guarded. Reloading after the fragment has been consumed intentionally fails closed; request a fresh link rather than authorizing a preexisting session

## Required deployment configuration (not performed)

Set the **server-only Edge Function** environment variable `INVITE_REDIRECT_ORIGINS` to a comma-separated list of approved, canonical HTTPS origins, for example `https://erp.example.test,https://staging.example.test` (illustrative domains, not live settings). Entries must have no trailing slash, credentials, path, query, fragment or wildcard. HTTP origins, including localhost, are rejected. Never put this value in a frontend secret or assume a Vercel frontend deploy updates the function.

For each approved origin, separately verify that Supabase Auth's redirect URL allowlist admits its exact `/reset-password` URL, and that the configured Site URL points to the correct environment. Confirm the invitation email template uses the supported confirmation link and preserves the configured redirect. No `/auth/confirm` token-hash route or PKCE invitation handler is implemented by this SPA; its supported flow is Supabase's implicit invite/recovery fragment.

The compatible frontend can be deployed first: it accepts the existing function's success response and treats an older function's unclassified failure as uncertain. Password setup protection uses the existing Auth API and does not require the new Edge Function setting. Deploying the privileged function and configuring its trusted redirect origins remain separate approval and verification steps. Verify the deployed function revision independently of the website commit, plus the runtime service configuration and gateway authentication, without exposing credentials.

## Monday acceptance gates

1. Read-only verification of the hosted `invite-user` revision, enabled status, matching origin allowlist, configured Site URL/redirect URLs, and real email-provider configuration
2. Confirm the actual hosted provider permits every intended administrator's address and the planned number of invitations. Supabase's default provider restrictions are a conditional risk, not a finding about this project's current settings
3. With explicit authorization and an agreed recipient, complete one invitation end to end: API success, public profile, delivered email, exact callback route, password setup and correct role landing. A unit mock and a successful invitation API response cannot replace delivery proof
4. For invited administrators, have them open their own link in their own browser/profile, confirm the displayed address before saving, and never use a presenter’s logged-in session as a proxy for the invitee
5. If the outcome is partial/unknown, stop sending for that email. A trusted administrator must reconcile Auth identity, public profile and delivery status. Any repair, resend, role change, deletion or settings change needs separate authorization; the UI does not perform it automatically
6. Confirm expired/reused links show a blocked setup screen; a preexisting executive login is not modified. Direct `/reset-password` navigation also stays blocked
7. Exercise list-load failure, cancel/reopen while saving, ordinary duplicate profile, invalid manager/date, and repeated Enter. Confirm no stale form loss or automatic retry

Until gates 1–3 are checked, real administrator onboarding is **not demonstrated ready** for Monday. No hosted accounts or mail were created as part of these tests.

## Official references checked 1 October 2026

- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp): the built-in sender is restricted to organization-team recipients and currently two emails/hour; this does not establish the current project's configuration
- [Supabase user invitations](https://supabase.com/docs/guides/auth/users): allowed redirects, invitation expiry and existing-user behavior
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls): allowlisted redirects and callback error fragments
- [Invite API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail): invitation flow and PKCE limitations
- [Function authorization headers](https://supabase.com/docs/guides/functions/auth-headers): hosted gateway validation is distinct from handler authorization

## Local verification and limits

Regression tests cover handler decisions using synthetic clients, UI interruption/error flows, and callback/session races using the installed Supabase Auth SDK with fictional in-memory sessions and mocked HTTP. No real token was read or logged. `npm test`, `npm run typecheck`, and a production build using synthetic frontend values are the local checks. Hosted Deno bundling, gateway behavior, live SMTP, actual Auth redirects and mailbox receipt still require the separate acceptance gates above.
