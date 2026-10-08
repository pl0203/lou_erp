import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } },
}))
import ForgotPassword from '../src/pages/ForgotPassword'

const confirmation = 'Jika email terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim.'
const safeError = 'Permintaan belum dapat diproses. Periksa koneksi Anda dan coba lagi nanti.'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
})
afterEach(cleanup)

function mount() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/login" element={<p>Login route</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fill(email: string) {
  fireEvent.change(screen.getByPlaceholderText('anda@perusahaan.com'), { target: { value: email } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Kirim tautan reset' }))
}

test.each(['registered@example.test', 'unregistered@example.test'])(
  'uses conditional confirmation for an accepted request to %s',
  async email => {
    mount()
    fill(email)
    submit()
    await screen.findByText(confirmation)
    expect(screen.queryByText('Email terkirim')).toBeNull()
    expect(screen.queryByText('Periksa kotak masuk Anda untuk tautan reset kata sandi.')).toBeNull()
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1)
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
  },
)

test.each(['', '   '])('rejects empty or whitespace-only input: %j', async email => {
  mount()
  fill(email)
  submit()
  await screen.findByText('Masukkan email Anda.')
  expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled()
})

test.each(['not-an-email', 'person@', '@example.test', 'person@example', 'a b@example.test', 'a@@example.test', '<person>@example.test', 'person@example..test', 'person@-example.test', `${'a'.repeat(243)}@example.test`])(
  'rejects malformed or excessively long input: %s',
  async email => {
    mount()
    fill(email)
    submit()
    await screen.findByText('Masukkan alamat email yang valid.')
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled()
  },
)

test('trims pasted whitespace and preserves the reset callback', async () => {
  mount()
  fill('  Person+orders@example.test  ')
  submit()
  await screen.findByText(confirmation)
  expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('Person+orders@example.test', {
    redirectTo: `${window.location.origin}/reset-password`,
  })
})

test('guards repeated Enter and clicks synchronously while the request is pending', async () => {
  let finish!: (value: { error: null }) => void
  mocks.resetPasswordForEmail.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount()
  fill('person@example.test')
  const email = screen.getByPlaceholderText('anda@perusahaan.com')
  const button = screen.getByRole('button', { name: 'Kirim tautan reset' }) as HTMLButtonElement
  act(() => {
    fireEvent.keyDown(email, { key: 'Enter' })
    fireEvent.keyDown(email, { key: 'Enter' })
    fireEvent.click(button)
  })
  expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  await act(async () => finish({ error: null }))
  await screen.findByText(confirmation)
})

test('never displays raw provider errors and permits a user-initiated retry', async () => {
  mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'Private provider details for person@example.test', status: 500 } })
  mount()
  fill('person@example.test')
  submit()
  await screen.findByText(safeError)
  expect(screen.queryByText(/Private provider details/)).toBeNull()
  expect((screen.getByRole('button', { name: 'Kirim tautan reset' }) as HTMLButtonElement).disabled).toBe(false)
  submit()
  await screen.findByText(confirmation)
  expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(2)
})

test('clears pending state after a rejected promise without an automatic retry', async () => {
  mocks.resetPasswordForEmail.mockRejectedValueOnce(new Error('Private transport detail'))
  mount()
  fill('person@example.test')
  submit()
  await screen.findByText(safeError)
  expect(screen.queryByText('Private transport detail')).toBeNull()
  expect((screen.getByRole('button', { name: 'Kirim tautan reset' }) as HTMLButtonElement).disabled).toBe(false)
  expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1)
  submit()
  await screen.findByText(confirmation)
})

test('handles provider throttling with safe localized guidance', async () => {
  mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'Raw throttle details', status: 429 } })
  mount()
  fill('person@example.test')
  submit()
  await screen.findByText('Terlalu banyak permintaan. Tunggu beberapa saat sebelum mencoba lagi.')
  expect(screen.queryByText('Raw throttle details')).toBeNull()
  expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1)
})

test('allows returning to login while a request is pending without late navigation', async () => {
  let finish!: (value: { error: null }) => void
  mocks.resetPasswordForEmail.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  mount()
  fill('person@example.test')
  submit()
  fireEvent.click(screen.getByRole('button', { name: /Kembali ke halaman masuk/ }))
  await screen.findByText('Login route')
  await act(async () => finish({ error: null }))
  await waitFor(() => expect(screen.getByText('Login route')).toBeTruthy())
  expect(screen.queryByText(confirmation)).toBeNull()
})
