// @vitest-environment node
// Authored SQL source/fixture contracts only, not PostgreSQL execution evidence.
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
const sql=readFileSync('supabase/candidates/co-workspace-redesign/20261026101000_co_workspace_reads.sql','utf8');
const body=sql.split('CREATE FUNCTION public.pilot_co_report_source_proposal_v1')[1]?.split('END $$;')[0];
test('source proposal read is authorized, current, exact and nonmutating, not a public context-link promise',()=>{
 expect(body).toContain('SECURITY DEFINER SET search_path=\'\'');expect(body).toContain('private.co_read_lock_v1(p_customer_id,p_expected_customer_version)');expect(body).toContain('d.version::text<>p_expected_draft_version');expect(body).toContain("d.payload?'posted_report_head_id'");expect(body).toContain('private.co_source_proposal_v1(p_customer_id');expect(body).toContain("IS DISTINCT FROM context->>'source_context_fingerprint'");expect(body).toContain("primary_owner:=proposal->'primary'");expect(body).not.toContain('co_read_context_link_v1');expect(body).not.toMatch(/INSERT INTO|UPDATE private|pilot_co_transaction_v1|jsonb_set/);
 expect(sql).toContain('REVOKE ALL ON FUNCTION public.pilot_co_report_source_proposal_v1(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role');expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.pilot_co_report_source_proposal_v1(uuid,text,uuid,text,text) TO authenticated');
});
test('report primary bounds relational draft lines and retains import-origin publication guard',()=>{
 expect(body).toContain('private.co_report_draft_lines');expect(body).toContain('private.co_draft_import_origins');expect(body).toContain("source_draft.kind='report'");expect(body).toContain('1000');expect(body).toContain('1048576');
});
test('actual authored command fixtures cover exact source reconstruction and actor/consumption/stale refusal',()=>{
 const fixtures=readFileSync('tests/database/co/workspace-reads.sql','utf8');
 for(const marker of ['source_proposal_exact','source-proposal-current-actor','source-proposal-other-actor','source-proposal-consumed','source-proposal-stale-draft','source-proposal-reason-byte-exact','source-proposal-report-primary','source-proposal-return-primary'])expect(fixtures).toContain(marker);
});
