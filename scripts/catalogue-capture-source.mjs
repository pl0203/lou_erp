// Public capture inputs only. All SQL comes from the exact reviewed synthetic list.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync,readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const defaultRoot=fileURLToPath(new URL('../',import.meta.url))
export const catalogueCompositionSha256='186e22b2490d28c2a4b2256bdc03147698b447eda1e516fdbf3fcdf3c0339f9a'
export const cataloguePublicSourcePaths=[
 '.github/workflows/pilot-safety.yml','vercel.json','tests/vercel-routing.test.ts',
 'scripts/catalogue-checkout.mjs','scripts/catalogue-ci-profile.mjs','scripts/catalogue-capture-source.mjs',
 'scripts/catalogue-capture-baseline.mjs','scripts/catalogue-ci-metadata.sql','supabase/catalogue/ci/composition.json',
 'tests/catalogue-ci/checkout.test.ts','tests/catalogue-ci/capture.test.ts',
 'tests/co/ci-workflow.test.ts','tests/co/ci-shallow-checkout.test.ts',
 'scripts/catalogue-failfast-probe.mjs',
 'scripts/catalogue-foundation-red.mjs',
 'tests/database/catalogue/foundation.sql',
 'scripts/catalogue-foundation.mjs',
 'supabase/catalogue/v1/01-foundation.sql',
 'tests/database/catalogue/before-foundation.sql',
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
 'tests/catalogue-ci/foundation-red.node.mjs',
 'tests/catalogue-ci/failfast.node.mjs',
 'tests/database/catalogue-failfast/core.mjs',
 'tests/database/catalogue-failfast/core.node.mjs',
 'tests/database/catalogue-failfast/output.node.mjs',
 'tests/database/catalogue-failfast/results.mjs',
 'tests/database/catalogue-failfast/runner.mjs',
 'tests/database/catalogue-failfast/runner.node.mjs',
 'tests/database/catalogue-failfast/scenarios.mjs',
 'tests/database/catalogue-failfast/schema.sql',
 'tests/database/catalogue-failfast/session.mjs',
 'tests/database/catalogue-failfast/session.node.mjs',
]
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
export function catalogueCaptureSourceBytes(root,path) {
 assert.match(path,/^[A-Za-z0-9_./-]+$/,'Invalid source path')
 const parts=path.split('/')
 assert.ok(parts.every(part=>part&&!['.','..','.git','.npmrc','.pgpass','.pg_service.conf'].includes(part)&&!/^\.env(?:\.|$)/.test(part)),'Protected source path refused')
 assert.ok(path!=='supabase/config.toml'&&!path.startsWith('supabase/.temp/'),'Protected source path refused')
 for(let index=0;index<parts.length;index++) {
  const stat=lstatSync(resolve(root,...parts.slice(0,index+1)))
  assert.ok(!stat.isSymbolicLink()&&(index===parts.length-1?stat.isFile():stat.isDirectory()),'Source symlink or nonregular file refused')
 }
 return readFileSync(resolve(root,path))
}
export function assertCatalogueCaptureSource(root=defaultRoot) {
 const manifest=JSON.parse(catalogueCaptureSourceBytes(root,'supabase/catalogue/ci/composition.json'))
 assert.equal(manifest.format,'catalogue-ci-composition-v1');assert.equal(manifest.scope,'synthetic-source-only')
 assert.deepEqual(manifest.source,{commit:'b7ce900494ad205420986fffdd5738f2a2cc6070',tree:'81394fc1702c12f68fb58e4b86f29df22af82ac6'})
 assert.equal(manifest.composition.length,42)
 assert.equal(hash(JSON.stringify(manifest.composition)),catalogueCompositionSha256,'Reviewed composition drift')
 for(const {path,sha256} of manifest.composition)assert.equal(hash(catalogueCaptureSourceBytes(root,path)),sha256,'Composition source byte drift')
 return manifest
}
export function catalogueCaptureSourceIdentity(root=defaultRoot,execute=execFileSync) {
 const git=args=>execute('git',args,{cwd:root,env:{PATH:process.env.PATH,GIT_NO_LAZY_FETCH:'1'},encoding:'utf8',timeout:10000,shell:false,stdio:['pipe','pipe','pipe']}).trim()
 const commit=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']),clean=git(['status','--porcelain','--untracked-files=normal'])===''
 const manifest=assertCatalogueCaptureSource(root)
 const paths=[...new Set([...cataloguePublicSourcePaths,...manifest.composition.map(entry=>entry.path)])].sort()
 const candidate=hash(JSON.stringify(paths.map(path=>[path,hash(catalogueCaptureSourceBytes(root,path))])))
 return {commit,tree,candidate,clean}
}
export function catalogueCompositionSql(path,sql) {
 if(path.startsWith('tests/'))sql=sql.replaceAll("current_database()<>'pilot_test'","current_database()<>'pilot_catalogue_test'").replaceAll("current_database()<>'pilot_co_test'","current_database()<>'pilot_catalogue_test'")
 if(path==='tests/database/hosted-read-policy-fixture.sql') {
  const guard="tablename<>'pilot_fixture_marker'"
  assert.equal(sql.split(guard).length,2,'Exact empty-fixture boundary required')
  sql=sql.replace(guard,"tablename NOT IN ('pilot_fixture_marker','catalogue_fixture_identity_v1')")
 }
 if(path==='tests/database/fixture.sql')sql+='\nREVOKE ALL ON public.catalogue_fixture_identity_v1 FROM anon,authenticated,service_role;\n'
 return sql
}
export function assertCatalogueMetadataSql(sql) {
 assert.ok(sql.startsWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;')&&sql.endsWith('\nROLLBACK;\n'),'Read-only transaction required')
 for(const setting of ["SET LOCAL TIME ZONE 'UTC';","SET LOCAL search_path='';",'SET LOCAL row_security=off;',"SET LOCAL statement_timeout='30s';","SET LOCAL lock_timeout='5s';","SET LOCAL idle_in_transaction_session_timeout='30s';"])assert.ok(sql.includes(setting),'Bounded metadata settings required')
 const statements=sql.replace(/'(?:[^']|'')*'/g,"''").replace(/--[^\n]*/g,'')
 assert.ok(!/\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|COMMIT|LOCK|dblink|pg_terminate_backend|pg_read_file|lo_import)\b/i.test(statements),'Mutating or external metadata SQL refused')
 assert.ok(!/\b(?:FROM|JOIN)\s+(?:public|private|auth|storage)\./i.test(statements),'Business-row queries refused')
 assert.ok(!sql.includes("'definition',pg_get_functiondef")&&!sql.includes("'prosrc',"),'Raw function bodies refused')
}
