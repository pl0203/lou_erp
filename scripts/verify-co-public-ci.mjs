// Test-branch admission. No file bytes or credential values are printed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const git = args => execFileSync('git', args, {encoding:'utf8', env:{PATH:process.env.PATH}, timeout:10000}).trim()
assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.GITHUB_REPOSITORY, 'pl0203/lou_erp')
assert.equal(process.env.GITHUB_WORKFLOW, 'CO workspace runtime')
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request')
assert.equal(process.env.GITHUB_HEAD_REF, 'test/co-workspace-runtime-20261027')
assert.ok(['workspace-sql','native-runtime','stock-return-sql','stock-return-native'].includes(process.env.GITHUB_JOB))
assert.match(process.env.CO_CI_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/)
assert.equal(git(['rev-parse','HEAD']), process.env.CO_CI_SOURCE_SHA)
assert.equal(git(['status','--porcelain','--untracked-files=normal']), '')
const paths = git(['ls-tree','-r','--name-only','HEAD']).split('\n')
for (const path of paths) {
 assert.ok(!path.split('/').some(p=>/^\.env(?:\.|$)/.test(p) || ['.npmrc','.pgpass','.pg_service.conf'].includes(p)), 'Credential configuration must not be present')
 assert.ok(!path.startsWith('.superpowers/') && !path.startsWith('supabase/.temp/'), 'Private workspace paths must not be present')
 assert.ok(!path.startsWith('docs/verification/co-workspace') && path !== 'scripts/verify-co-sample-import.mjs', 'Private receipts must not be present')
}
assert.deepEqual(paths.filter(p=>/^\.github\/workflows\/.*\.ya?ml$/.test(p)), ['.github/workflows/co-workspace-runtime.yml'])
const config=JSON.parse(readFileSync('vercel.json','utf8'))
assert.equal(config.git.deploymentEnabled['test/co-workspace-runtime-20261027'],false)
console.log('CO_PUBLIC_SOURCE_ADMISSION_PASSED')
console.log(`CO_TEST_SOURCE_SHA=${git(['rev-parse','HEAD'])}`)
console.log(`CO_TEST_SOURCE_TREE=${git(['rev-parse','HEAD^{tree}'])}`)
