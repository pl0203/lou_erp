# Synthetic presentation harness

This harness renders the actual dashboard presentation components with synthetic fixtures only. It does not contact a backend, authenticate a user, perform SQL authorization, or prove an interactive staging workflow.

With the normal local Vite server running, open `/tests/browser-fixtures/sales.html?scope=own&count=42` (or `scope=team` / `scope=leadership`). Use browser viewport widths 360, 390, 430, 768 and 1366 pixels. Verify no page-wide horizontal scrolling, readable controls, collapsed details and focus behavior. Controls in this fixture are presentation scaffolding, not a substitute for the real query/command integration tests.

Actual browser verification was blocked in the implementation environment. No screenshot or viewport-pass claim is made. `render-static.tsx` was used only to prepare a no-script layout artifact; that artifact could not be opened under the available browser URL policy.
