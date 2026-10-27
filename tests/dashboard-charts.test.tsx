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
  await screen.findByRole('img', { name: 'Tren Pengiriman PO Harian' })
  const option = state.charts['Tren Pengiriman PO Harian']
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
  const region = await screen.findByRole('region', { name: 'Nilai PO vs Pengiriman PO Bulanan' })
  const control = within(region).getByRole('button', { name: 'PO terkirim' })
  expect(control.getAttribute('aria-pressed')).toBe('true')
  expect(control.classList.contains('border-dashed')).toBe(false)
  fireEvent.click(control)
  await waitFor(() => expect(state.charts['Nilai PO vs Pengiriman PO Bulanan'].legend.selected['PO terkirim']).toBe(false))
  expect(control.getAttribute('aria-pressed')).toBe('false')
  expect(control.classList.contains('border-dashed')).toBe(true)
  expect(control.classList.contains('border-brand-control-border')).toBe(true)
  expect(state.data.metrics.totalPOValue).toBe('1000000')
  expect(state.charts['Nilai PO vs Pengiriman PO Bulanan'].series[1].data).toEqual([0])
  fireEvent.click(control)
  expect(control.getAttribute('aria-pressed')).toBe('true')
  expect(control.classList.contains('border-brand-control-border')).toBe(false)
})

test('all daily values remain in the chart with date zoom and an accessible data table', async () => {
  state.data.dailySeries = Array.from({ length: 40 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Tren Pengiriman PO Harian' })
  const option = state.charts['Tren Pengiriman PO Harian']
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
  await waitFor(() => expect(state.charts['Tren Pengiriman PO Harian'].dataZoom[0].startValue).toBe(12))
  expect(slider.getAttribute('aria-valuetext')).toBe('Day 12')
  fireEvent.click(screen.getByRole('button', { name: 'Tampilkan semua tanggal' }))
  await waitFor(() => expect(state.charts['Tren Pengiriman PO Harian'].dataZoom[0].startValue).toBe(0))
  expect(state.charts['Tren Pengiriman PO Harian'].series[0].data).toHaveLength(40)
})

test('filter data replacement clears old marks and resets daily zoom', async () => {
  state.data.dailySeries = Array.from({ length: 40 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  const view = render(<Dashboard />)
  const slider = await screen.findByRole('slider', { name: 'Tanggal mulai grafik' })
  fireEvent.change(slider, { target: { value: '12' } })
  state.data = { ...state.data, dailySeries: [{ key: '2026-10-01', label: '1 Okt', deliveredValue: '0', sjCount: 0 }] }
  view.rerender(<Dashboard />)
  await waitFor(() => expect(state.charts['Tren Pengiriman PO Harian'].series[0].data).toEqual([0]))
  expect(state.charts['Tren Pengiriman PO Harian'].xAxis.data).toEqual(['2026-10-01'])
  expect(screen.queryByRole('slider', { name: 'Tanggal mulai grafik' })).toBeNull()
})

test('empty composition and all-zero deliveries have explicit honest messages', async () => {
  state.data.customerShare = []
  state.data.statusBreakdown = []
  state.data.dailySeries[0].sjCount = 0
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Tren Pengiriman PO Harian' })
  expect(within(region).getByText('Belum ada pengiriman PO pada periode ini.')).toBeTruthy()
  expect(screen.getAllByText('Belum ada data pada filter ini.')).toHaveLength(2)
})

test('customer names remain literal text and chart tooltips do not use HTML rendering', async () => {
  render(<Dashboard />)
  await screen.findByRole('img', { name: 'Kontribusi Pelanggan' })
  expect(state.charts['Kontribusi Pelanggan'].tooltip.renderMode).toBe('richText')
  expect(state.charts['Kontribusi Pelanggan'].yAxis.data).toEqual([state.data.customerShare[0].label])
  expect(document.querySelector('img')).toBeNull()
})

test.each(['Pelanggan Teratas', 'Rincian Barang Belum Terkirim'].flatMap(title =>
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
    const labels = title === 'Pelanggan Teratas' ? [customerName] : [sku, productName]
    for (const label of labels) {
      const cell = within(table).getByText(label)
      expect(cell.classList.contains('[overflow-wrap:anywhere]')).toBe(true)
    }
    expect(within(table).getAllByRole('cell')).toHaveLength(5)
  } else {
    expect(within(table).getByRole('cell').getAttribute('colspan')).toBe('5')
  }
})

test('loading and query errors remain unavailable instead of showing fabricated zero charts', () => {
  state.data = undefined
  state.loading = true
  const view = render(<Dashboard />)
  expect(screen.getByText('Memuat dashboard Pengadaan...')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
  state.loading = false
  state.error = true
  view.rerender(<Dashboard />)
  expect(screen.getByText(/Gagal memuat dashboard/)).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})

test('large KPI and customer totals retain exact values in shrinkable wrapping containers', async () => {
  state.data.metrics.totalPOValue = '999999999999999.99'
  render(<Dashboard />)
  await screen.findByRole('img', { name: 'Kontribusi Pelanggan' })
  const kpi = screen.getByText('Total PO', { selector: 'p' }).parentElement!
  expect(kpi.classList.contains('min-w-0')).toBe(true)
  expect(kpi.children[1].classList.contains('[overflow-wrap:anywhere]')).toBe(true)
  expect(kpi.children[1].textContent).toBe('Rp999.999.999.999.999,99')
  const customer = screen.getByRole('region', { name: 'Kontribusi Pelanggan' })
  expect(within(customer).getByText('Rp999.999.999.999.999,99').classList.contains('[overflow-wrap:anywhere]')).toBe(true)
})

test.each(['Pelanggan Teratas', 'Rincian Barang Belum Terkirim'])('%s exposes a keyboard-accessible contained table without squeezing its columns', async title => {
  render(<Dashboard />)
  await screen.findByRole('img', { name: 'Kontribusi Pelanggan' })
  const scroll = screen.getByRole('region', { name: `Tabel ${title}` })
  expect(scroll.tabIndex).toBe(0)
  expect(scroll.parentElement!.textContent).toContain('Geser tabel untuk melihat semua kolom.')
  expect(scroll.classList.contains('overflow-x-auto')).toBe(true)
  expect(within(scroll).getByRole('table').className).toMatch(/min-w-\[/)
})

test('average PO denominator names all filtered orders and keeps completed count separate', async () => {
  state.data.metrics = { ...state.data.metrics, totalPOCount: 249, totalPOValue: '2490000', averagePOValue: '10000', completedPOCount: 167 }
  render(<Dashboard />)
  const label = screen.getByText('Rata-rata Nilai PO')
  expect(label.parentElement!.textContent).toContain('Total nilai PO ÷ 249 PO pada filter ini')
  expect(label.parentElement!.textContent).not.toContain('167')
  expect(screen.getByText('PO selesai: 167 dari 249 PO pada filter ini.')).toBeTruthy()
})

test('average PO uses currency precision without changing totals or the filtered denominator', () => {
  state.data.metrics = { ...state.data.metrics, totalPOCount: 2, totalPOValue: '9010499.69', deliveredValue: '0.001', outstandingValue: '9010499.689', averagePOValue: '4505249.845' }
  render(<Dashboard />)
  const average = screen.getByText('Rata-rata Nilai PO').parentElement!
  expect(within(average).getByText('Rp4.505.249,85')).toBeTruthy()
  expect(within(average).getByText('Total nilai PO ÷ 2 PO pada filter ini')).toBeTruthy()
  expect(screen.getByText('Total PO', { selector: 'p' }).parentElement!.children[1].textContent).toBe('Rp9.010.499,69')
  expect(screen.getByText('Nilai Terkirim').parentElement!.children[1].textContent).toBe('Rp0,001')
  expect(screen.getByText('Nilai Belum Terkirim').parentElement!.children[1].textContent).toBe('Rp9.010.499,689')
})

test('zero PO average remains an available zero when filtered orders exist', () => {
  state.data.metrics = { ...state.data.metrics, totalPOValue: '0', outstandingValue: '0', averagePOValue: '0.00' }
  render(<Dashboard />)
  const average = screen.getByText('Rata-rata Nilai PO').parentElement!
  expect(within(average).getByText('Rp0')).toBeTruthy()
  expect(within(average).queryByText('Belum tersedia')).toBeNull()
  expect(within(average).getByText('Total nilai PO ÷ 2 PO pada filter ini')).toBeTruthy()
})

test('customer branches remain distinct with an open keyboard-readable full-name table', async () => {
  const names = ['PT.CATURKARDUS INTERNASIONAL CABANG SURABAYA', 'PT.CATURKARDUS INTERNASIONAL CABANG MALANG', 'PT.CATURKARDUS INTERNASIONAL CABANG KEDIRI']
  state.data.customerShare = names.map(label => ({ label, value: '10000', color: '#2563eb' }))
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Kontribusi Pelanggan' })
  const table = within(region).getByRole('region', { name: 'Data Kontribusi Pelanggan' })
  expect(table.closest('details')?.open).toBe(true)
  table.focus()
  expect(document.activeElement).toBe(table)
  for (const name of names) expect(within(table).getByRole('rowheader', { name })).toBeTruthy()
  const axis = state.charts['Kontribusi Pelanggan'].yAxis
  expect(axis.axisLabel.overflow).not.toBe('truncate')
  expect(new Set(names.map((name, index) => axis.axisLabel.formatter(name, index))).size).toBe(3)
  for (const [index, branch] of ['SURABAYA', 'MALANG', 'KEDIRI'].entries()) expect(axis.axisLabel.formatter(names[index], index)).toContain(branch)
})

test('dashboard identifies date/status scope and distinguishes zero PO average from an undefined denominator', () => {
  state.data.metrics = { ...state.data.metrics, totalPOCount: 0, averagePOValue: '0', completedPOCount: 0 }
  render(<Dashboard />)
  expect(screen.getByRole('option', { name: 'Dikonfirmasi' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Dalam proses' })).toBeTruthy()
  expect(screen.getByText(/Tanggal PO:.*Semua status.*Semua pengiriman/)).toBeTruthy()
  expect(screen.getByText('Rata-rata Nilai PO').parentElement!.textContent).toContain('Belum tersedia')
})

test('chart and outstanding-item scope exposes the wider PO source and excluded fulfillment filter', async () => {
  render(<Dashboard />)
  fireEvent.change(screen.getByLabelText('Tanggal awal'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('Tanggal akhir'), { target: { value: '2026-10-10' } })
  for (const title of ['Nilai PO vs Pengiriman PO Bulanan', 'Tren Pengiriman PO Harian']) {
    const region = await screen.findByRole('region', { name: title })
    expect(region.textContent).toContain('1 September 2026 – 10 Oktober 2026')
    expect(region.textContent).toContain('tanpa filter status pengiriman')
  }
  const items = screen.getByRole('heading', { name: 'Rincian Barang Belum Terkirim' }).parentElement!
  expect(items.textContent).toContain('1 September 2026 – 10 Oktober 2026')
  expect(items.textContent).toContain('tanpa filter status pengiriman')
})

test('monthly chart states the narrow selected PO period and explains outside-filter zero buckets', async () => {
  state.data.monthlySeries = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 10 + index, 1))
    return { key: date.toISOString().slice(0, 7), label: date.toLocaleDateString('id-ID', { month: 'short', year: 'numeric', timeZone: 'UTC' }), poValue: index >= 9 ? '10000' : '0', deliveredValue: '0' }
  })
  render(<Dashboard />)
  fireEvent.change(screen.getByLabelText('Tanggal awal'), { target: { value: '2026-08-01' } })
  fireEvent.change(screen.getByLabelText('Tanggal akhir'), { target: { value: '2026-10-10' } })
  const region = await screen.findByRole('region', { name: 'Nilai PO vs Pengiriman PO Bulanan' })
  expect(region.textContent).toContain('Total PO: tanggal PO 1 Agustus 2026 – 10 Oktober 2026')
  expect(region.textContent).toContain('sumber PO 1 November 2025 – 10 Oktober 2026')
  expect(region.textContent).toContain('Bulan di luar rentang tanggal PO ditampilkan Rp0 karena tidak termasuk filter')
  expect(region.textContent).toContain('bukan bukti tidak ada pesanan')
  expect(state.charts['Nilai PO vs Pengiriman PO Bulanan'].series[0].data).toEqual([...Array(9).fill(0), 10000, 10000, 10000])
})

test('reachable chart actions use the shared control contract with readable supporting and data text', async () => {
  state.data.dailySeries = Array.from({ length: 16 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Nilai PO vs Pengiriman PO Bulanan' })
  const toggle = within(region).getByRole('button', { name: 'PO terkirim' })
  expect(toggle.classList.contains('ui-action')).toBe(true)
  expect(toggle.classList.contains('min-h-9')).toBe(false)
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(toggle.className).not.toMatch(/text-slate-400|text-xs/)
  const reset = screen.getByRole('button', { name: 'Tampilkan semua tanggal' })
  expect(reset.classList.contains('ui-action')).toBe(true)
  for (const table of document.querySelectorAll('table')) expect(table.classList.contains('text-sm')).toBe(true)
  expect(document.querySelectorAll('[class~="text-xs"]')).toHaveLength(0)
  for (const summary of document.querySelectorAll('summary')) expect(summary.tagName).toBe('SUMMARY')
})

test('reachable dashboard empty table and chart explanations use legible secondary text', async () => {
  state.data.customerShare = []; state.data.statusBreakdown = []
  render(<Dashboard />)
  await screen.findByRole('region', { name: 'Kontribusi Pelanggan' })
  for (const copy of screen.getAllByText('Belum ada data pada filter ini.')) expect(copy.classList.contains('text-brand-secondary')).toBe(true)
  for (const title of ['Pelanggan Teratas', 'Rincian Barang Belum Terkirim']) {
    const region = screen.getByRole('region', { name: `Tabel ${title}` })
    expect(within(region).getByRole('cell').classList.contains('text-brand-secondary')).toBe(true)
  }
})

test('native chart ranges and disclosures opt into the approved hit-area contract without replacing native semantics', async () => {
  state.data.dailySeries = Array.from({ length: 16 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  render(<Dashboard />)
  const region = await screen.findByRole('region', { name: 'Tren Pengiriman PO Harian' })
  for (const input of within(region).getAllByRole('slider')) { expect(input.tagName).toBe('INPUT'); expect(input.classList.contains('min-h-[var(--ui-control-size)]')).toBe(true) }
  for (const summary of document.querySelectorAll('summary')) {
    expect(summary.classList.contains('min-h-[var(--ui-control-size-compact)]')).toBe(true)
    expect(summary.classList.contains('py-[var(--ui-control-padding-y-compact)]')).toBe(true)
    expect(summary.className).not.toMatch(/list-none|marker:hidden/)
    expect(summary.parentElement?.tagName).toBe('DETAILS')
  }
})


test('compact chart controls inherit responsive tokens without shrinking tables or replacing native markers', async () => {
 state.data.dailySeries = Array.from({ length: 16 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
 render(<Dashboard />); await screen.findByRole('region', { name: 'Tren Pengiriman PO Harian' })
 for (const action of screen.getAllByRole('button')) {
   expect(action.classList.contains('ui-action--compact')).toBe(true)
   expect(action.classList.contains('ui-action--quiet')).toBe(true)
 }
 for (const summary of document.querySelectorAll('summary')) {
   expect(summary.classList.contains('min-h-[var(--ui-control-size-compact)]')).toBe(true)
   expect(summary.classList.contains('py-[var(--ui-control-padding-y-compact)]')).toBe(true)
   expect(summary.className).not.toMatch(/min-h-11|py-2|inline-flex|list-none|marker:hidden/)
 }
 for (const slider of screen.getAllByRole('slider')) expect(slider.classList.contains('min-h-[var(--ui-control-size)]')).toBe(true)
 for (const table of document.querySelectorAll('table')) expect(table.classList.contains('text-sm')).toBe(true)
})
