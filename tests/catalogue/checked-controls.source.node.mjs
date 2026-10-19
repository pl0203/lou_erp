import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
test('guarded delete is explicit, version-bound and separate from native product deletion', () => {
  const action = read('src/components/catalogue/CatalogueStatusActions.tsx')
  assert.match(action, /sender\('delete_unused'/)
  assert.match(action, /delete_mode.*=== 'guarded'/)
  assert.match(action, /expected_version: intent\.row\.catalog_version/)
  for (const kind of ['Customer', 'Product']) {
    const page = read(`src/pages/athel/${kind}List.tsx`)
    assert.match(page, /delete_mode === 'direct'/)
  }
  assert.match(read('src/pages/athel/ProductList.tsx'), /from\('products'\)\.delete\(\)\.eq\('id', id\)/)
})
test('canonical recovery admits only verified delete receipts and not absent targets as proof', () => {
  const hook = read('src/lib/catalogue/useCataloguePage.ts')
  assert.match(hook, /receipt\.operation === 'delete_unused'/)
  assert.match(hook, /parseCatalogueReceipt\(raw\)/)
})
test('target route verifies server capability and uses durable checked recovery without fallback', () => {
  const helper = read('src/lib/catalogue/customerTargets.ts')
  assert.match(helper, /pilot_customer_target_write_access_v1/)
  assert.match(helper, /pilot_customer_target_upsert_v1/)
  assert.match(helper, /pilot_reconcile_customer_target_v1/)
  const page = read('src/pages/girard/CustomerPerformance.tsx')
  assert.match(page, /useCustomerTargetSave/)
})

test('guarded readiness attempts enter invalidation even when the browser is offline', () => {
  const hook = read('src/lib/catalogue/useCataloguePage.ts')
  const readiness = hook.slice(hook.indexOf('const deleteAccess = useQuery({'), hook.indexOf('const [pending, setPending]'))
  // Structural guard only. The offline-refetch/cancel behavior is exercised by
  // page-integration.test.tsx with real TanStack Query and its onlineManager.
  assert.match(readiness, /networkMode: 'always'/)
  assert.match(readiness, /readiness\.accepted = null/)
  assert.match(readiness, /signal\.addEventListener\('abort', refuse/)
})
