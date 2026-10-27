// @vitest-environment node
import ts from 'typescript'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

// Removing a binding, permitting client allocations, or losing the discriminant
// must fail these actual compiler diagnostics (Vitest alone erases TS types).
test('report commands require versioned stored drafts and exclude client allocations', () => {
  const name = resolve('tests/co/report-contract-fixture.ts')
  const source = `
    import type { COSaveReportDraftPayload, COPostReportPayload, COPreview, COReportImpact, COCommand, Version, COSourceContext } from '../../src/lib/co/contracts'
    const v = '1' as Version
    const initialize: COSaveReportDraftPayload = { action: 'initialize', customer_id: 'c', report_month: '2026-09-01', expected_customer_version: v }
    const refresh: COSaveReportDraftPayload = { ...initialize, draft_id: 'd', expected_draft_version: v }
    const seed: COSaveReportDraftPayload = { action: 'initialize', customer_id: 'c', report_month: '2026-09-01', expected_customer_version: v, draft_id: 'd', expected_draft_version: v, seed_effective_revision_id: 'revision' }
    declare const sourceContext: COSourceContext
    // @ts-expect-error Ledger seed cannot claim a source context
    const mixed: COSaveReportDraftPayload = { ...seed, source_context: sourceContext }
    const chunk: COSaveReportDraftPayload = { action: 'upsert_lines', draft_id: 'd', expected_draft_version: v, expected_customer_version: v, eligible_set_fingerprint: 'f', lines: [{ stock_key_id: 'k', sold_quantity: null }] }
    const metadata: COSaveReportDraftPayload = { action: 'set_metadata', draft_id: 'd', expected_draft_version: v, expected_customer_version: v, received_date: null }
    const post: COPostReportPayload = { draft_id: 'd', expected_draft_version: v, expected_customer_version: v, eligible_set_fingerprint: 'f', preview_fingerprint: 'p' }
    const command: COCommand = { operation: 'post_report', payload: post }
    // @ts-expect-error Refresh cannot omit draft version
    const badRefresh: COSaveReportDraftPayload = { ...initialize, draft_id: 'd' }
    // @ts-expect-error Stored statement, never a client whole-statement post
    const badPost: COPostReportPayload = { ...post, lines: [] }
    // @ts-expect-error Metadata requires a field to update
    const emptyMetadata: COSaveReportDraftPayload = { action: 'set_metadata', draft_id: 'd', expected_draft_version: v, expected_customer_version: v }
    // @ts-expect-error Fingerprint required on row changes
    const staleChunk: COSaveReportDraftPayload = { action: 'fill_remaining_zero', draft_id: 'd', expected_draft_version: v, expected_customer_version: v }
    declare const preview: COPreview
    declare const report: COReportImpact
    const periodQuantity: string = report.after_sold_quantity
    const periodRevenue: string = report.after_revenue
    const count: string = preview.counts.stock
    const revenue: string = preview.after.revenue
    // @ts-expect-error Header is bounded; detail must be paginated
    preview.allocations
  `
  const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === name ? ts.createSourceFile(file, source, languageVersion, true) : original(file, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([name], options, host)
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
})

test.each(['effective','revision'] as const)('recorded %s row reads cannot carry contradictory draft/source identity',async view=>{
 const {decodeCORead}=await import('../../src/lib/co/validation');
 const c='00000000-0000-0000-0000-000000000002',r='00000000-0000-0000-0000-000000000005',k='00000000-0000-0000-0000-000000001001';
 const args={p_customer_id:c,p_month:'2026-09-01',p_view:view,p_revision_id:view==='revision'?r:null,p_expected_draft_version:null,p_expected_customer_version:'1',p_page:1,p_page_size:100};
 const data={version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:c,customer_version:'1',report_month:'2026-09-01',view,generation_id:null,source_context_link:null,draft_id:null,draft_version:null,revision_id:r,eligible_set_fingerprint:null,source_context_fingerprint:null,context_issue:null,page:1,page_size:100,total:'1',rows:[{id:k,stock_key_id:k,customer_id:c,report_month:'2026-09-01',display_sku:'SKU',product_name:'Item',product_id:null,sold_quantity:'0',eligible_quantity:'10',revision_line_id:null}]};
 expect(decodeCORead('pilot_co_report_rows_v1',args,data)).toEqual(data);
 for(const patch of [{draft_id:k,draft_version:'1'},{revision_id:null},{eligible_set_fingerprint:'a'.repeat(64)},{source_context_fingerprint:'a'.repeat(64)},{source_context_link:{operation:'correct_report',target_id:r,draft_id:k,original_revision_id:r,expected_source_version:'1',expected_co_version:null,expected_customer_version:'1',expected_draft_version:'1'}},{context_issue:'CO_ELIGIBLE_SET_STALE'}])expect(()=>decodeCORead('pilot_co_report_rows_v1',args,{...data,...patch})).toThrow();
});
