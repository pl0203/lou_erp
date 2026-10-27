import type { ComponentType } from 'react'
import { StrictMode, useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

test('stacked fallback dialogs give the newer owner initial focus, containment and draft restoration', async () => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Open draft')
  function Owner() {
    const [open, setOpen] = useState(true), [discard, setDiscard] = useState(false)
    const [draft, setDraft] = useState('Unsaved draft')
    const request = useRef<HTMLButtonElement>(null)
    return <>{open && <Dialog labelledBy="draft-title" pending={false} onClose={() => setOpen(false)} returnFocus={trigger} fallbackFocus={() => trigger}>
      <h2 id="draft-title">Draft editor</h2><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <button ref={request} onClick={() => setDiscard(true)}>Request discard</button>
    </Dialog>}{discard && <Dialog labelledBy="discard-title" pending={false} onClose={() => setDiscard(false)} returnFocus={request.current} fallbackFocus={() => trigger}>
      <h2 id="discard-title">Discard changes</h2><button onClick={() => setDiscard(false)}>Keep editing</button><button>Discard</button>
    </Dialog>}</>
  }
  const view = render(<Owner />)
  const draft = screen.getByLabelText('Draft'), request = screen.getByRole('button', { name: 'Request discard' })
  fireEvent.change(draft, { target: { value: 'Retained local work' } })
  request.focus(); fireEvent.click(request)
  const keep = screen.getByRole('button', { name: 'Keep editing' }), discard = screen.getByRole('button', { name: 'Discard', exact: true })
  expect(document.activeElement).toBe(keep)
  trigger.focus(); expect(document.activeElement).toBe(keep)
  act(() => discard.focus()); fireEvent.keyDown(discard, { key: 'Tab' })
  expect(document.activeElement).toBe(keep)
  fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(discard)
  fireEvent.click(keep)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(document.activeElement).toBe(request)
  expect((draft as HTMLInputElement).value).toBe('Retained local work')
  trigger.focus(); expect(document.activeElement).toBe(draft)
  request.focus(); fireEvent.click(request)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(document.activeElement).toBe(request)
  fireEvent.keyDown(draft, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  view.unmount(); trigger.focus(); expect(document.activeElement).toBe(trigger)
})

test('focusing the upper fallback control never causes stacked containment recursion', async () => {
  const Dialog = await sharedDialog()
  const errors: unknown[] = []
  const onError = (event: ErrorEvent) => { errors.push(event.error) }
  window.addEventListener('error', onError)
  try {
    render(<><Dialog labelledBy="lower-title" pending={false} onClose={() => {}} returnFocus={null} fallbackFocus={() => null}>
      <h2 id="lower-title">Lower editor</h2><button>Lower control</button>
    </Dialog><Dialog labelledBy="upper-title" pending={false} onClose={() => {}} returnFocus={null} fallbackFocus={() => null}>
      <h2 id="upper-title">Upper confirmation</h2><button>Upper control</button>
    </Dialog></>)
    const upper = screen.getByRole('button', { name: 'Upper control' })
    act(() => upper.focus())
    expect(errors).toEqual([])
    expect(document.activeElement).toBe(upper)
  } finally { window.removeEventListener('error', onError) }
})

test('removing the lower owner leaves upper focus intact and final removal restores its disconnected fallback', async () => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Outside trigger'), fallback = addFocusTarget('Fallback destination')
  let lowerTarget: HTMLElement | null = null
  function Owner({ lower, upper }: { lower: boolean; upper: boolean }) {
    return <>{lower && <Dialog labelledBy="remove-lower-title" pending={false} onClose={() => {}} returnFocus={trigger} fallbackFocus={() => trigger}>
      <h2 id="remove-lower-title">Lower draft</h2><button ref={node => { if (node) lowerTarget = node }}>Lower return target</button>
    </Dialog>}{upper && <Dialog labelledBy="remove-upper-title" pending={false} onClose={() => {}} returnFocus={lowerTarget} fallbackFocus={() => fallback}>
      <h2 id="remove-upper-title">Upper decision</h2><button>Upper decision control</button>
    </Dialog>}</>
  }
  const view = render(<Owner lower upper={false} />)
  view.rerender(<Owner lower upper />)
  const upper = screen.getByRole('button', { name: 'Upper decision control' })
  act(() => upper.focus())
  view.rerender(<Owner lower={false} upper />)
  expect(document.activeElement).toBe(upper)
  trigger.focus(); expect(document.activeElement).toBe(upper)
  view.rerender(<Owner lower={false} upper={false} />)
  expect(document.activeElement).toBe(fallback)
  trigger.focus(); expect(document.activeElement).toBe(trigger)
  view.unmount()
})

test('only the active dialog can dismiss and an active pending owner keeps both dialogs mounted', async () => {
  const Dialog = await sharedDialog()
  const lowerClose = vi.fn(), upperClose = vi.fn()
  render(<><Dialog labelledBy="inactive-title" pending={false} onClose={lowerClose} returnFocus={null} fallbackFocus={() => null}>
    <h2 id="inactive-title">Inactive editor</h2><button>Inactive control</button>
  </Dialog><Dialog labelledBy="active-pending-title" pending onClose={upperClose} returnFocus={null} fallbackFocus={() => null}>
    <h2 id="active-pending-title">Active pending confirmation</h2><button disabled>Pending control</button>
  </Dialog></>)
  const lower = screen.getByRole('dialog', { name: 'Inactive editor' }), upper = screen.getByRole('dialog', { name: 'Active pending confirmation' })
  fireEvent.keyDown(lower, { key: 'Escape' }); fireEvent(lower, new Event('cancel', { cancelable: true }))
  fireEvent.keyDown(upper, { key: 'Escape' }); fireEvent(upper, new Event('cancel', { cancelable: true }))
  expect(lowerClose).not.toHaveBeenCalled(); expect(upperClose).not.toHaveBeenCalled()
  expect(screen.getAllByRole('dialog')).toHaveLength(2)
  expect(document.activeElement).toBe(upper)
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

test.each([[false, false], [true, false], [false, true], [true, true]])('simultaneous draft and discard removal restores the outer trigger (native=%s, strict=%s)', async (native, strict) => {
  const Dialog = await sharedDialog()
  if (native) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  const trigger = addFocusTarget('Create stock return')
  let lowerTarget: HTMLElement | null = null
  function Owner({ open, confirm }: { open: boolean; confirm: boolean }) {
    return <>{open && <Dialog labelledBy="simultaneous-draft" pending={false} onClose={() => {}} returnFocus={trigger} fallbackFocus={() => null}>
      <h2 id="simultaneous-draft">Draft to discard</h2><button ref={node => { if (node) lowerTarget = node }}>Request discard</button>
    </Dialog>}{open && confirm && <Dialog labelledBy="simultaneous-confirm" pending={false} onClose={() => {}} returnFocus={lowerTarget} fallbackFocus={() => null}>
      <h2 id="simultaneous-confirm">Confirm discard</h2><button>Discard both</button>
    </Dialog>}</>
  }
  const tree = (open: boolean, confirm: boolean) => strict ? <StrictMode><Owner open={open} confirm={confirm} /></StrictMode> : <Owner open={open} confirm={confirm} />
  const view = render(tree(true, false))
  view.rerender(tree(true, true))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Discard both' }))
  view.rerender(tree(false, false))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('discarding a lower modal pair cannot steal focus from a newer surviving dialog', async () => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Outer trigger')
  let lowerTarget: HTMLElement | null = null
  function Owner({ pair, confirm, newer }: { pair: boolean; confirm: boolean; newer: boolean }) {
    return <>{pair && <Dialog labelledBy="pair-draft" pending={false} onClose={() => {}} returnFocus={trigger} fallbackFocus={() => null}>
      <h2 id="pair-draft">Pair draft</h2><button ref={node => { if (node) lowerTarget = node }}>Pair opener</button>
    </Dialog>}{pair && confirm && <Dialog labelledBy="pair-confirm" pending={false} onClose={() => {}} returnFocus={lowerTarget} fallbackFocus={() => null}>
      <h2 id="pair-confirm">Pair confirmation</h2><button>Pair discard</button>
    </Dialog>}{newer && <Dialog labelledBy="newer-context" pending={false} onClose={() => {}} returnFocus={null} fallbackFocus={() => null}>
      <h2 id="newer-context">Newer context</h2><button>Newer control</button>
    </Dialog>}</>
  }
  const view = render(<Owner pair confirm={false} newer={false} />)
  view.rerender(<Owner pair confirm newer={false} />)
  view.rerender(<Owner pair confirm newer />)
  const control = screen.getByRole('button', { name: 'Newer control' })
  expect(document.activeElement).toBe(control)
  view.rerender(<Owner pair={false} confirm={false} newer />)
  expect(document.activeElement).toBe(control)
  trigger.focus()
  expect(document.activeElement).toBe(control)
})

test.each([false, true])('an unrelated upper dialog never inherits a removed lower dialog trigger (outside opener=%s)', async outside => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Unrelated outer trigger')
  const outsideOpener = outside ? addFocusTarget('Unrelated upper opener') : null
  function Owner({ open }: { open: boolean }) {
    return open ? <><Dialog labelledBy="unrelated-lower" pending={false} onClose={() => {}} returnFocus={trigger} fallbackFocus={() => null}>
      <h2 id="unrelated-lower">Unrelated lower</h2><button>Lower control</button>
    </Dialog><Dialog labelledBy="unrelated-upper" pending={false} onClose={() => {}} returnFocus={outsideOpener} fallbackFocus={() => null}>
      <h2 id="unrelated-upper">Unrelated upper</h2><button>Upper control</button>
    </Dialog></> : null
  }
  const view = render(<Owner open />)
  outsideOpener?.remove()
  view.rerender(<Owner open={false} />)
  expect(document.activeElement).not.toBe(trigger)
})

test.each(['disabled', 'hidden', 'inert', 'display-none', 'visibility-hidden'])('nested discard bypasses an unavailable outer opener (%s) for its fallback', async unavailable => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Unavailable outer opener'), fallback = addFocusTarget('Available outer fallback')
  let lowerTarget: HTMLElement | null = null
  function Owner({ open, confirm }: { open: boolean; confirm: boolean }) {
    return <>{open && <Dialog labelledBy="unavailable-draft" pending={false} onClose={() => {}} returnFocus={trigger} fallbackFocus={() => fallback}>
      <h2 id="unavailable-draft">Unavailable opener draft</h2><button ref={node => { if (node) lowerTarget = node }}>Nested opener</button>
    </Dialog>}{open && confirm && <Dialog labelledBy="unavailable-confirm" pending={false} onClose={() => {}} returnFocus={lowerTarget} fallbackFocus={() => null}>
      <h2 id="unavailable-confirm">Unavailable opener confirmation</h2><button>Discard unavailable draft</button>
    </Dialog>}</>
  }
  const tree = (open: boolean, confirm: boolean) => <StrictMode><Owner open={open} confirm={confirm} /></StrictMode>
  const view = render(tree(true, false))
  view.rerender(tree(true, true))
  if (unavailable === 'disabled') trigger.setAttribute('disabled', '')
  else if (unavailable === 'display-none') trigger.style.display = 'none'
  else if (unavailable === 'visibility-hidden') trigger.style.visibility = 'hidden'
  else trigger.setAttribute(unavailable, '')
  view.rerender(tree(false, false))
  expect(document.activeElement).toBe(fallback)
})

test('restoration accepts a programmatically focusable tabindex-minus-one heading fallback', async () => {
  const Dialog = await sharedDialog()
  const trigger = addFocusTarget('Disabled return trigger')
  trigger.setAttribute('disabled', '')
  const heading = document.createElement('h1')
  heading.tabIndex = -1; heading.textContent = 'Current page heading'
  document.body.append(heading); focusTargets.push(heading)
  const view = render(<Dialog labelledBy="heading-fallback-dialog" pending={false} onClose={() => {}} returnFocus={trigger} fallbackFocus={() => heading}>
    <h2 id="heading-fallback-dialog">Heading fallback dialog</h2><button>Close dialog</button>
  </Dialog>)
  view.unmount()
  expect(document.activeElement).toBe(heading)
})
