// Synthetic multi-session regression only. No hosted targets, schema resets, or caller SQL/path inputs.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateIhrDbTarget } from '../../../scripts/test-ihr-db.mjs'
const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const marker = `SELECT current_database()='pilot_test' AND current_user='postgres'
 AND inet_server_addr() IN ('127.0.0.1'::inet,'::1'::inet)
 AND (SELECT count(*) FROM public.pilot_fixture_marker)=1
 AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 AND to_regclass('public.users') IS NOT NULL AND to_regprocedure('public.leave_context_v1()') IS NOT NULL
 AND to_regprocedure('private.ihr_leave_calendar_timezone(uuid)') IS NOT NULL;`
const args = env => ['-h',env.PGHOST,'-p',env.PGPORT,'-U','postgres','-d','pilot_test','-X','--no-password','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose','-qAt']
const literal = value => `'${String(value).replaceAll("'","''")}'`
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms))

// Every started process remains tracked until its close event, including errors.
export class ChildSessions {
  constructor(env, spawnProcess=spawn) { this.env=env; this.spawnProcess=spawnProcess; this.children=new Set() }
  get liveCount() { return this.children.size }
  open(label) {
    const child=this.spawnProcess('psql',args(this.env),{cwd:root,env:{...this.env,PGAPPNAME:`employee-race-${label}`,
      PGOPTIONS:'-c statement_timeout=20000 -c lock_timeout=15000'},stdio:['pipe','pipe','pipe'],shell:false})
    this.children.add(child)
    let output='',errors='',pending=null,closed=false,sequence=0
    const finishError=error=>{if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null}}
    const closedPromise=new Promise(resolve=>child.once('close',(code,signal)=>{
      closed=true;this.children.delete(child);finishError(Error(`psql ${label} closed (${code ?? signal}): ${errors}`));resolve()
    }))
    child.on('error',error=>finishError(error))
    child.stdin.on('error',error=>finishError(error))
    child.stderr.on('data',data=>{errors+=data})
    child.stdout.on('data',data=>{
      output+=data
      if(pending && output.includes(`${pending.token}\n`)) {
        const index=output.indexOf(`${pending.token}\n`),value=output.slice(0,index).trim()
        output=output.slice(index+pending.token.length+1);const current=pending;pending=null;clearTimeout(current.timer);current.resolve(value)
      }
    })
    return {
      query(sql) {
        if(closed || pending) return Promise.reject(Error('Session closed or query already pending'))
        return new Promise((resolve,reject)=>{
          const token=`EMPLOYEE_QUERY_DONE_${++sequence}`
          const timer=setTimeout(()=>{finishError(Error(`Query timeout ${label}: ${errors}`));child.kill('SIGTERM')},25000)
          pending={token,resolve,reject,timer};child.stdin.write(`${sql}\n\\echo ${token}\n`)
        })
      },
      async stop() { if(!closed) {child.stdin.end('ROLLBACK;\n\\q\n');await Promise.race([closedPromise,delay(1000)])} if(!closed) child.kill('SIGTERM');await closedPromise },
    }
  }
  async close() {
    const children=[...this.children]
    await Promise.all(children.map(child=>new Promise(resolve=>{
      if(!this.children.has(child)) return resolve()
      let timer
      child.once('close',()=>{clearTimeout(timer);resolve()})
      child.kill('SIGTERM')
      timer=setTimeout(()=>child.kill('SIGKILL'),1000)
    })))
  }
}
const baselineFunction = `CREATE OR REPLACE FUNCTION pg_temp.employee_baseline() RETURNS text LANGUAGE plpgsql AS $$
DECLARE t record; data_hash text; result text:=''; BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private','auth') AND c.relkind='r' AND c.relname NOT LIKE 'employee\\_%' ESCAPE '\\' ORDER BY 1,2 LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(r)::text), %L ORDER BY md5(to_jsonb(r)::text)),%L)) FROM %I.%I r','','',t.nspname,t.relname) INTO data_hash;
  result:=result||t.nspname||'.'||t.relname||':'||data_hash||';';
 END LOOP;
 RETURN md5(result||coalesce((SELECT string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),';' ORDER BY n.nspname,p.proname,p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','auth') AND p.prokind='f' AND p.proname NOT LIKE 'employee\\_%' ESCAPE '\\'),'')||
 coalesce((SELECT string_agg(n.nspname||coalesce(n.nspacl::text,''),';' ORDER BY n.nspname) FROM pg_namespace n WHERE n.nspname IN('public','private','auth')),'')||
 coalesce((SELECT string_agg(n.nspname||c.relname||coalesce(c.relacl::text,'')||c.relrowsecurity::text,';' ORDER BY n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth') AND c.relkind='r' AND c.relname NOT LIKE 'employee\\_%' ESCAPE '\\'),'')); END $$;`

// Observe unexpected early outcomes immediately while another session's lock barrier
// is pending. Preserve the rejection for the later await, allowing finally to reap.
export function expectRaceRejection(promise,code,reason) {
  const outcome=promise.then(()=>{throw Error(`Expected ${reason}`)},error=>{assert.match(error.message,new RegExp(`${code}: ${reason}`));return reason})
  outcome.catch(()=>{})
  return outcome
}

export async function runCommandRaces(options={}) { return runRaces('commands',options) }
export async function runReportingRaces(options={}) { return runRaces('reporting',options) }

// Shared owned lifecycle. Only these two fixed suite wrappers can choose a scenario.
async function runRaces(suite,options) {
  const allowed=new Set(['env','probe','spawnProcess'])
  if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>!allowed.has(key))) throw Error('Only fixed race options are allowed')
  const {env=process.env,probe=execFileSync,spawnProcess=spawn}=options
  const connection=validateIhrDbTarget(env)
  let verified
  try {verified=probe('psql',args(connection),{env:{...connection,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=5000'},input:marker,encoding:'utf8',timeout:15000,shell:false})}
  catch {throw Error('Disposable race marker verification failed')}
  if(typeof verified!=='string' || verified.trim()!=='t') throw Error('Disposable race marker required')
  const pool=new ChildSessions(connection,spawnProcess),owner=randomUUID(),actors=[randomUUID(),randomUUID()],accounts=[randomUUID(),randomUUID()]
  let admin=pool.open('owner'),baseline,fixtureBaseline,installed=false,installAttempted=false,primaryError
  const allUsers=[...actors,...accounts]
  let interrupted=false
  const interrupt=()=>{interrupted=true;void pool.close()}
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt)
  const auth = actor=>`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${literal(actor)},false);`
  const fields = (name,number=null)=>({name,employeeNumber:number,jobTitle:null,team:null,recordedStatus:'draft'})
  const preview=async(actor,e,v,action,payload)=>{
    await admin.query(auth(actor));const value=JSON.parse(await admin.query(`SELECT public.employee_preview_v1(${literal(e)},${v},${literal(action)},${literal(JSON.stringify(payload))}::jsonb,'Race fixture',NULL,NULL);`));await admin.query("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");return value.previewFingerprint
  }
  const command=(op,e,v,action,payload,fp)=>`SELECT public.employee_command_v1(${literal(op)},${literal(e)},${v},${literal(action)},${literal(JSON.stringify(payload))}::jsonb,'Race fixture',NULL,NULL,${literal(fp)});`
  const create=async(name)=>{
    const id=randomUUID(),p=fields(name),fp=await preview(actors[0],id,0,'create_employee',p)
    await admin.query(auth(actors[0]));await admin.query(command(randomUUID(),id,0,'create_employee',p,fp));await admin.query("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");return id
  }
  const open=async(actor,label)=>{const session=pool.open(label);const pid=Number(await session.query('SELECT pg_backend_pid();'));await session.query(auth(actor));return {session,pid}}
  const waiting=async pid=>{
    const end=Date.now()+5000
    while(Date.now()<end) { if(await admin.query(`SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=${pid};`)==='t') return; await delay(20) }
    throw Error(`Expected concurrent session ${pid} to wait on a lock`)
  }
  const rejected=expectRaceRejection
  try {
    assert.equal(await admin.query(marker),'t')
    assert.equal(await admin.query("SELECT pg_try_advisory_lock(491732,20261019);"),'t','another command race owns this fixture')
    assert.equal(await admin.query(`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private') AND c.relname LIKE 'employee\\_%' ESCAPE '\\')
      AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.proname LIKE 'employee\\_%' ESCAPE '\\');`),'t','refuse pre-existing employee objects')
    await admin.query(`BEGIN;\\ir ${join(root,'tests/database/employees/snapshot.sql')}\nCOMMIT;`);await admin.query(baselineFunction);baseline=await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');")
    installAttempted=true
    await admin.query(`BEGIN;
      \\ir ${join(root,'sql/employee-foundation-schema.sql')}
      \\ir ${join(root,'sql/employee-foundation-commands.sql')}
      ${suite==='reporting'?`\\ir ${join(root,'sql/employee-foundation-reporting.sql')}`:''}
      CREATE TABLE private.employee_race_owner(token uuid PRIMARY KEY,functions text[] NOT NULL,users uuid[] NOT NULL,baseline text NOT NULL,scope_original bigint NOT NULL,scope_delta bigint NOT NULL DEFAULT 1);
      INSERT INTO private.employee_race_owner(token,functions,users,baseline,scope_original) SELECT ${literal(owner)},array_agg(p.oid::regprocedure::text),ARRAY[${allUsers.map(id=>literal(id)+'::uuid').join(',')}],${literal(baseline)},(SELECT version FROM private.ihr_leave_scope_revision WHERE singleton)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.proname LIKE 'employee\\_%' ESCAPE '\\';
      INSERT INTO auth.users(id) VALUES ${allUsers.map(id=>`(${literal(id)})`).join(',')};
      INSERT INTO public.users(id,full_name,email,role,is_active) VALUES ${allUsers.map((id,i)=>`(${literal(id)},'Synthetic race ${i}',${literal(`race-${id}@example.invalid`)},'${i<2?'executive':'sales_person'}',true)`).join(',')};
      COMMIT;`)
    installed=true
    fixtureBaseline=await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');")
    // Same actor+operation: a lost response/double click gets exactly one receipt.
    {
      const e=randomUUID(),op=randomUUID(),payload=fields('Replay'),fp=await preview(actors[0],e,0,'create_employee',payload)
      const a=await open(actors[0],'replay-a'),b=await open(actors[0],'replay-b'),recovery=await open(actors[0],'recover-pending')
      await a.session.query('BEGIN;');const first=JSON.parse(await a.session.query(command(op,e,0,'create_employee',payload,fp)))
      const second=b.session.query(command(op,e,0,'create_employee',payload,fp));await waiting(b.pid)
      const recovered=recovery.session.query(`SELECT public.employee_operation_v1(${literal(op)},'read');`);await waiting(recovery.pid);await a.session.query('COMMIT;')
      assert.deepEqual(JSON.parse(await second),first)
      assert.deepEqual(JSON.parse(await recovered),{state:'completed',result:first})
      assert.equal(await admin.query(`SELECT count(*)=1 FROM private.employee_audit_events WHERE employee_id=${literal(e)};`),'t')
      await a.session.stop();await b.session.stop();await recovery.session.stop()
    }
    // Distinct actors/employees race to the same lifetime account. Unique settles it.
    {
      const e1=await create('Link one'),e2=await create('Link two'),payload={userId:accounts[0]}
      const fp1=await preview(actors[0],e1,1,'link_account',payload),fp2=await preview(actors[1],e2,1,'link_account',payload)
      const a=await open(actors[0],'link-a'),b=await open(actors[1],'link-b')
      await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),e1,1,'link_account',payload,fp1))
      const loser=rejected(b.session.query(command(randomUUID(),e2,1,'link_account',payload,fp2)),'23505','ACCOUNT_ALREADY_LINKED')
      await waiting(b.pid);await a.session.query('COMMIT;');await loser
      assert.equal(await admin.query(`SELECT version=1 AND NOT EXISTS(SELECT 1 FROM private.employee_account_links WHERE employee_id=${literal(e2)}) FROM private.employee_records WHERE id=${literal(e2)};`),'t')
      await a.session.stop()
    }
    // Concurrent normalized number claims have one winner and no failed residue.
    {
      const e1=randomUUID(),e2=randomUUID(),p1=fields('Number winner',' Race-Number '),p2=fields('Number loser','race-number')
      const fp1=await preview(actors[0],e1,0,'create_employee',p1),fp2=await preview(actors[1],e2,0,'create_employee',p2)
      const a=await open(actors[0],'number-a'),b=await open(actors[1],'number-b')
      await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),e1,0,'create_employee',p1,fp1))
      const loser=rejected(b.session.query(command(randomUUID(),e2,0,'create_employee',p2,fp2)),'23505','NUMBER_CLAIMED')
      await waiting(b.pid);await a.session.query('COMMIT;');await loser;await a.session.stop()
      assert.equal(await admin.query(`SELECT NOT EXISTS(SELECT 1 FROM private.employee_records WHERE id=${literal(e2)}) AND (SELECT count(*) FROM private.employee_number_claims WHERE normalized_number='race-number')=1;`),'t')
    }
    // Two distinct editors cannot overwrite a record while waiting on its lock.
    {
      const e=await create('Edit race'),p1=fields('Winner'),p2=fields('Loser')
      const fp1=await preview(actors[0],e,1,'edit_employee',p1),fp2=await preview(actors[1],e,1,'edit_employee',p2)
      const a=await open(actors[0],'edit-a'),b=await open(actors[1],'edit-b')
      await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),e,1,'edit_employee',p1,fp1))
      const loser=rejected(b.session.query(command(randomUUID(),e,1,'edit_employee',p2,fp2)),'40001','VERSION_CONFLICT')
      await waiting(b.pid);await a.session.query('COMMIT;');await loser
      assert.equal(await admin.query(`SELECT version=2 AND name='Winner' FROM private.employee_records WHERE id=${literal(e)};`),'t');await a.session.stop()
    }
    assert.equal(await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');"),fixtureBaseline,'ordinary product commands changed legacy data or account access')
    // Authority deactivated while the writer waits must be checked on the new row.
    {
      const e=await create('Revocation'),p=fields('Never saved'),fp=await preview(actors[1],e,1,'edit_employee',p)
      const a=pool.open('deactivate'),b=await open(actors[1],'revoked-writer')
      await a.query(`BEGIN;UPDATE public.users SET is_active=false WHERE id=${literal(actors[1])};UPDATE private.employee_race_owner SET scope_delta=scope_delta+1 WHERE token=${literal(owner)};`)
      const denied=rejected(b.session.query(command(randomUUID(),e,1,'edit_employee',p,fp)),'42501','DIRECTOR_REQUIRED')
      await waiting(b.pid);await a.query('COMMIT;');await denied;await a.stop()
      assert.equal(await admin.query(`SELECT version=1 FROM private.employee_records WHERE id=${literal(e)};`),'t')
      await admin.query(`BEGIN;UPDATE public.users SET is_active=true WHERE id=${literal(actors[1])};UPDATE private.employee_race_owner SET scope_delta=scope_delta+1 WHERE token=${literal(owner)};COMMIT;`)
      assert.equal(await admin.query('SELECT s.version=o.scope_original+o.scope_delta FROM private.ihr_leave_scope_revision s CROSS JOIN private.employee_race_owner o;'),'t','exact deliberate fixture increments')
      fixtureBaseline=await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');")
    }
    // Abandon wins while an already delayed command is waiting on the same ID.
    {
      const e=randomUUID(),op=randomUUID(),p=fields('Abandoned'),fp=await preview(actors[0],e,0,'create_employee',p)
      const a=await open(actors[0],'abandon'),b=await open(actors[0],'late-command')
      await a.session.query(`BEGIN;SELECT public.employee_operation_v1(${literal(op)},'abandon');`)
      const denied=rejected(b.session.query(command(op,e,0,'create_employee',p,fp)),'55000','OPERATION_ABANDONED')
      await waiting(b.pid);await a.session.query('COMMIT;');await denied;await a.session.stop()
      assert.equal(await admin.query(`SELECT NOT EXISTS(SELECT 1 FROM private.employee_records WHERE id=${literal(e)});`),'t')
    }
    // Force a child SQL error in an open transaction; its uncommitted work rolls back.
    {
      const session=pool.open('rollback-on-error');await session.query(`BEGIN;UPDATE public.users SET full_name='Must roll back' WHERE id=${literal(accounts[1])};`)
      await assert.rejects(session.query("DO $$ BEGIN RAISE EXCEPTION 'expected synthetic child failure'; END $$;"),/expected synthetic child failure/)
      assert.equal(await admin.query(`SELECT full_name='Synthetic race 3' FROM public.users WHERE id=${literal(accounts[1])};`),'t')
    }
    assert.equal(await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');"),fixtureBaseline,'recovery commands or failed child changed legacy data')
    if(suite==='reporting') {
      const { runReportingScenarios }=await import('./reporting-races.mjs')
      await runReportingScenarios({admin,pool,actors,create,preview,command,open,waiting,rejected,auth})
      assert.equal(await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');"),fixtureBaseline,'reporting commands changed legacy data, permissions or account access')
    }
  } catch(error) {primaryError=error}
  finally {
    // Reap every concurrent child before removing any fixture. Coordinator holds
    // the invocation lock until cleanup; if it died, reacquire in a fresh session.
    await pool.close()
    if(installAttempted) {
      admin=pool.open('cleanup')
      try {
        assert.equal(await admin.query(marker),'t','cleanup target/marker changed')
        assert.equal(await admin.query('SELECT pg_try_advisory_lock(491732,20261019);'),'t','cleanup ownership lock unavailable')
        const exists=await admin.query("SELECT to_regclass('private.employee_race_owner') IS NOT NULL;")
        if(exists==='t') {
          assert.equal(await admin.query(`SELECT count(*)=1 AND bool_and(token=${literal(owner)}::uuid) FROM private.employee_race_owner;`),'t','cleanup token does not belong to this invocation')
          await admin.query(`BEGIN;\\ir ${join(root,'tests/database/employees/snapshot.sql')}\nCOMMIT;`);await admin.query(baselineFunction);
          if(fixtureBaseline)assert.equal(await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');"),fixtureBaseline,'expanded legacy snapshot changed before cleanup');
          await admin.query(`BEGIN;
            DO $$ DECLARE signature text; BEGIN FOR signature IN SELECT unnest(functions) FROM private.employee_race_owner LOOP
              IF signature<>'private.employee_timezone_valid(text)' THEN EXECUTE format('DROP FUNCTION %s',signature); END IF; END LOOP; END $$;
            DROP TABLE private.employee_reporting_intervals,private.employee_reporting_revisions,private.employee_audit_events,private.employee_operations,
              private.employee_episodes,private.employee_account_links,private.employee_number_claims;
            DROP TABLE private.employee_records,private.employee_settings,private.employee_reporting_guard;
            DROP FUNCTION private.employee_timezone_valid(text);
            DELETE FROM public.users WHERE id IN(${allUsers.map(literal).join(',')});
            DELETE FROM auth.users WHERE id IN(${allUsers.map(literal).join(',')});
            DO $$ BEGIN IF NOT (SELECT s.version=o.scope_original+o.scope_delta+1 FROM private.ihr_leave_scope_revision s CROSS JOIN private.employee_race_owner o)
              THEN RAISE EXCEPTION 'Unexplained legacy scope change: refuse restoration'; END IF; END $$;
            UPDATE private.ihr_leave_scope_revision SET version=(SELECT scope_original FROM private.employee_race_owner) WHERE singleton;
            DROP TABLE private.employee_race_owner;COMMIT;`)
        } else assert.equal(installed,false,'owned fixture unexpectedly missing')
        await admin.query(`BEGIN;\\ir ${join(root,'tests/database/employees/snapshot.sql')}\nCOMMIT;`);await admin.query(baselineFunction)
        assert.equal(await admin.query("SELECT pg_temp.employee_baseline()||':'||encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex');"),baseline,'legacy table/function fingerprints changed')
      } catch(error) {primaryError=primaryError?new AggregateError([primaryError,error],`${primaryError.message}; cleanup: ${error.message}`):error}
      finally {await pool.close()}
    }
  }
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
  assert.equal(pool.liveCount,0,'all race children reaped')
  if(interrupted && !primaryError) primaryError=Error('Command races interrupted; owned cleanup completed')
  if(primaryError) throw primaryError
  process.stdout.write(`EMPLOYEE_COMMAND_RACES_PASSED\n${suite==='reporting'?'EMPLOYEE_REPORTING_RACES_PASSED\n':''}EMPLOYEE_RACE_BASELINE_PRESERVED ${baseline}\n`)
}
