import { describe, expect, it } from 'vitest'
import { parseDateOnly, parseEmployeeContext, parseEmployeeDetail, parseEmployeePage, parseEmployeeAudit, parseEmployeePreview, parseOperationResult, normalizeEmployeeProposal, parseEmployeeAccountCandidates } from '../../src/lib/employees/contracts'
import { actorId, employeeId, fields, context, detail, preview, proposal, receipt } from './fixtures'

describe('strict employee contracts', () => {
 it('validates Gregorian civil dates including early years without timezone conversion', () => {
  for (const value of ['0001-01-01','0099-12-31','2000-02-29','9999-12-31']) expect(parseDateOnly(value)).toBe(value)
  for (const value of ['0000-01-01','1900-02-29','2026-02-30','2026-1-01','infinity','2026-01-01T00:00:00Z']) expect(()=>parseDateOnly(value)).toThrow()
 })
 it('rejects unknown keys and wrong versions at every nested boundary', () => {
  expect(parseEmployeeDetail(detail)).toEqual(detail)
  expect(parseEmployeeContext(context)).toEqual(context)
  expect(parseEmployeeDetail({...detail,warnings:['REPORTING_COMPARISON_UNAVAILABLE']})).toMatchObject({warnings:['REPORTING_COMPARISON_UNAVAILABLE']})
  for (const bad of [{...detail,version:-1},{...detail,version:2**53},{...detail,secret:'private'},{...detail,fields:{...fields,leaveReason:'private'}},{...detail,episode:{startDate:'2026-02-30',endDate:null,sourceReference:null}}]) expect(()=>parseEmployeeDetail(bad)).toThrow()
  expect(()=>parseEmployeeContext({...context,canMaintainBasic:'yes'})).toThrow()
  expect(()=>parseEmployeeContext({...context,timezone:null,today:'2026-01-01'})).toThrow()
 })
 it('normalizes Unicode whitespace with code-point bounds, preserving internal spaces', () => {
  expect(normalizeEmployeeProposal({...proposal,payload:{...fields,name:'\uFEFF'+ '🙂'.repeat(160)+'\u00A0',team:' \t ',employeeNumber:' Ab  C '},reason:'  because  yes '}).payload).toEqual({...fields,name:'🙂'.repeat(160),team:null,employeeNumber:'Ab  C'})
  expect(()=>normalizeEmployeeProposal({...proposal,payload:{...fields,name:'🙂'.repeat(161)}})).toThrow()
  expect(()=>normalizeEmployeeProposal({...proposal,payload:{...fields,team:'x'.repeat(121)}})).toThrow()
  expect(()=>normalizeEmployeeProposal({...proposal,reason:' '})).toThrow()
  expect(()=>normalizeEmployeeProposal({...proposal,payload:{...fields,password:'secret'}})).toThrow()
  expect(normalizeEmployeeProposal({...proposal,payload:{...fields,recordedStatus:'active'}}).payload.recordedStatus).toBe('active')
 })
 it('decodes flattened pages and only bounded consistent pagination', () => {
  const page={rows:[{id:employeeId,version:1,...fields}],total:1,page:1,pageSize:25}
  expect(parseEmployeePage(page)).toEqual(page)
  expect(()=>parseEmployeePage({...page,rows:[detail]})).toThrow()
  expect(()=>parseEmployeePage({...page,pageSize:101})).toThrow()
  expect(()=>parseEmployeePage({...page,total:0})).toThrow()
  expect(()=>parseEmployeeAccountCandidates({...page,rows:[{userId:actorId,displayName:'Synthetic',email:'synthetic@example.invalid',role:'executive',active:false,linkState:'unlinked',password:'x'}]})).toThrow()
 })
 it('uses one allowlist for audit and preview including partial snapshots and UTC microseconds', () => {
  const event={id:employeeId,employeeId,actorId,actorName:'Synthetic director',recordedAt:'0001-01-01T00:00:00.123456Z',effectiveDate:null,action:'edit_employee',reason:'Reason',sourceReference:null,before:{fields:{name:'Old'}},after:{fields}}
  expect(parseEmployeeAudit({rows:[event],total:1,page:1,pageSize:25}).rows[0]).toEqual(event)
  expect(parseEmployeePreview(preview)).toEqual(preview)
  for (const snapshot of [{private:'secret'},{fields:{secret:'x'}},{episode:{startDate:'2026-02-30'}},{account:{email:'secret'}},{reporting:[{from:'2026-01-01',until:null,managerEmployeeId:null,secret:'x'}]}]) {
   expect(()=>parseEmployeePreview({...preview,before:snapshot})).toThrow()
   expect(()=>parseEmployeeAudit({rows:[{...event,after:snapshot}],total:1,page:1,pageSize:25})).toThrow()
  }
  for (const recordedAt of ['2026-02-30T00:00:00.000000Z','2026-01-01T24:00:00.000000Z','2026-01-01T00:00:00+00:00']) expect(()=>parseEmployeeAudit({rows:[{...event,recordedAt}],total:1,page:1,pageSize:25})).toThrow()
 })
 it('normalizes reporting ordering, validates complete shapes and correction evidence', () => {
  const a={managerEmployeeId:null,from:'2026-01-01',until:'2026-02-01'}, b={managerEmployeeId:actorId,from:'2026-02-01',until:null}
  expect(normalizeEmployeeProposal({...proposal,action:'save_reporting',payload:{mode:'schedule',intervals:[b,a]}}).payload).toEqual({mode:'schedule',intervals:[a,b]})
  for (const payload of [{mode:'correction',intervals:[]},{mode:'schedule',intervals:[{...a,until:a.from}]},{mode:'schedule',intervals:[{...a,managerEmployeeId:employeeId}]}]) expect(()=>normalizeEmployeeProposal({...proposal,action:'save_reporting',payload})).toThrow()
 })
 it('rejects inconsistent recovery receipts and future fields', () => {
  expect(parseOperationResult({state:'completed',result:receipt})).toEqual({state:'completed',result:receipt})
  for(const value of [{state:'absent',result:receipt},{state:'completed',result:null},{state:'abandoned',result:null,request:fields}]) expect(()=>parseOperationResult(value)).toThrow()
 })
})
it('allows only actual SQL setup/warning/role enums and full nullable account sections',()=>{
 const warnings=['ENDED_EMPLOYMENT_ACTIVE_LOGIN','ACTIVE_EMPLOYMENT_INACTIVE_LOGIN','ACCOUNT_LINK_QUARANTINED','REPORTING_COMPARISON_UNAVAILABLE','REPORTING_ACCESS_MANAGER_UNCOMPARABLE','REPORTING_ACCESS_MANAGER_MISMATCH']
 const roles=['po_admin','co_admin','sales_person','sales_manager','sales_head','executive']
 for(const role of roles){const account={userId:actorId,displayName:'Synthetic account',email:'synthetic@example.invalid',role,active:false,operationalManagerId:null,operationalManagerName:null,quarantined:true};expect(parseEmployeeDetail({...detail,account,warnings}).account).toEqual(account);for(const linkState of ['unlinked','linked','quarantined'])expect(parseEmployeeAccountCandidates({rows:[{userId:actorId,displayName:account.displayName,email:account.email,role,active:false,linkState}],total:1,page:1,pageSize:25}).rows[0].linkState).toBe(linkState)}
 expect(parseEmployeeContext({...context,canMaintainBasic:false,setupBlockers:[]})).toMatchObject({canMaintainBasic:false})
 expect(()=>parseEmployeeContext({...context,setupBlockers:['PRIVATE_ARBITRARY_MESSAGE']})).toThrow()
 expect(()=>parseEmployeeDetail({...detail,warnings:['PRIVATE_ARBITRARY_MESSAGE']})).toThrow()
 expect(()=>parseEmployeeAccountCandidates({rows:[{userId:actorId,displayName:'Synthetic',email:'synthetic@example.invalid',role:'new_hr_admin',active:true,linkState:'unlinked'}],total:1,page:1,pageSize:25})).toThrow()
})
