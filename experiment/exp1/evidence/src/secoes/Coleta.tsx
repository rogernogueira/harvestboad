import { useMemo } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { Barras, Carregando, Erro, Nota, Painel, Pilula, Secao, type Tom } from '../componentes/Basicos'
import { Tabela } from '../componentes/Tabela'
import { n } from '../formato'
import { TOM_COLETA, colunaFonte } from './comum'

const TOM_INDICE: Record<string, Tom> = {
  INDEXED: 'ok',
  FAILED: 'down',
  SEM_INDICE: 'neutro',
  UNKNOWN: 'warn',
}
const TOM_SITUACAO: Record<string, Tom> = {
  ACTIVE: 'ok',
  INACTIVE: 'down',
  TEMPORARILY_UNAVAILABLE: 'warn',
  UNKNOWN: 'neutro',
}
const ORDEM_ATUALIDADE = [
  'até 30 dias',
  '31 a 90',
  '91 a 180',
  '181 a 365',
  '1 a 2 anos',
  'mais de 2 anos',
  'nunca coletada',
]
const TOM_ATUALIDADE: Record<string, Tom> = {
  'até 30 dias': 'ok',
  '31 a 90': 'ok',
  '91 a 180': 'warn',
  '181 a 365': 'warn',
  '1 a 2 anos': 'down',
  'mais de 2 anos': 'down',
  'nunca coletada': 'neutro',
}

type Contagem = { chave: string; total: number }
type Desatualizada = {
  source_id: string
  source_name_raw: string
  institution_name: string
  platform_analysis_group: string
  latest_snapshot_status: string
  days_since_last_harvest: number
  latest_size: number
}

export function Coleta({
  filtros,
  aoFiltrarColeta,
  aoAbrirFonte,
}: {
  filtros: Filtros
  aoFiltrarColeta: (v: string) => void
  aoAbrirFonte: (id: string) => void
}) {
  const w = onde(filtros)
  const contagem = (campo: string) =>
    `SELECT ${campo} AS chave, count(*) AS total FROM v_source ${w} GROUP BY 1 ORDER BY 2 DESC`

  const snapshot = useConsulta<Contagem>(useMemo(() => contagem('latest_snapshot_status'), [w]))
  const indice = useConsulta<Contagem>(useMemo(() => contagem('latest_index_status'), [w]))
  const situacao = useConsulta<Contagem>(useMemo(() => contagem('source_status'), [w]))
  const atualidade = useConsulta<Contagem>(useMemo(() => contagem('banda_atualidade'), [w]))
  const mediana = useConsulta<{ d: number | null }>(
    useMemo(() => `SELECT median(days_since_last_harvest) AS d FROM v_source ${w}`, [w]),
  )
  const piores = useConsulta<Desatualizada>(
    useMemo(
      () => `SELECT source_id, source_name_raw, institution_name, platform_analysis_group,
                    latest_snapshot_status, days_since_last_harvest, latest_size
             FROM v_source ${w} ${w ? 'AND' : 'WHERE'} days_since_last_harvest IS NOT NULL
             ORDER BY days_since_last_harvest DESC LIMIT 15`,
      [w],
    ),
  )

  const primeiroErro = [snapshot, indice, situacao, atualidade, piores].find((c) => c.erro)
  if (primeiroErro?.erro) return <Erro mensagem={primeiroErro.erro} />

  const barras = (c: typeof snapshot, tons: Record<string, Tom>) =>
    c.dados ? c.dados.map((d) => ({ rotulo: d.chave, valor: d.total, tom: tons[d.chave] })) : []

  return (
    <>
      <Secao>Estado da última coleta</Secao>
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
        <Painel titulo="Situação do snapshot">
          {snapshot.dados ? (
            <>
              <Barras itens={barras(snapshot, TOM_COLETA)} aoClicar={aoFiltrarColeta} ativo={filtros.coleta} />
              <p className="mt-3 text-down-01 text-conteudo-fraco">Clique numa barra para filtrar o painel inteiro por ela.</p>
            </>
          ) : (
            <Carregando o="os estados" />
          )}
        </Painel>
        <Painel titulo="Situação no índice">
          {indice.dados ? <Barras itens={barras(indice, TOM_INDICE)} /> : <Carregando o="o índice" />}
        </Painel>
        <Painel titulo="Situação cadastral da fonte">
          {situacao.dados ? <Barras itens={barras(situacao, TOM_SITUACAO)} /> : <Carregando o="o cadastro" />}
        </Painel>
        <Painel titulo="Atualidade — dias desde a última coleta">
          {atualidade.dados ? (
            <Barras
              itens={[...atualidade.dados]
                .sort((a, b) => ORDEM_ATUALIDADE.indexOf(a.chave) - ORDEM_ATUALIDADE.indexOf(b.chave))
                .map((d) => ({ rotulo: d.chave, valor: d.total, tom: TOM_ATUALIDADE[d.chave] }))}
            />
          ) : (
            <Carregando o="a atualidade" />
          )}
        </Painel>
      </div>

      <Secao>Fontes mais desatualizadas</Secao>
      {piores.dados ? (
        <Tabela
          id="coleta-desatualizadas"
          dados={piores.dados}
          nome="Fontes mais desatualizadas"
          aoClicarLinha={(l) => aoAbrirFonte(l.source_id)}
          colunas={[
            colunaFonte<Desatualizada>(),
            {
              header: 'Plataforma',
              accessorKey: 'platform_analysis_group',
              cell: (c) => <Pilula>{c.getValue() as string}</Pilula>,
            },
            {
              header: 'Estado',
              accessorKey: 'latest_snapshot_status',
              cell: (c) => (
                <Pilula tom={TOM_COLETA[c.getValue() as string]}>{c.getValue() as string}</Pilula>
              ),
            },
            {
              header: 'Dias',
              accessorKey: 'days_since_last_harvest',
              meta: { num: true },
              cell: (c) => n(c.getValue() as number),
            },
            {
              header: 'Registros',
              accessorKey: 'latest_size',
              meta: { num: true },
              cell: (c) => n(c.getValue() as number),
            },
          ]}
        />
      ) : (
        <Carregando o="as desatualizadas" />
      )}

      <Nota>
        <b>O agendamento dispara uma vez a cada quatro anos.</b> Todas as 2.183 fontes compartilham a mesma
        expressão cron <span className="">* 0 0 29 2 *</span> — 29 de fevereiro. Ele funcionou em 2020
        (358 fontes varridas no dia) e praticamente não funcionou em 2024 (3). No intervalo, o que existe são lotes
        manuais. A mediana de{' '}
        <span className="">{n(mediana.dados?.[0]?.d ?? null)}</span> dias desde a última coleta é
        consequência disso, não de fontes paradas.
      </Nota>
    </>
  )
}
