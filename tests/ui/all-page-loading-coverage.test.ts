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
test('all original loading guards and the reviewed calendar additions retain exact predicates', () => {
  const { result } = consumers()
  const identity = result.filter(row => row.file === 'src/pages/athel/Promotions.tsx' && row.title === 'Memuat identitas…')
  expect(identity).toEqual([{ file: 'src/pages/athel/Promotions.tsx', title: 'Memuat identitas…', guards: ['if !actorKey', 'loading ? true'] }])
  const rest = result.filter(row => !identity.includes(row))
  const sorted = (rows: Guard[]) => rows.map(row => JSON.stringify(row)).sort()
  expect(original).toHaveLength(102)
  // Keep the e484 fixture immutable. The separately reviewed SJ feature shares
  // received/returned date state; the Week/Month calendar renames range to period.
  const oldDate = original.filter(row => row.file === 'src/pages/athel/PODetail.tsx' && row.title === 'Memuat SJ dan versi PO terbaru…')
  expect(oldDate).toEqual([{ file: 'src/pages/athel/PODetail.tsx', title: 'Memuat SJ dan versi PO terbaru…', guards: ['returnedTarget &&', "returnedReview?.status === 'loading' &&"] }])
  const oldCalendar = original.filter(row => row.file === 'src/pages/ihr/leave/TeamLeaveCalendar.tsx' && row.title === 'Memuat kalender...')
  expect(oldCalendar).toEqual([{ file: 'src/pages/ihr/leave/TeamLeaveCalendar.tsx', title: 'Memuat kalender...', guards: ["readState==='pending'||access.isFetching ? false", "readState==='error'||access.isError ? false", '!access.available ? false', '!access.data?.calendarAudiences.length ? false', '!authorized ? false', '!range ? false', 'calendar.isFetching||calendar.isPending ? true'] }])
  const expected = original.map(row => oldDate.includes(row) ? { ...row, guards: ['dateTarget &&', "dateReview?.status === 'loading' &&"] } : oldCalendar.includes(row) ? { ...row, guards: row.guards.map(guard => guard === '!range ? false' ? '!period ? false' : guard) } : row)
  // The new continuation editor has two explicit authority/loading boundaries.
  // Enumerate them rather than excluding the component from global coverage.
  expected.push(
    { file: 'src/pages/ihr/leave/LeaveRosterContinuations.tsx', title: 'Memeriksa akses perpanjangan roster...', guards: ['if !authorityReady'] },
    { file: 'src/pages/ihr/leave/LeaveRosterContinuations.tsx', title: 'Memuat perpanjangan kelompok...', guards: ['if !query.available', 'query.isError||!query.isFetching ? false'] },
  )
  expect(sorted(rest)).toEqual(sorted(expected))
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
  expect(paths).toHaveLength(38)
  expect(documented).toEqual(paths)
  expect(document).toContain('Native browser visual/accessibility/device QA is NOT RUN')
  expect(document).toContain('Existing quiet reads are deliberately not turned into new blocking branches')
})
