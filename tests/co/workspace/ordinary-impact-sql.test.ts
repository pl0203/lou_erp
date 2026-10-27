// @vitest-environment node
// Source assertions only. Candidate and database fixtures remain unexecuted.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const sql=readFileSync('supabase/candidates/co-workspace-redesign/20261026101000_co_workspace_reads.sql','utf8');
const body=sql.split('CREATE FUNCTION public.pilot_co_preview_labeled_impacts_v1')[1].split('END $$;')[0];
test('R3 ordinary labels reuse exact authorized preview without latest-label substitution or command mutation',()=>{
 for(const pin of ["SECURITY DEFINER SET search_path=''",'private.co_actor_v1()',"fresh->>'customer_id' IS DISTINCT FROM p_customer_id::text","fresh->>'customer_version' IS DISTINCT FROM p_expected_customer_version","fresh->>'preview_fingerprint' IS DISTINCT FROM p_preview_fingerprint",'public.pilot_co_preview_impacts_v1(p_operation,p_payload,p_preview_fingerprint,p_kind,p_page,p_page_size)',"o.version::text=r.value->>'expected_co_version'",'dl.id=b.original_delivery_line_id',"u.id=(r.value->>'sales_person_id_at_creation')::uuid",'k.customer_id=c','dr.co_id=b.co_id'])expect(body).toContain(pin);
 expect(body).not.toMatch(/INSERT INTO|UPDATE private|pilot_co_transaction_v1|current_sales_person|ORDER BY .*updated_at/);
 expect(sql).toContain('REVOKE ALL ON FUNCTION public.pilot_co_preview_labeled_impacts_v1(text,jsonb,uuid,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role');
 expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.pilot_co_preview_labeled_impacts_v1(text,jsonb,uuid,text,text,text,integer,integer) TO authenticated');
});
test('R3 authored ordinary fixtures bind page identities and stale refusal, without claiming database execution',()=>{const fixture=readFileSync('tests/database/co/workspace-reads.sql','utf8');for(const marker of ['ordinary-labels-exact-source-page','ordinary-labels-preserve-exact-impact-identities','ordinary-labels-explicit-unavailable','ordinary-labels-stale-customer-refused','ordinary-labels-stale-fingerprint-refused'])expect(fixture).toContain(marker)});
