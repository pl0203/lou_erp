// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
let assembler:any
try { assembler=await import('../../scripts/assemble-employee-sql.mjs') } catch {}
it('assembles only fixed atomic activation and data-preserving disable artifacts',()=>{
 expect(assembler,'Fixed employee assembly is implemented').toBeDefined()
 const result=assembler.assembleEmployeeSql()
 expect(Object.keys(result).sort()).toEqual(['activation','disable','reenable'])
 for(const body of Object.values(result) as string[]) {expect(body.match(/^BEGIN;$/gm)).toHaveLength(1);expect(body.match(/^COMMIT;$/gm)).toHaveLength(1);expect(body).toContain('employee_assert_known');expect(body).toContain('pg_advisory_xact_lock')}
 expect(result.activation).toContain('EMPLOYEE_INSTALL_REQUIRES_ABSENT_TOPOLOGY')
 for(const action of ['disable','reenable'])expect(result[action]).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|INSERT|UPDATE)\s+(?:TABLE|FROM|INTO|private\.)/i)
 expect(result.disable).not.toContain('ALL FUNCTIONS IN SCHEMA')
 expect(result.disable).not.toMatch(/REVOKE.*ON SCHEMA/i)
 expect(result.disable).toContain('private.employee_command_impl_v1(uuid,uuid,bigint,text,jsonb,text,date,text,text)')
})
it('refuses caller-selected paths or SQL bodies before assembly',()=>{expect(assembler).toBeDefined();for(const value of [{path:'x'},{sql:'x'},{root:'x'},['x']])expect(()=>assembler.assembleEmployeeSql(value)).toThrow()})
it('checked-in bundles exactly match fixed source assembly',()=>{expect(assembler).toBeDefined();for(const [name,body] of Object.entries(assembler.assembleEmployeeSql()))expect(readFileSync(`sql/employee-foundation-${name}.sql`,'utf8')).toBe(body)})
it('synthetic failure/ownership proofs share every activation byte before its final commit',()=>{
 expect(assembler?.assembleEmployeeProofSql).toBeTypeOf('function')
 const {activation}=assembler.assembleEmployeeSql(),proofs=assembler.assembleEmployeeProofSql()
 const prefix=activation.slice(0,-'COMMIT;\n'.length)
 expect(proofs.abort).toBe(prefix+"DO $$ BEGIN RAISE EXCEPTION 'EMPLOYEE_FIXED_PRECOMMIT_FAILURE'; END $$;\nCOMMIT;\n")
 expect(proofs.install).toBe(prefix+'\\ir install-owner.sql\nCOMMIT;\n')
})

it('all generated entrypoints invoke the exact shared owner-role predicate',()=>{
 const shared=readFileSync('sql/employee-foundation/owner-roles.sql','utf8')
 for(const body of Object.values(assembler.assembleEmployeeSql()) as string[]){expect(body.split(shared)).toHaveLength(2);expect(body).toContain('AND pg_temp.employee_unsafe_app_owner(oid)')}
 expect(readFileSync('tests/database/employees/owner-role-proof.sql','utf8')).toContain('\\ir ../../../sql/employee-foundation/owner-roles.sql')
})

it('every known-topology gate also checks the exact shared effective privileges',()=>{
 const shared=readFileSync('sql/employee-foundation/effective-access.sql','utf8')
 for(const body of Object.values(assembler.assembleEmployeeSql()) as string[]){expect(body.split(shared)).toHaveLength(2);expect(body).toContain('PERFORM pg_temp.employee_assert_effective(CASE WHEN observed=')}
 expect(readFileSync('tests/database/employees/effective-role-proof.sql','utf8')).toContain('\\ir ../../../sql/employee-foundation/effective-access.sql')
})

it('binds SET closure, PUBLIC separation and function narrowing to the production preflight',()=>{
 const shared=readFileSync('sql/employee-foundation/effective-access.sql','utf8')
 expect(shared).toContain("pg_has_role(app_role,oid,'SET')")
 expect(shared).toContain("IF app_role='public' THEN RETURN ARRAY['public']::name[]; END IF;")
 expect(shared).toContain('unnest(pg_temp.employee_effective_roles(app_role))')
 expect(shared).toContain('FOREACH effective_role IN ARRAY pg_temp.employee_effective_roles(r) LOOP')
 expect(shared).toContain('pg_temp.employee_function_access_safe(r,effective_role,mode,false,')
 expect(shared).toContain('pg_temp.employee_function_access_safe(r,effective_role,mode,true,')
 const proof=readFileSync('tests/database/employees/set-role-proof.sql','utf8')
 expect(proof).toContain('\\ir ../../../sql/employee-foundation/effective-access.sql')
 expect(proof).toContain("pg_temp.employee_unsafe_table_access('employee_hr_set_only_probe_20261019')")
 expect(proof).toContain('pg_temp.employee_function_access_safe')
})
