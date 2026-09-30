import { beforeEach, expect, test, vi } from 'vitest'
const mocks=vi.hoisted(()=>({upload:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{storage:{from:()=>({upload:mocks.upload})}}}))
import { createVisitCheckIn } from '../src/lib/visitCheckIn'
const blob=(value='photo')=>({type:'image/webp',size:value.length,arrayBuffer:async()=>new TextEncoder().encode(value).buffer}) as Blob
const sender=()=>Object.assign(vi.fn(),{hasUnresolved:()=>false})
beforeEach(()=>{localStorage.clear();mocks.upload.mockReset()})
test('lost upload response is accepted only after authoritative finalize validates object',async()=>{
 const send=sender().mockResolvedValue({id:'saved'});mocks.upload.mockResolvedValue({error:{message:'response lost'}})
 const check=createVisitCheckIn(send as any,()=>localStorage,'upload-test')
 await expect(check({schedule_id:'schedule',photo_blob:blob(),lat:1,lng:2})).resolves.toEqual({id:'saved'})
 expect(send).toHaveBeenCalledWith('finalize_visit',expect.objectContaining({storage_path:expect.stringMatching(/^visits\/schedule\/.+\.webp$/)}))
})
test('upload failure and missing server object cannot report successful check-in',async()=>{
 const send=sender().mockRejectedValue(new Error('Owned uploaded photo required'));mocks.upload.mockResolvedValue({error:{message:'denied'}})
 await expect(createVisitCheckIn(send as any,()=>localStorage,'upload-test')({schedule_id:'schedule',photo_blob:blob(),lat:null,lng:null})).rejects.toThrow('Owned uploaded photo required')
})
test('same photo retry/remount retains path; persistent metadata has no photo/location',async()=>{
 const send=sender().mockRejectedValueOnce(new Error('lost')).mockResolvedValue({id:'saved'});mocks.upload.mockResolvedValue({error:null})
 const payload={schedule_id:'schedule',photo_blob:blob('private image contents'),lat:12.3456,lng:98.7654}
 await expect(createVisitCheckIn(send as any,()=>localStorage,'upload-test')(payload)).rejects.toThrow('lost')
 const saved=localStorage.getItem('upload-test')!;expect(saved).not.toContain('private image contents');expect(saved).not.toContain('12.3456');expect(saved).not.toContain('98.7654')
 await createVisitCheckIn(send as any,()=>localStorage,'upload-test')(payload)
 expect(mocks.upload.mock.calls[0][0]).toBe(mocks.upload.mock.calls[1][0]);expect(localStorage.getItem('upload-test')).toBeNull()
})
test('changed photo while finalize outcome unknown is blocked before new upload',async()=>{
 const send=sender().mockRejectedValue(new Error('lost'));mocks.upload.mockResolvedValue({error:null});const check=createVisitCheckIn(send as any,()=>localStorage,'upload-test')
 await expect(check({schedule_id:'schedule',photo_blob:blob('a'),lat:null,lng:null})).rejects.toThrow()
 send.hasUnresolved=()=>true
 await expect(check({schedule_id:'schedule',photo_blob:blob('b'),lat:null,lng:null})).rejects.toThrow('Pulihkan')
 expect(mocks.upload).toHaveBeenCalledTimes(1)
})
test.each([[NaN,0],[Infinity,0],[91,0],[0,181],[null,0]])('invalid geo never uploads %s %s',async(lat,lng)=>{
 await expect(createVisitCheckIn(sender() as any,()=>localStorage,'upload-test')({schedule_id:'schedule',photo_blob:blob(),lat,lng})).rejects.toThrow('Lokasi')
 expect(mocks.upload).not.toHaveBeenCalled()
})
