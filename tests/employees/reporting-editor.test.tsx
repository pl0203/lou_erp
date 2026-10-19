import {act,fireEvent,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('../../src/lib/supabase',async()=>({supabase:(await import('./screen-fixtures')).syntheticSupabase}))
import {AuthProvider} from '../../src/lib/AuthContext'
import App from '../../src/App'
import {calls,cleanupScreen,employeeId,manyEmployees,mountScreen,server,setupScreen} from './screen-fixtures'
beforeEach(()=>{setupScreen();server.timezone='Asia/Jakarta'});afterEach(cleanupScreen)
const mount=()=>mountScreen(<AuthProvider><App/></AuthProvider>,`/ihr/employees/${employeeId}/reporting`)
it('selects managers by searchable paged names, distinguishes unknown from explicit none and previews the full timeline',async()=>{
 server.records=manyEmployees();mount();await screen.findByRole('button',{name:'Tambah periode'})
 expect(screen.getByText(/Belum ada riwayat terkonfirmasi/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Tambah periode'}))
 fireEvent.click(screen.getByRole('button',{name:'Pilih atasan periode 1'}));await screen.findByRole('dialog');fireEvent.click(await screen.findByRole('button',{name:'Halaman berikutnya'}));fireEvent.click(await screen.findByRole('button',{name:'Pilih Karyawan 27'}))
 fireEvent.change(screen.getByLabelText('Mulai periode 1'),{target:{value:'2026-10-19'}});fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Penugasan terkonfirmasi'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}))
 await screen.findByRole('heading',{name:'Tinjau sebelum menyimpan'});expect(calls('employee_preview_v1').at(-1)?.args.p_payload.intervals).toEqual([{managerEmployeeId:server.records[26].id,from:'2026-10-19',until:null}]);expect(screen.getAllByText('Karyawan 27').length).toBeGreaterThan(0)
 expect(screen.getByText(/Akses operasional tidak berubah/)).toBeTruthy()
})
it('requires correction reason/source separately from scheduling and allows explicit no manager',async()=>{
 mount();await screen.findByLabelText('Jenis perubahan');fireEvent.change(screen.getByLabelText('Jenis perubahan'),{target:{value:'correction'}});fireEvent.click(screen.getByRole('button',{name:'Tambah periode'}));fireEvent.click(screen.getByLabelText('Tanpa atasan periode 1'));fireEvent.change(screen.getByLabelText('Mulai periode 1'),{target:{value:'2026-01-01'}});fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Koreksi berdasarkan bukti'}})
 fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));expect(calls('employee_preview_v1')).toHaveLength(0);expect(screen.getByRole('alert').textContent).toContain('Sumber koreksi')
 fireEvent.change(screen.getByLabelText('Sumber koreksi'),{target:{value:'Keputusan sintetis 01'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));await screen.findByRole('heading',{name:'Tinjau sebelum menyimpan'});expect(calls('employee_preview_v1').at(-1)?.args).toMatchObject({p_source_reference:'Keputusan sintetis 01',p_payload:{mode:'correction',intervals:[{managerEmployeeId:null,from:'2026-01-01',until:null}]}})
})

it('retires a reporting preview on observed version drift and requires explicit reload before another review',async()=>{
 const view=mount()
 await screen.findByLabelText('Jenis perubahan')
 fireEvent.click(screen.getByRole('button',{name:'Tambah periode'}))
 fireEvent.click(screen.getByLabelText('Tanpa atasan periode 1'))
 fireEvent.change(screen.getByLabelText('Mulai periode 1'),{target:{value:'2026-10-19'}})
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Verified schedule'}})
 fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}))
 await screen.findByRole('heading',{name:'Tinjau sebelum menyimpan'})
 server.records[0]={...server.records[0],version:2}
 await act(async()=>{await view.client.invalidateQueries({predicate:query=>query.queryKey.includes('detail')})})
 await screen.findByText('Versi data sudah berubah')
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 expect((screen.getByLabelText('Mulai periode 1') as HTMLInputElement).value).toBe('2026-10-19')
 expect((screen.getByLabelText('Alasan perubahan') as HTMLTextAreaElement).value).toBe('Verified schedule')
 expect(calls('employee_command_v1')).toHaveLength(0)
 fireEvent.click(screen.getByRole('button',{name:'Muat data terbaru'}))
 fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}))
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 expect(screen.queryByLabelText('Mulai periode 1')).toBeNull()
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Reviewed updated timeline'}})
 fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}))
 await screen.findByRole('heading',{name:'Tinjau sebelum menyimpan'})
 expect(calls('employee_preview_v1').at(-1)?.args.p_expected_version).toBe(2)
})
