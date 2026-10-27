import { fireEvent, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fixture, months, mount, page, role, state, uuid, zero } from './co/sales-ui-harness'
import { SalesMetricsPanel } from '../src/components/sales/SalesMetricSummary'
import { PerformanceContent } from '../src/pages/girard/GirardPerformance'
import { CustomerPerformanceContent } from '../src/pages/girard/CustomerPerformance'

const summary = () => screen.getByRole('region', { name: 'Ringkasan seluruh hasil' })
const card = (label: string) => within(summary()).getByRole('heading', { name: label }).closest('article')!

test('visit mean states equal staff weighting and zero-schedule treatment separately from pooled counts', async () => {
  role('sales_manager')
  state.handler = (name: string, args: any) => {
    if (name !== 'pilot_sales_performance_v1') return fixture(name, args)
    const items = [2, 4, 0, 0].map((scheduled, index) => ({ id: uuid(30 + index), full_name: `Staff ${index}`, scheduled, visited: index === 0 ? 2 : 0, missed: 0, orders: 0, total_sales: '10000', visit_rate: index === 0 ? 100 : 0, sales_target: null }))
    return { data: { ...fixture(name, args).data, total: 4, items, summary: { total_visited: 2, total_scheduled: 6, total_orders: 0, total_sales: '40000', average_visit_rate: 25 } }, error: null }
  }
  mount(<PerformanceContent />, '/girard/dashboard')
  const mean = await screen.findByRole('region', { name: 'Rata-rata tingkat kunjungan per orang' })
  expect(within(mean).getByText('25%')).toBeTruthy()
  expect(mean.textContent).toContain('4 anggota aktif')
  expect(mean.textContent).toContain('bobot sama')
  expect(mean.textContent).toContain('tanpa jadwal dihitung 0%')
  expect(mean.textContent).toContain('dibulatkan')
  expect(mean.textContent).toContain('Oktober 2026')
  expect(mean.textContent).not.toContain('2/6')
  expect(screen.getByText('2/6 kunjungan tercatat dari jadwal')).toBeTruthy()
  expect(screen.getByText('Rp 40.000')).toBeTruthy()
  expect(screen.queryByText('Rp 0.0M')).toBeNull()
})

test('Sales summary keeps its own period, scope, metric bases and coverage next to values', async () => {
  mount(<SalesMetricsPanel />, '/girard/my-sales?sales_from=2026-09&sales_through=2026-10')
  await screen.findByRole('region', { name: 'Ringkasan seluruh hasil' })
  expect(summary().textContent).toContain('September 2026 – Oktober 2026')
  expect(summary().textContent).toContain('Cakupan: sendiri')
  expect(within(card('Nilai pesanan PO')).getByText(/tanggal PO/i)).toBeTruthy()
  expect(within(card('Nilai pengiriman PO')).getByText(/tanggal SJ/i)).toBeTruthy()
  expect(within(card('Penjualan CO dilaporkan')).getByText(/bulan laporan yang sudah diposting/i)).toBeTruthy()
  expect(within(card('Penjualan CO dilaporkan')).getByText(/belum dilaporkan/i)).toBeTruthy()
  expect(screen.getByText(/Filter ini hanya mengubah Metrik Sales/)).toBeTruthy()
  expect(screen.getByText(/Waktu pembacaan: 10 Oktober 2026 pukul 00.00.00 UTC/)).toBeTruthy()
  expect(screen.queryByText(/2026-10-10T00:00:00Z/)).toBeNull()
})

test('missing metric months do not display a fabricated rupiah zero', async () => {
  state.handler = (name: string, args: any) => name === 'pilot_sales_metric_months_v2' ? { data: months(args, null), error: null } : name === 'pilot_sales_metrics_v2' ? { data: page(args, { total: '0', items: [], summary: { ...zero, co_report_event_count: '0' } }), error: null } : fixture(name, args)
  mount(<SalesMetricsPanel />)
  await screen.findByRole('region', { name: 'Ringkasan seluruh hasil' })
  expect(within(summary()).queryByText(/^Rp /)).toBeNull()
  expect(within(summary()).getAllByText('Belum tersedia')).toHaveLength(3)
  expect(within(summary()).getByText(/Belum ada bulan metrik/)).toBeTruthy()
})

test('CO zero from a posted report is visibly different from no posted report', async () => {
  let reports = '0'
  state.handler = (name: string, args: any) => name === 'pilot_sales_metrics_v2' ? { data: page(args, { total: reports === '0' ? '0' : '1', items: reports === '0' ? [] : [{ customer_id: uuid(40), customer_name: 'Reported zero', ...zero, co_report_event_count: reports }], summary: { ...zero, co_report_event_count: reports } }), error: null } : fixture(name, args)
  mount(<SalesMetricsPanel />)
  await screen.findByRole('region', { name: 'Ringkasan seluruh hasil' })
  expect(within(card('Penjualan CO dilaporkan')).getByText('Belum tersedia')).toBeTruthy()
  expect(within(card('Penjualan CO dilaporkan')).getByText(/Belum ada laporan CO diposting/)).toBeTruthy()
  reports = '1'
  fireEvent.click(screen.getByRole('button', { name: 'Muat ulang metrik' }))
  await screen.findByText('Reported zero')
  expect(within(card('Penjualan CO dilaporkan')).getByText('Rp 0')).toBeTruthy()
  expect(within(card('Penjualan CO dilaporkan')).getByText(/Nol pada laporan yang tersedia/)).toBeTruthy()
})

test('a filtered-out metric is marked excluded instead of a measured zero', async () => {
  mount(<SalesMetricsPanel />, '/girard/my-sales?sales_type=po')
  await screen.findByRole('region', { name: 'Ringkasan seluruh hasil' })
  expect(within(card('Penjualan CO dilaporkan')).getByText('Di luar filter')).toBeTruthy()
  expect(within(card('Penjualan CO dilaporkan')).queryByText('Rp 0')).toBeNull()
})

test('customer activity states its independent human-readable month and full small rupiah values', async () => {
  role('sales_head')
  state.handler = (name: string, args: any) => {
    const result = fixture(name, args)
    if (name === 'pilot_customer_performance_v1') {
      result.data.items[0].total_sales = '12345.67'
      result.data.summary.total_sales = '12345.67'
    }
    return result
  }
  mount(<CustomerPerformanceContent />, '/girard/dashboard?sales_from=2026-09&sales_through=2026-09')
  await screen.findAllByText('Current activity cohort')
  expect(screen.getAllByText('Rp 12.345,67').length).toBeGreaterThan(0)
  expect(screen.getByText(/Periode aktivitas: Oktober 2026/)).toBeTruthy()
  expect(screen.getByText(/Filter bulan aktivitas ini tidak mengubah Metrik Sales/)).toBeTruthy()
})

test('customer activity reads a last-visit instant as readable UTC without changing its calendar meaning', async () => {
  role('sales_head')
  state.handler = (name: string, args: any) => {
    const result = fixture(name, args)
    if (name === 'pilot_customer_performance_v1') result.data.items[0].last_visit_date = '2026-09-30T23:30:00-07:00'
    return result
  }
  mount(<CustomerPerformanceContent />, '/girard/dashboard')
  await screen.findAllByText('Current activity cohort')
  expect(screen.getAllByText('1 Oktober 2026 pukul 06.30.00 UTC').length).toBeGreaterThan(0)
  expect(screen.queryByText('Invalid Date')).toBeNull()
})

test('a stale empty month directory cannot conceal positive amounts returned by the metric read', async () => {
  state.handler = (name: string, args: any) => name === 'pilot_sales_metric_months_v2' ? { data: months(args, null), error: null } : fixture(name, args)
  mount(<SalesMetricsPanel />)
  await screen.findByRole('region', { name: 'Ringkasan seluruh hasil' })
  expect(within(card('Nilai pesanan PO')).getByText('Rp 1.000.000')).toBeTruthy()
  expect(within(summary()).queryByText(/Belum ada bulan metrik/)).toBeNull()
})

test.each([
  ['team', PerformanceContent, 'Tabel aktivitas tim'],
  ['customer', CustomerPerformanceContent, 'Tabel aktivitas pelanggan'],
] as const)('%s reporting tables expose a keyboard-accessible overflow region for exact money and names', async (_label, Page, regionName) => {
  role('sales_head')
  mount(<Page />, '/girard/dashboard')
  const region = await screen.findByRole('region', { name: regionName })
  region.focus()
  expect(document.activeElement).toBe(region)
  expect(region.classList.contains('overflow-x-auto')).toBe(true)
  expect(within(region).getByRole('table').className).toMatch(/min-w-\[/)
  expect(screen.getByText('Geser tabel untuk melihat semua kolom.')).toBeTruthy()
})

test.each(['0', '1'])('zero person contribution does not infer missing or reported-zero CO data from %s summary events', async reportEvents => {
  role('sales_head')
  const personValues = { ...zero, po_order_count: '1', po_order_value: '10000.00' }
  state.handler = (name: string, args: any) => name === 'pilot_sales_metrics_v2' ? {
    data: page(args, {
      summary: { ...personValues, co_report_event_count: reportEvents },
      items: [{ person_id: uuid(50), person_name: 'PO and zero-CO contributor', is_unassigned: false, ...personValues, co_contributing_report_count: '0' }],
    }), error: null,
  } : fixture(name, args)
  mount(<SalesMetricsPanel group="person" />, '/girard/dashboard')
  const person = await screen.findByRole('region', { name: 'PO and zero-CO contributor' })
  const personCO = within(person).getByRole('heading', { name: 'Penjualan CO dilaporkan' }).closest('article')!
  expect(within(personCO).getByText('Rp 0')).toBeTruthy()
  expect(within(personCO).getByText(/Belum ada kontribusi penjualan CO untuk orang ini/)).toBeTruthy()
  expect(within(personCO).getByText(/tidak membuktikan bahwa laporan CO belum tersedia/)).toBeTruthy()
  expect(within(personCO).queryByText('Belum tersedia')).toBeNull()
  expect(within(personCO).queryByText(/Belum ada laporan CO diposting|Nol pada laporan yang tersedia/)).toBeNull()
  expect(within(card('Penjualan CO dilaporkan')).getByText(reportEvents === '0' ? 'Belum tersedia' : 'Rp 0')).toBeTruthy()
})
