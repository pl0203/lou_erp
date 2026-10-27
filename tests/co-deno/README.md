# Native Deno evidence runtime checks

Run with **Deno 2.9.7**, after `npm ci` has installed the existing `package-lock.json`.
The dedicated configuration uses those manually managed modules and pins its sole
bare production import (`saxes`) to the already locked 6.0.0 package. It does not
install dependencies or write a Deno lockfile. Node builtin type declarations are
explicitly bound to the existing locked `@types/node` 25.5.2 package (also declared
as a direct development dependency), rather than Deno resolving an unversioned
implicit type dependency.

```sh
deno check --config tests/co-deno/deno.json --cached-only --no-remote \
  supabase/functions/co-evidence-upload/index.ts \
  supabase/functions/co-evidence-download/index.ts \
  tests/co-deno/evidence_test.ts
deno test --config tests/co-deno/deno.json --cached-only --no-remote \
  tests/co-deno/evidence_test.ts
```

No `--allow-*` permissions are needed or granted. The test process cannot contact
Auth, Storage, a database, or a third party. Fixtures are generated synthetic OOXML.
Tests exercise real runtime decompression, XML validation, original-byte hashing,
manual values-only classification, streaming limits, and immutable object binding.

`tests/co/evidence-native-contract.test.ts` runs the same assertions under Vitest
only to sanity-check the fixtures and assertions. A passing Node run does **not**
prove Deno compatibility. The two Edge entrypoints are type/dependency checked,
not started: their module import normally starts `Deno.serve`.

These checks do **not** certify a deployed Supabase Edge runtime, real Auth/RLS,
Storage writes, SQL receipt issuance/retry, or complete browser-to-backend flows.
Those require a separately isolated backend acceptance environment.
