import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import LeaveRotaSettings from '../../src/pages/ihr/leave/LeaveRotaSettings'
const id='73000000-0000-0000-0000-000000000001', group='74000000-0000-0000-0000-000000000001'
const calendar={id,name:'Fictional rota',version:1,effectiveFrom:'2099-10-01',effectiveUntil:'2099-11-01',timezone:null,holidaysConfirmed:false,sundayMinutes:null,holidays:[],groups:[{id:group,name:'A',onAnchor:true}]}
const response={calendarId:id,calendarVersion:1,fingerprint:'server-fp',rows:[{date:'2099-10-03',groupId:group,capacityMinutes:225}],impacts:{available:true,pendingCount:2,approvedCount:1}}
afterEach(cleanup)
function fill(){for(const [label,value] of [['Sabtu acuan','2099-10-03'],['Publikasi mulai','2099-10-03'],['Publikasi sampai (eksklusif)','2099-11-01'],['Alasan perubahan','Fictional publication']]) fireEvent.change(screen.getByLabelText(label),{target:{value}})}
test('no inferred timezone, Sunday or holiday acceptance; no publication without preview',()=>{
 render(<LeaveRotaSettings calendar={calendar} previewCalendar={vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})} send={vi.fn()} preview={vi.fn()}/> )
 expect((screen.getByLabelText('Zona waktu') as HTMLInputElement).value).toBe('')
 expect(Array.from((screen.getByLabelText('Kapasitas Minggu') as HTMLSelectElement).options).map(o=>o.value)).toEqual(['','0'])
 expect((screen.getByLabelText('Daftar hari libur dikonfirmasi') as HTMLInputElement).checked).toBe(false)
 expect((screen.getByRole('button',{name:'Terbitkan roster'}) as HTMLButtonElement).disabled).toBe(true)
})
test('preview and publish are separate and publication uses server fingerprint/version',async()=>{
 const send=vi.fn().mockResolvedValue({id,version:2,operation:'publish_roster'}),preview=vi.fn().mockResolvedValue(response)
 render(<LeaveRotaSettings calendar={calendar} previewCalendar={vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})} send={send} preview={preview}/> );fill()
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau roster'}));await screen.findByText('2099-10-03 · A · 225 menit')
 expect(send).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Terbitkan roster'}))
 await waitFor(()=>expect(send).toHaveBeenCalledWith(expect.objectContaining({operation:'publish_roster',previewFingerprint:'server-fp',expectedVersion:1})))
})
test('calendar then roster preview shows roster impacts and publishes its own fingerprint',async()=>{
 const send=vi.fn().mockResolvedValue({id,version:2,operation:'publish_roster'})
 const previewCalendar=vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-only-fp',impacts:{available:true,pendingCount:7,approvedCount:4}})
 render(<LeaveRotaSettings calendar={calendar} send={send} preview={vi.fn().mockResolvedValue(response)} previewCalendar={previewCalendar}/>);fill()
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau dampak kalender'}))
 await screen.findByText('11 permohonan tertunda/disetujui dalam cakupan perubahan')
 expect((screen.getByRole('button',{name:'Simpan versi kalender'}) as HTMLButtonElement).disabled).toBe(false)
 expect((screen.getByRole('button',{name:'Terbitkan roster'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau roster'}))
 await screen.findByText('2099-10-03 · A · 225 menit')
 expect(screen.getByText('3 permohonan tertunda/disetujui dalam cakupan perubahan')).toBeTruthy()
 expect(screen.queryByText('11 permohonan tertunda/disetujui dalam cakupan perubahan')).toBeNull()
 expect((screen.getByRole('button',{name:'Simpan versi kalender'}) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByRole('button',{name:'Terbitkan roster'}) as HTMLButtonElement).disabled).toBe(false)
 expect(send).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Terbitkan roster'}))
 await waitFor(()=>expect(send).toHaveBeenCalledWith(expect.objectContaining({operation:'publish_roster',previewFingerprint:'server-fp',expectedVersion:1})))
 expect(send).toHaveBeenCalledTimes(1)
})
test('editing invalidates preview and failure preserves dirty calendar input',async()=>{
 render(<LeaveRotaSettings calendar={calendar} previewCalendar={vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})} send={vi.fn().mockRejectedValue(new Error('raw SQL'))} preview={vi.fn().mockResolvedValue(response)}/> );fill()
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau roster'}));await screen.findByText('2099-10-03 · A · 225 menit')
 fireEvent.change(screen.getByLabelText('Sabtu acuan'),{target:{value:'2099-10-10'}})
 expect((screen.getByRole('button',{name:'Terbitkan roster'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('Zona waktu'),{target:{value:'Asia/Jakarta'}})
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau dampak kalender'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Simpan versi kalender'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Simpan versi kalender'}));await screen.findByRole('alert')
 expect((screen.getByLabelText('Zona waktu') as HTMLInputElement).value).toBe('Asia/Jakarta')
})
test('late preview cannot authorize changed dates',async()=>{
 let resolve!:(value:typeof response)=>void
 render(<LeaveRotaSettings calendar={calendar} previewCalendar={vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})} send={vi.fn()} preview={()=>new Promise(r=>{resolve=r})}/> );fill()
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau roster'}))
 fireEvent.change(screen.getByLabelText('Sabtu acuan'),{target:{value:'2099-10-10'}});resolve(response)
 await waitFor(()=>expect(screen.queryByText('2099-10-03 · A · 225 menit')).toBeNull())
 expect((screen.getByRole('button',{name:'Terbitkan roster'}) as HTMLButtonElement).disabled).toBe(true)
})
test('publication inputs cannot change while a mutation is in flight',async()=>{
 let resolve!:(v:{id:string;version:number;operation:string})=>void
 render(<LeaveRotaSettings calendar={calendar} previewCalendar={vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})} send={()=>new Promise(r=>{resolve=r})} preview={vi.fn().mockResolvedValue(response)}/> );fill()
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau roster'}));await screen.findByText('2099-10-03 · A · 225 menit')
 fireEvent.click(screen.getByRole('button',{name:'Terbitkan roster'}))
 expect((screen.getByLabelText('Sabtu acuan') as HTMLInputElement).disabled).toBe(true)
 resolve({id,version:2,operation:'publish_roster'});await screen.findByText('Pengaturan tersimpan.')
})
function warned(){const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}
test('calendar save preserves the warning and callback state for an unpublished roster draft',async()=>{
 const send=vi.fn().mockImplementation(async(c)=>({id,version:2,operation:c.operation})),onSaved=vi.fn()
 render(<LeaveRotaSettings calendar={calendar} previewCalendar={vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})} send={send} preview={vi.fn().mockResolvedValue({...response,calendarVersion:2})} onSaved={onSaved}/> );fill()
 fireEvent.change(screen.getByLabelText('Zona waktu'),{target:{value:'Asia/Jakarta'}})
 expect(warned()).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau dampak kalender'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Simpan versi kalender'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Simpan versi kalender'}));await screen.findByRole('status')
 expect(send.mock.calls[0][0]).not.toHaveProperty('anchor')
 expect((screen.getByLabelText('Sabtu acuan') as HTMLInputElement).value).toBe('2099-10-03')
 expect(warned()).toBe(true);expect(onSaved).toHaveBeenLastCalledWith({hasUnsavedChanges:true})
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau roster'}));await screen.findByText('2099-10-03 · A · 225 menit')
 fireEvent.click(screen.getByRole('button',{name:'Terbitkan roster'}))
 await waitFor(()=>expect(onSaved).toHaveBeenLastCalledWith({hasUnsavedChanges:false}))
 expect(warned()).toBe(false)
})

test('unavailable impact response cannot authorize publication',async()=>{
 const send=vi.fn();render(<LeaveRotaSettings calendar={calendar} previewCalendar={vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})} send={send} preview={vi.fn().mockResolvedValue({...response,impacts:{available:false,pendingCount:null,approvedCount:null}})}/>);fill()
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau roster'}));await screen.findByText('2099-10-03 · A · 225 menit')
 expect((screen.getByRole('button',{name:'Terbitkan roster'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Terbitkan roster'}));expect(send).not.toHaveBeenCalled()
})

test('calendar save requires completed preview for exact current inputs and invalidates on editing',async()=>{
 const send=vi.fn(),previewCalendar=vi.fn().mockResolvedValue({calendarId:id,calendarVersion:1,fingerprint:'calendar-fp',impacts:response.impacts})
 render(<LeaveRotaSettings calendar={calendar} send={send} preview={vi.fn()} previewCalendar={previewCalendar}/>);fill()
 const save=screen.getByRole('button',{name:'Simpan versi kalender'}) as HTMLButtonElement;expect(save.disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau dampak kalender'}));await waitFor(()=>expect(save.disabled).toBe(false))
 expect(previewCalendar).toHaveBeenCalledWith(expect.objectContaining({calendarId:id,expectedVersion:1,effectiveFrom:calendar.effectiveFrom,groups:[{id:group,name:'A'}]}))
 fireEvent.change(screen.getByLabelText('Nama kalender'),{target:{value:'Changed proposal'}});expect(save.disabled).toBe(true);fireEvent.click(save);expect(send).not.toHaveBeenCalled()
})
test('unavailable calendar impact and late response for edited inputs keep save disabled',async()=>{
 let finish!:(value:unknown)=>void
 const previewCalendar=vi.fn().mockResolvedValueOnce({calendarId:id,calendarVersion:1,fingerprint:'empty',impacts:{available:false,pendingCount:null,approvedCount:null}}).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 render(<LeaveRotaSettings calendar={calendar} send={vi.fn()} preview={vi.fn()} previewCalendar={previewCalendar}/>);fill()
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau dampak kalender'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Pratinjau dampak kalender'}) as HTMLButtonElement).disabled).toBe(false));expect((screen.getByRole('button',{name:'Simpan versi kalender'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Pratinjau dampak kalender'}));fireEvent.change(screen.getByLabelText('Nama kalender'),{target:{value:'Edited in flight'}})
 finish({calendarId:id,calendarVersion:1,fingerprint:'old',impacts:response.impacts});await waitFor(()=>expect((screen.getByRole('button',{name:'Pratinjau dampak kalender'}) as HTMLButtonElement).disabled).toBe(false));expect((screen.getByRole('button',{name:'Simpan versi kalender'}) as HTMLButtonElement).disabled).toBe(true)
})
