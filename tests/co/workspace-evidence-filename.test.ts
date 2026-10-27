// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
const sql=readFileSync('supabase/candidates/co-workspace-redesign/20261026101000_co_workspace_reads.sql','utf8')
const source=sql.split('CREATE FUNCTION public.pilot_co_report_import_v1(')[1].split('END $$;')[0]
test('revision source filename uses canonical evidence metadata, not a nonexistent table column',()=>{
 expect(source.includes("SELECT e.id,private.co_evidence_json_v1(e)->>'filename' INTO selected_evidence,filename")).toBe(true)
 expect(source).not.toContain('e.filename')
 expect(source).toContain("'source_filename',filename")
 expect(source).toContain('e.id=l.evidence_id AND e.customer_id=l.customer_id WHERE l.report_revision_id=r.id AND l.report_head_id=h.id AND l.customer_id=p_customer_id')
 expect(source).toContain('PERFORM private.co_read_customer_v1(p_customer_id)')
 expect(source).toContain('m.evidence_id IS DISTINCT FROM selected_evidence')
})
test('report-list evidence uses the same canonical filename and no nonexistent filename columns remain',()=>{
 const list=sql.split('CREATE FUNCTION public.pilot_co_reports_page_v2(')[1].split('END $$;')[0]
 expect(list.includes("r.created_at updated_at,private.co_evidence_json_v1(e)->>'filename' source_filename")).toBe(true)
 expect(sql).not.toMatch(/\be\.filename\b/)
 expect(list).toContain('LEFT JOIN private.co_evidence e ON e.id=l.evidence_id AND e.customer_id=h.customer_id')
 expect(list).toContain("'source_filename',s.source_filename")
 expect(list).toContain("'historical_pending',NULL::uuid,NULL::uuid,true,d.updated_at,NULL::text")
})
