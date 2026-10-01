import React, { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ instances: [] as any[], fail: false, width: 600, observer: undefined as undefined | (() => void), motion: undefined as undefined | (() => void), reduced: false }))
vi.mock('echarts/core', () => ({ use: () => {}, init: () => {
  const chart = { options: [] as any[], events: {} as Record<string, any>, disposed: false, resized: 0,
    setOption: (option: any, policy: any) => { if (state.fail) throw new Error('Render failed'); chart.options.push({ option, policy }) },
    on: (name: string, callback: any) => { chart.events[name] = callback },
    resize: () => chart.resized++, dispose: () => { chart.disposed = true },
  }
  state.instances.push(chart)
  return chart
} }))
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, PieChart: {} }))
vi.mock('echarts/components', () => ({ AriaComponent: {}, DataZoomComponent: {}, GridComponent: {}, LegendComponent: {}, TooltipComponent: {} }))
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }))
import EChart from '../src/components/charts/EChart'

beforeEach(() => {
  state.instances = []; state.fail = false; state.width = 600; state.reduced = false
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => state.width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { state.observer = callback } observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ get matches() { return state.reduced }, addEventListener: (_: string, callback: () => void) => { state.motion = callback }, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('StrictMode disposes the first chart and data changes replace stale series on the live instance', () => {
  const view = render(<StrictMode><EChart label="Test chart" option={{ series: [{ type: 'bar', data: [3, 4] }] }} /></StrictMode>)
  expect(state.instances[0].disposed).toBe(true)
  const live = state.instances.at(-1)
  view.rerender(<StrictMode><EChart label="Test chart" option={{ series: [{ type: 'bar', data: [0] }] }} /></StrictMode>)
  expect(live.options.at(-1).option.series[0].data).toEqual([0])
  expect(live.options.at(-1).policy.notMerge).toBe(true)
  view.unmount()
  expect(live.disposed).toBe(true)
})

test('a hidden chart initializes with current data once its container has a measurable width', () => {
  state.width = 0
  const view = render(<EChart label="Test chart" option={{ series: [{ type: 'bar', data: [1] }] }} />)
  expect(state.instances).toHaveLength(0)
  view.rerender(<EChart label="Test chart" option={{ series: [{ type: 'bar', data: [9] }] }} />)
  state.width = 600; state.observer!()
  expect(state.instances[0].options.at(-1).option.series[0].data).toEqual([9])
  state.observer!()
  expect(state.instances[0].resized).toBe(1)
})

test('reduced-motion changes disable animation and keep the chart description', () => {
  render(<EChart label="Daily deliveries" option={{}} />)
  state.reduced = true; state.motion!()
  expect(state.instances[0].options.at(-1).option.animation).toBe(false)
  expect(state.instances[0].options.at(-1).option.aria.label.description).toContain('Daily deliveries')
})

test('a rendering failure recovers when the next valid data renders', () => {
  state.fail = true
  const view = render(<EChart label="Test chart" option={{}} />)
  expect(screen.getByRole('status').textContent).toContain('Lihat data')
  state.fail = false
  view.rerender(<EChart label="Test chart" option={{ series: [] }} />)
  expect(screen.queryByRole('status')).toBeNull()
})
