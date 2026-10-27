// @vitest-environment node
// Source contracts only. These tests cannot establish PostgreSQL acceptance.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const sql = readFileSync('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql', 'utf8')
test('atomic wrapper owns immutable full payload context but no second command envelope', () => {
 const body = sql.split('CREATE FUNCTION public.pilot_co_import_commit_v1')[1]?.split('END $$;')[0]
 expect(body).toBeDefined()
 expect(body).not.toContain('co_command_begin_v1')
 expect(body).toContain('pilot_co_transaction_v1(p_request_id')
 expect(body).toContain('import_payload IS DISTINCT FROM p_payload')
})
test('fresh guards protect both legacy accounting entry points and linked postconditions', () => {
 expect(sql).toContain('co_import_publication_guard_v1')
 expect(sql).toContain("'private.co_monthly_transaction_v1(uuid,text,jsonb)'")
 expect(sql).toContain("'public.pilot_co_transaction_v1(uuid,text,jsonb)'")
 expect(sql).toContain('co_import_postcondition_v1')
})
test('append-only selection lifecycle preserves ever-imported origin and relational return provenance', () => {
 expect(sql).toContain('CREATE TABLE private.co_import_selections')
 expect(sql).toContain('CREATE TABLE private.co_import_return_coverage')
 expect(sql).toContain('CREATE FUNCTION public.pilot_co_import_review_v1')
 expect(sql).toContain('expected_selection_id')
 expect(sql).toContain('FOREIGN KEY(return_line_id,return_revision_id,customer_id,stock_key_id,batch_id)')
})
test('read-only fresh preview and family-specific tombstone recovery are authored', () => {
 const preview = sql.split('CREATE FUNCTION public.pilot_co_import_preview_v1')[1]?.split('END $$;')[0]
 expect(preview).toBeDefined(); expect(preview).not.toMatch(/INSERT INTO|UPDATE private|co_command_begin/)
 expect(sql).toContain('CREATE FUNCTION public.pilot_co_import_reconcile_v1')
 expect(sql).toContain('Import request family mismatch')
})
test('explicit reopen decisions feed the ordinary planner, never derived acceptance', () => {
 const body=sql.split('CREATE FUNCTION private.co_import_fresh_v1')[1].split('END $$;')[0]
 expect(body).toContain("'acknowledged_reopen_orders',acknowledged")
 expect(body).not.toContain("p:=p||jsonb_build_object('acknowledged_reopen_orders',acknowledgements)")
 expect(body).toContain('requiredReopenOrders')
})
test('real authored fixtures assert FIFO, replacement Edit, post-generation rollback and observed barriers', () => {
 const posting=readFileSync('tests/database/co/import-posting.sql','utf8')
 expect(posting).toContain('sum(quantity)=5 AND sum(amount)=600')
 expect(posting).toContain('sum(quantity)=3 AND sum(amount)=300')
 expect(posting).toContain("ERRCODE='PZ601'")
 expect(posting).toContain('before_state=co_test.import_snapshot(c)')
 expect(posting).toContain('multi-row deterministic allocation uses each line capacity once')
 const races=readFileSync('tests/database/co/import-races.mjs','utf8')
 expect(races).toContain('pg_blocking_pids')
 expect(races).toContain("'import exact UUID double click'")
 expect(races).toContain("'import concurrent operators one head'")
 expect(races).toContain("'import abandonment late execution'")
})
test('I1 candidate has one terminal transaction boundary after every security installation', () => {
 const transactions = sql.split('\n').filter(line => /^(BEGIN|COMMIT);\s*$/.test(line))
 expect(transactions).toEqual(['BEGIN;','COMMIT;'])
 expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true)
 expect(sql.lastIndexOf('COMMIT;')).toBeGreaterThan(sql.lastIndexOf('GRANT EXECUTE'))
})
test('I2 imported downstream fixture uses two real imported months and checks rollback after downstream work', () => {
 const fixture=readFileSync('tests/database/co/import-posting.sql','utf8')
 const replay=fixture.split('DO $imported_downstream_replay$')[1]
 expect(replay).toBeDefined()
 expect(replay).toContain('primary_binding')
 expect(replay).toContain('downstream_binding')
 expect(replay).toContain('PZ604')
 expect(replay).toContain('before_state=co_test.import_snapshot(c)')
 expect(replay).toContain('downstream keeps its own original import and evidence')
 expect(replay).toContain('new primary uses newly selected import and evidence')
})
test('F1 authored server reconstructs printed control raw decimals/count/physical coverage independently (not SQL execution)',()=>{const body=sql.split('CREATE FUNCTION private.co_import_validate_review_v1')[1].split('END $$;')[0];expect(body).toContain('Source printed controls required; reselect workbook');expect(body).toContain("FOREACH metric IN ARRAY ARRAY['quantity','returned','amount']");expect(body).toContain("private.co_import_source_number_v1(control->'count')::numeric<>jsonb_array_length(control_rows)");expect(body).toContain('Printed control coverage mismatch');expect(body.indexOf('Printed control % mismatch')).toBeLessThan(body.indexOf("FOR section IN SELECT value FROM jsonb_array_elements(source->'sections')"))});
test('F5 authored impact labels are scoped to checked customer/original source and preserve ack binding (not SQL execution)',()=>{const reads=readFileSync('supabase/candidates/co-workspace-redesign/20261026101000_co_workspace_reads.sql','utf8');const body=reads.split('CREATE FUNCTION public.pilot_co_import_impacts_v1')[1].split('END $$;')[0];expect(body).toContain("fresh->'binding' IS DISTINCT FROM p_binding");expect(body).toContain("o.version::text=r.value->>'expected_co_version'");expect(body).toContain('dl.id=b.original_delivery_line_id');expect(body).toContain('attributed.customer_id=c AND attributed.sales_person_id_at_creation=u.id');expect(body).toContain("'acknowledged_reopen_orders',p_acknowledged_reopen_orders");expect(body).not.toContain('current_sales_person');expect(reads.match(/^BEGIN;/gm)).toHaveLength(1);expect(reads.trim().endsWith('COMMIT;')).toBe(true)});
test('A1 ledger seed extends only exact baseline initialize anchors and preserves server-owned values/audit family (source-only)',()=>{
 const baseline=readFileSync('supabase/migrations/20261009110004_co_returns_corrections.sql','utf8').split('CREATE OR REPLACE FUNCTION private.co_monthly_transaction_v1')[1].split('END $$;')[0];
 const extension=sql.split('DO $legacy_effective_seed$')[1].split('END $legacy_effective_seed$')[0];
 const anchors=[...extension.matchAll(/\$anchor\$([\s\S]*?)\$anchor\$/g)].map(m=>m[1]);expect(anchors).toHaveLength(3);
 for(const anchor of anchors)expect(baseline.split(anchor)).toHaveLength(2);
 const helper=sql.split('CREATE FUNCTION private.co_legacy_seed_metadata_v1')[1].split('END $$;')[0];
 expect(helper).toContain('FOR UPDATE');expect(helper).toContain("h.current_revision_id IS DISTINCT FROM seed");expect(helper).toContain('co_draft_import_origins');expect(helper).toContain('co_report_imports');expect(helper).toContain("d.payload?'source_context'");expect(helper).toContain("'report_reference',r.report_reference");
 expect(extension).toContain('Legacy effective seed anchor drift');expect(extension).toContain('SET sold_quantity=NULL');expect(extension).toContain('DO UPDATE SET sold_quantity=EXCLUDED.sold_quantity');expect(extension).toContain('SET evidence_id=NULL');
 const fixture=readFileSync('tests/database/co/import-posting.sql','utf8');expect(fixture).toContain('full prior draft and lines retained in existing before-image');expect(fixture).toContain('failed seed rolls back lines metadata versions audit and command');expect(fixture).toContain('new eligible key is null not pending88 or invented zero');expect(fixture).toContain('same seed UUID returns original receipt exactly once');
});
test('A3 original committed proof has exact coverage/movement guards and is not a recursive or client capability (source-only)',()=>{
 const proof=sql.split('CREATE FUNCTION private.co_import_prior_return_proof_v1')[1]?.split('END $$;')[0];expect(proof).toBeDefined();
 for(const guard of ['co_report_imports','co_report_revisions','co_import_return_coverage','co_stock_movements','effective_generation_id','current_revision_id','quantity_delta','Prior return coverage ambiguous','Verified recorded-return coverage required'])expect(proof).toContain(guard);
 expect(proof).toContain("decision->>'state'='linked'");expect(proof).toContain('ORDER BY r.created_at,r.id,h.id');expect(proof).not.toContain('co_import_prior_return_proof_v1(');
 const validation=sql.split('CREATE FUNCTION private.co_import_validate_review_v1')[1].split('END $$;')[0];expect(validation).toContain('Exact prior line allocation differs');expect(validation).toContain("IF return_proofs<>'[]'::jsonb");
 const fresh=sql.split('CREATE FUNCTION private.co_import_fresh_v1')[1].split('END $$;')[0];expect(fresh).toContain('Exact-linked business plan differs');expect(fresh).toContain('return_unresolved_prior_coverage_proven');
});
test('A3 real ledger fixtures cover committed witness, combined allocation refusal, stable proof and locked rollback (authored only)',()=>{
 const fixture=readFileSync('tests/database/co/import-posting.sql','utf8');
 for(const assertion of ['proof validation stable after its own commit','explicit linked legacy validation digest unchanged','combined proof and explicit links cannot exceed line capacity','reordered rows cannot silently change exact prior allocation','unposted manifests cannot witness coverage','conflicting original committed coverage refused','late return mutation rolls back original request and all ledger changes','proof-bearing rollback restores full snapshot'])expect(fixture).toContain(assertion);
});
