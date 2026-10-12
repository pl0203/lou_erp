import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import ts from 'typescript'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// Only leaf screens are inert. App, ProtectedRoute, roleHome and the CO layout
// remain production code. This proves outer routing, not private-data access.
const auth = vi.hoisted(() => ({
  user: { id: 'route-actor' } as { id: string } | null,
  profile: { id: 'route-actor', role: 'sales_person', is_active: true, full_name: 'Synthetic operator' } as { id: string; role: string; is_active: boolean; full_name: string } | null,
  loading: false, error: null, signOut: vi.fn(),
}))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => <nav aria-label="Synthetic Procurement navigation" /> }))
vi.mock('../../src/pages/Login', () => ({ default: () => <p data-testid="route-leaf">Login</p> }))
vi.mock('../../src/pages/ForgotPassword', () => ({ default: () => <p data-testid="route-leaf">ForgotPassword</p> }))
vi.mock('../../src/pages/ResetPassword', () => ({ default: () => <p data-testid="route-leaf">ResetPassword</p> }))
vi.mock('../../src/pages/Landing', () => ({ default: () => <p data-testid="route-leaf">Landing</p> }))
vi.mock('../../src/pages/athel/Dashboard', () => ({ default: () => <p data-testid="route-leaf">AthelDashboard</p> }))
vi.mock('../../src/pages/athel/POList', () => ({ default: () => <p data-testid="route-leaf">POList</p> }))
vi.mock('../../src/pages/athel/PONew', () => ({ default: () => <p data-testid="route-leaf">PONew</p> }))
vi.mock('../../src/pages/athel/PODetail', () => ({ default: () => <p data-testid="route-leaf">PODetail</p> }))
vi.mock('../../src/pages/athel/POEdit', () => ({ default: () => <p data-testid="route-leaf">POEdit</p> }))
vi.mock('../../src/pages/athel/CustomerList', () => ({ default: () => <p data-testid="route-leaf">CustomerList</p> }))
vi.mock('../../src/pages/athel/ProductList', () => ({ default: () => <p data-testid="route-leaf">ProductList</p> }))
vi.mock('../../src/pages/athel/SalesOrders', () => ({ default: () => <p data-testid="route-leaf">SalesOrders</p> }))
vi.mock('../../src/pages/athel/Promotions', () => ({ default: () => <p data-testid="route-leaf">AthelPromotions</p> }))
vi.mock('../../src/pages/athel/co/COOrders', () => ({ default: () => <p data-testid="route-leaf">COOrders</p> }))
vi.mock('../../src/pages/athel/co/COForm', () => ({ default: ({ mode }: { mode: string }) => <p data-testid="route-leaf">COForm:{mode}</p> }))
vi.mock('../../src/pages/athel/co/CODetail', () => ({ default: () => <p data-testid="route-leaf">CODetail</p> }))
vi.mock('../../src/pages/athel/co/COMonthlyReports', () => ({ default: () => <p data-testid="route-leaf">COMonthlyReports</p> }))
vi.mock('../../src/pages/athel/co/COMonthlyReport', () => ({ default: () => <p data-testid="route-leaf">COMonthlyReport</p> }))
vi.mock('../../src/pages/athel/co/COCustomerStock', () => ({ default: () => <p data-testid="route-leaf">COCustomerStock</p> }))
vi.mock('../../src/pages/girard/DailySchedule', () => ({ default: () => <p data-testid="route-leaf">DailySchedule</p> }))
vi.mock('../../src/pages/girard/ManagerSchedule', () => ({ default: () => <p data-testid="route-leaf">ManagerSchedule</p> }))
vi.mock('../../src/pages/girard/VisitRequests', () => ({ default: () => <p data-testid="route-leaf">VisitRequests</p> }))
vi.mock('../../src/pages/girard/OwnVisitHistory', () => ({ default: () => <p data-testid="route-leaf">OwnVisitHistory</p> }))
vi.mock('../../src/pages/girard/VisitPage', () => ({ default: () => <p data-testid="route-leaf">VisitPage</p> }))
vi.mock('../../src/pages/girard/GirardCustomerDetail', () => ({ default: () => <p data-testid="route-leaf">GirardCustomerDetail</p> }))
vi.mock('../../src/pages/girard/OutletDetail', () => ({ default: () => <p data-testid="route-leaf">OutletDetail</p> }))
vi.mock('../../src/pages/girard/MySalesSummary', () => ({ default: () => <p data-testid="route-leaf">MySalesSummary</p> }))
vi.mock('../../src/pages/girard/MyOrders', () => ({ default: () => <p data-testid="route-leaf">MyOrders</p> }))
vi.mock('../../src/pages/girard/Promotions', () => ({ default: () => <p data-testid="route-leaf">Promotions</p> }))
vi.mock('../../src/pages/girard/MyVisits', () => ({ default: () => <p data-testid="route-leaf">MyVisits</p> }))
vi.mock('../../src/pages/girard/GirardTeam', () => ({ default: () => <p data-testid="route-leaf">GirardTeam</p> }))
vi.mock('../../src/pages/girard/GirardDashboard', () => ({ default: () => <p data-testid="route-leaf">GirardDashboard</p> }))
vi.mock('../../src/pages/girard/ManagerCustomers', () => ({ default: () => <p data-testid="route-leaf">ManagerCustomers</p> }))
vi.mock('../../src/pages/girard/GirardCustomers', () => ({ default: () => <p data-testid="route-leaf">GirardCustomers</p> }))
vi.mock('../../src/pages/girard/GirardManagers', () => ({ default: () => <p data-testid="route-leaf">GirardManagers</p> }))
vi.mock('../../src/pages/ihr/UserManagement', () => ({ default: () => <p data-testid="route-leaf">UserManagement</p> }))
vi.mock('../../src/pages/ihr/LeaveManagement', () => ({ default: () => <p data-testid="route-leaf">LeaveManagement</p> }))

import App from '../../src/App'
import { roleHome } from '../../src/components/navigationModules'

const ROLES = ['sales_person', 'sales_manager', 'sales_head', 'executive', 'po_admin', 'co_admin'] as const
type Role = typeof ROLES[number]
const E: Role[] = ['executive'], PO: Role[] = ['po_admin', 'executive'], CO: Role[] = ['co_admin', 'executive']
const MASTER: Role[] = ['po_admin', 'co_admin', 'executive']
const SALES: Role[] = ['sales_person', 'sales_manager', 'sales_head', 'executive']
const MANAGERS: Role[] = ['sales_manager', 'sales_head', 'executive'], HEADS: Role[] = ['sales_head', 'executive']
type Page = { path: string; roles: readonly Role[] | null; leaf: string }
// Fixed approved specification, independent of App's implementation constants.
const PAGES: Page[] = [
  { path: '/login', roles: null, leaf: 'Login' },
  { path: '/forgot-password', roles: null, leaf: 'ForgotPassword' },
  { path: '/reset-password', roles: null, leaf: 'ResetPassword' },
  { path: '/landing', roles: E, leaf: 'Landing' },
  { path: '/athel/dashboard', roles: E, leaf: 'AthelDashboard' },
  { path: '/athel/po', roles: PO, leaf: 'POList' },
  { path: '/athel/po/new', roles: PO, leaf: 'PONew' },
  { path: '/athel/po/:id', roles: PO, leaf: 'PODetail' },
  { path: '/athel/po/:id/edit', roles: PO, leaf: 'POEdit' },
  { path: '/athel/customers', roles: MASTER, leaf: 'CustomerList' },
  { path: '/athel/products', roles: MASTER, leaf: 'ProductList' },
  { path: '/athel/sales-orders', roles: E, leaf: 'SalesOrders' },
  { path: '/athel/promotions', roles: E, leaf: 'AthelPromotions' },
  { path: '/athel/co', roles: CO, leaf: 'COOrders' },
  { path: '/athel/co/new', roles: CO, leaf: 'COForm:create' },
  { path: '/athel/co/:id', roles: CO, leaf: 'CODetail' },
  { path: '/athel/co/:id/edit', roles: CO, leaf: 'COForm:edit' },
  { path: '/athel/co/reports', roles: CO, leaf: 'COMonthlyReports' },
  { path: '/athel/co/reports/:customerId/:month', roles: CO, leaf: 'COMonthlyReport' },
  { path: '/athel/co/stock/*', roles: CO, leaf: 'COCustomerStock' },
  { path: '/girard/schedule', roles: SALES, leaf: 'schedule' },
  { path: '/girard/visit-requests', roles: SALES, leaf: 'VisitRequests' },
  { path: '/girard/visit-history', roles: SALES, leaf: 'OwnVisitHistory' },
  { path: '/girard/visit/:scheduleId', roles: SALES, leaf: 'VisitPage' },
  { path: '/girard/customer/:id', roles: SALES, leaf: 'GirardCustomerDetail' },
  { path: '/girard/outlet/:id', roles: SALES, leaf: 'OutletDetail' },
  { path: '/girard/my-sales', roles: ['sales_person'], leaf: 'MySalesSummary' },
  { path: '/girard/my-orders', roles: SALES, leaf: 'MyOrders' },
  { path: '/girard/promotions', roles: SALES, leaf: 'Promotions' },
  { path: '/girard/my-visits', roles: MANAGERS, leaf: 'MyVisits' },
  { path: '/girard/team', roles: MANAGERS, leaf: 'GirardTeam' },
  { path: '/girard/dashboard', roles: MANAGERS, leaf: 'GirardDashboard' },
  { path: '/girard/my-customers', roles: MANAGERS, leaf: 'ManagerCustomers' },
  { path: '/girard/customers', roles: HEADS, leaf: 'GirardCustomers' },
  { path: '/girard/managers', roles: HEADS, leaf: 'GirardManagers' },
  { path: '/ihr/users', roles: E, leaf: 'UserManagement' },
  { path: '/ihr/leave', roles: ROLES, leaf: 'LeaveManagement' },
]

beforeEach(() => {
  auth.user = { id: 'route-actor' }
  auth.profile = { id: 'route-actor', role: 'sales_person', is_active: true, full_name: 'Synthetic operator' }
  auth.loading = false
})
afterEach(cleanup)
function LocationProbe() { return <output data-testid="route-location">{useLocation().pathname}</output> }
function actualPath(pattern: string) {
  return pattern.replace(':customerId', 'synthetic-customer').replace(':scheduleId', 'synthetic-schedule').replace(':month', '2026-10').replace(':id', 'synthetic-record').replace('*', 'synthetic-stock')
}
function mount(path: string) { return render(<MemoryRouter initialEntries={[path]}><App /><LocationProbe /></MemoryRouter>) }
function expectedLeaf(page: Page, role: Role) { return page.leaf === 'schedule' ? role === 'sales_person' ? 'DailySchedule' : 'ManagerSchedule' : page.leaf }

for (const page of PAGES) {
  test.each(ROLES)(`${page.path} retains approved outer access for %s`, role => {
    auth.profile!.role = role
    const path = actualPath(page.path)
    mount(path)
    const allowed = page.roles === null || page.roles.includes(role)
    const destination = allowed ? path : roleHome(role)
    expect(screen.getByTestId('route-location').textContent).toBe(destination)
    const destinationPage = allowed ? page : PAGES.find(candidate => candidate.path === destination)!
    expect(screen.getByTestId('route-leaf').textContent).toBe(expectedLeaf(destinationPage, role))
  })
}

for (const boundary of ['signed out', 'missing profile', 'inactive profile', 'different profile identity']) {
  test.each(PAGES.filter(page => page.roles !== null))(`${boundary} cannot mount $path`, page => {
    if (boundary === 'signed out') auth.user = null
    if (boundary === 'missing profile') auth.profile = null
    if (boundary === 'inactive profile') auth.profile!.is_active = false
    if (boundary === 'different profile identity') auth.profile!.id = 'different-actor'
    mount(actualPath(page.path))
    expect(screen.getByTestId('route-location').textContent, page.path).toBe('/login')
    expect(screen.getByTestId('route-leaf').textContent, page.path).toBe('Login')
  })
}
test('public outer routes remain available without an authenticated profile', () => {
  auth.user = null; auth.profile = null
  for (const page of PAGES.filter(page => page.roles === null)) {
    mount(page.path)
    expect(screen.getByTestId('route-leaf').textContent).toBe(page.leaf)
    cleanup()
  }
})
test.each(ROLES)('%s keeps the existing role home', role => {
  expect(roleHome(role)).toBe({ sales_person: '/girard/schedule', sales_manager: '/girard/schedule', sales_head: '/girard/schedule', executive: '/landing', po_admin: '/athel/po', co_admin: '/athel/co' }[role])
})
test.each(MANAGERS)('personal own-visits document title matches its scope for %s', role => {
  auth.profile!.role = role
  mount('/girard/my-visits')
  expect(screen.getByTestId('route-leaf').textContent).toBe('MyVisits')
  expect(document.title).toBe('Kunjungan saya | Padiwan')
})
test.each(['/', '/unmatched-synthetic-route'])('%s still redirects to login outside the 37-page inventory', path => {
  mount(path)
  expect(screen.getByTestId('route-location').textContent).toBe('/login')
  expect(screen.getByTestId('route-leaf').textContent).toBe('Login')
})
test('App loading intercepts protected routes before their fallback or leaf can mount', () => {
  auth.loading = true; mount('/athel/co/synthetic-record')
  expect(screen.queryByTestId('route-leaf')).toBeNull()
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByText('Loading...', { exact: true })).toBeNull()
  const main = screen.getByRole('main')
  expect(main.id).toBe('main-content'); expect(main.tabIndex).toBe(-1)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(main.querySelector('main')).toBeNull()
  expect(within(main).getByRole('status').textContent).toMatch(/memuat/i)
})
test('initial App loading owns one focusable semantic main target', () => {
  auth.loading = true; mount('/girard/visit-history')
  const main = screen.getByRole('main')
  expect(main.id).toBe('main-content'); expect(main.tabIndex).toBe(-1)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(main.querySelector('main')).toBeNull()
  expect(within(main).getByRole('status').textContent).toMatch(/memuat/i)
})
test.each(PAGES.filter(page => page.path.startsWith('/athel/co')))('$path keeps one real CO main target after navigation', page => {
  auth.profile!.role = 'co_admin'; mount(actualPath(page.path))
  const main = screen.getByRole('main'), nav = screen.getByRole('navigation', { name: 'Synthetic Procurement navigation' })
  expect(main.id).toBe('main-content'); expect(main.tabIndex).toBe(-1)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(main.querySelector('main')).toBeNull()
})

// Source checks read the real filesystem; vi.mock leaf fixtures cannot satisfy
// them. Failures report the concrete file/line for the owning module regression.
const root = resolve('.')
const sourceCache = new Map<string, ts.SourceFile>()
function sourceAt(file: string) {
  const path = resolve(root, file)
  if (!sourceCache.has(path)) sourceCache.set(path, ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
  return sourceCache.get(path)!
}
function visit(source: ts.Node, inspect: (node: ts.Node) => void) { inspect(source); ts.forEachChild(source, node => visit(node, inspect)) }
function resolveImport(file: string, specifier: string) {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(file), specifier)
  return [base + '.tsx', base + '.ts', base + '/index.tsx', base + '/index.ts'].find(existsSync) ?? null
}
function importsOf(source: ts.SourceFile) {
  const imports: string[] = []
  visit(source, node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if ((ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) || (ts.isExportDeclaration(node) && node.isTypeOnly)) return
      const file = resolveImport(source.fileName, node.moduleSpecifier.text); if (file) imports.push(file)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const file = resolveImport(source.fileName, node.arguments[0].text); if (file) imports.push(file)
    }
  })
  return imports
}
function reachableSources() {
  const seen = new Set<string>(), queue = [resolve(root, 'src/App.tsx')]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file); queue.push(...importsOf(sourceAt(file)))
  }
  return [...seen].filter(file => file.endsWith('.tsx')).sort().map(sourceAt)
}
type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement
function attr(node: Opening, name: string) { return node.attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === name) }
function literal(attribute: ts.JsxAttribute | undefined) {
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null
}
function location(source: ts.SourceFile, node: ts.Node) { return `${relative(root, source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}` }
function dominatedGuardLoader(source: ts.SourceFile, node: Opening) {
  // ProtectedRoute's owner retains its defensive standalone fallback. App reads
  // the same AuthContext snapshot and returns before mounting Routes while it
  // loads. The two real App-loading tests above must stay green for this narrowly
  // identified source-only copy exception; no authority predicate is changed.
  if (relative(root, source.fileName) !== 'src/components/ProtectedRoute.tsx' || node.tagName.getText(source) !== 'p' || literal(attr(node, 'className')) !== 'text-gray-400 text-sm') return false
  let ancestor: ts.Node | undefined = node.parent
  while (ancestor) {
    if (ts.isIfStatement(ancestor)) return ancestor.expression.getText(source) === 'loading'
    ancestor = ancestor.parent
  }
  return false
}
function constantText(source: ts.SourceFile, name: string, seen = new Set<string>()): string {
  const key = source.fileName + ':' + name
  if (seen.has(key)) return ''
  seen.add(key)
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.getText(source) === name && declaration.initializer) return declaration.initializer.getText(source)
      }
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      const binding = statement.importClause.namedBindings.elements.find(binding => binding.name.text === name)
      const file = binding && resolveImport(source.fileName, statement.moduleSpecifier.text)
      if (binding && file) return constantText(sourceAt(file), binding.propertyName?.text ?? binding.name.text, seen)
    }
  }
  return ''
}
function classText(source: ts.SourceFile, node: Opening) {
  const initializer = attr(node, 'className')?.initializer
  if (!initializer) return ''
  let text = initializer.getText(source)
  visit(initializer, child => { if (ts.isIdentifier(child)) text += ' ' + constantText(source, child.text) })
  return text
}
function hasClassToken(sourceText: string, token: string) {
  // Class text includes literal/template quotes from the source audit. A hyphen
  // is part of a class name: variant-only and near-name tokens lack the base
  // action class that supplies sizing, layout, typography, and focus treatment.
  return sourceText.split(/[\s"'`]+/).includes(token)
}
test.each([
  { classes: 'ui-action ui-action--primary', expected: true },
  { classes: '"ui-action ui-action--secondary"', expected: true },
  { classes: '`ui-action ui-action--${variant}`', expected: true },
  { classes: 'ui-action--primary', expected: false },
  { classes: 'ui-action--secondary', expected: false },
  { classes: 'owner-ui-action', expected: false },
  { classes: 'ui-actionish', expected: false },
  { classes: 'ui-action__pending', expected: false },
])('exact base-class audit handles $classes', ({ classes, expected }) => {
  expect(hasClassToken(classes, 'ui-action')).toBe(expected)
})
function elements(inspect: (source: ts.SourceFile, node: Opening) => void) {
  for (const source of reachableSources()) visit(source, node => { if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) inspect(source, node) })
}

test('real App declares exactly the approved 37 patterns and inherited outer gates', () => {
  const source = sourceAt('src/App.tsx'), arrays = new Map<string, string[]>()
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer) && declaration.initializer.elements.every(ts.isStringLiteral)) arrays.set(declaration.name.getText(source), declaration.initializer.elements.map(element => (element as ts.StringLiteral).text))
  }
  const pages: { path: string; roles: string[] | null }[] = [], excluded: string[] = []
  function gate(node: Opening, inherited: string[] | null) {
    let roles = inherited
    const element = attr(node, 'element')?.initializer
    if (element) visit(element, child => {
      if (!(ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) || child.tagName.getText(source) !== 'ProtectedRoute') return
      const allowed = attr(child, 'allowedRoles')?.initializer
      if (!allowed) { roles = [...ROLES]; return }
      expect(ts.isJsxExpression(allowed) && !!allowed.expression, 'a concrete role predicate').toBe(true)
      const expression = (allowed as ts.JsxExpression).expression!
      if (ts.isIdentifier(expression)) { expect(arrays.has(expression.text)).toBe(true); roles = arrays.get(expression.text)! }
      else { expect(ts.isArrayLiteralExpression(expression)).toBe(true); roles = (expression as ts.ArrayLiteralExpression).elements.map(element => { expect(ts.isStringLiteral(element)).toBe(true); return (element as ts.StringLiteral).text }) }
    })
    return roles
  }
  function collect(node: ts.Node, parent = '', inherited: string[] | null = null) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      if (opening.tagName.getText(source) === 'Route') {
        const path = literal(attr(opening, 'path'))
        const full = attr(opening, 'index') ? parent : path === '*' ? '*' : path!.startsWith('/') ? path! : parent + '/' + path
        const roles = gate(opening, inherited)
        const children = ts.isJsxElement(node) ? node.children.filter((child): child is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) : []
        if (children.some(child => (ts.isJsxElement(child) ? child.openingElement : child).tagName.getText(source) === 'Route')) {
          excluded.push(full + ' shell'); children.forEach(child => collect(child, full, roles))
        } else if (full === '/' || full === '*') excluded.push(full + ' redirect')
        else pages.push({ path: full, roles })
        return
      }
    }
    ts.forEachChild(node, child => collect(child, parent, inherited))
  }
  collect(source)
  expect(PAGES).toHaveLength(37)
  expect(pages.map(page => page.path).sort()).toEqual(PAGES.map(page => page.path).sort())
  expect(new Set(pages.map(page => page.path)).size).toBe(37)
  for (const page of PAGES) {
    const actual = pages.find(candidate => candidate.path === page.path)!
    expect(actual.roles === null ? null : [...actual.roles].sort(), page.path).toEqual(page.roles === null ? null : [...page.roles].sort())
  }
  expect(excluded.sort()).toEqual(['* redirect', '/ redirect', '/athel/co shell'])
})
test('reachable audit includes lazy charts and embedded dashboard panels, excluding unrouted legacy pages', () => {
  const files = reachableSources().map(source => relative(root, source.fileName))
  expect(files).toContain('src/components/athel/DashboardCharts.tsx')
  expect(files).toContain('src/pages/girard/CustomerPerformance.tsx')
  expect(files).toContain('src/pages/girard/GirardPerformance.tsx')
  expect(files).not.toContain('src/pages/girard/GirardRevenue.tsx')
})
test('reachable operational buttons have shared or explicitly owned visible action surfaces', () => {
  const violations: string[] = []
  const navigationClasses = ['navigation-toggle', 'navigation-module-button', 'navigation-user-button', 'navigation-sign-out']
  elements((source, node) => {
    if (node.tagName.getText(source) !== 'button') return
    const classes = classText(source, node), file = relative(root, source.fileName)
    const handler = attr(node, 'onClick')?.initializer?.getText(source)
    const shared = hasClassToken(classes, 'ui-action')
    const navigation = file === 'src/components/AppNavigation.tsx' && navigationClasses.some(name => hasClassToken(classes, name))
    // These pre-existing, accessible camera controls have deliberate larger
    // visible domain surfaces. Their native semantics/DOM ownership stay intact.
    const camera = file === 'src/pages/girard/VisitPage.tsx' && (
      handler === '{capturePhoto}' && literal(attr(node, 'aria-label')) === 'Ambil foto' && hasClassToken(classes, 'w-14') && hasClassToken(classes, 'h-14')
      || handler === '{openCamera}' && hasClassToken(classes, 'h-36') && hasClassToken(classes, 'border-dashed')
      || handler === '{handleCheckIn}' && hasClassToken(classes, 'bg-brand-primary') && hasClassToken(classes, 'text-white') && hasClassToken(classes, 'p-3')
    )
    if (!shared && !navigation && !camera) violations.push(location(source, node))
  })
  expect(violations, 'native disclosure/navigation/field/file elements are exempt; operational buttons are not').toEqual([])
})
test('reachable supporting text never falls below the 13px source contract', () => {
  const violations: string[] = []
  elements((source, node) => { if (/\btext-xs\b|\btext-\[(?:[0-9]|1[0-2])px\]/.test(classText(source, node))) violations.push(location(source, node)) })
  expect(violations).toEqual([])
})
test('reachable native editable fields do not override 16px body sizing with smaller utilities', () => {
  const violations: string[] = []
  elements((source, node) => {
    if (['input', 'select', 'textarea'].includes(node.tagName.getText(source)) && /\btext-(?:xs|sm)\b|\btext-\[(?:[0-9]|1[0-5])px\]/.test(classText(source, node))) violations.push(location(source, node))
  })
  expect(violations).toEqual([])
})
test('actual table and cell utilities retain at least 14px data sizing', () => {
  const violations: string[] = []
  elements((source, node) => {
    if (['table', 'td', 'th'].includes(node.tagName.getText(source)) && /\btext-xs\b|\btext-\[(?:[0-9]|1[0-3])px\]/.test(classText(source, node))) violations.push(location(source, node))
  })
  expect(violations).toEqual([])
})
test('reachable normal text avoids the identified pale gray400/slate400 utilities', () => {
  const violations: string[] = []
  elements((source, node) => {
    if (dominatedGuardLoader(source, node)) return
    if (/(?:^|[\s'"`])text-(?:gray|slate)-400(?:\b)/.test(classText(source, node))) violations.push(location(source, node))
  })
  // A source-token guard cannot establish actual contrast or browser cascade.
  expect(violations).toEqual([])
})
