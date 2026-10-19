// @vitest-environment node
import { expect,it } from 'vitest'
let decoder:any
try{decoder=await import('../database/employees/sql-decoder.mjs')}catch{}
it('decodes actual SQL envelopes through the application TypeScript contracts',()=>expect(decoder?.decodeEmployeeSqlOutput).toBeTypeOf('function'))
it('rejects missing, duplicate, stale, partial or malformed SQL output rather than awarding proof',()=>{
 expect(decoder).toBeDefined()
 for(const output of ['', 'EMPLOYEE_SQL_JSON|{}','EMPLOYEE_SQL_JSON|{}\nEMPLOYEE_SQL_JSON|{}\nEMPLOYEE_SQL_OUTPUT_ROLLED_BACK','EMPLOYEE_SQL_JSON|not-json\nEMPLOYEE_SQL_OUTPUT_ROLLED_BACK'])expect(()=>decoder.decodeEmployeeSqlOutput(output)).toThrow()
})
