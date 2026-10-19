import assert from 'node:assert/strict'
export function registerCustomerTargetTests(test, createCustomerTargetSender) {
const actor = '11111111-1111-4111-8111-111111111111', customer = '22222222-2222-4222-8222-222222222222'
const target = '33333333-3333-4333-8333-333333333333', other = '44444444-4444-4444-8444-444444444444'
const input = { customerId: customer, yearMonth: '2026-10', targetValue: 12.34 }
function fixture() {
  const disk = new Map(), calls = [], raw = [], receipts = new Map()
  let mode = 'checked', current = true, lose = false, bad = null, storageFault = false, lockFault = false, missing = false
  const storage = { getItem: k => disk.get(k) ?? null, setItem: (k,v) => { if (storageFault) throw Error('quota'); disk.set(k,v) }, removeItem: k => disk.delete(k) }
  let tail = Promise.resolve()
  const transport = { backend: 'https://synthetic.invalid', withExclusiveLock: async (key, action) => {
    const next = tail.then(action); tail = next.catch(() => {}); const result = await next
    if (lockFault) throw Error('release failed'); return result
  }, rpc: async (name,args) => {
    calls.push({name,args})
    if (name === 'pilot_customer_target_write_access_v1') return { data: bad ?? {version:1,actor_id:actor,mode}, error:null }
    if (name === 'pilot_reconcile_customer_target_v1') return {data: receipts.has(args.p_request_id) ? {status:'committed',receipt:receipts.get(args.p_request_id)} : {status:'unknown'},error:null}
    assert.equal(disk.size,1)
    if (missing) return {data:null,error:{code:'PGRST202'}}
    const receipt = {version:1,request_id:args.p_request_id,actor_id:actor,operation:'upsert_target',customer_id:args.p_customer_id,year_month:args.p_year_month,target_id:target,target_value:args.p_target_value===null ? null : String(args.p_target_value),committed_at:'2026-10-16T00:00:00Z'}
    receipts.set(args.p_request_id,receipt)
    if (lose) throw Error('response lost')
    return {data:receipt,error:null}
  } }
  const create = () => createCustomerTargetSender({backend:transport.backend,actorId:actor,role:'sales_head',scope:'customer-target-pages',storage:()=>storage,isCurrent:()=>current},transport)
  return {disk,calls,raw,receipts,transport,create,sender:create(),legacy:async value=>{raw.push(value)},mode:v=>mode=v,current:v=>current=v,lose:()=>lose=true,bad:v=>bad=v,storageFault:()=>storageFault=true,lockFault:v=>lockFault=v,missing:()=>missing=true}
}
test('only exact server legacy capability permits the original raw callback', async () => {
  const r=fixture(); r.mode('legacy')
  assert.equal(await r.sender.save(input,r.legacy),'legacy'); assert.deepEqual(r.raw,[input]); assert.equal(r.disk.size,0)
  for(const access of [null,{version:1,actor_id:other,mode:'legacy'},{version:1,actor_id:actor,mode:'legacy',extra:true},{version:1,actor_id:actor,mode:'unknown'}]){
    const q=fixture(); q.bad(access ?? {}); await assert.rejects(q.sender.save(input,q.legacy)); assert.equal(q.raw.length,0)
  }
})
test('verified legacy in-flight save keeps admission but is not a durable checked recovery', async () => {
  const r = fixture(); r.mode('legacy')
  let start, finish
  const entered = new Promise(resolve => { start = resolve })
  const held = new Promise(resolve => { finish = resolve })
  const saving = r.sender.save(input, async value => { r.raw.push(value); start(); await held })
  await entered
  try {
    assert.equal(r.sender.hasUnresolved(), false)
    await assert.rejects(r.sender.save(input, r.legacy))
    assert.equal(r.raw.length, 1); assert.equal(r.disk.size, 0)
  } finally { finish(); await saving }
})
test('already dispatched legacy success can stale its original scope after owner retirement', async () => {
  const r = fixture(); r.mode('legacy')
  let start, finish
  const entered = new Promise(resolve => { start = resolve })
  const held = new Promise(resolve => { finish = resolve })
  const saving = r.sender.save(input, async value => { r.raw.push(value); start(); await held })
  await entered; r.current(false); finish()
  assert.equal(await saving, 'legacy')
  await assert.rejects(r.sender.save(input, r.legacy))
  assert.equal(r.raw.length, 1); assert.equal(r.disk.size, 0)
})
test('retirement while capability is pending still refuses legacy dispatch', async () => {
  const r = fixture(); r.mode('legacy')
  let start, finish
  const entered = new Promise(resolve => { start = resolve })
  const held = new Promise(resolve => { finish = resolve }), rpc = r.transport.rpc
  r.transport.rpc = async (...args) => { start(); await held; return rpc(...args) }
  const saving = r.sender.save(input, r.legacy)
  await entered; assert.equal(r.sender.hasUnresolved(), true); r.current(false); finish()
  await assert.rejects(saving); assert.equal(r.raw.length, 0); assert.equal(r.disk.size, 0)
})
test('retirement after checked dispatch still rejects settlement and retains durable recovery', async () => {
  const r = fixture()
  let start, finish
  const entered = new Promise(resolve => { start = resolve })
  const held = new Promise(resolve => { finish = resolve }), rpc = r.transport.rpc
  r.transport.rpc = async (name, args) => {
    const result = await rpc(name, args)
    if (name === 'pilot_customer_target_upsert_v1') { start(); await held }
    return result
  }
  const saving = r.sender.save(input, r.legacy)
  await entered; assert.equal(r.sender.hasUnresolved(), true); r.current(false); finish()
  await assert.rejects(saving); assert.equal(r.raw.length, 0); assert.equal(r.disk.size, 1)
  r.current(true); await r.create().recover(async () => true); assert.equal(r.disk.size, 0)
})
test('checked save persists before dispatch, verifies exact receipt and requires canonical recovery', async () => {
  const r=fixture(), result=await r.sender.save(input,r.legacy)
  assert.equal(result.target_value,'12.34'); assert.equal(r.raw.length,0); assert.equal(r.sender.hasUnresolved(),true)
  const pending=JSON.parse([...r.disk.values()][0]); assert.match(pending.fingerprint,/^[a-f0-9]{64}$/)
  assert.equal(pending.targetValue,undefined)
  await assert.rejects(r.sender.save(input,r.legacy))
  let refreshed=0; assert.equal((await r.sender.recover(async receipt=>{refreshed++;assert.deepEqual(receipt,result);return true})).status,'committed')
  assert.equal(refreshed,1);assert.equal(r.sender.hasUnresolved(),false);assert.equal(r.disk.size,0)
})
test('lost checked response reload recovers once without resending or falling back to raw', async () => {
  const r=fixture(); r.lose(); await assert.rejects(r.sender.save(input,r.legacy))
  const reload=r.create(); r.mode('legacy')
  await assert.rejects(reload.save(input,r.legacy)); assert.equal(r.raw.length,0)
  await reload.recover(async()=>true)
  assert.equal(r.calls.filter(x=>x.name==='pilot_customer_target_upsert_v1').length,1); assert.equal(r.disk.size,0)
})
test('unknown remains durable and never runs canonical acceptance or authorizes resending', async () => {
  const r=fixture(); r.lose(); await assert.rejects(r.sender.save(input,r.legacy)); r.receipts.clear()
  assert.deepEqual(await r.sender.recover(async()=>{throw Error('must not run')}),{status:'unknown'})
  await assert.rejects(r.sender.save(input,r.legacy));assert.equal(r.disk.size,1)
})
test('canonical failure, changed receipt, owner change and storage failure fail closed', async () => {
  const r=fixture(); await r.sender.save(input,r.legacy)
  await assert.rejects(r.sender.recover(async()=>false));assert.equal(r.disk.size,1)
  const key=[...r.receipts.keys()][0], old=r.receipts.get(key); r.receipts.set(key,{...old,target_value:'999'})
  await assert.rejects(r.sender.recover(async()=>true));assert.equal(r.disk.size,1)
  r.receipts.set(key,old);r.current(false);await assert.rejects(r.sender.recover(async()=>true))
  const q=fixture();q.storageFault();await assert.rejects(q.sender.save(input,q.legacy));assert.equal(q.calls.filter(x=>x.name==='pilot_customer_target_upsert_v1').length,0)
})
test('cross-context admission prevents two senders dispatching the same durable scope', async () => {
  const r=fixture(), otherSender=r.create()
  const results=await Promise.allSettled([r.sender.save(input,r.legacy),otherSender.save(input,r.legacy)])
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
  assert.equal(r.calls.filter(x=>x.name==='pilot_customer_target_upsert_v1').length,1)
})
test('native-lock release failure after canonical removal retains in-memory terminal recovery', async () => {
  const r=fixture();await r.sender.save(input,r.legacy);r.lockFault(true)
  await assert.rejects(r.sender.recover(async()=>true));assert.equal(r.sender.hasUnresolved(),true)
  r.lockFault(false); await r.sender.recover(async()=>true);assert.equal(r.sender.hasUnresolved(),false)
})
test('checked input retains zero and null while rejecting excess precision, negative and nonfinite values', async () => {
  for(const targetValue of [0,null,999999999999.99]) {const r=fixture();assert.equal((await r.sender.save({...input,targetValue},r.legacy)).target_value,targetValue===null?null:String(targetValue))}
  for(const targetValue of [-1,Infinity,NaN,0.001,1000000000000]) {const r=fixture();await assert.rejects(r.sender.save({...input,targetValue},r.legacy));assert.equal(r.calls.filter(x=>x.name==='pilot_customer_target_upsert_v1').length,0)}
})
test('malformed, mismatched and changing receipts cannot settle a durable checked request', async () => {
  for(const patch of [{actor_id:other},{customer_id:other},{year_month:'2026-11'},{request_id:other},{target_value:'12.345'},{target_value:12.34},{target_value:'99'},{operation:'other'},{extra:true},{committed_at:'2026-02-30T00:00:00Z'}]){
    const r=fixture();r.lose();await assert.rejects(r.sender.save(input,r.legacy)); const key=[...r.receipts.keys()][0]
    r.receipts.set(key,{...r.receipts.get(key),...patch})
    await assert.rejects(r.sender.recover(async()=>true));assert.equal(r.disk.size,1);assert.equal(r.raw.length,0)
  }
})
test('receipt JSON key ordering and numeric scale are not semantic mismatches', async () => {
  const r=fixture();r.lose();await assert.rejects(r.sender.save({...input,targetValue:12.3},r.legacy))
  const key=[...r.receipts.keys()][0], receipt=r.receipts.get(key)
  r.receipts.set(key,Object.fromEntries(Object.entries({...receipt,target_value:'12.30'}).reverse()))
  await r.sender.recover(async()=>true);assert.equal(r.disk.size,0)
})
test('invalid capability and malformed durable storage never select raw fallback', async () => {
  const r=fixture();r.disk.set('irrelevant','x');r.bad({version:1,actor_id:actor,mode:'unsupported'})
  await assert.rejects(r.sender.save(input,r.legacy));assert.equal(r.raw.length,0)
  const q=fixture();q.lose();await assert.rejects(q.sender.save(input,q.legacy))
  const key=[...q.disk.keys()][0];q.disk.set(key,'{}');q.mode('legacy')
  await assert.rejects(q.create().save(input,q.legacy));assert.equal(q.raw.length,0)
})

test('missing checked endpoint retains its request and never retries the raw interface', async () => {
  const r=fixture();r.missing();await assert.rejects(r.sender.save(input,r.legacy))
  r.mode('legacy');await assert.rejects(r.create().save(input,r.legacy))
  assert.equal(r.disk.size,1);assert.equal(r.raw.length,0)
  assert.equal(r.calls.filter(x=>x.name==='pilot_customer_target_upsert_v1').length,1)
})

}
