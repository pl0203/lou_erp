import {expect,test} from 'vitest';
import {customer,id,store,fingerprint} from './report-ui-harness';
import {fetchCOOrdinaryImpacts} from '../../src/lib/co/workspaceReads';
const binding=()=>({operation:'correct_report',payload:{reason:'Synthetic verified revision'},header:{customer_id:customer,customer_version:'1',preview_fingerprint:fingerprint}});
test('labeled impact fixture preserves full exact paging and explicit identity joins',async()=>{
 const s=store();s.impacts.reopen=Array.from({length:101},(_,i)=>({co_id:id(8000+i),expected_co_version:String(i+1),remaining_quantity:'0',pending_quantity:'1',missing_month_count:'1'}));
 s.impacts.reopen.forEach((r:any,i:number)=>s.impactLabels.set(r.co_id,{coNumber:`CO-${i+1}`}));
 const first=await fetchCOOrdinaryImpacts(binding(),'reopen',1,100),last=await fetchCOOrdinaryImpacts(binding(),'reopen',2,100);
 expect(first.total).toBe('101');expect(first.rows).toHaveLength(100);expect(last.rows).toHaveLength(1);expect(last.rows[0]).toMatchObject({co_id:id(8100),expected_co_version:'101',labels:{coNumber:'CO-101',sku:null,sjNumber:null,picName:null,productName:null}});
 expect(s.commands).toHaveLength(0);
});
test('unmatched identity labels stay null instead of fabricated authority names',async()=>{
 const s=store();s.impacts.reopen=[{co_id:id(8000),expected_co_version:'1',remaining_quantity:'0',pending_quantity:'1',missing_month_count:'1'}];
 expect((await fetchCOOrdinaryImpacts(binding(),'reopen',1,100)).rows[0]).toMatchObject({labels:{coNumber:null,sku:null,productName:null,sjNumber:null,picName:null}});
});
test.each(['customer','version','fingerprint'])('labeled read refuses stale %s binding without mutation',async kind=>{
 const s=store();const b=binding();if(kind==='customer')b.header.customer_id=id(99);if(kind==='version')b.header.customer_version='2';if(kind==='fingerprint')b.header.preview_fingerprint='c'.repeat(64);
 await expect(fetchCOOrdinaryImpacts(b,'reopen',1,100)).rejects.toThrow();expect(s.commands).toHaveLength(0);
});
