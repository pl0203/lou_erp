import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,expect,test,vi } from 'vitest'
import LeaveAdminSettings from '../../src/pages/ihr/leave/LeaveAdminSettings'
import type { LeaveAdminSettingsProps } from '../../src/pages/ihr/leave/LeaveAdminSettings'
import type { LeaveAdminSettingsData } from '../../src/lib/leave/adminContracts'
const actor='71000000-0000-0000-0000-000000000005',employee='71000000-0000-0000-0000-000000000001',approval='81000000-0000-0000-0000-000000000001'
const settings:LeaveAdminSettingsData={employeeId:employee,authorityKey:'a'.repeat(64),memberVersion:2,policy:null,policyDrafts:[],governance:[{id:approval,kind:'retention',referenceVersion:0,selected:false,confirmed:false,ruleId:null,ruleVersion:null,ruleDocument:null,approvedBy:null,approvedAt:null,accountableOwner:null,cadence:null,capabilities:null,grantIds:null,audienceIds:null}],readiness:{ready:false,blockers:[{code:'RETENTION_UNCONFIRMED',message:'Retensi belum disetujui'}]},impacts:{available:false,pendingCount:null,approvedCount:null}}
const props=():LeaveAdminSettingsProps=>({actorId:actor,employeeId:employee,scopeVersion:'one',dataScopeVersion:'one',authorityKey:'a'.repeat(64),authorityReady:true,canConfigure:true,canManageAccess:false,canReadPrivate:false,settings,send:vi.fn(),onRefresh:vi.fn(async()=>({employeeId:employee,scopeVersion:'one'}))})
const edit=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
test('all unknown rules remain unselected and readiness blockers stay explicit',()=>{
 render(<LeaveAdminSettings {...props()}/>);expect((screen.getByLabelText('Pembatalan tanggal lampau diizinkan') as HTMLSelectElement).value).toBe('');expect((screen.getByLabelText('Lingkup kalender') as HTMLSelectElement).value).toBe('');expect(screen.getByText('Retensi belum disetujui')).toBeTruthy();expect(screen.queryByLabelText('Manifest izin yang disetujui')).toBeNull();expect(screen.queryByLabelText('Permohonan yang dialihkan')).toBeNull()
})
test('scope change and permission loss erase private draft; pending authority removes private DOM',()=>{
 const p=props(),view=render(<LeaveAdminSettings {...p}/>);edit('Alasan policy','Private draft')
 view.rerender(<LeaveAdminSettings {...p} authorityReady={false}/>);expect(screen.queryByLabelText('Alasan policy')).toBeNull()
 view.rerender(<LeaveAdminSettings {...p} scopeVersion="two" dataScopeVersion="two"/>);expect((screen.getByLabelText('Alasan policy') as HTMLTextAreaElement).value).toBe('')
 edit('Alasan policy','Another draft');view.rerender(<LeaveAdminSettings {...p} canConfigure={false}/>);expect(screen.queryByLabelText('Alasan policy')).toBeNull()
 view.rerender(<LeaveAdminSettings {...p}/>);expect((screen.getByLabelText('Alasan policy') as HTMLTextAreaElement).value).toBe('')
})
test('successful own epoch change preserves another dirty section only with completed target continuity',async()=>{
 let resolve!:(v:{employeeId:string;scopeVersion:string})=>void;const p=props();p.send=vi.fn(async c=>({id:approval,version:1,operation:c.operation}));p.onRefresh=vi.fn(()=>new Promise(r=>{resolve=r}))
 const view=render(<LeaveAdminSettings {...p}/>);edit('Alasan policy','Unsaved other section');edit('Bukti retensi',approval);edit('Alasan retention','Reviewed reference');fireEvent.click(screen.getByRole('button',{name:'Gunakan bukti retensi'}))
 await waitFor(()=>expect(p.onRefresh).toHaveBeenCalled());view.rerender(<LeaveAdminSettings {...p} scopeVersion="two" dataScopeVersion="two"/>);expect(screen.queryByLabelText('Alasan policy')).toBeNull()
 resolve({employeeId:employee,scopeVersion:'two'});await screen.findByText('Pengaturan tersimpan (versi 1).');expect((screen.getByLabelText('Alasan policy') as HTMLTextAreaElement).value).toBe('Unsaved other section')
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
})
test('failure preserves input, sanitizes diagnostics and focuses accessible error',async()=>{
 const p=props();p.send=vi.fn().mockRejectedValue(new Error('private SQL reason'));render(<LeaveAdminSettings {...p}/>);edit('Bukti retensi',approval);edit('Alasan retention','Keep this draft');fireEvent.click(screen.getByRole('button',{name:'Gunakan bukti retensi'}));const error=await screen.findByRole('alert');await waitFor(()=>expect(document.activeElement).toBe(error));expect((screen.getByLabelText('Alasan retention') as HTMLTextAreaElement).value).toBe('Keep this draft');expect(screen.queryByText('private SQL reason')).toBeNull()
})
test('Escape honors unsaved confirmation and target/self changes block writes',()=>{
 const p=props(),close=vi.fn(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false);const view=render(<LeaveAdminSettings {...p} onClose={close}/>);edit('Alasan policy','Private draft');fireEvent.keyDown(screen.getByLabelText('Alasan policy'),{key:'Escape'});expect(confirm).toHaveBeenCalled();expect(close).not.toHaveBeenCalled();view.rerender(<LeaveAdminSettings {...p} actorId={employee}/>);expect((screen.getByRole('button',{name:'Simpan versi kebijakan'}) as HTMLButtonElement).disabled).toBe(true)
})
test('actual grant fingerprint change drops draft even when capability booleans match',()=>{
 const p=props(),view=render(<LeaveAdminSettings {...p}/>);edit('Alasan policy','Private old grant draft');view.rerender(<LeaveAdminSettings {...p} authorityKey={'b'.repeat(64)} settings={{...settings,authorityKey:'b'.repeat(64)}}/>);expect((screen.getByLabelText('Alasan policy') as HTMLTextAreaElement).value).toBe('')
})
test('new epoch during pending send hides drafts before the response arrives',async()=>{
 let resolve!:(v:any)=>void;const p=props();p.send=vi.fn(()=>new Promise(r=>{resolve=r}));const view=render(<LeaveAdminSettings {...p}/>);edit('Bukti retensi',approval);edit('Alasan retention','Sensitive draft');fireEvent.click(screen.getByRole('button',{name:'Gunakan bukti retensi'}));view.rerender(<LeaveAdminSettings {...p} scopeVersion="two" dataScopeVersion="two"/>);expect(screen.queryByLabelText('Alasan retention')).toBeNull();resolve({id:approval,version:1,operation:'set_governance_reference'});await waitFor(()=>expect(p.onRefresh).toHaveBeenCalled())
})
