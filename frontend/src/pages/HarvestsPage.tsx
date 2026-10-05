import { BrSelectStandard } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { HarvestStatusBadge } from '@/components/Badges'
import { ColumnFilterSelect } from '@/components/ColumnFilterSelect'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Grafico } from '@/components/Grafico'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { StatCard } from '@/components/StatCard'
import { Tabs } from '@/components/Tabs'
import type { Aba } from '@/components/Tabs'
import { dicaDeColuna } from '@/lib/columnHints'
import { baixarCsv } from '@/lib/csv'
import type { Paleta } from '@/lib/grafico'
import { harvestTone } from '@/lib/harvestStatus'
import { TUDO } from '@/lib/pagination'
import { harvestHistoryQuery, refreshHarvestHistory, repositoryIndexQuery } from '@/lib/queries'
import type { HarvestHistoryMonth, RepositoryHit } from '@/lib/types'

/**
 * Tabela "Coletas por Fontes": ordena, filtra e pagina as ~2.184 linhas do
 * índice **no navegador**, com TanStack Table — o mesmo tratamento da tabela de
 * administração (`AdminRepositoriesPage`), que roda sobre o mesmo conjunto já em
 * memória. É o oposto da tabela de registros, que pagina no servidor por causa
 * das dezenas de milhares de linhas.
 */
const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filterFns,
  sortFns,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})
const columnHelper = createColumnHelper<typeof features, RepositoryHit>()

const POR_PAGINA_COLETAS = 25
const TAMANHOS_COLETAS = [25, 100, 1000, TUDO] as const

/** Recorta texto longo em duas linhas (nome da fonte, instituição). */
const RECORTE_DUAS_LINHAS = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
}

/**
 * Seção Coleta: diagnóstico das coletas de TODO o acervo do Harvester.
 *
 * Duas abas reproduzem o experimento (`exp1/evidence`):
 * - "Estado atual" (como `secoes/Coleta.tsx`) olha a última coleta de cada
 *   fonte — distribuições de situação, índice e atualidade, mais a tabela
 *   "Coletas por Fontes". Vem do índice do acervo (`repositoryIndexQuery`), que o
 *   backend já mantém em cache; ordenar, filtrar e paginar é no navegador.
 * - "Histórico" (como `secoes/Historico.tsx`) olha todas as coletas ao longo do
 *   tempo. Vem de um agregado global que o comando `warm_harvest_history`
 *   aquece — a rota só lê cache, nunca varre o Harvester numa requisição.
 *
 * Exclusiva do ADMIN: o `AdminRoute` só esconde a rota; quem recusa de fato é o
 * backend, com 403. A aba e os filtros vivem na URL, não em estado — é o que
 * deixa o recorte compartilhável e o botão voltar desfazer a troca.
 *
 * Antes esta seção cobria só os repositórios vinculados a gestores; agora é o
 * acervo inteiro, que é o objeto de acompanhamento do administrador.
 */
export function HarvestsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const aba = searchParams.get('aba') === 'historico' ? 'historico' : 'estado'

  const trocarAba = (chave: string) => {
    const params = new URLSearchParams(searchParams)
    if (chave === 'estado') params.delete('aba')
    else params.set('aba', chave)
    setSearchParams(params, { replace: true })
  }

  const abas: Aba[] = [
    { chave: 'estado', rotulo: t('harvestsPage.tabs.current'), conteudo: <EstadoAtual /> },
    { chave: 'historico', rotulo: t('harvestsPage.tabs.history'), conteudo: <Historico /> },
  ]

  return (
    <div id="harvests-page" className="d-flex flex-column gap-4">
      <PageHeader
        id="harvests-page-header"
        eyebrow={t('nav.admin')}
        title={t('harvestsPage.title')}
        description={t('harvestsPage.description')}
      />
      <Tabs id="harvests-page-tabs" ativa={aba} onTrocar={trocarAba} abas={abas} />
    </div>
  )
}

// --- Estado atual -----------------------------------------------------------

/**
 * Faixas de atualidade (dias desde a última coleta), na ordem e com os tons do
 * experimento (`secoes/Coleta.tsx`). A chave é estável e vai para a URL; o
 * rótulo é traduzido. `nunca` é a fonte sem data de coleta.
 */
const BANDAS = [
  { chave: '0-30', max: 30 },
  { chave: '31-90', max: 90 },
  { chave: '91-180', max: 180 },
  { chave: '181-365', max: 365 },
  { chave: '1-2a', max: 730 },
  { chave: '2a+', max: Infinity },
] as const
const SEM_COLETA = 'nunca'
const ORDEM_BANDA = ['0-30', '31-90', '91-180', '181-365', '1-2a', '2a+', SEM_COLETA]
const TOM_BANDA: Record<string, Tom> = {
  '0-30': 'ok',
  '31-90': 'ok',
  '91-180': 'warn',
  '181-365': 'warn',
  '1-2a': 'down',
  '2a+': 'down',
  nunca: 'neutro',
}
const TOM_INDICE: Record<string, Tom> = {
  INDEXED: 'ok',
  FAILED: 'down',
  UNKNOWN: 'warn',
}

type Tom = 'ok' | 'warn' | 'down' | 'neutro'

const DIA_EM_MS = 24 * 60 * 60 * 1000

function bandaDeAtualidade(data: string | null, agora: number): string {
  if (!data) return SEM_COLETA
  const quando = new Date(data.replace(' ', 'T')).getTime()
  if (Number.isNaN(quando)) return SEM_COLETA
  const dias = Math.floor((agora - quando) / DIA_EM_MS)
  return (BANDAS.find((b) => dias <= b.max) ?? BANDAS[BANDAS.length - 1]).chave
}

function diasDesde(data: string | null, agora: number): number | null {
  if (!data) return null
  const quando = new Date(data.replace(' ', 'T')).getTime()
  if (Number.isNaN(quando)) return null
  return Math.max(0, Math.floor((agora - quando) / DIA_EM_MS))
}

function EstadoAtual() {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isPending, isError, error, refetch } = useQuery(repositoryIndexQuery)

  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )
  const percentual = useMemo(
    () =>
      new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.resolvedLanguage],
  )
  // Referência única e estável: todas as faixas de atualidade usam o mesmo
  // "agora", senão fontes iguais cairiam em faixas diferentes por milissegundos.
  // Inicializador de `useState` em vez de `Date.now()` no render — o relógio é
  // impuro, e aqui ele é lido uma vez só, na montagem.
  const [agora] = useState(() => Date.now())

  const rotuloStatus = (valor: string | null): string => {
    if (!valor) return t('harvestsPage.overview.none')
    const chave = `harvestStatus.${valor.toLowerCase()}`
    return i18n.exists(chave) ? t(chave) : valor
  }
  const rotuloBanda = (chave: string) => t(`harvestsPage.overview.bands.${chave}`)

  const snapshotStatus = searchParams.get('snapshotStatus') ?? ''
  const indexStatus = searchParams.get('indexStatus') ?? ''
  const atualidade = searchParams.get('atualidade') ?? ''
  const instituicao = searchParams.get('instituicao') ?? ''

  const trocarFiltro = (campo: string, valor: string) => {
    const params = new URLSearchParams(searchParams)
    if (valor) params.set(campo, valor)
    else params.delete(campo)
    params.delete('page')
    setSearchParams(params, { replace: true })
  }
  // Clicar na barra já ativa limpa o filtro; é o que faz a barra funcionar como
  // interruptor, como no experimento.
  const alternar = (campo: string, atual: string, valor: string) =>
    trocarFiltro(campo, atual === valor ? '' : valor)

  const fontes = useMemo(() => data?.results ?? [], [data])

  const recorte = useMemo(
    () =>
      fontes.filter(
        (f) =>
          (!snapshotStatus || f.lastSnapshotStatus === snapshotStatus) &&
          (!indexStatus || f.lastIndexStatus === indexStatus) &&
          (!atualidade || bandaDeAtualidade(f.lastSnapshotDate, agora) === atualidade) &&
          (!instituicao || f.institutionName === instituicao),
      ),
    [fontes, snapshotStatus, indexStatus, atualidade, instituicao, agora],
  )

  const instituicoes = useMemo(() => {
    const nomes = new Set<string>()
    for (const f of fontes) if (f.institutionName) nomes.add(f.institutionName)
    return [...nomes].sort((a, b) => a.localeCompare(b))
  }, [fontes])

  const statusDistintos = useMemo(() => distintos(fontes, (f) => f.lastSnapshotStatus), [fontes])
  const indicesDistintos = useMemo(() => distintos(fontes, (f) => f.lastIndexStatus), [fontes])

  if (isPending) return <Loading id="harvests-page-overview-loading" />
  if (isError)
    return (
      <ErrorState id="harvests-page-overview-error" error={error} onRetry={() => void refetch()} />
    )

  const comColeta = recorte.filter((f) => f.lastSnapshotDate).length
  const comErro = recorte.filter(
    (f) => f.lastSnapshotStatus && harvestTone(f.lastSnapshotStatus) === 'down',
  ).length
  const semColeta = recorte.length - comColeta

  // Totais de registros no recorte — complementam, somados, os números que a
  // tabela mostra por fonte. Inválidos e transformados só existem na coleta
  // avaliada (INDEXED): o backend já devolve `invalidSize` nulo fora disso, e
  // somar nulo como zero não inventa registro.
  const somar = (campo: (f: RepositoryHit) => number | null | undefined) =>
    recorte.reduce((soma, f) => soma + (campo(f) ?? 0), 0)
  const registrosTotal = somar((f) => f.lastSize)
  const validosTotal = somar((f) => f.lastValidSize)
  const invalidosTotal = somar((f) => f.invalidSize)
  const transformadosTotal = somar((f) => f.lastTransformedSize)
  const fracao = (parte: number) =>
    registrosTotal > 0 ? percentual.format(parte / registrosTotal) : undefined

  const distSnapshot = contar(recorte, (f) => f.lastSnapshotStatus).map(([chave, valor]) => ({
    chave,
    rotulo: rotuloStatus(chave),
    valor,
    tom: harvestTone(chave),
  }))
  const distIndice = contar(recorte, (f) => f.lastIndexStatus).map(([chave, valor]) => ({
    chave,
    rotulo: rotuloStatus(chave),
    valor,
    tom: TOM_INDICE[chave] ?? 'neutro',
  }))
  const distBanda = ORDEM_BANDA.map((chave) => ({
    chave,
    rotulo: rotuloBanda(chave),
    valor: recorte.filter((f) => bandaDeAtualidade(f.lastSnapshotDate, agora) === chave).length,
    tom: TOM_BANDA[chave],
  })).filter((item) => item.valor > 0)

  const selects: {
    campo: string
    rotulo: string
    valor: string
    opcoes: { label: string; value: string }[]
  }[] = [
    {
      campo: 'snapshotStatus',
      rotulo: t('harvestsPage.overview.filters.snapshotStatus'),
      valor: snapshotStatus,
      opcoes: statusDistintos.map((s) => ({ label: rotuloStatus(s), value: s })),
    },
    {
      campo: 'indexStatus',
      rotulo: t('harvestsPage.overview.filters.indexStatus'),
      valor: indexStatus,
      opcoes: indicesDistintos.map((s) => ({ label: rotuloStatus(s), value: s })),
    },
    {
      campo: 'atualidade',
      rotulo: t('harvestsPage.overview.filters.freshness'),
      valor: atualidade,
      opcoes: ORDEM_BANDA.map((chave) => ({ label: rotuloBanda(chave), value: chave })),
    },
    {
      campo: 'instituicao',
      rotulo: t('harvestsPage.overview.filters.institution'),
      valor: instituicao,
      opcoes: instituicoes.map((nome) => ({ label: nome, value: nome })),
    },
  ]

  return (
    <div id="harvests-page-overview" className="d-flex flex-column gap-4">
      <div
        id="harvests-page-overview-filters"
        className="d-flex flex-wrap align-items-end"
        style={{ gap: 'var(--spacing-scale-2x)' }}
      >
        {selects.map((s) => (
          <div
            id={`harvests-page-overview-filter-${s.campo}`}
            key={s.campo}
            className="d-flex flex-column"
          >
            {/*
              `aria-label` em vez de `label`: com um `id` nosso o `BrSelectStandard`
              deixa o `<label htmlFor>` apontando para o id que ele mesmo gerou e
              descartou. O texto ao lado é decorativo; o nome acessível é o do
              `aria-label`.
            */}
            <span
              id={`harvests-page-overview-filter-${s.campo}-label`}
              className="text-down-01 text-bold mb-1"
              aria-hidden="true"
            >
              {s.rotulo}
            </span>
            <BrSelectStandard
              id={`harvests-page-overview-filter-${s.campo}-select`}
              aria-label={s.rotulo}
              value={s.valor}
              onChange={(evento) => trocarFiltro(s.campo, evento.target.value)}
              options={[{ label: t('harvestsPage.overview.filters.all'), value: '' }, ...s.opcoes]}
            />
          </div>
        ))}
      </div>

      <section id="harvests-page-overview-stats" className="row">
        {[
          {
            chave: 'sources',
            rotulo: t('harvestsPage.overview.stats.sources'),
            valor: recorte.length,
            tom: undefined,
          },
          {
            chave: 'with-harvest',
            rotulo: t('harvestsPage.overview.stats.withHarvest'),
            valor: comColeta,
            tom: undefined,
          },
          {
            chave: 'errors',
            rotulo: t('harvestsPage.overview.stats.errors'),
            valor: comErro,
            tom: comErro > 0 ? ('down' as const) : ('ok' as const),
          },
          {
            chave: 'never',
            rotulo: t('harvestsPage.overview.stats.never'),
            valor: semColeta,
            tom: undefined,
          },
        ].map((c) => (
          <div
            id={`harvests-page-overview-stat-${c.chave}-col`}
            key={c.chave}
            className="col-sm-6 col-lg-3 mb-2"
          >
            <StatCard
              id={`harvests-page-overview-stat-${c.chave}`}
              label={c.rotulo}
              value={numero.format(c.valor)}
              tone={c.tom}
            />
          </div>
        ))}
      </section>

      <section id="harvests-page-overview-records">
        <h2 id="harvests-page-overview-records-title" className="text-up-01 text-bold mb-2">
          {t('harvestsPage.overview.records.title')}
        </h2>
        <div id="harvests-page-overview-records-row" className="row">
          {[
            {
              chave: 'records',
              rotulo: t('harvestsPage.overview.records.records'),
              valor: registrosTotal,
              dica: undefined as string | undefined,
              tom: undefined as 'down' | 'ok' | undefined,
            },
            {
              chave: 'valid',
              rotulo: t('harvestsPage.overview.records.valid'),
              valor: validosTotal,
              dica: fracao(validosTotal),
              tom: 'ok' as const,
            },
            {
              chave: 'invalid',
              rotulo: t('harvestsPage.overview.records.invalid'),
              valor: invalidosTotal,
              dica: fracao(invalidosTotal),
              tom: invalidosTotal > 0 ? ('down' as const) : undefined,
            },
            {
              chave: 'transformed',
              rotulo: t('harvestsPage.overview.records.transformed'),
              valor: transformadosTotal,
              dica: fracao(transformadosTotal),
              tom: undefined,
            },
          ].map((c) => (
            <div
              id={`harvests-page-overview-record-${c.chave}-col`}
              key={c.chave}
              className="col-sm-6 col-lg-3 mb-2"
            >
              <StatCard
                id={`harvests-page-overview-record-${c.chave}`}
                label={c.rotulo}
                value={numero.format(c.valor)}
                hint={c.dica}
                tone={c.tom}
              />
            </div>
          ))}
        </div>
      </section>

      {recorte.length === 0 ? (
        <Empty id="harvests-page-overview-empty" label={t('harvestsPage.overview.empty')} />
      ) : (
        <>
          <div
            id="harvests-page-overview-panels"
            style={{
              display: 'grid',
              gap: 'var(--spacing-scale-2x)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            }}
          >
            <Distribuicao
              id="harvests-page-overview-snapshot"
              titulo={t('harvestsPage.overview.panels.snapshotStatus')}
              itens={distSnapshot}
              ativo={snapshotStatus}
              numero={numero}
              hint={t('harvestsPage.overview.clickHint')}
              aoClicar={(chave) => alternar('snapshotStatus', snapshotStatus, chave)}
            />
            <Distribuicao
              id="harvests-page-overview-index"
              titulo={t('harvestsPage.overview.panels.indexStatus')}
              itens={distIndice}
              ativo={indexStatus}
              numero={numero}
              aoClicar={(chave) => alternar('indexStatus', indexStatus, chave)}
            />
            <Distribuicao
              id="harvests-page-overview-freshness"
              titulo={t('harvestsPage.overview.panels.freshness')}
              itens={distBanda}
              ativo={atualidade}
              numero={numero}
              aoClicar={(chave) => alternar('atualidade', atualidade, chave)}
            />
          </div>

          <TabelaColetasPorFonte id="harvests-page-overview-table" fontes={recorte} agora={agora} />
        </>
      )}
    </div>
  )
}

function distintos(fontes: RepositoryHit[], campo: (f: RepositoryHit) => string | null): string[] {
  const valores = new Set<string>()
  for (const f of fontes) {
    const v = campo(f)
    if (v) valores.add(v)
  }
  return [...valores].sort()
}

/** Contagem por valor não nulo, da maior para a menor — como o experimento. */
function contar(
  fontes: RepositoryHit[],
  campo: (f: RepositoryHit) => string | null,
): [string, number][] {
  const mapa = new Map<string, number>()
  for (const f of fontes) {
    const v = campo(f)
    if (!v) continue
    mapa.set(v, (mapa.get(v) ?? 0) + 1)
  }
  return [...mapa.entries()].sort((a, b) => b[1] - a[1])
}

const TOM_BARRA: Record<Tom, string> = {
  ok: 'bg-green-cool-vivid-50',
  warn: 'bg-yellow-vivid-20',
  down: 'bg-red-vivid-50',
  neutro: 'bg-gray-20',
}

type ItemBarra = { chave: string; rotulo: string; valor: number; tom: Tom }

/**
 * Painel de barras horizontais, como o `Barras` do experimento. A barra escala
 * pelo maior valor do painel; clicar filtra o recorte inteiro por aquele valor.
 */
function Distribuicao({
  id,
  titulo,
  itens,
  ativo,
  numero,
  aoClicar,
  hint,
}: {
  id: string
  titulo: string
  itens: ItemBarra[]
  ativo: string
  numero: Intl.NumberFormat
  aoClicar?: (chave: string) => void
  hint?: string
}) {
  const maximo = Math.max(1, ...itens.map((i) => i.valor))

  return (
    <figure id={id} className="br-card p-3 mb-0">
      <figcaption id={`${id}-title`} className="text-down-01 text-bold mb-2">
        {titulo}
      </figcaption>
      <ul id={`${id}-list`} className="plain-list d-flex flex-column gap-2">
        {itens.map((item) => {
          const selecionado = ativo === item.chave
          const conteudo = (
            <>
              <span id={`${id}-item-${item.chave}-label`} className="text-down-01 text-left">
                {item.rotulo}
              </span>
              <span
                id={`${id}-item-${item.chave}-track`}
                className="bg-gray-2"
                style={{
                  display: 'block',
                  height: '15px',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <span
                  id={`${id}-item-${item.chave}-fill`}
                  className={TOM_BARRA[item.tom]}
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${(item.valor / maximo) * 100}%`,
                  }}
                />
              </span>
              <span
                id={`${id}-item-${item.chave}-value`}
                className="text-down-01 text-right"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {numero.format(item.valor)}
              </span>
            </>
          )
          const grade = {
            display: 'grid',
            gridTemplateColumns: '130px 1fr 48px',
            alignItems: 'center',
            gap: 'var(--spacing-scale-base)',
            width: '100%',
          } as const
          return (
            <li id={`${id}-item-${item.chave}`} key={item.chave}>
              {aoClicar ? (
                <button
                  id={`${id}-item-${item.chave}-button`}
                  type="button"
                  className="br-button"
                  aria-pressed={selecionado}
                  onClick={() => aoClicar(item.chave)}
                  style={{
                    ...grade,
                    background: 'none',
                    border: 'none',
                    padding: 'var(--spacing-scale-half) 0',
                    height: 'auto',
                    fontWeight: selecionado ? 700 : undefined,
                  }}
                >
                  {conteudo}
                </button>
              ) : (
                <div id={`${id}-item-${item.chave}-row`} style={grade}>
                  {conteudo}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {hint ? (
        <p id={`${id}-hint`} className="text-down-01 text-gray-70 mt-2 mb-0">
          {hint}
        </p>
      ) : null}
    </figure>
  )
}

/**
 * Tabela "Coletas por Fontes": uma linha por fonte com a última coleta de cada,
 * sobre o recorte dos filtros do topo. Ordena, filtra por coluna e pagina no
 * navegador (TanStack Table), e exporta o recorte em CSV — os mesmos recursos da
 * tabela de registros, aqui sobre as linhas já em memória. Sem a coluna
 * Plataforma, que o Harvester não serve.
 */
const COLUNAS_NUMERICAS = ['dias', 'registros', 'validos', 'invalidos']

function TabelaColetasPorFonte({
  id,
  fontes,
  agora,
}: {
  id: string
  fontes: RepositoryHit[]
  agora: number
}) {
  const { t, i18n } = useTranslation()
  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )

  const rotuloStatus = useCallback(
    (valor: string | null): string => {
      if (!valor) return '—'
      const chave = `harvestStatus.${valor.toLowerCase()}`
      return i18n.exists(chave) ? t(chave) : valor
    },
    [t, i18n],
  )

  // Valores distintos para os selects de filtro por coluna, do conjunto inteiro.
  const statusDistintos = useMemo(
    () => [...new Set(fontes.map((f) => f.lastSnapshotStatus).filter(Boolean) as string[])].sort(),
    [fontes],
  )
  const indicesDistintos = useMemo(
    () => [...new Set(fontes.map((f) => f.lastIndexStatus).filter(Boolean) as string[])].sort(),
    [fontes],
  )

  const numerica = (valor: number) => (valor < 0 ? '—' : numero.format(valor))

  // Colunas sem `useMemo`: recriá-las a cada render é barato (só a página visível
  // é desenhada) e evita o alerta de memoização do compilador; o estado de
  // ordenação e de filtro vive por `id` de coluna, não pela identidade do objeto.
  const colunas = columnHelper.columns([
    columnHelper.accessor((f) => [f.acronym, f.name].filter(Boolean).join(' '), {
      id: 'fonte',
      header: t('harvestsPage.overview.table.columns.source'),
      filterFn: 'includesString',
      cell: (info) => {
        const f = info.row.original
        return (
          <>
            <Link
              to={`/repositorios/${f.harvesterRepositoryId}`}
              className="text-blue-warm-vivid-80"
            >
              {f.acronym ?? f.harvesterRepositoryId}
            </Link>
            {f.name ? (
              <span className="d-block text-down-02 text-gray-70" style={RECORTE_DUAS_LINHAS}>
                {f.name}
              </span>
            ) : null}
          </>
        )
      },
    }),
    columnHelper.accessor((f) => f.institutionName ?? '', {
      id: 'instituicao',
      header: t('harvestsPage.overview.table.columns.institution'),
      filterFn: 'includesString',
      cell: (info) => (
        <span className="text-gray-70" style={RECORTE_DUAS_LINHAS}>
          {info.row.original.institutionName ?? '—'}
        </span>
      ),
    }),
    columnHelper.accessor((f) => f.lastSnapshotStatus ?? '', {
      id: 'estado',
      header: t('harvestsPage.overview.table.columns.status'),
      filterFn: 'equalsString',
      cell: (info) =>
        info.row.original.lastSnapshotStatus ? (
          <HarvestStatusBadge
            id={`${id}-row-${info.row.original.harvesterRepositoryId}-status-badge`}
            status={info.row.original.lastSnapshotStatus}
          />
        ) : (
          '—'
        ),
    }),
    columnHelper.accessor((f) => f.lastIndexStatus ?? '', {
      id: 'indexacao',
      header: t('harvestsPage.overview.table.columns.index'),
      filterFn: 'equalsString',
      cell: (info) => rotuloStatus(info.row.original.lastIndexStatus),
    }),
    columnHelper.accessor((f) => f.lastSnapshotDate ?? '', {
      id: 'ultima',
      header: t('harvestsPage.overview.table.columns.lastHarvest'),
      enableColumnFilter: false,
      cell: (info) => info.getValue().slice(0, 10) || '—',
    }),
    columnHelper.accessor((f) => diasDesde(f.lastSnapshotDate, agora) ?? -1, {
      id: 'dias',
      header: t('harvestsPage.overview.table.columns.days'),
      enableColumnFilter: false,
      cell: (info) => numerica(info.getValue()),
    }),
    columnHelper.accessor((f) => f.lastSize ?? -1, {
      id: 'registros',
      header: t('harvestsPage.overview.table.columns.records'),
      enableColumnFilter: false,
      cell: (info) => numerica(info.getValue()),
    }),
    columnHelper.accessor((f) => f.lastValidSize ?? -1, {
      id: 'validos',
      header: t('harvestsPage.overview.table.columns.valid'),
      enableColumnFilter: false,
      cell: (info) => numerica(info.getValue()),
    }),
    columnHelper.accessor((f) => f.invalidSize ?? -1, {
      id: 'invalidos',
      header: t('harvestsPage.overview.table.columns.invalid'),
      enableColumnFilter: false,
      cell: (info) => numerica(info.getValue()),
    }),
  ])

  const table = useTable({
    features,
    columns: colunas,
    data: fontes,
    initialState: {
      pagination: { pageIndex: 0, pageSize: POR_PAGINA_COLETAS },
      // Abre pelas mais desatualizadas, como fazia a tabela anterior.
      sorting: [{ id: 'dias', desc: true }],
    },
  })

  const visiveis = table.getRowModel().rows
  const filtradas = table.getFilteredRowModel().rows.length

  const filtroDe = (coluna: string) => (table.getColumn(coluna)?.getFilterValue() as string) ?? ''
  const mudarFiltro = (coluna: string, valor: string) =>
    table.getColumn(coluna)?.setFilterValue(valor || undefined)

  const exportar = () => {
    const linhas = table.getSortedRowModel().rows.map((row) => {
      const f = row.original
      return [
        f.acronym ?? f.harvesterRepositoryId,
        f.name ?? '',
        f.institutionName ?? '',
        f.lastSnapshotStatus ?? '',
        f.lastIndexStatus ?? '',
        f.lastSnapshotDate ? f.lastSnapshotDate.slice(0, 10) : '',
        diasDesde(f.lastSnapshotDate, agora) ?? '',
        f.lastSize ?? '',
        f.lastValidSize ?? '',
        f.invalidSize ?? '',
      ]
    })
    baixarCsv(
      'coletas-por-fonte.csv',
      [
        t('harvestsPage.overview.table.columns.source'),
        t('harvestsPage.overview.table.csv.name'),
        t('harvestsPage.overview.table.columns.institution'),
        t('harvestsPage.overview.table.columns.status'),
        t('harvestsPage.overview.table.columns.index'),
        t('harvestsPage.overview.table.columns.lastHarvest'),
        t('harvestsPage.overview.table.columns.days'),
        t('harvestsPage.overview.table.columns.records'),
        t('harvestsPage.overview.table.columns.valid'),
        t('harvestsPage.overview.table.columns.invalid'),
      ],
      linhas,
    )
  }

  return (
    <figure id={id} className="mb-0 d-flex flex-column gap-3">
      <div
        id={`${id}-toolbar`}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--spacing-scale-2x)',
        }}
      >
        <figcaption id={`${id}-title`} className="text-up-01 text-bold mb-0">
          {t('harvestsPage.overview.table.title')}
        </figcaption>
        <button
          id={`${id}-export`}
          type="button"
          className="br-button secondary small"
          onClick={exportar}
          disabled={filtradas === 0}
        >
          <i className="fas fa-download" aria-hidden="true" />
          <span className="ml-1">{t('harvestsPage.overview.table.export')}</span>
        </button>
      </div>

      <p id={`${id}-count`} className="text-down-01 text-gray-70 mb-0">
        {t('harvestsPage.overview.table.showing', { shown: filtradas, count: fontes.length })}
      </p>

      <div id={`${id}-wrapper`} className="br-table" style={{ overflowX: 'auto' }}>
        <table id={`${id}-table`} style={{ tableLayout: 'fixed', minWidth: '60rem' }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead id={`${id}-head`}>
            {table.getHeaderGroups().map((grupo) => (
              <tr id={`${id}-header-group-${grupo.id}`} key={grupo.id} className="bg-gray-2">
                {grupo.headers.map((header) => {
                  const direcao = header.column.getIsSorted()
                  const numericaCol = COLUNAS_NUMERICAS.includes(header.column.id)
                  return (
                    <th
                      id={`${id}-header-${header.column.id}`}
                      key={header.id}
                      scope="col"
                      className={numericaCol ? 'text-right' : 'text-left'}
                      {...dicaDeColuna(t(`harvestsPage.overview.table.hints.${header.column.id}`))}
                    >
                      <button
                        id={`${id}-sort-${header.column.id}`}
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={`d-flex align-items-center gap-half ${numericaCol ? 'ml-auto' : ''}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        <table.FlexRender header={header} />
                        <span aria-hidden="true" className="text-gray-70">
                          {direcao === 'asc' ? '↑' : direcao === 'desc' ? '↓' : '↕'}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            ))}
            {/*
              Linha de filtros por coluna, como na tabela de registros: fonte e
              instituição por texto; estado e indexação por seleção dos valores
              presentes. `<td>`, não `<th>`, para o leitor de tela não anunciar o
              campo como cabeçalho de coluna.
            */}
            <tr id={`${id}-filter-row`} className="bg-gray-2">
              <td id={`${id}-filter-fonte`} className="px-2 pb-2">
                <input
                  id={`${id}-filter-fonte-input`}
                  type="search"
                  aria-label={t('harvestsPage.overview.table.filters.source')}
                  value={filtroDe('fonte')}
                  onChange={(evento) => mudarFiltro('fonte', evento.target.value)}
                  className="bg-pure-0 px-2 py-1 text-down-01"
                  style={{ width: '100%' }}
                />
              </td>
              <td id={`${id}-filter-instituicao`} className="px-2 pb-2">
                <input
                  id={`${id}-filter-instituicao-input`}
                  type="search"
                  aria-label={t('harvestsPage.overview.table.filters.institution')}
                  value={filtroDe('instituicao')}
                  onChange={(evento) => mudarFiltro('instituicao', evento.target.value)}
                  className="bg-pure-0 px-2 py-1 text-down-01"
                  style={{ width: '100%' }}
                />
              </td>
              <td id={`${id}-filter-estado`} className="px-2 pb-2">
                <ColumnFilterSelect
                  id={`${id}-filter-estado-select`}
                  rotulo={t('harvestsPage.overview.table.filters.status')}
                  valor={filtroDe('estado')}
                  onMudar={(valor) => mudarFiltro('estado', valor)}
                  opcoes={[
                    { label: t('harvestsPage.overview.filters.all'), value: '' },
                    ...statusDistintos.map((s) => ({ label: rotuloStatus(s), value: s })),
                  ]}
                />
              </td>
              <td id={`${id}-filter-indexacao`} className="px-2 pb-2">
                <ColumnFilterSelect
                  id={`${id}-filter-indexacao-select`}
                  rotulo={t('harvestsPage.overview.table.filters.index')}
                  valor={filtroDe('indexacao')}
                  onMudar={(valor) => mudarFiltro('indexacao', valor)}
                  opcoes={[
                    { label: t('harvestsPage.overview.filters.all'), value: '' },
                    ...indicesDistintos.map((s) => ({ label: rotuloStatus(s), value: s })),
                  ]}
                />
              </td>
              <td id={`${id}-filter-ultima`} />
              <td id={`${id}-filter-dias`} />
              <td id={`${id}-filter-registros`} />
              <td id={`${id}-filter-validos`} />
              <td id={`${id}-filter-invalidos`} />
            </tr>
          </thead>
          <tbody id={`${id}-body`}>
            {visiveis.map((row) => (
              <tr id={`${id}-row-${row.original.harvesterRepositoryId}`} key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const numericaCol = COLUNAS_NUMERICAS.includes(cell.column.id)
                  return (
                    <td
                      id={`${id}-row-${row.original.harvesterRepositoryId}-${cell.column.id}`}
                      key={cell.id}
                      className={`px-3 py-2 ${numericaCol ? 'text-right' : ''}`}
                      style={{
                        verticalAlign: 'top',
                        ...(numericaCol ? { fontVariantNumeric: 'tabular-nums' } : {}),
                      }}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtradas === 0 ? (
        <Empty id={`${id}-empty`} label={t('harvestsPage.overview.table.empty')} />
      ) : null}

      <Pagination
        id={`${id}-pagination`}
        page={table.state.pagination.pageIndex + 1}
        totalPages={table.getPageCount()}
        onChange={(destino) => table.setPageIndex(destino - 1)}
        tamanho={table.state.pagination.pageSize}
        tamanhos={TAMANHOS_COLETAS}
        onTamanho={(novo) => {
          table.setPageSize(novo)
          table.setPageIndex(0)
        }}
      />
    </figure>
  )
}
// --- Histórico --------------------------------------------------------------

/**
 * Aba "Histórico": todas as coletas do acervo ao longo do tempo, do agregado
 * global (`harvestHistoryQuery`). Não responde aos filtros — a série do sistema
 * inteiro é o objeto aqui, como em `secoes/Historico.tsx`.
 */
function Historico() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(harvestHistoryQuery)

  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )
  const percentual = useMemo(
    () =>
      new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.resolvedLanguage],
  )
  const dataHora = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'short' }),
    [i18n.resolvedLanguage],
  )

  // O botão "Atualizar histórico" dispara a varredura no servidor; ao voltar,
  // revalida a query para pegar `refreshing:true` e começar a repetir até a
  // série nova chegar.
  const atualizar = useMutation({
    mutationFn: refreshHarvestHistory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: harvestHistoryQuery.queryKey }),
  })

  if (isPending) return <Loading id="harvests-page-history-loading" />
  if (isError)
    return (
      <ErrorState id="harvests-page-history-error" error={error} onRetry={() => void refetch()} />
    )

  const atualizando = Boolean(data.refreshing) || atualizar.isPending
  const dataCache = data.generatedAt
    ? t('harvestsPage.history.updatedAt', { date: dataHora.format(new Date(data.generatedAt)) })
    : null

  const botaoAtualizar = (
    <button
      id="harvests-page-history-refresh"
      type="button"
      className="br-button secondary small"
      onClick={() => atualizar.mutate()}
      disabled={atualizando}
    >
      <i className={`fas fa-sync-alt ${atualizando ? 'fa-spin' : ''}`} aria-hidden="true" />
      <span className="ml-1">
        {atualizando ? t('harvestsPage.history.refreshing') : t('harvestsPage.history.refresh')}
      </span>
    </button>
  )

  if (!data.warmed || !data.totals) {
    return (
      <div id="harvests-page-history-cold" className="br-card">
        <div
          id="harvests-page-history-cold-body"
          className="card-content text-center py-5 d-flex flex-column align-items-center gap-3"
        >
          <div>
            <p id="harvests-page-history-cold-title" className="text-bold mb-1">
              {atualizando
                ? t('harvestsPage.history.building.title')
                : t('harvestsPage.history.cold.title')}
            </p>
            <p id="harvests-page-history-cold-text" className="text-gray-70 mb-0">
              {atualizando
                ? t('harvestsPage.history.building.body')
                : t('harvestsPage.history.cold.body')}
            </p>
          </div>
          {botaoAtualizar}
        </div>
      </div>
    )
  }

  const totais = data.totals
  const maiorPico = Math.max(1, ...data.peaks.map((p) => p.harvests))

  return (
    <div id="harvests-page-history" className="d-flex flex-column gap-4">
      <div
        id="harvests-page-history-toolbar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--spacing-scale-2x)',
        }}
      >
        <p id="harvests-page-history-updated" className="text-down-01 text-gray-70 mb-0">
          {dataCache}
        </p>
        {botaoAtualizar}
      </div>

      {data.unavailableSources > 0 ? (
        <div id="harvests-page-history-unavailable" className="br-message warning" role="status">
          <div id="harvests-page-history-unavailable-icon" className="icon">
            <i className="fas fa-exclamation-triangle fa-lg" aria-hidden="true" />
          </div>
          <div id="harvests-page-history-unavailable-content" className="content">
            <span id="harvests-page-history-unavailable-body" className="message-body">
              {t('harvestsPage.history.unavailable', { count: data.unavailableSources })}
            </span>
          </div>
        </div>
      ) : null}

      <section id="harvests-page-history-stats" className="row">
        <div id="harvests-page-history-stat-harvests-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-harvests"
            label={t('harvestsPage.history.stats.harvests')}
            value={numero.format(totais.snapshots)}
            hint={t('harvestsPage.history.stats.sourcesHint', { count: totais.sources })}
          />
        </div>
        <div id="harvests-page-history-stat-failures-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-failures"
            label={t('harvestsPage.history.stats.failures')}
            value={numero.format(totais.failures)}
            hint={
              totais.snapshots === 0
                ? undefined
                : percentual.format(totais.failures / totais.snapshots)
            }
            tone={totais.failures > 0 ? 'down' : 'ok'}
          />
        </div>
        <div id="harvests-page-history-stat-first-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-first"
            label={t('harvestsPage.history.stats.first')}
            value={totais.first ?? '—'}
          />
        </div>
        <div id="harvests-page-history-stat-duration-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="harvests-page-history-stat-duration"
            label={t('harvestsPage.history.stats.medianDuration')}
            value={
              totais.medianDurationSeconds === null
                ? '—'
                : segundosEmTexto(t, totais.medianDurationSeconds)
            }
            hint={
              totais.last
                ? t('harvestsPage.history.stats.lastHint', { date: totais.last })
                : undefined
            }
          />
        </div>
      </section>

      {data.months.length > 1 ? (
        <GraficoMeses meses={data.months} percentual={percentual} dataCache={dataCache} />
      ) : null}

      <section id="harvests-page-history-peaks">
        <h2 id="harvests-page-history-peaks-title" className="text-up-01 text-bold mb-2">
          {t('harvestsPage.history.peaks.title')}
        </h2>
        <ul id="harvests-page-history-peaks-list" className="plain-list d-flex flex-column gap-1">
          {data.peaks.map((pico) => (
            <li
              id={`harvests-page-history-peak-${pico.day}`}
              key={pico.day}
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 1fr 56px',
                alignItems: 'center',
                gap: 'var(--spacing-scale-base)',
              }}
            >
              <span className="text-down-01 text-gray-70">{pico.day}</span>
              <span
                className="bg-gray-2"
                style={{
                  display: 'block',
                  height: '15px',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <span
                  className="bg-blue-warm-vivid-70"
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${(pico.harvests / maiorPico) * 100}%`,
                  }}
                />
              </span>
              <span
                className="text-down-01 text-right"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {numero.format(pico.harvests)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/**
 * Coletas por mês (barras) com a taxa de falha como linha no eixo direito — o
 * mesmo gráfico do experimento (`secoes/Historico.tsx`), agora com o componente
 * `Grafico` (ECharts) trazido de lá, e não mais com o recharts.
 *
 * `opcao` fica em `useCallback` porque o `Grafico` redesenha quando ela muda: uma
 * função nova a cada render reinicializaria o canvas à toa.
 */
function GraficoMeses({
  meses,
  percentual,
  dataCache,
}: {
  meses: HarvestHistoryMonth[]
  percentual: Intl.NumberFormat
  dataCache: string | null
}) {
  const { t } = useTranslation()

  const opcao = useCallback(
    (p: Paleta) => ({
      grid: { left: 54, right: 54, top: 34, bottom: 28 },
      legend: {
        show: true,
        top: 0,
        right: 0,
        textStyle: { color: p.conteudoFraco, fontSize: 10.5 },
        itemHeight: 8,
      },
      xAxis: {
        type: 'category',
        data: meses.map((m) => m.month),
        axisLine: { lineStyle: { color: p.borda } },
        axisTick: { show: false },
        axisLabel: {
          color: p.conteudoFraco,
          interval: Math.max(1, Math.floor(meses.length / 10)),
        },
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
          axisLabel: { color: p.conteudoFraco, formatter: (v: number) => percentual.format(v) },
        },
      ],
      tooltip: {
        trigger: 'axis',
        backgroundColor: p.superficie,
        borderColor: p.borda,
        textStyle: { color: p.conteudo, fontSize: 12 },
      },
      series: [
        {
          name: t('harvestsPage.history.chart.harvests'),
          type: 'bar',
          data: meses.map((m) => m.harvests),
          itemStyle: { color: p.marca },
        },
        {
          name: t('harvestsPage.history.chart.rate'),
          type: 'line',
          yAxisIndex: 1,
          data: meses.map((m) => m.rate),
          smooth: false,
          symbol: 'none',
          lineStyle: { color: p.down, width: 1.5 },
        },
      ],
    }),
    [meses, percentual, t],
  )

  return (
    <figure id="harvests-page-history-chart" className="br-card p-3 mb-0">
      <figcaption id="harvests-page-history-chart-caption" className="text-down-01 mb-2">
        <span className="text-bold">{t('harvestsPage.history.chart.title')}</span>
        {dataCache ? (
          <span id="harvests-page-history-chart-updated" className="text-gray-70">
            {' · '}
            {dataCache}
          </span>
        ) : null}
      </figcaption>
      <Grafico
        id="harvests-page-history-chart-area"
        opcao={opcao}
        altura={288}
        rotulo={t('harvestsPage.history.chart.title')}
      />
    </figure>
  )
}

/**
 * Duração legível a partir de segundos: "1 h 5 min", "3 min 12 s", "40 s".
 * Os segundos só somem quando há hora — mesma regra da moldura da coleta.
 */
function segundosEmTexto(t: (chave: string) => string, total: number): string {
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = Math.round(total % 60)
  return [
    horas ? `${horas} ${t('harvest.units.hours')}` : '',
    minutos ? `${minutos} ${t('harvest.units.minutes')}` : '',
    !horas ? `${segundos} ${t('harvest.units.seconds')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
