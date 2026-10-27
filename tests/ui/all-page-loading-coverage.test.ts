// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { expect, test } from 'vitest'

type Guard = { file: string; title: string; guards: string[] }
// Captured from exact pre-polish e484 source, not inferred from the new UI.
const original: Guard[] = JSON.parse(readFileSync('tests/ui/fixtures/all-page-loading-guards.json', 'utf8'))
function files(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.tsx') ? [join(directory, entry.name)] : []) }
function visit(node: ts.Node, action: (node: ts.Node) => void) { action(node); ts.forEachChild(node, child => visit(child, action)) }
function guards(node: ts.Node, source: ts.SourceFile) {
  const result: string[] = []
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isConditionalExpression(p)) result.push(p.condition.getText(source) + ' ? ' + (node.pos >= p.whenTrue.pos && node.end <= p.whenTrue.end ? 'true' : 'false'))
    if (ts.isIfStatement(p)) result.push('if ' + p.expression.getText(source))
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && node.pos >= p.right.pos) result.push(p.left.getText(source) + ' &&')
  }
  return result.reverse()
}
function consumers() {
  const result: Guard[] = [], invalidParents: string[] = []
  for (const file of files('src')) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    visit(source, node => {
      if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      if (opening.tagName.getText(source) !== 'LoadingState') return
      const title = opening.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(source) === 'title')?.initializer
      expect(title, file).toBeTruthy()
      result.push({ file, title: ts.isStringLiteral(title!) ? title!.text : title!.getText(source), guards: guards(node, source) })
      for (let p = node.parent; p; p = p.parent) if (ts.isJsxElement(p)) {
        const tag = p.openingElement.tagName.getText(source)
        if (['p', 'span', 'button', 'tbody', 'tr', 'select'].includes(tag)) invalidParents.push(file + ':' + tag)
        const role = p.openingElement.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(source) === 'role')?.initializer
        if (role && ts.isStringLiteral(role) && role.text === 'status') invalidParents.push(file + ':nested status')
      }
    })
  }
  return { result, invalidParents }
}
test('immutable 102-branch baseline plus explicitly approved SJ, HR continuity and employee surfaces retain exact predicates', () => {
  const { result } = consumers()
  const identity = result.filter(row => row.file === 'src/pages/athel/Promotions.tsx' && row.title === 'Memuat identitas…')
  expect(identity).toEqual([{ file: 'src/pages/athel/Promotions.tsx', title: 'Memuat identitas…', guards: ['if !actorKey', 'loading ? true'] }])
  const rest = result.filter(row => !identity.includes(row))
  const sorted = (rows: Guard[]) => rows.map(row => JSON.stringify(row)).sort()
  expect(original).toHaveLength(102)
  // Keep the e484 fixture immutable. The separately reviewed SJ feature shares
  // received/returned date state; only this one exact presentation guard changes.
  const oldDate = original.filter(row => row.file === 'src/pages/athel/PODetail.tsx' && row.title === 'Memuat SJ dan versi PO terbaru…')
  expect(oldDate).toEqual([{ file: 'src/pages/athel/PODetail.tsx', title: 'Memuat SJ dan versi PO terbaru…', guards: ['returnedTarget &&', "returnedReview?.status === 'loading' &&"] }])
  const expected = original.map(row => oldDate.includes(row) ? { ...row, guards: ['dateTarget &&', "dateReview?.status === 'loading' &&"] } : row)
  // Approval and recovery provenance: docs/employee-fields-recovery/harness-recovery.md.
  // This is a separate, finite reviewed delta, never regeneration of old pins.
  const continuity = JSON.parse(readFileSync('tests/ui/fixtures/hr-continuity-loading-guards.json', 'utf8')) as { updates: { file: string; before: Guard[]; after: Guard[] }[]; added: Guard[] }
  expect(continuity.updates).toHaveLength(12)
  for (const update of continuity.updates) {
    expect(update.file.startsWith('src/pages/ihr/leave/')).toBe(true)
    expect(sorted(original.filter(row => row.file === update.file))).toEqual(sorted(update.before))
    expect(update.after.every(row => row.file === update.file)).toBe(true)
    const indices = expected.map((row, index) => row.file === update.file ? index : -1).filter(index => index >= 0)
    expect(indices).toHaveLength(update.after.length)
    indices.forEach((index, offset) => { expected[index] = update.after[offset] })
  }
  expect(continuity.added).toHaveLength(2)
  expect(continuity.added.every(row => row.file === 'src/pages/ihr/employees/EmployeeUI.tsx')).toBe(true)
  // Approved authentication presentation replaces exactly these three generic
  // skeletons. Existing authorization branches are covered by live flow tests.
  const authFiles = ['src/App.tsx', 'src/pages/Login.tsx', 'src/components/ProtectedRoute.tsx']
  expect(expected.filter(row => authFiles.includes(row.file))).toHaveLength(3)
  // Reviewed finite CO presentation delta; never regenerate the immutable102 baseline.
  const co = JSON.parse(readFileSync('tests/ui/fixtures/co-workspace-loading-guards.json','utf8')) as { updates:{file:string;before:Guard[];after:Guard[]}[] }
  expect(co.updates.map(update=>update.file).sort()).toEqual([
    'src/components/co/COReportRevisionEvidence.tsx','src/components/co/CORecordedReportTable.tsx',
    'src/components/co/COStockHistory.tsx','src/components/co/COStockTable.tsx',
    'src/pages/athel/co/COCustomerStock.tsx','src/pages/athel/co/COMonthlyReport.tsx',
  ].sort())
  for(const update of co.updates){
    expect(sorted(original.filter(row=>row.file===update.file))).toEqual(sorted(update.before))
    expect(update.after.every(row=>row.file===update.file)).toBe(true)
  }
  // F5 adds exactly one checked reopen-identity loading branch; prior pins stay immutable.
  const finalFix=JSON.parse(readFileSync('tests/ui/fixtures/co-final-fix-loading-guards.json','utf8')) as {added:Guard[]};
  expect(finalFix.added).toEqual([{file:'src/components/co/COChangePreview.tsx',title:'Memeriksa identitas pesanan terdampak…',guards:['needsReopen &&','reopen.isError ? false','!reopen.data ? true']}]);
  // Reviewed remaining A1/A4 adds exactly six complete source predicates; all prior fixtures stay immutable.
  const remaining=JSON.parse(readFileSync('tests/ui/fixtures/co-remaining-loading-guards.json','utf8')) as {added:Guard[]};
  expect(remaining.added).toEqual([
    {file:'src/components/co/COLegacyReportEdit.tsx',title:'Memuat dasar Edit…',guards:['if !work.accepted']},
    {file:'src/components/co/COLegacyReportEdit.tsx',title:'Memuat semua nilai laporan tercatat…',guards:['!canonical.data&&!canonical.isError&&pinned &&']},
    {file:'src/components/co/COSourceProposalResume.tsx',title:'Memeriksa usulan sumber asli…',guards:['active ? false']},
    {file:'src/components/co/COSourceProposalResume.tsx',title:'Memeriksa usulan sumber asli…',guards:['if !read.data&&!retained.current']},
    {file:'src/components/co/COSourceProposalResume.tsx',title:'Memuat sumber retur…',guards:['if !stock.data&&!retainedVersion.current']},
    {file:'src/components/co/COSourceProposalResume.tsx',title:'Memuat sumber laporan…',guards:['if !work.accepted']},
  ]);
  // Reviewed modal-shell correction: preserve all earlier fixture pins and
  // explicitly add the blocked-parent branch while retaining history guards.
  const modalFile='src/components/co/COStockHistory.tsx';
  expect(co.updates.find(update=>update.file===modalFile)?.after).toEqual([
    {file:modalFile,title:'Memuat riwayat stok…',guards:['read.isError ? false','!read.data || read.isFetching ? true']},
  ]);
  const modalAfter:Guard[]=[
    {file:modalFile,title:'Memuat riwayat stok…',guards:['blocked ? true']},
    {file:modalFile,title:'Memuat riwayat stok…',guards:['blocked ? false','read.isError ? false','!read.data || read.isFetching ? true']},
  ];
  const coFiles=new Set(co.updates.map(update=>update.file))
  expect(sorted(rest)).toEqual(sorted([
    ...expected.filter(row=>!authFiles.includes(row.file)&&!coFiles.has(row.file)),
    ...continuity.added,...co.updates.flatMap(update=>update.file===modalFile?modalAfter:update.after),...finalFix.added,...remaining.added,
  ]))
})
test('block loading surfaces never nest in inline/table controls or duplicate a live status region', () => {
  expect(consumers().invalidParents).toEqual([])
})
test('browser allowlist includes the new loading source and binds every current input exactly', () => {
  const manifest = JSON.parse(readFileSync('tests/catalogue-browser/source-manifest.json', 'utf8'))
  expect(manifest.files.map((f: { path: string }) => f.path)).toContain('src/components/ui/LoadingState.tsx')
  for (const file of manifest.files) {
    const bytes = readFileSync(file.path)
    expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.path).toBe(file.sha)
    expect(createHash('sha256').update(bytes).digest('hex'), file.path).toBe(file.sha256)
    expect(bytes.length, file.path).toBe(file.bytes)
  }
})

test('review inventory covers every registered page exactly once and explains static exceptions', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  const titles = app.slice(app.indexOf('const routeTitles:'), app.indexOf('export default function App'))
  const paths = [...titles.matchAll(/\['([^']+)'\s*,/g)].map(match => match[1]).sort()
  const document = readFileSync('docs/all-page-motion-coverage.md', 'utf8')
  const documented = [...document.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]).sort()
  expect(paths).toHaveLength(44)
  expect(documented).toEqual(paths)
  expect(document).toContain('Native browser visual/accessibility/device QA is NOT RUN')
  expect(document).toContain('Existing quiet reads are deliberately not turned into new blocking branches')
})
