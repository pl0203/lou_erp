import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ role: 'sales_person', user: true }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: state.user ? { id: 'actor' } : null, profile: { id: 'actor', role: state.role, is_active: true }, loading: false }) }))
vi.mock('../src/pages/Login', () => ({ default: () => <p>Login boundary</p> }))
vi.mock('../src/pages/athel/POList', () => ({ default: () => <p>Procurement home</p> }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/VisitRequestInbox', () => ({ default: () => <p>Scoped requests</p>, VisitProposalForm: () => null }))
import App from '../src/App'
beforeEach(() => { state.user = true })
afterEach(cleanup)
function mount() { render(<MemoryRouter initialEntries={['/girard/visit-requests']}><App /></MemoryRouter>) }
test.each(['sales_person', 'sales_manager', 'sales_head', 'executive'])('%s reaches the dedicated requests page', role => {
 state.role = role; mount()
 expect(screen.getByRole('heading', { level: 1, name: 'Permintaan Kunjungan' })).toBeTruthy()
 expect(screen.getByText('Scoped requests')).toBeTruthy()
 expect(screen.getByRole('link', { name: 'Lihat Jadwal' }).getAttribute('href')).toBe('/girard/schedule')
})
test('Procurement-only users are redirected out of the requests route', () => {
 state.role = 'po_admin'; mount(); expect(screen.getByText('Procurement home')).toBeTruthy(); expect(screen.queryByText('Scoped requests')).toBeNull()
})
test('signed-out users cannot open requests directly', () => {
 state.user = false; mount(); expect(screen.getByText('Login boundary')).toBeTruthy(); expect(screen.queryByText('Scoped requests')).toBeNull()
})
