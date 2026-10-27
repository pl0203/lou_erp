# CO workspace candidates — synthetic verification only

These SQL files are deliberately outside `supabase/migrations`. They are not
a deployable inventory and must not be applied to production or staging.

## Fixed acceptance cases

The runner accepts exactly one case per fresh disposable PostgreSQL 17 cluster:

```sh
node scripts/test-co-workspace-db.mjs --case import-manifest
node scripts/test-co-workspace-db.mjs --case import-posting
node scripts/test-co-workspace-db.mjs --case import-races
node scripts/test-co-workspace-db.mjs --case workspace-reads
```

Each case composes the fixed baseline and its existing tests before applying the
explicit candidate paths. Never run a baseline separately on the same target.
The independent `pilot_test` fixture marker must exist; `pilot_co_test` and
`pilot_co_race_test` must not exist. The runner binds clean Git source, run
identity, PostgreSQL 17 system identity, database ownership, port and address,
and verifies these identities again between stages. It never accepts a custom
URL, migration path, hosted key or bypass switch.

Local verification uses only the fixed loopback port 65437. The dedicated
`github-co-workspace-v1` profile additionally binds the exact repository,
workflow, job and GitHub run identity and uses the ephemeral service on port
5432 with public synthetic credentials. See the reviewed workflow for the
independent marker provisioning and source SHA binding. Other CI contexts are
not interchangeable with this profile.

The manifest case verifies canonical primitives, lifecycle, numeric conventions,
XLSX evidence metadata and deliberately failed installation rollback. Posting
adds atomic post/Edit assertions; races adds observed real-session blockers;
workspace reads composes read assertions inside a rolled-back posting fixture.
Existing baseline race results do not establish candidate race behavior.

All data used by public CI is generated synthetic data. Customer uploads and
private sample verification are not included. SQL metadata checks do not prove
browser parsing, actual Deno execution, or complete Edge/Auth/Storage behavior.
Each of those requires its own native runtime evidence; Node mocks and source
contracts must not be reported as end-to-end acceptance.

Promotion or release requires independent review, successful runtime acceptance
for the exact source, and separately authorized deployment. This test branch
provides no authorization for migration, reset, hosted database access, Edge
publication or deployment.
