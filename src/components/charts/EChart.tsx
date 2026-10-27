import { useEffect, useRef, useState } from 'react'
import { init, use } from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { DashboardChartOption } from '../athel/dashboardChartOptions'

use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent, SVGRenderer])

export type ChartZoomEvent = { start?: number; end?: number; batch?: { start?: number; end?: number }[] }

export default function EChart({ option, label, height = 300, onDataZoom }: {
  option: DashboardChartOption
  label: string
  height?: number
  onDataZoom?: (event: ChartZoomEvent) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<EChartsType | null>(null)
  const applyOption = useRef<() => void>(() => {})
  const latest = useRef({ option, label, onDataZoom })
  latest.current = { option, label, onDataZoom }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const node = container.current
    if (!node) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const update = () => {
      if (!instance.current) return
      try {
        instance.current.setOption({
          ...latest.current.option,
          animation: !reducedMotion?.matches,
          aria: { enabled: true, label: { description: `${latest.current.label}. Nilai lengkap tersedia pada tabel Lihat data.` } },
        }, { notMerge: true, silent: true })
        setFailed(false)
      } catch {
        setFailed(true)
      }
    }
    applyOption.current = update
    const resize = () => {
      if (!node.clientWidth || !node.clientHeight) return
      try {
        if (!instance.current) {
          instance.current = init(node, undefined, { renderer: 'svg' })
          instance.current.on('datazoom', (event: ChartZoomEvent) => latest.current.onDataZoom?.(event))
          update()
        } else {
          instance.current.resize()
        }
      } catch {
        setFailed(true)
      }
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
    observer?.observe(node)
    window.addEventListener('resize', resize)
    reducedMotion?.addEventListener?.('change', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      reducedMotion?.removeEventListener?.('change', update)
      applyOption.current = () => {}
      instance.current?.dispose()
      instance.current = null
    }
  }, [])

  useEffect(() => {
    applyOption.current()
  }, [option, label])

  return <div className="relative min-w-0">
    <div ref={container} role="img" aria-label={label} className="w-full" style={{ height }} />
    {failed && <p role="status" className="absolute inset-0 grid place-items-center bg-white p-6 text-center text-sm text-slate-500">Grafik tidak dapat ditampilkan. Nilai tetap tersedia pada Lihat data.</p>}
  </div>
}
