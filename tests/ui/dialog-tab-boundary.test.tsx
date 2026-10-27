import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Dialog } from '../../src/components/ui/Dialog'
import type { ReactNode } from 'react'

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
beforeEach(() => {
  // jsdom does not implement native navigation. This only selects the native
  // branch; the source-bound browser runner remains the native Tab proof.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
})
afterEach(() => {
  cleanup()
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal)
  else delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal
})

function mount(children: ReactNode) {
  return render(<Dialog labelledBy="boundary-title" pending={false} onClose={() => {}} returnFocus={null} fallbackFocus={() => null}>
    <h2 id="boundary-title">Customer editor</h2>{children}
  </Dialog>)
}

function tab(target: HTMLElement, init: KeyboardEventInit = {}) {
  target.focus()
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...init })
  fireEvent(target, event)
  return event
}

test.each([false, true])('native ordinary boundary wraps before document focus can leave (reverse=%s)', reverse => {
  mount(<><select aria-label="Category"><option>Customer</option></select><input aria-label="Name" /><button>Cancel</button><button>Save</button></>)
  const first = screen.getByLabelText('Category'), last = screen.getByRole('button', { name: 'Save' })
  const event = tab(reverse ? first : last, { shiftKey: reverse })
  expect(event.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(reverse ? last : first)
})

test.each([false, true])('native interior Tab remains browser-owned (reverse=%s)', reverse => {
  mount(<><button>First</button><input aria-label="Name" /><button>Last</button></>)
  const input = screen.getByLabelText('Name')
  expect(tab(input, { shiftKey: reverse }).defaultPrevented).toBe(false)
})

test.each(['date', 'time', 'datetime-local', 'month', 'week'])('native %s input retains segment Tab in both directions, even at an edge', type => {
  mount(<input type={type} aria-label="Segmented field" />)
  const input = screen.getByLabelText('Segmented field')
  for (const shiftKey of [false, true]) expect(tab(input, { shiftKey }).defaultPrevented).toBe(false)
})

test.each(['altKey', 'ctrlKey', 'metaKey'])('browser %s Tab shortcuts are not captured at a boundary', modifier => {
  mount(<><button>First</button><button>Last</button></>)
  for (const shiftKey of [false, true]) {
    const target = screen.getByRole('button', { name: shiftKey ? 'First' : 'Last' })
    expect(tab(target, { [modifier]: true, shiftKey }).defaultPrevented).toBe(false)
  }
})

test('a control that already handles Tab keeps its focus', () => {
  mount(<><button>First</button><button onKeyDown={event => { if (event.key === 'Tab') event.preventDefault() }}>Own Tab</button></>)
  const control = screen.getByRole('button', { name: 'Own Tab' })
  expect(tab(control).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(control)
})

const excluded = [
  ['disabled with tabindex', <button disabled tabIndex={0}>Excluded</button>],
  ['negative tabindex', <button tabIndex={-1}>Excluded</button>],
  ['hidden input with tabindex', <input type="hidden" tabIndex={0} />],
  ['hidden attribute', <button hidden>Excluded</button>],
  ['hidden ancestor', <section hidden><button>Excluded</button></section>],
  ['inert ancestor', <section inert><button>Excluded</button></section>],
  ['display none ancestor', <section style={{ display: 'none' }}><button>Excluded</button></section>],
  ['visibility hidden', <button style={{ visibility: 'hidden' }}>Excluded</button>],
  ['aria-hidden ancestor', <section aria-hidden="true"><button>Excluded</button></section>],
  ['aria-disabled', <button aria-disabled="true">Excluded</button>],
] as const

test.each(excluded)('native boundaries exclude %s controls', (_reason, excludedControl) => {
  mount(<>{excludedControl}<button>First</button><button>Last</button>{excludedControl}</>)
  const first = screen.getByRole('button', { name: 'First' }), last = screen.getByRole('button', { name: 'Last' })
  expect(document.activeElement).toBe(first)
  expect(tab(last).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(first)
  expect(tab(first, { shiftKey: true }).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(last)
})

test('only the newest native owner wraps Tab; pending Escape and restoration remain intact', () => {
  const lowerClose = vi.fn(), upperClose = vi.fn()
  const lower = render(<Dialog labelledBy="lower-title" pending={false} onClose={lowerClose} returnFocus={null} fallbackFocus={() => null}>
    <h2 id="lower-title">Editor</h2><button>Editor first</button><button>Editor last</button>
  </Dialog>)
  const returnTarget = screen.getByRole('button', { name: 'Editor last' })
  const upper = render(<Dialog labelledBy="upper-title" pending onClose={upperClose} returnFocus={returnTarget} fallbackFocus={() => null}>
    <h2 id="upper-title">Pending confirmation</h2><button>Keep editing</button><button>Discard</button>
  </Dialog>)
  const first = screen.getByRole('button', { name: 'Keep editing' }), last = screen.getByRole('button', { name: 'Discard' })
  expect(tab(last).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(first)
  expect(tab(first, { shiftKey: true }).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(last)
  const inactive = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  fireEvent(returnTarget, inactive)
  expect(inactive.defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'Escape' })
  fireEvent.keyDown(returnTarget, { key: 'Escape' })
  expect(lowerClose).not.toHaveBeenCalled()
  expect(upperClose).not.toHaveBeenCalled()
  upper.unmount()
  expect(document.activeElement).toBe(returnTarget)
  lower.unmount()
})
