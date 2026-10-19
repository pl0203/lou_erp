import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,lstatSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {captureGitRevision,assertGitRevision,blob as gitBlob} from '../employee-browser/guards.mjs'
export const root=fileURLToPath(new URL('../../',import.meta.url))
export const hash=data=>createHash('sha256').update(data).digest('hex')
const gitEnv={PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'}
export const git=args=>execFileSync('git',args,{cwd:root,env:gitEnv,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim()
export function employeeSource(){
 const {commit,tree}=captureGitRevision(git)
 const inventory=readFileSync(join(root,'tests/employee-ci/source-files.json'))
 assert.equal(gitBlob(inventory),git(['rev-parse',`${commit}:tests/employee-ci/source-files.json`]),'Uncommitted fixed source inventory')
 const files=JSON.parse(inventory)
 assert.ok(Array.isArray(files)&&files.length>100&&files.length===new Set(files).size)
 const source=files.map(path=>{assert.match(path,/^(?:\.github\/workflows\/pilot-safety\.yml|package(?:-lock)?\.json|(?:src|public|scripts|sql|supabase\/(?:migrations|tests)|tests)\/[A-Za-z0-9._/-]+)$/);assert.ok(!path.split('/').includes('..')&&!path.includes('/.'))
  const segments=path.split('/');for(let n=1;n<=segments.length;n++){const info=lstatSync(join(root,...segments.slice(0,n)));assert.ok(!info.isSymbolicLink());assert.ok(n===segments.length?info.isFile():info.isDirectory())}
  const bytes=readFileSync(join(root,path)),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');assert.equal(blob,git(['rev-parse',`${commit}:${path}`]));return {path,blob,sha256:hash(bytes),bytes:bytes.length}})
 assert.ok(files.includes('tests/employee-ci/source-files.json'))
 assertGitRevision(git,{commit,tree})
 return {commit,tree,source}
}
