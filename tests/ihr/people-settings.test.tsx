import { Profiler } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import LeavePeopleSettings from '../../src/pages/ihr/leave/LeavePeopleSettings'
const id='71000000-0000-0000-0000-000000000001', actor='71000000-0000-0000-0000-000000000005', manager='71000000-0000-0000-0000-000000000003'
const member={id,name:'Fictional Employee',memberKind:'employee' as const,active:true,employmentStart:null,eligibilityDate:null,calendarId:null,version:1}
const people=[{id:manager,name:'Fictional Manager',memberKind:'manager' as const,active:true},{id:actor,name:'Configuring Manager',memberKind:'manager' as const,active:true}]
const impacts={available:false,pendingCount:null,approvedCount:null}
afterEach(cleanup)
test('unknown employment setup stays blank and self setup is visibly blocked', () => {
 render(<LeavePeopleSettings actorId={id} member={member} approvers={people} calendars={[]} impacts={impacts} send={vi.fn()}/> )
 expect((screen.getByLabelText('Mulai bekerja') as HTMLInputElement).value).toBe('')
 expect(screen.getByText(/Administrator lain/)).toBeTruthy()
 expect((screen.getByRole('button',{name:'Simpan anggota'}) as HTMLButtonElement).disabled).toBe(true)
})
test('failed saves preserve dirty input and explicit optimistic version', async () => {
 const send=vi.fn().mockRejectedValue(new Error('private SQL text'))
 render(<LeavePeopleSettings actorId={actor} member={member} approvers={people} calendars={[]} impacts={impacts} send={send}/> )
 fireEvent.change(screen.getByLabelText('Mulai bekerja'),{target:{value:'2026-10-01'}})
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Fictional setup'}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan anggota'}))
 await screen.findByRole('alert')
 expect((screen.getByLabelText('Mulai bekerja') as HTMLInputElement).value).toBe('2026-10-01')
 expect(send).toHaveBeenCalledWith(expect.objectContaining({operation:'set_member',expectedVersion:1,employmentStart:'2026-10-01'}))
 expect(screen.queryByText('private SQL text')).toBeNull()
})
test('approver choices exclude configuring actor and requester; dates/replacement are explicit', async () => {
 const send=vi.fn().mockResolvedValue({id:manager,version:2,operation:'set_approver'})
 render(<LeavePeopleSettings actorId={actor} member={member} approvers={people} calendars={[]} impacts={impacts} send={send}/> )
 const select=screen.getByLabelText('Penyetuju') as HTMLSelectElement
 expect(Array.from(select.options).map(o=>o.value)).not.toContain(actor)
 fireEvent.change(select,{target:{value:manager}})
 fireEvent.change(screen.getByLabelText('Berlaku mulai'),{target:{value:'2099-10-03'}})
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Explicit assignment'}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyetuju'}))
 await waitFor(()=>expect(send).toHaveBeenCalledWith(expect.objectContaining({operation:'set_approver',approverId:manager,effectiveFrom:'2099-10-03',replaceAssignmentId:null})))
 expect(screen.getByText(/Snapshot permohonan tidak dihitung ulang/)).toBeTruthy()
})
test('mapped directors cannot be relabeled to gain entitlement',()=>{
 render(<LeavePeopleSettings actorId={actor} member={{...member,memberKind:'director'}} approvers={people} calendars={[]} impacts={impacts} send={vi.fn()}/> )
 expect((screen.getByLabelText('Jenis anggota') as HTMLSelectElement).disabled).toBe(true)
})
test('server-authorized PO Admin employee can select an explicitly named Director without becoming a manager',async()=>{
 const director='71000000-0000-0000-0000-000000000004',send=vi.fn().mockResolvedValue({id:director,version:2,operation:'set_approver'})
 const configured={...member,allowedApproverKinds:['manager','director'] as ('manager'|'director')[]}
 render(<LeavePeopleSettings actorId={actor} member={configured} approvers={[...people,{id:director,name:'Fictional Director',memberKind:'director',active:true}]} calendars={[]} impacts={impacts} send={send}/> )
 const select=screen.getByLabelText('Penyetuju') as HTMLSelectElement
 expect(Array.from(select.options).map(o=>o.value)).toContain(director)
 fireEvent.change(select,{target:{value:director}})
 fireEvent.change(screen.getByLabelText('Berlaku mulai'),{target:{value:'2035-01-01'}})
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Explicit Director assignment'}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyetuju'}))
 await waitFor(()=>expect(send).toHaveBeenCalledWith(expect.objectContaining({operation:'set_approver',approverId:director})))
 expect((screen.getByLabelText('Jenis anggota') as HTMLSelectElement).value).toBe('employee')
})
test('ordinary employee and missing server metadata do not expose Director choices',()=>{
 const director={id:'71000000-0000-0000-0000-000000000004',name:'Fictional Director',memberKind:'director' as const,active:true}
 render(<LeavePeopleSettings actorId={actor} member={member} approvers={[...people,director]} calendars={[]} impacts={impacts} send={vi.fn()}/> )
 expect(Array.from((screen.getByLabelText('Penyetuju') as HTMLSelectElement).options).map(o=>o.value)).not.toContain(director.id)
})
test.each(['director',null] as const)('server gives no approver choices for %s membership',kind=>{
 render(<LeavePeopleSettings actorId={actor} member={{...member,memberKind:kind,allowedApproverKinds:[]}} approvers={people} calendars={[]} impacts={impacts} send={vi.fn()}/> )
 expect((screen.getByLabelText('Penyetuju') as HTMLSelectElement).options).toHaveLength(1)
})
test('dirty setup warns before reload without saving any draft',()=>{
 render(<LeavePeopleSettings actorId={actor} member={member} approvers={people} calendars={[]} impacts={impacts} send={vi.fn()}/> )
 fireEvent.change(screen.getByLabelText('Alasan perubahan'),{target:{value:'Private in-memory reason'}})
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event)
 expect(event.defaultPrevented).toBe(true)
})
function edit(label:string,value:string){fireEvent.change(screen.getByLabelText(label),{target:{value}})}
function warned(){const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}
const group='74000000-0000-0000-0000-000000000001'
test.each([
 ['Simpan penyetuju','set_approver','Mulai bekerja','2026-10-01'],
 ['Simpan kelompok','set_group_membership','Mulai bekerja','2026-10-01'],
 ['Simpan anggota','set_member','Penyetuju',manager],
 ['Simpan anggota','set_member','Kelompok Sabtu',group],
 ['Simpan penyetuju','set_approver','Kelompok Sabtu',group],
 ['Simpan kelompok','set_group_membership','Penyetuju',manager],
])('%s preserves another unsaved section (%s, %s)',async(button,operation,other,value)=>{
 const send=vi.fn().mockImplementation(async(c)=>({id,version:2,operation:c.operation})),onSaved=vi.fn()
 render(<LeavePeopleSettings actorId={actor} member={member} approvers={people} calendars={[]} groups={[{id:group,name:'A'}]} impacts={impacts} send={send} onSaved={onSaved}/> )
 edit(other,value);edit('Alasan perubahan','Fictional mixed draft')
 if(operation==='set_approver'){edit('Penyetuju',manager);edit('Berlaku mulai','2099-10-03')}
 if(operation==='set_group_membership'){edit('Kelompok Sabtu',group);edit('Berlaku mulai','2099-10-03')}
 expect(warned()).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:button}));await screen.findByRole('status')
 expect(send.mock.calls[0][0].operation).toBe(operation)
 if(other==='Mulai bekerja')expect(send.mock.calls[0][0]).not.toHaveProperty('employmentStart')
 expect((screen.getByLabelText(other) as HTMLInputElement).value).toBe(value)
 expect(warned()).toBe(true)
 expect(onSaved).toHaveBeenCalledWith({hasUnsavedChanges:true})
})
test('saving the only edited member section clears the warning, while reverting a draft is clean',async()=>{
 const send=vi.fn().mockResolvedValue({id,version:2,operation:'set_member'}),onSaved=vi.fn()
 render(<LeavePeopleSettings actorId={actor} member={member} approvers={people} calendars={[]} impacts={impacts} send={send} onSaved={onSaved}/> )
 edit('Mulai bekerja','2026-10-01');edit('Mulai bekerja','');expect(warned()).toBe(false)
 edit('Mulai bekerja','2026-10-01');edit('Alasan perubahan','Fictional save')
 fireEvent.click(screen.getByRole('button',{name:'Simpan anggota'}));await screen.findByRole('status')
 expect(warned()).toBe(false);expect(onSaved).toHaveBeenCalledWith({hasUnsavedChanges:false})
})
test.each([['Simpan penyetuju','Penyetuju',manager],['Simpan kelompok','Kelompok Sabtu',group]])('saving only %s clears its own draft and shared dates',async(button,label,value)=>{
 const send=vi.fn().mockImplementation(async(c)=>({id,version:2,operation:c.operation})),onSaved=vi.fn()
 render(<LeavePeopleSettings actorId={actor} member={member} approvers={people} calendars={[]} groups={[{id:group,name:'A'}]} impacts={impacts} send={send} onSaved={onSaved}/> )
 edit(label,value);edit('Berlaku mulai','2099-10-03');edit('Alasan perubahan','Fictional assignment')
 fireEvent.click(screen.getByRole('button',{name:button}));await screen.findByRole('status')
 expect(warned()).toBe(false);expect(onSaved).toHaveBeenCalledWith({hasUnsavedChanges:false})
})
test('revocation preserves an unsent replacement draft and its dates',async()=>{
 const assignment='75000000-0000-0000-0000-000000000001',send=vi.fn().mockResolvedValue({id:assignment,version:2,operation:'set_approver'}),onSaved=vi.fn()
 render(<LeavePeopleSettings actorId={actor} member={{...member,assignments:[{id:assignment,approverId:manager,effectiveFrom:'2099-10-01T00:00:00Z',effectiveUntil:null,version:1}]}} approvers={people} calendars={[]} impacts={impacts} send={send} onSaved={onSaved}/> )
 edit('Penugasan yang diubah',assignment);edit('Penyetuju',manager);edit('Berlaku mulai','2099-10-03');edit('Alasan perubahan','Fictional revoke')
 fireEvent.click(screen.getByRole('button',{name:'Cabut penyetuju'}));await screen.findByRole('status')
 expect(send).toHaveBeenCalledWith(expect.objectContaining({approverId:null,effectiveFrom:null,effectiveUntil:null}))
 expect((screen.getByLabelText('Berlaku mulai') as HTMLInputElement).value).toBe('2099-10-03')
 expect(warned()).toBe(true);expect(onSaved).toHaveBeenCalledWith({hasUnsavedChanges:true})
})

test('confirmed member save releases the unload warning in the same UI commit',async()=>{
 const send=vi.fn().mockResolvedValue({id,version:2,operation:'set_member'}),onSaved=vi.fn()
 const committedWarnings:boolean[]=[]
 render(<Profiler id="member-editor" onRender={()=>{
  if(screen.queryByRole('status'))committedWarnings.push(warned())
 }}><LeavePeopleSettings actorId={actor} member={member} approvers={people} calendars={[]} impacts={impacts} send={send} onSaved={onSaved}/></Profiler>)
 edit('Mulai bekerja','2026-10-01');edit('Alasan perubahan','Fictional save')
 expect(warned()).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Simpan anggota'}));await screen.findByRole('status')
 expect(onSaved).toHaveBeenCalledWith({hasUnsavedChanges:false})
 expect(committedWarnings).toEqual([false])
})
