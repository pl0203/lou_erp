import { expect,test,vi } from 'vitest'
vi.mock('../src/lib/supabase',()=>({supabase:{}}))
import { computeOutstanding } from '../src/pages/athel/PODetail'
test('voided history remains stored but does not reduce outstanding quantities',()=>{
 const rows:any=[{id:'line',quantity:10}]
 const notes:any=[{id:'active',voided_at:null,sj_line_items:[{po_line_item_id:'line',quantity_delivered:2}]},{id:'void',voided_at:'2026-09-30',sj_line_items:[{po_line_item_id:'line',quantity_delivered:3}]}]
 expect(computeOutstanding(rows,notes)).toEqual({line:8})
 expect(notes).toHaveLength(2)
})
