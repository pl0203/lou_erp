import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),rota:vi.fn(),admin:vi.fn(),read:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'71000000-0000-0000-0000-000000000004'}})}))
vi.mock('../../src/lib/leave/useLeaveReads',()=>({useLeaveReadAccess:()=>({data:{calendarAudiences:[]},available:true}),useAuthorizedLeaveRead:(...args:unknown[])=>mocks.read(...args)}))
vi.mock('../../src/pages/ihr/leave/AssignedApprovalInbox',()=>({default:()=>null}))
vi.mock('../../src/pages/ihr/leave/LeaveApprovalBadge',()=>({default:()=>null}))
vi.mock('../../src/pages/ihr/leave/DirectorLeaveOverview',()=>({default:()=>null}))
vi.mock('../../src/pages/ihr/leave/TeamLeaveCalendar',()=>({default:()=>null}))
vi.mock('../../src/pages/ihr/leave/LeaveAdministration',()=>({default:()=>{mocks.admin();return <p>Unrelated member controls</p>}}))
vi.mock('../../src/pages/ihr/leave/LeaveAdminRotaPanel',()=>({default:()=>{mocks.rota();return <p>Company calendar controls</p>}}))
import LeaveTabs from '../../src/pages/ihr/leave/LeaveTabs'
import { fetchLeaveContext } from '../../src/lib/leave/rpc'
const context=():LeaveContext=>({scopeVersion:'scope',memberKind:'director',timezone:null,balances:[],setup:{ready:false,blockers:[]},capabilities:{request:false,approve:true,configure:false,adjust:false,readPrivate:false,manageAccess:false}})
beforeEach(()=>{vi.clearAllMocks();mocks.read.mockReturnValue({data:{calendarAudiences:[]},available:true})});afterEach(cleanup)
test('computed calendar capability opens only the calendar editor for Director',()=>{
 const c=context();c.capabilities={...c.capabilities,calendarConfigure:true}
 render(<LeaveTabs context={c}/>);fireEvent.click(screen.getByRole('tab',{name:'Pengaturan'}))
 expect(screen.getByText('Company calendar controls')).toBeTruthy();expect(mocks.admin).not.toHaveBeenCalled()
 expect(screen.queryByRole('tab',{name:'Ajukan Cuti'})).toBeNull()
})
test.each([false,undefined])('missing or revoked calendar capability (%s) does not expose settings',calendarConfigure=>{
 const c=context();c.capabilities={...c.capabilities,calendarConfigure};render(<LeaveTabs context={c}/>)
 expect(screen.queryByRole('tab',{name:'Pengaturan'})).toBeNull();expect(mocks.rota).not.toHaveBeenCalled()
})
test('revoked context removes the selected calendar editor immediately',()=>{
 const c=context();c.capabilities={...c.capabilities,calendarConfigure:true};const view=render(<LeaveTabs context={c}/>)
 fireEvent.click(screen.getByRole('tab',{name:'Pengaturan'}));view.rerender(<LeaveTabs context={{...context(),scopeVersion:'revoked'}}/>)
 expect(screen.queryByText('Company calendar controls')).toBeNull();expect(screen.queryByRole('tab',{name:'Pengaturan'})).toBeNull()
})
test('decoder accepts only the new explicit calendar capability without granting other Director controls',async()=>{
 const c=context();mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{...c,capabilities:{...c.capabilities,calendarConfigure:true}},error:null})})
 expect((await fetchLeaveContext(new AbortController().signal)).capabilities.calendarConfigure).toBe(true)
 for(const extra of [{calendarConfigure:'true'},{calendarConfigure:true,configure:true},{calendarConfigure:true,adjust:true},{calendarConfigure:true,manageAccess:true},{calendarConfigure:true,readPrivate:true}]){
  mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{...c,capabilities:{...c.capabilities,...extra}},error:null})})
  await expect(fetchLeaveContext(new AbortController().signal)).rejects.toThrow()
 }
})
test('merged Director tabs preserve weekly discovery alongside calendar-only settings',()=>{
 const c=context();c.capabilities={...c.capabilities,calendarConfigure:true}
 render(<LeaveTabs context={c}/>);expect(screen.getByRole('tab',{name:'Kalender'})).toBeTruthy()
 expect(mocks.read).toHaveBeenCalled();expect(mocks.read.mock.calls[0][2]).toContain('team-calendar-access-v2')
 fireEvent.click(screen.getByRole('tab',{name:'Pengaturan'}));expect(mocks.rota).toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('tab',{name:'Kalender'}));expect(screen.queryByText('Company calendar controls')).toBeNull()
})
test('server-discovered calendar-only audience never implies configuration permission',()=>{
 const c:LeaveContext={...context(),memberKind:null,capabilities:{...context().capabilities,approve:false}}
 mocks.read.mockReturnValue({data:{calendarAudiences:['admin_team']},available:true})
 const view=render(<LeaveTabs context={c}/>);expect(screen.getByRole('tab',{name:'Kalender'})).toBeTruthy()
 expect(screen.queryByRole('tab',{name:'Pengaturan'})).toBeNull();expect(mocks.rota).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled()
 mocks.read.mockReturnValue({isError:true,available:false,isFetching:false,refetch:vi.fn()})
 view.rerender(<LeaveTabs context={{...c,scopeVersion:'revoked'}}/>);expect(screen.queryByRole('tab',{name:'Kalender'})).toBeNull()
 expect(screen.getByRole('button',{name:'Muat ulang pilihan kalender'})).toBeTruthy()
})
