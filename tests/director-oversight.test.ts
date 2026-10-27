import { describe,it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseDirectorRequests } from '../src/lib/leave/directorContracts'
import { parseCalendarAudience,parseLeaveReadAccess } from '../src/lib/leave/readContracts'
const row={id:'11111111-1111-1111-1111-111111111111',sequence:12,employeeId:'22222222-2222-2222-2222-222222222222',employeeName:'Test employee',startDate:'2026-10-20',endDate:'2026-10-21',totalMinutes:900,status:'submitted',submittedAt:'2026-10-17T00:00:00Z',approverName:'Test manager'}
const sql=readFileSync('sql/director-oversight-review.sql','utf8')
describe('minimized director overview contracts',()=>{
 it('accepts exact minimized page',()=>expect(parseDirectorRequests({rows:[row],nextBefore:null})).toEqual({rows:[row],nextBefore:null}))
 it.each(['reason','balanceContext','allocations','cancellation','history'])('rejects extra private field %s',key=>expect(()=>parseDirectorRequests({rows:[{...row,[key]:'private'}],nextBefore:null})).toThrow())
 it('validates ordering and cursor',()=>{expect(()=>parseDirectorRequests({rows:[row],nextBefore:11})).toThrow();expect(()=>parseDirectorRequests({rows:[row],nextBefore:null},12)).toThrow();expect(()=>parseDirectorRequests({rows:[row,row],nextBefore:null})).toThrow()})
 it('rejects invalid status, dates and counts',()=>{for(const patch of [{status:'draft'},{startDate:'2026-02-30'},{endDate:'2026-01-01'},{totalMinutes:0},{sequence:1.5},{submittedAt:'no'}])expect(()=>parseDirectorRequests({rows:[{...row,...patch}],nextBefore:null})).toThrow()})
 it('accepts null approver and empty pages',()=>{expect(parseDirectorRequests({rows:[{...row,approverName:null}],nextBefore:null}).rows[0].approverName).toBe(null);expect(parseDirectorRequests({rows:[],nextBefore:null}).rows).toEqual([])})
 it('accepts director audience without changing existing audience names',()=>{for(const a of ['own','assigned_team','granted','director_all'])expect(parseCalendarAudience(a)).toBe(a);expect(parseLeaveReadAccess({scopeVersion:'1',calendarAudiences:['director_all'],defaultRange:null,defaultRangeState:'unavailable'}).calendarAudiences).toEqual(['director_all'])})
})
describe('inactive SQL candidate static boundaries (not database execution)',()=>{
 it('requires active director on each public endpoint',()=>{expect(sql.match(/actor uuid:=private.ihr_leave_require_director\(\)/g)).toHaveLength(3);expect(sql).toContain("m.active AND m.member_kind='director'");expect(sql).toContain('private.ihr_leave_require_actor()')})
 it('keeps active employee/manager target scope',()=>expect(sql).toContain("m.active AND u.is_active AND m.member_kind IN('employee','manager')"))
 it('does not change decisions, grants or table policies',()=>{expect(sql).not.toMatch(/CREATE OR REPLACE|CREATE POLICY|ALTER TABLE|UPDATE public|INSERT INTO|DELETE FROM/);expect(sql).not.toContain('ihr_leave_has_grant');expect(sql).not.toContain('ihr_leave_is_assigned_request')})
 it('retains range/status limits and ACL boundary',()=>{expect(sql).toContain('p_to-p_from>92');expect(sql).toContain("r.status IN('approved','cancellation_pending')");expect(sql).toContain('FROM PUBLIC,anon,authenticated,service_role;');expect(sql).toContain('TO authenticated;')})
 it('never projects private reasons or balances',()=>{expect(sql).not.toMatch(/'reason'|'balanceContext'|'allocations'|'source_snapshot'|'cancellationReason'/)})
})
