import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync,lstatSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { validateBinding,connectionFor,identityGate,observationSql,verifyObservation,isBlockedBy,literal,verifyGateRefusal } from './core.mjs';
import { PsqlSession } from './session.mjs';
import { runScenarios } from './scenarios.mjs';
import { publicResult } from './results.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const executableFiles=['core.mjs','results.mjs','runner.mjs','scenarios.mjs','schema.sql','session.mjs'].sort();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function verifyFiles(binding) {
 assert.deepEqual(Object.keys(binding.files).sort(),executableFiles,'Exact reviewed executable file set required');
 for(const path of executableFiles){const full=resolve(root,path);assert.equal(lstatSync(full).isSymbolicLink(),false);assert.equal(sha(readFileSync(full)),binding.files[path],`Proof file drift: ${path}`);}
}
export async function run(binding,sourceRoot,env=process.env) {
 validateBinding(binding); // Deliberately before git, psql, output files or mutations.
 const connection=connectionFor(env,binding);verifyFiles(binding);
 const git=args=>execFileSync('git',args,{cwd:sourceRoot,env:{PATH:env.PATH,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},encoding:'utf8',timeout:10000,shell:false,stdio:['pipe','pipe','pipe']}).trim();
 const sourceEnvelopeCheck=()=>{assert.equal(git(['rev-parse','HEAD']),binding.identity.source.commit);assert.equal(git(['rev-parse','HEAD^{tree}']),binding.identity.source.tree);assert.equal(git(['status','--porcelain','--untracked-files=normal']),'','Clean exact source required');verifyFiles(binding);};
 sourceEnvelopeCheck();
 for(const helper of ['scripts/catalogue-capture-source.mjs']){
  const disk=readFileSync(resolve(sourceRoot,helper));
  const committed=execFileSync('git',['cat-file','blob',`${binding.identity.source.commit}:${helper}`],{cwd:sourceRoot,env:{PATH:env.PATH,GIT_NO_LAZY_FETCH:'1'},timeout:10000,shell:false,stdio:['pipe','pipe','pipe']});
  assert.deepEqual(disk,committed,`Source identity helper differs from exact commit: ${helper}`);
 }
 const sourceHelper=await import(pathToFileURL(resolve(sourceRoot,'scripts/catalogue-capture-source.mjs')).href);
 assert.equal(typeof sourceHelper.catalogueCaptureSourceIdentity,'function','Reviewed source identity helper required');
 const sourceCheck=()=>{sourceEnvelopeCheck();assert.deepEqual(sourceHelper.catalogueCaptureSourceIdentity(sourceRoot,(command,args,options)=>{assert.equal(command,'git');return execFileSync(command,args,{...options,env:{PATH:env.PATH,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['pipe','pipe','pipe']});}),binding.identity.source,'Exact candidate bytes changed');};
 sourceCheck();
 const sync=sql=>execFileSync('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{env:connection,input:sql,encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024,shell:false,stdio:['pipe','pipe','pipe']});
 verifyObservation(JSON.parse(sync(observationSql)),binding);
 let refusal;try{sync('\\set ON_ERROR_STOP on\nSELECT false AS refusal_ok\n\\gset\n\\if :refusal_ok\n\\else\nSELECT 1/0 AS refusal_expected;\n\\endif\nSELECT \'UNSAFE_GATE_CONTINUED\';');}catch(error){refusal=error;}
 verifyGateRefusal(refusal);
 const schema=readFileSync(resolve(root,'schema.sql'),'utf8');
 const build=(name,nowait,collision=false)=>{assert.ok(['ff_blocking','ff_nowait','ff_collision'].includes(name));return schema.replaceAll('__SCHEMA__',name).replaceAll('__NOWAIT__',nowait?'NOWAIT':'').replaceAll('__RESERVATION_HASH__',collision?'42::bigint':"hashtextextended('failfast-proof-v1:'||k::text||':'||v::text,0)");};
 sync(identityGate(binding)+"BEGIN;\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('ff_blocking','ff_nowait','ff_collision')) THEN RAISE EXCEPTION 'Fresh proof schemas required; never reset or reuse'; END IF; END $$;\n"+build('ff_blocking',false)+build('ff_nowait',true)+build('ff_collision',true,true)+'COMMIT;\n');
 const report={status:'RUNNING',cases:[]};
 const sessions=[];let current,observer;
 const record=x=>current.observations.push(x);
 const session=async name=>{const s=new PsqlSession({name,env:connection});sessions.push(s);const r=await s.query(identityGate(binding)+`SET statement_timeout='12s'; SET lock_timeout='8s'; SET deadlock_timeout='3s'; SET idle_in_transaction_session_timeout='30s'; SET search_path=pg_catalog; SET probe.actor='10000000-0000-0000-0000-000000000001';\n\\set ON_ERROR_STOP off\nSELECT pg_backend_pid();`);assert.equal(r.sqlstate,'00000');s.pid=Number(r.stdout.trim());assert.ok(Number.isInteger(s.pid)&&s.pid>0);return s;};
 const ok=async(s,q)=>{const r=await s.query(q);assert.equal(r.sqlstate,'00000',JSON.stringify(r));return r;};
 const scalar=async q=>(await ok(observer,q.replace(/;?$/,';'))).stdout.trim();
 const observe=async s=>JSON.parse(await scalar(`SELECT jsonb_build_object('pid',a.pid,'state',a.state,'wait_event_type',a.wait_event_type,'wait_event',a.wait_event,'blockers',to_jsonb(pg_blocking_pids(a.pid)),'locks',(SELECT coalesce(jsonb_agg(jsonb_build_object('locktype',l.locktype,'mode',l.mode,'granted',l.granted,'relation',l.relation::regclass::text,'transactionid',l.transactionid::text,'classid',l.classid,'objid',l.objid)), '[]'::jsonb) FROM pg_locks l WHERE l.pid=a.pid)) FROM pg_stat_activity a WHERE a.pid=${s.pid}`));
 const blocked=async(a,b)=>{const end=Date.now()+2000;while(Date.now()<end){const o=await observe(a);if(isBlockedBy(o,b.pid)){record({barrier:o});return o;}if(!a.pending)throw new Error('Expected blocking operation ended before barrier');await pause(10);}throw new Error('Named blocker/pg_locks barrier missing');};
 const cycle=async(a,b)=>{const end=Date.now()+2000;while(Date.now()<end){const ao=await observe(a),bo=await observe(b);if(isBlockedBy(ao,b.pid)&&isBlockedBy(bo,a.pid)){record({cycle:[ao,bo]});return;}await pause(10);}throw new Error('Reciprocal wait graph not observed before deadlock resolution');};
 const fast=async(s,q,code)=>{let result,error;const observed=[];const p=s.query(q).then(r=>{result=r;},e=>{error=e;});const end=Date.now()+2000;while(!result&&!error&&Date.now()<end){observed.push(await observe(s));await pause(5);}await p;if(error)throw error;assert.equal(result.sqlstate,code,JSON.stringify(result));assert.ok(result.elapsedMs<2000,`Refusal not fast (${result.elapsedMs}ms); lock_timeout is 8000ms`);assert.ok(!observed.some(o=>o.wait_event_type==='Lock'&&o.locks.some(l=>!l.granted)),'A transactional wait was sampled in fail-fast operation');record({fastRefusal:{sqlstate:result.sqlstate,elapsedMs:result.elapsedMs,observed}});return result;};
 const begin=async(s,isolation='READ COMMITTED',role=false)=>{assert.ok(['READ COMMITTED','REPEATABLE READ'].includes(isolation));return ok(s,identityGate(binding)+`BEGIN ISOLATION LEVEL ${isolation}; ${role?'SET LOCAL ROLE authenticated;':''}\n\\set ON_ERROR_STOP off\nSELECT 1;`);};
 const rollback=async s=>ok(s,'ROLLBACK;');
 const commit=async s=>ok(s,'COMMIT;');
 const test=async(name,fn)=>{sourceCheck();verifyObservation(JSON.parse(sync(observationSql)),binding);current={name,status:'RUNNING',observations:[]};report.cases.push(current);try{await fn();current.status='PASSED';}catch(e){current.status='FAILED';throw e;}finally{for(const s of sessions.filter(x=>x!==observer&&!x.closed)){if(!s.pending)await s.query('ROLLBACK;').catch(()=>{});await s.close();}}};
 try {
  observer=await session('observer');
  await runScenarios({test,session,begin,rollback,commit,scalar,observe,blocked,fast,cycle,record,pause});
  sourceCheck();verifyObservation(JSON.parse(sync(observationSql)),binding);
  report.status='BOUNDED_REPRESENTATIVE_CASES_PASSED';
 } catch {report.status='FAILED_OR_INCONCLUSIVE';throw Object.assign(new Error('SYNTHETIC_FAILFAST_REFUSED'),{report:publicResult(report,binding)});}
 finally {for(const s of sessions)await s.close();}
 return publicResult(report,binding);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{assert.equal(process.argv.length,6,'Usage: node runner.mjs --binding FILE --source-root CHECKOUT');assert.equal(process.argv[2],'--binding');assert.equal(process.argv[4],'--source-root');const b=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));const r=await run(b,resolve(process.argv[5]));console.log(JSON.stringify({status:r.status,cases:r.cases.map(({name,status})=>({name,status})),scope:r.scope}));}catch(error){console.error('SYNTHETIC_FAILFAST_REFUSED');process.exitCode=1;}}
