// Fixed synthetic composition only, called after the runner's immutable server gate.
// Public catalogue source retains its own exact pins and finite native adaptation.
// No activation bundle, hosted snapshot, arbitrary paths, or cutover flag changes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildSjCatalogueFixture } from './sj-catalogue-fixture.mjs'
export const workspaceCurrentSourcePins = Object.freeze([
  [
    "supabase/sales_targets/v1/01-foundation.sql",
    "17a86a9a5880f6f41daca2b1be8ec8c1d07f1d7222e6a706103fc73e3db2304c"
  ],
  [
    "supabase/sales_targets/v1/02-scoped-reads.sql",
    "b640c3b4bc20158d3c8a5531a74be16f505ba6c681c8b5b3f904f9b56ea278e1"
  ],
  [
    "supabase/sales_targets/v1/03-commands.sql",
    "37b9bf7638312bd87bf31538c6c49fd8b5d5974f77f84ba027a7706f446be3de"
  ],
  [
    "supabase/sales_targets/v1/04-preflight-postflight.sql",
    "63957874ebc5eef17d04e3129fb72f0399956c02bb4ca608f434f49c067cb175"
  ],
  [
    "sql/employee-foundation-schema.sql",
    "c67dbea70d9e141e56abb78e6bf2d66b883db19028dddf6f18ccb258097c7565"
  ],
  [
    "sql/employee-foundation-commands.sql",
    "0e6fe61adef0e2dc5332e5f31543da9f98303015b0a3368904ee6035a498806d"
  ],
  [
    "sql/employee-foundation-reporting.sql",
    "8f5434e81776592cedee6f74ee9ad54ec64d1970f844ef450d8193f6d1cc7e9c"
  ],
  [
    "supabase/employees/v2/01-basic-fields.sql",
    "050cab8c6d96c7965a8aa5cde66c7a8ada393c108cde324bc986ab9a62c806c0"
  ],
  [
    "supabase/employees/v2/02-access-enforcement.sql",
    "008dae7e6fb2bebeeffdccf13a93ce953e789c54e43e46b157800bfc2169209f"
  ],
  [
    "supabase/employees/v2/03-protected-gates.sql",
    "cc62977714daa75b2fdb538e21e8e32488d1c0802db755b4680747e99927947e"
  ],
  [
    "supabase/employees/v2/04-catalogue-access.sql",
    "c9df4d346e69597e6e1d67a85c099066e11b462a95a524c7aa3ecd0f83869684"
  ]
])
export function runWorkspaceCurrentBaseline({read,run,verify}) {
  // Validate the entire fixed inventory before the first composition write.
  const parts = workspaceCurrentSourcePins.map(([path,hash]) => {
    const sql = read(path)
    assert.equal(createHash('sha256').update(sql).digest('hex'), hash, `Current baseline source changed: ${path}`)
    return sql
  })
  const catalogue = buildSjCatalogueFixture({read})
  const installed = run(catalogue)
  assert.equal(installed.split('\n').filter(x=>x==='SJ_CATALOGUE_COHERENT_SYNTHETIC_GRAPH_PASSED').length,1,'Actual catalogue composition marker required')
  verify()
  // Actual capability-off sales-target migrations supply the HR-protected actor.
  // Keep original transaction boundaries and source guards; grant no client access.
  for (const sql of parts.slice(0,4)) { run(sql); verify() }
  const hr = parts.slice(4).join('\n')
  assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK);/mi.test(hr),'HR source must remain transaction-neutral')
  const result = run(`BEGIN;\nSET LOCAL check_function_bodies=on;\n${hr}\nSELECT 'CO_WORKSPACE_CURRENT_BASELINE_PASSED';\nCOMMIT;\n`)
  assert.equal(result.split('\n').filter(x=>x==='CO_WORKSPACE_CURRENT_BASELINE_PASSED').length,1,'Actual current baseline marker required')
  verify()
}

// Full pg_proc rows include exact bodies, owners, language/configuration and ACLs.
// Preserve existing public dispatchers and inactive generation-two engines verbatim.
export const WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT = `
SELECT jsonb_build_object('functions',(
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN (
 'public.pilot_co_evidence_attest_v1(uuid,uuid,uuid,text,bigint,text,text)'::regprocedure,
 'public.current_user_role()'::regprocedure,
 'private.co_read_actor_v1()'::regprocedure,
 'public.pilot_co_transaction_v1(uuid,text,jsonb)'::regprocedure,
 'public.pilot_co_evidence_transaction_v1(uuid,text,jsonb)'::regprocedure,
 'private.catalog_co_dispatch_v2(uuid,text,jsonb)'::regprocedure,
 'private.catalog_co_monthly_transaction_v2(uuid,text,jsonb)'::regprocedure,
 'private.catalog_evidence_core_v2(uuid,text,jsonb,boolean)'::regprocedure)),
 'history',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND (p.proname ~ '^catalog_history_' OR p.proname = 'catalog_assert_history_contract_v1')),
 'cutover',(SELECT jsonb_agg(to_jsonb(c)) FROM private.catalog_cutover_v1 c),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c WHERE conrelid='private.catalog_cutover_v1'::regclass));`
