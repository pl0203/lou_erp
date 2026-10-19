import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { LoadingState } from '../../src/components/ui/LoadingState'
import { MainContent } from '../../src/components/ui/MainContent'

afterEach(cleanup)
const css = readFileSync('src/styles/ui.css', 'utf8')
const navigation = readFileSync('src/components/navigation.css', 'utf8')

test.each(['compact', 'list', 'detail', 'form', 'dashboard'] as const)('%s loading is decorative geometry with one readable status', shape => {
  const { container } = render(<LoadingState shape={shape} title="Memuat data…">Menunggu koneksi.</LoadingState>)
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getByRole('status').textContent).toContain('Memuat data…')
  expect(screen.getByText('Menunggu koneksi.')).toBeTruthy()
  expect(container.querySelector(`[data-loading-shape="${shape}"]`)?.getAttribute('aria-hidden')).toBe('true')
  expect(container.querySelector('button,input,select,textarea,a')).toBeNull()
  expect(container.querySelector('[aria-busy="true"]')).toBeNull()
})

test('loading disappears immediately and never owns or remounts a sibling draft', () => {
  function Editor() {
    const [draft, setDraft] = useState(''), [loading, setLoading] = useState(true)
    return <MainContent><label>Draft<input value={draft} onChange={e => setDraft(e.target.value)} /></label>
      {loading ? <LoadingState title="Memuat pilihan…" /> : <p>Pilihan tersedia</p>}
      <button onClick={() => setLoading(false)}>Selesai</button></MainContent>
  }
  render(<Editor />)
  const input = screen.getByLabelText('Draft')
  fireEvent.change(input, { target: { value: 'Keep this draft' } }); input.focus()
  fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText('Pilihan tersedia')).toBeTruthy()
  expect(screen.getByLabelText('Draft')).toBe(input)
  expect((input as HTMLInputElement).value).toBe('Keep this draft')
  expect(document.activeElement).toBe(input)
})

test('page arrivals cannot translate fixed descendants, delay data or force route remounts', () => {
  expect(css).toMatch(/@keyframes ui-content-enter\s*\{\s*from\s*\{\s*opacity:/)
  const frames = css.match(/@keyframes ui-content-enter\s*\{(?:[^{}]|\{[^{}]*\})*\}/)?.[0] ?? ''
  expect(frames).not.toMatch(/transform|filter|height|width/)
  expect(css).not.toMatch(/animation-delay|transition:\s*all|will-change/)
  expect(readFileSync('src/components/ui/MainContent.tsx', 'utf8')).not.toMatch(/useLocation|key=|setTimeout|requestAnimationFrame/)
  expect(readFileSync('src/components/ui/LoadingState.tsx', 'utf8')).not.toMatch(/useEffect|useState|setTimeout|requestAnimationFrame/)
  expect(readFileSync('src/App.tsx', 'utf8')).not.toMatch(/<Routes\s+key=|<Route[^>]+key=|startViewTransition/)
})

test('new motion is opt-in only when reduced motion is not requested', () => {
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/)
  expect(css).toMatch(/\.ui-dialog\[open\]\s*\{\s*animation:\s*ui-dialog-enter 180ms/)
  expect(navigation).toMatch(/\.navigation-drawer\[open\]\s*\{\s*animation:\s*ui-navigation-enter 200ms/)
  expect(css).toMatch(/\.ui-main-content\s*>[^{}]+\{\s*animation:\s*ui-content-enter 160ms/)
  expect(css).not.toMatch(/\.ui-skeleton\s*\{[^}]*animation/)
  // No JS animation, exit timer or animated width is allowed to hold a modal open.
  expect(readFileSync('src/components/ui/Dialog.tsx', 'utf8')).not.toMatch(/setTimeout|animationend/)
  expect(readFileSync('src/components/AppNavigation.tsx', 'utf8')).not.toMatch(/setTimeout|animationend/)
})

test('every new animation declaration is actually inside the no-preference media branch', () => {
  for (const source of [css, navigation]) {
    const ranges: [number, number][] = []
    for (const match of source.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/g)) {
      let depth = 1, end = match.index! + match[0].length
      for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++
        if (source[end] === '}') depth--
      }
      ranges.push([match.index!, end])
    }
    const declarations = [...source.matchAll(/animation:\s*ui-(?:content|dialog|backdrop|navigation)-enter/g)]
    expect(declarations.length).toBeGreaterThan(0)
    for (const match of declarations) expect(ranges.some(([start, end]) => start < match.index! && end > match.index!), match[0]).toBe(true)
  }
})
