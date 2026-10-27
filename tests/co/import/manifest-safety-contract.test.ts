// @vitest-environment node
// Source/fixture contracts only. These tests do not execute PostgreSQL or prove
// transactional behavior; the authored SQL assertions require the guarded DB gate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeImportManifest, manifestDigest } from '../../../src/lib/co/import/manifest';
import { input } from './reviewFixture';

const candidate = readFileSync('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql', 'utf8');
const fixture = readFileSync('tests/database/co/import-manifest.sql', 'utf8');
const validator = candidate.split('CREATE FUNCTION private.co_import_validate_review_v1(')[1].split('CREATE FUNCTION private.co_import_binding_v1(')[0];

describe('return safety source contracts (not SQL execution)', () => {
    it('checks explicit uncertainty before excluded-row and zero-return early exits', () => {
        const preExclusion = validator.split("IF mapping->'included'='false'::jsonb THEN")[0];
        expect(preExclusion).toContain("SELECT value INTO decision FROM jsonb_array_elements(input->'returns')");
        expect(preExclusion).toMatch(/IF decision IS NOT NULL AND \(decision->>'state'='unresolved' OR decision->>'stockImpact'='uncertain'\) AND NOT/);
        // A3 only defers the positive included/confirmed unresolved-empty-link
        // case to a private committed-witness proof. Exclusion/null/zero/clear
        // still fail before any early exit; no generic client-clear exception.
        expect(preExclusion).toContain("decision->>'state'='unresolved' AND decision->>'stockImpact'='uncertain' AND decision->'links'='[]'::jsonb AND returned>0 AND mapping->'included'='true'::jsonb AND input->'includedSectionIds'?(row->'ref'->>'section')");
        expect(validator).toContain('proof:=private.co_import_prior_return_proof_v1(m,id,c,month)');
        expect(preExclusion).toContain("returned:=CASE WHEN row->'returned'='null'::jsonb THEN 0 ELSE private.co_import_source_integer_v1(row->'returned') END;");
        expect(preExclusion).toMatch(/IF returned=0 AND decision IS NOT NULL AND \(decision->>'state'<>'none' OR jsonb_array_length\(decision->'links'\)<>0\) THEN RAISE EXCEPTION/);
    });

    it('authors rehashed shape-valid adversarial cases for included and excluded zero/null returns', async () => {
        const tagged = fixture.split('$unsafe_return_cases$');
        expect(tagged).toHaveLength(3);
        const cases = JSON.parse(tagged[1]);
        for (const included of [true, false]) {
            for (const returned of [null, { raw: '0', decimal: '0', convention: 'decimal_dot' }]) {
                for (const [state, stockImpact] of [['none', 'uncertain'], ['unresolved', 'clear'], ['unresolved', 'uncertain']]) {
                    expect(cases).toContainEqual(expect.objectContaining({ included, returned, decision: { rowId: 'r1', state, links: [], stockImpact, note: 'Unresolved synthetic return evidence' } }));
                }
            }
        }
        expect(cases.filter((c: any) => c.returned?.decimal === null && c.decision?.stockImpact === 'clear')).toHaveLength(2);
        const uuid = '11111111-1111-1111-1111-111111111111';
        for (const testCase of cases) {
            const review = input();
            review.scope.actorId = uuid;
            review.scope.customerId = uuid;
            review.mappings[0].stockKeyId = uuid;
            review.mappings[0].included = testCase.included;
            review.mappings[0].exclusionReason = testCase.included ? null : 'Explicit synthetic exclusion';
            review.omittedZeroStockKeyIds = testCase.included ? [] : [uuid];
            review.extracted.sourceRows[0].returned = testCase.returned;
            review.returns = testCase.decision === null ? [] : [testCase.decision];
            const manifest = { schemaVersion: 1, evidenceId: uuid, input: review, digest: 'a'.repeat(64) };
            manifest.digest = await manifestDigest(manifest);
            expect(decodeImportManifest(manifest)).toEqual(manifest);
        }
        const loop = fixture.split('-- Round5 return rejection matrix')[1].split('-- Round5 absent-request recovery')[0];
        expect(loop).toContain("bad:=jsonb_set(bad,'{digest}',to_jsonb(private.co_manifest_digest_v1(bad)))");
        expect(loop).toContain('before_state:=co_test.import_state(c)');
        expect(loop).toContain("'22023',unsafe_case->>'label'");
        expect(loop).toContain('co_test.import_state(c)=before_state');
        expect(loop).toContain('WHERE request_id=attempt_request');
    });
});

describe('lifecycle fixture contracts (not SQL execution)', () => {
    it('authors absent-request abandonment followed by exact blocked late prepare and unchanged state', () => {
        const block = fixture.split('-- Round5 absent-request recovery')[1]?.split('-- Round5 post-draft failure')[0] ?? '';
        expect(block).toContain('pilot_reconcile_co_import_prepare_v1(abandoned_request,false)');
        expect(block).toContain('pilot_reconcile_co_import_prepare_v1(abandoned_request,true)');
        expect(block).toContain("'55000','CO request abandoned'");
        expect(block).toContain('co_test.import_state(c)=before_state');
    });

    it('authors a fixture-only post-draft failure with observed writes and full pre/post comparison', () => {
        const trigger = fixture.split('CREATE FUNCTION co_test.fail_import_after_draft_write()')[1]?.split('DO $prepare_lifecycle$')[0] ?? '';
        expect(trigger).toContain('imported.draft_version=e.finalized_draft_version+1');
        expect(trigger).toContain("imported.validation->'quantities'");
        expect(trigger).toContain("ERRCODE='PZ501'");
        const block = fixture.split('-- Round5 post-draft failure')[1]?.split('result:=public.pilot_co_import_prepare_v1(req,payload)')[0] ?? '';
        expect(block).toContain('CREATE TRIGGER co_test_import_prepare_failure BEFORE INSERT ON private.co_import_prepare_results');
        expect(block).toContain("'PZ501','Synthetic failure after draft mutation'");
        expect(block).toContain('co_test.import_state(c)=before_state');
        expect(block).toContain('DROP TRIGGER co_test_import_prepare_failure ON private.co_import_prepare_results');
        expect(candidate).not.toContain('PZ501');
        expect(candidate).not.toContain('co_test_import_prepare_failure');
    });

    it('authors direct correct_report refusal and real publication-hook downstream inheritance', () => {
        const block = fixture.split('DO $import_publication_guards$')[1]?.split('END $import_publication_guards$')[0] ?? '';
        expect(block).toContain("public.pilot_co_preview_v1('correct_report',correction)");
        expect(block).toContain("'55000','Atomic import commit required'");
        expect(block).toContain('co_test.import_state(c)=before_state');
        expect(block).toContain("public.pilot_co_transaction_v1(gen_random_uuid(),'correct_report',correction");
        expect(block).toContain('replayed_revision<>downstream_revision');
        expect(block).toContain('WHERE report_revision_id=replayed_revision');
        expect(block).toContain('WHERE report_revision_id=downstream_revision');
        expect(block).not.toMatch(/INSERT INTO private\.co_report_imports[^;]*VALUES\(replayed_revision/);
    });
});

describe('manual workbook candidate source contracts ONLY, no SQL runtime claim',()=>{
 it('repeats private receipt validation on prepare and fresh/final publication',()=>{
  expect(candidate).toContain('CREATE TABLE private.co_evidence_manual_workbook_checks');
  expect(candidate).toContain('ALTER TABLE private.co_evidence_manual_workbook_checks ENABLE ROW LEVEL SECURITY');
  expect(candidate).toContain('REVOKE ALL ON private.co_evidence_manual_workbook_checks FROM PUBLIC,anon,authenticated,service_role');
  expect(candidate).toContain("PERFORM private.co_import_manual_receipt_v1(m->'input'->'extracted',e,a)");
  expect(candidate).toContain("PERFORM private.co_import_manual_receipt_v1(m.canonical_json->'input'->'extracted',e,a)");
  const receipt=candidate.split('CREATE FUNCTION private.co_import_manual_receipt_v1(')[1].split('END $$;')[0];
  expect(receipt).toContain('receipt.evidence_id IS NULL');expect(receipt).toContain('receipt.object_version');expect(receipt).toContain('receipt.verified_by');expect(receipt).toContain('receipt.customer_id');expect(receipt).toContain("receipt.facts IS DISTINCT FROM source->'manualWorkbook'");
 });
 it('retains v7 automatic controls and refuses null covered manual metrics before SUM',()=>{
  expect(validator).toContain("source->>'parserVersion' IN('co-guarded-xlsx-6','co-guarded-xlsx-7') AND");
  const manual=validator.split('-- Partial manual controls')[1].split('FOR section IN')[0];expect(manual).toContain("r->metric IS NULL OR r->metric='null'::jsonb");expect(manual).toContain("private.co_import_source_number_v1(control->metric,false)");expect(manual).not.toContain('includedSectionIds');
 });
});
