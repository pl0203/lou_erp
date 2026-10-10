// @vitest-environment node
import ts from 'typescript'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

// Removing a binding, permitting client allocations, or losing the discriminant
// must fail these actual compiler diagnostics (Vitest alone erases TS types).
test('report commands require versioned stored drafts and exclude client allocations', () => {
  const name = resolve('tests/co/report-contract-fixture.ts')
  const source = `
    import type { COSaveReportDraftPayload, COPostReportPayload, COPreview, COReportImpact, COCommand, Version } from '../../src/lib/co/contracts'
    const v = '1' as Version
    const initialize: COSaveReportDraftPayload = { action: 'initialize', customer_id: 'c', report_month: '2026-09-01', expected_customer_version: v }
    const refresh: COSaveReportDraftPayload = { ...initialize, draft_id: 'd', expected_draft_version: v }
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
