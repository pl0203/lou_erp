// @vitest-environment node
import { expect, test } from 'vitest'
import { assertWorkspaceInstallFailure } from '../../scripts/test-co-workspace-db.mjs'

test('requires the expected deliberately late SQLSTATE and message together', () => {
 expect(() => assertWorkspaceInstallFailure({stderr:'ERROR: PZ603: Synthetic late import installation failure\n'})).not.toThrow()
 for (const stderr of ['', 'ERROR: 42883: function missing', 'ERROR: PZ603: Other failure', 'ERROR: P0001: Synthetic late import installation failure']) {
  expect(() => assertWorkspaceInstallFailure({stderr})).toThrow(/Must reach the deliberately late installation failure/)
 }
})
test('unexpected installation failure retains bounded PostgreSQL diagnostics, not command arguments or stdout', () => {
 let thrown: any
 try { assertWorkspaceInstallFailure({stderr:'NOTICE: before\nERROR: 42883: function missing\nCONTEXT: SQL function example\n',message:'PRIVATE command arguments',stdout:'PRIVATE output'}) } catch(error) { thrown=error }
 expect(thrown.message).toContain('ERROR: 42883: function missing')
 expect(thrown.message).toContain('CONTEXT: SQL function example')
 expect(thrown.message).not.toContain('PRIVATE')
})
test('large or terminal-control stderr is bounded and cannot inject control sequences', () => {
 let thrown: any
 try { assertWorkspaceInstallFailure({stderr:'x'.repeat(20000)+'\u001b[31mERROR: 42601: syntax failure\u0000\n'}) } catch(error) { thrown=error }
 expect(thrown.message.length).toBeLessThan(8500)
 expect(thrown.message).toContain('ERROR: 42601: syntax failure')
 expect(thrown.message).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/)
})
test('missing stderr never falls back to a child command containing SQL or credentials', () => {
 expect(() => assertWorkspaceInstallFailure({message:'PRIVATE command'})).toThrow(/No PostgreSQL stderr available/)
 try { assertWorkspaceInstallFailure({message:'PRIVATE command'}) } catch(error:any) { expect(error.message).not.toContain('PRIVATE') }
})
