# Stock Return production-component fixture

**Synthetic only. No hosted writes, secrets, accounts, session cookies, or real customer data. A strictly hosted-CI-only runner is included; it fails closed outside its fixed GitHub job.**

The entry renders the current production `COStockReturns`, `COReturnCreateModal`, production `AuthProvider`, QueryClient and React Router data router. Only the Supabase transport is replaced with in-memory synthetic responses. Real RPC decoders, request recovery, quantity validation, dialogs, unsaved-change guards, tables and CSS remain intact. Unrecognized calls fail closed. Canonical return rows include exact decimal-string `unit_price`, distinct head/revision IDs, source CO labels and quantities.

## Build / optionally serve to an already-authorized browser

```
node tests/co-return-browser/build.mjs
node tests/co-return-browser/serve.mjs
```

Build writes only this fixture's `dist/`. The server prints an ephemeral loopback URL and never starts a browser. Stop it with Ctrl-C. Use only normal navigation in an existing authorized managed browser if that browser can reach the owned server; do not tunnel, publish, forward ports or create alternate access without separate authorization.

The server serves only indexed fixture files with `connect-src 'none'`; fonts are the two local production font files, copied with their license. No Supabase client network call is possible. The synthetic profile contains no token. Mock state exists only in memory; pending request localStorage is fixture-origin scoped. For a new independent run, use a fresh owned browser context; reload alone resets mock server state but not request recovery storage.

## Scenarios / visual checks

- `/`: recorded-return table with separate PCS/BOX quantities. Click **Buka** for source-price/value detail. Verify desktop alignment and mobile readability.
- **Create Stock Return**: customer picker includes only Toko Contoh Nusantara; history customer filter additionally includes a zero-stock historical toko.
- Choose customer: 40 PCS CAT-001, 15 BOX KUAS-002, 8 unknown-unit SEMEN-003. Unknown unit must remain unselectable. Add both known items, verify available quantities, remove/re-add rows and no implicit conversions.
- Enter quantity 99: expected validation and no create RPC. Enter 3 PCS and 2 BOX, actual date at/before current UTC ledger cutoff, reason: one recorded return after canonical readback. No Save Draft action.
- `/?scenario=uncertain`: first mocked create commits in memory, then loses response. Expect recovery section, new create blocked; **Periksa hasil** resolves the original head/revision without a second commit. `window.returnFixture.commits` exposes synthetic count for inspection.
- `/?scenario=reject`: definitive mocked stale-version SQL error, allowing safe form correction on a fresh send.
- `/?scenario=loading`: held item read. Customer/SKU typing remains available. Authorized browser console `releaseReturnItems()` releases only this synthetic promise.
- Check 1365 px and 390 px widths, dialog containment, keyboard navigation, Escape/dirty close confirmation, focus restoration, two item rows, source-price detail, and invalid/uncertain states.

## Local checks, not browser evidence

```
node_modules/.bin/vitest run tests/co-return-browser/boundary.test.ts tests/co-return-browser/component.test.tsx --maxWorkers=1 --minWorkers=1
```

Boundary test runs production strict decoders including canonical legacy readback; component tests use jsdom, real AuthProvider/data router and components. They are not native-browser layout/accessibility proof and not database authorization/concurrency proof.

## Hosted native runner (not a local launch permission)

`run.mjs` accepts only GitHub Actions `pl0203/lou_erp`, workflow `CO workspace runtime`, job `stock-return-native`, head branch `test/co-workspace-runtime-20261027`, a clean checkout matching `CO_CI_SOURCE_SHA`, and valid run/attempt IDs. It uses only the preinstalled sandboxed `/usr/bin/google-chrome` resolved under `/opt/google/chrome/`; there is no executable override or sandbox fallback.

The approved hosted job runs `node tests/co-return-browser/run.mjs`. Each independent scenario gets a fresh CDP browser context and page, preventing stale frontend/recovery storage. It asserts 1365/390 layout containment, recorded statuses/unit totals, Buka source prices, no displayed UUIDs, positive-stock customer selection, unknown-unit rejection, multi-SKU validation, remove/re-add, native keyboard/Escape/Keep/Discard focus, held-read typing, canonical success and lost-response single-commit recovery. Date input is set with the native input setter because browser date segments vary by locale; text, clicks and key actions use CDP input.

All content is served from an owned ephemeral loopback server under CSP `connect-src 'none'`; CDP blocks off-origin requests. Build and profile live in one owned temporary directory. Cleanup waits for process `close`, escalating termination only for the owned child, and retains the profile on unproven termination. No screenshot, artifact upload, paid runner, cache or secret is required. A source/tree/run/browser-bound synthetic receipt is printed to stdout only after all assertions and cleanup pass. Native execution is **pending** until that hosted result exists; local guard/static tests are not browser evidence.

Safe local verification (does not launch Chrome):

```
node --check tests/co-return-browser/run.mjs
node --test tests/co-return-browser/runner.node.mjs tests/co-browser/cleanup.node.mjs
```

The build module is import-safe and exports `buildFixture(outDir)` for job-owned temporary output. Its direct CLI still builds the documented local `dist/`.


### Browser-owned calendar image provenance

Hosted diagnostic run 40551974569 at exact source ec1383cfe3de89f2f83b408d7510d4803b89ff4d observed one `Network.requestWillBeSent` event with `data:`, `Image`, initiator `other`, 382 URL bytes and SHA-256 `04e449d20d0365d881a54ed24af7ed00fe79dd9f9e601248f4fd7793003924f2`. This exactly equals `data:image/svg+xml;base64,` plus base64 of Chromium's 266-byte [calendar_icon.svg at 1ce8a2aeddccb689188eda0420b90225e857be93](https://raw.githubusercontent.com/chromium/chromium/1ce8a2aeddccb689188eda0420b90225e857be93/third_party/blink/renderer/core/html/resources/images/calendar_icon.svg). Chromium's HTML user-agent stylesheet assigns that asset to the native date-picker indicator. The list page has two date-filter inputs; a normal page `getComputedStyle` pseudo-element query did not expose the matching browser-owned image.

The runner classifies only that exact Network event identity as a built-in local decoration and retains each sanitized diagnostic in `builtinCalendarImages` in the success receipt. The SVG contains only static paths, no script, external reference or image request. This is not a general data-image allowance: different bytes, length, media type, resource type, initiator (including parser/script), or event kind fail closed. The `Fetch.requestPaused` interceptor still rejects every off-origin request, including data URLs, and CSP remains `img-src 'none'`, `connect-src 'none'`. No runtime application, SQL, transport permissions or CSP are changed.
