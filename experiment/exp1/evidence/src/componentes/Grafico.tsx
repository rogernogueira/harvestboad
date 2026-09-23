import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, HeatmapChart, BoxplotChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  DatasetComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { cores } from '../ganchos'

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  BoxplotChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  DatasetComponent,
  CanvasRenderer,
])

export type Paleta = ReturnType<typeof cores>

export function Grafico({
  opcao,
  altura = 260,
  rotulo,
}: {
  /** Recebe a paleta já resolvida: o ECharts desenha em canvas e não lê `var()`. */
  opcao: (p: Paleta) => echarts.EChartsCoreOption
  altura?: number
  rotulo: string
}) {
  const alvo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!alvo.current) return
    const g = echarts.init(alvo.current, undefined, { renderer: 'canvas' })
    const p = cores()
    g.setOption({
      animation: false,
      textStyle: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: p.conteudoFraco },
      tooltip: {
        backgroundColor: p.superficie,
        borderColor: p.borda,
        textStyle: { color: p.conteudo, fontSize: 12 },
        extraCssText: 'box-shadow:0 6px 24px rgba(0,0,0,.18);',
      },
      ...opcao(p),
    })
    const ro = new ResizeObserver(() => g.resize())
    ro.observe(alvo.current)
    return () => {
      ro.disconnect()
      g.dispose()
    }
  }, [opcao])

  return <div ref={alvo} role="img" aria-label={rotulo} style={{ height: altura }} className="w-full" />
}
