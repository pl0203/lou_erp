// @vitest-environment node
import { expect,test } from 'vitest'
import { demoFixtureConnection,bindDemoCiServer } from '../../scripts/demo-rollout-fixture-target.mjs'
import { buildDemoPreflight } from '../../scripts/build-demo-rollout.mjs'
const ci={PATH:'/usr/bin',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'demo_rollout_test',PGUSER:'postgres',PGPASSWORD:'synthetic-ci-only',DEMO_ROLLOUT_PERMIT:'disposable-demo-rollout-ci',GITHUB_ACTIONS:'true',CI:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'synthetic-safety',GITHUB_RUN_ID:'12345',GITHUB_SHA:'a'.repeat(40),DEMO_ROLLOUT_SOURCE_SHA:'a'.repeat(40)}
const observed={database:'pilot_test',operator:'postgres',marker:true,server_address:'172.18.0.2',server_port:5432,server_major:17}
test('binds the existing repository Docker service via verified fixture identity and exact synthetic password',()=>{
 const connection=demoFixtureConnection(ci,'a'.repeat(40))
 expect(connection.env).toMatchObject({PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'demo_rollout_test',PGUSER:'postgres',PGPASSWORD:'synthetic-ci-only',PGPASSFILE:'/dev/null',PGSSLMODE:'disable'})
 expect(()=>buildDemoPreflight({target:connection.target})).toThrow(/identity|bound/i)
 const target=bindDemoCiServer(connection.target,observed)
 const sql=buildDemoPreflight({target})
 expect(sql).toContain("inet_server_addr()<>'172.18.0.2'::inet")
 expect(sql).toContain('inet_server_port()<>5432')
 expect(sql).toContain("run_id='12345'")
 expect(sql).toContain("source_sha='"+'a'.repeat(40)+"'")
})
test('denies arbitrary targets, credentials, bypass settings and wrong repository CI context',()=>{
 for(const override of [{PGHOST:'db.example.com'},{PGHOST:'localhost'},{PGDATABASE:'postgres'},{PGUSER:'other'},{PGPORT:'65443'},{PGPASSWORD:'private-password'},{PGPASSWORD:''},{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_JOB:'other'},{GITHUB_WORKFLOW:'other'},{GITHUB_RUN_ID:''},{GITHUB_SHA:'not-a-sha'},{PGSERVICE:'service'},{PGHOSTADDR:'203.0.113.1'},{PGOPTIONS:'-c role=other'},{PGPASSFILE:'/tmp/credentials'},{DATABASE_URL:'postgres://remote'}]) expect(()=>demoFixtureConnection({...ci,...override},'a'.repeat(40))).toThrow()
 const connection=demoFixtureConnection(ci,'a'.repeat(40))
 for(const override of [{database:'postgres'},{marker:false},{operator:'other'},{server_port:65443},{server_major:16},{server_address:'203.0.113.9'},{server_address:'db.example.com'}]) expect(()=>bindDemoCiServer(connection.target,{...observed,...override})).toThrow()
})
test('keeps the local route password-free and non-default-port with no inherited connection settings',()=>{
 const local={PATH:'/usr/bin',PGHOST:'127.0.0.1',PGPORT:'65443',PGDATABASE:'demo_rollout_test',PGUSER:'postgres',DEMO_ROLLOUT_PERMIT:'disposable-demo-rollout'}
 const connection=demoFixtureConnection(local)
 expect(connection.target).toMatchObject({kind:'fixture',port:65443})
 expect(connection.env.PGPASSWORD).toBeUndefined()
 expect(connection.env.PGPASSFILE).toBe('/dev/null')
 for(const override of [{PGPORT:'5432'},{PGPASSWORD:'synthetic-ci-only'},{PGPASSWORD:'private-password'},{PGSERVICE:'anything'},{PGHOST:'192.168.1.1'}]) expect(()=>demoFixtureConnection({...local,...override})).toThrow()
})
test('binds source identity to the verified checkout head instead of the pull-request merge SHA',()=>{
 const input={...ci,DEMO_ROLLOUT_SOURCE_SHA:'b'.repeat(40),GITHUB_SHA:'c'.repeat(40)}
 const connection=demoFixtureConnection(input,'b'.repeat(40))
 expect(connection.target.ci.sourceSha).toBe('b'.repeat(40))
 expect(()=>demoFixtureConnection(input,'d'.repeat(40))).toThrow(/checkout|source/i)
 expect(()=>demoFixtureConnection(input)).toThrow(/checkout|source/i)
 expect(()=>demoFixtureConnection({...input,DEMO_ROLLOUT_SOURCE_SHA:''},'b'.repeat(40))).toThrow(/checkout|source/i)
})
