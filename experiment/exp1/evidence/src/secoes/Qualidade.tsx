import { useCallback, useMemo } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { Barras, Carregando, Erro, Guia, Nota, Painel, Pilula, Secao, type Tom } from '../componentes/Basicos'
import { Grafico, type Paleta } from '../componentes/Grafico'
import { Tabela } from '../componentes/Tabela'
import { n, pc, razao } from '../formato'
import { colunaFonte } from './comum'

const ORDEM_BANDA = ['100%', '95% a 99,9%', '80% a 95%', '50% a 80%', 'abaixo de 50%', 'sem registros']
const TOM_BANDA: Record<string, Tom> = {
  '100%': 'ok',
  '95% a 99,9%': 'ok',
  '80% a 95%': 'warn',
  '50% a 80%': 'warn',
  'abaixo de 50%': 'down',
  'sem registros': 'neutro',
}

type Bin = { faixa: number; fontes: number }
type Banda = { chave: string; total: number }
type Invalida = {
  source_id: string
  source_name_raw: string
  institution_name: string
  platform_analysis_group: string
  invalidos: number
  latest_size: number
  latest_valid_size: number
}

export function Qualidade({ filtros, aoAbrirFonte }: { filtros: Filtros; aoAbrirFonte: (id: string) => void }) {
  const w = onde(filtros)

  // Faixas de 5 pontos. `least(.., 19)` costura o 100% exato no último balde,
  // que senão viraria um balde 20 com uma fonte só.
  const hist = useConsulta<Bin>(
    useMemo(
      () => `SELECT least(floor(taxa_validade * 20), 19)::INT AS faixa, count(*) AS fontes
             FROM v_source ${w} ${w ? 'AND' : 'WHERE'} taxa_validade IS NOT NULL
             GROUP BY 1 ORDER BY 1`,
      [w],
    ),
  )
  const validade = useConsulta<Banda>(
    useMemo(() => `SELECT banda_validade AS chave, count(*) AS total FROM v_source ${w} GROUP BY 1`, [w]),
  )
  const transformacao = useConsulta<Banda>(
    useMemo(
      () => `SELECT CASE
               WHEN taxa_transformacao IS NULL   THEN 'sem registros'
               WHEN taxa_transformacao >= 1      THEN '100%'
               WHEN taxa_transformacao >= 0.95   THEN '95% a 99,9%'
               WHEN taxa_transformacao >= 0.80   THEN '80% a 95%'
               WHEN taxa_transformacao >= 0.50   THEN '50% a 80%'
               ELSE 'abaixo de 50%' END AS chave,
             count(*) AS total FROM v_source ${w} GROUP BY 1`,
      [w],
    ),
  )
  const piores = useConsulta<Invalida>(
    useMemo(
      () => `SELECT source_id, source_name_raw, institution_name, platform_analysis_group,
                    latest_size - latest_valid_size AS invalidos, latest_size, latest_valid_size
             FROM v_source ${w} ${w ? 'AND' : 'WHERE'} latest_size > latest_valid_size
             ORDER BY invalidos DESC LIMIT 15`,
      [w],
    ),
  )
  const total = useConsulta<{ invalidos: number }>(
    useMemo(
      () => `SELECT COALESCE(sum(latest_size - latest_valid_size), 0) AS invalidos FROM v_source ${w}`,
      [w],
    ),
  )

  const opcao = useCallback(
    (p: Paleta) => {
      const bins = new Array(20).fill(0)
      for (const b of hist.dados ?? []) bins[b.faixa] = b.fontes
      return {
        grid: { left: 52, right: 8, top: 10, bottom: 26 },
        xAxis: {
          type: 'category',
          data: bins.map((_, i) => `${i * 5}`),
          axisLine: { lineStyle: { color: p.borda } },
          axisTick: { show: false },
          axisLabel: {
            color: p.conteudoFraco,
            interval: 4,
            formatter: (v: string) => `${v}%`,
          },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: p.borda } },
          axisLabel: { color: p.conteudoFraco },
        },
        tooltip: {
          trigger: 'axis',
          formatter: (a: { dataIndex: number; value: number }[]) =>
            `${a[0].dataIndex * 5}–${a[0].dataIndex * 5 + 5}%<br/><b>${a[0].value.toLocaleString('pt-BR')}</b> fontes`,
        },
        series: [
          {
            type: 'bar',
            data: bins.map((v, i) => ({
              value: v,
              itemStyle: { color: i >= 19 ? p.ok : i >= 16 ? p.marca : i >= 10 ? p.warn : p.down },
            })),
            barCategoryGap: '12%',
          },
        ],
      }
    },
    [hist.dados],
  )

  const primeiroErro = [hist, validade, transformacao, piores].find((c) => c.erro)
  if (primeiroErro?.erro) return <Erro mensagem={primeiroErro.erro} />

  const ordenar = (d: Banda[] | null) =>
    d
      ? ORDEM_BANDA.map((k) => ({ rotulo: k, valor: d.find((x) => x.chave === k)?.total ?? 0, tom: TOM_BANDA[k] }))
      : []
  const maior = hist.dados?.reduce((a, b) => (b.fontes > a.fontes ? b : a), { faixa: 0, fontes: 0 })

  return (
    <>
      <Secao>Distribuição da taxa de validade</Secao>
      <Painel>
        {hist.dados ? (
          <>
            <Grafico opcao={opcao} altura={240} rotulo="Histograma da taxa de validade" />
            <p className="mt-2 text-down-01 text-conteudo-fraco">
              Fontes com ao menos um registro coletado, em faixas de 5 pontos percentuais de{' '}
              <span className="">válidos ÷ coletados</span>. A escala é linear e a distribuição é
              fortemente assimétrica: a faixa {maior ? `${maior.faixa * 5}–${maior.faixa * 5 + 5}%` : ''} sozinha
              reúne {n(maior?.fontes ?? 0)} fontes.
            </p>
          </>
        ) : (
          <Carregando o="o histograma" />
        )}
      </Painel>

      <div className="mt-3.5 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
        <Painel titulo="Faixas de validade">
          {validade.dados ? <Barras itens={ordenar(validade.dados)} /> : <Carregando o="as faixas" />}
        </Painel>
        <Painel titulo="Faixas de transformação">
          {transformacao.dados ? <Barras itens={ordenar(transformacao.dados)} /> : <Carregando o="as faixas" />}
        </Painel>
      </div>

      <Secao>Maior volume absoluto de registros inválidos</Secao>
      <Guia>
        A taxa percentual esconde escala. Estas são as fontes que mais contribuem para o total de{' '}
        <b className="font-semibold text-conteudo">{n(total.dados?.[0]?.invalidos ?? null)}</b> registros inválidos —
        onde uma correção rende mais.
      </Guia>
      {piores.dados ? (
        <Tabela
          id="qualidade-invalidos"
          dados={piores.dados}
          nome="Maior volume de registros inválidos"
          aoClicarLinha={(l) => aoAbrirFonte(l.source_id)}
          colunas={[
            colunaFonte<Invalida>(),
            {
              header: 'Plataforma',
              accessorKey: 'platform_analysis_group',
              cell: (c) => <Pilula>{c.getValue() as string}</Pilula>,
            },
            {
              header: 'Inválidos',
              accessorKey: 'invalidos',
              meta: { num: true },
              cell: (c) => <b className="font-semibold">{n(c.getValue() as number)}</b>,
            },
            {
              header: 'Coletados',
              accessorKey: 'latest_size',
              meta: { num: true },
              cell: (c) => n(c.getValue() as number),
            },
            {
              header: 'Validade',
              id: 'validade',
              meta: { num: true },
              accessorFn: (l) => l.latest_valid_size / l.latest_size,
              cell: (c) => razao(c.row.original.latest_valid_size, c.row.original.latest_size),
            },
          ]}
        />
      ) : (
        <Carregando o="as fontes" />
      )}

      <Nota>
        Validade e transformação medem coisas diferentes e falham de modos diferentes. A transformação é
        praticamente universal — mediana de 100% em toda plataforma — enquanto a validação de perfil rejeita{' '}
        {pc((total.dados?.[0]?.invalidos ?? 0) / 4970249)} do total. <b>O gargalo está na origem do metadado</b>, não
        no processamento do Harvester.
      </Nota>
    </>
  )
}
