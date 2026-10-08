// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { DEMO_MIGRATIONS, DEMO_TABLES, DEMO_NEW_TABLES, buildDemoRollout } from '../../scripts/build-demo-rollout.mjs'
const pins = [
 ['supabase/migrations/202610081101_demo_order_promotions.sql','bef3867ce095f66f6a63399551478d0e4ee27895e521e183db3e728a7aca1938','c3bad6b2ee20e6b71de74243f0f9040bd07712d0'],
 ['supabase/migrations/202610081102_demo_visit_workflow.sql','2bca74f51de8a6f29065ef9ab88451b0bee9eb7d1caea03cf3ce19fe739488ca','8043788b37d173d1d18b56bc4d7f6016c8b80efd'],
 ['supabase/migrations/202610081103_demo_sales_reporting.sql','a0851e565bfe74f5cb6b7e01e9c6d5d58132afee413460f815bbf18030bf565c','dfb3f39c4935f89b9a98277652d68246fc29e30a'],
 ['supabase/migrations/202610081104_demo_sales_assignment_cardinality.sql','4f6e679e8b23a57d9cbfa2931b89866079ecc6d32c663487b2510448b8f07fd3','0d8c84f4a0f555c0f03b5758ee2639839bfbd63c'],
] as const
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
test('the final four migration bodies remain exact and packet assembly loads those real bytes in order', () => {
 expect(DEMO_MIGRATIONS).toEqual(pins.map(([path]) => path))
 for (const [path, sha256] of pins) expect(hash(readFileSync(path,'utf8')),path).toBe(sha256)
 const manifest = { version: 1, status: 'synthetic', upstream: '18ec064e43466dc8b567482a628b3ef91f886ce4', sources: pins.map(([path,sha256,commit]) => ({ path,sha256,commit })) }
 // Fictional metadata is only an assembly fixture. Actual migrations are exercised separately
 // by the full PostgreSQL composition; no target metadata or execution is claimed here.
 const baseline = { database: 'demo_rollout_test', operator: 'postgres', data_md5: '1'.repeat(32), schema_md5: '2'.repeat(32), pending_girard: 2, unresolved_requests: 0, promotion_bucket: null,
  new_tables: Object.fromEntries(Object.keys(DEMO_NEW_TABLES).map(key => [key,{ present: false, rows: null, unresolved_requests: null }])),
  columns: Object.fromEntries(DEMO_TABLES.map(key => [key,key==='public.users'?['id','role','is_active','manager_id']:['id']])), schema: {} }
 const packet = buildDemoRollout({ repoRoot: process.cwd(), target: { kind: 'fixture', host: '127.0.0.1', port: 65485, database: 'demo_rollout_test', operator: 'postgres', permit: 'disposable-demo-rollout' }, manifest, manifestSha256: hash(JSON.stringify(manifest)), baseline, schemaChanges: [] })
 expect(packet.fragments.map(fragment => fragment.sourceSha256)).toEqual(pins.map(([,sha256]) => sha256))
 expect(packet.fragments.map(fragment => fragment.path)).toEqual(pins.map(([path]) => path))
 expect(packet.transactionSql.match(/^BEGIN;$/gm)).toHaveLength(1)
 expect(packet.transactionSql.match(/^COMMIT;$/gm)).toHaveLength(1)
})

test('release instructions keep reviewed candidates deployment-disabled until backend and image checks finish', () => {
 const doc = readFileSync('docs/demo-revision-rollout.md','utf8')
 const first = doc.split('1. **Review and CI:**')[1]?.split('\n2. ')[0] ?? ''
 const client = doc.split('7. **Compatible client:**')[1]?.split('\n8. ')[0] ?? ''
 expect(first).toContain('deployment-disabled candidate branch `fix/demo-revisions`')
 expect(first).toContain('draft PR')
 expect(first).not.toContain('`fix/pilot-database`')
 expect(client).toContain('`fix/pilot-database`')
 expect(client).toContain('only after backend/readback and supporting service verification')
})
