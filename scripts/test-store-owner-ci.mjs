// A dedicated, marker-guarded disposable database. Never targets a hosted project.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { demoCiConnection } from './test-demo-revisions-ci.mjs'
export function runStoreOwnerCi({ env = process.env, execute = execFileSync, root = process.cwd() } = {}) {
 const connection = demoCiConnection(env)
 const database = 'pilot_store_owner_test'
 const run = (sql, name = database) => execute('psql', ['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1'], { env: { ...connection, PGDATABASE: name }, input: sql, encoding:'utf8',timeout:180000,shell:false,stdio:['pipe','pipe','pipe'] })
 assert.equal(run("SELECT current_database()='pilot_test' AND current_user='postgres' AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');", 'pilot_test').trim(), 't')
 run(`CREATE DATABASE ${database};`, 'postgres')
 const file = path => readFileSync(`${root}/${path}`, 'utf8')
 const fixture = text => text.replaceAll("current_database()<>'pilot_test'", `current_database()<>'${database}'`)
 run(file('tests/database/fixture.sql'))
 for (const name of readdirSync(`${root}/supabase/migrations`).filter(n=>n.endsWith('.sql') && n<'20261009061801_unify_store_owner_credit.sql').sort()) {
  if (name==='202610010001_scalable_order_reads.sql') run(fixture(file('tests/database/hosted-read-policy-fixture.sql')))
  if (name==='202610081101_demo_order_promotions.sql') run(fixture(file('tests/database/demo/storage-fixture.sql')))
  run(file(`supabase/migrations/${name}`))
 }
 run(fixture(file('tests/database/demo/store-owner-seed.sql')))
 const migration=file('supabase/migrations/20261009061801_unify_store_owner_credit.sql')
 const reject=(setup,expected)=>{
  let failure
  try { run(`BEGIN;\n${setup}\n${migration}`) } catch(error) { failure=error }
  assert.ok(failure,'unsafe migration unexpectedly succeeded')
  assert.match(String(failure.stderr),expected)
  assert.equal(run("SELECT to_regclass('private.pilot_store_credit_corrections_v1') IS NULL AND (SELECT count(*) FROM public.purchase_orders)=4 AND (SELECT count(*) FROM public.girard_orders)=1 AND (SELECT tgenabled='O' FROM pg_trigger WHERE tgrelid='public.purchase_orders'::regclass AND tgname='demo_credit_immutable')").trim(),'t','rejected cutover must roll back every change')
 }
 reject('ALTER TABLE public.purchase_orders DISABLE TRIGGER demo_credit_immutable;',/Credit immutability trigger drift/)
 reject("INSERT INTO public.girard_orders(customer_id,submitted_by,status,po_id,total_value) SELECT customer_id,submitted_by,status,po_id,total_value FROM public.girard_orders;",/Ambiguous legacy PO linkage/)
 reject("ALTER FUNCTION private.demo_capture_credit(uuid) SECURITY DEFINER;",/authority metadata drift/)
 console.log('STORE_OWNER_UNSAFE_CUTOVERS_ROLLED_BACK')
 run(migration)
 const correctionCount=run('SELECT count(*) FROM private.pilot_store_credit_corrections_v1').trim()
 let repeated
 try { run(migration) } catch(error) { repeated=error }
 assert.ok(repeated,'one-time correction must not reapply')
 assert.equal(run('SELECT count(*) FROM private.pilot_store_credit_corrections_v1').trim(),correctionCount)

 const output=run(fixture(file('tests/database/demo/store-owner.sql')))
 assert.ok(output.includes('STORE_OWNER_SCOPE_CREDIT_AND_AUDIT_PASSED'))
 process.stdout.write(output)
 execute(process.execPath,['tests/database/demo/store-owner-races.mjs'],{cwd:root,env:{...connection,PGDATABASE:database,...Object.fromEntries(['CI','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_JOB','GITHUB_WORKFLOW'].filter(key=>env[key]!==undefined).map(key=>[key,env[key]]))},timeout:60000,shell:false,stdio:'inherit'})
 console.log('STORE_OWNER_COMPOSED_DATABASE_PASSED')
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 assert.equal(process.argv.length,2,'No custom database arguments accepted')
 runStoreOwnerCi()
}
