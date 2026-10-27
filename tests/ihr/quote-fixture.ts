import { employeeA, employeeB, managerA } from './fixtures'
export const quoteInput={startDate:'2026-10-02',endDate:'2026-10-03',duration:{mode:'full_scheduled_day' as const},reason:'Private annual leave reason'}
export const quoteScope='42:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const changedQuoteScope='42:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
export const quoteFixture={fingerprint:'a'.repeat(64),startDate:'2026-10-02',endDate:'2026-10-03',today:'2026-10-01',duration:{mode:'full_scheduled_day' as const},totalMinutes:675,scopeVersion:quoteScope,memberVersion:1,policy:{id:employeeB,version:1},
 approver:{id:managerA,name:'Fictional Manager',assignmentId:employeeB,assignmentVersion:1},
 days:[{date:'2026-10-02',scheduledMinutes:450,chargedMinutes:450,exclusion:null,year:2026,accountId:employeeA,sources:{calendarId:employeeB,calendarVersion:1,rosterId:null,rosterVersion:null,membershipId:null,membershipVersion:null,groupId:null,groupVersion:null,groupName:null}},
 {date:'2026-10-03',scheduledMinutes:225,chargedMinutes:225,exclusion:null,year:2026,accountId:employeeA,sources:{calendarId:employeeB,calendarVersion:1,rosterId:employeeB,rosterVersion:1,membershipId:employeeB,membershipVersion:1,groupId:employeeB,groupVersion:1,groupName:'Fictional Amber'}}],
 allocations:[{accountId:employeeA,year:2026,version:4,chargedMinutes:675,availableBefore:4890,availableAfter:4215}]}
