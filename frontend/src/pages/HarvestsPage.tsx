import { BrSelectStandard } from '@govbr-ds/react-components'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { HarvestStatusBadge } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { StatCard } from '@/components/StatCard'
import { Tabs } from '@/components/Tabs'
import type { Aba } from '@/components/Tabs'
import { dicaDeColuna } from '@/lib/columnHints'
import { harvestDuration } from '@/lib/duration'
import { harvestTone } from '@/lib/harvestStatus'
import { TUDO, tamanhoDaUrl, tamanhoParaUrl } from '@/lib/pagination'
import { linkedHarvestsQuery } from '@/lib/queries'
import type { HarvestWithRepository, LinkedHarvestsRepository } from '@/lib/types'

/**
 * Itens por página das duas tabelas.
 *
 * Com "tudo", como no histórico do repositório: a resposta chega inteira numa
 * requisição e é o mesmo conjunto que alimenta os cartões e o gráfico, então a
 * página é recorte de tela e nada mais.
 */
const POR_PAGINA = 25
const TAMANHOS = [10, 25, 50, TUDO] as const

const TODOS = ''

/**
 * Seção Coleta: o que aconteceu nas coletas dos repositórios vinculados.
 *
 * Duas abas sobre a mesma resposta. "Últimas" olha a coleta mais recente de
 * cada repositório — é a pergunta "como está agora?". "Histórico" olha todas as
 * coletas juntas, por mês — é a pergunta "como tem sido?". A tela do
 * repositório já mostra o histórico de **um**; esta junta os de todos os
 * vínculos, para o administrador acompanhar o acervo de uma vez.
 *
 * Exclusiva do ADMIN. O `AdminRoute` que a envolve é conveniência de
 * navegação; quem recusa de fato é o backend, com 403 na rota de coletas.
 *
 * A aba e o repositório escolhido vivem na URL, não em estado: o gestor manda
 * o link do histórico filtrado e quem abre cai no mesmo recorte, e o botão
 * voltar desfaz a troca de aba.
 *
 * Abas no `Tabs` próprio do projeto, pelo motivo registrado nele: o `BrTab` do
 * pacote React não emite `role="tablist"` nem navegação por seta.
 */
export function HarvestsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const aba = searchParams.get('aba') === 'historico' ? 'historico' : 'ultimas'
  const repositorioEscolhido = searchParams.get('repositorio') ?? TODOS

  const { data, isPending, isError, error, refetch } = useQuery(linkedHarvestsQuery)

  const alterarParams = (mudanca: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams)
    mudanca(params)
    // Trocar de aba ou de repositório muda a lista; a página antiga seria um
    // trecho arbitrário da lista nova, ou uma página vazia.
    params.delete('page')
    params.delete('por')
    setSearchParams(params, { replace: true })
  }

  const trocarAba = (chave: string) =>
    alterarParams((params) =>
      chave === 'ultimas' ? params.delete('aba') : params.set('aba', chave),
    )

  const trocarRepositorio = (valor: string) =>
    alterarParams((params) =>
      valor === TODOS ? params.delete('repositorio') : params.set('repositorio', valor),
    )

  const repositorios = useMemo(() => data?.repositories ?? [], [data])
  const coletas = useMemo(() => {
    const todas = data?.results ?? []
    if (repositorioEscolhido === TODOS) return todas
    return todas.filter((c) => c.repository.harvesterRepositoryId === repositorioEscolhido)
  }, [data, repositorioEscolhido])
  const repositoriosNoRecorte = useMemo(
    () =>
      repositorioEscolhido === TODOS
        ? repositorios
        : repositorios.filter((r) => r.harvesterRepositoryId === repositorioEscolhido),
    [repositorios, repositorioEscolhido],
  )

  const indisponiveis = repositoriosNoRecorte.filter((r) => r.unavailable)

  if (isPending) return <Loading id="harvests-page-loading" />
  if (isError)
    return <ErrorState id="harvests-page-error" error={error} onRetry={() => void refetch()} />

  const abas: Aba[] = [
    {
      chave: 'ultimas',
      rotulo: t('harvestsPage.tabs.latest'),
      conteudo: <Ultimas coletas={coletas} repositorios={repositoriosNoRecorte} />,
    },
    {
      chave: 'historico',
      rotulo: t('harvestsPage.tabs.history'),
      conteudo: <Historico coletas={coletas} repositorios={repositoriosNoRecorte} />,
    },
  ]

  return (
    <div id="harvests-page" className="d-flex flex-column gap-4">
      <PageHeader
        id="harvests-page-header"
        eyebrow={t('nav.admin')}
        title={t('harvestsPage.title')}
        description={t('harvestsPage.description')}
      />

      {repositorios.length === 0 ? (
        <Empty id="harvests-page-no-repositories" label={t('harvestsPage.noRepositories')} />
      ) : (
        <>
          <div
            id="harvests-page-toolbar"
            className="d-flex flex-wrap align-items-end"
            style={{ gap: 'var(--spacing-scale-2x)' }}
          >
            {/*
              `aria-label` em vez de `label`: com um `id` nosso o `BrSelectStandard`
              deixa o `<label htmlFor>` apontando para o id que ele mesmo gerou e
              descartou — ver `ColumnFilterSelect`. O texto visível ao lado é
              decorativo; o nome acessível é o do `aria-label`.
            */}
            <span
              id="harvests-page-repository-label"
              className="text-down-01 text-bold"
              aria-hidden="true"
            >
              {t('harvestsPage.repositoryFilter')}
            </span>
            <BrSelectStandard
              id="harvests-page-repository"
              aria-label={t('harvestsPage.repositoryFilter')}
              value={repositorioEscolhido}
              onChange={(evento) => trocarRepositorio(evento.target.value)}
              options={[
                { label: t('harvestsPage.allRepositories'), value: TODOS },
                ...repositorios.map((r) => ({
                  label: r.acronym ?? r.harvesterRepositoryId,
                  value: r.harvesterRepositoryId,
                })),
              ]}
            />
          </div>

          {indisponiveis.length > 0 ? (
            <div id="harvests-page-unavailable" className="br-message warning" role="status">
              <div id="harvests-page-unavailable-icon" className="icon">
                <i className="fas fa-exclamation-triangle fa-lg" aria-hidden="true" />
              </div>
              <div id="harvests-page-unavailable-content" className="content">
                <span id="harvests-page-unavailable-title" className="message-title">
                  {t('harvestsPage.unavailableTitle')}
                </span>
                <span id="harvests-page-unavailable-body" className="message-body">
                  {t('harvestsPage.unavailableBody', {
                    list: indisponiveis.map((r) => r.acronym ?? r.harvesterRepositoryId).join(', '),
                  })}
                </span>
              </div>
            </div>
          ) : null}

          <Tabs id="harvests-page-tabs" ativa={aba} onTrocar={trocarAba} abas={abas} />
        </>
      )}
    </div>
  )
}

/**
 * Aba "Últimas": a coleta mais recente de cada repositório.
 *
 * A resposta vem ordenada da mais recente para a mais antiga, então a primeira
 * ocorrência de cada repositório é a última coleta dele. Repositório sem
 * nenhuma coleta não tem linha — entra só na contagem "sem coleta".
 */
function Ultimas({
  coletas,
  repositorios,
}: {
  coletas: HarvestWithRepository[]
  repositorios: LinkedHarvestsRepository[]
}) {
  const { t } = useTranslation()

  const ultimas = useMemo(() => {
    const vistos = new Set<string>()
    return coletas.filter((c) => {
      const id = c.repository.harvesterRepositoryId
      if (vistos.has(id)) return false
      vistos.add(id)
      return true
    })
  }, [coletas])

  const comErro = ultimas.filter((c) => harvestTone(c.status) === 'down').length
  // Sem término é coleta que ainda não acabou — em andamento ou travada; as
  // duas merecem o olhar do gestor, e a origem não distingue uma da outra.
  const emAndamento = ultimas.filter((c) => !c.endTime).length
  const semColeta = repositorios.filter(
    (r) =>
      !r.unavailable &&
      !ultimas.some((c) => c.repository.harvesterRepositoryId === r.harvesterRepositoryId),
  ).length

  return (
    <div id="harvests-page-latest" className="d-flex flex-column gap-4">
      <section id="harvests-page-latest-stats" className="row">
        <div id="harvests-page-latest-stat-repositories-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-latest-stat-repositories"
            label={t('harvestsPage.latest.stats.withHarvest')}
            value={ultimas.length}
          />
        </div>
        <div id="harvests-page-latest-stat-errors-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-latest-stat-errors"
            label={t('harvestsPage.latest.stats.errors')}
            value={comErro}
            tone={comErro > 0 ? 'down' : 'ok'}
          />
        </div>
        <div id="harvests-page-latest-stat-running-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-latest-stat-running"
            label={t('harvestsPage.latest.stats.running')}
            value={emAndamento}
            tone="gold"
          />
        </div>
        <div id="harvests-page-latest-stat-never-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-latest-stat-never"
            label={t('harvestsPage.latest.stats.never')}
            value={semColeta}
          />
        </div>
      </section>

      {ultimas.length === 0 ? (
        <Empty id="harvests-page-latest-empty" label={t('harvestsPage.empty')} />
      ) : (
        <TabelaDeColetas id="harvests-page-latest-table" coletas={ultimas} />
      )}
    </div>
  )
}

type Mes = { mes: string; coletas: number; falhas: number; taxa: number }

/**
 * Aba "Histórico": todas as coletas dos vínculos, agregadas por mês.
 *
 * O gráfico é o do experimento (`exp1/evidence`, aba Histórico): coletas e
 * falhas por mês como barras e a taxa de falha como linha, no eixo da direita.
 * A agregação é por **início** da coleta, porque é o único carimbo que toda
 * coleta tem — uma em andamento ainda não tem término.
 *
 * A duração mediana, e não a média: uma coleta que travou por dias puxaria a
 * média para longe do que é típico.
 */
function Historico({
  coletas,
  repositorios,
}: {
  coletas: HarvestWithRepository[]
  repositorios: LinkedHarvestsRepository[]
}) {
  const { t, i18n } = useTranslation()
  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )
  const percentual = useMemo(
    () =>
      new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.resolvedLanguage],
  )

  const meses = useMemo<Mes[]>(() => {
    const porMes = new Map<string, { coletas: number; falhas: number }>()
    for (const coleta of coletas) {
      if (!coleta.startTime) continue
      const chave = coleta.startTime.slice(0, 7)
      const atual = porMes.get(chave) ?? { coletas: 0, falhas: 0 }
      atual.coletas += 1
      if (harvestTone(coleta.status) === 'down') atual.falhas += 1
      porMes.set(chave, atual)
    }
    return [...porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, { coletas: n, falhas }]) => ({ mes, coletas: n, falhas, taxa: falhas / n }))
  }, [coletas])

  const falhas = coletas.filter((c) => harvestTone(c.status) === 'down').length
  const repositoriosComColeta = new Set(coletas.map((c) => c.repository.harvesterRepositoryId)).size
  const duracoes = coletas
    .map((c) => harvestDuration(c.startTime, c.endTime))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => d.horas * 3600 + d.minutos * 60 + d.segundos)
    .sort((a, b) => a - b)
  const mediana =
    duracoes.length === 0
      ? null
      : duracoes.length % 2 === 1
        ? duracoes[(duracoes.length - 1) / 2]
        : Math.round((duracoes[duracoes.length / 2 - 1] + duracoes[duracoes.length / 2]) / 2)

  return (
    <div id="harvests-page-history" className="d-flex flex-column gap-4">
      <section id="harvests-page-history-stats" className="row">
        <div id="harvests-page-history-stat-harvests-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-harvests"
            label={t('harvestsPage.history.stats.harvests')}
            value={numero.format(coletas.length)}
            hint={t('harvestsPage.history.stats.repositoriesHint', {
              count: repositoriosComColeta,
              total: repositorios.length,
            })}
          />
        </div>
        <div id="harvests-page-history-stat-failures-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-failures"
            label={t('harvestsPage.history.stats.failures')}
            value={numero.format(falhas)}
            tone={falhas > 0 ? 'down' : 'ok'}
          />
        </div>
        <div id="harvests-page-history-stat-rate-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-rate"
            label={t('harvestsPage.history.stats.failureRate')}
            value={coletas.length === 0 ? '—' : percentual.format(falhas / coletas.length)}
          />
        </div>
        <div id="harvests-page-history-stat-duration-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-duration"
            label={t('harvestsPage.history.stats.medianDuration')}
            value={mediana === null ? '—' : segundosEmTexto(t, mediana)}
          />
        </div>
      </section>

      {coletas.length === 0 ? (
        <Empty id="harvests-page-history-empty" label={t('harvestsPage.empty')} />
      ) : (
        <>
          {meses.length > 1 ? (
            <figure id="harvests-page-history-chart" className="br-card p-3 mb-0">
              <figcaption
                id="harvests-page-history-chart-caption"
                className="text-down-01 text-bold mb-2"
              >
                {t('harvestsPage.history.chart.title')}
              </figcaption>
              <div id="harvests-page-history-chart-area" style={{ height: '16rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={meses} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                    <XAxis
                      dataKey="mes"
                      stroke="var(--color-content-muted)"
                      tickLine={false}
                      fontSize={11}
                    />
                    <YAxis
                      yAxisId="contagem"
                      allowDecimals={false}
                      stroke="var(--color-content-muted)"
                      tickLine={false}
                      fontSize={11}
                      width={56}
                    />
                    <YAxis
                      yAxisId="taxa"
                      orientation="right"
                      domain={[0, 1]}
                      tickFormatter={(valor) => percentual.format(Number(valor))}
                      stroke="var(--color-content-muted)"
                      tickLine={false}
                      fontSize={11}
                      width={56}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '0.5rem',
                        border: '1px solid var(--color-border-subtle)',
                        fontSize: '0.8rem',
                      }}
                      formatter={(valor, nome) =>
                        nome === t('harvestsPage.history.chart.rate')
                          ? percentual.format(Number(valor))
                          : numero.format(Number(valor))
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                    <Bar
                      yAxisId="contagem"
                      dataKey="coletas"
                      name={t('harvestsPage.history.chart.harvests')}
                      fill="var(--color-brand)"
                    />
                    <Bar
                      yAxisId="contagem"
                      dataKey="falhas"
                      name={t('harvestsPage.history.chart.failures')}
                      fill="var(--color-down)"
                    />
                    <Line
                      yAxisId="taxa"
                      type="monotone"
                      dataKey="taxa"
                      name={t('harvestsPage.history.chart.rate')}
                      stroke="var(--color-content)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </figure>
          ) : null}

          <TabelaDeColetas id="harvests-page-history-table" coletas={coletas} />
        </>
      )}
    </div>
  )
}

/**
 * Tabela de coletas com o repositório na primeira coluna.
 *
 * Pagina no navegador e lê `page`/`por` da URL. As duas abas compartilham os
 * parâmetros sem disputa porque só a aba ativa é montada — e a troca de aba
 * zera os dois.
 *
 * As colunas repetem as do histórico do repositório e acrescentam repositório,
 * indexação e duração: aqui as linhas são de repositórios diferentes, e a
 * duração é o que diz se uma coleta sem término está andando ou travou.
 */
function TabelaDeColetas({ id, coletas }: { id: string; coletas: HarvestWithRepository[] }) {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const dataFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'short' }),
    [i18n.resolvedLanguage],
  )
  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )

  const pagina = Math.max(1, Number(searchParams.get('page') ?? 1))
  const porPagina = tamanhoDaUrl(searchParams.get('por'), TAMANHOS, POR_PAGINA)
  const totalDePaginas = Math.max(1, Math.ceil(coletas.length / porPagina))
  const paginaAtual = Math.min(pagina, totalDePaginas)
  const visiveis = coletas.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina)

  const alterarParams = (mudanca: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams)
    mudanca(params)
    setSearchParams(params, { replace: true })
  }
  const irParaPagina = (destino: number) =>
    alterarParams((params) =>
      destino <= 1 ? params.delete('page') : params.set('page', String(destino)),
    )
  const mudarTamanho = (tamanho: number) =>
    alterarParams((params) => {
      const valor = tamanhoParaUrl(tamanho, POR_PAGINA)
      if (valor) params.set('por', valor)
      else params.delete('por')
      params.delete('page')
    })

  const dataHora = (valor: string | null) =>
    valor ? dataFormat.format(new Date(valor.replace(' ', 'T'))) : '—'

  const indexacao = (valor: string | null) => {
    if (!valor) return t('harvest.notIndexed')
    const chave = `harvestStatus.${valor.toLowerCase()}`
    return i18n.exists(chave) ? t(chave) : valor
  }

  const colunas: { chave: string; rotulo: string; dica: string }[] = [
    {
      chave: 'repository',
      rotulo: t('harvestsPage.columns.repository'),
      dica: t('harvestsPage.columnHints.repository'),
    },
    {
      chave: 'snapshot',
      rotulo: t('harvests.columns.snapshot'),
      dica: t('harvests.columnHints.snapshot'),
    },
    {
      chave: 'status',
      rotulo: t('harvests.columns.status'),
      dica: t('harvests.columnHints.status'),
    },
    {
      chave: 'index',
      rotulo: t('harvestsPage.columns.index'),
      dica: t('harvestsPage.columnHints.index'),
    },
    { chave: 'start', rotulo: t('harvests.columns.start'), dica: t('harvests.columnHints.start') },
    { chave: 'end', rotulo: t('harvests.columns.end'), dica: t('harvests.columnHints.end') },
    {
      chave: 'duration',
      rotulo: t('harvestsPage.columns.duration'),
      dica: t('harvestsPage.columnHints.duration'),
    },
    { chave: 'size', rotulo: t('harvests.columns.size'), dica: t('harvests.columnHints.size') },
    { chave: 'valid', rotulo: t('harvests.columns.valid'), dica: t('harvests.columnHints.valid') },
    {
      chave: 'invalid',
      rotulo: t('harvests.columns.invalid'),
      dica: t('harvests.columnHints.invalid'),
    },
  ]

  return (
    <div id={id} className="d-flex flex-column gap-3">
      <div id={`${id}-wrapper`} className="br-table" style={{ overflowX: 'auto' }}>
        <table id={`${id}-table`}>
          <thead id={`${id}-head`}>
            <tr id={`${id}-head-row`} className="bg-gray-2 text-left">
              {colunas.map((coluna) => (
                <th
                  id={`${id}-column-${coluna.chave}`}
                  key={coluna.chave}
                  className="px-3 py-2 text-down-01 text-bold"
                  {...dicaDeColuna(coluna.dica)}
                >
                  {coluna.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody id={`${id}-body`}>
            {visiveis.map((coleta) => {
              const linha = `${id}-row-${coleta.snapshotId}`
              const duracao = harvestDuration(coleta.startTime, coleta.endTime)
              const invalidos = invalidosDe(coleta)
              return (
                <tr id={linha} key={coleta.snapshotId}>
                  <td id={`${linha}-repository`} className="px-3 py-2">
                    <Link
                      id={`${linha}-repository-link`}
                      to={`/repositorios/${coleta.repository.harvesterRepositoryId}`}
                      className="text-blue-warm-vivid-80"
                    >
                      {coleta.repository.acronym ?? coleta.repository.harvesterRepositoryId}
                    </Link>
                  </td>
                  <td id={`${linha}-snapshot`} className="px-3 py-2">
                    <Link
                      id={`${linha}-snapshot-link`}
                      to={`/coletas/${coleta.snapshotId}`}
                      className="text-blue-warm-vivid-80"
                    >
                      {coleta.snapshotId}
                    </Link>
                  </td>
                  <td id={`${linha}-status`} className="px-3 py-2">
                    <HarvestStatusBadge id={`${linha}-status-badge`} status={coleta.status} />
                  </td>
                  <td id={`${linha}-index`} className="px-3 py-2 text-gray-70">
                    {indexacao(coleta.indexStatus)}
                  </td>
                  <td id={`${linha}-start`} className="px-3 py-2 text-gray-70">
                    {dataHora(coleta.startTime)}
                  </td>
                  <td id={`${linha}-end`} className="px-3 py-2 text-gray-70">
                    {dataHora(coleta.endTime)}
                  </td>
                  <td id={`${linha}-duration`} className="px-3 py-2 text-gray-70">
                    {duracao
                      ? segundosEmTexto(
                          t,
                          duracao.horas * 3600 + duracao.minutos * 60 + duracao.segundos,
                        )
                      : '—'}
                  </td>
                  <td id={`${linha}-size`} className="px-3 py-2">
                    {coleta.size === null ? '—' : numero.format(coleta.size)}
                  </td>
                  <td id={`${linha}-valid`} className="px-3 py-2">
                    {coleta.validSize === null ? '—' : numero.format(coleta.validSize)}
                  </td>
                  <td id={`${linha}-invalid`} className="px-3 py-2">
                    {invalidos === null ? '—' : numero.format(invalidos)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        id={`${id}-pagination`}
        page={paginaAtual}
        totalPages={totalDePaginas}
        onChange={irParaPagina}
        tamanho={porPagina}
        tamanhos={TAMANHOS}
        onTamanho={mudarTamanho}
      />
    </div>
  )
}

/**
 * Inválidos de uma coleta: o número que a origem não manda.
 *
 * `null` quando falta o total ou os válidos — a subtração aí seria invenção, e
 * zero leria como "nenhum inválido", que é outra afirmação. Mesma conta da
 * tela do repositório.
 */
function invalidosDe(coleta: { size: number | null; validSize: number | null }): number | null {
  if (typeof coleta.size !== 'number' || typeof coleta.validSize !== 'number') return null
  return Math.max(0, coleta.size - coleta.validSize)
}

/**
 * Duração legível a partir de segundos: "1 h 5 min", "3 min 12 s", "40 s".
 *
 * Os segundos só desaparecem quando há hora — "1 h 5 min" basta, mas "3 min"
 * sem os segundos perderia precisão numa coleta curta. É a mesma regra da
 * moldura da coleta (`HarvestLayout`).
 */
function segundosEmTexto(t: (chave: string) => string, total: number): string {
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = total % 60
  return [
    horas ? `${horas} ${t('harvest.units.hours')}` : '',
    minutos ? `${minutos} ${t('harvest.units.minutes')}` : '',
    !horas ? `${segundos} ${t('harvest.units.seconds')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
