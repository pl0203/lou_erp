// @vitest-environment node
import { expect, it } from 'vitest'
// All executable candidate/test inputs must participate in exact source identity.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { cataloguePublicSourcePaths } = await import(pathToFileURL(resolve('scripts/catalogue-capture-source.mjs')).href)
it('binds the first foundation fragment and its complete same-session test boundary', () => {
  const required = [
    'scripts/catalogue-foundation.mjs',
    'supabase/catalogue/v1/01-foundation.sql',
    'tests/database/catalogue/before-foundation.sql',
    'tests/database/catalogue/foundation.sql',
    'tests/database/catalogue/foundation-red.sql',
    'tests/database/catalogue/legacy-columns.sql',
    'tests/database/catalogue/roles.sql',
    'tests/catalogue-ci/foundation.node.mjs',
    'tests/catalogue-ci/foundation-binding.test.ts',
    'tests/catalogue/foundation.test.ts',
    'tests/catalogue/foundation-lock-source.test.ts',
    'tests/catalogue/authority-source.test.ts',
    'tests/catalogue/authority-manifest.test.ts',
    'tests/catalogue/fixtures/authority-observed-grants.json',
  ]
  for (const path of required) expect(cataloguePublicSourcePaths, `Unbound input: ${path}`).toContain(path)
  expect(new Set(cataloguePublicSourcePaths).size).toBe(cataloguePublicSourcePaths.length)
})
