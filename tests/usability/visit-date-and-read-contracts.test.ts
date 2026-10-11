import { afterEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: (...args: any[]) => state.rpc(...args) } }))
import { fetchTeamActivity } from '../../src/lib/reads/reports'
import { isVisitDate, visitCadence, visitAssigneeLabel, visitScheduleHref } from '../../src/lib/visitUsability'
afterEach(() => vi.useRealTimers())
test('date-only validation rejects incomplete/rolled-over dates and accepts leap dates without local conversion', () => {
 for (const invalid of ['', '2026-2-01', '2026-02-29', '2026-04-31', '2026-00-10', '0000-01-01', '2026-10-12T00:00:00Z']) expect(isVisitDate(invalid)).toBe(false)
 for (const valid of ['2028-02-29', '2026-10-12', '2027-01-01']) expect(isVisitDate(valid)).toBe(true)
})
test('cadence preserves strict elapsed-time cutoff at UTC date plus frequency', () => {
 const cutoff = Date.parse('2026-10-08T00:00:00Z')
 expect(visitCadence('2026-10-01', 7, cutoff)).toBeNull()
 expect(visitCadence('2026-10-01', 7, cutoff + 1)?.label).toBe('Interval kunjungan terlewati')
 expect(visitCadence(null, 7, cutoff)?.label).toBe('Belum pernah dikunjungi')
 expect(visitCadence('invalid', 7, cutoff)).toBeNull()
})
test('unavailable manager is never exposed as a raw private identifier and links encode filters', () => {
 expect(visitAssigneeLabel({ full_name: 'Synthetic Rep', role: 'sales_person', manager_id: 'hidden-id' }, [])).toBe('Synthetic Rep · Staf Penjualan')
 expect(visitScheduleHref('2026-10-12', 'id&manager=other')).toBe('/girard/schedule?date=2026-10-12&person=id%26manager%3Dother')
})
test('selected team day preserves existing recent-visit scope and inclusive daily order boundaries', async () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
 state.rpc.mockImplementation(() => { const response = { data: { version: 1, as_of: '2026-10-10T12:00:00Z', items: [{ sales_person_id: 'rep', total_scheduled: 4, total_visited: 2, total_orders: 1, weekly_visits: 6 }] }, error: null }; return { then: (resolve: any) => Promise.resolve(response).then(resolve) } })
 await fetchTeamActivity(['rep'], undefined, '2026-09-22')
 expect(state.rpc).toHaveBeenCalledWith('pilot_team_activity_v1', { p_user_ids: ['rep'], p_day: '2026-09-22', p_order_from: '2026-09-22T00:00:00', p_order_to: '2026-09-22T23:59:59', p_week_from: '2026-10-03' })
})
