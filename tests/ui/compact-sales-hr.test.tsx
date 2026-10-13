import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import PaginationControls from '../../src/components/PaginationControls'

const source = (path: string) => readFileSync(`src/${path}`, 'utf8')
afterEach(cleanup)

test('shared result pagination is quiet compact navigation with retained pending and boundary locks', () => {
  const onPageChange = vi.fn()
  const { rerender } = render(<PaginationControls page={2} total={50} pageSize={20} pending={false} onPageChange={onPageChange} />)
  for (const name of ['Sebelumnya', 'Berikutnya']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.type).toBe('button')
    expect(button.classList.contains('ui-action--quiet')).toBe(true)
    expect(button.classList.contains('ui-action--compact')).toBe(true)
  }
  expect(screen.getByText('21–40 dari 50')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  expect(onPageChange).toHaveBeenLastCalledWith(3)
  rerender(<PaginationControls page={2} total={50} pageSize={20} pending onPageChange={onPageChange} />)
  for (const button of screen.getAllByRole('button')) { expect((button as HTMLButtonElement).disabled).toBe(true); fireEvent.click(button) }
  expect(onPageChange).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toContain('Menampilkan hasil sebelumnya')
  rerender(<PaginationControls page={1} total={0} pageSize={20} pending={false} onPageChange={onPageChange} />)
  expect(screen.getByText('0–0 dari 0')).toBeTruthy()
  expect(screen.getByText('Halaman 0 dari 0')).toBeTruthy()
  for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
})

test('navigation shell inherits shared responsive sizing while preserving active cues and wrapping', () => {
  const css = source('components/navigation.css')
  expect(css).toContain('min-height: var(--ui-control-size)')
  expect(css).toContain('width: var(--ui-control-size)')
  expect(css).toContain('font-size: var(--ui-text-control)')
  expect(css).toContain('line-height: var(--ui-line-control)')
  expect(css).toContain('overflow-wrap: anywhere')
  expect(css).not.toMatch(/min-height:\s*(?:46|48)px/)
  expect(css).toMatch(/\.navigation-link-active\s*\{[^}]*border-left-color:\s*var\(--color-brand-primary\)/)
})

test('metrics pagination and customer category do not override shared responsive controls', () => {
  expect(source('components/sales/SalesMetricSummary.tsx')).not.toMatch(/\[&_button\]:(?:min-h-11|min-w-11|text-base)/)
  expect(source('pages/girard/GirardCustomers.tsx')).not.toMatch(/\[&_select\]:(?:min-h-11|text-base)/)
  const approvals = source('pages/athel/SalesOrders.tsx')
  expect(approvals.match(/className="ui-control/g)).toHaveLength(2)
  expect(approvals).not.toContain('px-3 py-2 text-base')
  expect(source('pages/girard/VisitPage.tsx')).toContain('className="ui-control')
})

test.each([
  ['pages/ihr/leave/OwnLeaveHistory.tsx', 'Lihat rincian'],
  ['pages/ihr/leave/AssignedApprovalInbox.tsx', 'Tinjau permintaan'],
  ['pages/ihr/leave/OwnRequestActions.tsx', 'Minta pembatalan seluruh pengajuan'],
  ['pages/ihr/leave/LeaveTabs.tsx', 'role="tab"'],
])('ref-bearing native HR controls use shared compact quiet classes: %s', (path, label) => {
  const text = source(path)
  expect(text).toContain(label)
  expect(text).toContain('ui-action ui-action--quiet ui-action--compact')
})

test.each([
  'pages/ihr/leave/LeavePolicySettings.tsx', 'pages/ihr/leave/LeaveBalanceSettings.tsx',
  'pages/ihr/leave/LeavePeopleSettings.tsx', 'pages/ihr/leave/LeaveRotaSettings.tsx',
])('HR checkbox labels inherit shared target and label sizing without text-field geometry: %s', path => {
  const text = source(path)
  expect(text).toContain('min-h-[var(--ui-control-size)]')
  expect(text).toContain('text-[length:var(--ui-text-label)]')
  expect(text).toContain('leading-[var(--ui-line-control)] font-medium')
  expect(text).not.toContain('flex min-h-11 items-center gap-2 text-base')
  expect(text).not.toMatch(/<input[^>]*type="checkbox"[^>]*className="ui-control/)
})

test.each([
  ['pages/ihr/UserManagement.tsx', 'User directory'],
  ['pages/ihr/leave/LeaveRequestForm.tsx', 'Rincian tanggal dan potongan'],
  ['pages/ihr/leave/OwnLeaveHistory.tsx', 'Tanggal cuti yang disimpan'],
  ['pages/ihr/leave/LeaveAdminPrivatePanel.tsx', 'Tanggal dan potongan yang disimpan'],
])('owned wide tables retain labelled keyboard-accessible scroll regions: %s', (path, label) => {
  expect(source(path)).toContain(`role="region" aria-label="${label}" tabIndex={0}`)
})

test('camera targets remain purpose-specific and HR form commits remain deliberately primary', () => {
  expect(source('pages/girard/VisitPage.tsx')).toContain('w-full h-36 border-2 border-dashed')
  const target = source('components/sales/InlineTargetEditor.tsx')
  expect(target).toMatch(/<Button onClick=\{\(\) => targetEditors.save/)
  expect(target).toContain('pending={draft.pending}')
  const rota = source('pages/ihr/leave/LeaveRotaSettings.tsx')
  expect(rota).toContain('variant={calendarResult?.impacts.available?\'secondary\':\'primary\'}')
  expect(rota).toContain('variant={result?.impacts.available?\'secondary\':\'primary\'}')
  for (const path of ['pages/ihr/leave/LeavePeopleSettings.tsx', 'pages/ihr/leave/LeaveAdminSettings.tsx']) expect(source(path)).toContain('variant="primary"')
})

test('narrow Sales action groups wrap and HR evidence columns permit long identifiers to break', () => {
  for (const path of ['pages/girard/DailySchedule.tsx', 'pages/girard/MyVisits.tsx']) expect(source(path)).toContain('px-5 py-4 flex flex-wrap gap-3')
  expect(source('pages/ihr/leave/LeaveGovernanceSettings.tsx')).toContain('grid-cols-[auto_minmax(0,1fr)]')
  expect(source('pages/ihr/leave/LeaveGovernanceSettings.tsx')).toContain('[overflow-wrap:anywhere]')
  expect(source('pages/ihr/leave/LeaveAccessSettings.tsx')).toContain('[overflow-wrap:anywhere]')
})

test('raw Sales approval and visit-note labels use the same responsive label contract', () => {
  expect(source('pages/athel/SalesOrders.tsx').match(/text-\[length:var\(--ui-text-label\)\]/g) ?? []).toHaveLength(2)
  expect(source('pages/girard/VisitPage.tsx')).toContain('className="block text-[length:var(--ui-text-label)] font-medium"')
})


test('returned SJ date label uses the shared responsive label contract while keeping its native date association', () => {
  const detail = source('pages/athel/PODetail.tsx')
  expect(detail).toMatch(/<label htmlFor="returned-date" className="[^"]*ui-field__label[^"]*">Tanggal SJ kembali<\/label>/)
  expect(detail).toMatch(/<input id="returned-date" type="date"[^\n]*className="ui-control/)
})
