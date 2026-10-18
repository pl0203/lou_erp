import { expect, test, vi } from 'vitest'
import { createDashboardTransport } from '../../src/lib/salesDashboard/transport'
import { dashboardArgs, dashboardFixture } from './fixtures'
test('unavailable transport does not retry, mutate or synthesize historical KPI values', async () => {
  const call = vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } }))
  await expect(createDashboardTransport(call)(dashboardArgs, new AbortController().signal)).rejects.toThrow('Ringkasan baru belum tersedia')
  expect(call).toHaveBeenCalledTimes(1)
  expect(call.mock.calls[0][0]).toBe('pilot_sales_dashboard_v3')
})
test('validates input before RPC and validates exact version/basis after RPC', async () => {
  const call = vi.fn(async () => ({ data: dashboardFixture(), error: null }))
  const transport = createDashboardTransport(call)
  await expect(transport({ ...dashboardArgs, p_page: 0 }, new AbortController().signal)).rejects.toThrow()
  expect(call).not.toHaveBeenCalled()
  await expect(transport(dashboardArgs, new AbortController().signal)).resolves.toMatchObject({ schemaVersion: 3 })
  call.mockResolvedValue({ data: { ...dashboardFixture(), schemaVersion: 2 } as any, error: null })
  await expect(transport(dashboardArgs, new AbortController().signal)).rejects.toThrow()
})
test('a late aborted response is not returned even when RPC ignores cancellation', async () => {
  const controller = new AbortController()
  const transport = createDashboardTransport(async () => { controller.abort(); return { data: dashboardFixture(), error: null } })
  await expect(transport(dashboardArgs, controller.signal)).rejects.toThrow()
})
