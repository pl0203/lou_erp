import { decodeDashboard, validateDashboardArgs, type DashboardArgs, type DashboardData } from './contracts'
export type DashboardTransport = (args: DashboardArgs, signal: AbortSignal) => Promise<DashboardData>
export type DashboardRpc = (name: 'pilot_sales_dashboard_v3', args: DashboardArgs, signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>
export class DashboardUnavailableError extends Error { constructor() { super('Ringkasan baru belum tersedia. Data lama tidak diubah menjadi KPI atau target baru.'); this.name = 'DashboardUnavailableError' } }
export function createDashboardTransport(rpc: DashboardRpc): DashboardTransport {
  return async (args, signal) => {
    validateDashboardArgs(args); signal.throwIfAborted()
    const response = await rpc('pilot_sales_dashboard_v3', args, signal)
    signal.throwIfAborted()
    if (response.error) throw new DashboardUnavailableError()
    return decodeDashboard(args, response.data)
  }
}
