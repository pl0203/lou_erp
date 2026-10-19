import type { CSSProperties } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { Button } from '../../src/components/ui/Button'

const css = readFileSync('src/styles/ui.css', 'utf8')
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function measuredButton(width: number, height: number) {
  const getComputedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = getComputedStyle(element, pseudo)
    if (element.tagName !== 'BUTTON') return computed
    return new Proxy(computed, {
      get: (target, property) => property === 'width' ? `${width}px` : property === 'height' ? `${height}px` : Reflect.get(target, property),
    })
  })
}

test('pending uses an overlay, keeping the same content node and accessible name', () => {
  const child = <><svg aria-hidden="true" data-testid="icon" /><span>Simpan tanggal kembali</span></>
  const view = render(<Button>{child}</Button>)
  const button = screen.getByRole('button', { name: 'Simpan tanggal kembali' })
  const content = button.querySelector('.ui-button__content')
  expect(content, 'one persistent layout container for icon and label').not.toBeNull()
  const icon = screen.getByTestId('icon')
  view.rerender(<Button pending>{child}</Button>)
  expect(screen.getByRole('button', { name: 'Simpan tanggal kembali' })).toBe(button)
  expect(button.querySelector('.ui-button__content')).toBe(content)
  expect(screen.getByTestId('icon')).toBe(icon)
  expect(content!.contains(icon)).toBe(true)
  expect(content!.getAttribute('aria-hidden')).toBeNull()
  expect(button.querySelector('.ui-action__pending')?.getAttribute('aria-hidden')).toBe('true')
})

test('pending keeps the measured idle footprint even when the caller changes the label', () => {
  measuredButton(187.625, 44)
  const view = render(<Button pending={false}>Simpan tanggal kembali</Button>)
  const button = screen.getByRole('button')
  view.rerender(<Button pending>Menyimpan...</Button>)
  expect(screen.getByRole('button', { name: 'Menyimpan...' })).toBe(button)
  expect(button.style.width).toBe('187.625px')
  expect(button.style.height).toBe('44px')
  expect(button.textContent).toBe('Menyimpan...')
  view.rerender(<Button pending={false}>Simpan tanggal kembali</Button>)
  expect(button.style.width).toBe('')
  expect(button.style.height).toBe('')
})

test('pending releases its snapshot and preserves caller sizing styles after completion', () => {
  measuredButton(240, 70)
  const style: CSSProperties = { width: '100%', height: 'auto', color: 'red' }
  const view = render(<Button pending={false} size="compact" style={style}>A long label that can wrap</Button>)
  const button = screen.getByRole('button')
  view.rerender(<Button size="compact" pending style={style}>Working</Button>)
  expect(button.style.width).toBe('240px')
  expect(button.style.height).toBe('70px')
  expect(button.style.color).toBe('red')
  view.rerender(<Button pending={false} size="compact" style={style}>A long label that can wrap</Button>)
  expect(button.style.width).toBe('100%')
  expect(button.style.height).toBe('auto')
  expect(button.classList.contains('ui-action--compact')).toBe(true)
})

test('updates the idle footprint on resize and cleans up observation while pending', () => {
  measuredButton(180, 44)
  let onResize: ResizeObserverCallback | undefined
  const observe = vi.fn(), disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { onResize = callback }
    observe = observe
    disconnect = disconnect
  })
  const view = render(<Button pending={false}>Long label</Button>)
  const button = screen.getByRole('button')
  expect(observe).toHaveBeenCalledWith(button)
  measuredButton(140, 68)
  act(() => onResize!([], {} as ResizeObserver))
  view.rerender(<Button pending>Working</Button>)
  expect(button.style.width).toBe('140px')
  expect(button.style.height).toBe('68px')
  expect(disconnect).toHaveBeenCalled()
})

test('ordinary buttons without pending support do not measure or install geometry observers', () => {
  const measure = vi.spyOn(window, 'getComputedStyle')
  const observe = vi.fn(), disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    observe = observe
    disconnect = disconnect
  })
  render(<Button>Open details</Button>)
  expect(measure).not.toHaveBeenCalled()
  expect(observe).not.toHaveBeenCalled()
})

test('native disabled and busy semantics prevent repeated clicks then release immediately', () => {
  const onClick = vi.fn()
  const view = render(<Button type="submit" onClick={onClick}>Simpan</Button>)
  const button = screen.getByRole('button') as HTMLButtonElement
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
  view.rerender(<Button type="submit" pending onClick={onClick}>Simpan</Button>)
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.type).toBe('submit')
  fireEvent.click(button); fireEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
  view.rerender(<Button type="submit" onClick={onClick}>Simpan</Button>)
  expect(button.disabled).toBe(false)
  expect(button.hasAttribute('aria-busy')).toBe(false)
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(2)
})

test('preserves explicit disabled, busy, aria-label and native attributes independently of pending', () => {
  const view = render(<Button disabled aria-busy="true" aria-label="Save purchase order" name="save" value="draft">Simpan</Button>)
  const button = screen.getByRole('button', { name: 'Save purchase order' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.name).toBe('save')
  expect(button.value).toBe('draft')
  expect(button.type).toBe('button')
  view.rerender(<Button pending aria-label="Save purchase order">Working</Button>)
  expect(screen.getByRole('button', { name: 'Save purchase order' })).toBe(button)
})

test('an initially pending button never gets a zero-sized footprint', () => {
  render(<Button pending>Menyimpan...</Button>)
  const button = screen.getByRole('button')
  expect(button.style.width).toBe('')
  expect(button.style.height).toBe('')
})

// JSDOM does not perform layout or motion. These are narrow CSS contracts;
// real-browser geometry and reduced-motion checks remain separate validation.
test('button-only motion keeps link layout untouched and preserves the children flex layout', () => {
  expect(css).toMatch(/\.ui-button\s*\{[^}]*position:\s*relative/s)
  expect(css).toMatch(/\.ui-button\s*\{[^}]*transition:[^;]*transform 160ms/s)
  expect(css).toMatch(/\.ui-button:not\(:disabled\):active\s*\{[^}]*transform:\s*scale\(0\.98\)/s)
  expect(css).toMatch(/\.ui-button__content\s*\{[^}]*display:\s*inline-flex/s)
  for (const property of ['gap', 'align-items', 'justify-content', 'flex-wrap']) {
    expect(css).toMatch(new RegExp(`\\.ui-button__content\\s*\\{[^}]*${property}:\\s*inherit`, 's'))
  }
  expect(css).toMatch(/\.ui-button__content\s*\{[^}]*min-width:\s*0/s)
  expect(css).toMatch(/\.ui-button\s*>\s*\.ui-action__pending\s*\{[^}]*position:\s*absolute/s)
  expect(css).not.toMatch(/\.ui-action\s*\{[^}]*(?:display:\s*(?:grid|inline-grid)|transition:\s*all)/s)
})

test('reduced motion removes button press, fades and spinner animation', () => {
  const reducedMotion = Array.from(css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g), match => match[0]).join('\n')
  expect(reducedMotion).toMatch(/\.ui-button[^{]*\{[^}]*transition:\s*none/s)
  expect(reducedMotion).toMatch(/\.ui-button:not\(:disabled\):active\s*\{[^}]*transform:\s*none/s)
  expect(reducedMotion).toMatch(/\.ui-action__pending\s*\{[^}]*animation:\s*none/s)
})
