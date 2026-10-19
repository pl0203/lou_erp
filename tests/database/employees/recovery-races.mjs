// Fixed synthetic recovery lifecycle. No SQL, file, root or script input surface.
import assert from 'node:assert/strict'
import { execFileSync,spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID,createHash } from 'node:crypto'
import { dirname,join } from 'node:path'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { validateIhrDbTarget } from '../../../scripts/test-ihr-db.mjs'
import { assembleEmployeeSql,assembleEmployeeProofSql } from '../../../scripts/assemble-employee-sql.mjs'
import { ChildSessions,expectRaceRejection } from './command-races.mjs'
import { COLLISION_SERIALIZATION,collisionCreateSql,collisionObservationSql,collisionDropSql,assertOwnedCollision,withCollisionCleanup } from './collision-owner.mjs'
const root=dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const dir=join(root,'tests/database/employees')
const literal=x=>`'${String(x).replaceAll("'","''")}'`
const hash=x=>createHash('sha256').update(x).digest('hex')
const marker=`SELECT current_database()='pilot_test' AND current_user='postgres' AND inet_server_addr() IN('127.0.0.1'::inet,'::1'::inet) AND (SELECT count(*)=1 FROM public.pilot_fixture_marker) AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') AND to_regprocedure('public.leave_context_v1()') IS NOT NULL AND to_regprocedure('private.ihr_leave_calendar_timezone(uuid)') IS NOT NULL;`
const absent=`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private') AND c.relname LIKE 'employee\\_%' ESCAPE '\\') AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.proname LIKE 'employee\\_%' ESCAPE '\\') AND NOT EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN('public','private') AND (t.typname LIKE 'employee\\_%' ESCAPE '\\' OR t.typname LIKE '\\_employee\\_%' ESCAPE '\\'));`
const auth=id=>`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${literal(id)},false);`
const owner=`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`
const actor='95000000-0000-0000-0000-000000000004'
export async function runRecoveryRaces(options={}) {
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['env','probe','spawnProcess'].includes(k)))throw Error('Only fixed recovery options are allowed')
 const {env=process.env,probe=execFileSync,spawnProcess=spawn}=options,connection=validateIhrDbTarget(env)
 const args=['-h',connection.PGHOST,'-p',connection.PGPORT,'-U','postgres','-d','pilot_test','-X','--no-password','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose','-qAt']
 const execute=file=>execFileSync('psql',[...args,`--file=${file}`],{env:connection,cwd:root,encoding:'utf8',timeout:180000,shell:false,stdio:['ignore','pipe','pipe']})
 for(const [name,body]of Object.entries(assembleEmployeeSql()))assert.equal(readFileSync(join(root,`sql/employee-foundation-${name}.sql`),'utf8'),body)
 for(const [name,body]of Object.entries(assembleEmployeeProofSql()))assert.equal(readFileSync(join(dir,`${name}-atomic.sql`),'utf8'),body)
 let observed
 try{observed=probe('psql',args,{env:{...connection,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=5000'},input:marker,encoding:'utf8',timeout:15000,shell:false})}catch{throw Error('Disposable recovery marker required')}
 assert.equal(observed.trim(),'t','Disposable recovery marker required')
 const pool=new ChildSessions(connection,spawnProcess),token=randomUUID(),manifest=JSON.parse(readFileSync(join(root,'sql/employee-foundation/catalog-manifest.json'),'utf8'))
 process.stdout.write(`EMPLOYEE_RECOVERY_INVOCATION ${JSON.stringify({at:new Date().toISOString(),token})}\n`)
 let admin=pool.open('recovery-owner'),baseline,fixtureBaseline,attempted=false,installed=false,primaryError,interrupted=false
 const interrupt=()=>{interrupted=true;void pool.close()};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt)
 const load=(session=admin)=>session.query(`BEGIN;\\ir ${join(dir,'snapshot.sql')}\nCOMMIT;SET timezone='UTC';SET datestyle='ISO, MDY';SET intervalstyle='postgres';SET extra_float_digits=1;`)
 const legacy=(session=admin)=>session.query('SELECT pg_temp.employee_legacy_snapshot();')
 const retained=()=>admin.query('SELECT pg_temp.employee_retained_data();')
 const refuse=(file,reason)=>{
  let error;try{execute(file)}catch(value){error=value}
  assert.ok(error,`Expected ${reason}`);assert.equal(error.status,3);assert.equal(error.signal,null);assert.match(String(error.stderr),new RegExp(`P0001: ${reason}`));return error
 }
 try{
  assert.equal(await admin.query(marker),'t');assert.equal(await admin.query('SELECT pg_try_advisory_lock(491732,20261019);'),'t');assert.equal(await admin.query(absent),'t')
  await load();baseline=await legacy()
  // Production predicate is imported verbatim, not copied into this proof.
  try{assert.match(execute(join(dir,'owner-role-proof.sql')),/EMPLOYEE_NOINHERIT_OWNER_MEMBERSHIP_REJECTED/)}
  finally{const postRole=pool.open('post-role-rollback');try{assert.equal(await postRole.query("SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='employee_hr_noinherit_owner_probe_20261019') AND NOT EXISTS(SELECT 1 FROM pg_auth_members m LEFT JOIN pg_roles r ON r.oid=m.member LEFT JOIN pg_roles p ON p.oid=m.roleid WHERE r.oid IS NULL OR p.oid IS NULL);"),'t');assert.equal(await legacy(),baseline)}finally{await postRole.stop()}}
  process.stdout.write('EMPLOYEE_OWNER_ROLE_ROLLBACK_ABSENCE_PASSED\n')
  refuse(join(dir,'abort-atomic.sql'),'EMPLOYEE_FIXED_PRECOMMIT_FAILURE')
  // An independent post-abort connection, not error text, proves atomic absence.
  const post=pool.open('post-abort');assert.equal(await post.query(absent),'t');await post.stop();assert.equal(await legacy(),baseline)
  process.stdout.write('EMPLOYEE_ATOMIC_ABORT_ABSENCE_PASSED\n')
  // Fixed committed collision cases retain their original refusal assertions.
  // A fourth fixed case loses acknowledgement after COMMIT by closing its own
  // psql client with an intentional exception. No caller can select the fault.
  for(const scenario of [{kind:'table',ownedExit:false},{kind:'overload',ownedExit:false},{kind:'type',ownedExit:false},{kind:'type',ownedExit:true}]){
   const expected={kind:scenario.kind,token,baseline:hash(baseline)};let creationAttempted=false
   const stage=name=>process.stdout.write(`EMPLOYEE_COLLISION_STAGE ${JSON.stringify({at:new Date().toISOString(),kind:scenario.kind,ownedExit:scenario.ownedExit,stage:name})}\n`)
   try{
    await withCollisionCleanup(async()=>{
     // Record uncertainty BEFORE dispatch; object + marker commit atomically.
     creationAttempted=true;stage('create-dispatch')
     await admin.query(collisionCreateSql(expected)+(scenario.ownedExit?"DO $$ BEGIN RAISE EXCEPTION 'EMPLOYEE_FIXED_COLLISION_AFTER_COMMIT'; END $$;":''))
     stage('marked-create-acknowledged');const before=await legacy()
     refuse(join(root,'sql/employee-foundation-activation.sql'),'EMPLOYEE_INSTALL_REQUIRES_ABSENT_TOPOLOGY')
     stage('post-refusal-snapshot');assert.equal(await legacy(),before)
    },async()=>{
     if(!creationAttempted)return
     // Old owned clients must all close before the fresh connection takes the lock.
     await pool.close();admin=pool.open('collision-cleanup');stage('fresh-cleanup-guard')
     assert.equal(await admin.query(marker),'t');assert.equal(await admin.query('SELECT pg_try_advisory_lock(491732,20261019);'),'t');await load()
     await admin.query(`BEGIN;${COLLISION_SERIALIZATION}`)
     try{
      stage('marked-current-snapshot')
      const ownership=assertOwnedCollision(expected,await admin.query(collisionObservationSql(expected.kind)))
      if(!ownership.absent)await admin.query(collisionDropSql(expected.kind))
      stage('precommit-baseline-snapshot');assert.equal(await legacy(),baseline,'collision cleanup must preserve the complete original baseline');assert.equal(await admin.query(absent),'t','No unexpected employee topology may be adopted')
      await admin.query('COMMIT;')
     }catch(error){
      try{await admin.query('ROLLBACK;')}catch(rollback){throw new AggregateError([error,rollback],`${error.message}; rollback: ${rollback.message}`)}
      throw error
     }
     const independent=pool.open('collision-postcheck')
     try{assert.equal(await independent.query(marker),'t');await load(independent);assert.equal(await legacy(independent),baseline,'independent collision baseline required');assert.equal(await independent.query(absent),'t')}finally{await independent.stop()}
     stage('independent-baseline-passed')
    })
    assert.equal(scenario.ownedExit,false,'Fixed post-COMMIT client exit must really reject')
   }catch(error){
    if(!scenario.ownedExit)throw error
    if(error instanceof AggregateError||!/P0001: EMPLOYEE_FIXED_COLLISION_AFTER_COMMIT/.test(error.message))throw error
    process.stdout.write('EMPLOYEE_COLLISION_OWNER_EXIT_RECOVERED\n')
   }
  }
  attempted=true;await admin.query(`SELECT set_config('employee.proof_owner',${literal(token)},false);\n\\ir ${join(dir,'install-atomic.sql')}`);installed=true
  fixtureBaseline=await legacy();refuse(join(root,'sql/employee-foundation-activation.sql'),'EMPLOYEE_INSTALL_REQUIRES_ABSENT_TOPOLOGY');assert.equal(await legacy(),fixtureBaseline)
  try{assert.match(execute(join(dir,'effective-role-proof.sql')),/EMPLOYEE_INHERITED_TABLE_ACCESS_REJECTED/)}
  finally{const postEffective=pool.open('post-effective-rollback');try{assert.equal(await postEffective.query("SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='employee_hr_inherited_read_probe_20261019') AND NOT EXISTS(SELECT 1 FROM pg_auth_members m LEFT JOIN pg_roles r ON r.oid=m.member LEFT JOIN pg_roles p ON p.oid=m.roleid WHERE r.oid IS NULL OR p.oid IS NULL);"),'t');assert.equal(await legacy(),fixtureBaseline)}finally{await postEffective.stop()}}
  process.stdout.write('EMPLOYEE_EFFECTIVE_ROLE_ROLLBACK_ABSENCE_PASSED\n')
  try{assert.match(execute(join(dir,'set-role-proof.sql')),/EMPLOYEE_SET_REACHABLE_TABLE_ACCESS_REJECTED/);process.stdout.write('EMPLOYEE_SET_REACHABLE_TABLE_ACCESS_REJECTED\nEMPLOYEE_SET_FUNCTION_POLICY_CASES_PASSED\n')}
  finally{const postSet=pool.open('post-set-rollback');try{assert.equal(await postSet.query("SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('employee_hr_set_only_probe_20261019','employee_hr_set_bridge_probe_20261019')) AND NOT EXISTS(SELECT 1 FROM pg_auth_members m LEFT JOIN pg_roles r ON r.oid=m.member LEFT JOIN pg_roles p ON p.oid=m.roleid WHERE r.oid IS NULL OR p.oid IS NULL);"),'t');assert.equal(await legacy(),fixtureBaseline);process.stdout.write('EMPLOYEE_SET_ROLE_ROLLBACK_ABSENCE_PASSED\n')}finally{await postSet.stop()}}
  // A helper outside the exact reviewed topology must not survive a claimed disable.
  await admin.query('CREATE FUNCTION private.employee_unreviewed_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;')
  try{refuse(join(root,'sql/employee-foundation-disable.sql'),'EMPLOYEE_UNKNOWN_TOPOLOGY_OR_ACL')}
  finally{await admin.query('DROP FUNCTION private.employee_unreviewed_probe();')}
  assert.equal(await legacy(),fixtureBaseline)
  // Both original candidate suites execute with HR really installed; their own
  // transaction semantics remain untouched, and their fixtures roll back.
  for(const name of ['calendar-weekly-combined.sql','calendar-director-combined.sql']){
   const output=execute(join(dir,name));assert.match(output,/EMPLOYEE_.*_CALENDAR_COMBINED_PASSED/);process.stdout.write(output.split('\n').filter(x=>x.endsWith('_PASSED')).join('\n')+'\n')
  }
  assert.equal(await legacy(),fixtureBaseline)
  execute(join(root,'sql/employee-foundation-disable.sql'))
  for(const name of ['calendar-weekly-combined.sql','calendar-director-combined.sql'])assert.match(execute(join(dir,name)),/EMPLOYEE_.*_CALENDAR_COMBINED_PASSED/)
  execute(join(root,'sql/employee-foundation-reenable.sql'));assert.equal(await legacy(),fixtureBaseline)
  await admin.query(`BEGIN;\\ir ${join(dir,'fixture-users.sql')}
UPDATE private.hr_verification_owner SET scope_delta=1;COMMIT;`);fixtureBaseline=await legacy()
  await admin.query(`BEGIN;UPDATE private.employee_settings SET timezone='UTC',version=version+1;\n\\ir ${join(dir,'retained-fixture.sql')}\nCOMMIT;`)
  assert.equal(await legacy(),fixtureBaseline,'HR history commands changed legacy state before cleanup')
  // Behavioral RED: while enabled, the exact disabled matrix must reject its own
  // hypothesis because active Director execution is genuinely still granted.
  refuse(join(dir,'disabled-matrix.sql'),'EMPLOYEE_EFFECTIVE_FUNCTION_GRANT')
  process.stdout.write('EMPLOYEE_DISABLE_MATRIX_ENABLED_RED_VERIFIED\n')
  // Already admitted command waits inside its body on an owned employee row.
  const employee='97000000-0000-0000-0000-000000000001',operation='98000000-0000-0000-0000-000000000100'
  await admin.query(auth(actor));const detail=JSON.parse(await admin.query(`SELECT public.employee_detail_v1('${employee}');`))
  const payload={...detail.fields,name:'Legitimate pre-drain commit'}
  const preview=JSON.parse(await admin.query(`SELECT public.employee_preview_v1('${employee}',${detail.version},'edit_employee',${literal(JSON.stringify(payload))},'Pre-drain accepted',NULL,NULL);`));await admin.query(owner)
  const blocker=pool.open('drain-blocker'),writer=pool.open('already-admitted')
  await blocker.query(`BEGIN;SELECT id FROM private.employee_records WHERE id='${employee}' FOR UPDATE;`)
  const pid=Number(await writer.query('SELECT pg_backend_pid();'));await writer.query(auth(actor))
  const inFlight=writer.query(`SELECT public.employee_command_v1('${operation}','${employee}',${detail.version},'edit_employee',${literal(JSON.stringify(payload))},'Pre-drain accepted',NULL,NULL,${literal(preview.previewFingerprint)});`);inFlight.catch(()=>{})
  let waiting=false;for(let n=0;n<200;n++){if(await admin.query(`SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=${pid};`)==='t'){waiting=true;break}await new Promise(r=>setTimeout(r,20))}assert.equal(waiting,true,'ordinary admitted command must really wait')
  const beforeDisable=await retained();execute(join(root,'sql/employee-foundation-disable.sql'));assert.equal(await retained(),beforeDisable)
  await blocker.query('ROLLBACK;');await blocker.stop();const admitted=JSON.parse(await inFlight);await writer.stop();assert.equal(admitted.operationId,operation)
  assert.notEqual(await retained(),beforeDisable,'legitimate already-admitted write must remain committed')
  const drained=await retained();execute(join(root,'sql/employee-foundation-disable.sql'));assert.equal(await retained(),drained,'repeat disable preserves drained history')
  const denied=execute(join(dir,'disabled-matrix.sql'));assert.match(denied,/EMPLOYEE_DISABLED_ALL_ROLE_SURFACES_DENIED/);assert.equal(await retained(),drained)
  process.stdout.write('EMPLOYEE_DISABLED_ALL_ROLE_SURFACES_DENIED\nEMPLOYEE_ADMITTED_WRITE_RETAINED_AFTER_DISABLE\n')
  assert.equal(await legacy(),fixtureBaseline,'disabled HR changed unrelated legacy access or data')
  execute(join(root,'sql/employee-foundation-reenable.sql'));assert.equal(await retained(),drained)
  await admin.query(auth(actor))
  assert.equal(await admin.query("SELECT public.employee_operation_v1('98000000-0000-0000-0000-000000000001','read')->'result'=:'fixture_command'::jsonb;"),'t')
  assert.equal(await admin.query("SELECT public.employee_command_v1('98000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001',0,'create_employee',pg_temp.employee_fixture_fields('Synthetic retained 李','OLD-01'),'Synthetic history proof',NULL,NULL,:'fixture_preview'::jsonb->>'previewFingerprint')=:'fixture_command'::jsonb;"),'t')
  await admin.query(owner);assert.equal(await retained(),drained,'original same-ID replay must not append history')
  const conflict=pool.open('changed-replay');await conflict.query(auth(actor));await expectRaceRejection(conflict.query("SELECT public.employee_command_v1('98000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001',0,'create_employee','{\"name\":\"Changed\",\"employeeNumber\":null,\"jobTitle\":null,\"team\":null,\"recordedStatus\":\"draft\"}','Synthetic history proof',NULL,NULL,repeat('a',64));"),'22023','OPERATION_REUSED')
  const abandoned=pool.open('abandoned-replay');await abandoned.query(auth(actor));await expectRaceRejection(abandoned.query("SELECT public.employee_command_v1('98000000-0000-0000-0000-000000000099','97000000-0000-0000-0000-000000000003',0,'create_employee','{\"name\":\"Never created\",\"employeeNumber\":null,\"jobTitle\":null,\"team\":null,\"recordedStatus\":\"draft\"}','Synthetic history proof',NULL,NULL,repeat('a',64));"),'55000','OPERATION_ABANDONED')
  await admin.query(auth('95000000-0000-0000-0000-000000000014'));assert.equal(await admin.query("SELECT public.employee_operation_v1('98000000-0000-0000-0000-000000000001','read')->>'state'='absent';"),'t');await admin.query(owner)
  assert.equal(await retained(),drained);assert.equal(await legacy(),fixtureBaseline)
  process.stdout.write('EMPLOYEE_RETAINED_REENABLE_REPLAY_PASSED\n')
 }catch(error){primaryError=error}
 finally{
  await pool.close()
  if(attempted){
   admin=pool.open('recovery-cleanup')
   try{
    assert.equal(await admin.query(marker),'t');assert.equal(await admin.query('SELECT pg_try_advisory_lock(491732,20261019);'),'t')
    const exists=await admin.query("SELECT to_regclass('private.hr_verification_owner') IS NOT NULL;")
    if(exists==='t'){
     await load();assert.equal(await admin.query(`SELECT count(*)=1 AND bool_and(token=${literal(token)}::uuid AND functions=pg_temp.employee_entrypoints()||pg_temp.employee_helpers() AND users=ARRAY(SELECT ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM unnest(ARRAY[1,2,3,4,7,13,14,16])n) AND scope_delta IN(0,1)) FROM private.hr_verification_owner;`),'t','exact invocation token required')
     const digest=await admin.query("SELECT encode(sha256(convert_to(pg_temp.employee_catalog(true)::text,'UTF8')),'hex');")
     assert.ok([manifest.activeSha256,manifest.disabledSha256].includes(digest),'Unknown HR definitions/ACLs: refuse cleanup')
     const product=await legacy();if(fixtureBaseline)assert.equal(product,fixtureBaseline,'legacy drift before cleanup cannot be hidden')
     await admin.query(`BEGIN;DO $$ DECLARE f text; BEGIN FOR f IN SELECT unnest(functions) FROM private.hr_verification_owner LOOP IF f<>'private.employee_timezone_valid(text)' THEN EXECUTE format('DROP FUNCTION %s',f); END IF; END LOOP; END $$;
      DROP TABLE private.employee_reporting_intervals,private.employee_reporting_revisions,private.employee_audit_events,private.employee_operations,private.employee_episodes,private.employee_account_links,private.employee_number_claims;
      DROP TABLE private.employee_records,private.employee_settings,private.employee_reporting_guard;DROP FUNCTION private.employee_timezone_valid(text);
      DO $$ BEGIN IF (SELECT scope_delta=1 FROM private.hr_verification_owner) THEN DELETE FROM public.users WHERE id=ANY((SELECT users FROM private.hr_verification_owner)::uuid[]);DELETE FROM auth.users WHERE id=ANY((SELECT users FROM private.hr_verification_owner)::uuid[]);END IF;END $$;
      DO $$ BEGIN IF NOT (SELECT s.version=o.scope_original+2*o.scope_delta FROM private.ihr_leave_scope_revision s CROSS JOIN private.hr_verification_owner o) THEN RAISE EXCEPTION 'Unexplained fixture scope increment'; END IF; END $$;
      UPDATE private.ihr_leave_scope_revision SET version=(SELECT scope_original FROM private.hr_verification_owner) WHERE singleton;DROP TABLE private.hr_verification_owner;COMMIT;`)
    }else assert.equal(installed,false,'owned manifest unexpectedly absent')
    await load();assert.equal(await legacy(),baseline,'expanded complete legacy baseline must be restored');assert.equal(await admin.query(absent),'t')
   }catch(error){primaryError=primaryError?new AggregateError([primaryError,error],`${primaryError.message}; cleanup: ${error.message}`):error}
   finally{await pool.close()}
  }
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
 }
 assert.equal(pool.liveCount,0);if(interrupted&&!primaryError)primaryError=Error('Interrupted recovery proof')
 if(primaryError)throw primaryError
 process.stdout.write(`EMPLOYEE_RECOVERY_RACES_PASSED\nEMPLOYEE_EXPANDED_BASELINE_PRESERVED ${hash(baseline)}\n`)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{assert.equal(process.argv.length,2,'No recovery arguments permitted');await runRecoveryRaces()}catch(e){process.stderr.write(`Employee recovery failed: ${e.message}\n`);process.exitCode=1}}
