// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { runDisposableSql } from '../../scripts/run-disposable-psql.mjs'
const env={PATH:'/usr/bin:/bin',PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres',PGPASSWORD:'synthetic-only',SCALE_ROWS:'6000',SCALE_PERMIT:'disposable-pilot-ci',PGHOSTADDR:'production.invalid',PGSERVICE:'production',PGOPTIONS:'-c role=service_role'}
test('every SQL file uses the same guarded allowlisted connection and no target override arguments',()=>{
 const execute=vi.fn();runDisposableSql('tests/database/fixture.sql',{env,execute})
 expect(execute).toHaveBeenCalledTimes(1)
 const [binary,args,options]=execute.mock.calls[0];expect(binary).toBe('psql');expect(args).toContain('--file=tests/database/fixture.sql');expect(args).toContain('-X');expect(options.env.PGHOST).toBe('127.0.0.1');expect(options.env.PGHOSTADDR).toBeUndefined();expect(options.env.PGSERVICE).toBeUndefined();expect(options.env.PGOPTIONS).toBeUndefined()
})
for(const patch of [{PGHOST:'production.invalid'},{PGDATABASE:'postgres'},{SCALE_PERMIT:''},{SCALE_ROWS:'30001'}])test(`refuses connection before executing ${JSON.stringify(patch)}`,()=>{const execute=vi.fn();expect(()=>runDisposableSql('fixture.sql',{env:{...env,...patch},execute})).toThrow();expect(execute).not.toHaveBeenCalled()})
