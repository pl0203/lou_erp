// @vitest-environment node
import {expect,test,vi} from 'vitest'
import {rolloutCiConnection,runReadRolloutCi} from '../../scripts/test-read-rollout-ci.mjs'
const env={PATH:'/usr/bin:/bin',PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres',PGPASSWORD:'synthetic-only',SCALE_PERMIT:'disposable-pilot-ci',SCALE_ROWS:'6000',GITHUB_ACTIONS:'true',CI:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_RUN_ID:'123',PGHOSTADDR:'wrong.invalid',PGSERVICE:'wrong',PGOPTIONS:'-c role=service_role'}
test('companion database test retains guarded service connection and strips overrides',()=>{
 const connection=rolloutCiConnection(env)
 expect(connection.PGHOST).toBe('127.0.0.1');expect(connection.PGDATABASE).toBe('pilot_test')
 expect(connection.PGHOSTADDR).toBeUndefined();expect(connection.PGSERVICE).toBeUndefined();expect(connection.PGOPTIONS).toBeUndefined()
})
for(const patch of [{PGHOST:'hosted.invalid'},{PGDATABASE:'postgres'},{SCALE_PERMIT:''},{GITHUB_ACTIONS:'false'},{CI:'false'},{GITHUB_REPOSITORY:'someone/else'},{GITHUB_RUN_ID:''}])test(`refuses unsafe companion setup before executing ${JSON.stringify(patch)}`,async()=>{
 const execute=vi.fn();await expect(runReadRolloutCi({env:{...env,...patch},execute})).rejects.toThrow();expect(execute).not.toHaveBeenCalled()
})
