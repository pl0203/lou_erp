import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MySalesDashboard } from '../../src/components/sales/MySalesDashboard'
import { TeamSalesDashboard } from '../../src/components/sales/TeamSalesDashboard'
import { dashboardFixture, syntheticId } from './fixtures'
import type { DashboardData, DashboardMetric } from '../../src/lib/salesDashboard/contracts'
afterEach(cleanup)
const props = (data: DashboardData) => ({ data, month: data.month, search: '', onMonth: vi.fn(), onSearch: vi.fn(), onPage: vi.fn(), onRefresh: vi.fn() })
function view(data = dashboardFixture()) { const controls = props(data); render(<MemoryRouter><MySalesDashboard {...controls} /></MemoryRouter>); return controls }
function team(data = dashboardFixture('team'), metric: DashboardMetric = 'poDeliveryValue') { const controls = { ...props(data), metric, onMetric: vi.fn() }; render(<MemoryRouter><TeamSalesDashboard {...controls} /></MemoryRouter>); return controls }

describe('approved personal V3 dashboard', () => {
  test('starts with own daily actions and exposes five distinct stages with separate bases', () => {
    view()
    expect(screen.getByRole('heading', { name: 'Ringkasan Saya' })).toBeTruthy()
    const actions = screen.getByRole('region', { name: 'Prioritas hari ini' }), outcomes = screen.getByRole('region', { name: 'Pesanan masuk dan realisasi penjualan' })
    expect(actions.compareDocumentPosition(outcomes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(actions).getByText('2 / 6 jadwal dikunjungi')).toBeTruthy()
    expect(within(actions).getByText('4 jadwal belum dikunjungi hari ini')).toBeTruthy()
    expect(within(actions).getByRole('link', { name: /Buka jadwal saya/ }).getAttribute('href')).toBe('/girard/schedule')
    for (const label of ['Jumlah PO masuk', 'Nilai total PO', 'Nilai PO dikirim', 'CO dikirim ke pelanggan', 'CO menjadi penjualan']) expect(within(outcomes).getByRole('heading', { name: label })).toBeTruthy()
    expect(within(outcomes).getAllByText(/tanggal PO/)).toHaveLength(2)
    expect(within(outcomes).getByText(/tanggal SJ tidak batal/)).toBeTruthy()
    expect(within(outcomes).getByText(/bulan laporan diposting/)).toBeTruthy()
    expect(within(outcomes).getByText(/Tanpa laporan bukan berarti penjualan nol/)).toBeTruthy()
  })
  test('published targets are read-only, matching basis; partial CO is explicitly not scored', () => {
    const data = dashboardFixture(); data.summary.coSaleValue = { value: '0', quality: 'partial' }; data.targets.co_sale_value = { metric: 'co_sale_value', month: data.month, state: 'published', amount: '100' }; view(data)
    const outcome = screen.getByRole('region', { name: 'Pesanan masuk dan realisasi penjualan' })
    const card = within(outcome).getByRole('heading', { name: 'CO menjadi penjualan' }).closest('article')!
    expect(within(card).getByText('Rp 0')).toBeTruthy(); expect(within(card).getByText(/Capaian belum dapat dihitung/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ubah target|Simpan target/ })).toBeNull()
  })
  test('a small list has no pagination, and mobile customer details are initially compact', () => {
    view(dashboardFixture('own', 5))
    expect(screen.queryByRole('navigation', { name: 'Halaman pelanggan' })).toBeNull()
    const list = screen.getByRole('list', { name: 'Kartu pelanggan' })
    expect(list.querySelectorAll('details')).toHaveLength(5)
    expect(Array.from(list.querySelectorAll('details')).every(detail => !detail.open)).toBe(true)
    fireEvent.click(within(list).getByText('Pelanggan Contoh 1'))
    expect(list.querySelector('details')?.open).toBe(true)
  })
  test('42 customers use full-filter summary, page navigation, and server search callbacks', () => {
    const controls = view(dashboardFixture('own', 42))
    expect(screen.getByText(/Seluruh 42 pelanggan/)).toBeTruthy()
    expect(screen.getByText('1–10 dari 42')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); expect(controls.onPage).toHaveBeenCalledWith(2)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cari pelanggan' }), { target: { value: 'Toko baru' } }); expect(controls.onSearch).toHaveBeenCalledWith('Toko baru')
    expect(screen.getByText(/Pencarian memperbarui KPI dan daftar/)).toBeTruthy()
  })
  test('empty customer list is explicit without fake totals or count-target controls', () => {
    view(dashboardFixture('own', 0))
    expect(screen.getByText('Tidak ada pelanggan dalam hasil ini.')).toBeTruthy()
    expect(screen.queryByText(/Target jumlah PO|Target jumlah CO/)).toBeNull()
  })
  test('missing activity does not become a completed zero or empty queue claim', () => {
    const data = dashboardFixture(); data.activity.todayScheduled = null; data.activity.todayVisited = null; data.activity.todayMatchedScheduled = null; data.activity.pendingRequests = null; view(data)
    const actions = screen.getByRole('region', { name: 'Prioritas hari ini' })
    expect(within(actions).getByText('Ringkasan jadwal belum tersedia')).toBeTruthy()
    expect(within(actions).getByText('Status permintaan belum tersedia')).toBeTruthy()
    expect(within(actions).queryByText(/0 \/ 0|0 permintaan/)).toBeNull()
  })
})

describe('approved manager/head V6 dashboard', () => {
  test('shows contextual attention before achievement, matched target gap, and five metric choices', () => {
    team()
    const attention = screen.getByRole('region', { name: 'Perlu ditindaklanjuti' }), achievement = screen.getByRole('region', { name: 'Pencapaian sementara' })
    expect(attention.compareDocumentPosition(achievement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(achievement).getByText('40%')).toBeTruthy(); expect(within(achievement).getByText(/Selisih ke target: Rp 12.000.000/)).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Metrik hasil' }).querySelectorAll('option')).toHaveLength(5)
    expect(screen.getByText(/Bulan belum selesai/)).toBeTruthy()
    expect(screen.queryByText(/Peringkat terburuk|Sales buruk|Skor keseluruhan/)).toBeNull()
  })
  test('count metric has no monetary target or attainment percentage', () => {
    team(dashboardFixture('team'), 'coShippedCount')
    const achievement = screen.getByRole('region', { name: 'Pencapaian sementara' })
    expect(within(achievement).getByText('1 CO')).toBeTruthy()
    expect(within(achievement).getByText(/Target hitungan tidak digunakan/)).toBeTruthy()
    expect(within(achievement).queryByText('40%')).toBeNull()
  })
  test('head groups people by verified manager without counting group subtotal again', () => {
    const data = dashboardFixture('leadership', 3)
    data.items[2].managerId = syntheticId(91); data.items[2].managerName = 'Manajer Kedua'; team(data)
    expect(screen.getByRole('heading', { name: 'Tim Manajer Contoh' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tim Manajer Kedua' })).toBeTruthy()
    expect(screen.getByText(/Setiap target individu dihitung sekali/)).toBeTruthy()
  })
  test('unknown hierarchy is a disclosed issue, not guessed reassignment', () => {
    const data = dashboardFixture('leadership'); data.items[0].managerId = null; data.items[0].managerName = null; team(data)
    expect(screen.getByRole('heading', { name: 'Hierarki belum terverifikasi' })).toBeTruthy()
  })
  test('zero schedules has no visit rate and customer transfers never rewrite history', () => {
    const data = dashboardFixture('team'); data.items[0].activity.scheduled = '0'; data.items[0].activity.visited = '0'; team(data)
    expect(screen.getAllByText('Tanpa jadwal; rasio tidak dihitung').length).toBeGreaterThan(0)
    expect(screen.getByText(/Kredit penjualan tetap mengikuti PO\/CO asli/)).toBeTruthy()
  })
  test('30 people paginate, 3 people do not, and person details reveal all measures', () => {
    const controls = team(dashboardFixture('team', 30))
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); expect(controls.onPage).toHaveBeenCalledWith(2)
    cleanup(); team(dashboardFixture('team', 3)); expect(screen.queryByRole('navigation', { name: 'Halaman sales' })).toBeNull()
    const first = screen.getAllByText('Rincian Sales Contoh 1')[0].closest('details')!; fireEvent.click(first.querySelector('summary')!)
    expect(first.open).toBe(true); expect(within(first).getByText('CO dikirim ke pelanggan')).toBeTruthy()
  })
})

test('filtered customer actuals are not scored against an unallocated full-person target', () => {
  const data = dashboardFixture(), controls = { ...props(data), search: 'Pelanggan Contoh' }
  render(<MemoryRouter><MySalesDashboard {...controls} /></MemoryRouter>)
  const outcome = screen.getByRole('region', { name: 'Pesanan masuk dan realisasi penjualan' })
  const card = within(outcome).getByRole('heading', { name: 'Nilai PO dikirim' }).closest('article')!
  expect(within(card).queryByText('40%')).toBeNull()
  expect(within(card).getByText(/Target orang tidak dialokasikan per pelanggan/)).toBeTruthy()
})
test('mixed targeted and N\/A group is explicitly noncomparable', () => {
  const data = dashboardFixture('team'); data.targets.po_delivery_value = { ...data.targets.po_delivery_value, state: 'partial', amount: null }; team(data)
  const achievement = screen.getByRole('region', { name: 'Pencapaian sementara' })
  expect(within(achievement).queryByText('40%')).toBeNull()
  expect(within(achievement).getByText(/Target belum lengkap untuk seluruh cakupan/)).toBeTruthy()
})


test('missing matched-schedule source falls back to independent counts, never a made-up remaining count', () => {
  const data = dashboardFixture(); data.activity.todayMatchedScheduled = null; view(data)
  const actions = screen.getByRole('region', { name: 'Prioritas hari ini' })
  expect(within(actions).getByText('3 pelanggan dikunjungi · 6 jadwal')).toBeTruthy()
  expect(within(actions).queryByText(/jadwal belum dikunjungi hari ini/)).toBeNull()
})

test('customer sorting and visit/report filters call whole-filter server controls, not local row sorting', () => {
  const data = dashboardFixture('own', 42), onSort = vi.fn(), onAttention = vi.fn()
  render(<MemoryRouter><MySalesDashboard {...props(data)} sort="name" attention="all" onSort={onSort} onAttention={onAttention} /></MemoryRouter>)
  fireEvent.change(screen.getByRole('combobox', { name: 'Urutkan pelanggan' }), { target: { value: 'po_order_value_desc' } })
  expect(onSort).toHaveBeenCalledWith('po_order_value_desc')
  fireEvent.change(screen.getByRole('combobox', { name: 'Fokus pelanggan' }), { target: { value: 'unvisited' } })
  expect(onAttention).toHaveBeenCalledWith('unvisited')
  expect(screen.getByText(/Seluruh 42 pelanggan/)).toBeTruthy()
})
test('a customer attention subset cannot reuse an unallocated full-person target', () => {
  render(<MemoryRouter><MySalesDashboard {...props(dashboardFixture())} attention="missing_co" /></MemoryRouter>)
  const outcomes = screen.getByRole('region', { name: 'Pesanan masuk dan realisasi penjualan' })
  expect(within(outcomes).queryByText('40%')).toBeNull()
  expect(within(outcomes).getAllByText(/Target orang tidak dialokasikan per pelanggan/)).toHaveLength(3)
})
test('manager attention filter exposes incomplete targets, not customer visit-filter semantics', () => {
  const onAttention = vi.fn()
  render(<MemoryRouter><TeamSalesDashboard {...props(dashboardFixture('team'))} metric="poDeliveryValue" onMetric={vi.fn()} attention="all" onAttention={onAttention} /></MemoryRouter>)
  const filter = screen.getByRole('combobox', { name: 'Fokus sales' })
  expect(within(filter).queryByRole('option', { name: /Belum dikunjungi/ })).toBeNull()
  fireEvent.change(filter, { target: { value: 'target_incomplete' } }); expect(onAttention).toHaveBeenCalledWith('target_incomplete')
})
test('two completed-month trend points compare the same cohort while a partial CO comparison is withheld', () => {
  const data = dashboardFixture(); data.trend![0].metrics.poDeliveryValue.value = '4000000.00'
  view(data)
  const details = screen.getByText('Tren metrik · perbandingan bulan penuh').closest('details')!
  fireEvent.click(details.querySelector('summary')!)
  expect(within(details).getByText('+100% · September 2026 dibanding Agustus 2026')).toBeTruthy()
  expect(within(details).getByText(/Cakupan pelanggan\/orang sama dengan hasil filter yang dipilih/)).toBeTruthy()
  fireEvent.change(within(details).getByRole('combobox', { name: 'Metrik hasil' }), { target: { value: 'coSaleValue' } })
  expect(within(details).getByText(/Perbandingan tidak tersedia tanpa dua bulan lengkap/)).toBeTruthy()
})

test('team trend uses the selected metric without another metric selector or a current-month/full-month comparison', () => {
  const data = dashboardFixture('team'); data.trend![0].metrics.poDeliveryValue.value = '4000000.00'; team(data)
  const details = screen.getByText('Tren metrik · perbandingan bulan penuh').closest('details')!
  fireEvent.click(details.querySelector('summary')!)
  expect(within(details).queryByRole('combobox')).toBeNull()
  expect(within(details).getByText('+100% · September 2026 dibanding Agustus 2026')).toBeTruthy()
  expect(within(details).queryByText(/Oktober 2026 dibanding/)).toBeNull()
})
test('future results do not show a historical trend as if it were future achievement', () => {
  const data = dashboardFixture('team'); data.month = '2026-11-01'; team(data)
  const details = screen.getByText('Tren metrik · perbandingan bulan penuh').closest('details')!
  fireEvent.click(details.querySelector('summary')!)
  expect(within(details).getByText('Perbandingan belum tersedia untuk periode mendatang.')).toBeTruthy()
  expect(within(details).queryByText(/dibanding Agustus/)).toBeNull()
})
