# Pilot Safety Implementation Plan

Goal: fix verified client and invitation safety defects without touching the live database.
Architecture: retain existing React/Supabase flows; add shared input validation, fail-closed session lifecycle, and explicit reporting failures. No RPC integration or invented schemas.
Tech stack: React, TypeScript, Supabase, TanStack Query, Vitest.
Scope: local changes only, no push or deployment. Zero prices remain valid. Positive integer quantities match existing unit-based inputs.

1. Add isolated mocked tests; all network access fails in tests. Reproduce zero-sales substitution, ignored query errors, negative inputs, missing/inactive profiles and session races.
2. Validate order payloads before any mutation; retain zero prices and reject nonfinite, fractional/nonpositive quantities and negative prices.
3. Preserve zero delivered revenue and propagate query failures.
4. Require matching active profiles before rendering protected content; await profile loads, discard stale responses and clear/cancel query cache on identity transitions.
5. Require active executive callers for invitations and validate assigned roles.
6. Run full tests, build, typecheck; record existing type failures and staging gates for backend atomicity.

Review focus: ambiguous network failures; account switching during profile fetch; sign-out during queries; zero promotional pricing; failed reporting reads. Backend transaction/duplicate handling remains blocked on verified schema and separate deployment approval.

## Type/model follow-up
Resolve the existing typecheck failures in a separate commit. Reuse DashboardData chart types, remove unused code, and normalize to-one embedded relations with a shared tested helper. Preserve object/null/singleton-array semantics and reject ambiguous multiple rows; do not add schema assertions, double casts, or compiler suppressions.
