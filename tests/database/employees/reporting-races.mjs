// Fixed synthetic scenarios, called only by the owned command/reporting lifecycle.
// No installation, cleanup, process routing or caller-supplied SQL/path surface here.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const literal = value => `'${String(value).replaceAll("'","''")}'`
const edge = (manager,from='9998-01-01',until=null)=>({managerEmployeeId:manager,from,until})
const proposal = (...intervals)=>({mode:'schedule',intervals})

export async function runReportingScenarios({admin,pool,actors,create,preview,command,open,waiting,rejected,auth}) {
  await admin.query("UPDATE private.employee_settings SET timezone='Asia/Jakarta',version=version+1;")
  const graph=async()=>Number(await admin.query('SELECT revision FROM private.employee_reporting_guard;'))
  const save=async(actor,id,version,payload)=>{
    const fp=await preview(actor,id,version,'save_reporting',payload)
    await admin.query(auth(actor));const result=JSON.parse(await admin.query(command(randomUUID(),id,version,'save_reporting',payload,fp)))
    await admin.query("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);")
    return result
  }
  const noResidue=async(id,op,actor)=>assert.equal(await admin.query(`SELECT e.version=1 AND e.reporting_revision=0
    AND NOT EXISTS(SELECT 1 FROM private.employee_reporting_revisions r WHERE r.employee_id=e.id)
    AND NOT EXISTS(SELECT 1 FROM private.employee_audit_events a WHERE a.employee_id=e.id AND a.action='save_reporting')
    AND NOT EXISTS(SELECT 1 FROM private.employee_operations o WHERE o.actor_id=${literal(actor)} AND o.operation_id=${literal(op)})
    FROM private.employee_records e WHERE e.id=${literal(id)};`),'t','losing graph command must leave no partial writes')
  // Different actors and employee locks must still serialize on the global graph.
  {
    const e1=await create('Reciprocal A'),e2=await create('Reciprocal B'),p1=proposal(edge(e2)),p2=proposal(edge(e1)),before=await graph()
    const fp1=await preview(actors[0],e1,1,'save_reporting',p1),fp2=await preview(actors[1],e2,1,'save_reporting',p2)
    const a=await open(actors[0],'graph-a'),b=await open(actors[1],'graph-b'),op2=randomUUID()
    await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),e1,1,'save_reporting',p1,fp1))
    const loser=rejected(b.session.query(command(op2,e2,1,'save_reporting',p2,fp2)),'22023','REPORTING_CYCLE')
    await waiting(b.pid);await a.session.query('COMMIT;');await loser;await a.session.stop()
    assert.equal(await graph(),before+1);await noResidue(e2,op2,actors[1])
    assert.equal(await admin.query(`SELECT count(*)=1 FROM private.employee_reporting_intervals WHERE employee_id IN(${literal(e1)},${literal(e2)});`),'t')
  }
  // Four nodes avoid incidental FK/employee-row contention: neither writer's
  // manager is the other writer's target. Only graph serialization prevents this
  // write-skew cycle (A->B, B->C, C->D, D->A).
  {
    const aId=await create('Write skew A'),bId=await create('Write skew B'),cId=await create('Write skew C'),dId=await create('Write skew D')
    await save(actors[0],bId,1,proposal(edge(cId)))
    await save(actors[1],dId,1,proposal(edge(aId)))
    const pA=proposal(edge(bId)),pC=proposal(edge(dId)),before=await graph()
    const fpA=await preview(actors[0],aId,1,'save_reporting',pA),fpC=await preview(actors[1],cId,1,'save_reporting',pC)
    const a=await open(actors[0],'write-skew-a'),c=await open(actors[1],'write-skew-c'),opC=randomUUID()
    await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),aId,1,'save_reporting',pA,fpA))
    const loser=rejected(c.session.query(command(opC,cId,1,'save_reporting',pC,fpC)),'22023','REPORTING_CYCLE')
    await waiting(c.pid);await a.session.query('COMMIT;');await loser;await a.session.stop()
    assert.equal(await graph(),before+1);await noResidue(cId,opC,actors[1])
  }
  // Two independent edits cannot commit from the same stale graph preview.
  // The second is safe after an explicit fresh preview, without losing either edit.
  {
    const e1=await create('Independent A'),e2=await create('Independent B'),p=proposal(edge(null)),before=await graph()
    const fp1=await preview(actors[0],e1,1,'save_reporting',p),fp2=await preview(actors[1],e2,1,'save_reporting',p)
    const a=await open(actors[0],'independent-a'),b=await open(actors[1],'independent-b'),op2=randomUUID()
    await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),e1,1,'save_reporting',p,fp1))
    const loser=rejected(b.session.query(command(op2,e2,1,'save_reporting',p,fp2)),'40001','PREVIEW_CHANGED')
    await waiting(b.pid);await a.session.query('COMMIT;');await loser;await a.session.stop();await noResidue(e2,op2,actors[1])
    await save(actors[1],e2,1,p);assert.equal(await graph(),before+2)
  }
  // Adjacent reciprocal timelines are not cycles: stale-preview rejection only,
  // then a fresh preview accepts the union-graph cycle with no common instant.
  {
    const e1=await create('Adjacent A'),e2=await create('Adjacent B'),p1=proposal(edge(e2,'9998-01-01','9998-02-01')),p2=proposal(edge(e1,'9998-02-01'))
    const fp1=await preview(actors[0],e1,1,'save_reporting',p1),fp2=await preview(actors[1],e2,1,'save_reporting',p2)
    const a=await open(actors[0],'adjacent-a'),b=await open(actors[1],'adjacent-b')
    await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),e1,1,'save_reporting',p1,fp1))
    const stale=rejected(b.session.query(command(randomUUID(),e2,1,'save_reporting',p2,fp2)),'40001','PREVIEW_CHANGED')
    await waiting(b.pid);await a.session.query('COMMIT;');await stale;await a.session.stop()
    await save(actors[1],e2,1,p2)
    assert.equal(await admin.query(`SELECT count(*)=2 FROM private.employee_reporting_revisions WHERE employee_id IN(${literal(e1)},${literal(e2)});`),'t')
  }
  // Future three-employee cycle is discovered after waiting for another edge.
  {
    const e1=await create('Three A'),e2=await create('Three B'),e3=await create('Three C')
    await save(actors[0],e1,1,proposal(edge(e2,'9998-03-01','9998-06-01')))
    const p2=proposal(edge(e3,'9998-04-01')),p3=proposal(edge(e1,'9998-05-01'))
    const fp2=await preview(actors[0],e2,1,'save_reporting',p2),fp3=await preview(actors[1],e3,1,'save_reporting',p3)
    const a=await open(actors[0],'three-b'),b=await open(actors[1],'three-c'),op3=randomUUID()
    await a.session.query('BEGIN;');await a.session.query(command(randomUUID(),e2,1,'save_reporting',p2,fp2))
    const loser=rejected(b.session.query(command(op3,e3,1,'save_reporting',p3,fp3)),'22023','REPORTING_CYCLE')
    await waiting(b.pid);await a.session.query('COMMIT;');await loser;await a.session.stop();await noResidue(e3,op3,actors[1])
  }
  // Reporting must not broaden invalidation to unrelated ordinary employee edits.
  {
    const e1=await create('Basic preview'),e2=await create('Graph change')
    const fields={name:'Basic preview edited',employeeNumber:null,jobTitle:null,team:null,recordedStatus:'draft'}
    const fp=await preview(actors[0],e1,1,'edit_employee',fields)
    await save(actors[1],e2,1,proposal())
    const session=await open(actors[0],'basic-after-graph')
    const result=JSON.parse(await session.session.query(command(randomUUID(),e1,1,'edit_employee',fields,fp)))
    assert.equal(result.version,2);await session.session.stop()
  }
  // Workplace configuration lock waits must revalidate the preview after the wait.
  {
    const e=await create('Settings wait'),p=proposal(edge(null)),fp=await preview(actors[0],e,1,'save_reporting',p),op=randomUUID()
    const settings=pool.open('reporting-settings'),writer=await open(actors[0],'settings-writer')
    await settings.query("BEGIN;UPDATE private.employee_settings SET timezone='Pacific/Kiritimati',version=version+1;")
    const stale=rejected(writer.session.query(command(op,e,1,'save_reporting',p,fp)),'40001','PREVIEW_CHANGED')
    await waiting(writer.pid);await settings.query('COMMIT;');await stale;await settings.stop();await noResidue(e,op,actors[0])
  }
  // A committed-looking result in an aborted outer transaction leaves no history.
  {
    const e=await create('Rolled back reporting'),p=proposal(edge(null)),fp=await preview(actors[0],e,1,'save_reporting',p),op=randomUUID(),before=await graph()
    const writer=await open(actors[0],'reporting-rollback')
    await writer.session.query('BEGIN;');await writer.session.query(command(op,e,1,'save_reporting',p,fp));await writer.session.query('ROLLBACK;');await writer.session.stop()
    assert.equal(await graph(),before);await noResidue(e,op,actors[0])
  }
}
