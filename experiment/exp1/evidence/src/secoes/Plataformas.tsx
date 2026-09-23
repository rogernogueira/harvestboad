import { useCallback, useMemo } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { Barras, Carregando, Erro, Guia, Nota, Painel, Secao, type Tom } from '../componentes/Basicos'
import { Grafico, type Paleta } from '../componentes/Grafico'
import { Tabela } from '../componentes/Tabela'
import { n, pc } from '../formato'

type Plataforma = {
  plataforma: string
  fontes: number
  registros: number
  validade_mediana: number | null
  validade_agregada: number | null
  erros: number
  persistentes: number
  dias_mediana: number | null
}
type Celula = { tipo: string; plataforma: string; fontes: number }
type Confianca = { chave: string; total: number }
type Sinal = {
  signal_name: string
  probe: string
  strength: string
  weight: number
  fontes: number
  decisivos: number
}

const TOM_CONFIANCA: Record<string, Tom> = {
  CONFIRMED: 'ok',
  HIGH: 'ok',
  MEDIUM: 'warn',
  LOW: 'down',
  UNKNOWN: 'neutro',
}
const ORDEM_CONFIANCA = ['CONFIRMED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']

export function Plataformas({ filtros }: { filtros: Filtros }) {
  const w = onde(filtros)

  const plataformas = useConsulta<Plataforma>(
    useMemo(
      () => `SELECT platform_analysis_group AS plataforma,
                    count(*)                                        AS fontes,
                    COALESCE(sum(latest_size), 0)                   AS registros,
                    median(taxa_validade)                           AS validade_mediana,
                    sum(latest_valid_size) / nullif(sum(latest_size), 0)::DOUBLE AS validade_agregada,
                    count(*) FILTER (crit_erro)                     AS erros,
                    count(*) FILTER (crit_persistente)              AS persistentes,
                    median(days_since_last_harvest)                 AS dias_mediana
             FROM v_source ${w} GROUP BY 1 ORDER BY fontes DESC`,
      [w],
    ),
  )
  const confianca = useConsulta<Confianca>(
    useMemo(() => `SELECT platform_confidence AS chave, count(*) AS total FROM v_source ${w} GROUP BY 1`, [w]),
  )
  // O heatmap ignora os filtros de propósito: é a matriz completa que sustenta
  // a não-identificabilidade de H1, e recortá-la esconderia justamente os zeros.
  const celulas = useConsulta<Celula>(
    'SELECT source_type_detail AS tipo, platform_analysis_group AS plataforma, fontes FROM v_celula',
  )
  const sinais = useConsulta<Sinal>(
    'SELECT signal_name, probe, strength, weight, fontes, decisivos FROM v_sinal ORDER BY fontes DESC LIMIT 12',
  )

  const opcaoHeat = useCallback(
    (p: Paleta) => {
      const dados = celulas.dados ?? []
      const tipos = [...new Set(dados.map((d) => d.tipo))].sort(
        (a, b) =>
          dados.filter((d) => d.tipo === a).reduce((s, d) => s + d.fontes, 0) -
          dados.filter((d) => d.tipo === b).reduce((s, d) => s + d.fontes, 0),
      )
      const plats = [...new Set(dados.map((d) => d.plataforma))].sort()
      const max = Math.max(1, ...dados.map((d) => d.fontes))
      return {
        grid: { left: 190, right: 16, top: 30, bottom: 12 },
        xAxis: {
          type: 'category',
          data: plats,
          position: 'top',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.conteudoFraco, fontSize: 10 },
        },
        yAxis: {
          type: 'category',
          data: tipos,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.conteudoFraco, fontSize: 10.5 },
        },
        // Escala logarítmica: 1.706 contra 1 numa escala linear pintaria tudo
        // menos uma célula da mesma cor e apagaria a estrutura da matriz.
        visualMap: {
          show: false,
          min: 0,
          max: Math.log(max + 1),
          inRange: { color: [p.superficie, p.marca] },
        },
        tooltip: {
          formatter: (a: { data: { value: [number, number, number, number] } }) =>
            `${tipos[a.data.value[1]]} × ${plats[a.data.value[0]]}<br/><b>${a.data.value[3].toLocaleString('pt-BR')}</b> fontes`,
        },
        series: [
          {
            type: 'heatmap',
            data: dados.map((d) => ({
              value: [plats.indexOf(d.plataforma), tipos.indexOf(d.tipo), Math.log(d.fontes + 1), d.fontes],
              label: { color: Math.log(d.fontes + 1) / Math.log(max + 1) > 0.55 ? p.superficie : p.conteudo },
            })),
            label: {
              show: true,
              fontSize: 10.5,
              formatter: (a: { data: { value: [number, number, number, number] } }) =>
                a.data.value[3] ? a.data.value[3].toLocaleString('pt-BR') : '·',
            },
            itemStyle: { borderColor: p.superficie, borderWidth: 2 },
          },
        ],
      }
    },
    [celulas.dados],
  )

  const primeiroErro = [plataformas, confianca, celulas, sinais].find((c) => c.erro)
  if (primeiroErro?.erro) return <Erro mensagem={primeiroErro.erro} />

  const povoadas = (celulas.dados ?? []).filter((c) => c.fontes > 0).length
  const minusculas = (celulas.dados ?? []).filter((c) => c.fontes > 0 && c.fontes < 5).length
  const totalCelulas = celulas.dados?.length ?? 0

  return (
    <>
      <Secao>Plataformas detectadas</Secao>
      {plataformas.dados ? (
        <Tabela
          id="plataformas-detectadas"
          dados={plataformas.dados}
          nome="Plataformas detectadas"
          colunas={[
            { header: 'Plataforma', accessorKey: 'plataforma', cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
            { header: 'Fontes', accessorKey: 'fontes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Registros', accessorKey: 'registros', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Validade mediana', accessorKey: 'validade_mediana', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Validade agregada', accessorKey: 'validade_agregada', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            {
              header: 'Erro',
              accessorKey: 'erros',
              meta: { num: true },
              cell: (c) =>
                (c.getValue() as number) ? (
                  <span className="rounded-sm bg-erro-alt px-1.5 py-px text-erro">{n(c.getValue() as number)}</span>
                ) : (
                  '0'
                ),
            },
            {
              header: 'Persistentes',
              accessorKey: 'persistentes',
              meta: { num: true },
              cell: (c) =>
                (c.getValue() as number) ? (
                  <span className="rounded-sm bg-erro-alt px-1.5 py-px text-erro">{n(c.getValue() as number)}</span>
                ) : (
                  '0'
                ),
            },
            { header: 'Dias (mediana)', accessorKey: 'dias_mediana', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          ]}
        />
      ) : (
        <Carregando o="as plataformas" />
      )}

      <Secao>Confiança da detecção</Secao>
      <div className="grid items-start gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
        <Painel>
          {confianca.dados ? (
            <Barras
              itens={ORDEM_CONFIANCA.map((k) => ({
                rotulo: k,
                valor: confianca.dados!.find((d) => d.chave === k)?.total ?? 0,
                tom: TOM_CONFIANCA[k],
              }))}
            />
          ) : (
            <Carregando o="a confiança" />
          )}
        </Painel>
        <Painel titulo="Sinais que mais pegaram">
          {sinais.dados ? (
            <Tabela
              id="plataformas-sinais"
              dados={sinais.dados}
              nome="Sinais de detecção"
              colunas={[
                { header: 'Sinal', accessorKey: 'signal_name', cell: (c) => <span className="text-down-01">{c.getValue() as string}</span> },
                { header: 'Sonda', accessorKey: 'probe', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
                { header: 'Força', accessorKey: 'strength', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
                { header: 'Peso', accessorKey: 'weight', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
                { header: 'Fontes', accessorKey: 'fontes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
              ]}
            />
          ) : (
            <Carregando o="os sinais" />
          )}
        </Painel>
      </div>
      <Nota>
        A confiança vem da <b>força</b> do sinal, não do peso. Um <span className="">&lt;meta generator&gt;</span>{' '}
        é assinatura e fecha em <span className="">CONFIRMED</span>; um caminho de URL característico sozinho
        para em <span className="">MEDIUM</span>. O peso só ordena candidatas quando mais de uma plataforma
        pontua.
      </Nota>

      <Secao>Tipo de fonte × plataforma</Secao>
      <Guia>
        A matriz completa, <b>sem os filtros globais</b>: são as células vazias que sustentam o argumento, e recortá-las
        o esconderia.
      </Guia>
      <Painel>
        {celulas.dados ? (
          <Grafico opcao={opcaoHeat} altura={330} rotulo="Matriz de tipo de fonte por plataforma" />
        ) : (
          <Carregando o="a matriz" />
        )}
      </Painel>
      <Nota>
        <b>Este é o gráfico mais importante do conjunto.</b> Das {n(totalCelulas)} células, {n(povoadas)} têm alguma
        fonte e {n(minusculas)} dessas têm menos de cinco. Não há um só periódico científico em DSpace, e dos 158
        repositórios institucionais apenas um roda em OJS. Plataforma e tipo de fonte não são duas variáveis — são
        quase a mesma variável medida duas vezes, e é isso que impede separar o efeito de uma da outra em toda a seção
        de Evidências.
      </Nota>
    </>
  )
}
