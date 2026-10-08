import { beforeEach, expect, test, vi } from 'vitest'
const mock=vi.hoisted(()=>({upload:vi.fn(),readNote:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:()=>mock.readNote()};return q},storage:{from:()=>({upload:mock.upload})}}}))
import {createVisitCheckIn} from '../../src/lib/visitCheckIn'
const photo={type:'image/webp',size:5,arrayBuffer:async()=>new TextEncoder().encode('photo').buffer} as Blob
const payload={schedule_id:'s',expected_schedule_version:7,customer_id:'c',scheduled_date:'2026-10-08',notes:'Discussed display',photo_blob:photo,lat:null,lng:null}
const sender=()=>Object.assign(vi.fn().mockResolvedValue({id:'v'}),{hasUnresolved:()=>false})
beforeEach(()=>{localStorage.clear();mock.upload.mockReset().mockResolvedValue({error:null})})
test('finalize carries the captured version/store/date and bounded note atomically',async()=>{
 const send=sender();await createVisitCheckIn(send as any,()=>localStorage,'upload')(payload)
 expect(send.mock.calls[0][1]).toMatchObject({expected_schedule_version:7,customer_id:'c',scheduled_date:'2026-10-08',notes:'Discussed display'})
})
test('note changes while an outcome is unknown are blocked before another upload',async()=>{
 const send=sender().mockRejectedValue(new Error('network lost'));const check=createVisitCheckIn(send as any,()=>localStorage,'upload');await expect(check(payload)).rejects.toThrow()
 send.hasUnresolved=()=>true
 await expect(check({...payload,notes:'Changed'})).rejects.toThrow('Pulihkan')
 expect(mock.upload).toHaveBeenCalledTimes(1)
 expect(localStorage.getItem('upload')).not.toContain('Discussed display')
})
test('a stale binding refusal clears upload metadata and asks for a new capture',async()=>{
 const send=sender().mockRejectedValue(new Error('VISIT_SCHEDULE_CHANGED: Jadwal berubah'))
 await expect(createVisitCheckIn(send as any,()=>localStorage,'upload')(payload)).rejects.toThrow('VISIT_SCHEDULE_CHANGED')
 expect(localStorage.getItem('upload')).toBeNull()
})
test('overlong notes are refused before uploading',async()=>{
 await expect(createVisitCheckIn(sender() as any,()=>localStorage,'upload')({...payload,notes:'x'.repeat(2001)})).rejects.toThrow('2000')
 expect(mock.upload).not.toHaveBeenCalled()
})
import React from 'react'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach} from 'vitest'
const plan=vi.hoisted(()=>({send:Object.assign(vi.fn(),{hasUnresolved:()=>false})}))
vi.mock('../../src/lib/visitTransactions',()=>({useVisitPlanningSender:()=>plan.send}))
vi.mock('../../src/lib/useUnsavedChanges',()=>({useUnsavedChanges:()=>({dialog:null,confirmDiscard:(fn:()=>void)=>fn()})}))
import {VisitNoteEditor} from '../../src/pages/girard/OwnVisitHistory'
afterEach(cleanup)
test('a recoverable non-conflict note error retains the exact draft and payload',async()=>{
 const c=new QueryClient();plan.send.mockRejectedValueOnce(new Error('Temporary save failure')).mockResolvedValue({id:'v',version:3});render(<QueryClientProvider client={c}><VisitNoteEditor visit={{id:'v',notes:'Saved',note_version:2}}/></QueryClientProvider>);fireEvent.click(screen.getByText('Edit catatan'));fireEvent.change(screen.getByLabelText('Catatan kunjungan'),{target:{value:'Edited'}});fireEvent.click(screen.getByText('Simpan catatan'));await screen.findByText('Temporary save failure');expect((screen.getByLabelText('Catatan kunjungan') as HTMLTextAreaElement).value).toBe('Edited');expect(plan.send).toHaveBeenCalledWith('edit_visit_note',{visit_id:'v',expected_version:2,notes:'Edited'});fireEvent.click(screen.getByText('Simpan catatan'));await waitFor(()=>expect(screen.queryByLabelText('Catatan kunjungan')).toBeNull());c.clear()
})

test('stale notes retain the draft and require review before applying to each refreshed version',async()=>{
 const c=new QueryClient();let serverVersion=2;
 mock.readNote.mockImplementation(async()=>({data:{id:'v',notes:`Server note ${serverVersion}`,note_version:serverVersion},error:null}));
 plan.send.mockImplementation(async(_operation:string,payload:any)=>{if(payload.expected_version!==serverVersion)throw new Error('Visit notes changed; refresh');return {id:'v',version:serverVersion+1}});
 render(<QueryClientProvider client={c}><VisitNoteEditor visit={{id:'v',notes:'Original',note_version:1}}/></QueryClientProvider>);
 fireEvent.click(screen.getByText('Edit catatan'));fireEvent.change(screen.getByLabelText('Catatan kunjungan'),{target:{value:'My retained draft'}});fireEvent.click(screen.getByText('Simpan catatan'));
 await screen.findByText('Server note 2');expect((screen.getByLabelText('Catatan kunjungan') as HTMLTextAreaElement).value).toBe('My retained draft');expect((screen.getByText('Simpan catatan') as HTMLButtonElement).disabled).toBe(true);
 const before=plan.send.mock.calls.length;fireEvent.click(screen.getByText('Simpan catatan'));expect(plan.send).toHaveBeenCalledTimes(before);
 serverVersion=3;fireEvent.click(screen.getByText('Simpan draf pada versi terbaru'));await screen.findByText('Server note 3');expect((screen.getByLabelText('Catatan kunjungan') as HTMLTextAreaElement).value).toBe('My retained draft');
 fireEvent.click(screen.getByText('Simpan draf pada versi terbaru'));await waitFor(()=>expect(screen.queryByLabelText('Catatan kunjungan')).toBeNull());expect(plan.send.mock.calls.at(-1)).toEqual(['edit_visit_note',{visit_id:'v',expected_version:3,notes:'My retained draft'}]);c.clear()
})
