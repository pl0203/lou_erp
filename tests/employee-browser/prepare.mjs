import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm,lstat,readdir} from 'node:fs/promises'
import {dirname,resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {assertBrowserManifest,SOURCE_FILES,sha,blob,validateBrowserMode,assertBuiltStyles,captureGitRevision,assertGitRevision} from './guards.mjs'
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
export const output=join(root,'scale-results/employee-browser')
export const harnessFiles=['styles.css','index.html','harness.tsx','harness.css','fixture.tsx','server.ts','vite.config.ts','source-manifest.json','guards.mjs','prepare.mjs','run.mjs','preview.html','preview.js','serve.py'].map(name=>'tests/employee-browser/'+name)
const bindingFiles=['.github/workflows/pilot-safety.yml','tests/employees/browser-guard.test.ts','tests/employees/ci-binding.test.ts','tests/employees/source-revision.test.ts']
const gitEnv={PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'}
export const git=args=>execFileSync('git',args,{cwd:root,env:gitEnv,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim()
export const safeEnv=home=>({PATH:process.env.PATH,HOME:home,TMPDIR:home,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',NODE_ENV:'production'})
export async function prepareEmployeeBrowser(args){
 const mode=validateBrowserMode(args,process.env),report={version:1,status:'failed',mode,source:[],harness:[],build:[],assertions:[],screenshots:[],networkViolations:[]}
 let temporary,owned=false
 try{
  Object.assign(report,captureGitRevision(git))
  if(mode==='github-ci'){assert.equal(report.commit,process.env.EMPLOYEE_BROWSER_SOURCE_SHA);report.context={repository:process.env.GITHUB_REPOSITORY,workflow:process.env.GITHUB_WORKFLOW,job:process.env.GITHUB_JOB,event:process.env.GITHUB_EVENT_NAME,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT}}
  else report.context={kind:'local',ci:'not-run',browser:'not-run'}
  await mkdir(dirname(output),{recursive:true});assert.ok(!(await lstat(dirname(output))).isSymbolicLink());await mkdir(output);owned=true
  const bytes=new Map()
  for(const path of [...SOURCE_FILES,...harnessFiles,...bindingFiles]){
   assert.ok(!path.includes('..')&&!path.includes('\\'))
   for(let i=1;i<=path.split('/').length;i++){const info=await lstat(join(root,...path.split('/').slice(0,i)));assert.ok(!info.isSymbolicLink());assert.ok(i===path.split('/').length?info.isFile():info.isDirectory())}
   const data=await readFile(join(root,path));assert.equal(blob(data),git(['rev-parse',`${report.commit}:${path}`]),`Uncommitted public source: ${path}`);bytes.set(path,data)
  }
  const manifest=JSON.parse(bytes.get('tests/employee-browser/source-manifest.json'));assertBrowserManifest(manifest,new Map(SOURCE_FILES.map(path=>[path,bytes.get(path)])))
  report.dependency=manifest.dependency
  for(const path of SOURCE_FILES)report.source.push({path,gitBlob:blob(bytes.get(path)),sha256:sha(bytes.get(path))})
  for(const path of [...harnessFiles,...bindingFiles])report.harness.push({path,gitBlob:blob(bytes.get(path)),sha256:sha(bytes.get(path))})
  temporary=await mkdtemp(join(tmpdir(),'employee-browser-'));const app=join(temporary,'app'),home=join(temporary,'home');await mkdir(app);await mkdir(home)
  for(const path of [...SOURCE_FILES,...harnessFiles]){const target=join(app,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes.get(path))}
  await symlink(join(root,'node_modules'),join(app,'node_modules'),'dir')
  execFileSync(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build','--config',join(app,'tests/employee-browser/vite.config.ts'),'--outDir',join(output,'site')],{cwd:app,env:safeEnv(home),encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe'],shell:false})
  for(const name of ['preview.html','preview.js'])await writeFile(join(output,'site',name),bytes.get('tests/employee-browser/'+name))
  await writeFile(join(output,'serve.py'),bytes.get('tests/employee-browser/serve.py'))
  async function walk(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const path=prefix+entry.name;if(entry.isDirectory())await walk(join(dir,entry.name),path+'/');else{assert.ok(entry.isFile());const data=await readFile(join(dir,entry.name));report.build.push({path,sha256:sha(data),bytes:data.length})}}}
  await walk(join(output,'site'));assertBuiltStyles((await Promise.all(report.build.filter(f=>f.path.endsWith('.css')).map(f=>readFile(join(output,'site',f.path),'utf8')))).join('\n'));report.build.sort((a,b)=>a.path.localeCompare(b.path));assertGitRevision(git,report);report.status='prepared'
  report.assertions.push({name:'Exact clean Git source, fixed allowlist and isolated no-env build verified'})
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report
 }catch(error){if(owned)await writeFile(join(output,'report.json'),JSON.stringify({...report,status:'failed',error:error.message},null,2)+'\n');throw error}
 finally{if(temporary)await rm(temporary,{recursive:true,force:true})}
}
