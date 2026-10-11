import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ queries: new Map<string, any>(), activity: vi.fn() }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'manager', role: 'sales_manager' } }) }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../../src/lib/reads/reports', () => ({ fetchTeamActivity: (...args: any[]) => state.activity(...args) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { state.queries.set(options.queryKey[0], options); return { data: options.queryKey[0] === 'manager_team' ? [{ id: 'rep', full_name: 'Synthetic Long Salesperson Name', email: 'rep@example.invalid', phone: null }] : options.queryKey[0] === 'managers_data' ? [{ id: 'manager', full_name: 'Synthetic Manager', email: 'manager@example.invalid', customers: [], team: [{ id: 'rep', full_name: 'Synthetic Rep' }] }] : [{ sales_person_id: 'rep', total_scheduled: 4, total_visited: 2, total_orders: 1, weekly_visits: 3 }], isLoading: false, isPending: false } } }))
import GirardTeam from '../../src/pages/girard/GirardTeam'
import GirardManagers from '../../src/pages/girard/GirardManagers'
afterEach(cleanup)
beforeEach(() => { state.queries.clear(); state.activity.mockReset() })
test('team date control binds summary query and matching person/date/completed drilldowns', () => {
 render(<GirardTeam />); fireEvent.change(screen.getByLabelText('Tanggal aktivitas tim'), { target: { value: '2026-10-12' } });
 const query = state.queries.get('today_activity'); expect(query.queryKey).toContain('2026-10-12'); query.queryFn({ signal: undefined }); expect(state.activity).toHaveBeenCalledWith(['rep'], undefined, '2026-10-12');
 expect(screen.getAllByRole('link', { name: /Lihat 4 jadwal.*Synthetic Long/ })[0].getAttribute('href')).toBe('/girard/schedule?date=2026-10-12&person=rep');
 expect(screen.getAllByRole('link', { name: /Lihat 2 kunjungan selesai.*Synthetic Long/ })[0].getAttribute('href')).toBe('/girard/schedule?date=2026-10-12&person=rep&status=visited');
 expect(screen.getByText(/Kunjungan terbaru dihitung sejak.*hingga sekarang/)).toBeTruthy()
})
test('manager card exposes permitted team and individual visit drilldowns', () => {
 render(<GirardManagers />); expect(screen.getByRole('link', { name: 'Lihat jadwal tim Synthetic Manager' }).getAttribute('href')).toMatch(/manager=manager/); expect(screen.getByRole('link', { name: 'Synthetic Rep' }).getAttribute('href')).toMatch(/person=rep/)
})
