import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import { cores, type Paleta } from '@/lib/grafico'

// Registro modular: só os tipos que a seção Coleta usa (barra + linha), para não
// carregar o ECharts inteiro. É o mesmo componente do experimento
// (`exp1/evidence/src/componentes/Grafico.tsx`), trazido para o app.
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/**
 * Gráfico ECharts do experimento.
 *
 * `opcao` recebe a paleta resolvida e devolve a opção do ECharts. Envolva-a em
 * `useCallback` no chamador: o efeito redesenha quando ela muda, e uma função
 * nova a cada render reinicializaria o canvas à toa.
 */
export function Grafico({
  id,
  opcao,
  altura = 260,
  rotulo,
}: {
  id?: string
  opcao: (p: Paleta) => echarts.EChartsCoreOption
  altura?: number
  rotulo: string
}) {
  const alvo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = alvo.current
    if (!el) return
    const g = echarts.init(el, undefined, { renderer: 'canvas' })

    const desenhar = () => {
      const p = cores()
      g.setOption(
        {
          animation: false,
          textStyle: { fontFamily: 'Rawline, sans-serif', fontSize: 11, color: p.conteudoFraco },
          tooltip: {
            backgroundColor: p.superficie,
            borderColor: p.borda,
            textStyle: { color: p.conteudo, fontSize: 12 },
            extraCssText: 'box-shadow:0 6px 24px rgba(0,0,0,.18);',
          },
          ...opcao(p),
        },
        // notMerge: recolore limpo ao trocar de tema, sem resíduo da opção anterior.
        true,
      )
    }

    desenhar()

    const ro = new ResizeObserver(() => g.resize())
    ro.observe(el)
    // Reage à troca de tema (atributo `data-theme`) e à preferência do sistema.
    const mo = new MutationObserver(desenhar)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', desenhar)

    return () => {
      ro.disconnect()
      mo.disconnect()
      mq.removeEventListener('change', desenhar)
      g.dispose()
    }
  }, [opcao])

  return (
    <div
      id={id}
      ref={alvo}
      role="img"
      aria-label={rotulo}
      style={{ height: altura, width: '100%' }}
    />
  )
}
