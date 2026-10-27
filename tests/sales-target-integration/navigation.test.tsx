import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ role: 'sales_manager' }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: state.role, full_name: 'Synthetic User' }, signOut: vi.fn() }) }))
vi.mock('../../src/lib/visitRequestBadge', () => ({ usePendingVisitReviewCount: () => undefined }))
import GirardNav from '../../src/components/GirardNav'
afterEach(cleanup)
test.each(['sales_person', 'sales_manager', 'sales_head', 'executive'])('%s can find monthly targets', role => {
 state.role = role
 render(<MemoryRouter initialEntries={['/girard/targets']}><GirardNav /></MemoryRouter>)
 expect(screen.getByRole('link', {name: 'Target Penjualan'}).getAttribute('href')).toBe('/girard/targets')
})
test.each(['po_admin','co_admin'])('%s has no target menu', role => {
 state.role = role
 render(<MemoryRouter><GirardNav /></MemoryRouter>)
 expect(screen.queryByRole('link', {name: 'Target Penjualan'})).toBeNull()
})
