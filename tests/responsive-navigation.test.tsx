import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'executive', full_name: 'Example Executive' }, signOut: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 100 }) }))
import AthelNav from '../src/components/AthelNav'
import PaginationControls from '../src/components/PaginationControls'
import Landing from '../src/pages/Landing'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('Procurement navigation has one sidebar link set rather than duplicate scrolling strips', () => {
  render(<MemoryRouter><AthelNav /></MemoryRouter>)
  const nav = screen.getByRole('navigation', { name: 'Navigasi Procurement' })
  expect(screen.getAllByRole('link', { name: 'Dashboard' })).toHaveLength(1)
  expect(nav.classList.contains('navigation-links')).toBe(true)
  expect(screen.getByRole('button', { name: 'Minimalkan menu' })).toBeTruthy()
})

test('pagination can wrap inside narrow detail cards and retains both page actions', () => {
  render(<PaginationControls page={22} total={99999} pageSize={20} pending={false} onPageChange={vi.fn()} />)
  const nav = screen.getByRole('navigation', { name: 'Halaman hasil' })
  expect(nav.classList.contains('flex-wrap')).toBe(true)
  expect(nav.classList.contains('min-w-0')).toBe(true)
  expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Berikutnya' }).classList.contains('ui-action')).toBe(true)
})

test('a real skip link points to one focusable main target after navigation', async () => {
  const patterns = import.meta.glob('../src/components/ui/MainContent.tsx')
  const load = patterns['../src/components/ui/MainContent.tsx']
  expect(load, 'MainContent presentation primitive').toBeTypeOf('function')
  const { MainContent } = await load() as { MainContent: React.ComponentType<React.HTMLAttributes<HTMLElement>> }
  render(<MemoryRouter><div><AthelNav /><MainContent className="owner-main" aria-label="Isi halaman"><button>Tindakan halaman</button></MainContent></div></MemoryRouter>)
  const skip = screen.getByRole('link', { name: 'Lewati ke konten utama' })
  const main = screen.getByRole('main', { name: 'Isi halaman' })
  expect(skip.getAttribute('href')).toBe('#main-content')
  expect(main.id).toBe('main-content')
  expect(main.getAttribute('tabindex')).toBe('-1')
  expect(main.classList.contains('owner-main')).toBe(true)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(screen.getByRole('navigation').compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(skip)
  expect(document.activeElement).toBe(main)
})

test('Landing wires a unique main target without a nested main landmark', () => {
  render(<MemoryRouter initialEntries={['/landing']}><Landing /></MemoryRouter>)
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

test('Landing module cards navigate as real links without intercepting modified clicks', () => {
  function Location() { return <output aria-label="Lokasi">{useLocation().pathname}</output> }
  render(<MemoryRouter initialEntries={['/landing']}><Landing /><Location /></MemoryRouter>)
  const sales = within(screen.getByRole('main')).getByRole('link', { name: /Sales/ })
  expect(sales.getAttribute('href')).toBe('/girard/schedule')
  let intercepted = true
  document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault() }, { once: true })
  fireEvent.click(sales, { ctrlKey: true, button: 0 })
  expect(intercepted).toBe(false)
  expect(screen.getByLabelText('Lokasi').textContent).toBe('/landing')
  fireEvent.click(sales)
  expect(screen.getByLabelText('Lokasi').textContent).toBe('/girard/schedule')
})

test('module choices are real links and keep modified-click menus open', () => {
  function Location() { const location = useLocation(); return <output aria-label="Lokasi">{location.pathname}</output> }
  render(<MemoryRouter initialEntries={['/athel/po']}><AthelNav /><Location /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Procurement' }))
  const choices = screen.getByRole('group', { name: 'Pilihan modul' })
  const sales = within(choices).getByRole('link', { name: /Sales/ })
  expect(sales.getAttribute('href')).toBe('/girard/schedule')
  let intercepted = true
  document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault() }, { once: true })
  fireEvent.click(sales, { ctrlKey: true, button: 0 })
  expect(intercepted).toBe(false)
  expect(screen.getByLabelText('Lokasi').textContent).toBe('/athel/po')
  expect(screen.getByRole('group', { name: 'Pilihan modul' })).toBeTruthy()
  fireEvent.click(sales)
  expect(screen.getByLabelText('Lokasi').textContent).toBe('/girard/schedule')
  expect(screen.queryByRole('group', { name: 'Pilihan modul' })).toBeNull()
})

test('mobile module links dismiss the drawer on an ordinary route activation', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  render(<MemoryRouter><AthelNav /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
  fireEvent.click(screen.getByRole('button', { name: 'Procurement' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Pilihan modul' })).getByRole('link', { name: /Sales/ }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.style.overflow).not.toBe('hidden')
})

test('active navigation uses surface and side cues without a text underline or changed sidebar geometry', () => {
  const css = readFileSync('src/components/navigation.css', 'utf8')
  expect(css).toMatch(/\.navigation-link-active\s*\{[^}]*background:\s*var\(--color-brand-tint\)[^}]*border-left-color:\s*var\(--color-brand-primary\)/)
  expect(css).not.toMatch(/\.navigation-link-active\s+\.navigation-label\s*\{[^}]*text-decoration:\s*underline/)
  expect(css).toContain('--navigation-width: 256px')
  expect(css).toContain('--navigation-width: 72px')
})

test('navigation supporting typography declarations meet the approved minimum', () => {
  const css = readFileSync('src/components/navigation.css', 'utf8')
  const sizes = Array.from(css.matchAll(/font-size:\s*(\d+)px/g), match => Number(match[1]))
  expect(sizes.every(size => size >= 13)).toBe(true)
})
