// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const sql=readFileSync('tests/database/co/import-posting.sql','utf8')
const setup=sql.split('CREATE FUNCTION co_test.import_setup(')[1].split('END $$;')[0]
test('import setup seeds both synthetic Auth identities before their FK-bound public users',()=>{
 const auth="INSERT INTO auth.users(id) VALUES(md5(label||'-pic-a')::uuid),(md5(label||'-pic-b')::uuid);"
 expect(setup.includes(auth)).toBe(true)
 expect(setup.indexOf(auth)).toBeLessThan(setup.indexOf('INSERT INTO public.users'))
 expect(setup).toContain("VALUES(md5(label||'-pic-a')::uuid,'Import A'")
 expect(setup).toContain("(md5(label||'-pic-b')::uuid,'Import B'")
 expect(setup).not.toMatch(/DISABLE|session_replication_role|DROP|ON CONFLICT/)
 expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1)
 expect(sql).toMatch(/ROLLBACK;\s*SELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\s*$/)
})
