import type { ComponentType } from 'react'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// Keep the missing shared primitive visible as an assertion during RED.
const patterns = import.meta.glob<Record<string, ComponentType<any>>>('../../src/components/ui/*.tsx')
async function sharedDialog() {
  const load = patterns['../../src/components/ui/Dialog.tsx']
  expect(load, 'shared native Dialog primitive').toBeTypeOf('function')
  return (await load()).Dialog
}
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const focusTargets: HTMLElement[] = []
afterEach(() => {
  cleanup()
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal)
  else delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal
  focusTargets.splice(0).forEach(target => target.remove())
  vi.restoreAllMocks()
})

function addFocusTarget(text: string) {
  const button = document.createElement('button')
  button.textContent = text
  document.body.append(button)
  focusTargets.push(button)
  return button
}

test('pending dialog cannot dismiss', async () => {
  const Dialog = await sharedDialog()
  const close = vi.fn()
  render(<Dialog labelledBy="pending-title" pending onClose={close} returnFocus={null} fallbackFocus={() => null}><h2 id="pending-title">Menyimpan tanggal</h2><button disabled>Tunggu</button></Dialog>)
  const dialog = screen.getByRole('dialog', { name: 'Menyimpan tanggal' })
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  dialog.dispatchEvent(escape)
  const cancel = new Event('cancel', { bubbles: false, cancelable: true })
  dialog.dispatchEvent(cancel)
  expect(escape.defaultPrevented).toBe(true)
  expect(cancel.defaultPrevented).toBe(true)
  expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(document.activeElement).toBe(dialog)
})

test('Escape restores trigger', async () => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Ubah tanggal')
  trigger.focus()
  function Owner() {
    const [open, setOpen] = useState(true)
    return open ? <Dialog labelledBy="date-title" pending={false} onClose={() => setOpen(false)} returnFocus={trigger} fallbackFocus={() => null}><h2 id="date-title">Tanggal kembali</h2><input type="date" aria-label="Tanggal" /></Dialog> : null
  }
  const view = render(<Owner />)
  expect(document.activeElement).toBe(screen.getByLabelText('Tanggal'))
  fireEvent.keyDown(screen.getByLabelText('Tanggal'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  view.unmount(); trigger.remove()
})

test('disconnected trigger restores the owner fallback', async () => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Ubah tanggal'), fallback = addFocusTarget('Kembali')
  const view = render(<Dialog labelledBy="fallback-title" pending={false} onClose={() => {}} returnFocus={trigger} fallbackFocus={() => fallback}><h2 id="fallback-title">Tanggal kembali</h2><button>Batal</button></Dialog>)
  trigger.remove()
  view.unmount()
  expect(document.activeElement).toBe(fallback)
  fallback.remove()
})

test.each([false, true])('native segmented date tabs are not trapped (reverse=%s)', async reverse => {
  const Dialog = await sharedDialog()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  const view = render(<Dialog labelledBy="native-title" pending={false} onClose={() => {}} returnFocus={null} fallbackFocus={() => null}><h2 id="native-title">Tanggal kembali</h2><input type="date" aria-label="Tanggal" /><button>Batal</button></Dialog>)
  const date = screen.getByLabelText('Tanggal')
  date.focus()
  const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: reverse, bubbles: true, cancelable: true })
  date.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(false)
  view.unmount()
})

test('non-native dialog contains focus and wraps Tab in both directions', async () => {
  const Dialog = await sharedDialog()
  const background = addFocusTarget('Arsip')
  const view = render(<Dialog labelledBy="contain-title" pending={false} onClose={() => {}} returnFocus={background} fallbackFocus={() => null}><h2 id="contain-title">Tanggal kembali</h2><input type="date" aria-label="Tanggal" /><button>Batal</button></Dialog>)
  const date = screen.getByLabelText('Tanggal'), cancel = screen.getByRole('button', { name: 'Batal' })
  date.focus(); fireEvent.keyDown(date, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(cancel)
  fireEvent.keyDown(cancel, { key: 'Tab' })
  expect(document.activeElement).toBe(date)
  background.focus()
  expect(document.activeElement).toBe(date)
  view.unmount()
  background.focus()
  expect(document.activeElement).toBe(background)
  background.remove()
})

test('dialog retains native accessibility attributes and opt-in shared styles', async () => {
  const Dialog = await sharedDialog()
  render(<Dialog labelledBy="styled-title" aria-describedby="styled-description" className="owner-dialog" pending={false} onClose={() => {}} returnFocus={null} fallbackFocus={() => null}><h2 id="styled-title">Tanggal kembali</h2><p id="styled-description">Periksa tanggal.</p></Dialog>)
  const dialog = screen.getByRole('dialog', { name: 'Tanggal kembali' })
  expect(dialog.tagName).toBe('DIALOG')
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.getAttribute('aria-describedby')).toBe('styled-description')
  expect(dialog.classList.contains('ui-dialog')).toBe(true)
  expect(dialog.classList.contains('owner-dialog')).toBe(true)
  const css = readFileSync('src/styles/ui.css', 'utf8')
  expect(css).toMatch(/\.ui-dialog\s*\{[^}]*max-height:\s*90vh/s)
  expect(css).toMatch(/\.ui-dialog::backdrop/)
})
