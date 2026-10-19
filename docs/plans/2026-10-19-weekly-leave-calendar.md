# Team leave calendar: approved source-only implementation

Upstream base: 29eb48ab6c088b1bdeaee44ca4e8fad57acb88db. Local HEAD is a synthetic source snapshot, not that upstream commit.

## Bounded design
- Week and Month toggle: seven Monday–Sunday dates or the exact 28–31-day calendar month. Employee rows, previous/next period controls and an independently retained anchor date. Explicit date selection when no unique confirmed company timezone is available.
- Server-owned active roster: director all staff; Sales Head all sales; Sales Manager own team, self and Sales Head; salesperson peers reporting to the same current manager plus self; PO/CO admin role-defined calendar team, separately from the proposed director reporting configuration. Existing explicit scopes remain separate.
- Pending blocks and pinning only for self, request-specific assigned reviewer, or director oversight. Unauthorized peers receive approved availability only, with pending cancellation rendered as approved and no hidden-status ordering/count signal.
- Read-only minimized versioned API. No reasons, balances, request IDs or approval actions. No approval-route, membership, historical request, calendar or hosted policy writes.
- Current schedule cells use the canonical working-day resolver. Missing setup is unknown, never guessed off-duty. Stored leave minutes remain immutable and are not recalculated from current calendars.

## Implementation and verification
1. Strict date/week/payload parsers, independent API adapter and private query keys. Reuse genuine fresh-authority receipts; invalidate on confirmed transitions.
2. Single semantic table with sticky employee column and contained horizontal scroll on narrow screens; text and shape labels accompany colors. No duplicate forms/IDs or device sniffing.
3. Server SQL and local synthetic fixtures owned separately. Audit role/activity/membership/transfer/assignment boundaries, privacy-safe sorting before pagination, half-days and holidays.
4. Focused contract, transport, grid, race, stale-owner and integration tests; typecheck/build; independent review. The integration owner runs the only broad aggregate. Browser rendering is unrun in this executor.
5. Package source and receipts, not user screenshots or private data. Separate reviewed deployment and permission approval is required before any hosted application.

## Reviewed refinements
- Directors remain honest unconfigured roster rows without personal leave facts. The default date uses the unique known timezone among authorized configured employees; unconfigured rows do not invent their own timezone. Mixed known zones or no known zone require an explicit date.
- Existing personal leave exclusion and request/approval capabilities are unchanged. Organization calendar visibility is a new read rule, not a reporting assignment or approval-role mutation.
- Month blocks retain short visible status words and full assistive text. Week/Month round-trips retain the selected date rather than deriving from a shifted period boundary.
- Initial calendar selection comes directly from the server audience list. Disabled navigation discovery has a separate query owner key from an enabled panel observer, preserving genuine fresh-authority checks without an extra default-audience fetch.
