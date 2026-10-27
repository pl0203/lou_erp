import {expect,test,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as api from '../../../src/lib/co/import/rpc'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../../src/lib/supabase',()=>({supabase:{rpc}}))
const id='11111111-1111-1111-1111-111111111111',newKey='22222222-2222-2222-2222-222222222222'
const context={draftId:id,draftVersion:'4',customerId:id,customerVersion:'2',reportMonth:'2026-10-01',selectionId:id}
const response={version:'1',as_of:'2026-10-26T00:00:00Z',page:1,page_size:100,total:'1',rows:[{id:newKey,stock_key_id:newKey,customer_id:id,report_month:'2026-10-01',display_sku:'NEW',product_name:'New eligible stock',product_id:null,sold_quantity:null,eligible_quantity:'5',revision_line_id:null}],customer_id:id,customer_version:'2',report_month:'2026-10-01',view:'draft',generation_id:null,source_context_link:null,draft_id:id,draft_version:'4',revision_id:null,eligible_set_fingerprint:'a'.repeat(64),source_context_fingerprint:null,context_issue:null,selection_id:id}
test('new authoritative eligibility read includes new stock keys without fabricating zero sales',async()=>{
 expect(api).toHaveProperty('readImportEligible');rpc.mockResolvedValue({data:response,error:null})
 const r=await (api as any).readImportEligible(context,1,{isCurrent:()=>true})
 expect(r.rows[0].stock_key_id).toBe(newKey);expect(r.rows[0].sold_quantity).toBeNull()
 expect(rpc).toHaveBeenCalledWith('pilot_co_import_eligible_v1',{p_draft_id:id,p_expected_draft_version:'4',p_expected_customer_version:'2',p_expected_selection_id:id,p_page:1,p_page_size:100})
})
test.each([{...response,selection_id:null},{...response,draft_version:'5'},{...response,customer_version:'3'}])('rejects stale selection/draft/customer response %#',async data=>{
 expect(api).toHaveProperty('readImportEligible');rpc.mockResolvedValue({data,error:null});await expect((api as any).readImportEligible(context,1,{})).rejects.toThrow()
})
test('candidate read derives current eligible context under exact locks/selection and never writes (source only)',()=>{
 const sql=readFileSync('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql','utf8')
 expect(sql).toContain('CREATE FUNCTION public.pilot_co_import_eligible_v1')
 const body=sql.split('CREATE FUNCTION public.pilot_co_import_eligible_v1')[1].split('END $$;')[0]
 expect(body.indexOf('private.co_actor_v1()')).toBeLessThan(body.indexOf('SELECT * INTO d'))
 expect(body).toContain('private.co_read_lock_v1');expect(body).toContain('IS DISTINCT FROM p_expected_selection_id')
 expect(body).toContain('private.co_report_context_v1');expect(body).toContain("context->'eligible_rows'")
 expect(body).toContain('LEFT JOIN private.co_report_draft_lines');expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/)
 expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.pilot_co_import_eligible_v1(uuid,text,text,uuid,integer,integer) TO authenticated;')
 expect(sql.trim().endsWith('COMMIT;')).toBe(true)
})
test('paged eligible snapshot rejects a changed fingerprint despite unchanged draft/customer versions',async()=>{
 const rows=Array.from({length:100},(_,i)=>({...response.rows[0],id:`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,stock_key_id:`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`}))
 rpc.mockResolvedValueOnce({data:{...response,total:'101',rows},error:null}).mockResolvedValueOnce({data:{...response,page:2,total:'101',eligible_set_fingerprint:'b'.repeat(64)},error:null})
 await expect(api.readAllImportEligible(context,{})).rejects.toThrow('changed eligible snapshot')
})
test('initial null selection is explicit and stale owner sends no eligible read',async()=>{
 rpc.mockReset().mockResolvedValue({data:{...response,selection_id:null},error:null})
 await api.readImportEligible({...context,selectionId:null},1,{isCurrent:()=>true})
 expect(rpc.mock.calls[0][1].p_expected_selection_id).toBeNull()
 rpc.mockClear();await expect(api.readImportEligible(context,1,{isCurrent:()=>false})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled()
})
