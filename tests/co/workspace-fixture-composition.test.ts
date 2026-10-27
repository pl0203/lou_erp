// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
import {composeWorkspaceReadFixture} from '../../scripts/test-co-workspace-db.mjs'
const suffix="\nROLLBACK;\nSELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\nSELECT 'CO_WORKSPACE_READS_PASSED';\n"
test('composed read fixture preserves PostgreSQL dollar quotes and every replacement metacharacter literally',()=>{
 const prefix='BEGIN;\nSELECT 1;\n'
 const posting=prefix+"ROLLBACK;\nSELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\n"
 const reads="CREATE FUNCTION example() RETURNS text LANGUAGE sql AS $$ SELECT '$& $` $1'::text; $$;\n-- $' must not interpolate the suffix"
 expect(composeWorkspaceReadFixture(posting,reads)).toBe(prefix+reads+suffix)
})
test('actual read fixture is inserted byte-for-byte ahead of the sole terminal rollback',()=>{
 const posting=readFileSync('tests/database/co/import-posting.sql','utf8')
 const reads=readFileSync('tests/database/co/workspace-reads.sql','utf8')
 const result=composeWorkspaceReadFixture(posting,reads)
 const prefix=posting.slice(0,posting.lastIndexOf('ROLLBACK;'))
 expect(result===prefix+reads+suffix).toBe(true)
 expect(result).toContain('RETURNS uuid LANGUAGE plpgsql AS $$')
 expect(result.match(/^ROLLBACK;$/gm)).toHaveLength(1)
})
