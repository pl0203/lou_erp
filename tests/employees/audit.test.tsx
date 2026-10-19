import {fireEvent,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('../../src/lib/supabase',async()=>({supabase:(await import('./screen-fixtures')).syntheticSupabase}))
import {AuthProvider} from '../../src/lib/AuthContext'
import App from '../../src/App'
import {actorId,calls,cleanupScreen,employeeId,mountScreen,server,setupScreen} from './screen-fixtures'
beforeEach(setupScreen);afterEach(cleanupScreen)
it('shows readable before/after, actor, effective date and explicit UTC with paged audit',async()=>{
 server.audits=Array.from({length:26},(_,index)=>({id:`30000000-0000-0000-0000-${String(index+1).padStart(12,'0')}`,employeeId,actorId,actorName:'Direktur sintetis',recordedAt:'2026-10-19T00:30:00.123456Z',effectiveDate:null,action:'edit_employee',reason:`Koreksi ${index+1}`,sourceReference:'Bukti sintetis',before:{fields:{name:'Lama'}},after:{fields:{name:'Baru'}}}))
 mountScreen(<AuthProvider><App/></AuthProvider>,`/ihr/employees/${employeeId}`)
 await screen.findByText('Koreksi 1');expect(screen.getAllByText('Nama lengkap').length).toBeGreaterThan(0);expect(screen.getAllByText('Lama').length).toBeGreaterThan(0);expect(screen.getAllByText(/UTC/).length).toBeGreaterThan(0);expect(screen.queryByText(/"fields"/)).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Halaman audit berikutnya'}));await screen.findByText('Koreksi 26');expect(calls('employee_audit_v1').at(-1)?.args.p_page).toBe(2)
})
