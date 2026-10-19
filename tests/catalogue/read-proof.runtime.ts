import { test } from 'vitest'
import { verifyCatalogueReadBundle } from '../../scripts/catalogue-read-consumer.mjs'
import { assertActualCatalogueReadSqlOutput } from './assert-read-sql-output'
// Separate explicit config prevents ordinary offline tests from masquerading as
// this runtime gate. Missing artifact/profile/run binding throws, never skips.
test('current-run rollback-only SQL output passes actual shared TypeScript decoders', () => {
  assertActualCatalogueReadSqlOutput(verifyCatalogueReadBundle(process.cwd(), process.env))
})
