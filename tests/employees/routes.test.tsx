import {act,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('../../src/lib/supabase',async()=>({supabase:(await import('./screen-fixtures')).syntheticSupabase}))
vi.mock('../../src/pages/girard/DailySchedule',()=>({default:()=> <p>Sales home</p>}))
vi.mock('../../src/pages/girard/ManagerSchedule',()=>({default:()=> <p>Manager home</p>}))
vi.mock('../../src/pages/athel/POList',()=>({default:()=> <p>PO home</p>}))
vi.mock('../../src/pages/athel/co/COOrders',()=>({default:()=> <p>CO home</p>}))
import {AuthProvider} from '../../src/lib/AuthContext'
import App from '../../src/App'
import {calls,cleanupScreen,employeeId,mountScreen,server,setupScreen} from './screen-fixtures'
beforeEach(setupScreen);afterEach(cleanupScreen)
it.each([['','Data karyawan'],['/new','Tambah karyawan'],[`/${employeeId}`,'Detail karyawan'],[`/${employeeId}/edit`,'Ubah karyawan'],[`/${employeeId}/reporting`,'Atasan pelaporan']])('registers protected route %s and meaningful title',async(suffix,title)=>{
 const view=mountScreen(<AuthProvider><App/></AuthProvider>,`/ihr/employees${suffix}`);await waitFor(()=>expect(document.title).toBe(`${title} | Padiwan`));expect(view.router.state.location.pathname).toBe(`/ihr/employees${suffix}`)
})
it.each(['po_admin','co_admin','sales_person','sales_manager','sales_head'])('never grants %s directory authority from a guessed direct URL',async role=>{
 server.role=role;const view=mountScreen(<AuthProvider><App/></AuthProvider>,`/ihr/employees/${employeeId}/edit`);await waitFor(()=>expect(view.router.state.location.pathname).not.toContain('/ihr/employees'));expect(calls('employee_detail_v1')).toHaveLength(0);expect(calls('employee_command_v1')).toHaveLength(0)
})
it('only exposes employee navigation after completed server capability and removes it on loss',async()=>{
 server.allowed=false;mountScreen(<AuthProvider><App/></AuthProvider>,'/ihr/employees');await screen.findByText('Akses Data Karyawan dibatasi');expect(screen.queryByRole('link',{name:'Data Karyawan'})).toBeNull()
 server.allowed=true;act(()=>window.dispatchEvent(new Event('focus')));await screen.findByRole('link',{name:'Data Karyawan'});server.allowed=false;act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(screen.queryByRole('link',{name:'Data Karyawan'})).toBeNull())
})
