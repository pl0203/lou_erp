# Synthetic leave UI candidate

This isolated entry renders the actual leave components with fictional Auth and RPC fixtures. It cannot contact a backend, and every transaction RPC is rejected. The candidate deployment enforces `connect-src 'none'`. No public assets, credentials, real people, source maps, or local input files are copied into the output.

Build: `node qa/ihr-leave/build.mjs`
Tests: `npx vitest run --config qa/ihr-leave/vitest.config.ts`

Routes:
- `/ihr/leave?role=manager`: manager fixture, default Ajukan Cuti
- `/ihr/leave?role=employee`: employee fixture
- `/narrow.html`: 390px iframe displaying the actual responsive page
- `/qa-build-manifest.json`: revision and artifact hashes

Sample: October 9–12, 2026 produces a synthetic 18j 45m preview with 48j 45m remaining. This is fixture behavior, not backend-policy validation. History shows two cards, approvals has one assigned request, and calendar has two agenda rows. No mutation success should be claimed.
