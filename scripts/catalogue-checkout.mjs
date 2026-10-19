// Materialize only safe blobs from the exact public PR head, without lazy fetching.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync,readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const excludedPath=path=>path.split('/').some(part=>/^\.env(?:\.|$)/.test(part)||['.npmrc','.pgpass','.pg_service.conf'].includes(part))
 ||path==='supabase/config.toml'||path.startsWith('supabase/.temp/')
export function catalogueCheckoutTree(bytes) {
 const source=String(bytes),entries=source.split('\0');assert.equal(entries.pop(),'','NUL-terminated exact tree required')
 const selected=[],excluded=[],paths=new Set()
 for(const entry of entries) {
  const match=/^(100644|100755) blob ([0-9a-f]{40})\t([A-Za-z0-9_./@+-]+)$/.exec(entry)
  assert.ok(match,'Only regular safe-path Git blobs are accepted; no symlinks/gitlinks')
  const [,mode,sha,path]=match
  assert.ok(!path.startsWith('/') && !path.endsWith('/') && path.split('/').every(part=>part && !['.','..','.git'].includes(part)),'Source path escape refused')
  assert.ok(!paths.has(path),'Duplicate source path');paths.add(path)
  ;(excludedPath(path)?excluded:selected).push({path,sha,mode})
 }
 assert.ok(selected.length>0,'Empty safe source selection')
 const excludedIds=new Set(excluded.map(entry=>entry.sha))
 assert.ok(selected.every(entry=>!excludedIds.has(entry.sha)),'Excluded blob aliases a selected path')
 return {selected,excluded,patterns:selected.map(entry=>`/${entry.path}`).join('\n')+'\n'}
}
export function catalogueCheckoutGitEnv(env) {
 return {PATH:env.PATH,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/bin/false',SSH_ASKPASS:'/bin/false',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}
}
export function catalogueCheckoutFetchArgs(ids) {
 assert.ok(ids.length>0 && ids.every(id=>/^[a-f0-9]{40}$/.test(id)),'Exact safe blob IDs required')
 return ['-c','credential.helper=','-c','core.askPass=','-c','http.extraHeader=','fetch','--no-tags','--no-write-fetch-head','--filter=blob:none','https://github.com/pl0203/lou_erp.git',...ids]
}
export function catalogueVerifyCheckoutBlob(sha,bytes) {
 assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),sha,'Git blob byte identity mismatch')
}
export function materializeCatalogueCheckout({env=process.env,repoRoot=process.cwd(),execute=execFileSync}={}) {
 const expected=env.CATALOGUE_CI_SOURCE_SHA
 assert.match(expected??'',/^[a-f0-9]{40}$/,'Exact PR head required')
 assert.equal(env.GITHUB_REPOSITORY,'pl0203/lou_erp');assert.equal(env.GITHUB_JOB,'catalogue-baseline')
 const git=(args,options={})=>execute('git',args,{cwd:repoRoot,env:catalogueCheckoutGitEnv(env),encoding:'utf8',timeout:120000,maxBuffer:64*1024*1024,shell:false,stdio:['pipe','pipe','pipe'],...options})
 assert.equal(git(['rev-parse','HEAD']).trim(),expected,'Checkout must equal exact PR head')
 const tree=git(['rev-parse','HEAD^{tree}']).trim();assert.match(tree,/^[a-f0-9]{40}$/)
 const manifest=catalogueCheckoutTree(git(['ls-tree','-rz','--full-tree',expected]))
 const excludedIds=[...new Set(manifest.excluded.map(entry=>entry.sha))]
 const checkExcluded=()=>{
  if(excludedIds.length)assert.deepEqual(git(['cat-file','--batch-check'],{input:excludedIds.join('\n')+'\n'}).trim().split('\n'),excludedIds.map(id=>`${id} missing`),'Excluded source blob unexpectedly present; refusing to read it')
  for(const {path} of manifest.excluded) {
   try { lstatSync(resolve(repoRoot,path));assert.fail('Excluded source path materialized') }
   catch(error) { if(error.code!=='ENOENT')throw error }
  }
 }
 checkExcluded()
 const ids=[...new Set(manifest.selected.map(entry=>entry.sha))]
 for(let start=0;start<ids.length;start+=100)git(catalogueCheckoutFetchArgs(ids.slice(start,start+100)))
 checkExcluded()
 // Validate actual allowed blob bytes before materializing any repository file.
 for(const id of ids)catalogueVerifyCheckoutBlob(id,git(['cat-file','blob',id],{encoding:null}))
 git(['sparse-checkout','set','--no-cone','--stdin'],{input:manifest.patterns})
 git(['checkout','--detach',expected])
 assert.equal(git(['rev-parse','HEAD']).trim(),expected);assert.equal(git(['rev-parse','HEAD^{tree}']).trim(),tree)
 assert.equal(git(['status','--porcelain','--untracked-files=normal']).trim(),'','Sparse source must remain clean')
 checkExcluded()
 for(const {path,sha} of manifest.selected) {
  const stat=lstatSync(resolve(repoRoot,path));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Materialized source must be a regular file')
  catalogueVerifyCheckoutBlob(sha,readFileSync(resolve(repoRoot,path)))
 }
 return {status:'safe-source-materialized',commit:expected,tree,selectedFiles:manifest.selected.length,excludedFiles:manifest.excluded.length,excludedBlobsAbsent:true}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try { assert.deepEqual(process.argv.slice(2),[],'Checkout accepts no flags');console.log(JSON.stringify(materializeCatalogueCheckout())) }
 catch { process.stderr.write('CATALOGUE_CHECKOUT_REFUSED\n');process.exitCode=1 }
}
