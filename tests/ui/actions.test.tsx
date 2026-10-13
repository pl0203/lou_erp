import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { Button } from '../../src/components/ui/Button'
import { ActionLink } from '../../src/components/ui/ActionLink'

afterEach(cleanup)

test('actions expose button and link semantics', () => {
  render(<MemoryRouter><Button>Simpan</Button><ActionLink to="/girard/visit-history">Riwayat kunjungan</ActionLink></MemoryRouter>)
  const button = screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement
  const link = screen.getByRole('link', { name: 'Riwayat kunjungan' })
  expect(button.type).toBe('button')
  expect(link.getAttribute('href')).toBe('/girard/visit-history')
  expect(link.getAttribute('role')).toBeNull()
})

test('default actions do not submit their owner form', () => {
  let submissions = 0
  render(<form onSubmit={event => { event.preventDefault(); submissions += 1 }}>
    <Button>Batal</Button><Button type="submit">Kirim</Button>
  </form>)
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  expect(submissions).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
  expect(submissions).toBe(1)
})

test('pending action sends once', () => {
  function Owner() {
    const [pending, setPending] = useState(false)
    const [sends, setSends] = useState(0)
    return <>
      <Button pending={pending} onClick={() => { setSends(value => value + 1); setPending(true) }}>Simpan</Button>
      <output aria-label="Jumlah pengiriman">{sends}</output>
      <button onClick={() => setPending(false)}>Selesai</button>
    </>
  }
  render(<Owner />)
  const button = screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement
  fireEvent.click(button)
  fireEvent.click(button)
  expect(screen.getByLabelText('Jumlah pengiriman').textContent).toBe('1')
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
  expect(button.disabled).toBe(false)
  expect(button.getAttribute('aria-busy')).not.toBe('true')
  fireEvent.click(button)
  expect(screen.getByLabelText('Jumlah pengiriman').textContent).toBe('2')
})

test('disabled native actions stay unavailable after pending ends', () => {
  const view = render(<Button disabled pending>Simpan</Button>)
  view.rerender(<Button disabled pending={false}>Simpan</Button>)
  expect((screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(true)
})

test('links retain ordinary routing and do not intercept a Ctrl-click', () => {
  function Location() { return <output aria-label="Lokasi">{useLocation().pathname}</output> }
  render(<MemoryRouter initialEntries={['/girard/schedule']}><ActionLink to="/girard/visit-history">Riwayat kunjungan</ActionLink><Location /></MemoryRouter>)
  const link = screen.getByRole('link', { name: 'Riwayat kunjungan' })
  let intercepted = true
  // Prevent only the browser's eventual navigation, after the link's own
  // handler has run, so jsdom does not attempt to open a new browsing context.
  document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault() }, { once: true })
  fireEvent.click(link, { ctrlKey: true, button: 0 })
  expect(intercepted).toBe(false)
  expect(screen.getByLabelText('Lokasi').textContent).toBe('/girard/schedule')
  fireEvent.click(link)
  expect(screen.getByLabelText('Lokasi').textContent).toBe('/girard/visit-history')
})

test('actions preserve native accessibility attributes and caller classes', () => {
  render(<MemoryRouter>
    <p id="hint">Rincian tindakan</p>
    <Button variant="danger" className="owner-action" aria-describedby="hint" aria-label="Hapus catatan"><svg aria-hidden="true" /><span>Hapus</span></Button>
    <ActionLink variant="secondary" className="owner-link" aria-describedby="hint" target="_blank" rel="noopener" to="/girard/visit-history">Riwayat kunjungan</ActionLink>
  </MemoryRouter>)
  const button = screen.getByRole('button', { name: 'Hapus catatan' })
  const link = screen.getByRole('link', { name: 'Riwayat kunjungan' })
  expect(button.getAttribute('aria-describedby')).toBe('hint')
  expect(button.classList.contains('owner-action')).toBe(true)
  expect(button.classList.contains('ui-action--danger')).toBe(true)
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(link.getAttribute('aria-describedby')).toBe('hint')
  expect(link.classList.contains('owner-link')).toBe(true)
  expect(link.classList.contains('ui-action--secondary')).toBe(true)
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener')
})

test('default primary actions and pending indicators retain readable text labels', () => {
  render(<MemoryRouter><Button pending>Simpan perubahan</Button><ActionLink to="/girard/visit-history">Lihat riwayat</ActionLink></MemoryRouter>)
  const button = screen.getByRole('button', { name: 'Simpan perubahan' })
  expect(button.classList.contains('ui-action--primary')).toBe(true)
  expect(screen.getByRole('link', { name: 'Lihat riwayat' }).classList.contains('ui-action--primary')).toBe(true)
  expect(button.querySelector('.ui-action__pending')?.getAttribute('aria-hidden')).toBe('true')
})

test.each(['quiet', 'danger-quiet'] as const)('%s compact commands expose native buttons without leaking style props', variant => {
  render(<Button variant={variant} size="compact" className="owner-command" aria-label="Tindakan catatan">Tinjau catatan</Button>)
  const button = screen.getByRole('button', { name: 'Tindakan catatan' }) as HTMLButtonElement
  expect(button.type).toBe('button')
  expect(button.classList.contains(`ui-action--${variant}`)).toBe(true)
  expect(button.classList.contains('ui-action--compact')).toBe(true)
  expect(button.classList.contains('owner-command')).toBe(true)
  for (const prop of ['variant', 'size', 'pending']) expect(button.hasAttribute(prop)).toBe(false)
  button.focus()
  expect(document.activeElement).toBe(button)
})

test('explicit default size preserves the existing primary surfaces without a DOM size attribute', () => {
  render(<MemoryRouter><Button size="default">Simpan</Button><ActionLink size="default" to="/athel/co">Daftar CO</ActionLink></MemoryRouter>)
  for (const action of [screen.getByRole('button', { name: 'Simpan' }), screen.getByRole('link', { name: 'Daftar CO' })]) {
    expect(action.classList.contains('ui-action--primary')).toBe(true)
    expect(action.classList.contains('ui-action--compact')).toBe(false)
    expect(action.hasAttribute('size')).toBe(false)
  }
})

test('quiet compact navigation keeps href, focus, ordinary routing and modified-click behavior', () => {
  function Location() { return <output aria-label="Lokasi quiet">{useLocation().pathname}</output> }
  render(<MemoryRouter initialEntries={['/athel/co']}>
    <ActionLink variant="quiet" size="compact" className="owner-navigation" to="/athel/co/synthetic-record">Lihat catatan</ActionLink><Location />
  </MemoryRouter>)
  const link = screen.getByRole('link', { name: 'Lihat catatan' }) as HTMLAnchorElement
  expect(link.tagName).toBe('A')
  expect(link.getAttribute('href')).toBe('/athel/co/synthetic-record')
  expect(link.getAttribute('role')).toBeNull()
  expect(link.classList.contains('ui-action--quiet')).toBe(true)
  expect(link.classList.contains('ui-action--compact')).toBe(true)
  expect(link.classList.contains('owner-navigation')).toBe(true)
  for (const prop of ['variant', 'size']) expect(link.hasAttribute(prop)).toBe(false)
  link.focus()
  expect(document.activeElement).toBe(link)
  let intercepted = true
  document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault() }, { once: true })
  fireEvent.click(link, { ctrlKey: true, button: 0 })
  expect(intercepted).toBe(false)
  expect(screen.getByLabelText('Lokasi quiet').textContent).toBe('/athel/co')
  fireEvent.click(link)
  expect(screen.getByLabelText('Lokasi quiet').textContent).toBe('/athel/co/synthetic-record')
})

test('quiet compact commands do not implicitly submit while explicit submit buttons still do', () => {
  let submissions = 0
  render(<form onSubmit={event => { event.preventDefault(); submissions += 1 }}>
    <Button variant="quiet" size="compact">Batal sunyi</Button>
    <Button variant="danger-quiet" size="compact">Hapus baris</Button>
    <Button type="submit" size="compact">Kirim ringkas</Button>
  </form>)
  fireEvent.click(screen.getByRole('button', { name: 'Batal sunyi' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hapus baris' }))
  expect(submissions).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Kirim ringkas' }))
  expect(submissions).toBe(1)
})

test.each(['quiet', 'danger-quiet'] as const)('%s compact pending commands keep their label and prevent duplicate sends', variant => {
  function Owner() {
    const [pending, setPending] = useState(false)
    const [sends, setSends] = useState(0)
    return <><Button variant={variant} size="compact" pending={pending} onClick={() => { setPending(true); setSends(value => value + 1) }}>Simpan ringkas</Button>
      <output aria-label="Pengiriman ringkas">{sends}</output></>
  }
  render(<Owner />)
  const button = screen.getByRole('button', { name: 'Simpan ringkas' }) as HTMLButtonElement
  fireEvent.click(button)
  fireEvent.click(button)
  expect(screen.getByLabelText('Pengiriman ringkas').textContent).toBe('1')
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.querySelector('.ui-action__pending')?.getAttribute('aria-hidden')).toBe('true')
  expect(button.classList.contains('ui-action--compact')).toBe(true)
  expect(button.hasAttribute('size')).toBe(false)
})
