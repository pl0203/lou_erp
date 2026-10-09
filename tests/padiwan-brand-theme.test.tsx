import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ profile: null as null | { role: string; full_name: string } }))
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ ...auth, loading: false, signOut: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 2 }) }))
import Login from '../src/pages/Login'
import Landing from '../src/pages/Landing'
import AthelNav from '../src/components/AthelNav'
import GirardNav from '../src/components/GirardNav'
import IHRNav from '../src/components/IHRNav'

afterEach(() => { cleanup(); auth.profile = null })

const css = readFileSync('src/index.css', 'utf8')
function token(name: string) {
  const match = css.match(new RegExp(`--color-brand-${name}:\\s*(#[0-9a-fA-F]{6})`))
  expect(match, `brand ${name} token is defined`).not.toBeNull()
  return match![1].toUpperCase()
}
function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('brand tokens use the approved navy, ochre and warm surfaces without overriding status palettes', () => {
  expect(token('primary')).toBe('#192D43')
  expect(token('accent')).toBe('#C69942')
  expect(token('canvas')).toBe('#F8F7F3')
  expect(css).not.toMatch(/--color-(?:green|red|amber|yellow|orange|blue)-\d+\s*:/)
})

test('brand text, primary button labels and focus colors meet WCAG AA contrast', () => {
  for (const bg of ['#FFFFFF', token('canvas'), token('tint'), token('accent')]) {
    expect(contrast(token('primary'), bg)).toBeGreaterThanOrEqual(4.5)
  }
  expect(contrast('#FFFFFF', token('hover'))).toBeGreaterThanOrEqual(4.5)
  expect(contrast(token('primary'), '#FFFFFF')).toBeGreaterThanOrEqual(3)
})

test('login shows the Padiwan lockup and navy controls while validation remains a red error', () => {
  render(<MemoryRouter><Login /></MemoryRouter>)
  expect(screen.getByRole('img', { name: 'Padiwan' }).getAttribute('src')).toBe('/brand/padiwan-logo.svg')
  const signIn = screen.getByRole('button', { name: 'Masuk' })
  expect(signIn.classList.contains('bg-brand-primary')).toBe(true)
  expect(screen.getByPlaceholderText('anda@perusahaan.com').classList.contains('focus:ring-brand-primary')).toBe(true)
  fireEvent.click(signIn)
  expect(screen.getByText('Masukkan email dan kata sandi Anda.').classList.contains('text-red-500')).toBe(true)
})

test('the module chooser has one Padiwan identity and retains all module actions', () => {
  auth.profile = { role: 'executive', full_name: 'Theme Reviewer' }
  render(<MemoryRouter><Landing /></MemoryRouter>)
  expect(screen.getAllByRole('img', { name: 'Padiwan' }).length).toBeGreaterThan(0)
  for (const name of ['Procurement', 'Sales', 'HR']) expect(screen.getByRole('button', { name: new RegExp('^' + name + ' Manajemen') })).toBeTruthy()
})

test.each([
  { Component: AthelNav, route: '/athel/po', active: 'Purchase Order', module: 'Procurement' },
  { Component: GirardNav, route: '/girard/schedule', active: 'Jadwal', module: 'Sales' },
  { Component: IHRNav, route: '/ihr/leave', active: 'Manajemen Cuti', module: 'HR' },
])('$module navigation has a readable active cue without changing the link', ({ Component, route, active, module }) => {
  auth.profile = { role: 'executive', full_name: 'Theme Reviewer' }
  render(<MemoryRouter initialEntries={[route]}><Component /></MemoryRouter>)
  const links = screen.getAllByRole('link', { name: active })
  for (const link of links) {
    expect(link.getAttribute('href')).toBe(route)
    expect(link.classList.contains('navigation-link-active')).toBe(true)
    expect(link.getAttribute('aria-current')).toBe('page')
  }
  const switcher = screen.getByRole('button', { name: module })
  expect(switcher.querySelector('img')).toBeNull()
  expect(switcher.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
})

// These desktop/mobile action pairs must not diverge back to module colors.
test.each([
  'src/pages/athel/CustomerList.tsx', 'src/pages/athel/POList.tsx', 'src/pages/athel/ProductList.tsx',
  'src/pages/girard/GirardCustomers.tsx', 'src/pages/girard/Promotions.tsx',
  'src/pages/girard/ManagerSchedule.tsx', 'src/pages/ihr/leave/OwnRequestActions.tsx',
])('all reviewed desktop/mobile actions use shared brand colors in %s', path => {
  expect(readFileSync(path, 'utf8')).not.toMatch(/className="[^"\n]*(?:text-blue-600|text-green-600|bg-orange-600)/)
})

test('plain button labels never retain the old blue or green module action colors', async () => {
  const { readdirSync } = await import('node:fs')
  const ts = await import('typescript')
  const legacyActions: string[] = []
  function inspect(directory: string) {
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${file.name}`
      if (file.isDirectory()) { inspect(path); continue }
      if (!path.endsWith('.tsx')) continue
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      function visit(node: import('typescript').Node) {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'button') {
          const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === 'className')
          if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer) && /(?:^|\s)text-(?:blue|green)-(?:600|700)(?:\s|$)/.test(attribute.initializer.text)) legacyActions.push(path)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  inspect('src')
  expect(legacyActions).toEqual([])
})

test('shared customer-history action labels use the brand token', () => {
  expect(readFileSync('src/components/CustomerHistory.tsx', 'utf8')).toMatch(/const action = '[^']*text-brand-primary/)
})
