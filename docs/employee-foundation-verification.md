# Employee Foundation verification

## Evidence boundaries

The package is prepared and locally tested with fictional data. Independent final review
is still required. GitHub CI and hosted activation are separate states, not implied by a
local pass. Native combined HR CI is explicitly **blocked**, not waived or green.
No real authentication, hosted SQL, deployment, employee import, invitation,
account mapping, permission enablement, payroll, attendance or rehire is certified here.
Calendar rollout remains paused. See [the activation checklist](employee-foundation-activation.md).

Generated execution receipts belong outside committed source so they can bind the exact
final clean HEAD and tree without a self-referential commit. Preserve the source manifest,
commands, exit status, sentinels and artifact hashes together. Never fill run/attempt/job
fields with guessed GitHub metadata.

## Local SQL proof

Use only an exclusively owned disposable PostgreSQL 17 fixture. The runner requires
`pilot_test`, owner `postgres`, an explicit loopback host, actual loopback server address,
the disposable marker and the expected iHR prerequisites. It accepts fixed suite names,
not arbitrary SQL, files, scripts or repository roots. It does not bootstrap or reset.

```sh
node scripts/test-employee-db.mjs --suite all --race
```

This executes the unchanged read/command/reporting assertions, the expanded preservation
suite, inherited command/reporting races, atomic recovery lifecycle and actual SQL JSON
through `src/lib/employees/contracts.ts`. Failures propagate nonzero.

The preservation proof includes nonempty legacy users, same-year leave accounts,
requests, request-day/allocation snapshots and ledger rows. Sorted full-row fingerprints
preserve duplicate rows and distinguish missing from empty objects. Catalog fingerprints
include owners, function/table/schema/column ACLs, policies, RLS, triggers and their enabled
states, constraints, structures and dependency identities. Exclusions are exact owned
objects, not an `employee_` prefix exemption. Probe mutations verify that the comparison
actually detects row, policy, trigger, column-ACL and column-default changes.

Historical iHR/security checks must run at their original checkpoints. In particular,
the historical Director-denial assertion is unchanged and belongs before the later
Director-calendar candidate. The combined candidate-positive proof runs the unchanged
weekly/calendar-settings suites with HR actually installed. Weekly owns its transaction;
Director settings receives an outer transaction. Do not concatenate nested transaction
suites. Run these suites before inserting HR-only actors because the old fixtures own a
fixed roster. Repeat them with HR entrypoints disabled before seeding retained HR history.

The recovery lifecycle covers intentional precommit failure plus independent absence,
collision/reinstall refusal, all application roles including direct private calls,
non-destructive disable, an ordinary already-admitted write, retained history and exact
operation replay after explicit synthetic re-enable. Fixed collision fixtures carry an
atomic invocation/OID/fingerprint marker. Fresh guarded cleanup refuses changed or
foreign metadata, proves the complete baseline before commit and from another connection,
and preserves the original error alongside any cleanup error. A fixed post-commit client
exit proves recovery after an uncertain acknowledgement. This is not hosted drain evidence.

Generated package preflights also reject owner-role membership even when NOINHERIT
hides immediately available privileges, and check effective table/column/helper access
in addition to direct catalog ACLs. Fixed rollback-only non-login probes demonstrate
SET-capable owner membership, inherited predefined read privileges and a two-hop
NOINHERIT SET-only chain through two rollback-only non-login roles, without changing
application-role memberships. The SET-chain proof checks permission metadata with the
shared production closure predicate, not HR row disclosure. Pure SQL cases exercise
PUBLIC separation, denied helpers/entrypoints and harmless active-role narrowing.
Independent absence and baseline checks follow rollback.

## Synthetic browser proof

```sh
node tests/employee-browser/run.mjs --prepare
```

This explicit local mode validates a clean Git source and exact allowlist, builds an
isolated copy with environment-file loading disabled, and creates fresh
`scale-results/employee-browser` output. Existing output is refused, not silently reused.
Its status is **prepared**, not browser-passed. The included fixed loopback server checks
prepared output hashes before serving. Use a supported browser in the same environment;
never work around a sandbox denial or disable the browser sandbox.

The harness renders the actual employee screens, hooks, IHR navigation and shared UI.
Only auth/RPC boundaries are mocked with fictional accounts and local synthetic receipts.
It has no hosted client or real-auth claim. CSP denies connections/workers and off-origin
resources. The CI native-browser runner additionally intercepts all page requests and
rejects unapproved targets. Local browser evidence must state the actual isolation used.

The same-origin preview shell sets measured iframe CSS viewports of 360, 390, 768 and
1366 pixels. Screenshot labels distinguish the actual CSS viewport from display scaling.
Changing the shell viewport does not remount the feature or discard a draft. Reduced-motion
runtime claims require a genuinely emulated and observed media preference, not only a CSS
source assertion.

Exercise create/validation/preview/save, reload and lost-response recovery, before-commit
abandonment, account linking and quarantine, reporting and audit, native keyboard/focus,
Back/Forward, cancel, slow authority refresh and access loss. Screenshots alone are not
behavioral proof. Preserve observed assertions and exact source/build hashes.

`node tests/employee-browser/run.mjs` without arguments is reserved for the real configured
GitHub job. It requires actual repository/workflow/job/run/attempt/head metadata and a
sandboxed installed browser. Do not set fake CI variables to launch it locally. Its failure
report never proves the feature passed. There is currently no automatic HR browser/SQL
execution or HR artifact upload in the workflow while native containment is blocked.

## Complete verification and review gate

After all source changes, run without competing heavy jobs:

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run build
git diff --check
```

The build must use the approved synthetic backend environment, never real credentials.
There is no project lint script. Keep inherited assertions and individual timeouts.
Isolated reruns diagnose contention but do not replace a clean complete aggregate.

The CI extension must preserve independent catalogue read proof on both explicitly
reviewed heads, the trusted base, exact repositories and same-run/same-attempt bindings.
Only the synthetic-safety job budget changes from 20 to 45 minutes; the independent job
stays at 20. The earlier whole-job cancellation and a separately paused retry/prerequisite
failure are different diagnoses, not evidence of a product assertion failure.

Final acceptance needs a fresh independent review of the complete source diff, generated
bundles, fixtures, source bindings, recovery limitations, actual browser evidence and
one-worker aggregate. Locally prepared or tested does not mean CI-run, released or live.

## Browser observations and limits

The local component runs used real cloud-browser interactions against the isolated
synthetic boundary. Create/preview/save, real reload and Back/Forward, both lost-response
recovery paths, account quarantine, reporting/audit, keyboard cancellation, slow refresh
and access loss were observed. Four separately labelled iframe captures cover 360/390/768/1366
CSS pixels. Fixture route buttons are only screenshot setup, not product navigation.
The exact execution revisions, screenshots and source/build hashes travel with the
external receipts. An unchanged-file comparison to a later commit is not a new browser run.

Normal motion was observed at 160 ms. Local reduced-motion runtime remains **unverified**:
the browser's organization policy refused the DevTools route. No alternative route or
sandbox/security bypass was used. CSS/unit coverage and a prepared CI emulation assertion
are not a runtime substitute. The focus-refresh observation proves draft-value preservation,
not restoration of a particular input's focus after an operating-system focus change.

## Native combined CI is blocked, not passing

The HR-only workflow step emits `EMPLOYEE_NATIVE_CI_BLOCKED` and fails explicitly for
the reviewed employee head/base/repository. It is last in synthetic-safety, **after every
inherited independent decoder gate**, so it does not replace or skip those checks. The
original runner images, Docker service and all inherited steps remain unchanged. The
approved exact two-head conditions and 45/20-minute job budgets remain in force.

The unverified native installer, CI entrypoint and process/policy lifecycle helpers have
been removed, not hidden behind an environment flag or left as manually runnable bodies.
Their preparation was never executed as package/system work. Independent review found
that a benign descendant creating a separate session can outlive a tracked process group;
zero tracked groups therefore did not prove safe restoration of temporary service policy.
The attempted design is not an approved containment mechanism. No further process-tree
workaround, permission change or service action is part of this package.

Fixed source, identity and historical-checkpoint manifests remain useful review inputs;
they are not execution receipts. The native combined gate requires a separately reviewed
containment design and authorized disposable CI execution before it can be considered
satisfied. Local SQL/browser evidence cannot turn that blocked gate green. No automatic
HR artifact upload can adopt an earlier browser output while this execution path is absent.

A future design must retain the actual PostgreSQL 17/loopback/database/owner/marker checks,
preserve the existing Docker service, run original historical checkpoints in order, bind
source/run/attempt/job identities, and prove exact owned cleanup without affecting other
services. Do not install packages, change system policy or re-enable execution simply to
obtain a green result.

Reference constraints: [official PostgreSQL Ubuntu packages](https://www.postgresql.org/download/linux/ubuntu/),
[Ubuntu 24.04 runner manifest](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md),
and [Debian service policy](https://manpages.debian.org/testing/init-system-helpers/invoke-rc.d.8.en.html#INIT_SCRIPT_POLICY).
