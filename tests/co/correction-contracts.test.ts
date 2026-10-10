// @vitest-environment node
import ts from 'typescript'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

test('reviewed corrections bind original revisions, stored inputs and exact acknowledgement sets', () => {
 const name = resolve('tests/co/correction-contract-fixture.ts')
 const source = `
 import type { COCorrectReportPayload, COCorrectSJPayload, COSaveReturnDraftPayload, COReviewedPostSJPayload, COReportInitialize, COPreview, COCommand, Version } from '../../src/lib/co/contracts'
 const v = '1' as Version
 const report: COCorrectReportPayload = { report_head_id:'h', original_revision_id:'r', expected_report_version:v, expected_customer_version:v, draft_id:'d', expected_draft_version:v, eligible_set_fingerprint:'e', reason:'Fix', completed_report_drafts:[], acknowledged_reopen_orders:[], preview_fingerprint:'p' }
 const command: COCommand = { operation:'correct_report', payload:report }
 const delivery: COCorrectSJPayload = { delivery_head_id:'h', original_revision_id:'r', expected_delivery_version:v, expected_co_version:v, expected_customer_version:v, action:'void', reason:'Fix', completed_report_drafts:[], acknowledged_reopen_orders:[], preview_fingerprint:'p' }
 const ret: COSaveReturnDraftPayload = { customer_id:'c', expected_customer_version:v, return_date:'2026-09-01', reference:'R', lines:[{batch_id:'b',quantity:2}] }
 // @ts-expect-error Original effective revision is mandatory
 const noOriginal: COCorrectReportPayload = { report_head_id:'h', expected_report_version:v, expected_customer_version:v, draft_id:'d', expected_draft_version:v, eligible_set_fingerprint:'e', reason:'Fix', completed_report_drafts:[], acknowledged_reopen_orders:[], preview_fingerprint:'p' }
 // @ts-expect-error Replacement delivery uses a version-bound prepared draft
 const noDraft: COCorrectSJPayload = { ...delivery, action:'replace' }
 // @ts-expect-error Source selection cannot be client revenue or credit
 const forged: COSaveReturnDraftPayload = { ...ret, revenue:'0.00' }
 const initialize: COReportInitialize = { action:'initialize',customer_id:'c',report_month:'2026-08-01',expected_customer_version:v,source_context:{operation:'correct_sj',payload:{delivery_head_id:'h',original_revision_id:'r',expected_delivery_version:v,expected_co_version:v,expected_customer_version:v,action:'void',reason:'Fix'},source_context_fingerprint:'f'} }
 declare const preview: COPreview
 const fp: string|undefined = preview.source_context_fingerprint
 `
 const options: ts.CompilerOptions = { noEmit:true,strict:true,skipLibCheck:true,target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler }
 const host=ts.createCompilerHost(options); const get=host.getSourceFile.bind(host)
 host.getSourceFile=(file,version,error,fresh)=>file===name?ts.createSourceFile(file,source,version,true):get(file,version,error,fresh)
 expect(ts.getPreEmitDiagnostics(ts.createProgram([name],options,host)).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n'))).toEqual([])
})
