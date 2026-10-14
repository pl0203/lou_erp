// @vitest-environment node
import { expect, test } from 'vitest'
import { existsSync,readFileSync,mkdtempSync,rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
const mod=existsSync('scripts/catalogue-checkout.mjs')?await import(pathToFileURL(resolve('scripts/catalogue-checkout.mjs')).href):{}
const entry=(path:string,id='a'.repeat(40),mode='100644',type='blob')=>`${mode} ${type} ${id}\t${path}\0`
test('safe exact tree selection excludes configuration without opening blob contents',()=>{
 expect(mod.catalogueCheckoutTree).toBeTypeOf('function')
 const parsed=mod.catalogueCheckoutTree(entry('scripts/catalogue-checkout.mjs')+entry('.env','b'.repeat(40))+entry('supabase/config.toml','c'.repeat(40))+entry('supabase/.temp/pooler-url','d'.repeat(40))+entry('supabase/functions/invite-user/.npmrc','e'.repeat(40)))
 expect(parsed.selected.map((x:any)=>x.path)).toEqual(['scripts/catalogue-checkout.mjs'])
 expect(parsed.excluded.length).toBe(4)
 expect(parsed.patterns).toBe('/scripts/catalogue-checkout.mjs\n')
})
test.each(['../escape','/absolute','src/../escape','src/.git/config','src/a\\b','src/a\nb','src/[glob]'])('unsafe tree path %s fails before fetch',(path)=>{
 expect(mod.catalogueCheckoutTree).toBeTypeOf('function');expect(()=>mod.catalogueCheckoutTree(entry(path))).toThrow()
})
test('symlinks, gitlinks and shared excluded blob aliases cannot be fetched',()=>{
 for(const tree of [entry('src/link','a'.repeat(40),'120000'),entry('submodule','a'.repeat(40),'160000','commit'),entry('src/safe')+entry('.env')])expect(()=>mod.catalogueCheckoutTree(tree)).toThrow()
})
test('Git children keep no-lazy and fixed unauthenticated public fetch without credential fallback',()=>{
 expect(mod.catalogueCheckoutGitEnv({PATH:'/usr/bin',SECRET:'x',GITHUB_TOKEN:'x',GIT_CONFIG_COUNT:'1'})).toEqual({PATH:'/usr/bin',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/bin/false',SSH_ASKPASS:'/bin/false',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'})
 const args=mod.catalogueCheckoutFetchArgs(['a'.repeat(40)])
 expect(args).toContain('https://github.com/pl0203/lou_erp.git');expect(args).toContain('credential.helper=');expect(args).toContain('http.extraHeader=')
 expect(args).not.toContain('origin')
 expect(()=>mod.catalogueCheckoutFetchArgs(['--upload-pack=bad'])).toThrow()
})
test('allowed blob verification binds exact git SHA1 and bytes',()=>{
 const bytes=Buffer.from('synthetic source\n'),sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
 expect(()=>mod.catalogueVerifyCheckoutBlob(sha,bytes)).not.toThrow()
 expect(()=>mod.catalogueVerifyCheckoutBlob(sha,Buffer.from('changed'))).toThrow()
})
test('workflow starts metadata-only then explicitly fetches only safe exact-head sources',()=>{
 const job=readFileSync('.github/workflows/pilot-safety.yml','utf8').split('\n  catalogue-baseline:')[1]
 expect(job).toContain('sparse-checkout: /__catalogue_no_files__')
 expect(job).toContain('sparse-checkout-cone-mode: false')
 expect(job).toContain('scripts/catalogue-checkout.mjs')
 expect(job).toContain('GIT_NO_LAZY_FETCH')
})

test('real sparse Git materialization preserves excluded missing blobs and a clean exact-head source',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'catalogue-safe-checkout-'))
 const env=mod.catalogueCheckoutGitEnv(process.env)
 const git=(args:string[],input?:string)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',input,stdio:'pipe'})
 try {
  git(['init','--quiet'])
  const content='synthetic permitted source\n',safe=git(['hash-object','-w','--stdin'],content).trim(),excluded='b'.repeat(40)
  const tree=git(['mktree','--missing'],`100644 blob ${excluded}\t.env\n100644 blob ${safe}\tcode.txt\n`).trim()
  const commit=git(['-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid','commit-tree',tree], 'synthetic fixture\n').trim()
  git(['update-ref','HEAD',commit])
  git(['sparse-checkout','set','--no-cone','--stdin'],'/__catalogue_no_files__\n')
  git(['checkout','--detach',commit])
  const fetches:any[]=[]
  const execute=(file:string,args:string[],options:any)=>{
   expect(options.env.GIT_NO_LAZY_FETCH).toBe('1')
   if(args.includes('fetch')){fetches.push(args);return ''}
   return execFileSync(file,args,options)
  }
  const result=mod.materializeCatalogueCheckout({repoRoot:root,env:{PATH:process.env.PATH,CATALOGUE_CI_SOURCE_SHA:commit,GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_JOB:'catalogue-baseline'},execute})
  expect(result.excludedBlobsAbsent).toBe(true);expect(result.commit).toBe(commit)
  expect(readFileSync(resolve(root,'code.txt'),'utf8')).toBe(content);expect(existsSync(resolve(root,'.env'))).toBe(false)
  expect(git(['status','--porcelain'])).toBe('')
  expect(git(['cat-file','--batch-check'],excluded+'\n')).toBe(excluded+' missing\n')
  expect(fetches.length).toBe(1);expect(fetches[0]).toContain(safe);expect(fetches[0]).not.toContain(excluded)
 } finally {rmSync(root,{recursive:true,force:true})}
})
