// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { expect, test } from 'vitest'

type Guard = { file: string; title: string; guards: string[] }
// Captured from exact pre-polish e484 source, not inferred from the new UI.
const original: Guard[] = JSON.parse(readFileSync('tests/ui/fixtures/all-page-loading-guards.json', 'utf8'))
// Restored unchanged from the independently reviewed employee recovery packet.
// Provenance and intentionally unresolved later deltas: docs/loading-coverage-reconciliation.md.
const originalHash='5c99104f6ce0c648ec921fcf84647325852b181296fad56881a05762a20003f7'
const continuityOwners=[
  "src/pages/ihr/leave/AssignedApprovalInbox.tsx",
  "src/pages/ihr/leave/DirectorLeaveOverview.tsx",
  "src/pages/ihr/leave/LeaveAdminPrivatePanel.tsx",
  "src/pages/ihr/leave/LeaveAdminRotaPanel.tsx",
  "src/pages/ihr/leave/LeaveAdminSettings.tsx",
  "src/pages/ihr/leave/LeaveBalanceSettings.tsx",
  "src/pages/ihr/leave/LeavePeopleSettings.tsx",
  "src/pages/ihr/leave/LeaveRotaSettings.tsx",
  "src/pages/ihr/leave/MyLeave.tsx",
  "src/pages/ihr/leave/OwnLeaveHistory.tsx",
  "src/pages/ihr/leave/OwnRequestActions.tsx",
  "src/pages/ihr/leave/TeamLeaveCalendar.tsx"
]
const continuityHash='b561c84420e69a17025e99b092e063dad46a46b319d697cdbaff6bbf15812b02'
type Continuity={approval:string;updates:{file:string;before:Guard[];after:Guard[]}[];added:Guard[]}
const identity=(rows:Guard[])=>rows.map(row=>JSON.stringify(row)).sort()
function decodedContinuity(bytes:string):Continuity{
 expect(createHash('sha256').update(bytes).digest('hex'),'immutable reviewed continuity overlay').toBe(continuityHash)
 return JSON.parse(bytes)
}
function withContinuity(baseline:Guard[],expected:Guard[],overlay:Continuity):Guard[]{
 expect(overlay.updates).toHaveLength(12)
 expect(new Set(overlay.updates.map(update=>update.file)).size).toBe(12)
 expect(overlay.updates.map(update=>update.file).sort()).toEqual([...continuityOwners].sort())
 const result=expected.map(row=>({...row}))
 for(const update of overlay.updates){
  expect(update.file.startsWith('src/pages/ihr/leave/')).toBe(true)
  expect(identity(baseline.filter(row=>row.file===update.file)),'exact mapped original guards').toEqual(identity(update.before))
  expect(update.after.every(row=>row.file===update.file)).toBe(true)
  const indices=result.map((row,index)=>row.file===update.file?index:-1).filter(index=>index>=0)
  expect(indices,'no missing or extra mapped guards').toHaveLength(update.after.length)
  indices.forEach((index,offset)=>{result[index]=update.after[offset]})
 }
 expect(overlay.added).toHaveLength(2)
 expect(overlay.added.every(row=>row.file==='src/pages/ihr/employees/EmployeeUI.tsx')).toBe(true)
 return [...result,...overlay.added]
}
const continuity=decodedContinuity(readFileSync('tests/ui/fixtures/hr-continuity-loading-guards.json','utf8'))
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
function consumers(tag = 'LoadingState') {
  const result: Guard[] = [], invalidParents: string[] = []
  for (const file of files('src')) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    visit(source, node => {
      if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      if (opening.tagName.getText(source) !== tag) return
      const title = opening.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(source) === 'title')?.initializer
      if(tag === 'LoadingState') expect(title, file).toBeTruthy()
      result.push({ file, title: tag === 'SessionLoading' ? 'Memeriksa sesi…' : ts.isStringLiteral(title!) ? title!.text : title!.getText(source), guards: guards(node, source) })
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
test('immutable baseline plus finite reviewed overlays detects any current coverage drift', () => {
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
  expect(sorted(rest)).toEqual(sorted(withMonthlySource(withReviewedCO(withAuthTransition(withContinuity(original,expected,continuity)),reviewedCO),monthlySource)))
})
test('block loading surfaces never nest in inline/table controls or duplicate a live status region', () => {
  expect(consumers().invalidParents).toEqual([])
})
test('browser allowlist includes the new loading source and binds every current input exactly', () => {
  const manifest = JSON.parse(readFileSync('tests/catalogue-browser/source-manifest.json', 'utf8'))
  assertReviewedManifest(manifest) // Validate finite paths before reading any manifest input.
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
  const document = readFileSync('docs/current-loading-route-inventory.md', 'utf8')
  const documented = [...document.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]).sort()
  assertCurrentRouteInventory(paths,documented)
  expect(document).toContain('Native browser visual/accessibility/device QA is NOT RUN')
  expect(document).toContain('Existing quiet reads are deliberately not turned into new blocking branches')
})


test('historical loading baseline bytes remain immutable',()=>{
 expect(createHash('sha256').update(readFileSync('tests/ui/fixtures/all-page-loading-guards.json')).digest('hex')).toBe(originalHash)
})
test('approved HR and employee surfaces retain exact mapped predicates',()=>{
 const expected=withContinuity(original,original,continuity)
 const files=new Set([...continuity.updates.map(update=>update.file),'src/pages/ihr/employees/EmployeeUI.tsx'])
 expect(identity(consumers().result.filter(row=>files.has(row.file)))).toEqual(identity(expected.filter(row=>files.has(row.file))))
})
test('public continuity metadata preserves all reviewed guard rows without private identifiers',()=>{
 expect(continuity.approval).not.toMatch(/Sentinel_|conversation|room[-_]id/i)
 expect(createHash('sha256').update(JSON.stringify({updates:continuity.updates,added:continuity.added})).digest('hex')).toBe('abe07e0ca81c5a29a99049750896ed4159baf05e4346cdfc14acd99e6b78b469')
})
test('tampered or incomplete continuity overlay is rejected rather than repinned',()=>{
 const bytes=readFileSync('tests/ui/fixtures/hr-continuity-loading-guards.json','utf8')
 expect(()=>decodedContinuity(bytes.replace('!shown','shown'))).toThrow()
 const changed=JSON.parse(bytes);changed.updates[0].after[0].guards=[]
 expect(()=>decodedContinuity(JSON.stringify(changed))).toThrow()
 const missing=JSON.parse(bytes);missing.updates.pop()
 expect(()=>decodedContinuity(JSON.stringify(missing))).toThrow()
})
test('missing original guard and unmapped extra substitutions fail closed',()=>{
 const missing=original.filter(row=>row!==original.find(row=>row.file===continuity.updates[0].file))
 expect(()=>withContinuity(missing,missing,continuity)).toThrow()
 const duplicate=structuredClone(continuity);duplicate.updates[1]=duplicate.updates[0]
 expect(()=>withContinuity(original,original,duplicate)).toThrow()
 const unmapped=structuredClone(continuity);unmapped.updates[0].file='src/pages/ihr/leave/Unreviewed.tsx'
 expect(()=>withContinuity(original,original,unmapped)).toThrow()
 const extra=structuredClone(continuity);extra.updates.push({...extra.updates[0],file:'src/unreviewed.tsx'})
 expect(()=>withContinuity(original,original,extra)).toThrow()
})
test('current predicate weakening, missing surfaces and new unmapped surfaces are detectable',()=>{
 const expected=withContinuity(original,original,continuity)
 const tampered=structuredClone(expected);tampered.find(row=>row.file===continuity.updates[0].file)!.guards=[]
 expect(()=>expect(identity(tampered)).toEqual(identity(expected))).toThrow()
 expect(()=>expect(identity(expected.slice(1))).toEqual(identity(expected))).toThrow()
 expect(()=>expect(identity([...expected,{file:'src/unreviewed.tsx',title:'Unmapped',guards:[]}])).toEqual(identity(expected))).toThrow()
})


test('historical motion route inventory remains distinct from current coverage', () => {
  const historical=readFileSync('docs/all-page-motion-coverage.md','utf8')
  const paths=[...historical.matchAll(/^\| `([^`]+)` \|/gm)].map(match=>match[1])
  expect(paths).toHaveLength(38)
  expect(new Set(paths).size).toBe(38)
  expect(historical).toContain('102 original eligible loading branches')
})

function assertCurrentRouteInventory(paths:string[],documented:string[]){
  expect(paths).toHaveLength(44)
  expect(new Set(paths).size).toBe(44)
  expect(documented).toHaveLength(44)
  expect(new Set(documented).size).toBe(44)
  expect([...documented].sort()).toEqual([...paths].sort())
}
test('current route inventory rejects omissions, duplicate substitutions and unregistered additions',()=>{
  const document=readFileSync('docs/current-loading-route-inventory.md','utf8')
  const paths=[...document.matchAll(/^\| `([^`]+)` \|/gm)].map(match=>match[1])
  expect(()=>assertCurrentRouteInventory(paths,paths.slice(1))).toThrow()
  expect(()=>assertCurrentRouteInventory(paths,[paths[0],...paths.slice(0,-1)])).toThrow()
  expect(()=>assertCurrentRouteInventory(paths,['/unreviewed-route',...paths.slice(1)])).toThrow()
})

// Finite approved Oct26 session transition; never regenerate the historical fixture.
// Request/receipt provenance and live verification limits are in current route documentation.
const oldAuth:Guard[]=[
 {file:'src/App.tsx',title:'Memuat...',guards:['if loading']},
 {file:'src/components/ProtectedRoute.tsx',title:'Loading...',guards:['if loading']},
 {file:'src/pages/Login.tsx',title:'Memuat...',guards:['if loading']},
]
const sessionAuth:Guard[]=[
 {file:'src/App.tsx',title:'Memeriksa sesi…',guards:["if loading && !matchPath('/login', pathname)"]},
 {file:'src/components/ProtectedRoute.tsx',title:'Memeriksa sesi…',guards:['if loading']},
 {file:'src/pages/Login.tsx',title:'Memeriksa sesi…',guards:['if loading && !attemptedLogin.current']},
]
function withAuthTransition(rows:Guard[]){
 const owners=new Set(oldAuth.map(row=>row.file))
 expect(identity(rows.filter(row=>owners.has(row.file))),'exact original auth guards required').toEqual(identity(oldAuth))
 return rows.filter(row=>!owners.has(row.file))
}
function assertSessionGuards(rows:Guard[]){expect(identity(rows),'exact finite session consumer guards').toEqual(identity(sessionAuth))}
test('approved compact auth transition retains exact private and public pending guards',()=>{
 assertSessionGuards(consumers('SessionLoading').result)
 expect(consumers('SessionLoading').invalidParents).toEqual([])
 const source=readFileSync('src/components/SessionLoading.tsx','utf8')
 expect(source).toContain('Memeriksa sesi…')
 expect(source).toContain('role="status"')
 expect(source).toContain('aria-live="polite"')
})
test('auth overlay rejects missing original guards, missing or extra consumers and unsafe pending predicates',()=>{
 expect(()=>withAuthTransition(original.filter(row=>row.file!=='src/App.tsx'))).toThrow()
 expect(()=>assertSessionGuards(sessionAuth.slice(1))).toThrow()
 expect(()=>assertSessionGuards([...sessionAuth,{file:'src/unreviewed.tsx',title:'Memeriksa sesi…',guards:[]}])).toThrow()
 const weakened=structuredClone(sessionAuth);weakened[1].guards=[]
 expect(()=>assertSessionGuards(weakened)).toThrow()
 const publicLeak=structuredClone(sessionAuth);publicLeak[0].guards=['if false']
 expect(()=>assertSessionGuards(publicLeak)).toThrow()
})

// Seven explicitly reviewed owners only; other monthly/source-proposal deltas stay red.
const coOwners=['src/components/co/COChangePreview.tsx','src/components/co/COLegacyReportEdit.tsx','src/components/co/CORecordedReportTable.tsx','src/components/co/COReportRevisionEvidence.tsx','src/components/co/COStockHistory.tsx','src/components/co/COStockTable.tsx','src/pages/athel/co/COCustomerStock.tsx']
const coOverlayHash='e2b09f641c3be8ee163ae55f2c0f720bab773e997f589d8394c1a5716c95c6d9'
type COOverlay={source:string;contract:string;updates:{file:string;before:Guard[];after:Guard[]}[]}
function decodedCO(bytes:string):COOverlay{expect(createHash('sha256').update(bytes).digest('hex')).toBe(coOverlayHash);return JSON.parse(bytes)}
const reviewedCO=decodedCO(readFileSync('tests/ui/fixtures/co-reviewed-loading-guards.json','utf8'))
function withReviewedCO(rows:Guard[],overlay:COOverlay){
 expect(overlay.updates.map(u=>u.file).sort()).toEqual([...coOwners].sort())
 expect(new Set(overlay.updates.map(u=>u.file)).size).toBe(7)
 expect(overlay.updates.reduce((n,u)=>n+u.before.length,0)).toBe(5)
 expect(overlay.updates.reduce((n,u)=>n+u.after.length,0)).toBe(11)
 const owners=new Set(coOwners)
 for(const update of overlay.updates){
  expect(identity(rows.filter(r=>r.file===update.file))).toEqual(identity(update.before))
  expect(update.after.every(r=>r.file===update.file)).toBe(true)
 }
 return [...rows.filter(r=>!owners.has(r.file)),...overlay.updates.flatMap(u=>u.after)]
}
test('seven reviewed CO owners retain exact finite loading contracts',()=>{
 const expected=withReviewedCO(original,reviewedCO),owners=new Set(coOwners)
 expect(identity(consumers().result.filter(r=>owners.has(r.file)))).toEqual(identity(expected.filter(r=>owners.has(r.file))))
})
test('reviewed CO overlay rejects tamper, missing originals, duplicate and extra owners',()=>{
 const bytes=readFileSync('tests/ui/fixtures/co-reviewed-loading-guards.json','utf8')
 expect(()=>decodedCO(bytes.replace('!read.data || read.isFetching','!read.data'))).toThrow()
 const missing=original.filter(r=>r.file!==coOwners[0]);expect(()=>withReviewedCO(missing,reviewedCO)).toThrow()
 const duplicate=structuredClone(reviewedCO);duplicate.updates[1]=duplicate.updates[0];expect(()=>withReviewedCO(original,duplicate)).toThrow()
 const extra=structuredClone(reviewedCO);extra.updates.push({file:'src/unreviewed.tsx',before:[],after:[]});expect(()=>withReviewedCO(original,extra)).toThrow()
 const changed=structuredClone(reviewedCO);changed.updates[0].after[0].guards=[];expect(()=>decodedCO(JSON.stringify(changed))).toThrow()
})
test('reviewed CO surface contract rejects missing, extra and weakened current guards',()=>{
 const expected=withReviewedCO(original,reviewedCO).filter(r=>coOwners.includes(r.file))
 const check=(rows:Guard[])=>expect(identity(rows)).toEqual(identity(expected))
 expect(()=>check(expected.slice(1))).toThrow()
 expect(()=>check([...expected,{file:coOwners[0],title:'Unreviewed',guards:[]}])).toThrow()
 const weak=structuredClone(expected);weak[0].guards=[];expect(()=>check(weak)).toThrow()
})

// Current byte bindings retain five historical changes plus a separate two-file status transition.
// Historical manifest bytes come from e95; filename60bb38a labels its stale metadata, not its containing commit.
// public_source_head identifies their base provenance, not a future release commit.
type BrowserManifest={version:number;repository:string;public_source_head:string;files:{path:string;sha:string;sha256:string;bytes:number}[]}
const historicalManifestBytes=readFileSync('tests/ui/fixtures/catalogue-browser-manifest-60bb38a.json')
const historicalManifest:BrowserManifest=JSON.parse(historicalManifestBytes.toString())
const manifestFive:Record<string,{sha:string;sha256:string;bytes:number}>={
  "src/components/ui/Dialog.tsx": {
    "sha": "4b5823f004ec0e5e48194d7fb20a56981d81ca7e",
    "sha256": "0affccb652c69a3ee49e42edb16d0f342ccefbd8689fe28d1bc985d5b5963aa2",
    "bytes": 5400
  },
  "src/index.css": {
    "sha": "fbdc921e811cd043e9e638f8fa8a8487283a4945",
    "sha256": "4602dfaa82ad6454343c5c6b54425a0ca9946a349f5cfc0cfd6b42c9957d8729",
    "bytes": 2649
  },
  "src/styles/ui.css": {
    "sha": "82f1c51bef3ee30e6e34012c2e5eb2d220831aa8",
    "sha256": "22998a397ad2bedcc65159479044702791b9afcf8ed78c40ec44f24d90424ef0",
    "bytes": 15276
  },
  "package.json": {
    "sha": "6e86317036cbb9d47c53c5bc4997f3be46dcd595",
    "sha256": "ed2e2787df9b98df2f6734c64aa955d3a8f838cf39a77cde7f2500357174a702",
    "bytes": 1297
  },
  "package-lock.json": {
    "sha": "1ffcc624b57a9eef5ca835575fd5fb09c06816e9",
    "sha256": "01599e3bfe88c61a9069b4b983d4dea2924bc82cbc1e26ac692470f425168eb3",
    "bytes": 234771
  }
}
// Reviewed status-success transition (public runtime commit a1308c2): automatically
// verify canonical status and acknowledge a validated receipt; never derive rows
// from receipts or resend commands. Failed reads, stale actors/versions and failed
// lock release retain recovery. page-integration.test.ts covers these boundaries.
// Preserve the frozen historical manifest and its five earlier transitions.
const manifestStatus:Record<string,{sha:string;sha256:string;bytes:number}>={
  'src/lib/catalogue/useCataloguePage.ts': {
    sha:'cd265c5d865a80ad89b4caff4daca6126e8cc11a',
    sha256:'fddcf3a00c6959ab543aad4de740fe8366f478465b56175484ef91c27e432f1a',
    bytes:13125
  },
  'src/components/catalogue/CatalogueStatusActions.tsx': {
    sha:'9f7950e32095372440b959ebe5019caf3ca3f8ef',
    sha256:'49cf8aca5cf109624b1fcc21020365cd4e601bcbcfead87b02f08ba3d69707ea',
    bytes:6146
  }
}
function assertReviewedManifest(candidate:BrowserManifest){
 expect(historicalManifest.files).toHaveLength(36)
 expect(new Set(historicalManifest.files.map(f=>f.path)).size).toBe(36)
 expect(Object.keys(manifestFive).sort()).toEqual(['src/components/ui/Dialog.tsx','src/index.css','src/styles/ui.css','package.json','package-lock.json'].sort())
 expect(Object.keys(manifestStatus).sort()).toEqual(['src/lib/catalogue/useCataloguePage.ts','src/components/catalogue/CatalogueStatusActions.tsx'].sort())
 expect(Object.keys(manifestStatus).some(path=>Object.hasOwn(manifestFive,path))).toBe(false)
 const reviewed={...manifestFive,...manifestStatus}
 const expected={...historicalManifest,public_source_head:'e95bdaff33b9fcb8cd18114f364e23198c290ba3',files:historicalManifest.files.map(file=>({...file,...reviewed[file.path]}))}
 expect(candidate).toEqual(expected)
 expect(candidate.files.filter(f=>!reviewed[f.path])).toEqual(historicalManifest.files.filter(f=>!reviewed[f.path]))
 expect(candidate.files.filter(f=>!reviewed[f.path])).toHaveLength(29)
}
test('browser manifest keeps immutable36entry provenance and five historical plus two status updates',()=>{
 expect(createHash('sha256').update(historicalManifestBytes).digest('hex')).toBe('5cb3165b593300b6f7cad6c4fd0b3d98219d46e9d03fff5f3232432df5a68007')
 assertReviewedManifest(JSON.parse(readFileSync('tests/catalogue-browser/source-manifest.json','utf8')))
})
test('browser manifest rejects missing, duplicate, malicious and extra input paths before file access',()=>{
 const valid=JSON.parse(readFileSync('tests/catalogue-browser/source-manifest.json','utf8'))
 const missing=structuredClone(valid);missing.files.pop();expect(()=>assertReviewedManifest(missing)).toThrow()
 const duplicate=structuredClone(valid);duplicate.files[1]=duplicate.files[0];expect(()=>assertReviewedManifest(duplicate)).toThrow()
 const malicious=structuredClone(valid);malicious.files[0].path='src/../../.env';expect(()=>assertReviewedManifest(malicious)).toThrow()
 const extra=structuredClone(valid);extra.files.push({...extra.files[0],path:'src/unreviewed.tsx'});expect(()=>assertReviewedManifest(extra)).toThrow()
})
test('browser status transition rejects stale, partial, or altered bindings',()=>{
 const valid=JSON.parse(readFileSync('tests/catalogue-browser/source-manifest.json','utf8'))
 for(const path of Object.keys(manifestStatus)){
  const stale=structuredClone(valid)
  stale.files[stale.files.findIndex((f:{path:string})=>f.path===path)]=historicalManifest.files.find(f=>f.path===path)
  expect(()=>assertReviewedManifest(stale)).toThrow()
  for(const key of ['sha','sha256','bytes']){
   const altered=structuredClone(valid),entry=altered.files.find((f:{path:string})=>f.path===path)
   entry[key]=key==='bytes'?entry.bytes+1:'0'.repeat(key==='sha'?40:64)
   expect(()=>assertReviewedManifest(altered)).toThrow()
  }
 }
})
test('browser manifest rejects changed reviewed or unchanged entry hashes and false release provenance',()=>{
 const valid=JSON.parse(readFileSync('tests/catalogue-browser/source-manifest.json','utf8'))
 for(const path of ['package-lock.json','src/pages/athel/CustomerList.tsx']){
  const changed=structuredClone(valid);changed.files.find((f:{path:string})=>f.path===path).sha256='0'.repeat(64)
  expect(()=>assertReviewedManifest(changed)).toThrow()
 }
 const changed=structuredClone(valid);changed.public_source_head='0'.repeat(40);expect(()=>assertReviewedManifest(changed)).toThrow()
})

// Separately reviewed final two owners. Never derive expected guards from current source at test time.
const monthlyOwners=['src/pages/athel/co/COMonthlyReport.tsx','src/components/co/COSourceProposalResume.tsx'];
const monthlyHash='201391ce1cc18564a6ce01c511c729633e80c71ff7e3400b0ebfb566ed04eafd';
function decodeMonthly(bytes:string):COOverlay{expect(createHash('sha256').update(bytes).digest('hex')).toBe(monthlyHash);return JSON.parse(bytes)}
const monthlySource=decodeMonthly(readFileSync('tests/ui/fixtures/monthly-source-loading-guards.json','utf8'));
function withMonthlySource(rows:Guard[],overlay:COOverlay){
 expect(overlay.updates.map(u=>u.file)).toEqual(monthlyOwners);
 expect(overlay.updates.map(u=>[u.before.length,u.after.length])).toEqual([[1,6],[0,4]]);
 for(const update of overlay.updates){
  expect(identity(rows.filter(r=>r.file===update.file))).toEqual(identity(update.before));
  expect(update.after.every(r=>r.file===update.file)).toBe(true);
 }
 return [...rows.filter(r=>!monthlyOwners.includes(r.file)),...overlay.updates.flatMap(u=>u.after)];
}
test('monthly and source proposal finite transitions reject tamper, missing originals and extra owners',()=>{
 const bytes=readFileSync('tests/ui/fixtures/monthly-source-loading-guards.json','utf8');
 expect(()=>decodeMonthly(bytes.replace('!read.data&&!retained.current','!read.data'))).toThrow();
 expect(()=>withMonthlySource(original.filter(r=>r.file!==monthlyOwners[0]),monthlySource)).toThrow();
 const missing=structuredClone(monthlySource);missing.updates.pop();expect(()=>withMonthlySource(original,missing)).toThrow();
 const extra=structuredClone(monthlySource);extra.updates.push(extra.updates[0]);expect(()=>withMonthlySource(original,extra)).toThrow();
 const foreign=structuredClone(monthlySource);foreign.updates[0].after[0].file='src/unreviewed.tsx';expect(()=>withMonthlySource(original,foreign)).toThrow();
});
test('monthly and source proposal surfaces reject missing, extra and weakened loading predicates',()=>{
 const expected=withMonthlySource(original,monthlySource).filter(r=>monthlyOwners.includes(r.file));
 const check=(rows:Guard[])=>expect(identity(rows)).toEqual(identity(expected));
 check(consumers().result.filter(r=>monthlyOwners.includes(r.file)));
 expect(()=>check(expected.slice(1))).toThrow();
 expect(()=>check([...expected,{file:monthlyOwners[0],title:'Unreviewed',guards:[]}])).toThrow();
 for(let i=0;i<expected.length;i++){const unsafe=structuredClone(expected);unsafe[i].guards=[];expect(()=>check(unsafe)).toThrow();}
});
