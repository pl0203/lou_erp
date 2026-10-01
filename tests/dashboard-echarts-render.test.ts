// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { init, use } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { customerOptions, dailyOptions, monthlyOptions, statusOptions } from '../src/components/athel/dashboardChartOptions'
use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, AriaComponent, SVGRenderer])

test('the real modular ECharts engine renders narrow charts without missing-feature or deprecated-layout warnings', () => {
  const warn = vi.spyOn(console, 'warn')
  const error = vi.spyOn(console, 'error')
  const log = vi.spyOn(console, 'log')
  for (const option of [
    monthlyOptions([{ key: '2026-09', label: 'Sep 2026', poValue: '100', deliveredValue: '0' }], { 'Total PO': true, Terkirim: true }),
    dailyOptions([{ key: '2026-09-30', label: '30 Sep', deliveredValue: '0', sjCount: 2 }], { 'Nilai terkirim': true, 'Nomor SJ': true }, 0, 0),
    customerOptions([{ label: 'Very long customer name', value: '100', color: '#2563eb' }], '100'),
    statusOptions([{ label: 'Confirm', value: 2, color: '#2563eb' }]),
  ]) {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 309, height: 300 })
    try {
      chart.setOption({ ...option, animation: false })
      const svg = chart.renderToSVGString()
      expect(svg).toContain('<svg')
      expect(svg).toContain('<path')
      expect(svg).not.toContain('NaN')
    } finally { chart.dispose() }
  }
  expect(warn).not.toHaveBeenCalled()
  expect(error).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
})

test('real ECharts selected legend state removes and restores delivered bars', () => {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 700, height: 300 })
  const series = [{ key: '2026-09', label: 'Sep 2026', poValue: '100', deliveredValue: '75' }]
  try {
    chart.setOption({ ...monthlyOptions(series, { 'Total PO': true, Terkirim: true }), animation: false })
    expect(chart.renderToSVGString()).toContain('fill="#0d9488"')
    chart.setOption({ ...monthlyOptions(series, { 'Total PO': true, Terkirim: false }), animation: false }, { notMerge: true })
    expect(chart.renderToSVGString()).not.toContain('fill="#0d9488"')
    chart.setOption({ ...monthlyOptions(series, { 'Total PO': true, Terkirim: true }), animation: false }, { notMerge: true })
    expect(chart.renderToSVGString()).toContain('fill="#0d9488"')
  } finally { chart.dispose() }
})

test('real ECharts zoom actions emit percentages consumed by the accessible range controls', () => {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 700, height: 300 })
  const series = Array.from({ length: 40 }, (_, index) => ({ key: `day-${index}`, label: `Day ${index}`, deliveredValue: String(index), sjCount: index % 3 }))
  let event: { start?: number; end?: number } | undefined
  try {
    chart.setOption({ ...dailyOptions(series, { 'Nilai terkirim': true, 'Nomor SJ': true }, 0, 39), animation: false })
    chart.on('datazoom', payload => { event = payload as typeof event })
    chart.dispatchAction({ type: 'dataZoom', start: 25, end: 75 })
    expect(event?.start).toBe(25)
    expect(event?.end).toBe(75)
    expect((chart.getOption().series as { data: number[] }[])[0].data).toHaveLength(40)
  } finally { chart.dispose() }
})

test('zero-value delivery charts avoid fractional-rupiah fallback axis ticks', () => {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 309, height: 300 })
  try {
    chart.setOption({ ...dailyOptions([{ key: '2026-09-30', label: '30 Sep', deliveredValue: '0', sjCount: 2 }], { 'Nilai terkirim': true, 'Nomor SJ': true }, 0, 0), animation: false })
    expect(chart.renderToSVGString()).not.toMatch(/Rp0,[0-9]/)
  } finally { chart.dispose() }
})
