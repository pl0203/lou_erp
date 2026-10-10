import type { ComposeOption } from 'echarts/core'
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts'
import type { AriaComponentOption, DataZoomComponentOption, GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components'
import { formatMoney, moneyToChartNumber, moneyPercentage } from '../../lib/reads/money'
import type { DashboardData } from '../../pages/athel/Dashboard'

export type DashboardChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | PieSeriesOption | AriaComponentOption | DataZoomComponentOption | GridComponentOption | LegendComponentOption | TooltipComponentOption>
export const CHART_COLORS = { po: '#2563eb', delivered: '#0d9488', count: '#b45309', text: '#475569', grid: '#e2e8f0' }
export const currency = (value: string | number) => `Rp${typeof value === 'string' ? formatMoney(value, 'full') : value.toLocaleString('id-ID')}`
export const count = (value: number) => value.toLocaleString('id-ID')
export const percent = (value: number, total: number) => `${(total > 0 ? value / total * 100 : 0).toFixed(1)}%`
export function compactCurrency(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 1e9) return `Rp${(value / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
  if (absolute >= 1e6) return `Rp${(value / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
  if (absolute >= 1e3) return `Rp${(value / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 1 })} rb`
  return currency(value)
}

const base: DashboardChartOption = {
  animationDuration: 350,
  animationDurationUpdate: 200,
  textStyle: { fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: CHART_COLORS.text, fontSize: 12 },
  tooltip: { renderMode: 'richText', confine: true, triggerOn: 'mousemove|click|mousewheel', backgroundColor: '#fff', borderColor: '#e2e8f0', padding: 12, textStyle: { color: '#0f172a', fontSize: 12 } },
}
const categoryAxis = {
  type: 'category' as const,
  axisLine: { lineStyle: { color: '#cbd5e1' } },
  axisTick: { show: false },
  axisLabel: { color: CHART_COLORS.text, margin: 14, hideOverlap: true, showMinLabel: true, showMaxLabel: true },
}
const valueAxis = {
  type: 'value' as const,
  min: 0,
  minInterval: 1,
  splitNumber: 4,
  axisLine: { show: false },
  axisLabel: { color: CHART_COLORS.text, formatter: compactCurrency },
  splitLine: { lineStyle: { color: CHART_COLORS.grid, type: 'dashed' as const } },
}
const barStyle = { borderRadius: [3, 3, 0, 0] }

export function monthlyOptions(series: DashboardData['monthlySeries'], selected: Record<string, boolean>): DashboardChartOption {
  const labels = new Map(series.map(item => [item.key, item.label]))
  return {
    ...base,
    grid: { left: 8, right: 12, top: 30, bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'all' },
    legend: { show: false, selected },
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => {
      const rows = Array.isArray(params) ? params : [params]
      return [labels.get(String(rows[0]?.name)) ?? '', ...rows.map(row => `${row.seriesName}: ${currency(series[Number(row.dataIndex)]?.[row.seriesName === 'Total PO' ? 'poValue' : 'deliveredValue'] ?? Number(row.value))}`)].join('\n')
    } },
    xAxis: { ...categoryAxis, data: series.map(item => item.key), axisLabel: { ...categoryAxis.axisLabel, formatter: key => labels.get(key) ?? key } },
    yAxis: { ...valueAxis, name: 'Nilai PO / terkirim', nameTextStyle: { align: 'left', color: CHART_COLORS.text } },
    series: [
      { name: 'Total PO', type: 'bar', data: series.map(item => moneyToChartNumber(item.poValue)), barMaxWidth: 24, itemStyle: { ...barStyle, color: CHART_COLORS.po }, emphasis: { focus: 'series' } },
      { name: 'PO terkirim', type: 'bar', data: series.map(item => moneyToChartNumber(item.deliveredValue)), barMaxWidth: 24, itemStyle: { ...barStyle, color: CHART_COLORS.delivered }, emphasis: { focus: 'series' } },
    ],
  }
}

export function dailyOptions(series: DashboardData['dailySeries'], selected: Record<string, boolean>, start: number, end: number): DashboardChartOption {
  const labels = new Map(series.map(item => [item.key, item.label]))
  const zoom = series.length > 14
  return {
    ...base,
    grid: { left: 8, right: 8, top: 32, bottom: zoom ? 66 : 8, outerBoundsMode: 'same', outerBoundsContain: 'all' },
    legend: { show: false, selected },
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: '#94a3b8', type: 'dashed' } }, formatter: params => {
      const rows = Array.isArray(params) ? params : [params]
      return [labels.get(String(rows[0]?.name)) ?? '', ...rows.map(row => `${row.seriesName}: ${row.seriesName === 'Jumlah SJ PO' ? `${count(Number(row.value))} SJ` : currency(series[Number(row.dataIndex)]?.deliveredValue ?? Number(row.value))}`)].join('\n')
    } },
    xAxis: { ...categoryAxis, data: series.map(item => item.key), axisLabel: { ...categoryAxis.axisLabel, formatter: key => labels.get(key) ?? key } },
    yAxis: [
      { ...valueAxis, name: 'Nilai PO terkirim', nameTextStyle: { align: 'left', color: CHART_COLORS.text } },
      { ...valueAxis, name: 'Jumlah SJ', minInterval: 1, nameTextStyle: { align: 'right', color: CHART_COLORS.text }, position: 'right', axisLabel: { color: CHART_COLORS.text, formatter: count }, splitLine: { show: false } },
    ],
    dataZoom: zoom ? [
      { type: 'slider', startValue: start, endValue: end, bottom: 8, height: 22, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', fillerColor: '#dbeafe', showDetail: false, brushSelect: false, filterMode: 'none' },
      { type: 'inside', startValue: start, endValue: end, filterMode: 'none', zoomOnMouseWheel: false, moveOnMouseWheel: false, moveOnMouseMove: false },
    ] : [],
    series: [
      { name: 'Nilai PO terkirim', type: 'bar', data: series.map(item => moneyToChartNumber(item.deliveredValue)), barMaxWidth: 24, barMinHeight: 0, itemStyle: { ...barStyle, color: CHART_COLORS.delivered }, emphasis: { focus: 'series' } },
      { name: 'Jumlah SJ PO', type: 'line', yAxisIndex: 1, data: series.map(item => item.sjCount), showSymbol: series.length <= 31, symbol: 'circle', symbolSize: 6, smooth: false, itemStyle: { color: CHART_COLORS.count }, lineStyle: { color: CHART_COLORS.count, width: 2 }, emphasis: { focus: 'series' } },
    ],
  }
}

export function customerOptions(items: DashboardData['customerShare'], total: string): DashboardChartOption {
  return {
    ...base,
    grid: { left: 8, right: 68, top: 12, bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'all' },
    tooltip: { ...base.tooltip, trigger: 'item', formatter: params => {
      const row = Array.isArray(params) ? params[0] : params
      return `${row.name}\n${currency(items[Number(row.dataIndex)]?.value ?? '0')} · ${moneyPercentage(items[Number(row.dataIndex)]?.value ?? '0', total, 1)}%`
    } },
    xAxis: { ...valueAxis, axisLabel: { color: CHART_COLORS.text, formatter: compactCurrency, hideOverlap: true }, splitNumber: 2 },
    yAxis: { ...categoryAxis, inverse: true, data: items.map(item => item.label), axisLine: { show: false }, axisLabel: { color: CHART_COLORS.text, width: 100, overflow: 'truncate', interval: 0 } },
    series: [{ name: 'Total PO', type: 'bar', data: items.map(item => moneyToChartNumber(item.value)), barMaxWidth: 20, itemStyle: { color: CHART_COLORS.po, borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', color: CHART_COLORS.text, formatter: row => `${moneyPercentage(items[row.dataIndex]?.value ?? '0', total, 1)}%` } }],
  }
}

export function statusOptions(items: DashboardData['statusBreakdown']): DashboardChartOption {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return {
    ...base,
    tooltip: { ...base.tooltip, trigger: 'item', formatter: params => {
      const row = Array.isArray(params) ? params[0] : params
      return `${row.name}\n${count(Number(row.value))} PO · ${percent(Number(row.value), total)}`
    } },
    series: [{ name: 'Jumlah PO', type: 'pie', radius: ['65%', '86%'], center: ['50%', '50%'], avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false }, stillShowZeroSum: false, itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 4 }, emphasis: { scaleSize: 4 }, data: items.map(item => ({ name: item.label, value: item.value, itemStyle: { color: item.color } })) }],
  }
}
