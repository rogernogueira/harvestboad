import { useQuery } from '@tanstack/react-query'
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { HarvestStatusBadge } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { RepositoryManagersModal } from '@/components/RepositoryManagersModal'
import { UserPlusIcon } from '@/components/UserPlusIcon'
import { UsersIcon } from '@/components/UsersIcon'
import { dicaDeColuna } from '@/lib/columnHints'
import { TUDO } from '@/lib/pagination'
import { repositoryIndexQuery } from '@/lib/queries'
import type { RepositoryHit } from '@/lib/types'

/**
 * Painel de administração: todos os repositórios do Harvester.
 *
 * Ordenação, filtro e paginação acontecem **no navegador**, sobre o acervo
 * inteiro (~2.181 linhas, ~960 KB) buscado uma vez. É o oposto da tabela de
 * registros, onde 26 mil linhas obrigam o servidor a fazer esse trabalho — e é
 * essa diferença de escala que justifica os dois tratamentos.
 */
const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filterFns,
  sortFns,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})

const columnHelper = createColumnHelper<typeof features, RepositoryHit>()

/**
 * Linhas por página, e o conjunto oferecido no seletor.
 *
 * "Tudo" são as ~2.181 linhas do acervo, que já estão em memória: aqui o
 * seletor não custa requisição, só altura de página. É o que faltava para
 * achar um repositório distante sem doze cliques em "Próxima".
 */
const POR_PAGINA = 25
const TAMANHOS = [25, 100, 1000, TUDO] as const

/*
 * Dica de cada coluna, pelo `id` que o TanStack dá a ela.
 *
 * O mapa existe porque o `id` vem do campo do `RepositoryHit`
 * (`institutionName`, `lastSnapshotDate`) e a chave de tradução vem do rótulo
 * que o gestor lê ("Instituição", "Última coleta"): são vocabulários
 * diferentes, e casá-los por convenção de nome só esconderia a diferença.
 */
const DICAS: Record<string, string> = {
  acronym: 'adminRepositories.columnHints.acronym',
  name: 'adminRepositories.columnHints.repository',
  institutionName: 'adminRepositories.columnHints.institution',
  lastSnapshotDate: 'adminRepositories.columnHints.harvest',
  invalidRatio: 'adminRepositories.columnHints.invalid',
  managerCount: 'adminRepositories.columnHints.managers',
}

/** Situação da coleta agrupada em três baldes, que é como se filtra na prática. */
type FiltroSituacao = 'todos' | 'valid' | 'error' | 'sem-coleta'
type FiltroGestor = 'todos' | 'com' | 'sem'

/*
 * Recorte em duas linhas para nome e instituição.
 *
 * O design system não tem equivalente ao `line-clamp` — sem isso um nome longo
 * estica a linha e desalinha a tabela inteira, que é de largura fixa.
 */
const RECORTE_DUAS_LINHAS = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
}

export function AdminRepositoriesPage() {
  const { t, i18n } = useTranslation()

  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState<FiltroSituacao>('todos')
  const [gestor, setGestor] = useState<FiltroGestor>('todos')
  const [gestoresDe, setGestoresDe] = useState<RepositoryHit | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery(repositoryIndexQuery)

  const percentual = useMemo(
    () =>
      new Intl.NumberFormat(i18n.resolvedLanguage, {
        style: 'percent',
        maximumFractionDigits: 1,
      }),
    [i18n.resolvedLanguage],
  )

  // Os dois filtros de balde são aplicados antes da tabela: são recortes do
  // conjunto, não de uma coluna, e o resultado alimenta o resto do pipeline.
  const linhas = useMemo(() => {
    const todas = data?.results ?? []
    return todas.filter((repo) => {
      const status = (repo.lastSnapshotStatus ?? '').toUpperCase()
      const temColeta = Boolean(repo.lastSnapshotId)

      if (situacao === 'valid' && !(temColeta && status.includes('VALID'))) return false
      if (situacao === 'error' && !(temColeta && status.includes('ERROR'))) return false
      if (situacao === 'sem-coleta' && temColeta) return false

      if (gestor === 'com' && repo.managerCount === 0) return false
      if (gestor === 'sem' && repo.managerCount > 0) return false

      return true
    })
  }, [data, situacao, gestor])

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('acronym', {
          header: t('adminRepositories.columns.acronym'),
          cell: (info) => (
            <span
              id={`admin-repositories-cell-acronym-${info.row.original.harvesterRepositoryId}`}
              className="text-down-01 text-blue-warm-vivid-80"
            >
              {info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor('name', {
          header: t('adminRepositories.columns.repository'),
          cell: (info) => (
            <Link
              id={`admin-repositories-cell-name-${info.row.original.harvesterRepositoryId}`}
              to={`/repositorios/${info.row.original.harvesterRepositoryId}`}
              // Nomes chegam a 112 caracteres: o title mostra o que a linha corta.
              title={info.getValue() ?? t('adminRepositories.openRepository')}
              className="text-semi-bold"
              style={RECORTE_DUAS_LINHAS}
            >
              {info.getValue() ?? t('repositories.unnamed')}
            </Link>
          ),
        }),
        columnHelper.accessor('institutionName', {
          header: t('adminRepositories.columns.institution'),
          cell: (info) => (
            <span
              id={`admin-repositories-cell-institution-${info.row.original.harvesterRepositoryId}`}
              className="text-gray-70"
              style={RECORTE_DUAS_LINHAS}
              title={info.getValue() ?? ''}
            >
              {info.getValue() ?? '—'}
            </span>
          ),
        }),
        columnHelper.accessor('lastSnapshotDate', {
          header: t('adminRepositories.columns.harvest'),
          cell: (info) => <HarvestCell repo={info.row.original} />,
        }),
        columnHelper.accessor((repo) => repo.invalidRatio ?? -1, {
          id: 'invalidRatio',
          header: t('adminRepositories.columns.invalid'),
          cell: (info) => <InvalidCell repo={info.row.original} percentual={percentual} />,
        }),
        columnHelper.accessor('managerCount', {
          header: t('adminRepositories.columns.managers'),
          cell: (info) => (
            <ManagersCell repo={info.row.original} onVer={() => setGestoresDe(info.row.original)} />
          ),
        }),
      ]),
    [t, percentual],
  )

  const table = useTable({
    features,
    columns,
    data: linhas,
    state: { globalFilter: busca },
    onGlobalFilterChange: setBusca,
    globalFilterFn: 'includesString',
    initialState: {
      pagination: { pageIndex: 0, pageSize: POR_PAGINA },
      // Abre pelo mais problemático: é a informação que motiva a tela.
      sorting: [{ id: 'invalidRatio', desc: true }],
    },
  })

  if (isPending)
    return <Loading id="admin-repositories-loading" label={t('adminRepositories.loading')} />
  if (isError)
    return <ErrorState id="admin-repositories-error" error={error} onRetry={() => void refetch()} />

  const visiveis = table.getRowModel().rows
  const filtradas = table.getFilteredRowModel().rows.length

  return (
    <div id="admin-repositories-page" className="d-flex flex-column gap-4">
      <PageHeader
        id="admin-repositories-header"
        eyebrow={t('adminRepositories.eyebrow')}
        title={t('adminRepositories.title')}
        description={t('adminRepositories.subtitle', { count: data.count })}
      />

      <div id="admin-repositories-filters" className="d-flex flex-wrap align-items-end gap-3">
        <label
          id="admin-repositories-filter-search"
          className="d-flex flex-grow-1 flex-column gap-half"
          style={{ minWidth: '16rem' }}
        >
          <span id="admin-repositories-filter-search-label" className="eyebrow">
            {t('adminRepositories.filterSearch')}
          </span>
          <input
            id="admin-repositories-filter-search-input"
            type="search"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder={t('access.searchRepository')}
            className="bg-pure-0 px-2 py-2 text-base"
          />
        </label>

        <label id="admin-repositories-filter-status" className="d-flex flex-column gap-half">
          <span id="admin-repositories-filter-status-label" className="eyebrow">
            {t('adminRepositories.filterStatus')}
          </span>
          <select
            id="admin-repositories-filter-status-select"
            value={situacao}
            onChange={(event) => setSituacao(event.target.value as FiltroSituacao)}
            className="bg-pure-0 px-2 py-2 text-base"
          >
            <option value="todos">{t('adminRepositories.status.all')}</option>
            <option value="valid">{t('adminRepositories.status.valid')}</option>
            <option value="error">{t('adminRepositories.status.error')}</option>
            <option value="sem-coleta">{t('adminRepositories.status.none')}</option>
          </select>
        </label>

        <label id="admin-repositories-filter-managers" className="d-flex flex-column gap-half">
          <span id="admin-repositories-filter-managers-label" className="eyebrow">
            {t('adminRepositories.filterManagers')}
          </span>
          <select
            id="admin-repositories-filter-managers-select"
            value={gestor}
            onChange={(event) => setGestor(event.target.value as FiltroGestor)}
            className="bg-pure-0 px-2 py-2 text-base"
          >
            <option value="todos">{t('adminRepositories.managers.all')}</option>
            <option value="com">{t('adminRepositories.managers.with')}</option>
            <option value="sem">{t('adminRepositories.managers.without')}</option>
          </select>
        </label>
      </div>

      <p id="admin-repositories-count" className="text-base text-gray-70">
        {t('adminRepositories.showing', { shown: filtradas, count: data.count })}
      </p>

      {visiveis.length === 0 ? (
        <Empty id="admin-repositories-empty" label={t('access.noRepositories')} />
      ) : (
        <>
          <div
            id="admin-repositories-table-wrapper"
            className="br-table"
            style={{ overflowX: 'auto' }}
          >
            {/*
              A largura mínima é 672px, não a soma "ideal" das seis colunas. Com
              valores maiores (tentei 1024 e 896) a barra horizontal aparecia em
              qualquer janela abaixo de ~1184px, porque a área de conteúdo é a
              janela menos 288px de menu, gap e margens.

              Com 672px e `table-fixed`, as colunas encolhem proporcionalmente em
              vez de forçar rolagem: em qualquer janela a partir de ~960px a tabela
              cabe inteira. Abaixo disso a rolagem assume, que é o certo num
              celular — seis colunas não cabem ali de jeito nenhum.
            */}
            <table
              id="admin-repositories-table"
              style={{ tableLayout: 'fixed', minWidth: '42rem' }}
            >
              {/*
                Percentuais somando 100%: com table-fixed, misturar rem e % faz a
                soma passar da largura disponível e a barra horizontal volta.
              */}
              {/*
                Percentuais somando 100%, calibrados pelo conteúdo mais largo de
                cada coluna na largura mínima da tabela (672px): as duas últimas
                estavam estreitas demais para "26.103 registros" e para o ícone
                com o rótulo "sem gestor", e o excesso virava barra de rolagem.
              */}
              <colgroup id="admin-repositories-colgroup">
                <col className="w-[10%]" />
                <col className="w-[24%]" />
                <col className="w-[21%]" />
                <col className="w-[19%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead id="admin-repositories-table-head">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    id={`admin-repositories-header-group-${headerGroup.id}`}
                    key={headerGroup.id}
                    className="bg-gray-2"
                  >
                    {headerGroup.headers.map((header) => {
                      const direcao = header.column.getIsSorted()
                      const alinhaDireita = header.column.id === 'invalidRatio'
                      const dica = DICAS[header.column.id]
                      return (
                        <th
                          id={`admin-repositories-header-${header.column.id}`}
                          key={header.id}
                          scope="col"
                          className={alinhaDireita ? 'text-right' : 'text-left'}
                          {...(dica ? dicaDeColuna(t(dica)) : {})}
                        >
                          <button
                            id={`admin-repositories-sort-${header.column.id}`}
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={`d-flex align-items-center gap-half ${
                              alinhaDireita ? 'ml-auto' : ''
                            }`}
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
              </thead>
              <tbody id="admin-repositories-table-body">
                {visiveis.map((row) => (
                  <tr
                    id={`admin-repositories-row-${row.original.harvesterRepositoryId}`}
                    key={row.id}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        id={`admin-repositories-row-${row.original.harvesterRepositoryId}-${cell.column.id}`}
                        key={cell.id}
                        className={
                          cell.column.id === 'invalidRatio'
                            ? 'text-right'
                            : cell.column.id === 'managerCount'
                              ? 'text-center'
                              : undefined
                        }
                        style={{ verticalAlign: 'top' }}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            O mesmo `Pagination` das outras três listas, no lugar do par
            "Anterior/Próxima" que existia aqui: quem faz a conta continua
            sendo o TanStack, sobre as linhas já em memória — o que se
            compartilha é o controle, não a estratégia. Uniformizar as duas
            estratégias é que seria errado; a de registros pagina no servidor
            por causa das dezenas de milhares de linhas.
          */}
          <Pagination
            id="admin-repositories-pagination"
            page={table.state.pagination.pageIndex + 1}
            totalPages={table.getPageCount()}
            onChange={(destino) => table.setPageIndex(destino - 1)}
            tamanho={table.state.pagination.pageSize}
            tamanhos={TAMANHOS}
            onTamanho={(novo) => {
              table.setPageSize(novo)
              // A página 30 de 25 não existe com 1.000 por página.
              table.setPageIndex(0)
            }}
          />
        </>
      )}

      {gestoresDe ? (
        <RepositoryManagersModal
          id="admin-repositories-managers-modal"
          aberto
          onFechar={() => setGestoresDe(null)}
          repositoryId={gestoresDe.harvesterRepositoryId}
          repositorio={`${gestoresDe.acronym} · ${gestoresDe.name ?? ''}`}
        />
      ) : null}
    </div>
  )
}

/** Dados da última coleta: situação, número, data e totais. */
function HarvestCell({ repo }: { repo: RepositoryHit }) {
  const { t } = useTranslation()
  const id = `admin-repositories-harvest-${repo.harvesterRepositoryId}`

  if (!repo.lastSnapshotId) {
    return (
      <span id={`${id}-none`} className="text-gray-70">
        {t('harvests.none')}
      </span>
    )
  }

  return (
    <span id={id} className="d-flex flex-column gap-half">
      <span id={`${id}-top`} className="d-flex flex-wrap align-items-center gap-2">
        {repo.lastSnapshotStatus ? (
          <HarvestStatusBadge id={`${id}-status`} status={repo.lastSnapshotStatus} />
        ) : null}
        <Link
          id={`${id}-snapshot-link`}
          to={`/coletas/${repo.lastSnapshotId}`}
          className="text-down-01 text-blue-warm-vivid-80"
        >
          #{repo.lastSnapshotId}
        </Link>
      </span>
      <span id={`${id}-details`} className="text-down-01 text-gray-70">
        {/* A origem manda "2024-06-25 12:10:33"; só a data basta na tabela. */}
        {repo.lastSnapshotDate?.slice(0, 10) ?? '—'}
        {repo.lastSize !== null ? (
          <>
            {' · '}
            {/*
              Só há registros listáveis quando a coleta foi indexada: com
              `UNKNOWN` ou `FAILED` o índice de diagnóstico vem vazio, e o link
              levaria a uma lista de zero itens.
            */}
            {repo.lastIndexStatus === 'INDEXED' ? (
              <Link
                id={`${id}-records-link`}
                to={`/coletas/${repo.lastSnapshotId}/registros`}
                title={t('adminRepositories.openRecords')}
                className="text-blue-warm-vivid-80"
              >
                {t('adminRepositories.records', { count: repo.lastSize })}
              </Link>
            ) : (
              t('adminRepositories.records', { count: repo.lastSize })
            )}
          </>
        ) : null}
      </span>
    </span>
  )
}

/**
 * Percentual de registros inválidos da última coleta.
 *
 * Sem coleta não há proporção — e "não sei" é diferente de 0%, por isso o traço
 * em vez de zero.
 */
function InvalidCell({ repo, percentual }: { repo: RepositoryHit; percentual: Intl.NumberFormat }) {
  const { t } = useTranslation()
  const id = `admin-repositories-invalid-${repo.harvesterRepositoryId}`

  if (repo.invalidRatio === null || repo.invalidRatio === undefined) {
    // "Não avaliado" e "0% inválidos" são conclusões diferentes: a coleta que
    // falhou tem registros, mas nenhum passou por validação.
    const naoAvaliado = repo.lastSnapshotId && repo.lastIndexStatus !== 'INDEXED'
    return (
      <span
        id={`${id}-unknown`}
        className="text-down-01 text-gray-70"
        title={repo.lastIndexStatus ?? ''}
      >
        {naoAvaliado ? t('adminRepositories.notEvaluated') : '—'}
      </span>
    )
  }

  const tom =
    repo.invalidRatio >= 0.5 ? 'text-down' : repo.invalidRatio > 0 ? 'text-warn' : 'text-ok'

  // Zero inválidos não tem o que listar: vira texto, não link.
  if (!repo.invalidSize || !repo.lastSnapshotId) {
    return (
      <span id={id} className="d-flex flex-column align-items-end">
        <span
          id={`${id}-ratio`}
          className={`text-bold ${tom}`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {percentual.format(repo.invalidRatio)}
        </span>
      </span>
    )
  }

  return (
    <Link
      id={id}
      to={`/coletas/${repo.lastSnapshotId}/registros?valid=false`}
      title={t('adminRepositories.openInvalidRecords')}
      className="d-flex flex-column align-items-end"
    >
      <span
        id={`${id}-ratio`}
        className={`text-bold ${tom}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {percentual.format(repo.invalidRatio)}
      </span>
      <span id={`${id}-count`} className="text-down-01 text-gray-70">
        {t('adminRepositories.invalidRecords', { count: repo.invalidSize })}
      </span>
    </Link>
  )
}

/**
 * Coluna de gestores.
 *
 * Com gestores, abre o modal. Sem nenhum, o ícone muda e leva à tela de acessos
 * com o repositório já selecionado — que é a ação que falta fazer ali.
 */
function ManagersCell({ repo, onVer }: { repo: RepositoryHit; onVer: () => void }) {
  const { t } = useTranslation()
  const id = `admin-repositories-managers-${repo.harvesterRepositoryId}`

  if (repo.managerCount > 0) {
    return (
      <button
        id={id}
        type="button"
        onClick={onVer}
        title={t('adminRepositories.seeManagers', { count: repo.managerCount })}
        aria-label={t('adminRepositories.seeManagers', { count: repo.managerCount })}
        className="d-inline-flex flex-wrap align-items-center justify-content-center gap-half px-1 py-1 text-gray-70"
      >
        <UsersIcon id={`${id}-icon`} />
        <span id={`${id}-count`} className="text-down-01">
          {repo.managerCount}
        </span>
      </button>
    )
  }

  return (
    <Link
      id={id}
      to={`/acessos?busca=${encodeURIComponent(repo.acronym ?? '')}&selecionar=${repo.harvesterRepositoryId}`}
      title={t('adminRepositories.assignManager')}
      aria-label={t('adminRepositories.assignManager')}
      className="d-inline-flex flex-wrap align-items-center justify-content-center gap-half px-1 py-1 text-gold-vivid-60"
    >
      <UserPlusIcon id={`${id}-icon`} />
      <span id={`${id}-label`} className="text-down-01">
        {t('adminRepositories.none')}
      </span>
    </Link>
  )
}
