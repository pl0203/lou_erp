import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import GirardNav from '../src/components/GirardNav'
import AppNavigation from '../src/components/AppNavigation'

const state = vi.hoisted(() => ({ role: 'executive' }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: state.role, full_name: 'Example User' }, signOut: vi.fn() }) }))
beforeEach(() => { localStorage.clear(); state.role = 'executive' })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function mount(node: React.ReactNode, layout: string, path = '/girard/visit-requests') {
 vi.stubGlobal('matchMedia', () => ({ matches: layout === 'mobile', addEventListener: vi.fn(), removeEventListener: vi.fn() }))
 render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>)
 if (layout === 'collapsed') fireEvent.click(screen.getByRole('button', { name: 'Minimalkan menu' }))
 if (layout === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
}
test.each(['sales_person', 'sales_manager', 'sales_head', 'executive'].flatMap(role => ['expanded', 'collapsed', 'mobile'].map(layout => [role, layout])))('%s has an active requests menu immediately below its schedule in %s navigation', (role, layout) => {
 state.role = role; mount(<GirardNav />, layout)
 const nav = screen.getByRole('navigation', { name: 'Navigasi Sales' })
 const links = within(nav).getAllByRole('link')
 const request = within(nav).getByRole('link', { name: 'Permintaan Kunjungan' })
 expect(request.getAttribute('href')).toBe('/girard/visit-requests')
 expect(request.getAttribute('aria-current')).toBe('page')
 expect(links.indexOf(request)).toBe(links.findIndex(link => link.getAttribute('href') === '/girard/schedule') + 1)
})
test('Procurement-only role does not gain a Sales requests menu', () => {
 state.role = 'po_admin'; mount(<GirardNav />, 'expanded')
 expect(screen.queryByRole('link', { name: 'Permintaan Kunjungan' })).toBeNull()
})
test.each((['athel', 'girard', 'ihr'] as const).flatMap(module => ['expanded', 'collapsed', 'mobile'].map(layout => [module, layout] as const)))('%s selector uses the same active-module icon as its menu option in %s navigation', (module, layout) => {
 const label = { athel: 'Procurement', girard: 'Sales', ihr: 'HR' }[module]
 mount(<AppNavigation module={module} links={[]} />, layout)
 const selector = screen.getByRole('button', { name: label })
 expect(selector.querySelector('img')).toBeNull()
 const icon = selector.querySelector('svg')
 expect(icon).not.toBeNull()
 fireEvent.click(selector)
 const option = within(screen.getByRole('group', { name: 'Pilihan modul' })).getByRole('button', { name: new RegExp(label) })
 expect(icon?.innerHTML).toBe(option.querySelector('svg')?.innerHTML)
})
