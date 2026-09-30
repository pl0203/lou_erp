import { expect, test, vi } from 'vitest'
const mock=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:mock.rpc}}))
import { createTransactionSender } from '../src/lib/orderTransactions'
test('retries ambiguous committed response with same request ID, then allows intentional new order',async()=>{
 const send=createTransactionSender();const calls:any[]=[]
 mock.rpc.mockImplementation(async(_name,args)=>{calls.push(args);return calls.length===1?{data:null,error:{message:'response lost'}}:{data:{id:'saved'},error:null}})
 await expect(send('create_po',{po_number:'PO-1'})).rejects.toThrow('response lost')
 expect(await send('create_po',{po_number:'PO-1'})).toEqual({id:'saved'})
 expect(calls[0].p_request_id).toBe(calls[1].p_request_id)
 await send('create_po',{po_number:'PO-1'})
 expect(calls[2].p_request_id).not.toBe(calls[1].p_request_id)
})
test('changing payload after a rejected attempt uses a new request ID',async()=>{
 const send=createTransactionSender();const calls:any[]=[]
 mock.rpc.mockImplementation(async(_name,args)=>{calls.push(args);return {data:null,error:{code:'22023',message:'bad input'}}})
 await expect(send('create_po',{notes:'old'})).rejects.toThrow()
 await expect(send('create_po',{notes:'corrected'})).rejects.toThrow()
 expect(calls[0].p_request_id).not.toBe(calls[1].p_request_id)
})
test('missing migration produces a compatibility error with no legacy fallback',async()=>{
 const send=createTransactionSender();mock.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'missing'}})
 await expect(send('create_po',{})).rejects.toThrow('Pembaruan database')
 expect(mock.rpc).toHaveBeenCalledWith('pilot_order_transaction',expect.any(Object))
})

test('unknown outcome blocks a changed payload instead of making a duplicate',async()=>{
 const send=createTransactionSender();mock.rpc.mockResolvedValue({data:null,error:{message:'response lost'}})
 await expect(send('create_po',{notes:'old'})).rejects.toThrow('response lost')
 mock.rpc.mockClear()
 await expect(send('create_po',{notes:'changed'})).rejects.toThrow('belum terkonfirmasi')
 expect(mock.rpc).not.toHaveBeenCalled()
})
test('same request can recover after form remount without persisting order contents',async()=>{
 localStorage.clear();const args:any[]=[]
 mock.rpc.mockImplementation(async(_name,arg)=>{args.push(arg);return args.length===1?{data:null,error:{message:'response lost'}}:{data:{id:'saved'},error:null}})
 const options={storage:()=>localStorage,storageKey:'test-recovery'}
 await expect(createTransactionSender(options)('submit_sales',{notes:'private order note'})).rejects.toThrow()
 expect(localStorage.getItem('test-recovery')).not.toContain('private order note')
 await createTransactionSender(options)('submit_sales',{notes:'private order note'})
 expect(args[1].p_request_id).toBe(args[0].p_request_id)
 expect(localStorage.getItem('test-recovery')).toBeNull()
})

test('committed recovery cannot create a duplicate from unchanged old form',async()=>{
 const send=createTransactionSender();let writes=0
 mock.rpc.mockImplementation(async(name)=>name==='pilot_reconcile_request'?{data:{state:'committed',operation:'submit_sales',result:{id:'saved'}},error:null}:(writes++,{data:null,error:{message:'lost response'}}))
 await expect(send('submit_sales',{items:['same']})).rejects.toThrow()
 await send.reconcile()
 expect(await send('submit_sales',{items:['same']})).toEqual({id:'saved'})
 expect(writes).toBe(1)
})
test('connection and statement-completion-unknown SQL states remain unresolved',async()=>{
 for(const code of ['08006','40003']){
  const send=createTransactionSender();mock.rpc.mockResolvedValue({data:null,error:{code,message:'unknown outcome'}})
  await expect(send('create_po',{a:1})).rejects.toThrow()
  await expect(send('create_po',{a:2})).rejects.toThrow('belum terkonfirmasi')
 }
})
