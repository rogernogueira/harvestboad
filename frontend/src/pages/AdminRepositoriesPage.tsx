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
import { RepositoryManagersModal } from '@/components/RepositoryManagersModal'
import { UserPlusIcon } from '@/components/UserPlusIcon'
import { UsersIcon } from '@/components/UsersIcon'
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

const POR_PAGINA = 25

/** Situação da coleta agrupada em três baldes, que é como se filtra na prática. */
type FiltroSituacao = 'todos' | 'valid' | 'error' | 'sem-coleta'
type FiltroGestor = 'todos' | 'com' | 'sem'

export function AdminRepositoriesPage() {
  const { t, i18n } = useTranslation()

  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState<FiltroSituacao>('todos')
  const [gestor, setGestor] = useState<FiltroGestor>('todos')
  const [gestoresDe, setGestoresDe] = useState<RepositoryHit | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery(repositoryIndexQuery)

  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )
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
            <span className="font-mono text-xs break-all text-brand-strong">{info.getValue()}</span>
          ),
        }),
        columnHelper.accessor('name', {
          header: t('adminRepositories.columns.repository'),
          cell: (info) => (
            <Link
              to={`/repositorios/${info.row.original.harvesterRepositoryId}`}
              // Nomes chegam a 112 caracteres: o title mostra o que a linha corta.
              title={info.getValue() ?? t('adminRepositories.openRepository')}
              className="line-clamp-2 font-semibold transition-colors duration-150 hover:text-brand-strong hover:underline"
            >
              {info.getValue() ?? t('repositories.unnamed')}
            </Link>
          ),
        }),
        columnHelper.accessor('institutionName', {
          header: t('adminRepositories.columns.institution'),
          cell: (info) => (
            <span className="line-clamp-2 text-content-muted" title={info.getValue() ?? ''}>
              {info.getValue() ?? '—'}
            </span>
          ),
        }),
        columnHelper.accessor('lastSnapshotDate', {
          header: t('adminRepositories.columns.harvest'),
          cell: (info) => <HarvestCell repo={info.row.original} numero={numero} />,
        }),
        columnHelper.accessor((repo) => repo.invalidRatio ?? -1, {
          id: 'invalidRatio',
          header: t('adminRepositories.columns.invalid'),
          cell: (info) => (
            <InvalidCell repo={info.row.original} numero={numero} percentual={percentual} />
          ),
        }),
        columnHelper.accessor('managerCount', {
          header: t('adminRepositories.columns.managers'),
          cell: (info) => (
            <ManagersCell repo={info.row.original} onVer={() => setGestoresDe(info.row.original)} />
          ),
        }),
      ]),
    [t, numero, percentual],
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

  if (isPending) return <Loading label={t('adminRepositories.loading')} />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  const visiveis = table.getRowModel().rows
  const filtradas = table.getFilteredRowModel().rows.length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('adminRepositories.eyebrow')}
        title={t('adminRepositories.title')}
        description={t('adminRepositories.subtitle', { total: numero.format(data.count) })}
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5">
          <span className="eyebrow">{t('adminRepositories.filterSearch')}</span>
          <input
            type="search"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder={t('access.searchRepository')}
            className="border border-border-subtle bg-surface px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">{t('adminRepositories.filterStatus')}</span>
          <select
            value={situacao}
            onChange={(event) => setSituacao(event.target.value as FiltroSituacao)}
            className="border border-border-subtle bg-surface px-3 py-2 text-sm"
          >
            <option value="todos">{t('adminRepositories.status.all')}</option>
            <option value="valid">{t('adminRepositories.status.valid')}</option>
            <option value="error">{t('adminRepositories.status.error')}</option>
            <option value="sem-coleta">{t('adminRepositories.status.none')}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">{t('adminRepositories.filterManagers')}</span>
          <select
            value={gestor}
            onChange={(event) => setGestor(event.target.value as FiltroGestor)}
            className="border border-border-subtle bg-surface px-3 py-2 text-sm"
          >
            <option value="todos">{t('adminRepositories.managers.all')}</option>
            <option value="com">{t('adminRepositories.managers.with')}</option>
            <option value="sem">{t('adminRepositories.managers.without')}</option>
          </select>
        </label>
      </div>

      <p className="text-sm text-content-muted">
        {t('adminRepositories.showing', {
          shown: numero.format(filtradas),
          total: numero.format(data.count),
        })}
      </p>

      {visiveis.length === 0 ? (
        <Empty label={t('access.noRepositories')} />
      ) : (
        <>
          <div className="panel overflow-x-auto">
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
            <table className="w-full min-w-2xl table-fixed border-collapse text-sm">
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
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[24%]" />
                <col className="w-[21%]" />
                <col className="w-[19%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    key={headerGroup.id}
                    className="border-b border-border-subtle bg-surface-muted"
                  >
                    {headerGroup.headers.map((header) => {
                      const direcao = header.column.getIsSorted()
                      const alinhaDireita = header.column.id === 'invalidRatio'
                      return (
                        <th
                          key={header.id}
                          className={`px-4 py-3 font-heading text-xs font-bold ${
                            alinhaDireita ? 'text-right' : 'text-left'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={`flex items-center gap-1 transition-colors duration-150 hover:text-brand-strong ${
                              alinhaDireita ? 'ml-auto' : ''
                            }`}
                          >
                            <table.FlexRender header={header} />
                            <span aria-hidden="true" className="text-content-muted">
                              {direcao === 'asc' ? '↑' : direcao === 'desc' ? '↓' : '↕'}
                            </span>
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {visiveis.map((row) => (
                  <tr key={row.id} className="border-b border-border-subtle last:border-0">
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={`px-4 py-3 align-top ${
                          cell.column.id === 'invalidRatio'
                            ? 'text-right'
                            : cell.column.id === 'managerCount'
                              ? 'text-center'
                              : ''
                        }`}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-content-muted">
              {t('pagination.page', {
                page: table.state.pagination.pageIndex + 1,
                total: Math.max(table.getPageCount(), 1),
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="border border-border-subtle px-3 py-1.5 disabled:opacity-40"
              >
                {t('pagination.previous')}
              </button>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="border border-border-subtle px-3 py-1.5 disabled:opacity-40"
              >
                {t('pagination.next')}
              </button>
            </div>
          </div>
        </>
      )}

      {gestoresDe ? (
        <RepositoryManagersModal
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
function HarvestCell({ repo, numero }: { repo: RepositoryHit; numero: Intl.NumberFormat }) {
  const { t } = useTranslation()

  if (!repo.lastSnapshotId) {
    return <span className="text-content-muted">{t('harvests.none')}</span>
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        {repo.lastSnapshotStatus ? <HarvestStatusBadge status={repo.lastSnapshotStatus} /> : null}
        <Link
          to={`/coletas/${repo.lastSnapshotId}`}
          className="font-mono text-xs text-brand-strong hover:underline"
        >
          #{repo.lastSnapshotId}
        </Link>
      </span>
      <span className="text-xs text-content-muted">
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
                to={`/coletas/${repo.lastSnapshotId}/registros`}
                title={t('adminRepositories.openRecords')}
                className="text-brand-strong hover:underline"
              >
                {t('adminRepositories.records', { count: numero.format(repo.lastSize) })}
              </Link>
            ) : (
              t('adminRepositories.records', { count: numero.format(repo.lastSize) })
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
function InvalidCell({
  repo,
  numero,
  percentual,
}: {
  repo: RepositoryHit
  numero: Intl.NumberFormat
  percentual: Intl.NumberFormat
}) {
  const { t } = useTranslation()

  if (repo.invalidRatio === null || repo.invalidRatio === undefined) {
    // "Não avaliado" e "0% inválidos" são conclusões diferentes: a coleta que
    // falhou tem registros, mas nenhum passou por validação.
    const naoAvaliado = repo.lastSnapshotId && repo.lastIndexStatus !== 'INDEXED'
    return (
      <span className="text-xs text-content-muted" title={repo.lastIndexStatus ?? ''}>
        {naoAvaliado ? t('adminRepositories.notEvaluated') : '—'}
      </span>
    )
  }

  const tom =
    repo.invalidRatio >= 0.5 ? 'text-down' : repo.invalidRatio > 0 ? 'text-warn' : 'text-ok'

  // Zero inválidos não tem o que listar: vira texto, não link.
  if (!repo.invalidSize || !repo.lastSnapshotId) {
    return (
      <span className="flex flex-col items-end">
        <span className={`font-heading font-bold tabular-nums ${tom}`}>
          {percentual.format(repo.invalidRatio)}
        </span>
      </span>
    )
  }

  return (
    <Link
      to={`/coletas/${repo.lastSnapshotId}/registros?valid=false`}
      title={t('adminRepositories.openInvalidRecords')}
      className="flex flex-col items-end hover:underline"
    >
      <span className={`font-heading font-bold tabular-nums ${tom}`}>
        {percentual.format(repo.invalidRatio)}
      </span>
      <span className="text-xs text-content-muted">
        {t('adminRepositories.invalidRecords', { count: numero.format(repo.invalidSize) })}
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

  if (repo.managerCount > 0) {
    return (
      <button
        type="button"
        onClick={onVer}
        title={t('adminRepositories.seeManagers', { count: repo.managerCount })}
        aria-label={t('adminRepositories.seeManagers', { count: repo.managerCount })}
        className="inline-flex flex-wrap items-center justify-center gap-1.5 px-1 py-1 text-content-muted transition-colors duration-150 hover:text-brand-strong"
      >
        <UsersIcon />
        <span className="text-xs tabular-nums">{repo.managerCount}</span>
      </button>
    )
  }

  return (
    <Link
      to={`/acessos?busca=${encodeURIComponent(repo.acronym ?? '')}&selecionar=${repo.harvesterRepositoryId}`}
      title={t('adminRepositories.assignManager')}
      aria-label={t('adminRepositories.assignManager')}
      className="inline-flex flex-wrap items-center justify-center gap-1.5 px-1 py-1 text-warn transition-colors duration-150 hover:text-brand-strong"
    >
      <UserPlusIcon />
      <span className="text-xs">{t('adminRepositories.none')}</span>
    </Link>
  )
}
