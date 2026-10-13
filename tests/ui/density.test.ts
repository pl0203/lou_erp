import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// These assertions cover the source contract and token wiring. jsdom does not
// render media queries, layout, hit targets or the actual browser cascade.
const theme = readFileSync('src/index.css', 'utf8')
const css = readFileSync('src/styles/ui.css', 'utf8')
const defaults = theme.match(/:root\s*\{([^}]+)\}/)?.[1] ?? ''
const desktop = theme.match(/@media\s*\(min-width:\s*768px\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{\s*:root\s*\{([^}]+)\}/)?.[1] ?? ''
function declarations(source: string) {
  return Object.fromEntries([...source.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(([, name, value]) => [name, value.trim()]))
}
function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return declarations(css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '')
}

test('touch and narrow layouts retain 44px actions and 16px field text by default', () => {
  expect(declarations(defaults)).toMatchObject({
    '--ui-control-size': '44px', '--ui-control-size-compact': '44px',
    '--ui-text-control': '16px', '--ui-line-control': '24px', '--ui-text-label': '16px',
    '--ui-control-padding-y': '8px', '--ui-control-padding-y-compact': '8px',
    '--ui-radius-control': '10px',
  })
})

test('compact desktop density requires a wide viewport and hover-capable fine pointer', () => {
  expect(desktop, 'density override is gated by the full desktop media condition').not.toBe('')
  expect(declarations(desktop)).toMatchObject({
    '--ui-control-size': '36px', '--ui-control-size-compact': '32px',
    '--ui-text-control': '14px', '--ui-line-control': '20px', '--ui-text-label': '13px',
    '--ui-control-padding-y': '7px', '--ui-control-padding-y-compact': '5px',
    '--ui-radius-control': '6px',
  })
  expect(theme.match(/--ui-control-size:\s*36px/g)).toHaveLength(1)
  expect(theme.match(/--ui-control-size-compact:\s*32px/g)).toHaveLength(1)
  expect(css).not.toMatch(/(?:min-)?height:\s*(?:32|36)px/)
})

test('control density does not shrink body, table data or supporting text', () => {
  expect(declarations(defaults)).toMatchObject({ '--ui-text-body': '16px', '--ui-text-table': '14px', '--ui-text-support': '13px' })
  expect(declarations(desktop)).not.toHaveProperty('--ui-text-body')
  expect(declarations(desktop)).not.toHaveProperty('--ui-text-table')
  expect(theme).toMatch(/body\s*\{[^}]*font-size:\s*var\(--ui-text-body\)/s)
  expect(theme).toMatch(/table\s*\{[^}]*font-size:\s*var\(--ui-text-table\)/s)
  expect(rule('.ui-action')).toMatchObject({ 'font-size': 'var(--ui-text-control)', 'line-height': 'var(--ui-line-control)' })
})

test('compact actions use responsive minimum targets and padding while long labels can grow', () => {
  expect(rule('.ui-action')).toMatchObject({
    'min-height': 'var(--ui-control-size)', 'min-width': 'var(--ui-control-size)',
    'padding': 'var(--ui-control-padding-y) calc(var(--ui-space) * 3)',
    'max-width': '100%', 'overflow-wrap': 'anywhere',
  })
  expect(rule('.ui-action--compact')).toMatchObject({
    'min-height': 'var(--ui-control-size-compact)', 'min-width': 'var(--ui-control-size-compact)',
    'padding-block': 'var(--ui-control-padding-y-compact)',
  })
  expect(rule('.ui-action')).not.toHaveProperty('height')
  expect(rule('.ui-action--compact')).not.toHaveProperty('height')
  expect(rule('.ui-form-actions')['flex-wrap']).toBe('wrap')
})

test('direct Field controls and opt-in nested controls share responsive field sizing', () => {
  expect(css).toMatch(/\.ui-field\s*>\s*:is\(input, select, textarea\),\s*\.ui-control\s*\{/)
  expect(rule('.ui-control')).toMatchObject({
    'min-width': '0', 'min-height': 'var(--ui-control-size)',
    'font-size': 'var(--ui-text-control)', 'line-height': 'var(--ui-line-control)',
    'padding': 'var(--ui-control-padding-y) calc(var(--ui-space) * 3)',
  })
  expect(rule('.ui-field__label')).toMatchObject({ 'font-size': 'var(--ui-text-label)', 'font-weight': '500', 'overflow-wrap': 'anywhere' })
  expect(css).toMatch(/\.ui-control\[aria-invalid="true"\][^}]*border-color:\s*var\(--color-red-700\)/s)
})

test.each([
  ['quiet', '--color-brand-primary', '--color-brand-tint'],
  ['danger-quiet', '--color-red-700', '--color-red-50'],
])('%s surfaces show a text affordance at rest and a visible hover state', (variant, color, hover) => {
  expect(rule(`.ui-action--${variant}`)).toMatchObject({
    'background-color': 'transparent', 'color': `var(${color})`,
    'text-decoration-line': 'underline', 'text-underline-offset': '3px',
  })
  expect(rule(`.ui-action--${variant}:hover:not(:disabled)`)).toMatchObject({ 'background-color': `var(${hover})` })
  expect(rule('.ui-action:focus-visible')).toMatchObject({ 'outline': '2px solid var(--color-brand-primary)', 'outline-offset': '3px' })
})

test('disabled and pending actions retain readable colors without blanket opacity reduction', () => {
  expect(rule('.ui-action:disabled:not([aria-busy="true"])')).toMatchObject({
    'background-color': 'var(--color-brand-canvas)', 'color': 'var(--color-brand-secondary)', 'border-color': 'var(--color-brand-control-border)',
  })
  expect(rule('.ui-action[aria-busy="true"]')['cursor']).toBe('wait')
  expect(css).not.toMatch(/opacity:\s*0\.[0-9]+/)
  expect(css).not.toContain('!important')
  expect(rule('.ui-action__pending')['border']).toBe('2px solid currentColor')
})
