import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: null as any, error: false, loading: false, charts: {} as Record<string, any> }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: state.data, isError: state.error, isLoading: state.loading }) }))
// ECharts owns browser rendering. Inspect the real presentation options and the
// independent HTML controls here; rendering itself is covered in browser QA.
vi.mock('../src/components/charts/EChart', () => ({ default: ({ option, label }: any) => {
  state.charts[label] = option
  return <div role="img" aria-label={label} />
} }))
import Dashboard from '../src/pages/athel/Dashboard'

beforeEach(() => {
  state.error = false
  state.loading = false
  state.charts = {}
  state.data = {
    metrics: { totalPOCount: 2, totalPOValue: '1000000', deliveredValue: '0', outstandingValue: '1000000', averagePOValue: '500000', completedPOCount: 0 },
    customerShare: [{ label: 'Customer <img src=x onerror=alert(1)>', value: '1000000', color: '#3b82f6' }],
    monthlySeries: [{ key: '2026-09', label: 'Sep 2026', poValue: '1000000', deliveredValue: '0' }],
    dailySeries: [{ key: '2026-09-30', label: '30 Sep', deliveredValue: '0', sjCount: 2 }],
    statusBreakdown: [{ label: 'Confirm', value: 2, color: '#3b82f6' }],
    topCustomers: [], outstandingItems: [],
  }
})
afterEach(cleanup)

test('status composition exposes counts and percentages rather than rupiah', async () => {
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Komposisi Status PO' })
  expect(within(region).getByText('2 PO')).toBeTruthy()
  expect(region.textContent).not.toContain('Rp')
  expect(within(within(region).getByRole('list')).getByText('100.0%')).toBeTruthy()
})

test('daily chart has zero-height revenue, distinct count axis and a visible single-day count point', async () => {
  render(<Dashboard />)
  await screen.findByRole('img', { name: 'Tren Pengiriman Harian' })
  const option = state.charts['Tren Pengiriman Harian']
  expect(option.series[0].data).toEqual([0])
  expect(option.series[0].barMinHeight ?? 0).toBe(0)
  expect(option.series[1].data).toEqual([2])
  expect(option.series[1].yAxisIndex).toBe(1)
  expect(option.series[1].showSymbol).toBe(true)
  expect(option.yAxis[1].minInterval).toBe(1)
  expect(option.xAxis.data).toEqual(['2026-09-30'])
  expect(option.dataZoom).toEqual([])
})

test('series controls are keyboard-accessible and affect only chart visibility', async () => {
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'PO vs Pengiriman Bulanan' })
  const control = within(region).getByRole('button', { name: 'Terkirim' })
  expect(control.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(control)
  await waitFor(() => expect(state.charts['PO vs Pengiriman Bulanan'].legend.selected.Terkirim).toBe(false))
  expect(control.getAttribute('aria-pressed')).toBe('false')
  expect(state.data.metrics.totalPOValue).toBe('1000000')
  expect(state.charts['PO vs Pengiriman Bulanan'].series[1].data).toEqual([0])
})

test('all daily values remain in the chart with date zoom and an accessible data table', async () => {
  state.data.dailySeries = Array.from({ length: 40 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Tren Pengiriman Harian' })
  const option = state.charts['Tren Pengiriman Harian']
  expect(option.series[0].data).toHaveLength(40)
  expect(option.series[0].data[17]).toBe(17)
  expect(option.dataZoom.some((zoom: any) => zoom.type === 'slider')).toBe(true)
  expect(within(region).getByRole('slider', { name: 'Tanggal mulai grafik' }).getAttribute('aria-valuetext')).toBe('Day 0')
  expect(within(region).getByText('Lihat data')).toBeTruthy()
  expect(within(region).getAllByRole('row', { hidden: true })).toHaveLength(41)
})

test('daily zoom controls update the plotted range and can restore all dates without changing data', async () => {
  state.data.dailySeries = Array.from({ length: 40 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  render(<Dashboard />)
  const slider = await screen.findByRole('slider', { name: 'Tanggal mulai grafik' })
  fireEvent.change(slider, { target: { value: '12' } })
  await waitFor(() => expect(state.charts['Tren Pengiriman Harian'].dataZoom[0].startValue).toBe(12))
  expect(slider.getAttribute('aria-valuetext')).toBe('Day 12')
  fireEvent.click(screen.getByRole('button', { name: 'Tampilkan semua tanggal' }))
  await waitFor(() => expect(state.charts['Tren Pengiriman Harian'].dataZoom[0].startValue).toBe(0))
  expect(state.charts['Tren Pengiriman Harian'].series[0].data).toHaveLength(40)
})

test('filter data replacement clears old marks and resets daily zoom', async () => {
  state.data.dailySeries = Array.from({ length: 40 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  const view = render(<Dashboard />)
  const slider = await screen.findByRole('slider', { name: 'Tanggal mulai grafik' })
  fireEvent.change(slider, { target: { value: '12' } })
  state.data = { ...state.data, dailySeries: [{ key: '2026-10-01', label: '1 Okt', deliveredValue: '0', sjCount: 0 }] }
  view.rerender(<Dashboard />)
  await waitFor(() => expect(state.charts['Tren Pengiriman Harian'].series[0].data).toEqual([0]))
  expect(state.charts['Tren Pengiriman Harian'].xAxis.data).toEqual(['2026-10-01'])
  expect(screen.queryByRole('slider', { name: 'Tanggal mulai grafik' })).toBeNull()
})

test('empty composition and all-zero deliveries have explicit honest messages', async () => {
  state.data.customerShare = []
  state.data.statusBreakdown = []
  state.data.dailySeries[0].sjCount = 0
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Tren Pengiriman Harian' })
  expect(within(region).getByText('Belum ada pengiriman pada periode ini.')).toBeTruthy()
  expect(screen.getAllByText('Belum ada data pada filter ini.')).toHaveLength(2)
})

test('customer names remain literal text and chart tooltips do not use HTML rendering', async () => {
  render(<Dashboard />)
  await screen.findByRole('img', { name: 'Kontribusi Customer' })
  expect(state.charts['Kontribusi Customer'].tooltip.renderMode).toBe('richText')
  expect(state.charts['Kontribusi Customer'].yAxis.data).toEqual([state.data.customerShare[0].label])
  expect(document.querySelector('img')).toBeNull()
})

test.each(['Top Customer', 'Outstanding Item Breakdown'].flatMap(title =>
  ['empty', 'populated'].map(rows => ({ title, rows })),
))('$title keeps its $rows table inside a shrinkable grid card', async ({ title, rows }) => {
  const customerName = 'CustomerWithAnUnbrokenNameLongerThanANarrowViewport'
  const sku = 'SKU-WITH-AN-UNBROKEN-CODE-LONGER-THAN-A-NARROW-VIEWPORT'
  const productName = 'ProductWithAnUnbrokenNameLongerThanANarrowViewport'
  if (rows === 'populated') {
    state.data.topCustomers = [{ rank: 1, name: customerName, poValue: '1000000', deliveredValue: '0', fulfillmentRate: 0 }]
    state.data.outstandingItems = [{ rank: 1, sku, productName, outstandingQty: 25, outstandingValue: '1000000' }]
  }

  render(<Dashboard />)
  await screen.findByRole('region', { name: 'Komposisi Status PO' })
  const heading = screen.getByRole('heading', { name: title })
  const card = heading.parentElement!.parentElement!
  const table = within(card).getByRole('table')

  // jsdom does not measure layout. Guard the CSS contract: a grid item must
  // shrink below the table's intrinsic width so only the inner table scrolls.
  expect(card.classList.contains('min-w-0')).toBe(true)
  expect(table.parentElement!.classList.contains('overflow-x-auto')).toBe(true)
  expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
  if (rows === 'populated') {
    const labels = title === 'Top Customer' ? [customerName] : [sku, productName]
    for (const label of labels) expect(within(table).getByText(label)).toBeTruthy()
    expect(within(table).getAllByRole('cell')).toHaveLength(5)
  } else {
    expect(within(table).getByRole('cell').getAttribute('colspan')).toBe('5')
  }
})

test('loading and query errors remain unavailable instead of showing fabricated zero charts', () => {
  state.data = undefined
  state.loading = true
  const view = render(<Dashboard />)
  expect(screen.getByText('Memuat dashboard Athel...')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
  state.loading = false
  state.error = true
  view.rerender(<Dashboard />)
  expect(screen.getByText(/Gagal memuat dashboard/)).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})
