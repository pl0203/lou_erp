import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
vi.mock('../../src/lib/supabase',async()=>({supabase:(await import('./screen-fixtures')).syntheticSupabase}))
import { AuthProvider } from '../../src/lib/AuthContext'
import App from '../../src/App'
import {calls,cleanupScreen,employeeId,manyEmployees,mountScreen,server,setupScreen} from './screen-fixtures'
import {deferred} from './fixtures'
beforeEach(setupScreen);afterEach(cleanupScreen)
const mount=()=>mountScreen(<AuthProvider><App/></AuthProvider>,'/ihr/employees')
it('offers a name/number search, recorded-status filter and complete pagination',async()=>{
 server.records=manyEmployees();mount();await screen.findByRole('link',{name:'Karyawan 01'})
 fireEvent.click(screen.getByRole('button',{name:'Halaman berikutnya'}));await screen.findByRole('link',{name:'Karyawan 27'})
 fireEvent.change(screen.getByLabelText('Cari nama atau nomor karyawan'),{target:{value:'Karyawan 03'}})
 await screen.findByRole('link',{name:'Karyawan 03'});expect(screen.queryByRole('link',{name:'Karyawan 27'})).toBeNull()
 fireEvent.change(screen.getByLabelText('Status tercatat'),{target:{value:'ended'}})
 await screen.findByText('Tidak ada karyawan yang cocok');expect(calls('employee_page_v1').at(-1)?.args).toMatchObject({p_page:1,p_query:'Karyawan 03',p_status:'ended'})
})
it('denies completed negative server authority without confusing transport failure with denial',async()=>{
 server.allowed=false;mount();await screen.findByText('Akses Data Karyawan dibatasi');expect(calls('employee_page_v1')).toHaveLength(0);expect(screen.queryByRole('link',{name:'Tambah karyawan'})).toBeNull()
 server.allowed=true;fireEvent.click(screen.getByRole('button',{name:'Periksa akses lagi'}));await screen.findByRole('link',{name:'Synthetic employee'})
 server.overrides.employee_context_v1=()=>{throw new Error('offline')};act(()=>window.dispatchEvent(new Event('focus')))
 await screen.findByText('Akses belum dapat dikonfirmasi');expect(screen.queryByText('Synthetic employee')).toBeNull();expect(screen.queryByText('Akses Data Karyawan dibatasi')).toBeNull()
})
it('cannot restore old search results when an obsolete request completes',async()=>{
 const old=deferred<any>();mount();await screen.findByRole('link',{name:'Synthetic employee'})
 server.overrides.employee_page_v1=args=>args.p_query==='old'?old.promise:{data:{rows:[],page:1,pageSize:25,total:0},error:null}
 fireEvent.change(screen.getByLabelText('Cari nama atau nomor karyawan'),{target:{value:'old'}});await waitFor(()=>expect(calls('employee_page_v1').at(-1)?.args.p_query).toBe('old'))
 fireEvent.change(screen.getByLabelText('Cari nama atau nomor karyawan'),{target:{value:'new'}});await screen.findByText('Tidak ada karyawan yang cocok')
 await act(async()=>old.resolve({data:{rows:[{...server.records[0].fields,id:employeeId,version:1}],total:1,page:1,pageSize:25},error:null}));expect(screen.queryByRole('link',{name:'Synthetic employee'})).toBeNull()
})
it('detail explains unknown dates, account access and reporting mismatches without access controls',async()=>{
 server.records[0].fields.recordedStatus='ended';server.records[0].warnings=['ENDED_EMPLOYMENT_ACTIVE_LOGIN','REPORTING_ACCESS_MANAGER_MISMATCH']
 server.records[0].account={userId:employeeId,displayName:'Akun sintetis',email:'synthetic@example.invalid',role:'sales_person',active:true,operationalManagerId:null,operationalManagerName:'Manajer operasional',quarantined:false}
 mountScreen(<AuthProvider><App/></AuthProvider>,`/ihr/employees/${employeeId}`)
 await screen.findByRole('heading',{name:'Synthetic employee'});expect(screen.getAllByText('Belum dikonfirmasi').length).toBeGreaterThan(0)
 expect(screen.getByText(/Hubungan kerja tercatat berakhir, tetapi login masih aktif/)).toBeTruthy();expect(screen.getByText('Manajer operasional')).toBeTruthy()
 expect(screen.getByText(/Atasan pelaporan berbeda/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Nonaktifkan akun/})).toBeNull()
})
it('searches a full 120-code-point Unicode name without native truncation',async()=>{
 const name='🧑'.repeat(120);server.records[0].fields.name=name;mount();await screen.findByRole('link',{name});const input=screen.getByLabelText('Cari nama atau nomor karyawan');expect(input.getAttribute('maxlength')).toBeNull();fireEvent.change(input,{target:{value:name}});await waitFor(()=>expect(calls('employee_page_v1').at(-1)?.args.p_query).toBe(name));await screen.findByRole('link',{name})
})
it('resolves only referenced reporting managers using completed protected reads and internal links',async()=>{
 const manager={...structuredClone(server.records[0]),id:'30000000-0000-0000-0000-000000000001',fields:{...server.records[0].fields,name:'Atasan Sintetis'}};server.records.push(manager);server.records[0].reporting=[{managerEmployeeId:manager.id,from:'2026-10-19',until:null}]
 mountScreen(<AuthProvider><App/></AuthProvider>,`/ihr/employees/${employeeId}`);const link=await screen.findByRole('link',{name:'Atasan Sintetis'});expect(link.getAttribute('href')).toBe(`/ihr/employees/${manager.id}`);expect(calls('employee_page_v1')).toHaveLength(0)
})
