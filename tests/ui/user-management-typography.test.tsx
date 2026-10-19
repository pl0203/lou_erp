import { existsSync, readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../../src/components/IHRNav', () => ({ default: () => null }))
import UserManagement from '../../src/pages/ihr/UserManagement'

const profile = { id: 'fictional-person', full_name: 'Fictional Sales Person', email: 'long-fictional-address@example.invalid', role: 'sales_person', phone: null, birth_date: null, is_active: true, manager_id: 'fictional-manager', invited_at: null }
const manager = { ...profile, id: 'fictional-manager', full_name: 'Fictional Manager', email: 'manager@example.invalid', role: 'sales_manager', manager_id: null, is_active: false }
let client: QueryClient
beforeEach(() => {
  mocks.rpc.mockResolvedValue({ data: [profile, manager], error: null })
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  sessionStorage.clear()
})
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks() })
function mount() { return render(<QueryClientProvider client={client}><MemoryRouter><UserManagement /></MemoryRouter></QueryClientProvider>) }
const cssPath = 'src/pages/ihr/user-management.css'
const css = () => existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

test('directory owns scoped typography without duplicate table or action controls', async () => {
  mount()
  const table = await screen.findByRole('table', { name: 'User directory' })
  expect(table.classList.contains('user-directory-table')).toBe(true)
  expect(table.closest('.user-management-page')).toBeTruthy()
  expect(screen.getAllByRole('table')).toHaveLength(1)
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Name', 'Email', 'Role', 'Manager', 'Status', 'Actions'])
  const row = within(table).getByText(profile.full_name).closest('tr')!
  expect(within(row).getAllByRole('button').map(button => button.textContent)).toEqual(['Edit', 'Deactivate'])
  expect(within(row).getByText('Active').closest('td')?.classList.contains('user-directory-table__status')).toBe(true)
  expect(within(row).getByText('Sales Person').closest('td')?.classList.contains('user-directory-table__role')).toBe(true)
  expect(screen.getByRole('region', { name: 'User directory' }).getAttribute('tabindex')).toBe('0')
})

test('table uses existing type tokens, lighter weights and intact badge words', () => {
  expect(rule('.user-directory-table')).toContain('font-size: var(--ui-text-table)')
  expect(rule('.user-directory-table')).toContain('line-height: 1.5')
  expect(rule('.user-directory-table')).toContain('font-weight: 400')
  expect(rule('.user-directory-table th')).toContain('font-size: var(--ui-text-support)')
  expect(rule('.user-directory-table .ui-status-badge')).toContain('white-space: nowrap')
  expect(rule('.user-directory-table .ui-status-badge')).toContain('overflow-wrap: normal')
  expect(rule('.user-directory-table .ui-status-badge')).toContain('font-weight: 500')
  expect(rule('.user-directory-table__actions .ui-action')).toContain('font-weight: 500')
  expect(css()).not.toMatch(/@font-face|font-family:|!important|font-size:\s*(?:[0-9]|1[012])px/)
})

test('compact spacing preserves full text, scroll access and shared touch control geometry', () => {
  expect(rule('.user-directory-table td')).toContain('padding: 12px')
  expect(rule('.user-directory-table__email')).toContain('overflow-wrap: anywhere')
  expect(rule('.user-directory-table__actions .ui-form-actions')).toContain('flex-wrap: nowrap')
  expect(css()).toContain('@media (min-width: 768px)')
  expect(css()).not.toMatch(/text-overflow:\s*ellipsis|line-clamp|overflow:\s*hidden|min-height:|--ui-control-size|--ui-text-control/)
  const shared = readFileSync('src/index.css', 'utf8')
  expect(shared).toContain('--ui-control-size: 44px')
  expect(shared).toContain('--ui-text-control: 16px')
  expect(shared).toContain('--ui-text-support: 13px')
})

test('search role filters and edit draft remain the same logical controls across resize', async () => {
  mount()
  await screen.findByRole('table')
  const search = screen.getByLabelText('Search users')
  fireEvent.change(search, { target: { value: profile.email } })
  expect(screen.getAllByRole('row')).toHaveLength(2)
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'sales_person' } })
  expect(screen.getAllByRole('row')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const input = screen.getByLabelText('Full Name *') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'Unsent fictional draft' } })
  fireEvent(window, new Event('resize'))
  expect(screen.getByLabelText('Full Name *')).toBe(input)
  expect(input.value).toBe('Unsent fictional draft')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['pilot_list_users'])
})
