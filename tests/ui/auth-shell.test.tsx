import React from 'react'
import { transferableAbortController } from 'node:util'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  auth: { user: null as any, profile: null as any, loading: false, error: null as string | null, signOut: vi.fn() },
  signIn: vi.fn(), resetEmail: vi.fn(), setup: vi.fn(), updatePassword: vi.fn(), rpc: vi.fn(), update: vi.fn(), getSession: vi.fn(),
}))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => state.auth, useBeforeSignOut: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: state.rpc, auth: { signInWithPassword: state.signIn, resetPasswordForEmail: state.resetEmail, getSession: state.getSession }, from: () => ({ update: (payload: unknown) => ({ eq: (_: string, id: string) => state.update(payload, id) }) }) },
  getPasswordSetupIdentity: state.setup, updatePasswordForSetup: state.updatePassword,
}))
vi.mock('../../src/components/IHRNav', () => ({ default: () => <nav aria-label="Navigasi HR">HR</nav> }))
vi.mock('../../src/components/AppNavigation', () => ({ default: () => <nav aria-label="Navigasi Padiwan">Padiwan</nav> }))
import Login from '../../src/pages/Login'
import ForgotPassword from '../../src/pages/ForgotPassword'
import ResetPassword from '../../src/pages/ResetPassword'
import UserManagement from '../../src/pages/ihr/UserManagement'
import Landing from '../../src/pages/Landing'
import App from '../../src/App'

const clients: QueryClient[] = []
const routers: ReturnType<typeof createMemoryRouter>[] = []
const user = (overrides = {}) => ({ id: 'synthetic-admin', full_name: 'Synthetic Admin', email: 'admin@example.test', role: 'po_admin', phone: null, birth_date: null, manager_id: null, is_active: true, invited_at: null, ...overrides })
beforeEach(() => {
  vi.stubGlobal('AbortController', class { constructor() { return transferableAbortController() } })
  vi.clearAllMocks(); sessionStorage.clear(); onlineManager.setOnline(true)
  Object.assign(state.auth, { user: null, profile: null, loading: false, error: null })
  state.auth.signOut.mockResolvedValue(true)
  state.signIn.mockResolvedValue({ error: null }); state.resetEmail.mockResolvedValue({ error: null })
  state.setup.mockResolvedValue({ identity: { userId: 'synthetic-invitee', email: 'invitee@example.test' }, error: null })
  state.updatePassword.mockResolvedValue({ error: null }); state.rpc.mockResolvedValue({ data: [], error: null })
  state.update.mockResolvedValue({ error: null }); state.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token' } } })
})
afterEach(() => { cleanup(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); vi.unstubAllGlobals() })
function mount(element: React.ReactNode, path = '/login', cached?: any[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  if (cached) client.setQueryData(['users'], cached)
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: [path] }); routers.push(router)
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { client, router, ...view }
}
function main() {
  const mains = screen.getAllByRole('main'); expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main-content'); expect(mains[0].tabIndex).toBe(-1)
  expect(mains[0].querySelector('main')).toBeNull(); expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  return mains[0]
}
function submit(control: HTMLElement) {
  const form = (control as HTMLInputElement).form
  expect(form, 'native form owns keyboard submission').not.toBeNull()
  fireEvent.submit(form!)
}
async function create(name = 'First Admin', email = 'first@example.test') {
  fireEvent.click(screen.getByRole('button', { name: '+ Invite User' }))
  const input = screen.getByLabelText('Full Name *') as HTMLInputElement
  fireEvent.change(input, { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: email } })
  return input
}

test('login associates fields, uses real recovery link, reports validation and one main', () => {
  mount(<Login />)
  const email = screen.getByLabelText('Email'), password = screen.getByLabelText('Kata Sandi')
  expect(email.hasAttribute('required')).toBe(true); expect(password.hasAttribute('required')).toBe(true)
  expect((email as HTMLInputElement).form?.noValidate).toBe(true)
  expect(screen.getByRole('link', { name: 'Lupa kata sandi?' }).classList.contains('ui-action--quiet')).toBe(true)
  expect(email.getAttribute('autocomplete')).toBe('email'); expect(password.getAttribute('autocomplete')).toBe('current-password')
  expect(screen.getByRole('link', { name: 'Lupa kata sandi?' }).getAttribute('href')).toBe('/forgot-password')
  submit(email)
  expect(screen.getByRole('alert').textContent).toContain('Masukkan email dan kata sandi Anda.')
  expect(screen.getByRole('button', { name: 'Coba lagi' }).classList.contains('ui-action--primary')).toBe(true)
  main()
})
test('login coalesces same-turn native submits and clicks and permits retry after safe error', async () => {
  let finish!: (value: any) => void
  state.signIn.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mount(<Login />)
  const email = screen.getByPlaceholderText('anda@perusahaan.com') as HTMLInputElement
  fireEvent.change(email, { target: { value: 'a@example.test' } }); fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'Synthetic8!' } })
  act(() => { submit(email); submit(email); fireEvent.click(screen.getByRole('button', { name: 'Masuk' })) })
  expect(state.signIn).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('button', { name: 'Sedang masuk…' }) as HTMLButtonElement).disabled).toBe(true)
  expect(email.disabled).toBe(true)
  await act(async () => finish({ error: { message: 'Private provider detail' } }))
  expect(screen.getByRole('alert').textContent).toContain('Email atau kata sandi salah')
  expect(screen.queryByText('Private provider detail')).toBeNull(); expect(email.disabled).toBe(false)
  submit(email); await waitFor(() => expect(state.signIn).toHaveBeenCalledTimes(2))
})

function expectFieldFailure(control: HTMLElement, message: string) {
  expect(control.getAttribute('aria-invalid')).toBe('true')
  const descriptions = control.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)) ?? []
  expect(descriptions.some(element => element?.classList.contains('ui-field__error') && element.textContent === message)).toBe(true)
}
async function expectFailureSummary(name: string, message: string) {
  const summary = await screen.findByRole('group', { name })
  expect(summary.tagName).toBe('DIV'); expect(summary.tabIndex).toBe(-1)
  expect(within(summary).getByRole('alert').textContent).toContain(message)
  await waitFor(() => expect(document.activeElement).toBe(summary))
  return summary
}

test.each([
  { emailValue: '', passwordValue: '' },
  { emailValue: 'person@example.test', passwordValue: '' },
  { emailValue: '', passwordValue: 'Synthetic8!' },
])('login empty-field errors are truthful and identical failed submits refocus the summary: $emailValue / $passwordValue', async ({ emailValue, passwordValue }) => {
  mount(<Login />)
  const email = screen.getByPlaceholderText('anda@perusahaan.com') as HTMLInputElement, password = screen.getByPlaceholderText('••••••••') as HTMLInputElement
  fireEvent.change(email, { target: { value: emailValue } }); fireEvent.change(password, { target: { value: passwordValue } })
  for (let attempt = 0; attempt < 2; attempt++) {
    email.focus(); submit(email)
    for (const [control, value] of [[email, emailValue], [password, passwordValue]] as const) {
      if (!value) expectFieldFailure(control, 'Masukkan email dan kata sandi Anda.')
      else expect(control.hasAttribute('aria-invalid')).toBe(false)
      expect(control.value).toBe(value)
    }
    await expectFailureSummary('Ringkasan kesalahan masuk', 'Masukkan email dan kata sandi Anda.')
    expect(state.signIn).not.toHaveBeenCalled()
  }
})

test.each(['credentials', 'network'] as const)('login %s failures remain summary-only, retain values and focus each user retry', async failure => {
  if (failure === 'credentials') state.signIn.mockResolvedValue({ error: { message: 'Private credential detail' } })
  else state.signIn.mockRejectedValue(new Error('Private network detail'))
  const message = failure === 'credentials' ? 'Email atau kata sandi salah. Silakan coba lagi.' : 'Tidak dapat masuk. Periksa koneksi dan coba lagi.'
  mount(<Login />)
  const email = screen.getByPlaceholderText('anda@perusahaan.com') as HTMLInputElement, password = screen.getByPlaceholderText('••••••••') as HTMLInputElement
  fireEvent.change(email, { target: { value: 'person@example.test' } }); fireEvent.change(password, { target: { value: 'Synthetic8!' } })
  for (let attempt = 1; attempt <= 2; attempt++) {
    password.focus(); submit(password)
    await expectFailureSummary('Ringkasan kesalahan masuk', message)
    expect(state.signIn).toHaveBeenCalledTimes(attempt)
    expect(state.signIn).toHaveBeenLastCalledWith({ email: 'person@example.test', password: 'Synthetic8!' })
    for (const control of [email, password]) expect(control.hasAttribute('aria-invalid')).toBe(false)
    expect(email.value).toBe('person@example.test'); expect(password.value).toBe('Synthetic8!')
    expect(screen.queryByText(/Private .* detail/)).toBeNull()
  }
})

test('login profile failure is focused form-level feedback without inferring a bad credential', async () => {
  state.auth.error = 'Profile unavailable'
  mount(<Login />)
  await expectFailureSummary('Ringkasan kesalahan masuk', 'Profile unavailable')
  expect(screen.getByPlaceholderText('anda@perusahaan.com').hasAttribute('aria-invalid')).toBe(false)
  expect(screen.getByPlaceholderText('••••••••').hasAttribute('aria-invalid')).toBe(false)
})

test.each(['', 'not-an-email'])('forgot-password validation associates only the existing email error and refocuses repeated failure for %j', async value => {
  mount(<ForgotPassword />, '/forgot-password')
  const email = screen.getByPlaceholderText('anda@perusahaan.com') as HTMLInputElement
  fireEvent.change(email, { target: { value } })
  const message = value ? 'Masukkan alamat email yang valid.' : 'Masukkan email Anda.'
  for (let attempt = 0; attempt < 2; attempt++) {
    email.focus(); submit(email)
    expectFieldFailure(email, message)
    await expectFailureSummary('Ringkasan kesalahan permintaan reset', message)
    expect(email.value).toBe(value)
    expect(state.resetEmail).not.toHaveBeenCalled()
  }
})

test.each(['rate-limit', 'service', 'network'] as const)('forgot-password %s failures keep the valid address unmarked and focus each retry', async failure => {
  if (failure === 'network') state.resetEmail.mockRejectedValue(new Error('Private transport detail'))
  else state.resetEmail.mockResolvedValue({ error: { status: failure === 'rate-limit' ? 429 : 500, message: 'Private provider detail' } })
  const message = failure === 'rate-limit' ? 'Terlalu banyak permintaan. Tunggu beberapa saat sebelum mencoba lagi.' : 'Permintaan belum dapat diproses. Periksa koneksi Anda dan coba lagi nanti.'
  mount(<ForgotPassword />, '/forgot-password')
  const email = screen.getByPlaceholderText('anda@perusahaan.com') as HTMLInputElement
  fireEvent.change(email, { target: { value: 'person@example.test' } })
  for (let attempt = 1; attempt <= 2; attempt++) {
    email.focus(); submit(email)
    await screen.findByRole('alert')
    expect(email.hasAttribute('aria-invalid')).toBe(false)
    await expectFailureSummary('Ringkasan kesalahan permintaan reset', message)
    expect(email.hasAttribute('aria-describedby')).toBe(false)
    expect(email.value).toBe('person@example.test')
    expect(state.resetEmail).toHaveBeenCalledTimes(attempt)
    expect(state.resetEmail).toHaveBeenLastCalledWith('person@example.test', { redirectTo: `${window.location.origin}/reset-password` })
    expect(screen.queryByText(/Private .* detail/)).toBeNull()
  }
})

test.each([
  { passwordValue: '', confirmValue: 'Retained confirmation', field: 'password', message: 'Masukkan kata sandi baru.' },
  { passwordValue: 'short', confirmValue: 'short', field: 'password', message: 'Kata sandi minimal 8 karakter.' },
  { passwordValue: 'Eight888', confirmValue: 'Different8!', field: 'confirm', message: 'Kata sandi tidak cocok.' },
])('password setup preserves validation order and truthful $field association with repeated summary focus: $message', async ({ passwordValue, confirmValue, field, message }) => {
  mount(<ResetPassword />, '/reset-password')
  const password = await screen.findByPlaceholderText('Minimal 8 karakter') as HTMLInputElement, confirm = screen.getByPlaceholderText('Ulangi kata sandi Anda') as HTMLInputElement
  fireEvent.change(password, { target: { value: passwordValue } }); fireEvent.change(confirm, { target: { value: confirmValue } })
  for (let attempt = 0; attempt < 2; attempt++) {
    confirm.focus(); submit(confirm)
    expectFieldFailure(field === 'password' ? password : confirm, message)
    await expectFailureSummary('Ringkasan kesalahan kata sandi', message)
    expect((field === 'password' ? confirm : password).hasAttribute('aria-invalid')).toBe(false)
    expect(password.getAttribute('aria-describedby')?.split(' ')).toContain('new-password-hint')
    expect(password.value).toBe(passwordValue); expect(confirm.value).toBe(confirmValue)
    expect(state.updatePassword).not.toHaveBeenCalled()
  }
  expect(state.setup).toHaveBeenCalledTimes(1)
})

test.each(['service', 'network'] as const)('password setup %s failure preserves exact eight-character acceptance and bound helper payload without blaming a field', async failure => {
  if (failure === 'service') state.updatePassword.mockResolvedValue({ error: 'Safe update failure' })
  else state.updatePassword.mockRejectedValue(new Error('Private network detail'))
  const message = failure === 'service' ? 'Safe update failure' : 'Tidak dapat menyimpan kata sandi. Periksa koneksi dan coba lagi.'
  mount(<ResetPassword />, '/reset-password')
  const password = await screen.findByPlaceholderText('Minimal 8 karakter') as HTMLInputElement, confirm = screen.getByPlaceholderText('Ulangi kata sandi Anda') as HTMLInputElement
  fireEvent.change(password, { target: { value: 'Eight888' } }); fireEvent.change(confirm, { target: { value: 'Eight888' } })
  for (let attempt = 1; attempt <= 2; attempt++) {
    password.focus(); submit(password)
    await expectFailureSummary('Ringkasan kesalahan kata sandi', message)
    for (const control of [password, confirm]) { expect(control.hasAttribute('aria-invalid')).toBe(false); expect(control.value).toBe('Eight888') }
    expect(state.updatePassword).toHaveBeenCalledTimes(attempt)
    expect(state.updatePassword).toHaveBeenLastCalledWith('synthetic-invitee', 'Eight888')
  }
  expect(state.setup).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Private network detail')).toBeNull()
})
test.each(['loading', 'blocked'])('login %s retains one main and safe feedback', mode => {
  state.auth.loading = mode === 'loading'; state.auth.error = mode === 'blocked' ? 'Profile unavailable' : null
  mount(<Login />); main()
  expect(screen.getByRole(mode === 'loading' ? 'status' : 'alert')).toBeTruthy()
})
test.each([
  ['executive', '/landing'], ['co_admin', '/athel/co'], ['po_admin', '/athel/po'],
  ['sales_person', '/girard/schedule'], ['sales_manager', '/girard/schedule'], ['sales_head', '/girard/schedule'],
])('login keeps %s role home and replacement redirect', async (role, path) => {
  state.auth.profile = { role }; const { router } = mount(<Login />)
  await waitFor(() => expect(router.state.location.pathname).toBe(path)); expect(router.state.historyAction).toBe('REPLACE')
})
test('forgot-password is a native labelled form and preserves non-enumerating confirmation', async () => {
  mount(<ForgotPassword />, '/forgot-password'); const email = screen.getByLabelText('Email (wajib)')
  expect(screen.getByRole('link', { name: /Kembali ke halaman masuk/ }).getAttribute('href')).toBe('/login')
  fireEvent.change(email, { target: { value: 'unknown@example.test' } }); submit(email)
  expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Jika email terdaftar'))
  expect(state.resetEmail).toHaveBeenCalledWith('unknown@example.test', { redirectTo: `${window.location.origin}/reset-password` }); main()
})
test('reset labels new-password fields and submits through either native input once', async () => {
  let finish!: (value: any) => void; state.updatePassword.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount(<ResetPassword />, '/reset-password')
  const password = await screen.findByLabelText('Kata sandi baru (wajib)'), confirm = screen.getByLabelText('Konfirmasi kata sandi (wajib)')
  for (const input of [password, confirm]) { expect(input.getAttribute('autocomplete')).toBe('new-password'); fireEvent.change(input, { target: { value: 'Synthetic8!' } }) }
  act(() => { submit(password); submit(confirm) }); expect(state.updatePassword).toHaveBeenCalledTimes(1)
  expect((password as HTMLInputElement).disabled).toBe(true); main()
  await act(async () => finish({ error: 'Safe update failure' })); expect(screen.getByRole('alert').textContent).toContain('Safe update failure')
})
test.each(['loading', 'invalid', 'session-changed'])('reset %s never exposes an unverified identity and owns one main', async mode => {
  if (mode === 'loading') state.setup.mockImplementation(() => new Promise(() => {}))
  if (mode === 'invalid') state.setup.mockResolvedValue({ identity: null, error: 'Tautan tidak valid atau kedaluwarsa.' })
  if (mode === 'session-changed') state.updatePassword.mockResolvedValue({ sessionChanged: true, error: 'Sesi akun berubah.' })
  mount(<ResetPassword />, '/reset-password')
  if (mode === 'invalid') await screen.findByRole('alert')
  if (mode === 'session-changed') {
    const password = await screen.findByLabelText('Kata sandi baru (wajib)'); fireEvent.change(password, { target: { value: 'Synthetic8!' } }); fireEvent.change(screen.getByLabelText('Konfirmasi kata sandi (wajib)'), { target: { value: 'Synthetic8!' } }); submit(password)
    await screen.findByText('Sesi akun berubah.')
    expect(screen.queryByLabelText('Kata sandi baru (wajib)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Simpan kata sandi' })).toBeNull()
  }
  if (mode !== 'loading') expect(screen.getByRole('link', { name: 'Minta tautan reset baru' }).getAttribute('href')).toBe('/forgot-password')
  expect(screen.queryByText('invitee@example.test')).toBeNull(); main()
})
test('App auth loading has one main and route-aware public/dynamic titles without identity data', async () => {
  state.auth.loading = true; const { router } = mount(<App />, '/athel/co/reports/private-customer/2026-10')
  main(); expect(screen.getByRole('status')).toBeTruthy(); expect(document.title).toBe('Laporan konsinyasi bulanan | Padiwan')
  await act(async () => { await router.navigate('/athel/po/private-order/edit') }); expect(document.title).toBe('Ubah purchase order | Padiwan')
  await act(async () => { await router.navigate('/forgot-password') }); expect(document.title).toBe('Reset kata sandi | Padiwan')
  await act(async () => { await router.navigate(-1) }); expect(document.title).toBe('Ubah purchase order | Padiwan')
  expect(document.title).not.toMatch(/private-order|private-customer/); main()
})
test('session loss and Back/Forward cannot restore previous landing identity', async () => {
  state.auth.user = { id: 'old' }; state.auth.profile = { id: 'old', full_name: 'Private Previous', is_active: true, role: 'executive' }
  const { router } = mount(<App />, '/landing'); expect(screen.getByText('Selamat datang, Private')).toBeTruthy(); main()
  Object.assign(state.auth, { user: null, profile: null })
  await act(async () => { await router.navigate('/landing?session=changed', { replace: true }) })
  await screen.findByText('Masuk ke akun Anda'); expect(screen.queryByText(/Private/)).toBeNull(); main()
  await act(async () => { await router.navigate('/forgot-password'); await router.navigate(-1); await router.navigate(1) })
  expect(screen.queryByText(/Private/)).toBeNull(); main()
})
test('landing retains real module links/chosen icons and shared signout control', () => {
  state.auth.profile = { role: 'executive', full_name: 'Synthetic Executive' }; mount(<Landing />, '/landing')
  for (const [name, path] of [['Procurement', '/athel/po'], ['Sales', '/girard/schedule'], ['HR', '/ihr/users']]) {
    const link = screen.getByRole('link', { name: new RegExp('^' + name) }); expect(link.getAttribute('href')).toBe(path); expect(link.querySelector('svg')).toBeTruthy()
  }
  expect(screen.getByRole('button', { name: 'Keluar' }).classList.contains('ui-action--quiet')).toBe(true); main()
})
test.each(['loading', 'offline', 'error', 'zero', 'cached'])('user directory %s distinguishes unavailable counts from verified zero', async mode => {
  if (mode === 'loading') state.rpc.mockImplementation(() => new Promise(() => {}))
  if (mode === 'offline' || mode === 'cached') onlineManager.setOnline(false)
  if (mode === 'error') state.rpc.mockResolvedValue({ data: null, error: new Error('private server failure') })
  mount(<UserManagement />, '/ihr/users', mode === 'cached' ? [user()] : undefined)
  if (mode === 'zero') await screen.findByText('0 active users')
  else if (mode === 'cached') { expect(screen.getByText('1 active users')).toBeTruthy(); expect(screen.getByText('Synthetic Admin')).toBeTruthy() }
  else { if (mode === 'error') await screen.findByRole('alert'); expect(screen.queryByText('0 active users')).toBeNull(); expect(screen.queryByText('No users found.')).toBeNull() }
  expect(screen.queryByText('private server failure')).toBeNull(); main()
})
test('invitation dialog labels every control and native form validation is announced', async () => {
  mount(<UserManagement />, '/ihr/users'); fireEvent.click(screen.getByRole('button', { name: '+ Invite User' }))
  const dialog = screen.getByRole('dialog', { name: 'Invite New User' }); expect(dialog.tagName).toBe('DIALOG')
  for (const label of ['Full Name *', 'Email *', 'Role *', /Assigned To/, /Phone/, /Birth Date/]) expect(within(dialog).getByLabelText(label)).toBeTruthy()
  expect(within(dialog).getByRole('combobox', { name: 'Role *' }).querySelectorAll('option')).toHaveLength(6)
  submit(within(dialog).getByLabelText('Full Name *')); expect(within(dialog).getByRole('alert').textContent).toContain('Full name is required.'); expect(fetch).not.toHaveBeenCalled()
})
test('invitation cancel returns exact opener, and late success cannot focus or overwrite newer draft', async () => {
  let finish!: (value: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
  mount(<UserManagement />, '/ihr/users'); const opener = screen.getByRole('button', { name: '+ Invite User' })
  await create(); submit(screen.getByLabelText('Full Name *')); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener)
  const newer = await create('Second Admin', 'second@example.test'); newer.focus(); expect(newer.disabled).toBe(false)
  await act(async () => finish(new Response(JSON.stringify({ success: true, user_id: 'synthetic' }), { status: 200 })))
  expect((screen.getByLabelText('Full Name *') as HTMLInputElement).value).toBe('Second Admin'); expect(document.activeElement).toBe(newer)
  expect(screen.queryByText('Invitation request accepted')).toBeNull()
})
test('matching invitation success returns stable feedback focus without claiming delivery', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, user_id: 'synthetic' }), { status: 200 })))
  mount(<UserManagement />, '/ihr/users'); await create(); submit(screen.getByLabelText('Full Name *'))
  const notice = await screen.findByRole('status', { name: 'User administration result' }); expect(notice.textContent).toContain('Invitation request accepted')
  expect(notice.textContent).toContain('Delivery is not confirmed'); expect(document.activeElement).toBe(notice.parentElement)
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('edit keeps immutable email, exact payload/date, manager reset and pending unsafe dismissal guard', async () => {
  let finish!: (value: any) => void; state.rpc.mockResolvedValue({ data: [user()], error: null }); state.update.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount(<UserManagement />, '/ihr/users'); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const email = screen.getByLabelText('Email *') as HTMLInputElement; expect(email.disabled).toBe(true)
  const fullName = screen.getByLabelText('Full Name *'); fireEvent.change(fullName, { target: { value: 'Updated Admin' } }); fireEvent.change(screen.getByLabelText(/Birth Date/), { target: { value: '1991-04-02' } })
  act(() => { submit(fullName); submit(fullName) }); await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
  expect(state.update).toHaveBeenCalledWith({ full_name: 'Updated Admin', role: 'po_admin', phone: null, birth_date: '1991-04-02', manager_id: null, is_active: true }, 'synthetic-admin')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => finish({ error: null })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
test('deactivation blocks same-turn repeats and unsafe Cancel/Escape while pending, then restores safe error retry', async () => {
  let finish!: (value: any) => void; state.rpc.mockResolvedValue({ data: [user()], error: null }); state.update.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount(<UserManagement />, '/ihr/users'); fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
  const dialog = screen.getByRole('dialog', { name: 'Deactivate user?' }), action = within(dialog).getByRole('button', { name: 'Deactivate' })
  act(() => { fireEvent.click(action); fireEvent.click(action) }); await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBe(dialog)
  await act(async () => finish({ error: new Error('Synthetic failed deactivation') })); expect(within(dialog).getByRole('alert').textContent).toContain('Synthetic failed deactivation')
  expect((within(dialog).getByRole('button', { name: 'Deactivate' }) as HTMLButtonElement).disabled).toBe(false)
})
test('reactivation coalesces same-turn repeats and exposes failure without claiming success', async () => {
  let finish!: (value: any) => void; state.rpc.mockResolvedValue({ data: [user({ is_active: false })], error: null }); state.update.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount(<UserManagement />, '/ihr/users'); const action = await screen.findByRole('button', { name: 'Reactivate' })
  act(() => { fireEvent.click(action); fireEvent.click(action) }); await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
  await act(async () => finish({ error: new Error('Synthetic failed reactivation') })); expect(screen.getByRole('alert').textContent).toContain('Synthetic failed reactivation')
})

test('login synchronous entry guard prevents two button sends before React publishes pending state', async () => {
  let finish!: (value: any) => void; state.signIn.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount(<Login />); fireEvent.change(screen.getByPlaceholderText('anda@perusahaan.com'), { target: { value: 'a@example.test' } }); fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'Synthetic8!' } })
  const button = screen.getByRole('button', { name: 'Masuk' }); act(() => { fireEvent.click(button); fireEvent.click(button) })
  expect(state.signIn).toHaveBeenCalledTimes(1); await act(async () => finish({ error: null }))
})
test('deactivation synchronous entry guard owns its pending request and cannot be cancelled', async () => {
  let finish!: (value: any) => void; state.rpc.mockResolvedValue({ data: [user()], error: null }); state.update.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount(<UserManagement />, '/ihr/users'); fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
  const panel = screen.getByRole('heading', { name: 'Deactivate user?' }).parentElement!, action = within(panel).getByRole('button', { name: 'Deactivate' })
  act(() => { fireEvent.click(action); fireEvent.click(action) }); await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
  fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' })); expect(screen.getByRole('heading', { name: 'Deactivate user?' })).toBeTruthy()
  await act(async () => finish({ error: null }))
})

test('older invitation pending state cannot trap a newer edit draft or its Cancel action', async () => {
  let finish!: (value: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
  state.rpc.mockResolvedValue({ data: [user()], error: null }); mount(<UserManagement />, '/ihr/users'); await screen.findByText('Synthetic Admin')
  await create(); submit(screen.getByLabelText('Full Name *')); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect((screen.getByLabelText('Full Name *') as HTMLInputElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).toBeNull()
  await act(async () => finish(new Response(JSON.stringify({ success: true, user_id: 'synthetic' }), { status: 200 })))
  expect(screen.queryByText('Invitation request accepted')).toBeNull()
})

test('leaving password setup while saving prevents an old success from replacing the newer route', async () => {
  let finish!: (value: any) => void; state.updatePassword.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { router } = mount(<App />, '/reset-password'); const password = await screen.findByLabelText('Kata sandi baru (wajib)')
  fireEvent.change(password, { target: { value: 'Synthetic8!' } }); fireEvent.change(screen.getByLabelText('Konfirmasi kata sandi (wajib)'), { target: { value: 'Synthetic8!' } }); submit(password)
  await act(async () => { await router.navigate('/forgot-password') }); expect(screen.queryByText('invitee@example.test')).toBeNull()
  await act(async () => finish({ error: null })); expect(router.state.location.pathname).toBe('/forgot-password')
  expect(screen.getByRole('heading', { name: 'Reset kata sandi' })).toBeTruthy(); main()
})

test('manager candidates and role reset preserve exact invitation rules and optional date-only values', async () => {
  state.rpc.mockResolvedValue({ data: [user({ id: 'active-manager', full_name: 'Eligible Manager', role: 'sales_manager' }), user({ id: 'inactive-manager', full_name: 'Inactive Manager', role: 'sales_head', is_active: false }), user({ id: 'sales', full_name: 'Sales Person', role: 'sales_person' })], error: null })
  mount(<UserManagement />, '/ihr/users'); await screen.findByText('Eligible Manager'); await create()
  const manager = screen.getByLabelText('Assigned To (optional)') as HTMLSelectElement
  expect([...manager.options].map(option => option.value)).toEqual(['', 'active-manager'])
  fireEvent.change(manager, { target: { value: 'active-manager' } }); fireEvent.change(screen.getByLabelText('Role *'), { target: { value: 'sales_manager' } })
  expect(manager.value).toBe(''); fireEvent.change(screen.getByLabelText('Role *'), { target: { value: 'co_admin' } })
  expect(screen.queryByLabelText('Assigned To (optional)')).toBeNull()
  expect((screen.getByLabelText('Birth Date (optional)') as HTMLInputElement).type).toBe('date')
  expect((screen.getByLabelText('Phone (optional)') as HTMLInputElement).value).toBe('')
})

test('deactivation does not claim success when a refetch removed its selected target before confirmation', async () => {
  state.rpc.mockResolvedValue({ data: [user()], error: null })
  const { client } = mount(<UserManagement />, '/ihr/users')
  fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
  const dialog = screen.getByRole('dialog', { name: 'Deactivate user?' })
  await act(async () => { client.setQueryData(['users'], []) })
  await waitFor(() => expect(screen.queryByText('Synthetic Admin')).toBeNull())
  fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
  await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('success'))
  expect(state.update).not.toHaveBeenCalled()
  expect(screen.queryByText('User deactivated.')).toBeNull()
  expect(screen.queryByRole('status', { name: 'User administration result' })).toBeNull()
  const alert = await within(dialog).findByRole('alert')
  expect(alert.textContent).toContain('User unavailable. Reload the user list before trying again.')
  expect(within(alert).getByRole('button', { name: 'Reload user list' })).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
})

test('deactivation confirms success only after the exact selected user update is applied', async () => {
  state.rpc.mockResolvedValue({ data: [user()], error: null })
  mount(<UserManagement />, '/ihr/users')
  fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Deactivate user?' })).getByRole('button', { name: 'Deactivate' }))
  const result = await screen.findByRole('status', { name: 'User administration result' })
  expect(result.textContent).toBe('User deactivated.')
  expect(state.update).toHaveBeenCalledTimes(1)
  expect(state.update).toHaveBeenCalledWith({ full_name: 'Synthetic Admin', role: 'po_admin', phone: null, birth_date: null, manager_id: null, is_active: false }, 'synthetic-admin')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(result.parentElement)
})

test('concurrent reactivations keep every owned row busy and release only the settled user for retry', async () => {
  const pending: Record<string, ((value: any) => void)[]> = {}
  state.rpc.mockResolvedValue({ data: [user({ id: 'admin-a', full_name: 'Admin A', is_active: false }), user({ id: 'admin-b', full_name: 'Admin B', is_active: false })], error: null })
  state.update.mockImplementation((_payload, id: string) => new Promise(resolve => { (pending[id] ??= []).push(resolve) }))
  mount(<UserManagement />, '/ihr/users')
  const rowA = (await screen.findByText('Admin A')).closest('tr')!, rowB = screen.getByText('Admin B').closest('tr')!
  const actionA = within(rowA).getByRole('button', { name: 'Reactivate' }), actionB = within(rowB).getByRole('button', { name: 'Reactivate' })
  act(() => { fireEvent.click(actionA); fireEvent.click(actionB) })
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(2))
  expect((actionA as HTMLButtonElement).disabled).toBe(true)
  expect((actionB as HTMLButtonElement).disabled).toBe(true)
  for (const row of [rowA, rowB]) {
    const busy = within(row).getByRole('button', { name: 'Reactivating...' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true); expect(busy.getAttribute('aria-busy')).toBe('true')
  }
  await act(async () => pending['admin-a'][0]({ error: new Error('Admin A reactivation failed') }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Admin A reactivation failed'))
  const retryA = within(rowA).getByRole('button', { name: 'Reactivate' }) as HTMLButtonElement
  expect(retryA.disabled).toBe(false)
  expect((within(rowB).getByRole('button', { name: 'Reactivating...' }) as HTMLButtonElement).disabled).toBe(true)
  act(() => { fireEvent.click(retryA); fireEvent.click(retryA); fireEvent.click(actionB) })
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(3))
  expect(pending['admin-a']).toHaveLength(2); expect(pending['admin-b']).toHaveLength(1)
  await act(async () => pending['admin-b'][0]({ error: null }))
  expect((within(rowB).getByRole('button', { name: 'Reactivate' }) as HTMLButtonElement).disabled).toBe(false)
  expect((within(rowA).getByRole('button', { name: 'Reactivating...' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => pending['admin-a'][1]({ error: null }))
  expect((within(rowA).getByRole('button', { name: 'Reactivate' }) as HTMLButtonElement).disabled).toBe(false)
  expect(state.update.mock.calls.map(([_payload, id]) => id)).toEqual(['admin-a', 'admin-b', 'admin-a'])
  for (const [payload] of state.update.mock.calls) expect(payload.is_active).toBe(true)
})
