import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,expect,test,vi } from 'vitest'
import LeaveBalanceSettings from '../../src/pages/ihr/leave/LeaveBalanceSettings'
import LeavePeopleSettings from '../../src/pages/ihr/leave/LeavePeopleSettings'
import { employeeA,employeeB,hrA } from './fixtures'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
test('minimal write account permits exact adjustment without private balance amounts and hides its dirty editor during authority interruption',async()=>{
 const send=vi.fn().mockResolvedValue({id:employeeB,version:3,operation:'adjust_balance'}),dirty=vi.fn()
 const props={actorId:hrA,employeeId:employeeA,currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'},accountMetadata:{accountId:employeeB,year:2026,version:2,reconciled:true},canConfigure:false,canAdjust:true,send,onDirtyChange:dirty,authorityReady:true}
 const view=render(<LeaveBalanceSettings {...props}/>);fireEvent.change(screen.getByLabelText('ID sumber'),{target:{value:'82000000-0000-0000-0000-000000000001'}});fireEvent.change(screen.getByLabelText('Alasan'),{target:{value:'Approved allowance adjustment'}});fireEvent.change(screen.getByLabelText('Menit penyesuaian'),{target:{value:'60'}})
 expect((screen.getByRole('button',{name:'Simpan penyesuaian'}) as HTMLButtonElement).disabled).toBe(false)
 view.rerender(<LeaveBalanceSettings {...props} authorityReady={false}/>);expect(screen.queryByDisplayValue('Approved allowance adjustment')).toBeNull();expect(dirty).toHaveBeenLastCalledWith(true)
 view.rerender(<LeaveBalanceSettings {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Simpan penyesuaian'}));await waitFor(()=>expect(send).toHaveBeenCalledWith(expect.objectContaining({operation:'adjust_balance',expectedVersion:2,deltaMinutes:60})));expect(screen.queryByText(/Saldo tersedia \(menit\): 0/)).toBeNull()
})
test('member editor removes private controls while pending and preserves one dirty guard',()=>{
 const props={actorId:hrA,member:{id:employeeA,name:'Fictional target',memberKind:'employee' as const,active:true,employmentStart:'2020-01-01',eligibilityDate:'2021-01-01',calendarId:null,version:1},approvers:[],calendars:[],impacts:{available:false,pendingCount:null,approvedCount:null},send:vi.fn(),onDirtyChange:vi.fn(),authorityReady:true}
 const view=render(<LeavePeopleSettings {...props}/>);fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Private setup draft'}});view.rerender(<LeavePeopleSettings {...props} authorityReady={false}/>);expect(screen.queryByDisplayValue('Private setup draft')).toBeNull();expect(props.onDirtyChange).toHaveBeenLastCalledWith(true)
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);view.rerender(<LeavePeopleSettings {...props}/>);expect(screen.getByDisplayValue('Private setup draft')).toBeTruthy()
})

test('rota editor hides private draft through shared authority interruption and reports dirty state',async()=>{
 const {default:LeaveRotaSettings}=await import('../../src/pages/ihr/leave/LeaveRotaSettings')
 const props={calendar:{id:employeeA,name:'Fictional calendar',version:1,effectiveFrom:'2026-01-01',effectiveUntil:null,timezone:'Etc/UTC',holidaysConfirmed:false,sundayMinutes:null,holidays:[],groups:[]},send:vi.fn(),preview:vi.fn(),onDirtyChange:vi.fn(),authorityReady:true}
 const view=render(<LeaveRotaSettings {...props}/>);fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Private calendar draft'}});view.rerender(<LeaveRotaSettings {...props} authorityReady={false}/>);expect(screen.queryByDisplayValue('Private calendar draft')).toBeNull();expect(props.onDirtyChange).toHaveBeenLastCalledWith(true)
 view.rerender(<LeaveRotaSettings {...props}/>);expect(screen.getByDisplayValue('Private calendar draft')).toBeTruthy()
})
