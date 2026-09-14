import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFns,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'

import { ValidityBadge } from '@/components/Badges'
import { ExportButton } from '@/components/ExportButton'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { FilterBar } from '@/components/FilterBar'
import { Pagination } from '@/components/Pagination'
import { filtersFromSearch, filtersToParams, type RecordFilters } from '@/lib/filters'
import { recordsQuery } from '@/lib/queries'
import type { RecordItem } from '@/lib/types'

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  filterFns,
  sortFns,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const columnHelper = createColumnHelper<typeof features, RecordItem>()

const PAGE_SIZE = 20

/**
 * Registros da coleta.
 *
 * Paginação e filtros são resolvidos no servidor: a coleta tem dezenas de
 * milhares de registros e trazer tudo para ordenar no cliente não é opção. A
 * tabela cuida apenas da apresentação da página corrente.
 */
export function RecordsPage() {
  const { t } = useTranslation()
  const { snapshotId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const filtros = filtersFromSearch(searchParams)
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    ...recordsQuery(snapshotId, page, PAGE_SIZE, filtros),
    // Mantém a página anterior visível enquanto a próxima carrega: o Harvester
    // é lento e piscar a tabela a cada passo é pior que um leve atraso.
    placeholderData: keepPreviousData,
  })

  /** Mudar filtro volta para a primeira página — a antiga pode não existir mais. */
  const aplicarFiltros = useCallback(
    (novos: RecordFilters) => {
      const params = filtersToParams(novos)
      setSearchParams(params, { replace: false })
    },
    [setSearchParams],
  )

  const irParaPagina = useCallback(
    (destino: number) => {
      const params = filtersToParams(filtros)
      if (destino > 1) params.set('page', String(destino))
      setSearchParams(params)
    },
    [filtros, setSearchParams],
  )

  const sufixoFiltros = useMemo(() => {
    const query = filtersToParams(filtros).toString()
    return query ? `?${query}` : ''
  }, [filtros])

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('identifier', {
          header: t('records.columns.identifier'),
          cell: (info) => (
            <Link
              to={`/coletas/${snapshotId}/registros/${info.getValue()}${sufixoFiltros}`}
              className="font-mono text-xs break-all text-brand-strong hover:underline"
            >
              {info.getValue()}
            </Link>
          ),
        }),
        columnHelper.accessor('isValid', {
          header: t('records.columns.valid'),
          cell: (info) => <ValidityBadge valid={info.getValue()} />,
        }),
        columnHelper.accessor('isTransformed', {
          header: t('records.columns.transformed'),
          cell: (info) =>
            info.getValue() === null || info.getValue() === undefined
              ? '—'
              : info.getValue()
                ? t('common.yes')
                : t('common.no'),
        }),
        columnHelper.accessor('setSpec', {
          header: t('records.columns.set'),
          cell: (info) => <span className="text-content-muted">{info.getValue() ?? '—'}</span>,
        }),
      ]),
    [t, snapshotId, sufixoFiltros],
  )

  const rows = useMemo(() => data?.results ?? [], [data])

  const table = useTable({ features, columns, data: rows })

  if (isPending) return <Loading />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <FilterBar filters={filtros} onChange={aplicarFiltros} />
        <ExportButton snapshotId={snapshotId} filters={filtros} />
      </div>

      <p className="text-sm text-content-muted">
        {t('records.total', { count: data.totalElements ?? 0 })}
        {isFetching ? ` · ${t('common.loading')}` : ''}
      </p>

      {rows.length === 0 ? (
        <Empty label={t('records.none')} />
      ) : (
        <>
          <div className="overflow-x-auto panel">
            <table className="w-full min-w-3xl border-collapse text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    key={headerGroup.id}
                    className="border-b border-border-subtle bg-surface-muted"
                  >
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-3 text-left font-heading text-xs font-bold"
                      >
                        <table.FlexRender header={header} />
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-border-subtle last:border-0">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 align-top">
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={data.page} totalPages={data.totalPages ?? 1} onChange={irParaPagina} />
        </>
      )}
    </div>
  )
}
