import type { ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Button } from '../../src/components/ui/Button'
import PaginationControls from '../../src/components/PaginationControls'
import ReadFailure from '../../src/components/ReadFailure'

// Missing primitives fail as assertions rather than preventing test collection.
const patterns = import.meta.glob<Record<string, ComponentType<any>>>('../../src/components/ui/*.tsx')
async function pattern(name: string) {
  const load = patterns[`../../src/components/ui/${name}.tsx`]
  expect(load, `${name} presentation primitive`).toBeTypeOf('function')
  return load()
}
const css = readFileSync('src/styles/ui.css', 'utf8')
afterEach(cleanup)

test('page headers provide a main heading, description and owner actions', async () => {
  const { PageHeader } = await pattern('PageHeader')
  render(<PageHeader title="Riwayat Kunjungan Saya" description="Kunjungan yang dapat Anda akses." actions={<Button>Perbarui</Button>} className="owner-header" aria-label="Judul halaman" />)
  const header = screen.getByLabelText('Judul halaman')
  expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Riwayat Kunjungan Saya')
  expect(within(header).getByText('Kunjungan yang dapat Anda akses.')).toBeTruthy()
  expect(within(header).getByRole('button', { name: 'Perbarui' })).toBeTruthy()
  expect(header.classList.contains('owner-header')).toBe(true)
})

test('sections expose independently named regions and preserve content actions', async () => {
  const { Section } = await pattern('Section')
  render(<><Section title="Catatan" actions={<Button>Simpan</Button>}><p>Isi catatan</p></Section><Section title="Lampiran"><p>Isi lampiran</p></Section></>)
  const section = screen.getByRole('region', { name: 'Catatan' })
  expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('Catatan')
  expect(within(section).getByRole('button', { name: 'Simpan' })).toBeTruthy()
  expect(within(section).getByText('Isi catatan')).toBeTruthy()
  expect(section.getAttribute('aria-labelledby')).not.toBe(screen.getByRole('region', { name: 'Lampiran' }).getAttribute('aria-labelledby'))
})

test('fields bind label, hint and error to the owner control', async () => {
  const { Field } = await pattern('Field')
  render(<Field id="visit-note" label="Catatan kunjungan" hint="Isi sesuai kunjungan." error="Catatan diperlukan.">{(control: object) => <input {...control} />}</Field>)
  const input = screen.getByRole('textbox', { name: 'Catatan kunjungan' }) as HTMLInputElement
  const label = screen.getByText('Catatan kunjungan') as HTMLLabelElement
  expect(input.id).toBe(label.htmlFor)
  expect(input.id).toBe('visit-note')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  const described = input.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent)
  expect(described).toEqual(['Isi sesuai kunjungan.', 'Catatan diperlukan.'])
})

test('fields remove stale error associations when the owner clears an error', async () => {
  const { Field } = await pattern('Field')
  const view = render(<Field id="visit-note" label="Catatan" error="Wajib diisi.">{(control: object) => <textarea {...control} />}</Field>)
  view.rerender(<Field id="visit-note" label="Catatan">{(control: object) => <textarea {...control} />}</Field>)
  const input = screen.getByRole('textbox', { name: 'Catatan' })
  expect(input.getAttribute('aria-invalid')).toBeNull()
  expect(input.getAttribute('aria-describedby')).toBeNull()
  expect(screen.queryByText('Wajib diisi.')).toBeNull()
})

test('form actions wrap long owner actions without introducing a form or submitting', async () => {
  const { FormActions } = await pattern('FormActions')
  let submissions = 0
  render(<form onSubmit={event => { event.preventDefault(); submissions += 1 }}><FormActions className="owner-actions" aria-label="Tindakan formulir"><Button>Simpan catatan kunjungan yang sangat panjang</Button><Button variant="secondary">Batal</Button></FormActions></form>)
  const actions = screen.getByLabelText('Tindakan formulir')
  expect(actions.tagName).toBe('DIV')
  expect(actions.classList.contains('owner-actions')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /Simpan catatan/ }))
  expect(submissions).toBe(0)
  expect(css).toMatch(/\.ui-form-actions\s*\{[^}]*flex-wrap:\s*wrap/s)
  expect(css).toMatch(/\.ui-action\s*\{[^}]*overflow-wrap:\s*anywhere/s)
})

test.each([['info', 'status'], ['success', 'status'], ['warning', 'alert'], ['error', 'alert']])('%s notices use %s semantics', async (tone, role) => {
  const { Notice } = await pattern('Feedback')
  render(<Notice tone={tone} title="Informasi hasil" actions={<Button>Coba lagi</Button>}>Rincian hasil.</Notice>)
  const notice = screen.getByRole(role)
  expect(within(notice).getByText('Informasi hasil')).toBeTruthy()
  expect(within(notice).getByText('Rincian hasil.')).toBeTruthy()
  expect(within(notice).getByRole('button', { name: 'Coba lagi' })).toBeTruthy()
})

test('empty results remain distinct from a read failure and its retry action', async () => {
  const { EmptyState } = await pattern('Feedback')
  const retry = vi.fn()
  render(<><EmptyState title="Belum ada kunjungan">Kunjungan akan muncul di sini.</EmptyState><ReadFailure onRetry={retry} /></>)
  const empty = screen.getByRole('region', { name: 'Belum ada kunjungan' })
  expect(within(empty).queryByRole('alert')).toBeNull()
  expect(within(empty).queryByRole('button', { name: 'Coba lagi' })).toBeNull()
  const failure = screen.getByRole('alert')
  const button = within(failure).getByRole('button', { name: 'Coba lagi' }) as HTMLButtonElement
  expect(button.classList.contains('ui-action')).toBe(true)
  expect(button.type).toBe('button')
  fireEvent.click(button)
  expect(retry).toHaveBeenCalledOnce()
})

test('status badges have readable text without live or interactive semantics', async () => {
  const { StatusBadge } = await pattern('Feedback')
  render(<StatusBadge tone="warning" className="owner-badge" aria-label="Status kunjungan">Menunggu</StatusBadge>)
  const badge = screen.getByLabelText('Status kunjungan')
  expect(badge.tagName).toBe('SPAN')
  expect(badge.textContent).toBe('Menunggu')
  expect(badge.getAttribute('role')).toBeNull()
  expect(badge.getAttribute('aria-live')).toBeNull()
  expect(badge.getAttribute('tabindex')).toBeNull()
  expect(badge.classList.contains('owner-badge')).toBe(true)
})

test('filter bars name owner controls without owning a query or a form', async () => {
  const { FilterBar } = await pattern('FilterBar')
  render(<FilterBar label="Filter kunjungan" summary="Hasil untuk pilihan saat ini."><label>Tanggal<input type="date" /></label></FilterBar>)
  const filter = screen.getByRole('region', { name: 'Filter kunjungan' })
  expect(within(filter).getByLabelText('Tanggal')).toBeTruthy()
  expect(within(filter).getByText('Hasil untuk pilihan saat ini.')).toBeTruthy()
  expect(filter.querySelector('form')).toBeNull()
})

test('record lists preserve domain list items and accessible labels', async () => {
  const { RecordList } = await pattern('RecordList')
  render(<RecordList label="Daftar kunjungan" className="owner-list"><li>Catatan kunjungan</li></RecordList>)
  const list = screen.getByRole('list', { name: 'Daftar kunjungan' })
  expect(list.tagName).toBe('UL')
  // Preserve list semantics in browsers that suppress markerless native lists.
  expect(list.getAttribute('role')).toBe('list')
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  expect(list.classList.contains('owner-list')).toBe(true)
})

test('summary lists associate domain labels with their values', async () => {
  const { SummaryList } = await pattern('SummaryList')
  const { container } = render(<SummaryList aria-label="Ringkasan kunjungan" items={[{ label: 'Waktu', value: <time>Waktu tidak tersedia</time> }, { label: 'Catatan', value: 'Tersimpan' }]} />)
  expect(screen.getByLabelText('Ringkasan kunjungan').tagName).toBe('DL')
  expect(Array.from(container.querySelectorAll('dt')).map(node => node.textContent)).toEqual(['Waktu', 'Catatan'])
  expect(Array.from(container.querySelectorAll('dd')).map(node => node.textContent)).toEqual(['Waktu tidak tersedia', 'Tersimpan'])
})

test('pagination displays zero of zero with both actions disabled for empty results', () => {
  const change = vi.fn()
  render(<PaginationControls page={1} total={0} pageSize={20} pending={false} onPageChange={change} />)
  expect(screen.getByText('0–0 dari 0')).toBeTruthy()
  expect(screen.getByText('Halaman 0 dari 0')).toBeTruthy()
  for (const name of ['Sebelumnya', 'Berikutnya']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
  }
  expect(change).not.toHaveBeenCalled()
})

test('pagination retains prior results while pending and delegates page changes to its owner', () => {
  const change = vi.fn()
  const view = render(<PaginationControls page={2} total={50} pageSize={20} pending onPageChange={change} />)
  expect(screen.getByText('21–40 dari 50')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('hasil sebelumnya')
  expect((screen.getByRole('button', { name: 'Berikutnya' }) as HTMLButtonElement).disabled).toBe(true)
  view.rerender(<PaginationControls page={2} total={50} pageSize={20} pending={false} onPageChange={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }))
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  expect(change.mock.calls).toEqual([[1], [3]])
})

test('document language is Indonesian', () => {
  expect(readFileSync('index.html', 'utf8')).toMatch(/<html lang="id">/)
})
