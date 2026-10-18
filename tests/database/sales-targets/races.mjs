import assert from 'node:assert/strict'
const manager = '10000000-0000-4000-8000-000000000003'
const head = '10000000-0000-4000-8000-000000000002'
const executive = '10000000-0000-4000-8000-000000000001'
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const actor = id => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(id)},false);`
const lastJson = output => JSON.parse(output.trim().split('\n').at(-1))
export async function runRaces({ sql, spawnSql }) {
  const create = (month, operation='submit') => lastJson(sql(`${actor(manager)} SELECT public.pilot_sales_target_command_v1(gen_random_uuid(),${quote(operation)},public.test_payload(${quote(month)}));`))
  const command = (id, operation, payload, request='gen_random_uuid()') => `${actor(id)} SELECT public.pilot_sales_target_command_v1(${request},${quote(operation)},${quote(JSON.stringify(payload))}::jsonb);`
  let r = create('2027-01-01'); let payload = {planId:r.plan.id,expectedVersion:r.plan.version}
  const approvals = await Promise.all([spawnSql(command(head,'approve_publish',payload)),spawnSql(command(executive,'approve_publish',payload))])
  assert.equal(approvals.filter(x=>x.code===0).length,1,'exactly one Head/executive race wins')
  assert.ok(approvals.find(x=>x.code!==0).error.includes('Stale plan version'))
  assert.equal(sql("SELECT count(*) FROM private.sales_target_active WHERE month='2027-01-01'").trim(),'9')
  console.log('RACE_HEAD_EXECUTIVE_PASSED')
  r = create('2027-02-01','save_draft')
  const draftPayload = lastJson(sql(`${actor(manager)} SELECT public.test_payload('2027-02-01');`))
  payload = {...draftPayload,planId:r.plan.id,expectedVersion:r.plan.version}
  const editSubmit = await Promise.all([spawnSql(command(manager,'submit',payload)),spawnSql(command(manager,'save_draft',payload))])
  assert.equal(editSubmit.filter(x=>x.code===0).length,1,'edit/submit race one version only')
  console.log('RACE_EDIT_SUBMIT_PASSED')
  const request = '40000000-0000-4000-8000-000000000001'
  const duplicatePayload = lastJson(sql(`${actor(manager)} SELECT public.test_payload('2027-03-01');`))
  const duplicates = await Promise.all([spawnSql(command(manager,'save_draft',duplicatePayload,quote(request))),spawnSql(command(manager,'save_draft',duplicatePayload,quote(request)))])
  assert.equal(duplicates.filter(x=>x.code===0).length,2)
  assert.deepEqual(lastJson(duplicates[0].output),lastJson(duplicates[1].output),'same request returns same receipt under race')
  assert.equal(sql(`SELECT count(*) FROM private.sales_target_requests WHERE request_id=${quote(request)}`).trim(),'1')
  console.log('RACE_REQUEST_REPLAY_PASSED')
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const barrier = async key => {
    const until = Date.now() + 5000
    while (Date.now() < until) {
      if (sql(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=${key} AND granted)`).trim()==='t') return
      await pause(20)
    }
    throw new Error('Synthetic race barrier not reached')
  }
  r = create('2027-04-01'); payload = {planId:r.plan.id,expectedVersion:r.plan.version}
  const deactivate = spawnSql(`BEGIN; UPDATE public.users SET is_active=false WHERE id='${head}'; SELECT pg_advisory_xact_lock(99001); SELECT pg_sleep(0.6); COMMIT;`)
  await barrier(99001)
  const inactiveApproval = await spawnSql(command(head,'approve_publish',payload))
  assert.equal((await deactivate).code,0)
  assert.notEqual(inactiveApproval.code,0,'actor deactivated while approval waits must be denied')
  assert.ok(inactiveApproval.error.includes('Active sales actor required'))
  sql(`UPDATE public.users SET is_active=true WHERE id='${head}'`)
  console.log('RACE_ROLE_REVOCATION_PASSED')
  const changeAssignment = spawnSql(`BEGIN; UPDATE public.customer_manager_assignments SET version=version+1 WHERE customer_id='20000000-0000-4000-8000-000000000001'; SELECT pg_advisory_xact_lock(99002); SELECT pg_sleep(0.6); COMMIT;`)
  await barrier(99002)
  const staleApproval = await spawnSql(command(executive,'approve_publish',payload))
  assert.equal((await changeAssignment).code,0)
  assert.notEqual(staleApproval.code,0,'assignment changed while approval waits must reject')
  assert.ok(staleApproval.error.includes('Roster or hierarchy changed'))
  const returned = lastJson(sql(command(head,'return',{...payload,reason:'Assignments changed; review current portfolio'})))
  assert.equal(returned.plan.state,'returned','stale submission can return for repair')
  sql("WITH saved AS (DELETE FROM public.customer_manager_assignments WHERE customer_id='20000000-0000-4000-8000-000000000001' RETURNING *) INSERT INTO public.customer_manager_assignments SELECT * FROM saved")
  console.log('RACE_ASSIGNMENT_DRIFT_AND_RETURN_PASSED')
  const p1=create('2027-05-01'),p2=create('2027-05-01')
  const overlapping=await Promise.all([spawnSql(command(head,'approve_publish',{planId:p1.plan.id,expectedVersion:1})),spawnSql(command(executive,'approve_publish',{planId:p2.plan.id,expectedVersion:1}))])
  assert.equal(overlapping.filter(x=>x.code===0).length,1,'two distinct proposals cannot create overlapping active targets')
  assert.equal(sql("SELECT count(*) FROM private.sales_target_active WHERE month='2027-05-01'").trim(),'9')
  console.log('RACE_OVERLAPPING_PLANS_PASSED')
  const recoveryRequest='40000000-0000-4000-8000-000000000002'
  const recoveryPayload=lastJson(sql(`${actor(manager)} SELECT public.test_payload('2027-06-01');`))
  const pending=spawnSql(`BEGIN; ${command(manager,'save_draft',recoveryPayload,quote(recoveryRequest))} SELECT pg_advisory_xact_lock(99003); SELECT pg_sleep(0.6); COMMIT;`)
  await barrier(99003)
  const reconciled=await spawnSql(`${actor(manager)} SELECT public.pilot_sales_target_reconcile_v1('${recoveryRequest}');`)
  assert.equal((await pending).code,0);assert.equal(reconciled.code,0)
  assert.equal(lastJson(reconciled.output).status,'committed','reconcile must wait for in-flight same request, not report not_found')
  console.log('RACE_RECONCILE_PENDING_COMMIT_PASSED')
  sql("UPDATE public.users SET manager_id='10000000-0000-4000-8000-000000000007' WHERE id='10000000-0000-4000-8000-000000000004'")
  const other='10000000-0000-4000-8000-000000000007'
  const otherBaseline=lastJson(sql(`${actor(other)} SELECT public.pilot_sales_target_baseline_v1('2027-01-01','${other}');`))
  const otherPayload={month:'2027-01-01',managerId:other,expectedVersion:null,rosterHash:otherBaseline.rosterHash,lines:otherBaseline.people.flatMap(p=>['po_order_value','po_delivery_value','co_sale_value'].map(metric=>({personId:p.personId,metric,amount:'120.00',applicability:'target',reason:'Synthetic transferred roster review'})))}
  const otherPlan=lastJson(sql(command(other,'submit',otherPayload)))
  const overlap=await spawnSql(command(executive,'approve_publish',{planId:otherPlan.plan.id,expectedVersion:1}))
  assert.notEqual(overlap.code,0);assert.ok(overlap.error.includes('sales_target_active_pkey'),'active uniqueness spans managers')
  sql("UPDATE public.users SET manager_id='10000000-0000-4000-8000-000000000003' WHERE id='10000000-0000-4000-8000-000000000004'")
  console.log('CROSS_MANAGER_ACTIVE_UNIQUENESS_PASSED')


}
