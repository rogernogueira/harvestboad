import { useCallback } from 'react'
import { useConsulta } from '../ganchos'
import { Cartao, Cartoes, Carregando, Erro, Guia, Nota, Painel, Secao } from '../componentes/Basicos'
import { Grafico, type Paleta } from '../componentes/Grafico'
import { n, n1, pc } from '../formato'

type Mes = { mes: string; coletas: number; fontes: number; falhas: number; taxa_falha: number; registros: number }
type Total = {
  snapshots: number
  fontes: number
  falhas: number
  primeira: string
  ultima: string
  duracao_mediana: number | null
}
type Concentracao = { dia: string; coletas: number }

export function Historico() {
  // Todo o histórico, sem filtro: a série temporal do sistema inteiro é o
  // objeto desta tela, não um recorte dele.
  const meses = useConsulta<Mes>(
    `SELECT strftime(mes, '%Y-%m') AS mes, coletas, fontes, falhas, taxa_falha, registros
     FROM v_mes ORDER BY mes`,
  )
  const total = useConsulta<Total>(
    `SELECT count(*) AS snapshots, count(DISTINCT source_id) AS fontes,
            sum(is_failure::INT) AS falhas,
            strftime(min(start_time), '%Y-%m-%d') AS primeira,
            strftime(max(start_time), '%Y-%m-%d') AS ultima,
            median(duration_seconds) AS duracao_mediana
     FROM snapshots`,
  )
  const picos = useConsulta<Concentracao>(
    `SELECT strftime(start_time, '%Y-%m-%d') AS dia, count(*) AS coletas
     FROM snapshots WHERE start_time IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
  )

  const opcao = useCallback(
    (p: Paleta) => {
      const d = meses.dados ?? []
      return {
        grid: { left: 54, right: 54, top: 34, bottom: 28 },
        legend: { show: true, top: 0, right: 0, textStyle: { color: p.conteudoFraco, fontSize: 10.5 }, itemHeight: 8 },
        xAxis: {
          type: 'category',
          data: d.map((m) => m.mes),
          axisLine: { lineStyle: { color: p.borda } },
          axisTick: { show: false },
          axisLabel: { color: p.conteudoFraco, interval: Math.max(1, Math.floor(d.length / 10)) },
        },
        yAxis: [
          {
            type: 'value',
            splitLine: { lineStyle: { color: p.borda } },
            axisLabel: { color: p.conteudoFraco },
          },
          {
            type: 'value',
            max: 1,
            splitLine: { show: false },
            axisLabel: { color: p.conteudoFraco, formatter: (v: number) => `${Math.round(v * 100)}%` },
          },
        ],
        tooltip: { trigger: 'axis' },
        series: [
          { name: 'coletas', type: 'bar', data: d.map((m) => m.coletas), itemStyle: { color: p.marca } },
          {
            name: 'taxa de falha',
            type: 'line',
            yAxisIndex: 1,
            data: d.map((m) => m.taxa_falha),
            smooth: false,
            symbol: 'none',
            lineStyle: { color: p.down, width: 1.5 },
          },
        ],
      }
    },
    [meses.dados],
  )

  const erro = [meses, total, picos].find((c) => c.erro)?.erro
  if (erro) return <Erro mensagem={erro} />
  const t = total.dados?.[0]

  return (
    <>
      <Guia>
        O histórico completo de coletas do Harvester — todas as tentativas de todas as fontes, sem truncamento. É o
        único bloco do painel que não responde aos filtros globais: a série do sistema inteiro é o objeto aqui.
      </Guia>

      {t ? (
        <Cartoes>
          <Cartao chave="Snapshots" valor={n(t.snapshots)} nota={`em ${n(t.fontes)} fontes`} />
          <Cartao chave="Falhas" valor={n(t.falhas)} nota={pc(t.falhas / t.snapshots)} tom="down" />
          <Cartao chave="Primeira coleta" valor={t.primeira} nota="início da série" />
          <Cartao chave="Última coleta" valor={t.ultima} nota="fim da série" />
          <Cartao
            chave="Duração mediana"
            valor={t.duracao_mediana === null ? '—' : `${n1(t.duracao_mediana)} s`}
            nota="por coleta"
          />
        </Cartoes>
      ) : (
        <Carregando o="os totais" />
      )}

      <Secao>Coletas por mês e taxa de falha</Secao>
      <Painel>
        {meses.dados ? (
          <Grafico opcao={opcao} altura={300} rotulo="Coletas por mês e taxa de falha" />
        ) : (
          <Carregando o="a série" />
        )}
      </Painel>

      <Secao>Dias de maior concentração</Secao>
      <Painel>
        {picos.dados ? (
          <div className="flex flex-col gap-1">
            {picos.dados.map((d) => (
              <div key={d.dia} className="grid grid-cols-[100px_1fr_60px] items-center gap-2.5">
                <span className="text-down-01 text-conteudo-fraco">{d.dia}</span>
                <span className="block h-[15px] overflow-hidden rounded-sm bg-superficie-alt">
                  <span
                    className="block h-full bg-marca"
                    style={{ width: `${(d.coletas / picos.dados![0].coletas) * 100}%` }}
                  />
                </span>
                <span className="num text-right text-down-01">{n(d.coletas)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Carregando o="os picos" />
        )}
      </Painel>

      <Nota>
        <b>O cron de 29 de fevereiro não é decorativo — ele dispara, e quase nunca.</b> Em{' '}
        <span className="">2020-02-29</span> houve 358 coletas em 358 fontes distintas, uma cada: a
        assinatura exata de uma varredura agendada. No 29 de fevereiro seguinte, em 2024, foram 3. Entre um ano
        bissexto e o outro, toda barra desta série corresponde a alguém ter disparado um lote à mão — que é o que
        explica os picos isolados separados por meses de silêncio.
      </Nota>
    </>
  )
}
