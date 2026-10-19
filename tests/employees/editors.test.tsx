import {useState} from 'react'
import {useEmployeeEditorActions} from '../../src/pages/ihr/employees/EmployeeUI'
import type {EditorActions} from '../../src/pages/ihr/employees/EmployeeUI'
import {proposal as fixtureProposal,preview as fixturePreview} from './fixtures'
import {act,fireEvent,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('../../src/lib/supabase',async()=>({supabase:(await import('./screen-fixtures')).syntheticSupabase}))
vi.mock('../../src/pages/girard/DailySchedule',()=>({default:()=> <p>Sales home</p>}))
import {AuthProvider} from '../../src/lib/AuthContext'
import App from '../../src/App'
import {calls,cleanupScreen,employeeId,mountScreen,otherId,server,setupScreen,syntheticSupabase,refreshProfile} from './screen-fixtures'
import {deferred} from './fixtures'
import {readEmployeeRecovery,writeEmployeeRecovery,EMPLOYEE_BACKEND} from '../../src/lib/employees/queryKeys'
import {actorId,operationId} from './fixtures'
beforeEach(setupScreen);afterEach(cleanupScreen)
const mount=(path='/ihr/employees/new')=>mountScreen(<AuthProvider><App/></AuthProvider>,path)
async function fill(){await screen.findByLabelText('Nama lengkap');fireEvent.change(screen.getByLabelText('Nama lengkap'),{target:{value:'  Ayu 安全  '}});fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Pencatatan disetujui'}})}
async function preview(){fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));await screen.findByRole('heading',{name:'Tinjau sebelum menyimpan'})}
it('requires reason, reviews human-readable changes and creates only an employee once on double click',async()=>{
 const view=mount();await screen.findByLabelText('Nama lengkap');fireEvent.change(screen.getByLabelText('Nama lengkap'),{target:{value:'Ayu'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));expect(calls('employee_preview_v1')).toHaveLength(0)
 expect(screen.getByRole('alert').textContent).toContain('Alasan');expect(document.activeElement?.getAttribute('role')).toBe('alert')
 await fill();await preview();expect(screen.getAllByText('Nomor karyawan').length).toBeGreaterThan(0);expect(screen.queryByText(/"recordedStatus"/)).toBeNull()
 const button=screen.getByRole('button',{name:'Simpan perubahan'});fireEvent.click(button);fireEvent.click(button)
 await waitFor(()=>expect(view.router.state.location.pathname).not.toBe('/ihr/employees/new'))
 expect(calls('employee_command_v1')).toHaveLength(1);expect(calls('employee_command_v1')[0].args.p_payload.name).toBe('Ayu 安全');expect(syntheticSupabase.from).not.toHaveBeenCalled();expect(calls('invite_user')).toHaveLength(0)
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
})
it('invalidates preview on edits and focus refresh while retaining a draft through employee transport errors',async()=>{
 mount();await fill();await preview();fireEvent.change(screen.getByLabelText('Nama lengkap'),{target:{value:'Draft retained'}});expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 await preview();server.overrides.employee_context_v1=()=>{throw new Error('offline')};act(()=>window.dispatchEvent(new Event('focus')))
 await screen.findByText('Akses belum dapat dikonfirmasi');expect(screen.queryByDisplayValue('Draft retained')).toBeNull()
 delete server.overrides.employee_context_v1;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await screen.findByDisplayValue('Draft retained');expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
})
it('purges form and reasons on confirmed server access loss rather than restoring a revoked draft',async()=>{
 mount();await fill();server.allowed=false;act(()=>window.dispatchEvent(new Event('focus')));await screen.findByText('Akses Data Karyawan dibatasi')
 server.allowed=true;fireEvent.click(screen.getByRole('button',{name:'Periksa akses lagi'}));await screen.findByLabelText('Nama lengkap');expect((screen.getByLabelText('Nama lengkap')as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('Alasan perubahan')as HTMLInputElement).value).toBe('')
})
it('recovers an earlier new-record operation on reload and navigates only to its actual receipt',async()=>{
 writeEmployeeRecovery({actorId,backend:EMPLOYEE_BACKEND,employeeId:otherId,operationId});server.receipts.set(operationId,{employeeId:otherId,operationId,version:1,auditEventId:employeeId});const view=mount()
 await screen.findByText('Hasil penyimpanan belum pasti');expect(screen.queryByRole('button',{name:'Tinjau perubahan'})).toBeNull();expect(screen.queryByRole('button',{name:'Kirim ulang operasi yang sama'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Periksa hasil'}));await waitFor(()=>expect(view.router.state.location.pathname).toBe(`/ihr/employees/${otherId}`));expect(calls('employee_command_v1')).toHaveLength(0);expect(readEmployeeRecovery(actorId)).toBeNull()
 await screen.findByText(/Perubahan sudah tersimpan/);expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
})
it('keeps uncertain saves blocked after absent outcome and only atomically abandons explicitly',async()=>{
 mount();await fill();await preview();server.overrides.employee_command_v1=()=>{throw new Error('response lost')};fireEvent.click(screen.getByRole('button',{name:'Simpan perubahan'}));await screen.findByText('Akses belum dapat dikonfirmasi')
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await screen.findByText('Hasil penyimpanan belum pasti');fireEvent.click(screen.getByRole('button',{name:'Periksa hasil'}));await waitFor(()=>expect(calls('employee_operation_v1')).toHaveLength(1));expect(screen.queryByRole('button',{name:'Tinjau perubahan'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Batalkan operasi lama'}));const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Konfirmasi pembatalan'}));await screen.findByRole('button',{name:'Tinjau perubahan'});expect(calls('employee_command_v1')).toHaveLength(1)
})
it('separates basic edits from the initial episode and requires confirmed company timezone and dates',async()=>{
 mount(`/ihr/employees/${employeeId}/edit`);await screen.findByLabelText('Nama lengkap');fireEvent.click(screen.getByRole('button',{name:'Periode kerja awal'}));await screen.findByLabelText('Tanggal mulai terkonfirmasi')
 expect(screen.getAllByText('Belum dikonfirmasi').length).toBeGreaterThan(0);fireEvent.change(screen.getByLabelText('Tanggal mulai terkonfirmasi'),{target:{value:'2026-10-19'}});fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Tanggal telah diverifikasi'}})
 fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));expect(calls('employee_preview_v1')).toHaveLength(0);expect(screen.getByRole('alert').textContent).toContain('zona waktu')
 server.timezone='Asia/Jakarta';act(()=>window.dispatchEvent(new Event('focus')));await screen.findByLabelText('Tanggal mulai terkonfirmasi');await preview();expect(calls('employee_preview_v1').at(-1)?.args).toMatchObject({p_action:'save_initial_episode',p_payload:{startDate:'2026-10-19',endDate:null,sourceReference:null}})
})
it('selects accounts explicitly and explains quarantine retains lifetime link and login',async()=>{
 server.candidates=[{userId:otherId,displayName:'Akun Sintetis',email:'test@example.invalid',role:'sales_person',active:false,linkState:'unlinked'}]
 mount(`/ihr/employees/${employeeId}/edit?section=account`);await screen.findByLabelText(/Pilih akun Akun Sintetis/);fireEvent.click(screen.getByLabelText(/Pilih akun Akun Sintetis/));fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Tautan diperiksa'}});await preview();expect(calls('employee_preview_v1').at(-1)?.args).toMatchObject({p_action:'link_account',p_payload:{userId:otherId}})
 expect(screen.getByText(/Login tidak berubah/)).toBeTruthy();expect(await screen.findByText(/Tidak aktif/)).toBeTruthy()
})
it('Cancel, Back and failed logout keep drafts until a single discard decision',async()=>{
 const view=mount();await fill();fireEvent.click(screen.getByRole('button',{name:'Batal'}));await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'Tetap mengedit'}));expect((screen.getByLabelText('Nama lengkap')as HTMLInputElement).value).toContain('Ayu')
 server.signOut.mockResolvedValue({error:new Error('offline')});fireEvent.click(screen.getByRole('button',{name:'Menu pengguna'}));fireEvent.click(screen.getByRole('button',{name:'Keluar'}));fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}));await screen.findByText('Tidak dapat keluar. Silakan coba lagi.');expect((screen.getByLabelText('Nama lengkap')as HTMLInputElement).value).toContain('Ayu');expect(server.signOut).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'Batal'}));fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}));await waitFor(()=>expect(view.router.state.location.pathname).toBe('/ihr/employees'));expect(screen.queryByRole('dialog')).toBeNull()
})
it('accepts the approved Unicode code-point name limit without a UTF-16 input cap',async()=>{
 mount();await fill();const input=screen.getByLabelText('Nama lengkap') as HTMLInputElement;expect(input.getAttribute('maxlength')).toBeNull()
 const name='🧑'.repeat(160);fireEvent.change(input,{target:{value:name}});await preview();expect(calls('employee_preview_v1').at(-1)?.args.p_payload.name).toBe(name)
 fireEvent.change(screen.getByLabelText('Nama lengkap'),{target:{value:name+'🧑'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));expect(screen.getByRole('alert').textContent).toContain('panjang');expect(calls('employee_preview_v1')).toHaveLength(1)
})
it('shows reason and effective date in the explicit review, including quarantine semantics',async()=>{
 server.timezone='Asia/Jakarta';server.records[0].account={userId:otherId,displayName:'Akun terkait',email:'linked@example.invalid',role:'sales_person',active:true,operationalManagerId:null,operationalManagerName:null,quarantined:false}
 mount(`/ihr/employees/${employeeId}/edit?section=account`);await screen.findByLabelText(/Saya ingin mengarantina/);fireEvent.click(screen.getByLabelText(/Saya ingin mengarantina/));fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Tautan keliru terverifikasi'}});fireEvent.change(screen.getByLabelText('Tanggal berlaku terkonfirmasi'),{target:{value:'2026-10-19'}});await preview()
 const review=screen.getByRole('heading',{name:'Tinjau sebelum menyimpan'}).parentElement!;expect(within(review).getByText('Tautan keliru terverifikasi')).toBeTruthy();expect(within(review).getByText('2026-10-19')).toBeTruthy();expect(within(review).getByText(/Karantina tautan akun/)).toBeTruthy();expect(within(review).getByText(/seumur hidup/)).toBeTruthy()
})
it('offers explicit server refresh after a save conflict without discarding the draft',async()=>{
 mount(`/ihr/employees/${employeeId}/edit`);await fill();await preview();server.overrides.employee_command_v1=()=>({data:null,error:{code:'40001',message:'VERSION_CONFLICT'}});fireEvent.click(screen.getByRole('button',{name:'Simpan perubahan'}));await screen.findByText(/Data berubah. Muat ulang/)
 const refresh=screen.getByRole('button',{name:'Periksa data terbaru'});server.records[0]={...server.records[0],version:2,fields:{...server.records[0].fields,name:'Perubahan Director lain'}};fireEvent.click(refresh);await screen.findByText('Versi data sudah berubah');expect((screen.getByLabelText('Nama lengkap')as HTMLInputElement).value).toContain('Ayu')
 fireEvent.click(screen.getByRole('button',{name:'Muat data terbaru'}));await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'Buang perubahan'}));await screen.findByDisplayValue('Perubahan Director lain');expect(calls('employee_command_v1')).toHaveLength(1)
})
it('does not revive a preview when changed form values are reverted',async()=>{
 mount();await fill();await preview();fireEvent.change(screen.getByLabelText('Nama lengkap'),{target:{value:'Different'}});fireEvent.change(screen.getByLabelText('Nama lengkap'),{target:{value:'  Ayu 安全  '}});expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
})
it('never applies the current employee draft to a different abandoned recovery target',async()=>{
 writeEmployeeRecovery({actorId,backend:EMPLOYEE_BACKEND,employeeId:otherId,operationId});const view=mount(`/ihr/employees/${employeeId}/edit`);await screen.findByText('Hasil penyimpanan belum pasti')
 fireEvent.click(screen.getByRole('button',{name:'Batalkan operasi lama'}));fireEvent.click(await screen.findByRole('button',{name:'Konfirmasi pembatalan'}));await screen.findByText('Buka ulang catatan yang ingin diubah');expect(screen.queryByRole('button',{name:'Tinjau perubahan'})).toBeNull();expect(calls('employee_command_v1')).toHaveLength(0)
 fireEvent.click(screen.getByRole('button',{name:'Kembali ke catatan ini'}));await waitFor(()=>expect(view.router.state.location.pathname).toBe(`/ihr/employees/${employeeId}`))
})
it('recovers a screen save whose committed response was lost, without persisting or resending the form',async()=>{
 const first=mount();await fill();await preview();server.overrides.employee_command_v1=args=>{server.receipts.set(args.p_operation_id,{employeeId:args.p_employee_id,operationId:args.p_operation_id,version:1,auditEventId:otherId});throw new Error('lost response')}
 fireEvent.click(screen.getByRole('button',{name:'Simpan perubahan'}));await waitFor(()=>expect(readEmployeeRecovery(actorId)).not.toBeNull());const marker=readEmployeeRecovery(actorId)!;expect(Object.keys(marker).sort()).toEqual(['actorId','backend','employeeId','operationId']);expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain('Ayu')
 first.unmount();const next=mount();await screen.findByText('Hasil penyimpanan belum pasti');expect(screen.queryByRole('button',{name:'Kirim ulang operasi yang sama'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Periksa hasil'}));await waitFor(()=>expect(next.router.state.location.pathname).toBe(`/ihr/employees/${marker.employeeId}`));await screen.findByText('Perubahan sudah tersimpan');expect(calls('employee_command_v1')).toHaveLength(1)
})
it('guards actual Back and Forward navigation once and restores focus after keeping the draft',async()=>{
 const view=mountScreen(<AuthProvider><App/></AuthProvider>,'/ihr/employees/new',['/ihr/employees','/ihr/employees/new']);await fill();const cancel=screen.getByRole('button',{name:'Batal'});cancel.focus();await act(async()=>{await view.router.navigate(-1)});await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'Tetap mengedit'}));expect(view.router.state.location.pathname).toBe('/ihr/employees/new');expect(document.activeElement).toBe(cancel)
 await act(async()=>{await view.router.navigate(-1)});fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}));await waitFor(()=>expect(view.router.state.location.pathname).toBe('/ihr/employees'));await act(async()=>{await view.router.navigate(1)});await screen.findByLabelText('Nama lengkap');expect((screen.getByLabelText('Nama lengkap')as HTMLInputElement).value).toBe('');expect(screen.queryByRole('dialog')).toBeNull()
})
it('verified role demotion removes protected fields and a pending recovery marker',async()=>{
 mount();await fill();writeEmployeeRecovery({actorId,backend:EMPLOYEE_BACKEND,employeeId,operationId});server.role='sales_person';await refreshProfile();await waitFor(()=>expect(screen.queryByLabelText('Nama lengkap')).toBeNull());expect(readEmployeeRecovery(actorId)).toBeNull()
})
it('restores keyboard focus to the retained field after an employee-context outage',async()=>{
 mount();await fill();const input=screen.getByLabelText('Nama lengkap');input.focus();server.overrides.employee_context_v1=()=>{throw new Error('offline')};act(()=>window.dispatchEvent(new Event('focus')));await screen.findByText('Akses belum dapat dikonfirmasi');delete server.overrides.employee_context_v1;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await screen.findByLabelText('Nama lengkap');expect(document.activeElement).toBe(screen.getByLabelText('Nama lengkap'))
})

it('withdrawn quarantine acknowledgment retires review and rechecking requires a fresh preview',async()=>{
 server.records[0].account={userId:otherId,displayName:'Akun terkait',email:'linked@example.invalid',role:'sales_person',active:true,operationalManagerId:null,operationalManagerName:null,quarantined:false}
 mount(`/ihr/employees/${employeeId}/edit?section=account`)
 fireEvent.click(await screen.findByLabelText(/Saya ingin mengarantina/))
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Tautan keliru terverifikasi'}})
 await preview()
 fireEvent.click(screen.getByLabelText(/Saya ingin mengarantina/))
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 expect((screen.getByLabelText('Alasan perubahan') as HTMLTextAreaElement).value).toBe('Tautan keliru terverifikasi')
 fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}))
 expect(calls('employee_preview_v1')).toHaveLength(1)
 fireEvent.click(screen.getByLabelText(/Saya ingin mengarantina/))
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 expect(calls('employee_command_v1')).toHaveLength(0)
 await preview()
 expect(calls('employee_preview_v1')).toHaveLength(2)
 fireEvent.click(screen.getByRole('button',{name:'Simpan perubahan'}))
 await waitFor(()=>expect(calls('employee_command_v1')).toHaveLength(1))
})
it('retires a basic preview on observed version drift while retaining the draft for explicit reload',async()=>{
 const view=mount(`/ihr/employees/${employeeId}/edit`)
 await fill();await preview()
 server.records[0]={...server.records[0],version:2,fields:{...server.records[0].fields,name:'Other Director edit'}}
 await act(async()=>{await view.client.invalidateQueries({predicate:query=>query.queryKey.includes('detail')})})
 await screen.findByText('Versi data sudah berubah')
 expect((screen.getByLabelText('Nama lengkap') as HTMLInputElement).value).toContain('Ayu')
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 expect(calls('employee_command_v1')).toHaveLength(0)
 fireEvent.click(screen.getByRole('button',{name:'Muat data terbaru'}))
 fireEvent.click(await screen.findByRole('button',{name:'Tetap mengedit'}))
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 expect((screen.getByLabelText('Nama lengkap') as HTMLInputElement).value).toContain('Ayu')
 fireEvent.click(screen.getByRole('button',{name:'Muat data terbaru'}))
 fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}))
 await screen.findByDisplayValue('Other Director edit')
 expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull()
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Tinjau versi terbaru'}})
 await preview()
 expect(calls('employee_preview_v1').at(-1)?.args.p_expected_version).toBe(2)
})
// Exercise the shared UI callback directly, with the real command/authority hooks.
// A retained handler must not submit a review retired by non-RPC eligibility state.
function EligibilityProbe({onActions}:{onActions:(value:EditorActions)=>void}) {
 const [eligible,setEligible]=useState(true)
 const actions=useEmployeeEditorActions(employeeId,()=>fixtureProposal,true,eligible)
 onActions(actions)
 return <button onClick={()=>setEligible(value=>!value)}>Toggle eligibility</button>
}
it('rejects a retained submit handler after eligibility withdrawal and after renewed review',async()=>{
 let actions!:EditorActions
 mountScreen(<AuthProvider><EligibilityProbe onActions={value=>{actions=value}}/></AuthProvider>)
 await waitFor(()=>expect(actions.command.authorityReady).toBe(true))
 await act(async()=>{await actions.review('')})
 expect(actions.visiblePreview).not.toBeNull()
 const retiredSubmit=actions.submit
 fireEvent.click(screen.getByRole('button',{name:'Toggle eligibility'}))
 await act(async()=>{retiredSubmit()})
 expect(calls('employee_command_v1')).toHaveLength(0)
 fireEvent.click(screen.getByRole('button',{name:'Toggle eligibility'}))
 expect(actions.visiblePreview).toBeNull()
 await act(async()=>{await actions.review('')})
 expect(actions.visiblePreview).not.toBeNull()
 await act(async()=>{retiredSubmit()})
 expect(calls('employee_command_v1')).toHaveLength(0)
 await act(async()=>{actions.submit()})
 await waitFor(()=>expect(calls('employee_command_v1')).toHaveLength(1))
})
it('does not revive a delayed preview after eligibility is withdrawn and restored',async()=>{
 let actions!:EditorActions
 mountScreen(<AuthProvider><EligibilityProbe onActions={value=>{actions=value}}/></AuthProvider>)
 await waitFor(()=>expect(actions.command.authorityReady).toBe(true))
 const pending=deferred<any>();server.overrides.employee_preview_v1=()=>pending.promise
 let review!:Promise<void>
 act(()=>{review=actions.review('')})
 await waitFor(()=>expect(calls('employee_preview_v1')).toHaveLength(1))
 fireEvent.click(screen.getByRole('button',{name:'Toggle eligibility'}))
 fireEvent.click(screen.getByRole('button',{name:'Toggle eligibility'}))
 await act(async()=>{pending.resolve({data:fixturePreview,error:null});await review})
 expect(actions.visiblePreview).toBeNull()
 expect(calls('employee_command_v1')).toHaveLength(0)
 delete server.overrides.employee_preview_v1
 await act(async()=>{await actions.review('')})
 expect(actions.visiblePreview).not.toBeNull()
})
